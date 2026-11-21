import console from 'node:console';
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

function readConfig(path) {
  const entry = lstatSync(path, { throwIfNoEntry: false });
  if (!entry) return undefined;
  if (!entry.isFile()) throw new Error(`설정 경로가 일반 파일이 아닙니다 (${path}).`);
  return readFileSync(path);
}

function permissionLists(config, keys, path) {
  let section = config;
  for (const key of keys) {
    if (!section || typeof section !== 'object' || Array.isArray(section)) break;
    if (!Object.hasOwn(section, key)) section[key] = {};
    section = section[key];
  }
  if (!section || typeof section !== 'object' || Array.isArray(section)) {
    throw new Error(`Antigravity 권한 설정이 객체가 아닙니다 (${path}).`);
  }
  for (const key of ['allow', 'ask', 'deny']) {
    if (Object.hasOwn(section, key) && (!Array.isArray(section[key]) || section[key].some(rule => typeof rule !== 'string'))) {
      throw new Error(`Antigravity 권한 목록 ${key}의 형식을 확인하세요 (${path}).`);
    }
  }
  return section;
}

function coversLintFolder(rule, lintFolder, includeWrite = false) {
  const match = /^(read_file|write_file)\((.+)\)$/su.exec(rule.trim());
  if (!match || (!includeWrite && match[1] === 'write_file')) return false;
  const target = match[2];
  if (target === '*') return true;
  if (!isAbsolute(target)) return false;
  const suffix = relative(target, lintFolder);
  return suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix);
}

function updateConfig(path, keys, lintFolder) {
  const original = readConfig(path);
  let config = {};
  if (original) {
    try {
      config = JSON.parse(original.toString('utf8').replace(/^\uFEFF/, ''));
    } catch {
      throw new Error(`Antigravity 설정이 올바른 JSON인지 확인하세요 (${path}).`);
    }
  }
  const lists = permissionLists(config, keys, path);
  for (const key of ['deny', 'ask']) {
    if (lists[key]?.some(rule => coversLintFolder(rule, lintFolder))) {
      throw new Error(`기존 ${key} 규칙이 전역 린트 읽기에 적용됩니다 (${path}).`);
    }
  }
  if (lists.allow?.some(rule => coversLintFolder(rule, lintFolder, true))) return { path, added: false };
  const target = process.platform === 'win32' ? lintFolder.replaceAll('\\', '/') : lintFolder;
  lists.allow = [...(lists.allow ?? []), `read_file(${target})`];

  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const suffix = randomUUID();
  const backup = original ? `${path}.lint-permission-${suffix}.bak` : undefined;
  const temporary = `${path}.lint-permission-${suffix}.tmp`;
  const privateFile = { flag: 'wx', mode: 0o600 };
  try {
    writeFileSync(temporary, JSON.stringify(config, null, 2) + '\n', privateFile);
    const current = readConfig(path);
    if (original ? !current?.equals(original) : current) {
      throw new Error(`동기화 중 Antigravity 설정이 변경되었습니다 (${path}). 다시 실행하세요.`);
    }
    if (backup) writeFileSync(backup, original, privateFile);
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
  return { path, added: true, backup };
}

export function* syncAntigravityLintPermission(home = homedir()) {
  const gemini = resolve(home, '.gemini');
  const lintFolder = join(gemini, 'lints');
  const cliDirectory = join(gemini, 'antigravity-cli');
  yield updateConfig(join(gemini, 'config', 'config.json'), ['userSettings', 'globalPermissionGrants'], lintFolder);
  if (existsSync(cliDirectory)) {
    yield updateConfig(join(cliDirectory, 'settings.json'), ['permissions'], lintFolder);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    for (const result of syncAntigravityLintPermission()) {
      const status = result.added ? '읽기 권한 추가' : '기존 읽기 권한 확인';
      console.log(`${status} (${result.path})`);
      if (result.backup) console.log(`변경 전 설정 백업 (${result.backup})`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
