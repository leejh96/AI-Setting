import console from 'node:console';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { URL, pathToFileURL } from 'node:url';
import { syncAntigravityFolderPermission } from './antigravity-permission.mjs';
import { syncCodexDirectoryPermission } from './codex-directory-permission.mjs';
import { ensureInstallDirectory, readInstallFile, replaceInstallFile } from './install-file.mjs';

const source = new URL('../skills/compare-changes/SKILL.md', import.meta.url);

export async function* syncCompareChanges(tool, {
  home = homedir(),
  codex = process.env.CODEX_HOME || join(home, '.codex'),
  codexPermission = syncCodexDirectoryPermission,
} = {}) {
  const gemini = resolve(home, '.gemini');
  const base = tool === 'codex' ? resolve(codex) : join(gemini, 'config');
  const installation = join(base, 'skills', 'compare-changes');
  const artifacts = join(installation, 'artifacts');
  ensureInstallDirectory(installation);
  ensureInstallDirectory(artifacts);

  const path = join(installation, 'SKILL.md');
  const contents = readFileSync(source);
  const original = readInstallFile(path);
  const copied = !original?.equals(contents);
  const backup = copied ? replaceInstallFile(path, original, contents, 'compare-changes') : undefined;
  yield { path, added: copied, backup };

  if (tool === 'codex') {
    yield await codexPermission(join(base, 'config.toml'), artifacts, 'compare-changes-permission');
  } else {
    yield* syncAntigravityFolderPermission(gemini, artifacts, 'write_file', 'compare-changes-permission');
  }
}

async function main(args) {
  const tools = ['codex', 'antigravity'];
  if (args.length > 1 || (args.length === 1 && !tools.includes(args[0]))) {
    throw new Error('사용법: node scripts/sync-compare-changes.mjs [codex|antigravity]');
  }
  for (const tool of args.length ? args : tools) {
    for await (const result of syncCompareChanges(tool)) {
      console.log(`${tool} ${result.added ? '갱신' : '기존 항목 확인'} (${result.path})`);
      if (result.backup) console.log(`변경 전 백업 (${result.backup})`);
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
