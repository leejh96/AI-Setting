import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
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
    spawnChild(file, args, options) {
      assert.equal(file, process.execPath);
      assert.deepEqual(args.slice(0, -1), [
        '--sandbox', '--dangerously-skip-permissions', '--model', 'gemini-4-hydrogen-high', '--effort', 'high',
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
    firstHookQuietMs: 250,
    quietMs: 250,
    checkEveryMs: 35,
    settleMs: 60,
    ...controls,
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
  let prepareTarget;
  if (workspace === 'git' || workspace === 'copy') {
    originalWorktree = join(directory, 'original repo');
    mkdirSync(originalWorktree);
    git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
    git(originalWorktree, 'init', '-q', '-b', 'main');
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
    const caseAlias = join(directory, 'ORIGINAL REPO');
    prepareTarget = existsSync(caseAlias) ? caseAlias : originalWorktree;
  }
  const cwd = workspace ? prepareWorkspace(jobRoot, prepareTarget, { copy: workspace === 'copy' }).cwd : join(directory, 'work tree 한글');
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
  const options = { locateAgy: () => process.execPath, launch: open, jobRoot };
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

test('finish preserves unmanaged folders, work without a baseline, and jobs with a newer worker', async (t) => {
  const external = fixture(t);
  const unmanaged = await reviewed(external.start('normal'));
  await assert.rejects(finish(unmanaged.jobDirectory, undefined, external.jobRoot), /created by prepare/);

  const env = fixture(t, { workspace: 'temporary', existingConfig: false });
  const first = await reviewed(env.start('normal'));
  const second = await reviewed(await env.follow(first, 'normal'));
  await assert.rejects(finish(first.jobDirectory, undefined, env.jobRoot), /Another job/);
  assert.equal(status(second.jobDirectory).tuiOpen, true);
  await assert.rejects(finish(second.jobDirectory, undefined, env.jobRoot, 'discard'), /Missing Git repository and baseline/);
  assert.equal(existsSync(env.cwd), true);
});

test('finish verifies develop, protects dirty work, and deletes the merged task branch before release', async (t) => {
  const env = fixture(t, { workspace: 'git', existingConfig: false });
  const { cwd, git, originalWorktree } = env;
  const subdirectory = join(originalWorktree, 'subdirectory');
  mkdirSync(subdirectory);
  assert.throws(() => prepareWorkspace(env.jobRoot, subdirectory), /Pass the root of the original Git worktree/);
  git(cwd, 'switch', '-c', 'feature/result');
  writeFileSync(join(cwd, 'result.md'), 'worker output\n');
  git(cwd, 'commit', '-qam', 'Worker result');
  const commit = git(cwd, 'rev-parse', 'HEAD');
  git(originalWorktree, 'switch', '-c', 'unrelated');
  git(originalWorktree, 'merge', '--ff-only', commit);
  const job = await reviewed(env.start('normal'));
  for (const mode of ['identical', 'applied', 'discard']) {
    await assert.rejects(finish(job.jobDirectory, undefined, env.jobRoot, mode), /not on a local integration branch/);
  }
  assert.equal(git(cwd, 'rev-parse', 'HEAD'), commit);

  git(originalWorktree, 'switch', 'main');
  git(originalWorktree, 'switch', '-c', 'develop');
  git(originalWorktree, 'merge', '--ff-only', commit);
  const local = join(cwd, 'local.ignored');
  writeFileSync(local, 'keep local data');
  await assert.rejects(finish(job.jobDirectory, undefined, env.jobRoot, 'applied'), /contains local changes or ignored files/);
  assert.equal(readFileSync(local, 'utf8'), 'keep local data');
  unlinkSync(local);
  git(cwd, 'update-index', '--assume-unchanged', 'result.md');
  await assert.rejects(finish(job.jobDirectory, undefined, env.jobRoot), /contains local changes or ignored files/);
  git(cwd, 'update-index', '--no-assume-unchanged', 'result.md');
  const result = await finish(job.jobDirectory, undefined, env.jobRoot);
  assert.equal(result.removedBranch, 'feature/result');
  assert.equal(existsSync(dirname(cwd)), false);
  assert.equal(git(originalWorktree, 'branch', '--list', 'feature/result'), '');
  assert.match(git(originalWorktree, 'branch', '--list', 'develop'), /develop/);
  assert.equal(git(originalWorktree, 'show', 'HEAD:result.md'), 'worker output');
  assert.equal(git(originalWorktree, 'show', 'main:result.md'), 'initial');
});

test('finish accepts squash integration when the resulting files match main', async (t) => {
  const env = fixture(t, { workspace: 'git', existingConfig: false });
  const { cwd, git, originalWorktree } = env;
  git(cwd, 'switch', '-c', 'feature/squash');
  writeFileSync(join(cwd, 'result.md'), 'squashed work\n');
  git(cwd, 'commit', '-qam', 'Worker result');
  writeFileSync(join(cwd, 'extra.txt'), 'extra');
  git(cwd, 'add', 'extra.txt');
  git(cwd, 'commit', '-qm', 'Additional worker result');
  git(originalWorktree, 'merge', '--squash', 'feature/squash');
  git(originalWorktree, 'commit', '-qm', 'Squash worker changes');
  const job = await reviewed(env.start('normal'));
  assert.equal((await finish(job.jobDirectory, undefined, env.jobRoot)).removedBranch, 'feature/squash');
  assert.equal(git(originalWorktree, 'branch', '--list', 'feature/squash'), '');
  assert.equal(git(originalWorktree, 'show', 'HEAD:extra.txt'), 'extra');
});

test('finish compares file-only additions, edits and deletions against committed develop', async (t) => {
  const env = fixture(t, { workspace: 'copy', existingConfig: false });
  const { cwd, git, originalWorktree } = env;
  assert.equal(existsSync(join(cwd, '.git')), false);
  assert.equal(readFileSync(join(cwd, 'result.md'), 'utf8'), 'initial\n');
  git(originalWorktree, 'switch', '-c', 'develop');
  writeFileSync(join(cwd, 'result.md'), 'edited\n');
  writeFileSync(join(cwd, 'added.txt'), 'added');
  unlinkSync(join(cwd, '.gitignore'));
  writeFileSync(join(originalWorktree, 'result.md'), 'edited\n');
  writeFileSync(join(originalWorktree, 'added.txt'), 'added');
  const job = await reviewed(env.start('normal'));
  await assert.rejects(finish(job.jobDirectory, undefined, env.jobRoot), /not on a local integration branch/);
  git(originalWorktree, 'add', '-A');
  git(originalWorktree, 'commit', '-qm', 'Partial integration');
  await assert.rejects(finish(job.jobDirectory, undefined, env.jobRoot, 'applied'), /not on a local integration branch/);
  unlinkSync(join(originalWorktree, '.gitignore'));
  git(originalWorktree, 'add', '-A');
  git(originalWorktree, 'commit', '-qm', 'Apply deletion');
  const link = join(cwd, 'external');
  symlinkSync(originalWorktree, link, 'junction');
  await assert.rejects(finish(job.jobDirectory, undefined, env.jobRoot), /Unsupported file in worker results/);
  unlinkSync(link);
  await finish(job.jobDirectory, undefined, env.jobRoot, 'discard');
  assert.equal(existsSync(dirname(cwd)), false);
  assert.equal(git(originalWorktree, 'status', '--porcelain'), '');
  assert.equal(readFileSync(join(originalWorktree, 'result.md'), 'utf8'), 'edited\n');
  assert.equal(git(originalWorktree, 'show', 'main:result.md'), 'initial');
});

test('finish cannot remove an interrupted worker until its screen and lock are released', async (t) => {
  const env = fixture(t, { workspace: 'git', existingConfig: false });
  const job = await until(env.start('running hang'), (current) => current.status === 'agy-running');
  await assert.rejects(finish(job.jobDirectory, undefined, env.jobRoot, 'discard'), /Cannot finish/);
  assert.equal(existsSync(env.cwd), true);
  cancel(job.jobDirectory);
  assert.equal((await finished(job)).status, 'interrupted');
  await finish(job.jobDirectory, undefined, env.jobRoot, 'discard');
  assert.equal(existsSync(dirname(env.cwd)), false);
});

test('finish resumes a verified cleanup after the Git registration is gone', async (t) => {
  const env = fixture(t, { workspace: 'git', existingConfig: false });
  const { cwd, git, originalWorktree } = env;
  git(cwd, 'switch', '-c', 'feature/residue');
  const job = await reviewed(env.start('normal'));
  git(originalWorktree, 'worktree', 'lock', cwd);
  await assert.rejects(finish(job.jobDirectory, undefined, env.jobRoot), /locked/);
  git(originalWorktree, 'worktree', 'unlock', cwd);
  unlinkSync(join(cwd, '.git'));
  await assert.rejects(finish(job.jobDirectory, undefined, env.jobRoot), /still contains a registered Git worktree/);
  git(originalWorktree, 'worktree', 'prune', '--expire', 'now');
  symlinkSync(originalWorktree, join(cwd, 'original'), 'junction');
  symlinkSync(join(cwd, 'deleted-package'), join(cwd, 'missing'), 'junction');
  const newFile = join(cwd, 'new-local.txt');
  writeFileSync(newFile, 'keep newer work');
  await assert.rejects(finish(job.jobDirectory, undefined, env.jobRoot), /Unverified file remains/);
  assert.equal(readFileSync(newFile, 'utf8'), 'keep newer work');
  unlinkSync(newFile);
  assert.equal((await finish(job.jobDirectory, undefined, env.jobRoot)).removedBranch, 'feature/residue');
  assert.equal(existsSync(dirname(cwd)), false);
  assert.equal(readFileSync(join(originalWorktree, 'result.md'), 'utf8'), 'initial\n');
  assert.equal(git(originalWorktree, 'status', '--porcelain'), '');
});

test('finish preserves an unregistered worktree with no proof of integration', async (t) => {
  const env = fixture(t, { workspace: 'git', existingConfig: false });
  const job = await reviewed(env.start('normal'));
  unlinkSync(join(env.cwd, '.git'));
  env.git(env.originalWorktree, 'worktree', 'prune', '--expire', 'now');
  await assert.rejects(finish(job.jobDirectory, undefined, env.jobRoot, 'applied'), /Missing verified worker results/);
  assert.equal(readFileSync(join(env.cwd, 'result.md'), 'utf8'), 'initial\n');
});

test('finish retry preserves a task branch in use by another worktree', async (t) => {
  const env = fixture(t, { workspace: 'git', existingConfig: false });
  const { cwd, git, originalWorktree } = env;
  git(cwd, 'switch', '-c', 'feature/in-use');
  const job = await reviewed(env.start('normal'));
  git(originalWorktree, 'worktree', 'lock', cwd);
  await assert.rejects(finish(job.jobDirectory, undefined, env.jobRoot), /locked/);
  git(originalWorktree, 'worktree', 'unlock', cwd);
  unlinkSync(join(cwd, '.git'));
  git(originalWorktree, 'worktree', 'prune', '--expire', 'now');
  const other = join(env.directory, 'other workspace');
  git(originalWorktree, 'worktree', 'add', other, 'feature/in-use');
  assert.equal((await finish(job.jobDirectory, undefined, env.jobRoot)).retainedBranch, 'feature/in-use');
  assert.equal(git(other, 'branch', '--show-current'), 'feature/in-use');
  assert.equal(readFileSync(join(other, 'result.md'), 'utf8'), 'initial\n');
});

test('finish requires an unambiguous main branch and respects the recorded origin default', async (t) => {
  const env = fixture(t, { workspace: 'git', existingConfig: false });
  env.git(env.originalWorktree, 'branch', 'master');
  const job = await reviewed(env.start('normal'));
  await assert.rejects(finish(job.jobDirectory, undefined, env.jobRoot), /unique local main branch/);
  assert.equal(existsSync(env.cwd), true);
  env.git(env.originalWorktree, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/master');
  await finish(job.jobDirectory, undefined, env.jobRoot);
  assert.equal(existsSync(dirname(env.cwd)), false);
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

test('polling reads a completed Stop when file watching is unavailable', async (t) => {
  const env = fixture(t, {
    run(job, prompt, report, signal, controls) {
      return runFake(job, prompt, report, signal, {
        ...controls,
        watchEvents: () => { throw new Error('file watching unavailable'); },
      });
    },
  });
  const job = env.start('running hang');
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

test('quiet jobs keep their worker and lock until cancellation or a confirmed failed Stop', async (t) => {
  const env = fixture(t, { existingConfig: false });
  let job;
  for (const [message, expected, phase] of [
    ['wrong conversation', 'interrupted', 'agy-running'],
    ['failed', 'failed', 'agy-settling'],
    ['startup hang', 'interrupted', 'agy-starting'],
    ['running hang', 'interrupted', 'agy-running'],
    ['invalid idle flag', 'interrupted', 'agy-running'],
  ]) {
    job = job ? await env.follow(job, message) : env.start(message);
    if (expected === 'interrupted') {
      const quiet = await until(job, ({ health }) => health?.state === 'quiet');
      assert.equal(quiet.status, phase, message);
      assert.equal(quiet.health.process, 'alive', message);
      assert.equal(readFileSync(env.lock, 'utf8'), job.jobDirectory);
      cancel(job.jobDirectory);
    }
    const result = await finished(job);
    assert.equal(result.status, expected, message);
    assert.equal(result.phase, phase, message);
    assert.equal(existsSync(env.agents), false, message);
  }
});

test('the worker survives the old deadline and resumes health on both hook and transcript activity', async (t) => {
  const env = fixture(t, {
    run(job, prompt, report, signal, controls) {
      return runFake({ ...job, seconds: 1 }, prompt, report, signal, controls);
    },
  });
  const job = env.start('startup hang');
  const quiet = await until(job, ({ health }) => health?.state === 'quiet');
  assert.equal(quiet.status, 'agy-starting');
  assert.equal(quiet.health.process, 'alive');
  const transcriptPath = join(env.directory, 'transcript.jsonl');
  writeFileSync(transcriptPath, '{}\n');
  const payload = {
    conversationId: 'test-turn',
    lastUserInput: `[Codex worker job ${basename(job.jobDirectory)}]`,
    transcriptPath,
  };
  recordHook(job.jobDirectory, 'active', { ...payload, invocationNum: 0 });
  const active = await until(job, ({ health }) => health?.state === 'active' && health.transcriptReadable);
  assert.equal(active.transcriptPath, transcriptPath);
  assert.ok(active.health.lastHookAt);
  assert.ok(active.health.lastTranscriptChangeAt);

  const idle = await until(job, ({ health }) => health?.state === 'quiet');
  writeFileSync(transcriptPath, '{}\n{}\n');
  const resumed = await until(job, ({ health }) => health?.lastTranscriptChangeAt > idle.health.lastTranscriptChangeAt);
  assert.equal(resumed.health.state, 'active');
  assert.equal(resumed.health.lastHookAt, idle.health.lastHookAt);
  assert.equal(resumed.health.process, 'alive');

  await delay(1_100);
  const stillRunning = status(job.jobDirectory);
  assert.equal(stillRunning.status, 'agy-running');
  assert.equal(stillRunning.health.process, 'alive');
  assert.equal(readFileSync(env.lock, 'utf8'), job.jobDirectory);
  recordHook(job.jobDirectory, 'stop', { ...payload, fullyIdle: true, terminationReason: 'NO_TOOL_CALL' });
  assert.equal((await reviewed(job)).transcriptPath, transcriptPath);
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
  const first = await reviewed(env.start('normal'));
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
  const env = fixture(t, { workspace: 'temporary' });
  mkdirSync(env.jobRoot);
  const old = Date.now() - 25 * 60 * 60 * 1000;
  function savedJob({ terminal, cwd = env.directory, status = 'review-ready', closedAt = old, hasResult = true } = {}) {
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
  const pending = prepareWorkspace(env.jobRoot).cwd;
  const pendingFinish = savedJob({ cwd: pending });
  writeFileSync(join(dirname(pending), 'finish.json'), JSON.stringify({ head: 'a'.repeat(40), branch: 'refs/heads/feature/pending' }));
  rmdirSync(pending);

  env.start('normal', { launch() {} });

  assert.equal(existsSync(expired), false);
  assert.equal(existsSync(expiredFollowUp), false);
  for (const kept of [recent, open, active, recoveryTerminal, recovery, incompleteTerminal, incomplete, queued, locked, symlink, pendingFinish]) {
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
