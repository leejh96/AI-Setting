import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { URL } from 'node:url';
import { syncCodexDirectoryPermission, withConfigServer } from './codex-directory-permission.mjs';
import { sameInstallPath } from './install-file.mjs';
import { syncCompareChanges } from './sync-compare-changes.mjs';

const source = readFileSync(new URL('../skills/compare-changes/SKILL.md', import.meta.url));

function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'compare-changes sync '));
  t.after(() => rmSync(home, { force: true, recursive: true }));
  return home;
}

test('Codex는 최신 스킬과 artifacts를 준비하고 기존 writable_roots에 정확한 경로만 추가한다', async t => {
  const home = fixture(t);
  const codex = join(home, 'custom-codex');
  const configPath = join(codex, 'config.toml');
  const installation = join(codex, 'skills', 'compare-changes');
  const artifacts = join(installation, 'artifacts');
  const otherRoot = join(home, 'other');
  const roots = [otherRoot];
  const original = 'sandbox_mode = "workspace-write"\n';
  mkdirSync(codex);
  writeFileSync(configPath, original);
  let writes = 0;
  const request = async (method, params) => {
    if (method === 'config/read') {
      return { layers: [{ name: { type: 'user', file: configPath }, version: 'test-version', config: {
        sandbox_mode: 'workspace-write', sandbox_workspace_write: { writable_roots: roots },
      } }] };
    }
    writes++;
    assert.equal(method, 'config/value/write');
    assert.deepEqual(params, {
      keyPath: 'sandbox_workspace_write.writable_roots', value: [otherRoot, artifacts],
      mergeStrategy: 'replace', filePath: configPath, expectedVersion: 'test-version',
    });
    roots.push(artifacts);
    return { status: 'ok' };
  };
  const codexPermission = (path, dir, label) => syncCodexDirectoryPermission(path, dir, label, run => run(request));

  const results = await Array.fromAsync(syncCompareChanges('codex', { home, codex, codexPermission }));
  assert.deepEqual(results.map(result => result.added), [true, true]);
  assert.equal(readFileSync(results[1].backup, 'utf8'), original);
  assert.deepEqual(readFileSync(join(installation, 'SKILL.md')), source);
  assert.ok(existsSync(artifacts));
  const repeated = await Array.fromAsync(syncCompareChanges('codex', { home, codex, codexPermission }));
  assert.deepEqual(repeated.map(result => result.added), [false, false]);
  assert.equal(writes, 1);
});

test('동기화 중 Codex 설정이 바뀌면 현재 설정을 보존하고 다시 실행할 수 있게 오류를 반환한다', async t => {
  const home = fixture(t);
  const path = join(home, 'config.toml');
  const original = 'sandbox_mode = "workspace-write"\n';
  const updated = original + 'hide_agent_reasoning = true\n';
  writeFileSync(path, original);
  const request = async method => {
    assert.equal(method, 'config/read');
    writeFileSync(path, updated);
    return { layers: [{ name: { type: 'user', file: path }, version: 'new-version', config: {} }] };
  };
  await assert.rejects(syncCodexDirectoryPermission(path, join(home, 'artifacts'), 'compare-changes-permission', run => run(request)), /변경되었습니다/u);
  assert.equal(readFileSync(path, 'utf8'), updated);
  assert.deepEqual(readdirSync(home), ['config.toml']);
});

test('Codex의 최종 권한이 전체 접근을 허용할 때만 별도 쓰기 경로 등록을 건너뛴다', async t => {
  const home = fixture(t);
  const path = join(home, 'config.toml');
  const dir = join(home, 'artifacts');
  const content = 'sandbox_mode = "danger-full-access"\n';
  writeFileSync(path, content);
  const userConfig = { sandbox_mode: 'danger-full-access' };
  const sync = config => syncCodexDirectoryPermission(path, dir, 'compare-changes-permission', run => run(async method => {
    assert.equal(method, 'config/read');
    return { layers: [{ name: { type: 'user', file: path }, config: userConfig }], config };
  }));
  assert.deepEqual(await sync(userConfig), { path, added: false });
  await assert.rejects(sync({ sandbox_mode: 'read-only' }), /workspace-write/u);
  await assert.rejects(sync({ ...userConfig, default_permissions: 'restricted' }), /workspace-write/u);
  assert.equal(readFileSync(path, 'utf8'), content);
  assert.deepEqual(readdirSync(home), ['config.toml']);
});

test('Codex는 사용자 설정에만 있는 경로를 최종 권한으로 인정하지 않는다', async t => {
  const home = fixture(t);
  const path = join(home, 'config.toml');
  const dir = join(home, 'artifacts');
  const content = 'sandbox_mode = "workspace-write"\n';
  writeFileSync(path, content);
  const config = roots => ({ sandbox_mode: 'workspace-write', sandbox_workspace_write: { writable_roots: roots } });
  const sync = (local, effective) => syncCodexDirectoryPermission(path, dir, 'compare-changes-permission', run => run(async method => {
    assert.equal(method, 'config/read');
    return {
      layers: [{ name: { type: 'user', file: path }, config: config(local) }],
      config: config(effective),
    };
  }));
  await assert.rejects(sync([dir], []), /상위 Codex 설정/u);
  assert.deepEqual(await sync([], [dir]), { path, added: false });
  assert.equal(readFileSync(path, 'utf8'), content);
  assert.deepEqual(readdirSync(home), ['config.toml']);
});

test('Codex는 Windows에서 대소문자 표기만 다른 설정 파일과 쓰기 경로를 인식한다', {
  skip: process.platform !== 'win32',
}, async t => {
  const home = fixture(t);
  const path = join(home, 'Config.toml');
  const dir = join(home, 'Artifacts');
  const content = 'sandbox_mode = "workspace-write"\n';
  writeFileSync(path, content);
  mkdirSync(dir);
  const config = { sandbox_mode: 'workspace-write', sandbox_workspace_write: { writable_roots: [dir.toUpperCase()] } };
  const results = await syncCodexDirectoryPermission(path, dir, 'compare-changes-permission', run => run(async method => {
    assert.equal(method, 'config/read');
    return { layers: [{ name: { type: 'user', file: path.toUpperCase() }, config }], config };
  }));
  assert.deepEqual(results, { path, added: false });
  assert.equal(readFileSync(path, 'utf8'), content);
  assert.deepEqual(readdirSync(home).sort(), ['Artifacts', 'Config.toml']);
});

test('실제 경로를 확인할 수 없는 대소문자 별칭을 같은 설치 경로로 처리하지 않는다', t => {
  const home = fixture(t);
  assert.equal(sameInstallPath(join(home, 'Artifacts'), join(home, 'ARTIFACTS')), false);
});

for (const shell of [false, true]) {
  test(`Codex 설정 서버가 응답하지 않으면 시간 제한 후 서버를 종료한다 (Windows 셸: ${shell})`, {
    skip: shell && process.platform !== 'win32', timeout: 10_000,
  }, async t => {
    const script = join(fixture(t), 'unresponsive server.cjs');
    writeFileSync(script, [
      "const { createInterface } = require('node:readline');",
      "createInterface({input:process.stdin}).on('line', line => {",
      "  const request = JSON.parse(line);",
      "  if (request.method === 'initialize') console.log(JSON.stringify({ id: request.id, result: {} }));",
      "  if (request.method === 'config/read') console.log(JSON.stringify({ id: request.id, result: process.pid }));",
      "});",
      'setInterval(() => {}, 1000);',
    ].join('\n'));
    let closed;
    let pid;
    const open = () => {
      const options = { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true };
      const child = shell ? spawn(`"${process.execPath}" "${script}"`, { ...options, shell: true })
        : spawn(process.execPath, [script], options);
      closed = once(child, 'exit');
      return { child, shell };
    };
    await assert.rejects(withConfigServer(async request => {
      pid = await request('config/read', { includeLayers: true });
      return request('config/value/write', {});
    }, { open, timeoutMs: 2_000 }), /응답 시간이 초과되었습니다 \(config\/value\/write\)/u);
    await closed;
    assert.ok(Number.isInteger(pid));
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  });
}

test('Antigravity는 기존 자료를 보존하며 앱과 CLI에 artifacts 읽기·쓰기 권한을 등록한다', async t => {
  const home = fixture(t);
  const gemini = join(home, '.gemini');
  const app = join(gemini, 'config', 'config.json');
  const cli = join(gemini, 'antigravity-cli', 'settings.json');
  const installation = join(dirname(app), 'skills', 'compare-changes');
  const artifacts = join(installation, 'artifacts');
  const rulePath = process.platform === 'win32' ? artifacts.replaceAll('\\', '/') : artifacts;
  const readRule = `read_file(${rulePath})`;
  const writeRule = `write_file(${rulePath})`;
  const oldArtifact = join(artifacts, 'before.png');
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(oldArtifact, 'kept');
  writeFileSync(join(installation, 'SKILL.md'), 'old');
  writeFileSync(app, JSON.stringify({ userSettings: { globalPermissionGrants: { allow: [readRule] } } }));
  mkdirSync(dirname(cli));
  writeFileSync(cli, JSON.stringify({ permissions: { allow: ['command(git status)'] } }));

  const results = await Array.fromAsync(syncCompareChanges('antigravity', { home }));
  assert.deepEqual(results.map(result => result.added), [true, true, true]);
  assert.equal(readFileSync(results[0].backup, 'utf8'), 'old');
  assert.equal(readFileSync(oldArtifact, 'utf8'), 'kept');
  assert.deepEqual(readFileSync(join(installation, 'SKILL.md')), source);
  assert.deepEqual(JSON.parse(readFileSync(app, 'utf8')).userSettings.globalPermissionGrants.allow, [readRule, writeRule]);
  assert.deepEqual(JSON.parse(readFileSync(cli, 'utf8')).permissions.allow, ['command(git status)', writeRule]);
  const repeated = await Array.fromAsync(syncCompareChanges('antigravity', { home }));
  assert.deepEqual(repeated.map(result => result.added), [false, false, false]);
});

test('Antigravity가 artifacts 쓰기를 차단하면 기존 권한 설정을 보존하고 동기화 오류를 반환한다', async t => {
  const home = fixture(t);
  const app = join(home, '.gemini', 'config', 'config.json');
  const config = JSON.stringify({ userSettings: { globalPermissionGrants: { deny: ['write_file(*)'] } } });
  mkdirSync(dirname(app), { recursive: true });
  writeFileSync(app, config);

  await assert.rejects(Array.fromAsync(syncCompareChanges('antigravity', { home })), /deny/u);
  assert.equal(readFileSync(app, 'utf8'), config);
});
