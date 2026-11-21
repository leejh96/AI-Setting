import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs, { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
  const oldScript = join(installation, 'scripts', 'location.ps1');
  write(oldScript, 'previous launcher');
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
  for (const file of ['SKILL.md', 'scripts/location.mjs', 'scripts/git-files.mjs', 'references/storage.md']) {
    assert.deepEqual(readFileSync(join(installation, file)), readFileSync(new URL(file, skill)));
  }
  assert.equal(existsSync(oldScript), false);
  assert.equal(readFileSync(first.find(item => item.retired).backup, 'utf8'), 'previous launcher');

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
  const shared = statSync(antigravityLocation.shared);
  const expected = statSync(join(antigravityLessons, 'shared'));
  assert.deepEqual([shared.dev, shared.ino], [expected.dev, expected.ino]);
  assert.equal(dirname(antigravityLocation.project), join(dirname(antigravityLocation.shared), 'projects'));
  assert.equal(basename(antigravityLocation.project), basename(codexLocation.project));
});

const cleanGitEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^GIT_/i.test(name)));
const locator = fileURLToPath(new URL('scripts/location.mjs', skill));
const blockedGit = [
  "import cp from 'node:child_process';",
  "import { syncBuiltinESMExports } from 'node:module';",
  "import { pathToFileURL } from 'node:url';",
  "cp.spawnSync = () => ({ error: Object.assign(new Error('Git start blocked'), { code: 'EPERM' }) });",
  "syncBuiltinESMExports();",
  "process.argv = [process.execPath, process.argv[2], process.argv[1]];",
  "await import(pathToFileURL(process.argv[1]));",
].join(' ');

function git(directory, ...args) {
  const result = spawnSync('git', ['-C', directory, ...args], {
    env: cleanGitEnv, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
}

function locate(home, directory, { blocked = false, missing = false, overrides = {} } = {}) {
  const args = blocked ? ['--input-type=module', '-e', blockedGit, directory, locator] : [locator, directory];
  const env = {
    ...cleanGitEnv,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, 'xdg'),
    CODEX_LESSONS_DIR: join(home, '교훈'),
    ...overrides,
  };
  if (missing) {
    for (const key of Object.keys(env).filter(name => name.toUpperCase() === 'PATH')) delete env[key];
    env.PATH = join(home, 'no-git-bin');
  }
  return spawnSync(process.execPath, args, {
    cwd: home, env, encoding: 'utf8', timeout: 15_000, windowsHide: true,
  });
}

function lessonPaths(home, directory, options) {
  const result = locate(home, directory, options);
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const paths = JSON.parse(result.stdout);
  assert.equal(paths.shared, join(home, '교훈', 'shared'));
  return paths;
}

test('교훈 경로는 상속된 Git 환경 대신 실제 작업 폴더를 사용한다', t => {
  const { codex: home } = fixture(t);
  const [other, project, plain] = ['other', '한글 프로젝트', '한글 일반 폴더'].map(name => join(home, name));
  const projectOrigin = 'https://github.com/lesson-fixture/project.git';
  for (const directory of [other, project, plain]) mkdirSync(directory);
  for (const [directory, url] of [[other, 'https://github.com/lesson-fixture/other.git'], [project, projectOrigin]]) {
    git(directory, 'init', '--quiet');
    git(directory, 'remote', 'add', 'origin', url);
  }

  const own = lessonPaths(home, project);
  const plainPaths = lessonPaths(home, plain);
  assert.equal(new Set([own.project, plainPaths.project, lessonPaths(home, other).project]).size, 3);
  const overrides = {
    GIT_DIR: join(other, '.git'),
    GIT_WORK_TREE: other,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'url.https://github.com/lesson-fixture/other.git.insteadOf',
    GIT_CONFIG_VALUE_0: projectOrigin,
  };
  assert.deepEqual(lessonPaths(home, project, { overrides }), own);
  assert.deepEqual(lessonPaths(home, plain, { overrides }), plainPaths);
  assert.deepEqual(lessonPaths(home, project, { blocked: true, overrides }), own);
  assert.deepEqual(lessonPaths(home, project, { missing: true }), own);
  assert.deepEqual(lessonPaths(home, plain, { blocked: true }), plainPaths);
});

test('Git 실행 차단 시 연결 워크트리와 로컬 원격의 기존 프로젝트 키를 보존한다', t => {
  const { codex: home } = fixture(t);
  const project = join(home, '팀 프로젝트');
  const linked = join(home, '연결 워크트리');
  const mirror = join(home, '로컬 복제본');
  const nested = join(linked, '하위 폴더');
  mkdirSync(project);
  mkdirSync(mirror);
  git(project, 'init', '--quiet');
  git(project, '-c', 'user.name=Lesson Test', '-c', 'user.email=lesson@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '--quiet', '-m', 'initial');
  git(project, 'worktree', 'add', '--quiet', '--detach', linked);
  mkdirSync(nested);
  git(mirror, 'init', '--quiet');
  git(mirror, 'remote', 'add', 'origin', '../팀 프로젝트');
  const commonPaths = lessonPaths(home, project);
  for (const directory of [nested, mirror]) {
    assert.deepEqual(lessonPaths(home, directory), commonPaths);
    assert.deepEqual(lessonPaths(home, directory, { blocked: true }), commonPaths);
  }
  git(project, 'remote', 'add', 'origin', 'https://github.com/lesson-fixture/project');
  const remotePaths = lessonPaths(home, project);
  assert.notDeepEqual(remotePaths, commonPaths);
  assert.deepEqual(lessonPaths(home, nested, { blocked: true }), remotePaths);
  assert.deepEqual(lessonPaths(home, mirror, { blocked: true }), remotePaths);

  git(mirror, 'remote', 'set-url', 'origin', '../삭제된 복제 원본');
  const disconnected = lessonPaths(home, mirror);
  assert.notDeepEqual(disconnected, remotePaths);
  assert.deepEqual(lessonPaths(home, mirror, { blocked: true }), disconnected);
});

test('파일 조회는 주소 재작성 우선순위를 보존하고 확인이 어려운 설정에서 프로젝트 키를 반환하지 않는다', t => {
  const { codex: home } = fixture(t);
  const project = join(home, 'project');
  mkdirSync(project);
  git(project, 'init', '--quiet');
  git(project, 'remote', 'add', 'origin', 'example:team/project');
  write(join(home, '.gitconfig'), [
    '[url "https://github.com/"]',
    '  insteadOf = example:',
    '[url "git@github.com:other/"]',
    '  insteadOf = example:team/',
    '',
  ].join('\n'));
  assert.deepEqual(lessonPaths(home, project, { blocked: true }), lessonPaths(home, project));
  fs.appendFileSync(join(project, '.git', 'config'), '\n[includeIf "gitdir:./"]\n  path = additional.conf\n');
  const blocked = locate(home, project, { blocked: true });
  assert.equal(blocked.status, 1);
  assert.equal(blocked.stdout, '');
  assert.match(blocked.stderr, /파일만으로 프로젝트 키를 확인할 수 없습니다/u);
});

test('Git 실행 차단 시 bare 저장소에서 기존 프로젝트 키를 보존한다', t => {
  const { codex: home } = fixture(t);
  const bare = join(home, '저장소.git');
  mkdirSync(bare);
  git(bare, 'init', '--quiet', '--bare');
  assert.deepEqual(lessonPaths(home, bare, { blocked: true }), lessonPaths(home, bare));
});
