import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { URL } from 'node:url';
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
  assert.equal(existsSync(legacy), false);
  assert.equal(readFileSync(join(lessons, 'shared', 'shared.md'), 'utf8'), 'legacy shared');
  assert.equal(readFileSync(join(lessons, 'projects', 'project-key', 'project.md'), 'utf8'), 'legacy project');
  for (const file of ['SKILL.md', 'scripts/location.mjs', 'scripts/location.ps1', 'references/storage.md']) {
    assert.deepEqual(readFileSync(join(installation, file)), readFileSync(new URL(file, skill)));
  }

  const newLesson = join(lessons, 'shared', 'new.md');
  write(newLesson, 'new lesson');
  assert.ok((await sync()).every(item => item.added === false || item.migrated === 0));
  assert.equal(readFileSync(newLesson, 'utf8'), 'new lesson');
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
  assert.equal(existsSync(legacy), false);
  assert.equal(readFileSync(targetFile, 'utf8'), 'old lesson');
  assert.equal(readFileSync(join(lessons, 'shared', 'new.md'), 'utf8'), 'migrate this');
  assert.equal(readFileSync(join(lessons, 'shared', 'kept.md'), 'utf8'), 'keep this');
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
