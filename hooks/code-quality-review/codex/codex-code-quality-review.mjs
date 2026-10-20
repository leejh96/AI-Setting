import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createReviewRequest } from '../review-request.mjs';
import { hasTerminalReviewStatus } from '../review-status.mjs';

function printConfig() {
  const scriptPath = fileURLToPath(import.meta.url);
  const quote = process.platform === 'win32'
    ? (value) => `'${value.replaceAll('\\', '/').replace(/['\u2018-\u201b]/g, (char) => char + char)}'`
    : (value) => `'${value.replaceAll("'", "'\\''")}'`;
  const invocation = `${quote(process.execPath)} ${quote(scriptPath)}`;
  const command = process.platform === 'win32' ? `& ${invocation}` : invocation;
  process.stdout.write(`${JSON.stringify({
    hooks: {
      Stop: [{ hooks: [{
        type: 'command', command, timeout: 10,
        statusMessage: '완료 전 코드 품질 검토 확인',
      }] }],
    },
  }, null, 2)}\n`);
}

function runHook() {
  const event = JSON.parse(readFileSync(0, 'utf8'));
  if (event?.hook_event_name !== 'Stop' || typeof event.stop_hook_active !== 'boolean') {
    throw new Error('Invalid Stop hook event');
  }
  const reason = createReviewRequest();
  // Only a review continuation can finish this gate; initial answers cannot skip it.
  if (event.stop_hook_active && hasTerminalReviewStatus(event.last_assistant_message)) {
    return {};
  }
  return { decision: 'block', reason };
}

try {
  if (process.argv.length === 3 && process.argv[2] === '--print-config') {
    printConfig();
  } else if (process.argv.length === 2) {
    process.stdout.write(`${JSON.stringify(runHook())}\n`);
  } else {
    throw new Error('Invalid arguments');
  }
} catch {
  if (process.argv.includes('--print-config')) {
    process.stderr.write('코드 품질 검토 훅 설정을 생성하지 못했습니다. 실행 인자와 Node·스크립트 경로를 확인하세요.\n');
    process.exitCode = 1;
  } else {
    // A broken hook must be visible, without restarting the turn indefinitely.
    process.stdout.write(`${JSON.stringify({
      systemMessage: '코드 품질 검토 훅을 실행하지 못했습니다. 자동 검토 완료로 간주하지 말고 훅 입력과 REVIEW.md를 확인하세요.',
    })}\n`);
  }
}
