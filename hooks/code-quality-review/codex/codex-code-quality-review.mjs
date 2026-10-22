import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createReviewRequest, watchFailureWarning, terminalWarning } from '../review-request.mjs';
import { hasTerminalReviewStatus } from '../review-status.mjs';
import { checkChanges, prepareChanges, stopChanges, ChangeWatchError } from '../review-changes.mjs';

const warn = (message) => message ? { systemMessage: message } : {};

function printConfig() {
  const scriptPath = fileURLToPath(import.meta.url);
  const quote = process.platform === 'win32'
    ? (value) => `'${value.replaceAll('\\', '/').replace(/['\u2018-\u201b]/g, (char) => char + char)}'`
    : (value) => `'${value.replaceAll("'", "'\\''")}'`;
  const invocation = `${quote(process.execPath)} ${quote(scriptPath)}`;
  const command = process.platform === 'win32' ? `& ${invocation}` : invocation;
  process.stdout.write(`${JSON.stringify({
    hooks: {
      UserPromptSubmit: [{ hooks: [{
        type: 'command', command: `${command} --prepare`, timeout: 10,
        statusMessage: '코드 변경 비교 준비',
      }] }],
      Stop: [{ hooks: [{
        type: 'command', command, timeout: 10,
        statusMessage: '완료 전 코드 품질 검토 확인',
      }] }],
    },
  }, null, 2)}\n`);
}

async function runHook() {
  const event = JSON.parse(readFileSync(0, 'utf8'));
  if (event?.hook_event_name !== 'Stop' || typeof event.stop_hook_active !== 'boolean') {
    throw new Error('Invalid Stop hook event');
  }
  let changes;
  try { changes = await checkChanges('codex', event.session_id, event.turn_id, [event.cwd]); }
  catch (error) {
    if (!(error instanceof ChangeWatchError)) throw error;
    try { await stopChanges('codex', event.session_id, event.turn_id, [event.cwd]); } catch { /* The failure is reported below. */ }
    return { systemMessage: watchFailureWarning };
  }
  if (changes.terminal) return warn(terminalWarning(changes.terminal, changes.failed));
  if (!changes.changed) return {};
  const reason = createReviewRequest();
  // Only a review continuation can finish this gate; initial answers cannot skip it.
  if (changes.reviewing && event.stop_hook_active && hasTerminalReviewStatus(event.last_assistant_message)) {
    await changes.record('review-finished');
    return {};
  }
  const grant = await changes.record('review-requested');
  if (grant.phase === 'closed') return warn(terminalWarning(grant.action, grant.failed));
  return { decision: 'block', reason };
}

async function prepareHook() {
  const event = JSON.parse(readFileSync(0, 'utf8'));
  if (event?.hook_event_name !== 'UserPromptSubmit') throw new Error('Invalid preparation event');
  await prepareChanges('codex', event.session_id, event.turn_id, [event.cwd]);
  return {};
}

try {
  if (process.argv.length === 3 && process.argv[2] === '--print-config') {
    printConfig();
  } else if (process.argv.length === 3 && process.argv[2] === '--prepare') {
    process.stdout.write(`${JSON.stringify(await prepareHook())}\n`);
  } else if (process.argv.length === 2) {
    process.stdout.write(`${JSON.stringify(await runHook())}\n`);
  } else {
    throw new Error('Invalid arguments');
  }
} catch (error) {
  if (process.argv.includes('--print-config')) {
    process.stderr.write('코드 품질 검토 훅 설정을 생성하지 못했습니다. 실행 인자와 Node·스크립트 경로를 확인하세요.\n');
    process.exitCode = 1;
  } else if (process.argv[2] === '--prepare' && error instanceof ChangeWatchError) {
    process.stdout.write(`${JSON.stringify({ systemMessage: watchFailureWarning })}\n`);
  } else {
    // A broken hook must be visible, without restarting the turn indefinitely.
    process.stdout.write(`${JSON.stringify({
      systemMessage: '코드 품질 검토 훅의 변경 추적 또는 검토를 실행하지 못했습니다. 자동 검토 완료로 간주하지 말고 준비 훅·작업 폴더·REVIEW.md를 확인하세요.',
    })}\n`);
  }
}
