import console from 'node:console';
import {
  constants, copyFileSync, lstatSync, readFileSync, readdirSync, rmdirSync, unlinkSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import process from 'node:process';
import { URL, pathToFileURL } from 'node:url';
import { syncCodexDirectoryPermission } from './codex-directory-permission.mjs';
import { ensureInstallDirectory, readInstallFile, replaceInstallFile } from './install-file.mjs';

const source = new URL('../skills/task-lessons/', import.meta.url);
const skillFiles = ['SKILL.md', 'references/storage.md', 'scripts/location.mjs', 'scripts/location.ps1'];

function planMigration(legacy, lessons) {
  const directories = [];
  const files = [];
  function inspect(from, to) {
    const old = lstatSync(from);
    const current = lstatSync(to, { throwIfNoEntry: false });
    if (old.isDirectory() && (!current || current.isDirectory())) {
      directories.push({ from, to });
      for (const name of readdirSync(from)) inspect(join(from, name), join(to, name));
      return;
    }
    if (!old.isFile() || (current && (!current.isFile() || !readFileSync(from).equals(readFileSync(to))))) {
      throw new Error(`교훈 이전 대상이 충돌합니다 (${from} → ${to}).`);
    }
    files.push({ from, to });
  }
  const oldRoot = lstatSync(legacy, { throwIfNoEntry: false });
  if (oldRoot && !oldRoot.isDirectory()) throw new Error(`기존 교훈 경로가 실제 디렉터리가 아닙니다 (${legacy}).`);
  if (oldRoot) inspect(legacy, lessons);
  return { directories, files };
}

function migrateLessons({ directories, files }) {
  for (const { to } of directories) ensureInstallDirectory(to);
  for (const { from, to } of files) {
    if (!readInstallFile(to)) copyFileSync(from, to, constants.COPYFILE_EXCL);
  }
  // Leave the legacy records in place until every destination is verified.
  for (const { from, to } of files) {
    const original = readInstallFile(from);
    if (!original || !readInstallFile(to)?.equals(original)) {
      throw new Error(`교훈을 이전하는 중 파일이 변경되었습니다 (${from} → ${to}).`);
    }
  }
  for (const { from } of files) unlinkSync(from);
  for (const { from } of directories.reverse()) rmdirSync(from);
  return files.length;
}

export async function* syncTaskLessons({
  codex = process.env.CODEX_HOME || join(homedir(), '.codex'),
  override = process.env.CODEX_LESSONS_DIR,
  codexPermission = syncCodexDirectoryPermission,
} = {}) {
  const home = resolve(codex);
  const installation = join(home, 'skills', 'task-lessons');
  const lessons = join(installation, 'lessons');
  const legacy = join(home, 'task-lessons');
  if (override && !isAbsolute(override)) throw new Error('교훈 저장 루트는 절대 경로로 지정해야 합니다.');

  if (!override || resolve(override) === lessons) {
    const migration = planMigration(legacy, lessons);
    ensureInstallDirectory(installation);
    ensureInstallDirectory(lessons);
    yield await codexPermission(join(home, 'config.toml'), lessons, 'task-lessons-permission');
    yield { path: lessons, migrated: migrateLessons(migration) };
  } else {
    yield { path: override, custom: true };
    ensureInstallDirectory(installation);
  }

  for (const file of skillFiles) {
    const path = join(installation, file);
    const contents = readFileSync(new URL(file, source));
    const original = readInstallFile(path);
    const updated = !original?.equals(contents);
    const backup = updated ? replaceInstallFile(path, original, contents, 'task-lessons-sync') : undefined;
    yield { path, added: updated, backup };
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    for await (const item of syncTaskLessons()) {
      if (item.custom) console.log(`사용자 지정 교훈 경로 사용 (${item.path})`);
      else if (item.migrated !== undefined) console.log(`교훈 ${item.migrated}개 이전, 저장 경로 확인 (${item.path})`);
      else console.log(`${item.added ? '갱신' : '기존 항목 확인'} (${item.path})`);
      if (item.backup) console.log(`변경 전 백업 (${item.backup})`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
