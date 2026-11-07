import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { recordHook, runAgy, stopPosixTree } from './scripts/agy.mjs';
import { cancel, followUp, serve, start, status } from './scripts/worker.mjs';

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

function fixture(t, { existingConfig = true, run = runFake } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'codex-agy-test-'));
  const cwd = join(directory, 'work tree 한글');
  mkdirSync(cwd);
  const agents = join(cwd, '.agents');
  const config = join(agents, 'hooks.json');
  const lock = join(agents, '.codex-antigravity-worker.lock');
  const original = '{ "local": { "enabled": false } }\r\n';
  if (existingConfig) {
    mkdirSync(agents);
    writeFileSync(config, original);
  }
  const jobs = [];
  const terminals = new Map();
  const open = (terminal) => terminals.set(terminal, serve(terminal, run));
  const options = { timeout: '1', locateAgy: () => process.execPath, launch: open };
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
  t.after(async () => {
    for (const close of terminals.values()) close();
    for (const job of jobs) {
      if (terminals.has(job.terminalDirectory)) await finished(job);
    }
    for (const job of jobs) rmSync(job.jobDirectory, { recursive: true, force: true });
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    agents, config, lock, original, terminals, open,
    start: (message, overrides) => track(start(cwd, prompt(message), { ...options, ...overrides })),
    follow: async (job, message, overrides) => track(await followUp(job.jobDirectory, prompt(message), { ...options, ...overrides })),
  };
}

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
  const isolatedTemp = mkdtempSync(join(tmpdir(), 'codex-agy-queue-test-'));
  const tempVariable = process.platform === 'win32' ? 'TEMP' : 'TMPDIR';
  const previousTemp = process.env[tempVariable];
  try {
    process.env[tempVariable] = isolatedTemp;
    await assert.rejects(env.follow(pending, 'normal'), /Could not queue the job/);
    assert.deepEqual(readdirSync(isolatedTemp), []);
    assert.equal(readFileSync(request, 'utf8'), queued);
  } finally {
    if (previousTemp === undefined) delete process.env[tempVariable];
    else process.env[tempVariable] = previousTemp;
    rmSync(isolatedTemp, { recursive: true, force: true });
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
