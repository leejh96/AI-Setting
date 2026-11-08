import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { recordHook, runAgy, stopPosixTree } from './scripts/agy.mjs';
import { cancel, finish, followUp, serve, start, status } from './scripts/worker.mjs';
import { prepareWorkspace } from './scripts/workspace.mjs';

const hookModule = new URL('./scripts/agy.mjs', import.meta.url).href;
const fakeAgy = [
  "import { recordHook } from " + JSON.stringify(hookModule) + ";",
  "const [directory, input] = process.argv.slice(1);",
  "const message = input.split('\\n\\n')[0];",
  "const payload = { conversationId: 'test-turn', lastUserInput: input };",
  "const active = () => recordHook(directory, 'active', { ...payload, invocationNum: 0 });",
  "const stop = (extra) => recordHook(directory, 'stop', { ...payload, fullyIdle: true, terminationReason: 'NO_TOOL_CALL', executionNum: 0, ...extra });",
  "const keepOpen = () => setInterval(() => {}, 1000);",
  "if (message === 'startup hang') keepOpen();",
  "else {",
  "  if (message === 'out of order') stop();",
  "  else active();",
  "  if (message === 'missing completion') process.exit(0);",
  "  if (message === 'crash after completion') { stop(); process.exit(7); }",
  "  if (message === 'running hang') stop({ fullyIdle: false });",
  "  else if (message === 'invalid idle flag') stop({ fullyIdle: 'false' });",
  "  else if (message === 'wrong conversation') stop({ conversationId: 'another-turn' });",
  "  else if (message === 'failed') stop({ terminationReason: 'error' });",
  "  else if (message === 'delayed completion') setTimeout(stop, 200);",
  "  else if (message === 'manual closes after completing') {",
  "    stop();",
  "    setTimeout(() => {",
  "      const manual = { ...payload, lastUserInput: 'Manual follow-up' };",
  "      recordHook(directory, 'active', manual);",
  "      stop(manual);",
  "      process.exit(0);",
  "    }, 200);",
  "  }",
  "  else if (message === 'duplicate') { stop(); stop(); active(); }",
  "  else if (message !== 'out of order') stop();",
  "  keepOpen();",
  "}",
].join('\n');

function runFake(job, prompt, report, signal, controls) {
  let child;
  return runAgy(job, prompt, report, signal, {
    ...controls,
    spawnChild(file, args, options) {
      assert.equal(file, process.execPath);
      assert.deepEqual(args.slice(0, -1), [
        '--sandbox', '--dangerously-skip-permissions', '--model', 'gemini-3.8-flash-high', '--effort', 'high',
        '--add-dir', job.cwd, '-i',
      ]);
      assert.equal(options.stdio, 'inherit');
      assert.notEqual(options.env, process.env);
      const normalizeKey = (name) => process.platform === 'win32' ? name.toUpperCase() : name;
      const childEnvironment = new Map(Object.entries(options.env).map(([name, value]) => [normalizeKey(name), value]));
      assert.equal(childEnvironment.has('NO_COLOR'), false);
      assert.equal(childEnvironment.get('TERM'), process.env.TERM === 'dumb' ? undefined : process.env.TERM);
      assert.match(args.at(-1), /Preserve \.agents\/hooks\.json/);
      child = spawn(file, ['--input-type=module', '-e', fakeAgy, '--', job.jobDirectory, args.at(-1)], options);
      return child;
    },
    terminate(pid) {
      assert.equal(pid, child.pid);
      assert.ok(child.kill('SIGKILL'));
    },
    startupMs: 900,
    settleMs: 60,
  });
}

async function until(job, accept) {
  const deadline = Date.now() + 5_000;
  let current;
  do {
    current = status(job.jobDirectory);
    if (accept(current)) return current;
    await delay(15);
  } while (Date.now() < deadline);
  assert.fail('Unmet state for ' + job.jobDirectory + ': ' + JSON.stringify(current));
}

const reviewed = (job) => until(job, (current) => current.status === 'review-ready' && current.tuiOpen);
const finished = (job) => until(job, (current) => current.finishedAt);

function fixture(t, { existingConfig = true, run = runFake, workspace } = {}) {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'codex-agy-test-'));
  const jobs = [];
  const terminals = new Map();
  t.after(async () => {
    for (const close of terminals.values()) close();
    try {
      for (const job of jobs) {
        if (terminals.has(job.terminalDirectory)) await finished(job);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  const jobRoot = workspace ? join(directory, 'worker-storage', 'jobs') : directory;
  let git;
  let originalWorktree;
  if (workspace === 'git') {
    originalWorktree = join(directory, 'original repo');
    mkdirSync(originalWorktree);
    git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
    git(originalWorktree, 'init', '-q');
    const hooks = join(directory, 'empty-git-hooks');
    mkdirSync(hooks);
    git(originalWorktree, 'config', 'core.hooksPath', hooks);
    git(originalWorktree, 'config', 'user.name', 'Worker Test');
    git(originalWorktree, 'config', 'user.email', 'worker-test@example.test');
    git(originalWorktree, 'config', 'commit.gpgSign', 'false');
    git(originalWorktree, 'config', 'core.autocrlf', 'false');
    writeFileSync(join(originalWorktree, '.gitignore'), '*.ignored\n');
    writeFileSync(join(originalWorktree, 'result.md'), 'initial\n');
    git(originalWorktree, 'add', '.');
    git(originalWorktree, 'commit', '-qm', 'Initial');
  }
  const cwd = workspace ? prepareWorkspace(jobRoot, originalWorktree).cwd : join(directory, 'work tree 한글');
  if (!workspace) mkdirSync(cwd);
  const agents = join(cwd, '.agents');
  const config = join(agents, 'hooks.json');
  const lock = join(agents, '.codex-antigravity-worker.lock');
  const original = '{ "local": { "enabled": false } }\r\n';
  if (existingConfig) {
    mkdirSync(agents);
    writeFileSync(config, original);
  }
  const open = (terminal) => terminals.set(terminal, serve(terminal, run));
  const options = { timeout: '1', locateAgy: () => process.execPath, launch: open, jobRoot };
  let promptIndex = 0;
  function prompt(message) {
    const path = join(directory, 'prompt-' + ++promptIndex + '.txt');
    writeFileSync(path, message);
    return path;
  }
  function track(job) {
    jobs.push(job);
    return job;
  }
  return {
    agents, config, lock, original, terminals, open, jobRoot, cwd, directory, git, originalWorktree,
    start: (message, overrides) => track(start(cwd, prompt(message), { ...options, ...overrides })),
    follow: async (job, message, overrides) => track(await followUp(job.jobDirectory, prompt(message), { ...options, ...overrides })),
  };
}

test('finish preserves an external workspace and a managed workspace with a newer worker job', async (t) => {
  const external = fixture(t);
  const unmanaged = await reviewed(external.start('normal'));
  await assert.rejects(finish(unmanaged.jobDirectory, undefined, external.jobRoot), /created by prepare/);
  assert.equal(status(unmanaged.jobDirectory).tuiOpen, true);

  const env = fixture(t, { workspace: 'temporary', existingConfig: false });
  const first = await reviewed(env.start('normal'));
  const second = await reviewed(await env.follow(first, 'normal'));
  await assert.rejects(finish(first.jobDirectory, undefined, env.jobRoot), /Another job/);
  assert.equal(status(second.jobDirectory).tuiOpen, true);
  const result = await finish(second.jobDirectory, undefined, env.jobRoot);
  assert.equal(result.status, 'workspace-removed');
  assert.equal(existsSync(dirname(env.cwd)), false);
});

test('finish keeps temporary files until all results are published at the same relative paths', async (t) => {
  const env = fixture(t, { workspace: 'temporary', existingConfig: false });
  const published = join(env.directory, 'published');
  for (const directory of [env.cwd, published]) mkdirSync(join(directory, 'sub'), { recursive: true });
  writeFileSync(join(env.cwd, 'first.txt'), 'first');
  writeFileSync(join(env.cwd, 'sub', 'result.txt'), 'result');
  writeFileSync(join(published, 'first.txt'), 'first');
  writeFileSync(join(published, 'sub', 'result.txt'), 'change');
  const job = await reviewed(env.start('normal'));

  await assert.rejects(finish(job.jobDirectory, published, env.jobRoot), /Published result differs/);
  assert.equal(readFileSync(join(env.cwd, 'first.txt'), 'utf8'), 'first');
  assert.equal(readFileSync(join(env.cwd, 'sub', 'result.txt'), 'utf8'), 'result');
  assert.equal(status(job.jobDirectory).tuiOpen, false);
  assert.equal(existsSync(env.lock), false);
  await assert.rejects(finish(job.jobDirectory, env.cwd, env.jobRoot), /outside managed/);
  await assert.rejects(finish(job.jobDirectory, job.jobDirectory, env.jobRoot), /outside managed/);

  const link = join(env.cwd, 'linked-directory');
  symlinkSync(published, link, 'junction');
  await assert.rejects(finish(job.jobDirectory, published, env.jobRoot), /unsupported published result/);
  unlinkSync(link);
  writeFileSync(join(published, 'sub', 'result.txt'), 'result');
  await finish(job.jobDirectory, published, env.jobRoot);
  assert.equal(existsSync(dirname(env.cwd)), false);
  assert.equal(readFileSync(join(published, 'sub', 'result.txt'), 'utf8'), 'result');
});

test('finish removes a clean Git worktree only after its commit reaches the original history', async (t) => {
  const env = fixture(t, { workspace: 'git', existingConfig: false });
  const { cwd, git, originalWorktree } = env;
  writeFileSync(join(cwd, 'result.md'), 'worker output\n');
  git(cwd, 'commit', '-qam', 'Worker result');
  const commit = git(cwd, 'rev-parse', 'HEAD');
  const job = await reviewed(env.start('normal'));
  await assert.rejects(finish(job.jobDirectory, undefined, env.jobRoot), /not in the original worktree history/);
  assert.equal(git(cwd, 'rev-parse', 'HEAD'), commit);

  git(originalWorktree, 'merge', '--ff-only', commit);
  const local = join(cwd, 'local.ignored');
  writeFileSync(local, 'keep local data');
  await assert.rejects(finish(job.jobDirectory, undefined, env.jobRoot), /contains local changes or ignored files/);
  assert.equal(readFileSync(local, 'utf8'), 'keep local data');
  unlinkSync(local);
  git(cwd, 'update-index', '--assume-unchanged', 'result.md');
  await assert.rejects(finish(job.jobDirectory, undefined, env.jobRoot), /contains local changes or ignored files/);
  git(cwd, 'update-index', '--no-assume-unchanged', 'result.md');
  await finish(job.jobDirectory, undefined, env.jobRoot);
  assert.equal(existsSync(dirname(cwd)), false);
  assert.equal(git(originalWorktree, 'worktree', 'list', '--porcelain').split('\n').filter((line) => line.startsWith('worktree ')).length, 1);
  assert.equal(git(originalWorktree, 'show', 'HEAD:result.md'), 'worker output');
});

test('Stop hook confirms completion while the native screen stays open, including delayed and repeated events', async (t) => {
  const env = fixture(t);
  let job;
  for (const message of ['normal', 'delayed completion', 'duplicate', 'out of order']) {
    const previous = job;
    job = await reviewed(job ? await env.follow(job, message) : env.start(message));
    if (previous) assert.equal((await finished(previous)).tuiOpen, false);
    assert.equal(job.terminationReason, 'NO_TOOL_CALL');
    assert.equal(readFileSync(env.lock, 'utf8'), job.jobDirectory);
    const installed = JSON.parse(readFileSync(env.config, 'utf8'));
    assert.equal(installed.local.enabled, false);
    assert.ok(installed['codex-antigravity-worker'].Stop[0].command);
  }
  assert.equal(env.terminals.size, 1);
  cancel(job.jobDirectory);
  assert.equal((await finished(job)).status, 'interrupted');
  assert.equal(readFileSync(env.config, 'utf8'), env.original);
  assert.equal(existsSync(env.lock), false);
});

test('a completed Stop is read before the work deadline even without file notifications', async (t) => {
  const env = fixture(t, {
    run(job, prompt, report, signal, controls) {
      return runFake(job, prompt, report, signal, {
        ...controls,
        watchEvents: () => ({ on() {}, close() {} }),
      });
    },
  });
  const job = env.start('running hang', { timeout: '60' });
  await until(job, ({ status }) => status === 'agy-running');
  recordHook(job.jobDirectory, 'stop', {
    conversationId: 'test-turn',
    lastUserInput: `[Codex worker job ${basename(job.jobDirectory)}]`,
    fullyIdle: true,
    terminationReason: 'NO_TOOL_CALL',
    executionNum: 0,
  });
  assert.equal((await reviewed(job)).terminationReason, 'NO_TOOL_CALL');
});

test('unrelated, non-idle and failed Stop signals do not produce a successful handoff', async (t) => {
  const env = fixture(t, { existingConfig: false });
  let job;
  for (const [message, expected, phase] of [
    ['wrong conversation', 'timed-out', 'agy-running'],
    ['failed', 'failed', 'agy-settling'],
    ['startup hang', 'timed-out', 'agy-starting'],
    ['running hang', 'timed-out', 'agy-running'],
    ['invalid idle flag', 'timed-out', 'agy-running'],
  ]) {
    job = job ? await env.follow(job, message) : env.start(message);
    const result = await finished(job);
    assert.equal(result.status, expected, message);
    assert.equal(result.phase, phase, message);
    assert.equal(existsSync(env.agents), false, message);
  }
});

test('unconfirmed CLI exit preserves hooks and the worktree lock', async (t) => {
  for (const [message, reason, code] of [['missing completion', 'completion-missing', 0], ['crash after completion', 'failed', 7]]) {
    const env = fixture(t);
    const job = env.start(message);
    const result = await finished(job);
    assert.equal(result.status, 'cleanup-needed');
    assert.equal(result.exitStatus, reason);
    assert.equal(result.exitCode, code);
    assert.equal(result.tuiOpen, false);
    assert.equal(readFileSync(env.lock, 'utf8'), job.jobDirectory);
    assert.ok(JSON.parse(readFileSync(env.config, 'utf8'))['codex-antigravity-worker']);
    await assert.rejects(env.follow(job, 'normal'), /worktree is locked/);
  }
});

test('clean exit after a manually completed turn restores hooks without accepting the old handoff', async (t) => {
  const env = fixture(t);
  const result = await finished(env.start('manual closes after completing'));
  assert.equal(result.status, 'changed-after-handoff');
  assert.equal(existsSync(env.lock), false);
  assert.equal(readFileSync(env.config, 'utf8'), env.original);
});

test('follow-up replaces a terminal whose input mode could not be restored', async (t) => {
  let sessions = 0;
  const env = fixture(t, {
    run(job, prompt, report, signal, controls) {
      const first = ++sessions === 1;
      return runFake(job, prompt, report, signal, {
        ...controls,
        saveTerminal: () => first ? () => { throw new Error('terminal mode unavailable'); } : undefined,
      });
    },
  });
  const first = await reviewed(env.start('normal'));
  const replacement = await reviewed(await env.follow(first, 'normal'));
  const result = await finished(first);
  assert.equal(result.terminalReusable, false);
  assert.match(result.terminalError, /terminal mode unavailable/);
  assert.equal(replacement.terminalReason, 'previous-terminal-unavailable');
  assert.notEqual(replacement.terminalDirectory, first.terminalDirectory);
});

test('follow-up defaults to the existing terminal and supports a requested or replacement terminal', async (t) => {
  const env = fixture(t);
  const first = await reviewed(env.start('normal'));
  assert.equal(status(first.jobDirectory).terminalReason, 'initial');
  await assert.rejects(env.follow(first, ''), /prompt is empty/);
  assert.equal(status(first.jobDirectory).tuiOpen, true);
  const reused = await reviewed(await env.follow(first, 'normal'));
  assert.equal(reused.terminalDirectory, first.terminalDirectory);
  assert.equal(reused.terminalReason, 'reused');
  assert.equal(env.terminals.size, 1);
  const separate = await reviewed(await env.follow(reused, 'normal', { newTerminal: true }));
  assert.equal(separate.terminalReason, 'requested');
  assert.notEqual(separate.terminalDirectory, first.terminalDirectory);
  env.terminals.get(separate.terminalDirectory)();
  await finished(separate);
  await until(separate, ({ terminalOpen }) => terminalOpen === false);
  const replacement = await reviewed(await env.follow(separate, 'normal'));
  assert.equal(replacement.terminalReason, 'previous-terminal-unavailable');
  assert.equal(env.terminals.size, 3);
});

test('follow-up can be retried after fresh activity revokes a handoff', async (t) => {
  const env = fixture(t);
  const first = await reviewed(env.start('normal', { timeout: '5' }));
  const payload = { conversationId: 'test-turn', lastUserInput: `[Codex worker job ${basename(first.jobDirectory)}]` };

  recordHook(first.jobDirectory, 'active', { ...payload, invocationNum: 1 });
  await assert.rejects(env.follow(first, 'normal'), /Could not close the previous Antigravity screen safely/);
  assert.equal(status(first.jobDirectory).status, 'agy-running');
  recordHook(first.jobDirectory, 'stop', { ...payload, fullyIdle: true, terminationReason: 'NO_TOOL_CALL', executionNum: 1 });
  await reviewed(first);

  const second = await reviewed(await env.follow(first, 'normal'));
  assert.equal(second.terminalDirectory, first.terminalDirectory);
  assert.equal((await finished(first)).tuiOpen, false);
});

test('POSIX cancellation freezes and waits for descendants before releasing the job', async () => {
  const processes = new Map([
    [10, { parent: 1, state: 'S' }],
    [11, { parent: 10, state: 'S' }],
    [99, { parent: 1, state: 'S' }],
  ]);
  const signals = [];
  await stopPosixTree(10, {
    snapshot: () => new Map([...processes].map(([pid, info]) => [pid, { ...info }])),
    send(pid, signal) {
      signals.push([pid, signal]);
      if (signal === 'SIGSTOP') {
        if (pid === 11) processes.set(12, { parent: 11, state: 'R' });
        processes.get(pid).state = 'T';
      } else if (signal === 'SIGKILL') {
        processes.delete(pid);
      }
      return true;
    },
  });
  assert.deepEqual([...processes.keys()], [99]);
  assert.deepEqual(signals.filter(([, signal]) => signal === 'SIGKILL').map(([pid]) => pid), [12, 11, 10]);
});

test('POSIX cancellation resumes paused processes if their tree cannot be inspected', async () => {
  let scans = 0;
  const signals = [];
  await assert.rejects(stopPosixTree(10, {
    snapshot() {
      if (scans++) throw new Error('ps denied');
      return new Map([[10, { parent: 1, state: 'S' }]]);
    },
    send(pid, signal) { signals.push([pid, signal]); return true; },
  }), /ps denied/);
  assert.deepEqual(signals, [[10, 'SIGSTOP'], [10, 'SIGCONT']]);
});

test('a manually entered prompt invalidates the handoff and another terminal cannot write concurrently', async (t) => {
  const env = fixture(t);
  const job = await reviewed(env.start('normal'));
  recordHook(job.jobDirectory, 'active', { conversationId: 'test-turn', lastUserInput: 'Manual follow-up' });
  await until(job, ({ status }) => status === 'changed-after-handoff');
  await assert.rejects(env.follow(job, 'normal', { newTerminal: true }), /worktree is locked/);
  assert.throws(() => env.start('normal'), /worktree is locked/);
  cancel(job.jobDirectory);
  assert.equal((await finished(job)).status, 'interrupted');
  assert.equal(readFileSync(env.config, 'utf8'), env.original);
});

test('an external hook edit remains intact and cleanup reports the backup and lock', async (t) => {
  const env = fixture(t);
  const job = await reviewed(env.start('normal'));
  const changed = '{ "external": { "enabled": true } }\r\n';
  writeFileSync(env.config, changed);
  cancel(job.jobDirectory);
  const result = await finished(job);
  assert.equal(result.status, 'cleanup-needed');
  assert.equal(result.lockPath, env.lock);
  assert.equal(result.hookPath, env.config);
  assert.equal(readFileSync(env.config, 'utf8'), changed);
  assert.equal(readFileSync(join(job.jobDirectory, 'original-hooks.json'), 'utf8'), env.original);
});

test('a terminal that starts after its request expired never installs a hook', async (t) => {
  const env = fixture(t);
  const pending = env.start('normal', { launch() {} });
  const path = join(pending.jobDirectory, 'job.json');
  const staged = JSON.parse(readFileSync(path, 'utf8'));
  writeFileSync(path, JSON.stringify({ ...staged, createdAt: Date.now() - 60_000 }));
  assert.equal(status(pending.jobDirectory).status, 'startup-timeout');
  env.open(pending.terminalDirectory);
  assert.equal((await finished(pending)).status, 'startup-timeout');
  assert.equal(existsSync(env.lock), false);
  assert.equal(readFileSync(env.config, 'utf8'), env.original);
});

test('a busy terminal keeps its queued request and discards the rejected job directory', async (t) => {
  const env = fixture(t);
  const pending = env.start('normal', { launch() {} });
  const directory = pending.jobDirectory;
  writeFileSync(join(directory, 'terminal.json'), JSON.stringify({ pid: process.pid }));
  writeFileSync(join(directory, 'result.json'), JSON.stringify({ status: 'review-ready', finishedAt: Date.now() }));
  const request = join(directory, 'request.json');
  const queued = readFileSync(request, 'utf8');
  const before = readdirSync(env.jobRoot).filter(name => name.startsWith('codex-agy-worker-')).sort();
  await assert.rejects(env.follow(pending, 'normal'), /Could not queue the job/);
  assert.deepEqual(readdirSync(env.jobRoot).filter(name => name.startsWith('codex-agy-worker-')).sort(), before);
  assert.equal(readFileSync(request, 'utf8'), queued);
});

test('a new worker removes only old closed terminal groups with confirmed results and no lock', t => {
  const env = fixture(t);
  const old = Date.now() - 25 * 60 * 60 * 1000;
  function savedJob({ terminal, cwd = env.cwd, status = 'review-ready', closedAt = old, hasResult = true } = {}) {
    const directory = mkdtempSync(join(env.jobRoot, 'codex-agy-worker-'));
    const save = (name, value) => writeFileSync(join(directory, name), JSON.stringify(value));
    save('job.json', { jobDirectory: directory, terminalDirectory: terminal ?? directory, cwd, createdAt: old - 1000 });
    if (!terminal) {
      save('terminal.json', { pid: process.pid });
      if (closedAt !== null) save('closed.json', { timestamp: closedAt });
    }
    if (hasResult) save('result.json', { status, finishedAt: old, tuiOpen: false });
    return directory;
  }
  const expired = savedJob();
  const expiredFollowUp = savedJob({ terminal: expired, status: 'interrupted' });
  const recent = savedJob({ closedAt: Date.now() });
  const open = savedJob({ closedAt: null });
  const active = savedJob({ closedAt: null, hasResult: false });
  const recoveryTerminal = savedJob();
  const recovery = savedJob({ terminal: recoveryTerminal, status: 'cleanup-needed' });
  writeFileSync(join(recovery, 'original-hooks.json'), env.original);
  const incompleteTerminal = savedJob();
  const incomplete = savedJob({ terminal: incompleteTerminal, hasResult: false });
  const queued = savedJob();
  writeFileSync(join(queued, 'request.json'), '{}');
  const lockedCwd = join(env.jobRoot, 'locked workspace');
  const locked = savedJob({ cwd: lockedCwd });
  mkdirSync(join(lockedCwd, '.agents'), { recursive: true });
  writeFileSync(join(lockedCwd, '.agents', '.codex-antigravity-worker.lock'), locked);
  const symlink = join(env.jobRoot, 'codex-agy-worker-linked');
  symlinkSync(lockedCwd, symlink, process.platform === 'win32' ? 'junction' : 'dir');

  env.start('normal', { launch() {} });

  assert.equal(existsSync(expired), false);
  assert.equal(existsSync(expiredFollowUp), false);
  for (const kept of [recent, open, active, recoveryTerminal, recovery, incompleteTerminal, incomplete, queued, locked, symlink]) {
    assert.ok(existsSync(kept), kept);
  }
  assert.equal(readFileSync(join(recovery, 'original-hooks.json'), 'utf8'), env.original);
  assert.equal(readFileSync(env.config, 'utf8'), env.original);
});

test('default starts and follow-ups store and clean records only under the Codex home', async t => {
  const env = fixture(t);
  const legacy = join(env.jobRoot, 'legacy temporary directory');
  const codex = join(env.jobRoot, 'codex home');
  mkdirSync(legacy, { mode: 0o700 });
  const vars = { CODEX_HOME: codex, TMPDIR: legacy, TEMP: legacy, TMP: legacy };
  const previous = Object.fromEntries(Object.keys(vars).map(name => [name, process.env[name]]));
  Object.assign(process.env, vars);
  try {
    const old = Date.now() - 25 * 60 * 60 * 1000;
    function archived(jobRoot) {
      const { jobDirectory } = env.start('normal', { jobRoot, launch() {} });
      const save = (name, value) => writeFileSync(join(jobDirectory, name), JSON.stringify(value));
      save('job.json', { ...JSON.parse(readFileSync(join(jobDirectory, 'job.json'), 'utf8')), createdAt: old - 1000 });
      save('terminal.json', { pid: process.pid });
      save('closed.json', { timestamp: old });
      save('result.json', { status: 'review-ready', finishedAt: old });
      unlinkSync(join(jobDirectory, 'request.json'));
      return jobDirectory;
    }
    const expiredLegacy = archived(legacy);
    const expiredCurrent = archived(undefined);

    const fresh = env.start('normal', { jobRoot: undefined, launch() {} });
    const storage = realpathSync(join(codex, 'antigravity-worker', 'jobs'));
    assert.equal(dirname(fresh.jobDirectory), storage);
    assert.equal(existsSync(expiredCurrent), false);
    assert.equal(existsSync(expiredLegacy), true);

    const running = await reviewed(env.start('normal', { jobRoot: legacy }));
    const follow = await reviewed(await env.follow(running, 'normal', { jobRoot: undefined }));
    assert.equal(follow.terminalDirectory, follow.jobDirectory);
    assert.equal(dirname(follow.jobDirectory), storage);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test('a lost terminal with a worker-owned lock reports both recovery paths', (t) => {
  const env = fixture(t);
  const pending = env.start('normal', { launch() {} });
  writeFileSync(join(pending.jobDirectory, 'terminal.json'), JSON.stringify({ pid: process.pid }));
  writeFileSync(join(pending.jobDirectory, 'closed.json'), '{}');
  writeFileSync(env.lock, pending.jobDirectory);
  const result = status(pending.jobDirectory);
  assert.equal(result.status, 'cleanup-needed');
  assert.equal(result.lockPath, env.lock);
  assert.equal(result.hookPath, env.config);
});

test('a status write failure stops the child before restoring hooks and unlocking the worktree', async (t) => {
  const env = fixture(t, {
    run(job, prompt, report, signal, controls) {
      return runFake(job, prompt, () => { throw new Error('cannot write progress'); }, signal, controls);
    },
  });
  const result = await finished(env.start('startup hang'));
  assert.equal(result.status, 'failed');
  assert.match(result.error, /cannot write progress/);
  assert.throws(() => process.kill(result.workerPid, 0), { code: 'ESRCH' });
  assert.equal(existsSync(env.lock), false);
  assert.equal(readFileSync(env.config, 'utf8'), env.original);
});
