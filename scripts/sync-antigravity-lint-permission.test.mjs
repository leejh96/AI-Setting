import assert from 'node:assert/strict';
import fs, { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { syncAntigravityFolderPermission } from './antigravity-permission.mjs';
import { syncAntigravityLintPermission } from './sync-antigravity-lint-permission.mjs';

function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'Antigravity lint permissions '));
  t.after(() => rmSync(home, { force: true, recursive: true }));
  const gemini = join(home, '.gemini');
  const app = join(gemini, 'config', 'config.json');
  const cli = join(gemini, 'antigravity-cli', 'settings.json');
  const lintFolder = join(gemini, 'lints');
  const rule = `read_file(${process.platform === 'win32' ? lintFolder.replaceAll('\\', '/') : lintFolder})`;
  return { home, app, cli, rule, lintFolder };
}

function writeConfig(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

test('앱과 CLI에 린트 폴더 읽기 권한을 추가하고 원본과 다른 권한을 보존한다', t => {
  const { home, app, cli, rule } = fixture(t);
  const appData = { userSettings: { globalPermissionGrants: { allow: ['command(git status)'] }, theme: 'dark' } };
  const cliData = { permissions: { deny: ['command(rm -rf)'], ask: ['command(npm install)'] }, sandbox: true };
  const appOriginal = JSON.stringify(appData);
  const cliOriginal = JSON.stringify(cliData);
  writeConfig(app, appOriginal);
  writeConfig(cli, cliOriginal);

  const [appResult, cliResult] = [...syncAntigravityLintPermission(home)];
  assert.deepEqual([appResult.added, cliResult.added], [true, true]);
  assert.equal(readFileSync(appResult.backup, 'utf8'), appOriginal);
  assert.equal(readFileSync(cliResult.backup, 'utf8'), cliOriginal);
  if (process.platform !== 'win32') {
    assert.equal(statSync(appResult.backup).mode & 0o777, 0o600);
    assert.equal(statSync(cliResult.backup).mode & 0o777, 0o600);
  }
  appData.userSettings.globalPermissionGrants.allow.push(rule);
  cliData.permissions.allow = [rule];
  assert.deepEqual(JSON.parse(readFileSync(app, 'utf8')), appData);
  assert.deepEqual(JSON.parse(readFileSync(cli, 'utf8')), cliData);

  const appFiles = readdirSync(dirname(app));
  const cliFiles = readdirSync(dirname(cli));
  assert.deepEqual([...syncAntigravityLintPermission(home)], [{ path: app, added: false }, { path: cli, added: false }]);
  assert.deepEqual(readdirSync(dirname(app)), appFiles);
  assert.deepEqual(readdirSync(dirname(cli)), cliFiles);
});

test('기존 폴더 권한을 재사용하고 설정 파일을 다시 쓰지 않는다', t => {
  const { home, app, lintFolder } = fixture(t);
  const grant = `write_file(${lintFolder}${sep})`;
  const original = JSON.stringify({ userSettings: { globalPermissionGrants: { allow: [grant] } } });
  writeConfig(app, original);

  assert.deepEqual([...syncAntigravityLintPermission(home)], [{ path: app, added: false }]);
  assert.equal(readFileSync(app, 'utf8'), original);
  assert.deepEqual(readdirSync(dirname(app)), ['config.json']);
});

test('신규 설치는 앱 설정을 만들고 설치된 CLI의 설정 파일 누락도 처리한다', t => {
  const { home, app, cli, rule } = fixture(t);
  mkdirSync(dirname(cli), { recursive: true });

  const results = [...syncAntigravityLintPermission(home)];
  assert.deepEqual(results.map(({ added, backup }) => [added, backup]), [[true, undefined], [true, undefined]]);
  assert.deepEqual(JSON.parse(readFileSync(app, 'utf8')).userSettings.globalPermissionGrants.allow, [rule]);
  assert.deepEqual(JSON.parse(readFileSync(cli, 'utf8')).permissions.allow, [rule]);
});

test('읽기 차단 규칙과 해석할 수 없는 설정은 그대로 둔다', t => {
  const { home, app } = fixture(t);
  for (const [original, error] of [
    [JSON.stringify({ userSettings: { globalPermissionGrants: { deny: ['read_file(*)'] } } }), /deny/u],
    [JSON.stringify({ userSettings: { globalPermissionGrants: { ask: ['read_file(*)'] } } }), /ask/u],
    ['{ malformed', /JSON/u],
  ]) {
    writeConfig(app, original);
    assert.throws(() => [...syncAntigravityLintPermission(home)], error);
    assert.equal(readFileSync(app, 'utf8'), original);
    assert.deepEqual(readdirSync(dirname(app)), ['config.json']);
  }
});

test('같은 권한 파일의 동시 갱신을 막고 재시도하면 두 규칙을 보존한다', t => {
  const { home, app, rule } = fixture(t);
  const gemini = join(home, '.gemini');
  const artifacts = join(gemini, 'config', 'skills', 'compare-changes', 'artifacts');
  const writeRule = `write_file(${process.platform === 'win32' ? artifacts.replaceAll('\\', '/') : artifacts})`;
  const syncArtifacts = () => [...syncAntigravityFolderPermission(gemini, artifacts, 'write_file', 'compare-changes-permission')];
  const entries = () => JSON.parse(readFileSync(app, 'utf8')).userSettings.globalPermissionGrants.allow;
  writeConfig(app, '{}\n');
  const rename = fs.renameSync;
  let raced = false;
  try {
    fs.renameSync = (source, destination) => {
      if (destination === app && !raced) {
        raced = true;
        assert.throws(syncArtifacts, /권한 동기화가 진행 중/u);
      }
      return rename(source, destination);
    };
    syncBuiltinESMExports();
    assert.equal([...syncAntigravityLintPermission(home)][0].added, true);
  } finally {
    fs.renameSync = rename;
    syncBuiltinESMExports();
  }
  assert.ok(raced);
  assert.deepEqual(entries(), [rule]);
  assert.equal(syncArtifacts()[0].added, true);
  assert.deepEqual(entries(), [rule, writeRule]);
  assert.ok(!readdirSync(dirname(app)).some(file => file.endsWith('.lock')));
});
