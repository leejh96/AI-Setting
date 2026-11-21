import console from 'node:console';
import {
  constants, copyFileSync, lstatSync, mkdtempSync, readFileSync, readdirSync, renameSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import process from 'node:process';
import { URL, pathToFileURL } from 'node:url';
import { syncAntigravityFolderPermission } from './antigravity-permission.mjs';
import { syncCodexDirectoryPermission } from './codex-directory-permission.mjs';
import { ensureInstallDirectory, readInstallFile, replaceInstallFile } from './install-file.mjs';

const source = new URL('../skills/task-lessons/', import.meta.url);
const skillFiles = ['SKILL.md', 'references/storage.md', 'scripts/git-files.mjs', 'scripts/location.mjs'];

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
  for (const { from, to } of files) {
    const original = readInstallFile(from);
    if (!original || !readInstallFile(to)?.equals(original)) {
      throw new Error(`교훈을 이전하는 중 파일이 변경되었습니다 (${from} → ${to}).`);
    }
  }
  return files.length;
}

export async function* syncTaskLessons({
  tool = 'codex',
  home = homedir(),
  codex = process.env.CODEX_HOME || join(home, '.codex'),
  override = process.env.CODEX_LESSONS_DIR,
  codexPermission = syncCodexDirectoryPermission,
} = {}) {
  const gemini = resolve(home, '.gemini');
  const base = tool === 'codex' ? resolve(codex) : join(gemini, 'config');
  const installation = join(base, 'skills', 'task-lessons');
  const lessons = join(installation, 'lessons');

  if (tool === 'antigravity') {
    ensureInstallDirectory(installation);
    ensureInstallDirectory(lessons);
    yield* syncAntigravityFolderPermission(gemini, lessons, 'write_file', 'task-lessons-permission');
    yield { path: lessons, storage: true };
  } else {
    if (override && !isAbsolute(override)) throw new Error('교훈 저장 루트는 절대 경로로 지정해야 합니다.');
    if (!override || resolve(override) === lessons) {
      const legacy = join(base, 'task-lessons');
      const receipt = join(lessons, '.legacy-migration-complete');
      const previous = readInstallFile(receipt);
      if (previous && previous.toString('utf8') !== '1\n') throw new Error(`교훈 이전 기록의 형식을 확인하세요 (${receipt}).`);
      const migration = previous ? undefined : planMigration(legacy, lessons);
      ensureInstallDirectory(installation);
      ensureInstallDirectory(lessons);
      yield await codexPermission(join(base, 'config.toml'), lessons, 'task-lessons-permission');
      let migrated = 0;
      if (migration?.directories.length) {
        migrated = migrateLessons(migration);
        replaceInstallFile(receipt, undefined, '1\n', 'task-lessons-migration');
      }
      yield { path: lessons, migrated, ...(migration?.directories.length ? { preserved: legacy } : {}) };
    } else {
      yield { path: override, custom: true };
      ensureInstallDirectory(installation);
    }
  }

  for (const file of skillFiles) {
    const path = join(installation, file);
    const contents = readFileSync(new URL(file, source));
    const original = readInstallFile(path);
    const updated = !original?.equals(contents);
    const backup = updated ? replaceInstallFile(path, original, contents, 'task-lessons-sync') : undefined;
    yield { path, added: updated, backup };
  }

  const retired = join(installation, 'scripts', 'location.ps1');
  if (readInstallFile(retired)) {
    const backupRoot = join(base, 'ai-setting-backups');
    ensureInstallDirectory(backupRoot);
    const backup = join(mkdtempSync(join(backupRoot, 'task-lessons-retired-')), 'location.ps1.bak');
    renameSync(retired, backup);
    yield { path: retired, added: false, retired: true, backup };
  }
}

async function main(args) {
  const tools = ['codex', 'antigravity'];
  if (args.length > 1 || (args.length === 1 && !tools.includes(args[0]))) {
    throw new Error('사용법: node scripts/sync-task-lessons.mjs [codex|antigravity]');
  }
  for (const tool of args.length ? args : tools) {
    for await (const item of syncTaskLessons({ tool })) {
      if (item.custom) console.log(`${tool} 사용자 지정 교훈 경로 사용 (${item.path})`);
      else if (item.migrated !== undefined) console.log(`${tool} 교훈 ${item.migrated}개 이전, 저장 경로 확인 (${item.path})`);
      else if (item.storage) console.log(`${tool} 저장 경로 확인 (${item.path})`);
      else if (item.retired) console.log(`${tool} 이전 PowerShell 실행 파일 정리 (${item.path})`);
      else console.log(`${tool} ${item.added ? '갱신' : '기존 항목 확인'} (${item.path})`);
      if (item.preserved) console.log(`이전 원본 보존 (${item.preserved})`);
      if (item.backup) console.log(`변경 전 백업 (${item.backup})`);
    }
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
