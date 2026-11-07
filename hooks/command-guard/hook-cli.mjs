import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inspectCommand } from './command-guard.mjs';

export function hookCommand(url, antigravity) {
  const paths = [process.execPath, fileURLToPath(url)];
  if (process.platform !== 'win32') {
    return paths.map(value => "'" + value.replaceAll("'", "'\\''") + "'").join(' ');
  }
  const normalized = paths.map(value => value.replaceAll('\\', '/'));
  const invocation = '& ' + normalized.map(value =>
    "'" + value.replace(/['\u2018-\u201b]/g, char => char + char) + "'").join(' ');
  if (!antigravity) return invocation;
  if (normalized.every(value => /^[a-z]:\/[\w./-]+$/i.test(value))) return normalized.join(' ');
  const encoded = Buffer.from(invocation, 'utf16le').toString('base64');
  return 'powershell.exe -NoProfile -NonInteractive -EncodedCommand ' + encoded;
}

export function runHook(config, parseEvent, respond) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--print-config') {
    process.stdout.write(JSON.stringify(config(), null, 2) + '\n');
    return;
  }
  if (args.length) {
    process.stderr.write('사용법을 확인하세요. 훅 설정을 생성하려면 --print-config만 전달하세요.\n');
    process.exitCode = 1;
    return;
  }
  let result;
  try {
    const payload = JSON.parse(readFileSync(0, 'utf8'));
    const { command, cwd } = parseEvent(payload);
    if (typeof command !== 'string' || !command.trim() || typeof cwd !== 'string' || !cwd) {
      throw new Error('Missing shell command or working directory');
    }
    result = inspectCommand(command, cwd);
  } catch {
    result = { decision: 'deny', reason: '명령 검사 입력이나 실행 환경을 확인할 수 없어 차단했습니다.' };
  }
  process.stdout.write(JSON.stringify(respond(result)) + '\n');
}
