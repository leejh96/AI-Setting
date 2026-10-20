import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createReviewRequest } from '../review-request.mjs';
import { hasTerminalReviewStatus } from '../review-status.mjs';

function printConfig() {
  const quote = process.platform === 'win32'
    ? (value) => `'${value.replaceAll('\\', '/').replace(/['\u2018-\u201b]/g, (char) => char + char)}'`
    : (value) => `'${value.replaceAll("'", "'\\''")}'`;
  const invocation = `${quote(process.execPath)} ${quote(fileURLToPath(import.meta.url))}`;
  // Keep paths out of Antigravity's Windows command tokenizer and cmd expansion.
  const command = process.platform === 'win32'
    ? `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(`& ${invocation}`, 'utf16le').toString('base64')}`
    : invocation;

  process.stdout.write(`${JSON.stringify({
    'ai-setting-code-quality-review': {
      enabled: true,
      Stop: [
        {
          type: 'command',
          command,
          timeout: 30,
        },
      ],
    },
  }, null, 2)}\n`);
}

function analyzeTurn(entries) {
  const userIndex = entries.findLastIndex((entry) => entry?.type === 'USER_INPUT' && entry.source === 'USER_EXPLICIT');
  if (userIndex === -1) throw new Error('Missing user turn');
  let stopHookActive = false;
  let lastAssistantMessage = '';
  for (const entry of entries.slice(userIndex + 1)) {
    if (entry?.source === 'SYSTEM' && entry.type === 'SYSTEM_MESSAGE'
        && typeof entry.content === 'string' && entry.content.includes('[code-quality-review:request]\n')) {
      stopHookActive = true;
      lastAssistantMessage = '';
    }
    if (entry?.source === 'MODEL' && entry.type === 'PLANNER_RESPONSE') {
      lastAssistantMessage = typeof entry.content === 'string' ? entry.content : '';
    }
  }

  return { stopHookActive, lastAssistantMessage };
}

function runHook() {
  const event = JSON.parse(readFileSync(0, 'utf8'));
  if (!event || typeof event !== 'object' || Array.isArray(event)
      || typeof event.terminationReason !== 'string' || typeof event.fullyIdle !== 'boolean') {
    throw new Error('Invalid Stop event');
  }
  if (!event.fullyIdle || !['model_stop', 'NO_TOOL_CALL'].includes(event.terminationReason)) {
    return {};
  }
  const reason = `[code-quality-review:request]\n${createReviewRequest()}`;
  const entries = readFileSync(event.transcriptPath, 'utf8').split(/\r?\n/).filter((line) => line.trim()).map(JSON.parse);
  const { stopHookActive, lastAssistantMessage } = analyzeTurn(entries);

  if (!stopHookActive) {
    return { decision: 'continue', reason };
  }

  if (hasTerminalReviewStatus(lastAssistantMessage)) {
    return {};
  }

  return { decision: 'continue', reason };
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
    process.stderr.write('코드 품질 검토 훅을 실행하지 못했습니다. 자동 검토 완료로 간주하지 말고 훅 입력·대화 기록·REVIEW.md를 확인하세요.\n');
    process.stdout.write('{}\n');
  }
}
