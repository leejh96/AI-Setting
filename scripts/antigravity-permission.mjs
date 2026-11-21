import { existsSync, mkdirSync, rmdirSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import process from 'node:process';
import { readInstallFile, replaceInstallFile } from './install-file.mjs';

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

function coversFolder(rule, folder, actions) {
  const match = /^(read_file|write_file)\((.+)\)$/su.exec(rule.trim());
  if (!match || !actions.includes(match[1])) return false;
  const target = match[2];
  if (target === '*') return true;
  if (!isAbsolute(target)) return false;
  const suffix = relative(target, folder);
  return suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix);
}

function updatePermission(path, keys, folder, action, label) {
  const original = readInstallFile(path);
  let config = {};
  if (original) {
    try {
      config = JSON.parse(original.toString('utf8').replace(/^\uFEFF/, ''));
    } catch {
      throw new Error(`Antigravity 설정이 올바른 JSON인지 확인하세요 (${path}).`);
    }
  }
  const lists = permissionLists(config, keys, path);
  const fileActions = ['read_file', 'write_file'];
  const restricted = action === 'write_file' ? fileActions : ['read_file'];
  for (const key of ['deny', 'ask']) {
    if (lists[key]?.some(rule => coversFolder(rule, folder, restricted))) {
      throw new Error(`기존 ${key} 규칙이 ${folder} 접근에 적용됩니다 (${path}).`);
    }
  }
  const allowed = action === 'write_file' ? ['write_file'] : fileActions;
  if (lists.allow?.some(rule => coversFolder(rule, folder, allowed))) return { path, added: false };
  const target = process.platform === 'win32' ? folder.replaceAll('\\', '/') : folder;
  lists.allow = [...(lists.allow ?? []), `${action}(${target})`];
  const backup = replaceInstallFile(path, original, JSON.stringify(config, null, 2) + '\n', label);
  return { path, added: true, backup };
}

function syncPermissionFile(path, keys, folder, action, label) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const lock = path + '.ai-setting-permissions.lock';
  try {
    mkdirSync(lock, { mode: 0o700 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    throw new Error(`다른 Antigravity 권한 동기화가 진행 중입니다. 잠금을 확인한 뒤 다시 실행하세요 (${lock}).`, { cause: error });
  }
  try {
    return updatePermission(path, keys, folder, action, label);
  } finally {
    rmdirSync(lock);
  }
}

export function* syncAntigravityFolderPermission(gemini, folder, action, label) {
  const cliDirectory = join(gemini, 'antigravity-cli');
  yield syncPermissionFile(join(gemini, 'config', 'config.json'), ['userSettings', 'globalPermissionGrants'], folder, action, label);
  if (existsSync(cliDirectory)) {
    yield syncPermissionFile(join(cliDirectory, 'settings.json'), ['permissions'], folder, action, label);
  }
}
