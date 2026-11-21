import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { test } from 'node:test';
import { grantSwarmFiles, lastSwarmSequence, readSwarmRequest, waitForSwarm } from './scripts/swarm.mjs';

function temporary(t) {
  const root = mkdtempSync(join(tmpdir(), 'codex-swarm-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('Swarm grants only regular files within the workspace', t => {
  const root = temporary(t);
  const work = join(root, 'work');
  const manifest = join(root, 'swarm.json');
  mkdirSync(join(work, 'src'), { recursive: true });
  const request = (file, verifier = 'verifier') => {
    writeFileSync(manifest, JSON.stringify({ files: [file], verifier }));
    return readSwarmRequest(manifest, work);
  };
  assert.match(request('src/new.js').rules[0], /^write_file\(.+\/work\/src\/new\.js\)$/);
  for (const file of ['../outside.js', '/tmp/another.js', 'C:\\outside.js', '.git/config', 'src/*', 'src']) {
    assert.throws(() => request(file), undefined, file);
  }
  assert.throws(() => request('src/new.js', ['verifier']), /must specify a verifier name/);
});

test('Swarm rejects a target under a symbolic link', t => {
  const root = temporary(t);
  const work = join(root, 'work');
  const manifest = join(root, 'swarm.json');
  mkdirSync(work);
  try { symlinkSync(root, join(work, 'external'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') return t.skip('Windows sandbox does not permit directory links');
    throw error;
  }
  writeFileSync(manifest, JSON.stringify({ files: ['external/new.js'], verifier: 'verifier' }));
  assert.throws(() => readSwarmRequest(manifest, work), /parent must be a real directory/);
});

test('Swarm scope restores the isolated configuration and preserves concurrent unrelated changes', t => {
  const root = temporary(t);
  const profile = join(root, 'profile');
  const turn = join(root, 'turn');
  const app = join(profile, 'config', 'config.json');
  const cli = join(profile, 'antigravity-cli', 'settings.json');
  mkdirSync(join(profile, 'config'), { recursive: true });
  mkdirSync(turn);
  const original = '{"plugins":{"swarm":true},"userSettings":{"globalPermissionGrants":{"ask":["command(*)"]}}}';
  writeFileSync(app, original);
  const rule = 'write_file(/tmp/owned.js)';
  const restore = grantSwarmFiles(profile, turn, [rule]);
  const appData = JSON.parse(readFileSync(app));
  assert.deepEqual(appData.userSettings.globalPermissionGrants, { ask: ['command(*)'], allow: [rule] });
  assert.deepEqual(JSON.parse(readFileSync(cli)), { permissions: { allow: [rule] } });
  assert.equal(readFileSync(join(turn, 'swarm-config-0.bak'), 'utf8'), original);
  appData.plugins.another = true;
  writeFileSync(app, JSON.stringify(appData));
  restore();
  assert.deepEqual(JSON.parse(readFileSync(app)), {
    plugins: { swarm: true, another: true }, userSettings: { globalPermissionGrants: { ask: ['command(*)'], allow: [] } },
  });
  assert.equal(existsSync(cli), false);
  assert.equal(existsSync(join(turn, 'swarm-config-0.bak')), false);
});

test('Swarm waits for a new verifier report or worker blocker after the prompt', async t => {
  const board = join(temporary(t), 'board.jsonl');
  const posts = [
    { seq: 1, agent: 'rules', text: '@coordinator [blocked] Earlier turn' },
    { seq: 2, agent: 'rules', text: '@verifier [done] Implemented' },
    { seq: 3, agent: 'verifier', text: '@coordinator [done] Verified' },
  ];
  writeFileSync(board, posts.map(post => JSON.stringify(post)).join('\n'));
  const observed = [];
  assert.equal(lastSwarmSequence(board), 3);
  assert.equal(await waitForSwarm(board, 'verifier', 1, () => null, post => observed.push(post)), 'done');
  assert.deepEqual(observed, posts.slice(1));
  assert.equal(await waitForSwarm(board, 'verifier', 0, () => null, () => {}), 'blocked');
  assert.equal(await waitForSwarm(board, 'verifier', 3, () => 'cancelled', () => {}), 'cancelled');
  assert.equal(await waitForSwarm(board, 'verifier', 3, () => null, () => {}, 0), 'timeout');
});
