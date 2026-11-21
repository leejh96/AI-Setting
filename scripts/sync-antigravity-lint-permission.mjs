import console from 'node:console';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { syncAntigravityFolderPermission } from './antigravity-permission.mjs';

export function syncAntigravityLintPermission(home = homedir()) {
  const gemini = resolve(home, '.gemini');
  return syncAntigravityFolderPermission(gemini, join(gemini, 'lints'), 'read_file', 'lint-permission');
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
