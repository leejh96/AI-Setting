import { randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const privateFile = { flag: 'wx', mode: 0o600 };

export function ensureInstallDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  if (!lstatSync(path).isDirectory()) throw new Error(`설치 경로가 실제 디렉터리가 아닙니다 (${path}).`);
}

export function readInstallFile(path) {
  const entry = lstatSync(path, { throwIfNoEntry: false });
  if (!entry) return undefined;
  if (!entry.isFile()) throw new Error(`설치 경로가 일반 파일이 아닙니다 (${path}).`);
  return readFileSync(path);
}

export function backupInstallFile(path, original, label) {
  if (!original) return undefined;
  const backup = `${path}.${label}-${randomUUID()}.bak`;
  writeFileSync(backup, original, privateFile);
  return backup;
}

export function replaceInstallFile(path, original, contents, label) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${label}-${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, contents, privateFile);
    const current = readInstallFile(path);
    if (original ? !current?.equals(original) : current) {
      throw new Error(`동기화 중 파일이 변경되었습니다 (${path}). 다시 실행하세요.`);
    }
    const backup = backupInstallFile(path, original, label);
    renameSync(temporary, path);
    return backup;
  } finally {
    rmSync(temporary, { force: true });
  }
}
