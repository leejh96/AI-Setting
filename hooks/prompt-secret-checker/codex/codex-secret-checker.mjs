import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getPromptScanWarning } from '../secret-checker.mjs';

function block(reason) {
  process.stdout.write(`${JSON.stringify({ decision: 'block', reason, systemMessage: reason })}\n`);
}

function printConfig() {
  const quote = process.platform === 'win32'
    ? (value) => `'${value.replaceAll('\\', '/').replace(/['\u2018-\u201b]/g, (char) => char + char)}'`
    : (value) => `'${value.replaceAll("'", "'\\''")}'`;
  const invocation = `${quote(process.execPath)} ${quote(fileURLToPath(import.meta.url))}`;
  const command = process.platform === 'win32' ? `& ${invocation}` : invocation;
  process.stdout.write(`${JSON.stringify({
    description: '사용자 입력의 시크릿 후보를 Gitleaks로 검사합니다.',
    hooks: {
      UserPromptSubmit: [{ hooks: [{ type: 'command', command, timeout: 45 }] }],
    },
  }, null, 2)}\n`);
}

function runHook() {
  let event;
  try {
    event = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    block('시크릿 검사 입력을 읽을 수 없어 요청을 차단했습니다. 훅 설정을 확인하세요.');
    return;
  }

  if (event?.hook_event_name !== 'UserPromptSubmit' || typeof event.prompt !== 'string') {
    block('시크릿 검사 입력 형식이 올바르지 않아 요청을 차단했습니다.');
    return;
  }

  const warning = getPromptScanWarning(event.prompt);
  if (warning) block(`요청을 차단했습니다. ${warning}`);
}

try {
  if (process.argv.length === 3 && process.argv[2] === '--print-config') {
    printConfig();
  } else if (process.argv.length === 2) {
    runHook();
  } else {
    block('시크릿 검사 실행 인자가 올바르지 않아 요청을 차단했습니다.');
  }
} catch {
  block('시크릿 검사를 완료하지 못해 요청을 차단했습니다. 훅 실행 환경을 확인하세요.');
}
