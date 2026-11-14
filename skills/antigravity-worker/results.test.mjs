import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { git } from './scripts/workspace.mjs';

function fixture(t, kind) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'agy-results-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const original = join(root, 'original');
  mkdirSync(original);
  const source = join(original, 'probe.txt');
  writeFileSync(source, 'original');
  if (kind !== 'folder') {
    const hooks = join(root, 'empty-hooks');
    mkdirSync(hooks);
    git(original, ['init', '-b', 'main']);
    git(original, ['config', 'core.hooksPath', hooks]);
    git(original, ['config', 'user.name', 'Test']);
    git(original, ['config', 'user.email', 'test@example.invalid']);
    git(original, ['config', 'commit.gpgsign', 'false']);
    git(original, ['add', 'probe.txt']);
    git(original, ['commit', '-m', 'Initial']);
  }
  const runner = fileURLToPath(new URL('./scripts/worker.mjs', import.meta.url));
  const invoke = (...args) => {
    const run = spawnSync(process.execPath, [runner, ...args], {
      cwd: root, env: { ...process.env, CODEX_HOME: root }, encoding: 'utf8', windowsHide: true,
    });
    assert.ifError(run.error);
    assert.equal(run.signal, null);
    const events = run.stdout.trim().split('\n').map(line => JSON.parse(line));
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
