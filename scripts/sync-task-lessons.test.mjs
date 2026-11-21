import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs, { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { syncTaskLessons } from './sync-task-lessons.mjs';

const skill = new URL('../skills/task-lessons/', import.meta.url);

function fixture(t) {
  const codex = mkdtempSync(join(tmpdir(), 'task-lessons-sync-'));
  t.after(() => rmSync(codex, { force: true, recursive: true }));
  const legacy = join(codex, 'task-lessons');
  const installation = join(codex, 'skills', 'task-lessons');
  return { codex, legacy, installation, lessons: join(installation, 'lessons') };
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

test('기존 교훈을 새 위치로 이전하고 권한을 등록하며 재동기화에서 추가 기록을 보존한다', async t => {
  const { codex, legacy, installation, lessons } = fixture(t);
  write(join(legacy, 'shared', 'shared.md'), 'legacy shared');
  write(join(legacy, 'projects', 'project-key', 'project.md'), 'legacy project');
  const permissionCalls = [];
  const codexPermission = async (path, directory, label) => {
    permissionCalls.push([path, directory, label]);
    assert.ok(existsSync(directory));
    return { path, added: permissionCalls.length === 1 };
  };
  const sync = () => Array.fromAsync(syncTaskLessons({ codex, override: '', codexPermission }));

  const first = await sync();
  assert.deepEqual(permissionCalls, [[join(codex, 'config.toml'), lessons, 'task-lessons-permission']]);
  assert.equal(first.find(item => item.path === lessons).migrated, 2);
  assert.equal(first.find(item => item.path === lessons).preserved, legacy);
  assert.equal(readFileSync(join(legacy, 'shared', 'shared.md'), 'utf8'), 'legacy shared');
  assert.equal(readFileSync(join(lessons, 'shared', 'shared.md'), 'utf8'), 'legacy shared');
  assert.equal(readFileSync(join(lessons, 'projects', 'project-key', 'project.md'), 'utf8'), 'legacy project');
  for (const file of ['SKILL.md', 'scripts/location.mjs', 'scripts/location.ps1', 'references/storage.md']) {
    assert.deepEqual(readFileSync(join(installation, file)), readFileSync(new URL(file, skill)));
  }

  const newLesson = join(lessons, 'shared', 'new.md');
  write(newLesson, 'new lesson');
  write(join(lessons, 'shared', 'shared.md'), 'updated active lesson');
  assert.ok((await sync()).every(item => item.added === false || item.migrated === 0));
  assert.equal(readFileSync(newLesson, 'utf8'), 'new lesson');
  assert.equal(readFileSync(join(lessons, 'shared', 'shared.md'), 'utf8'), 'updated active lesson');
});

test('기존 새 저장소에 교훈을 합치고 같은 상대 경로의 내용이 다르면 원본을 모두 보존한다', async t => {
  const { codex, legacy, lessons } = fixture(t);
  const legacyFile = join(legacy, 'shared', 'existing.md');
  const targetFile = join(lessons, 'shared', 'existing.md');
  write(legacyFile, 'old lesson');
  write(join(legacy, 'shared', 'new.md'), 'migrate this');
  write(targetFile, 'edited lesson');
  write(join(lessons, 'shared', 'kept.md'), 'keep this');

  await assert.rejects(Array.fromAsync(syncTaskLessons({ codex, override: '', codexPermission: assert.fail })), /충돌합니다/u);
  assert.equal(readFileSync(legacyFile, 'utf8'), 'old lesson');
  assert.equal(readFileSync(targetFile, 'utf8'), 'edited lesson');
  assert.equal(existsSync(join(lessons, 'shared', 'new.md')), false);

  write(targetFile, 'old lesson');
  await Array.fromAsync(syncTaskLessons({ codex, override: '', codexPermission: async path => ({ path, added: false }) }));
  assert.equal(readFileSync(legacyFile, 'utf8'), 'old lesson');
  assert.equal(readFileSync(targetFile, 'utf8'), 'old lesson');
  assert.equal(readFileSync(join(lessons, 'shared', 'new.md'), 'utf8'), 'migrate this');
  assert.equal(readFileSync(join(lessons, 'shared', 'kept.md'), 'utf8'), 'keep this');
});

test('이전 기록 대조 직후 구버전 경로에 기록된 추가 내용도 보존한다', async t => {
  const { codex, legacy, lessons } = fixture(t);
  const old = join(legacy, 'shared', 'lesson.md');
  const copy = join(lessons, 'shared', 'lesson.md');
  write(old, 'before');
  const read = fs.readFileSync;
  let updated = false;
  fs.readFileSync = (path, ...args) => {
    const result = read(path, ...args);
    if (path === old && existsSync(copy) && !updated) {
      fs.appendFileSync(old, '\nlate edit');
      updated = true;
    }
    return result;
  };
  syncBuiltinESMExports();
  try {
    await Array.fromAsync(syncTaskLessons({ codex, override: '', codexPermission: async path => ({ path }) }));
  } finally {
    fs.readFileSync = read;
    syncBuiltinESMExports();
  }
  assert.ok(updated);
  assert.equal(readFileSync(old, 'utf8'), 'before\nlate edit');
  assert.equal(readFileSync(copy, 'utf8'), 'before');
});

test('사용자 지정 교훈 경로가 활성화된 경우 자료와 권한을 유지하고 스킬 파일을 갱신한다', async t => {
  const { codex, legacy, installation, lessons } = fixture(t);
  const override = join(codex, 'custom-lessons');
  write(join(override, 'shared', 'custom.md'), 'custom');
  const records = await Array.fromAsync(syncTaskLessons({ codex, override, codexPermission: assert.fail }));
  assert.equal(records[0].path, override);
  assert.equal(records[0].custom, true);
  assert.equal(existsSync(legacy), false);
  assert.equal(existsSync(lessons), false);
  assert.deepEqual(readFileSync(join(installation, 'SKILL.md')), readFileSync(new URL('SKILL.md', skill)));
  assert.equal(readFileSync(join(override, 'shared', 'custom.md'), 'utf8'), 'custom');
});

test('두 도구는 같은 프로젝트에서 각자 교훈을 사용하고 Antigravity 권한은 한 번만 등록한다', async t => {
  const { codex: home } = fixture(t);
  const codex = join(home, '.codex');
  const codexSkill = join(codex, 'skills', 'task-lessons');
  const override = join(home, 'codex-lessons');
  const gemini = join(home, '.gemini');
  const antigravitySkill = join(gemini, 'config', 'skills', 'task-lessons');
  const antigravityLessons = join(antigravitySkill, 'lessons');
  const app = join(gemini, 'config', 'config.json');
  const cli = join(gemini, 'antigravity-cli', 'settings.json');
  write(app, JSON.stringify({ userSettings: { globalPermissionGrants: { allow: ['unrelated'] } } }));
  write(cli, JSON.stringify({ permissions: { allow: ['unrelated'] } }));
  write(join(override, 'shared', 'codex.md'), 'codex record');
  await Array.fromAsync(syncTaskLessons({ codex, override, codexPermission: assert.fail }));

  const sync = () => Array.fromAsync(syncTaskLessons({ tool: 'antigravity', home, override, codexPermission: assert.fail }));
  await sync();
  const permission = `write_file(${antigravityLessons.replaceAll('\\', '/')})`;
  const config = path => JSON.parse(readFileSync(path, 'utf8'));
  assert.deepEqual(config(app).userSettings.globalPermissionGrants.allow, ['unrelated', permission]);
  assert.deepEqual(config(cli).permissions.allow, ['unrelated', permission]);
  assert.equal(existsSync(join(antigravityLessons, 'shared', 'codex.md')), false);

  const record = join(antigravityLessons, 'shared', 'antigravity.md');
  write(record, 'antigravity record');
  assert.ok((await sync()).every(item => !item.added && !item.backup));
  assert.equal(readFileSync(record, 'utf8'), 'antigravity record');
  assert.equal(readFileSync(join(override, 'shared', 'codex.md'), 'utf8'), 'codex record');
  assert.equal(existsSync(join(override, 'shared', 'antigravity.md')), false);

  const locate = installation => {
    const result = spawnSync(process.execPath, [join(installation, 'scripts', 'location.mjs')], {
      cwd: home,
      env: { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: codex, CODEX_LESSONS_DIR: override },
      encoding: 'utf8', timeout: 10_000, windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const codexLocation = locate(codexSkill);
  const antigravityLocation = locate(antigravitySkill);
  assert.equal(codexLocation.shared, join(override, 'shared'));
  const antigravityRoot = realpathSync.native(antigravityLessons);
  assert.equal(antigravityLocation.shared, join(antigravityRoot, 'shared'));
  assert.equal(antigravityLocation.project, join(antigravityRoot, 'projects', basename(codexLocation.project)));
});

for (const shell of ['Node.js', 'Windows PowerShell']) {
  test(`${shell} 교훈 경로는 상속된 Git 환경 대신 실제 작업 폴더를 사용한다`, { skip: shell === 'Windows PowerShell' && process.platform !== 'win32' }, t => {
    const { codex: home } = fixture(t);
    const [other, project, plain] = ['other', '한글 프로젝트', '한글 일반 폴더'].map(name => join(home, name));
    const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^GIT_/i.test(name)));
    const projectOrigin = 'https://github.com/lesson-fixture/project.git';
    const git = (directory, ...args) => {
      const result = spawnSync('git', ['-C', directory, ...args], { env: cleanEnv, encoding: 'utf8', windowsHide: true });
      assert.equal(result.status, 0, result.stderr);
    };
    for (const directory of [other, project, plain]) mkdirSync(directory);
    for (const [directory, url] of [[other, 'https://github.com/lesson-fixture/other.git'], [project, projectOrigin]]) {
      git(directory, 'init', '--quiet');
      git(directory, 'remote', 'add', 'origin', url);
    }

    const command = shell === 'Node.js' ? process.execPath : 'powershell.exe';
    const locator = new URL(shell === 'Node.js' ? 'scripts/location.mjs' : 'scripts/location.ps1', skill);
    const entry = fileURLToPath(locator);
    const options = shell === 'Node.js' ? [entry] : ['-NoProfile', '-NonInteractive', '-Command',
      `[Console]::OutputEncoding = [Text.Encoding]::GetEncoding(437); & '${entry.replaceAll("'", "''")}'`];
    const locate = (cwd, overrides = {}) => {
      const result = spawnSync(command, options, {
        cwd, env: { ...cleanEnv, CODEX_LESSONS_DIR: join(home, '교훈'), ...overrides },
        encoding: 'utf8', timeout: 15_000, windowsHide: true,
      });
      assert.equal(result.status, 0, result.stderr || result.error?.message);
      const location = JSON.parse(result.stdout);
      assert.equal(location.shared, join(home, '교훈', 'shared'));
      return location.project;
    };
    const ownKey = locate(project);
    const plainKey = locate(plain);
    assert.equal(new Set([ownKey, plainKey, locate(other)]).size, 3);

    const otherRepository = { GIT_DIR: join(other, '.git'), GIT_WORK_TREE: other };
    assert.equal(locate(project, otherRepository), ownKey);
    assert.equal(locate(plain, otherRepository), plainKey);
    assert.equal(locate(project, {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'url.https://github.com/lesson-fixture/other.git.insteadOf',
      GIT_CONFIG_VALUE_0: projectOrigin,
    }), ownKey);
  });
}

test('PowerShell 경로 조회의 JSON은 콘솔 인코딩과 관계없이 한글과 유니코드 경로를 보존한다', t => {
  const { codex } = fixture(t);
  const directory = join(codex, '작업 😀');
  const lessons = join(codex, '교훈');
  mkdirSync(directory);
  const locate = snapshots => {
    const locator = fileURLToPath(new URL('scripts/location.mjs', skill));
    const result = spawnSync(process.execPath, [locator, directory, '--git-stdin'], {
      encoding: 'utf8', input: JSON.stringify(snapshots), env: { ...process.env, CODEX_LESSONS_DIR: lessons },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /[\u0080-\uffff]/u);
    return JSON.parse(result.stdout);
  };
  const { probe } = locate([]);
  assert.equal(probe, realpathSync.native(directory));
  assert.equal(locate([{ directory: probe }]).shared, join(lessons, 'shared'));
});
