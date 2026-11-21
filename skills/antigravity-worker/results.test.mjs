import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import process from 'node:process';
import { test } from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { git } from './scripts/workspace.mjs';

function fixture(t, kind, { contents = 'original', configureGit = () => {}, configureFolder = () => {},
  temporaryDirectory = realpathSync(tmpdir()), preloadFor = {},
} = {}) {
  const root = mkdtempSync(join(temporaryDirectory, 'agy-results-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const original = join(root, 'original');
  mkdirSync(original);
  const source = join(original, 'probe.txt');
  writeFileSync(source, contents);
  configureFolder(original);
  if (kind !== 'folder') {
    const hooks = join(root, 'empty-hooks');
    mkdirSync(hooks);
    git(original, ['init', '-b', 'main']);
    git(original, ['config', 'core.hooksPath', hooks]);
    git(original, ['config', 'user.name', 'Test']);
    git(original, ['config', 'user.email', 'test@example.invalid']);
    git(original, ['config', 'commit.gpgsign', 'false']);
    configureGit(original);
    git(original, ['add', '--all']);
    git(original, ['commit', '-m', 'Initial']);
  }
  const runner = fileURLToPath(new URL('./scripts/worker.mjs', import.meta.url));
  const invoke = (...args) => {
    const preload = preloadFor[args[0]];
    const nodeOptions = preload ? ['--import', `data:text/javascript,${encodeURIComponent(preload)}`] : [];
    const run = spawnSync(process.execPath, [...nodeOptions, runner, ...args], {
      cwd: root, env: { ...process.env, CODEX_HOME: root }, encoding: 'utf8', windowsHide: true, timeout: 20_000,
    });
    assert.ifError(run.error);
    assert.equal(run.signal, null);
    const events = run.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    return { code: run.status, events, result: events.at(-1) };
  };
  const prepared = invoke('prepare', ...(kind === 'copy' ? ['--copy'] : []), original);
  assert.equal(prepared.code, 0, JSON.stringify(prepared.result));
  const { job, cwd } = prepared.result;
  const statusPath = join(job, 'status.json');
  const setStatus = (status, fields = {}) => {
    const current = JSON.parse(readFileSync(statusPath, 'utf8'));
    writeFileSync(statusPath, JSON.stringify({ ...current, status, ...fields }));
  };
  const review = () => {
    const run = invoke('review', job);
    assert.equal(run.code, 0, JSON.stringify(run.result));
    return run.result.reviewId;
  };
  return { original, source, job, cwd, file: join(cwd, 'probe.txt'), setStatus, review, invoke };
}

function assertFinished(f, outcome, event) {
  assert.equal(outcome.code, 0, JSON.stringify(outcome.result));
  assert.equal(outcome.result.event, event);
  assert.equal(existsSync(f.job), false);
}

test('finish preserves additional worktrees and removes only the reviewed Git worktree', t => {
  const f = fixture(t, 'git');
  f.setStatus('review-ready');
  writeFileSync(f.file, 'reviewed');
  const id = f.review();
  const extra = join(f.job, 'extra');
  git(f.original, ['worktree', 'add', '--detach', '--', extra]);
  assert.match(f.invoke('finish', f.job, id, '--apply').result.message, /Additional Git worktrees/);
  assert.equal(readFileSync(f.source, 'utf8'), 'original');
  assert.equal(readFileSync(f.file, 'utf8'), 'reviewed');
  assert.ok(existsSync(extra));

  git(f.original, ['worktree', 'remove', '--', extra]);
  assertFinished(f, f.invoke('finish', f.job, id, '--apply'), 'applied');
  assert.equal(readFileSync(f.source, 'utf8'), 'reviewed');
  assert.equal(git(f.original, ['worktree', 'list', '--porcelain']).match(/^worktree /gm)?.length, 1);
});

test('finish preserves a new turn that completed before it locked the workspace', t => {
  const f = fixture(t, 'folder', { preloadFor: { finish: `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    import { dirname, join } from 'node:path';
    const write = fs.writeFileSync;
    fs.writeFileSync = (path, ...args) => {
      if (typeof path === 'string' && path.endsWith('operation.lock') && dirname(path) !== process.argv[3]) {
        const status = join(process.argv[3], 'status.json');
        const state = JSON.parse(fs.readFileSync(status, 'utf8'));
        write(status, JSON.stringify({ ...state, turn: 'new-turn' }));
      }
      return write(path, ...args);
    };
    syncBuiltinESMExports();
  ` } });
  f.setStatus('review-ready', { turn: 'reviewed-turn' });
  const id = f.review();
  const finish = f.invoke('finish', f.job, id, '--clean');
  assert.equal(finish.code, 1);
  assert.match(finish.result.message, /Job status changed/);
  assert.equal(f.invoke('status', f.job).result.turn, 'new-turn');
  assert.equal(existsSync(f.file), true);
});

test('an ACP prompt error permits review after a clean shutdown', t => {
  const f = fixture(t, 'folder', { preloadFor: { start: `
    import cp from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    const spawn = cp.spawn;
    cp.execFile = (_agy, args, _options, callback) => {
      if (args[0] !== '-p' || args[1] !== '/usage') throw new Error('Expected a quota lookup');
      queueMicrotask(() => callback(null, 'Gemini Models 95%'));
      return { stdin: { end() {} } };
    };
    cp.spawn = (_agy, _args, options) => spawn(process.execPath, ['--input-type=module', '-e', ${JSON.stringify(`
      import { createInterface } from 'node:readline';
      const input = createInterface({ input: process.stdin });
      input.on('line', line => {
        const { id, method } = JSON.parse(line);
        let reply;
        if (method === 'initialize') reply = { result: { protocolVersion: 1, agentCapabilities: { sessionCapabilities: { close: true } } } };
        if (method === 'session/new') reply = { result: { sessionId: 'test', configOptions: [
          { id: 'model', currentValue: 'gemini-4-hydrogen' }, { id: 'thought_level', currentValue: 'high' },
          { id: 'mode', currentValue: 'default' },
        ] } };
        if (method === 'session/prompt') reply = { error: { code: -32603, message: 'Model unavailable' } };
        if (method === 'session/close') reply = { result: {} };
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, ...reply }) + '\\n');
      });
    `)}], options);
    syncBuiltinESMExports();
  ` } });
  const prompt = join(f.job, 'prompt.txt');
  writeFileSync(prompt, 'Test a recoverable ACP error');
  const result = f.invoke('start', f.job, prompt);
  assert.equal(result.code, 1);
  assert.equal(result.result.event, 'failed');
  assert.match(result.result.error, /session\/prompt: Model unavailable/);
  assert.equal(result.result.workerPid, null);
  assert.equal(result.result.denied, 0);
  assert.match(result.result.quota.report, /95%/);
  assert.equal(result.events.filter(event => event.event === 'turn-quota').length, 1);
  assert.deepEqual(f.invoke('status', f.job).result.quota, result.result.quota);
  assertFinished(f, f.invoke('finish', f.job, f.review(), '--clean'), 'cleaned');
});

function mockSwarm(scenario) {
  const server = `
    import { spawn } from 'node:child_process';
    import { mkdirSync, writeFileSync } from 'node:fs';
    import { join } from 'node:path';
    import { createInterface } from 'node:readline';
    const scenario = ${JSON.stringify(scenario)};
    const profile = process.env.ANTIGRAVITY_GEMINI_DIR;
    const sessionId = 'test';
    let closeId;
    function complete() {
      const board = join(profile, 'antigravity-cli', 'brain', sessionId, '.system_generated', 'swarm');
      mkdirSync(board, { recursive: true });
      writeFileSync(join(board, 'board.jsonl'), JSON.stringify({
        seq: Number(process.argv[1]), agent: 'verifier', text: '@coordinator [done]',
      }) + '\\n');
    }
    const send = packet => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...packet }) + '\\n');
    const ask = () => send({ id: 'mock-denied', method: 'session/request_permission', params: {
      sessionId, toolCall: { title: 'Swarm write needs approval' },
    } });
    process.on('exit', () => writeFileSync(join(profile, 'mock-acp-exited'), ''));
    createInterface({ input: process.stdin }).on('line', line => {
      const { id, method } = JSON.parse(line);
      if (id === 'mock-denied') return closeId === undefined ? complete() : send({ id: closeId, result: {} });
      if (method === 'initialize') return send({ id, result: { protocolVersion: 1, agentCapabilities: {
        sessionCapabilities: { close: true, resume: true },
      } } });
      if (['session/new', 'session/resume'].includes(method)) return send({ id, result: { sessionId, configOptions: [
        { id: 'model', currentValue: 'gemini-4-hydrogen' }, { id: 'thought_level', currentValue: 'high' },
        { id: 'mode', currentValue: 'accept-edits' },
      ] } });
      if (method === 'session/prompt') {
        send({ id, result: { stopReason: 'end_turn' } });
        if (scenario === 'disconnected') setTimeout(() => process.exit(0), 50);
        else if (scenario === 'inherited-output') setTimeout(() => {
          spawn(process.execPath, ['-e', 'setTimeout(() => {}, 2500)'], {
            stdio: ['ignore', process.stdout, 'ignore'], windowsHide: true,
          }).unref();
          complete();
          process.exit(0);
        }, 50);
        else setTimeout(scenario === 'denied' ? ask : complete, 50);
      } else if (method === 'session/close') {
        send({ method: 'session/update', params: { sessionId, update: {
          sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'mock-command' }],
        } } });
        if (scenario === 'denied-at-close') {
          closeId = id;
          ask();
        } else send({ id, result: {} });
      }
    });
  `;
  return `
    import cp from 'node:child_process';
    import { existsSync, readFileSync, unlinkSync } from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    import { join } from 'node:path';
    const { spawn } = cp;
    const job = process.argv[3];
    const exited = join(job, 'gemini', 'mock-acp-exited');
    let reads = 0;
    cp.execFile = (_agy, args, _options, callback) => {
      if (args[0] !== '-p' || args[1] !== '/usage') throw new Error('Expected a quota lookup');
      const final = ++reads === 2;
      let error;
      if (final && !existsSync(exited)) error = Object.assign(new Error('ACP is still running'), { code: 3 });
      else if (final && JSON.parse(readFileSync(join(job, 'status.json'))).status !== 'running') {
        error = Object.assign(new Error('Terminal state was published before final quota'), { code: 4 });
      } else if (final && ${JSON.stringify(scenario)} === 'done' && !process.emit('SIGINT')) {
        error = Object.assign(new Error('SIGINT handler was removed before final quota'), { code: 5 });
      } else if (final && ${JSON.stringify(scenario)} === 'quota-error') {
        error = Object.assign(new Error('Mock quota error'), { code: 2 });
      }
      queueMicrotask(() => callback(error, final ? 'Gemini Models 80%' : 'Gemini Models 95%'));
      return { stdin: { end() {} } };
    };
    cp.spawn = (_agy, _args, options) => {
      if (existsSync(exited)) unlinkSync(exited);
      const sequence = process.argv[2] === 'follow-up' ? '2' : '1';
      return spawn(process.execPath, ['--input-type=module', '-e', ${JSON.stringify(server)}, sequence], options);
    };
    syncBuiltinESMExports();
  `;
}

function runSwarm(f, action = 'start') {
  const prompt = join(f.job, 'prompt.txt');
  const manifest = join(f.job, 'prompt-swarm.txt');
  writeFileSync(prompt, '/swarm Test the worker outcome');
  writeFileSync(manifest, JSON.stringify({ files: ['probe.txt'], verifier: 'verifier' }));
  return f.invoke(action, f.job, prompt, '--edit', '--swarm', manifest);
}

test('Swarm start and follow-up publish both quota readings and persist the final one', t => {
  const preload = mockSwarm('done');
  const f = fixture(t, 'folder', { preloadFor: { start: preload, 'follow-up': preload } });
  for (const action of ['start', 'follow-up']) {
    const { code, result, events } = runSwarm(f, action);
    assert.equal(code, 0, JSON.stringify(result));
    assert.equal(result.event, 'review-ready');
    assert.equal(result.swarmOutcome, 'done');
    assert.deepEqual(events.filter(event => ['turn-quota', 'swarm-post'].includes(event.event))
      .map(event => event.phase ?? event.event), ['coordinator', 'swarm-post', 'final']);
    const readings = events.filter(event => event.event === 'turn-quota');
    assert.match(readings[0].report, /95%/);
    assert.match(readings[1].report, /80%/);
    assert.equal(result.quota.phase, 'final');
    assert.equal(result.quota.checkedAt, readings[1].checkedAt);
    assert.deepEqual(f.invoke('status', f.job).result.quota, result.quota);
    assert.equal(result.commands[0].name, 'mock-command');
  }
  assertFinished(f, f.invoke('finish', f.job, f.review(), '--clean'), 'cleaned');
});

for (const scenario of ['denied', 'denied-at-close']) {
  test('Swarm records a post-response permission refusal: ' + scenario, t => {
    const f = fixture(t, 'folder', { preloadFor: { start: mockSwarm(scenario) } });
    const { code, result, events } = runSwarm(f);
    assert.equal(code, 1, JSON.stringify(result));
    assert.equal(result.event, 'permission-denied');
    assert.equal(result.denied, 1);
    assert.equal(events.filter(event => event.event === 'permission_denied').length, 1);
    assert.match(readFileSync(join(result.turn, 'events.jsonl'), 'utf8'), /"event":"permission_denied"/);
    assert.equal(result.quota.phase, 'final');
  });
}

for (const scenario of ['disconnected', 'inherited-output']) {
  test('Swarm stops waiting when ACP exits: ' + scenario, t => {
    const f = fixture(t, 'folder', { preloadFor: { start: mockSwarm(scenario) } });
    const { code, result, events } = runSwarm(f);
    assert.equal(code, 1, JSON.stringify(result));
    assert.equal(result.event, 'failed');
    assert.equal(result.swarmOutcome, 'disconnected');
    assert.match(result.error, /ACP disconnected while waiting for Swarm/);
    assert.equal(result.workerPid, null);
    assert.equal(result.quota.phase, 'final');
    assert.ok(events.some(event => event.event === 'swarm-waiting'));
  });
}

test('a failed final Swarm quota lookup preserves the turn outcome and replaces the first reading', t => {
  const f = fixture(t, 'folder', { preloadFor: { start: mockSwarm('quota-error') } });
  const { code, result } = runSwarm(f);
  assert.equal(code, 0, JSON.stringify(result));
  assert.equal(result.swarmOutcome, 'done');
  assert.deepEqual(result.quota, { phase: 'final', error: 'Antigravity quota lookup failed (2).' });
  assert.deepEqual(f.invoke('status', f.job).result.quota, result.quota);
});

test('a partial Swarm grant whose rollback fails keeps the job locked', t => {
  const f = fixture(t, 'folder', { preloadFor: { start: `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const { renameSync, unlinkSync } = fs;
    fs.renameSync = (source, target) => {
      if (target.endsWith('settings.json')) throw new Error('Mock grant failed');
      return renameSync(source, target);
    };
    fs.unlinkSync = path => {
      if (path.endsWith('config.json')) throw new Error('Mock rollback failed');
      return unlinkSync(path);
    };
    syncBuiltinESMExports();
  ` } });
  const { code, result } = runSwarm(f);
  assert.equal(code, 1, JSON.stringify(result));
  assert.equal(result.event, 'cleanup-needed');
  assert.match(result.error, /Mock grant failed.*Swarm permission cleanup failed.*Mock rollback failed/);
  assert.equal(result.quota, null);
  assert.equal(f.invoke('status', f.job).result.event, 'cleanup-needed');
  assert.ok(existsSync(join(dirname(f.cwd), 'operation.lock')));
  assert.match(readFileSync(join(f.job, 'gemini', 'config', 'config.json'), 'utf8'), /\/probe\.txt\)/);
  assert.equal(runSwarm(f).result.event, 'error');
});

test('Windows Git worktrees can prepare and clean under a short path alias',
  { skip: process.platform !== 'win32' }, t => {
    const parent = mkdtempSync(join(realpathSync(tmpdir()), 'agy-long-temp-directory-'));
    t.after(() => rmSync(parent, { recursive: true, force: true }));
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '(New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:AGY_TEST_LONG_PATH).ShortPath'],
    { encoding: 'utf8', windowsHide: true, env: { ...process.env, AGY_TEST_LONG_PATH: parent } });
    assert.equal(result.status, 0, result.stderr);
    const alias = result.stdout.trim();
    if (!alias || alias.toLowerCase() === parent.toLowerCase()) return t.skip('No Windows short path alias available');
    assert.equal(realpathSync.native(alias), realpathSync.native(parent));
    const f = fixture(t, 'git', { temporaryDirectory: alias });
    f.setStatus('review-ready');
    writeFileSync(f.file, 'reviewed');
    assertFinished(f, f.invoke('finish', f.job, f.review(), '--apply'), 'applied');
    assert.equal(readFileSync(f.source, 'utf8'), 'reviewed');
    assert.equal(git(f.original, ['worktree', 'list', '--porcelain']).match(/^worktree /gm)?.length, 1);
  });

test('apply succeeds before preserving a separate unreviewed artifact', t => {
  const f = fixture(t, 'folder');
  f.setStatus('review-ready');
  writeFileSync(f.file, 'reviewed');
  const id = f.review();
  const artifact = join(f.job, 'result.zip');
  writeFileSync(artifact, 'preserve');
  const pending = f.invoke('finish', f.job, id, '--apply');
  assert.equal(pending.events[0].event, 'cleanup-pending');
  assert.equal(readFileSync(f.source, 'utf8'), 'reviewed');
  assert.equal(readFileSync(artifact, 'utf8'), 'preserve');
  rmSync(artifact);
  assertFinished(f, f.invoke('finish', f.job, id, '--apply'), 'applied');
});

for (const kind of ['git', 'folder', 'copy']) {
  test(`${kind}: keep preserves the session and apply verifies the original and removes the job`, t => {
    const f = fixture(t, kind);
    f.setStatus('review-ready');
    writeFileSync(f.file, 'reviewed');
    const id = f.review();
    const kept = f.invoke('finish', f.job, id, '--keep');
    assert.equal(kept.code, 0);
    assert.equal(kept.result.event, 'kept');
    assert.equal(readFileSync(f.file, 'utf8'), 'reviewed');
    assert.equal(readFileSync(f.source, 'utf8'), 'original');
    assertFinished(f, f.invoke('finish', f.job, id, '--apply'), 'applied');
    assert.equal(readFileSync(f.source, 'utf8'), 'reviewed');
    if (kind !== 'folder') assert.equal(git(f.original, ['worktree', 'list', '--porcelain']).match(/^worktree /gm)?.length, 1);
  });
}

test('a formerly conflicting result can be cleaned after it is committed in the original', t => {
  const f = fixture(t, 'git');
  f.setStatus('review-ready');
  writeFileSync(f.file, 'reviewed');
  const id = f.review();
  writeFileSync(f.source, 'conflict');
  assert.match(f.invoke('finish', f.job, id, '--apply').result.message, /conflicting changes/);
  assert.equal(readFileSync(f.source, 'utf8'), 'conflict');
  assert.equal(readFileSync(f.file, 'utf8'), 'reviewed');
  writeFileSync(f.source, 'reviewed');
  git(f.original, ['commit', '-am', 'Resolve conflict']);
  assertFinished(f, f.invoke('finish', f.job, id, '--apply'), 'applied');
  assert.equal(readFileSync(f.source, 'utf8'), 'reviewed');
});

test('the same approval can retry cleanup after an applied worktree is unlocked', t => {
  const f = fixture(t, 'git');
  f.setStatus('review-ready');
  writeFileSync(f.file, 'reviewed');
  const id = f.review();
  git(f.original, ['worktree', 'lock', '--', f.cwd]);
  const pending = f.invoke('finish', f.job, id, '--apply');
  assert.equal(pending.code, 1);
  assert.equal(pending.events[0].event, 'cleanup-pending');
  assert.equal(readFileSync(f.source, 'utf8'), 'reviewed');
  assert.equal(existsSync(f.cwd), true);
  git(f.original, ['worktree', 'unlock', '--', f.cwd]);
  assertFinished(f, f.invoke('finish', f.job, id, '--apply'), 'applied');
});

test('the same approval resumes job cleanup after interruption removed the status record', t => {
  const f = fixture(t, 'folder', { preloadFor: { finish: `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    import { join } from 'node:path';
    const remove = fs.rmSync;
    fs.rmSync = (path, ...args) => {
      const interrupt = path === join(process.argv[3], 'status.json') && fs.existsSync(path);
      remove(path, ...args);
      if (interrupt) process.exit(73);
    };
    syncBuiltinESMExports();
  ` } });
  f.setStatus('review-ready');
  writeFileSync(f.file, 'reviewed');
  const id = f.review();
  assert.equal(f.invoke('finish', f.job, id, '--apply').code, 73);
  assert.equal(existsSync(join(f.job, 'status.json')), false);
  assert.equal(existsSync(join(f.job, 'operation.lock')), true);
  assert.equal(readFileSync(f.source, 'utf8'), 'reviewed');
  assert.equal(f.invoke('status', f.job).result?.event, 'cleanup-pending');
  assert.match(f.invoke('finish', f.job, 'wrong-review', '--apply').result.message, /original review and decision/);
  assert.match(f.invoke('finish', f.job, id, '--keep').result.message, /original review and decision/);

  const artifact = join(f.job, 'late-output.zip');
  writeFileSync(artifact, 'preserve');
  assert.match(f.invoke('finish', f.job, id, '--apply').result.message, /Unreviewed job entry remains/);
  assert.equal(readFileSync(artifact, 'utf8'), 'preserve');
  unlinkSync(artifact);
  writeFileSync(f.source, 'edited after apply');
  assertFinished(f, f.invoke('finish', f.job, id, '--apply'), 'applied');
  assert.equal(readFileSync(f.source, 'utf8'), 'edited after apply');
});

test('the same clean decision completes after interruption removed the job directory', t => {
  const f = fixture(t, 'folder', { preloadFor: { finish: `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const remove = fs.rmdirSync;
    fs.rmdirSync = (path, ...args) => {
      remove(path, ...args);
      if (path === process.argv[3]) process.exit(73);
    };
    syncBuiltinESMExports();
  ` } });
  f.setStatus('review-ready');
  const id = f.review();
  const replacement = mkdtempSync(join(dirname(f.job), 'replacement-'));
  writeFileSync(join(replacement, 'prompt.txt'), 'owned by a different job');
  assert.equal(f.invoke('finish', f.job, id, '--clean').code, 73);
  assert.equal(existsSync(f.job), false);

  renameSync(replacement, f.job);
  assert.match(f.invoke('finish', f.job, id, '--clean').result.message, /job folder was replaced/);
  assert.equal(readFileSync(join(f.job, 'prompt.txt'), 'utf8'), 'owned by a different job');
  renameSync(f.job, replacement);
  assertFinished(f, f.invoke('finish', f.job, id, '--clean'), 'cleaned');
  assert.equal(existsSync(f.job + '.cleanup.json'), false);
  assert.equal(readFileSync(f.source, 'utf8'), 'original');
});

for (const kind of ['folder', 'git']) {
  test(`${kind}: finish resumes after workspace removal and before cleanup receipt publication`, t => {
    const f = fixture(t, kind, { preloadFor: { finish: `
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      import { join, dirname } from 'node:path';
      const marker = join(dirname(process.argv[3]), 'interrupted');
      const interrupt = path => {
        if (path === process.argv[3] + '.cleanup.json' && !fs.existsSync(marker)) {
          fs.writeFileSync(marker, '');
          process.exit(73);
        }
      };
      const link = fs.linkSync;
      const rename = fs.renameSync;
      fs.linkSync = (source, target) => { interrupt(target); link(source, target); };
      fs.renameSync = (source, target) => { interrupt(target); rename(source, target); };
      syncBuiltinESMExports();
    ` } });
    f.setStatus('review-ready');
    writeFileSync(f.file, 'reviewed');
    const id = f.review();
    assert.equal(f.invoke('finish', f.job, id, '--apply').code, 73);
    assert.equal(existsSync(f.cwd), false);
    assert.equal(existsSync(f.job + '.cleanup.json'), false);
    assert.equal(existsSync(join(f.job, 'operation.lock')), true);
    assert.equal(readFileSync(f.source, 'utf8'), 'reviewed');
    assert.match(f.invoke('finish', f.job, 'wrong-review', '--apply').result.message, /original review and decision/);

    if (kind === 'folder') {
      writeFileSync(f.source, 'edited after apply');
    } else {
      const path = join(f.job, 'finalized.json');
      const finalized = JSON.parse(readFileSync(path, 'utf8'));
      delete finalized.cleanupStarted;
      writeFileSync(path, JSON.stringify(finalized));
      writeFileSync(f.source, 'edited after apply');
      assert.match(f.invoke('finish', f.job, id, '--apply').result.message, /Original result differs/);
      writeFileSync(f.source, 'reviewed');
    }
    assertFinished(f, f.invoke('finish', f.job, id, '--apply'), 'applied');
    assert.equal(readFileSync(f.source, 'utf8'), kind === 'folder' ? 'edited after apply' : 'reviewed');
    assert.ok(!readdirSync(dirname(f.job)).some(name => name.startsWith(basename(f.job))));
  });
}

test('file-only preparation retains regular and executable modes under a restrictive umask', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t, 'copy', {
    preloadFor: { prepare: 'process.umask(0o077);' },
    configureFolder(original) {
      chmodSync(join(original, 'probe.txt'), 0o644);
      const executable = join(original, 'script');
      writeFileSync(executable, 'original script');
      chmodSync(executable, 0o755);
    },
  });
  assert.equal(lstatSync(f.file).mode & 0o777, 0o644);
  assert.equal(lstatSync(join(f.cwd, 'script')).mode & 0o777, 0o755);
  f.setStatus('review-ready');
  writeFileSync(f.file, 'reviewed');
  assertFinished(f, f.invoke('finish', f.job, f.review(), '--apply'), 'applied');
  assert.equal(readFileSync(f.source, 'utf8'), 'reviewed');
  assert.equal(lstatSync(f.source).mode & 0o777, 0o644);
});

test('an empty stopped job can be cleaned without applying or verifying the original', t => {
  const f = fixture(t, 'folder');
  f.setStatus('failed');
  const id = f.review();
  rmSync(f.source);
  assertFinished(f, f.invoke('finish', f.job, id, '--clean'), 'cleaned');
  assert.equal(existsSync(f.source), false);
});

test('a successful Git job without file changes removes the worktree registration', t => {
  const f = fixture(t, 'git');
  f.setStatus('review-ready');
  assertFinished(f, f.invoke('finish', f.job, f.review(), '--clean'), 'cleaned');
  assert.equal(readFileSync(f.source, 'utf8'), 'original');
  assert.equal(git(f.original, ['worktree', 'list', '--porcelain']).match(/^worktree /gm)?.length, 1);
});

test('apply preserves the worker if the original is on a different branch', t => {
  const f = fixture(t, 'git');
  f.setStatus('review-ready');
  writeFileSync(f.file, 'reviewed');
  const id = f.review();
  git(f.original, ['switch', '-c', 'different']);
  writeFileSync(f.source, 'reviewed');
  assert.match(f.invoke('finish', f.job, id, '--apply').result.message, /original Git branch or commit changed/);
  assert.equal(existsSync(f.cwd), true);
});

for (const [reason, change, expected] of [
  ['unconfirmed exit', f => f.setStatus('cleanup-needed'), /Confirm the worker has stopped/],
  ['unreviewed files', f => writeFileSync(join(f.cwd, 'new-output.txt'), 'artifact'), /Worker files changed after review/],
  ['unreviewed job output', f => writeFileSync(join(f.job, 'result.zip'), 'artifact'), /Unreviewed job entry remains/],
  ['a sibling file beside the workspace', f => writeFileSync(join(dirname(f.cwd), 'result.txt'), 'artifact'), /Additional workspace entries/],
  ['recovery backup', f => mkdirSync(join(f.job, 'apply-backup-test')), /recovery backup remains/],
  ['staged Git changes', f => {
    writeFileSync(f.file, 'staged');
    git(f.cwd, ['add', 'probe.txt']);
    writeFileSync(f.file, 'original');
  }, /staged changes require inspection/],
]) {
  test(`cleanup preserves the job with ${reason}`, t => {
    const f = fixture(t, reason === 'staged Git changes' ? 'git' : 'folder');
    f.setStatus('review-ready');
    const id = f.review();
    change(f);
    const outcome = f.invoke('finish', f.job, id, '--clean');
    assert.equal(outcome.code, 1);
    assert.match(outcome.result.message, expected);
    assert.equal(existsSync(f.cwd), true);
    assert.equal(readFileSync(f.source, 'utf8'), 'original');
  });
}

test('a reviewed artifact blocks clean and remains available for follow-up', t => {
  const f = fixture(t, 'folder');
  f.setStatus('permission-denied');
  writeFileSync(f.file, 'partial result');
  const id = f.review();
  assert.match(f.invoke('finish', f.job, id, '--clean').result.message, /Worker changes remain/);
  assert.equal(readFileSync(f.file, 'utf8'), 'partial result');
});

test('clean removes the prompts and logs from a completed turn', t => {
  const f = fixture(t, 'folder');
  const turn = mkdtempSync(join(f.job, 'turn-'));
  f.setStatus('review-ready', { turn });
  writeFileSync(join(f.job, 'prompt-2.txt'), 'Prompt');
  writeFileSync(join(turn, 'response.txt'), 'Result delivered to the user');
  writeFileSync(join(turn, 'events.jsonl'), '');
  const id = f.review();
  const extra = join(turn, 'custom-output.txt');
  writeFileSync(extra, 'Keep this');
  assert.match(f.invoke('finish', f.job, id, '--clean').result.message, /Unreviewed job entry remains/);
  assert.equal(readFileSync(extra, 'utf8'), 'Keep this');
  rmSync(extra);
  assertFinished(f, f.invoke('finish', f.job, id, '--clean'), 'cleaned');
});

test('copy can apply edits to a CRLF checkout of a committed text file', t => {
  const f = fixture(t, 'copy', {
    contents: 'original\r\n', configureGit: original => git(original, ['config', 'core.autocrlf', 'true']),
  });
  assert.equal(git(f.original, ['show', 'HEAD:probe.txt']), 'original\n');
  assert.equal(readFileSync(f.file, 'utf8'), 'original\r\n');
  f.setStatus('review-ready');
  writeFileSync(f.file, 'reviewed\r\n');
  assertFinished(f, f.invoke('finish', f.job, f.review(), '--apply'), 'applied');
  assert.equal(readFileSync(f.source, 'utf8'), 'reviewed\r\n');
});

test('file-only prepare uses the commit when the original checkout cannot be searched',
  { skip: process.platform === 'win32' || process.getuid?.() === 0 }, t => {
    const f = fixture(t, 'copy', { configureFolder(root) {
      mkdirSync(join(root, 'data'));
      writeFileSync(join(root, 'data', 'tracked.txt'), 'committed\n');
    } });
    const data = join(f.original, 'data');
    chmodSync(data, 0o600);
    try {
      const prepared = f.invoke('prepare', '--copy', f.original);
      assert.equal(prepared.code, 0, JSON.stringify(prepared.result));
      assert.equal(readFileSync(join(prepared.result.cwd, 'data', 'tracked.txt'), 'utf8'), 'committed\n');
    } finally {
      chmodSync(data, 0o700);
    }
  });

test('apply preserves a reviewed result when the original directory cannot be listed',
  { skip: process.platform === 'win32' || process.getuid?.() === 0 }, t => {
    const f = fixture(t, 'git', { configureFolder(root) {
      mkdirSync(join(root, 'data'));
      writeFileSync(join(root, 'data', 'tracked.txt'), 'original');
    } });
    writeFileSync(join(f.cwd, 'data', 'tracked.txt'), 'reviewed');
    f.setStatus('review-ready');
    const id = f.review();
    const data = join(f.original, 'data');
    chmodSync(data, 0o300);
    try {
      assert.match(f.invoke('finish', f.job, id, '--apply').result.message, /EACCES/);
      assert.equal(readFileSync(join(data, 'tracked.txt'), 'utf8'), 'original');
      assert.equal(readFileSync(join(f.cwd, 'data', 'tracked.txt'), 'utf8'), 'reviewed');
    } finally {
      chmodSync(data, 0o700);
    }
    assertFinished(f, f.invoke('finish', f.job, id, '--apply'), 'applied');
    assert.equal(readFileSync(join(data, 'tracked.txt'), 'utf8'), 'reviewed');
  });

test('apply preserves a rename that changes only the case of a path', t => {
  const f = fixture(t, 'folder');
  f.setStatus('review-ready');
  renameSync(f.file, join(f.cwd, 'rename.tmp'));
  renameSync(join(f.cwd, 'rename.tmp'), join(f.cwd, 'Probe.txt'));
  assertFinished(f, f.invoke('finish', f.job, f.review(), '--apply'), 'applied');
  assert.deepEqual(readdirSync(f.original), ['Probe.txt']);
  assert.equal(readFileSync(join(f.original, 'Probe.txt'), 'utf8'), 'original');
});

test('identical reviews retain approval while changed results require a new review', t => {
  const f = fixture(t, 'folder');
  f.setStatus('review-ready');
  writeFileSync(f.file, 'reviewed');
  const id = f.review();
  assert.equal(f.review(), id);
  writeFileSync(f.file, 'changed');
  const newId = f.review();
  assert.notEqual(newId, id);
  assert.match(f.invoke('finish', f.job, id, '--apply').result.message, /Review is stale/);
  assertFinished(f, f.invoke('finish', f.job, newId, '--apply'), 'applied');
});

test('discard can remove a completed result while preserving the original and recovery backups', t => {
  const f = fixture(t, 'folder');
  f.setStatus('review-ready');
  writeFileSync(f.file, 'unapplied');
  const recovery = join(f.job, 'apply-backup-test');
  mkdirSync(recovery);
  assert.match(f.invoke('discard', f.job).result.message, /recovery backup remains/);
  assert.equal(readFileSync(f.file, 'utf8'), 'unapplied');
  rmSync(recovery, { recursive: true });
  assertFinished(f, f.invoke('discard', f.job), 'discarded');
  assert.equal(readFileSync(f.source, 'utf8'), 'original');
});

test('a cleanup retry preserves a replacement directory with the same cleanup name', t => {
  const f = fixture(t, 'folder');
  f.setStatus('review-ready');
  writeFileSync(f.file, 'reviewed');
  const id = f.review();
  const extra = join(f.job, 'result.zip');
  writeFileSync(extra, 'preserve');
  assert.equal(f.invoke('finish', f.job, id, '--apply').events[0].event, 'cleanup-pending');
  rmSync(extra);
  renameSync(f.cwd, join(f.original, 'saved-worker'));
  const replacement = join(dirname(f.cwd), 'cleanup-work');
  mkdirSync(replacement);
  writeFileSync(join(replacement, 'other.txt'), 'untouched');
  assert.match(f.invoke('finish', f.job, id, '--apply').result.message, /identity changed/);
  assert.equal(readFileSync(join(replacement, 'other.txt'), 'utf8'), 'untouched');
});

for (const recreateWorkspace of [false, true]) {
  test(`finish preserves an artifact created during workspace removal (replacement workspace: ${recreateWorkspace})`, t => {
    const f = fixture(t, 'folder', { preloadFor: { finish: `
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      import { basename, dirname, join } from 'node:path';
      const remove = fs.rmSync;
      fs.rmSync = (path, ...args) => {
        const result = remove(path, ...args);
        if (basename(path) === 'cleanup-work') {
          const directory = ${recreateWorkspace} ? join(dirname(path), 'work') : process.argv[3];
          if (${recreateWorkspace}) fs.mkdirSync(directory);
          fs.writeFileSync(join(directory, 'late.txt'), 'preserve');
        }
        return result;
      };
      syncBuiltinESMExports();
    ` } });
    writeFileSync(f.file, 'reviewed');
    f.setStatus('review-ready');
    const id = f.review();
    const result = f.invoke('finish', f.job, id, '--apply');
    const message = recreateWorkspace ? /Additional workspace entries/ : /Unreviewed job entry remains: late.txt/;
    assert.match(result.result.message ?? '', message);
    assert.equal(readFileSync(f.source, 'utf8'), 'reviewed');
    const late = join(recreateWorkspace ? f.cwd : f.job, 'late.txt');
    assert.equal(readFileSync(late, 'utf8'), 'preserve');
    unlinkSync(late);
    if (recreateWorkspace) rmdirSync(f.cwd);
    assertFinished(f, f.invoke('finish', f.job, id, '--apply'), 'applied');
  });
}

test('a cleanup retry preserves unreviewed files after partial removal of a copy', t => {
  const f = fixture(t, 'folder', { preloadFor: { finish: `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    import { basename, join } from 'node:path';
    const remove = fs.rmSync;
    fs.rmSync = (path, ...args) => {
      if (basename(path) === 'cleanup-work' && fs.existsSync(join(path, 'probe.txt'))) {
        fs.unlinkSync(join(path, 'probe.txt'));
        throw new Error('Simulated partial workspace removal');
      }
      return remove(path, ...args);
    };
    syncBuiltinESMExports();
  ` }, configureFolder(root) {
    const data = join(root, 'data');
    mkdirSync(data);
    writeFileSync(join(data, 'original.txt'), 'retain until cleanup');
    if (process.platform !== 'win32') chmodSync(data, 0o555);
  } });
  if (process.platform !== 'win32') chmodSync(join(f.original, 'data'), 0o755);
  writeFileSync(f.file, 'reviewed');
  f.setStatus('review-ready');
  const id = f.review();
  assert.match(f.invoke('finish', f.job, id, '--apply').result.message, /Simulated partial workspace removal/);
  const cleanup = join(dirname(f.cwd), 'cleanup-work');
  const unknown = join(cleanup, 'new.txt');
  writeFileSync(unknown, 'unreviewed');
  const result = f.invoke('finish', f.job, id, '--apply');
  assert.match(result.result.message ?? '', /Unreviewed file remains in cleanup workspace/);
  assert.equal(readFileSync(unknown, 'utf8'), 'unreviewed');
  assert.equal(existsSync(join(cleanup, 'probe.txt')), false);
  assert.equal(readFileSync(f.source, 'utf8'), 'reviewed');
  unlinkSync(unknown);
  assertFinished(f, f.invoke('finish', f.job, id, '--apply'), 'applied');
});

test('copy and apply retain POSIX directory permissions', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t, 'folder', { configureFolder(root) {
    mkdirSync(join(root, 'data'));
    chmodSync(join(root, 'data'), 0o1555);
  } });
  const data = join(f.cwd, 'data');
  assert.equal(lstatSync(data).mode & 0o7777, 0o1555);
  chmodSync(data, 0o1750);
  writeFileSync(join(data, 'result.txt'), 'preserved');
  f.setStatus('review-ready');
  assertFinished(f, f.invoke('finish', f.job, f.review(), '--apply'), 'applied');
  assert.equal(lstatSync(join(f.original, 'data')).mode & 0o7777, 0o1750);
  assert.equal(readFileSync(join(f.original, 'data', 'result.txt'), 'utf8'), 'preserved');
});

test('apply can remove a reviewed read-only POSIX subtree', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t, 'folder', { configureFolder(root) {
    const data = join(root, 'data');
    mkdirSync(data);
    writeFileSync(join(data, 'old.txt'), 'old');
    chmodSync(data, 0o555);
  } });
  const workerData = join(f.cwd, 'data');
  chmodSync(workerData, 0o755);
  rmSync(workerData, { recursive: true });
  f.setStatus('review-ready');
  assertFinished(f, f.invoke('finish', f.job, f.review(), '--apply'), 'applied');
  assert.equal(existsSync(join(f.original, 'data')), false);
});

for (const kind of ['git', 'copy']) {
  test(`${kind}: apply ignores the original checkout's untracked POSIX directory mode`,
    { skip: process.platform === 'win32' }, t => {
      const f = fixture(t, kind, { configureFolder(root) {
        const data = join(root, 'data');
        mkdirSync(data);
        writeFileSync(join(data, 'old.txt'), 'old');
        chmodSync(data, 0o750);
      } });
      const workerData = join(f.cwd, 'data');
      chmodSync(workerData, 0o755);
      renameSync(workerData, join(f.cwd, 'moved'));
      f.setStatus('review-ready');
      assertFinished(f, f.invoke('finish', f.job, f.review(), '--apply'), 'applied');
      assert.equal(existsSync(join(f.original, 'data')), false);
      assert.equal(readFileSync(join(f.original, 'moved', 'old.txt'), 'utf8'), 'old');
    });
}

function linkFixture(t, { chained = false, preloadFor } = {}) {
  let canLink = false;
  const f = fixture(t, 'folder', { preloadFor, configureFolder(root) {
    for (const folder of ['first', 'second']) {
      mkdirSync(join(root, folder));
      writeFileSync(join(root, folder, 'note.txt'), folder);
    }
    try {
      symlinkSync('first', join(root, 'bridge'), 'dir');
      if (chained) symlinkSync('bridge', join(root, 'outer'), 'dir');
      canLink = true;
    } catch (error) {
      if (process.platform !== 'win32' || error.code !== 'EPERM' || process.env.GITHUB_ACTIONS === 'true') throw error;
    }
  } });
  if (!canLink) {
    t.skip('Windows symlink permission is unavailable');
    return null;
  }
  return f;
}

test('apply keeps an edited relative directory link usable after cleanup', t => {
  const f = linkFixture(t);
  if (!f) return;
  unlinkSync(join(f.cwd, 'bridge'));
  symlinkSync('second', join(f.cwd, 'bridge'), 'dir');
  f.setStatus('review-ready');
  assertFinished(f, f.invoke('finish', f.job, f.review(), '--apply'), 'applied');
  assert.ok(lstatSync(join(f.original, 'bridge')).isSymbolicLink());
  assert.equal(readFileSync(join(f.original, 'bridge', 'note.txt'), 'utf8'), 'second');
});

test('apply preserves a new link if the corresponding original link now resolves elsewhere', t => {
  const f = linkFixture(t);
  if (!f) return;
  unlinkSync(join(f.original, 'bridge'));
  symlinkSync('second', join(f.original, 'bridge'), 'dir');
  symlinkSync('bridge/note.txt', join(f.cwd, 'alias.txt'), 'file');
  f.setStatus('review-ready');
  assert.match(f.invoke('finish', f.job, f.review(), '--apply').result.message, /different target/);
  assert.equal(existsSync(join(f.original, 'alias.txt')), false);
  assert.equal(readFileSync(join(f.cwd, 'alias.txt'), 'utf8'), 'first');
});

test('apply checks parent traversal after following an intermediate POSIX symlink',
  { skip: process.platform === 'win32' }, t => {
    const f = fixture(t, 'folder', { configureFolder(root) {
      for (const name of ['first', 'second']) {
        mkdirSync(join(root, name, 'sub'), { recursive: true });
        writeFileSync(join(root, name, 'probe.txt'), name);
      }
      symlinkSync('first/sub', join(root, 'jump'), 'dir');
    } });
    unlinkSync(join(f.original, 'jump'));
    symlinkSync('second/sub', join(f.original, 'jump'), 'dir');
    symlinkSync('jump/../probe.txt', join(f.cwd, 'alias.txt'), 'file');
    f.setStatus('review-ready');
    assert.equal(readFileSync(join(f.cwd, 'alias.txt'), 'utf8'), 'first');
    assert.match(f.invoke('finish', f.job, f.review(), '--apply').result.message ?? '', /different target/);
    assert.equal(existsSync(join(f.original, 'alias.txt')), false);
    assert.equal(readFileSync(join(f.cwd, 'alias.txt'), 'utf8'), 'first');
  });

test('prepare detects links that resolve outside the original after following a POSIX symlink',
  { skip: process.platform === 'win32' }, t => {
    const f = fixture(t, 'folder');
    writeFileSync(join(dirname(f.original), 'probe.txt'), 'outside');
    symlinkSync('.', join(f.original, 'jump'), 'dir');
    symlinkSync('jump/../probe.txt', join(f.original, 'alias.txt'), 'file');
    assert.equal(readFileSync(join(f.original, 'alias.txt'), 'utf8'), 'outside');
    assert.match(f.invoke('prepare', f.original).result.message, /resolves outside the movable workspace/);
  });

test('apply preserves a link that indirectly resolves to a temporary job file', t => {
  const f = linkFixture(t);
  if (!f) return;
  const prompt = join(f.job, 'prompt.txt');
  const outsideLink = join(dirname(f.original), 'outside.txt');
  writeFileSync(prompt, 'temporary');
  const caseAlias = join(dirname(f.job), basename(f.job).toUpperCase(), 'prompt.txt');
  symlinkSync(existsSync(caseAlias) ? caseAlias : prompt, outsideLink, 'file');
  symlinkSync(outsideLink, join(f.cwd, 'alias.txt'), 'file');
  f.setStatus('review-ready');

  const result = f.invoke('finish', f.job, f.review(), '--apply');
  assert.match(result.result.message, /resolves into the temporary job/);
  assert.equal(existsSync(join(f.original, 'alias.txt')), false);
  assert.equal(readFileSync(join(f.cwd, 'alias.txt'), 'utf8'), 'temporary');
});

test('a cleanup retry rechecks applied link targets after the worker folder was moved', t => {
  const preloadFor = { finish: `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    import { basename, dirname, join } from 'node:path';
    const remove = fs.rmSync;
    fs.rmSync = (path, ...args) => {
      if (basename(path) === 'cleanup-work' && fs.existsSync(join(dirname(process.argv[3]), 'block-cleanup'))) {
        throw new Error('Simulated interruption after moving the workspace');
      }
      return remove(path, ...args);
    };
    syncBuiltinESMExports();
  ` };
  const f = linkFixture(t, { preloadFor });
  if (!f) return;
  const block = join(dirname(f.job), 'block-cleanup');
  const bridge = join(f.original, 'bridge');
  const cleanup = join(dirname(f.cwd), 'cleanup-work');
  symlinkSync('bridge/note.txt', join(f.cwd, 'alias.txt'), 'file');
  f.setStatus('review-ready');
  const id = f.review();
  writeFileSync(block, '');
  assert.match(f.invoke('finish', f.job, id, '--apply').result.message, /Simulated interruption/);
  unlinkSync(block);
  assert.equal(existsSync(f.cwd), false);
  assert.equal(existsSync(cleanup), true);
  unlinkSync(bridge);
  symlinkSync('second', bridge, 'dir');
  assert.match(f.invoke('finish', f.job, id, '--apply').result.message, /different target/);
  assert.equal(existsSync(cleanup), true);
  unlinkSync(bridge);
  symlinkSync('first', bridge, 'dir');
  assertFinished(f, f.invoke('finish', f.job, id, '--apply'), 'applied');
  assert.equal(readFileSync(join(f.original, 'alias.txt'), 'utf8'), 'first');
});

for (const recreate of [false, true]) {
  test(`apply preserves the original when a Windows link target changes type (recreated: ${recreate})`,
    { skip: process.platform !== 'win32' }, t => {
      const f = linkFixture(t);
      if (!f) return;
      const data = join(f.cwd, 'first');
      rmSync(data, { recursive: true });
      writeFileSync(data, 'worker file');
      if (recreate) {
        unlinkSync(join(f.cwd, 'bridge'));
        symlinkSync('first', join(f.cwd, 'bridge'), 'file');
      }
      f.setStatus('review-ready');
      const outcome = f.invoke('finish', f.job, f.review(), '--apply');
      assert.equal(outcome.code, 1);
      assert.match(outcome.result.message, /Windows link target type changed/);
      assert.equal(readFileSync(join(f.original, 'bridge', 'note.txt'), 'utf8'), 'first');
      assert.equal(readFileSync(data, 'utf8'), 'worker file');
    });
}

test('apply preserves a Windows directory link when its intermediate link is retargeted to a file',
  { skip: process.platform !== 'win32' }, t => {
    const f = linkFixture(t, { chained: true });
    if (!f) return;
    unlinkSync(join(f.cwd, 'bridge'));
    symlinkSync('probe.txt', join(f.cwd, 'bridge'), 'file');
    f.setStatus('review-ready');
    const outcome = f.invoke('finish', f.job, f.review(), '--apply');
    assert.equal(outcome.code, 1);
    assert.match(outcome.result.message, /Windows link target type changed/);
    assert.equal(readFileSync(join(f.original, 'outer', 'note.txt'), 'utf8'), 'first');
  });
