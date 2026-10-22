import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createReviewRequest, watchFailureWarning, terminalWarning } from '../review-request.mjs';
import { hasTerminalReviewStatus } from '../review-status.mjs';
import { checkChanges, prepareChanges, stopChanges, ChangeWatchError } from '../review-changes.mjs';

function warn(message) { if (message) process.stderr.write(`${message}\n`); return {}; }

function printConfig() {
  const quote = process.platform === 'win32'
    ? (value) => `'${value.replaceAll('\\', '/').replace(/['\u2018-\u201b]/g, (char) => char + char)}'`
    : (value) => `'${value.replaceAll("'", "'\\''")}'`;
  const invocation = `${quote(process.execPath)} ${quote(fileURLToPath(import.meta.url))}`;
  // Keep paths out of Antigravity's Windows command tokenizer and cmd expansion.
  const command = (prepare = false) => process.platform === 'win32'
    ? `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(`& ${invocation}${prepare ? ' --prepare' : ''}`, 'utf16le').toString('base64')}`
    : `${invocation}${prepare ? ' --prepare' : ''}`;

  process.stdout.write(`${JSON.stringify({
    'ai-setting-code-quality-review': {
      enabled: true,
      PreInvocation: [{ type: 'command', command: command(true), timeout: 10 }],
      Stop: [
        {
          type: 'command',
          command: command(),
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
  let hasModelResponse = false;
  let lastAssistantMessage = '';
  for (const entry of entries.slice(userIndex + 1)) {
    if (entry?.source === 'SYSTEM' && entry.type === 'SYSTEM_MESSAGE'
        && typeof entry.content === 'string' && entry.content.includes('[code-quality-review:request]\n')) {
      stopHookActive = true;
      lastAssistantMessage = '';
    }
    if (entry?.source === 'MODEL' && entry.type === 'PLANNER_RESPONSE') {
      hasModelResponse = true;
      lastAssistantMessage = typeof entry.content === 'string' ? entry.content : '';
    }
  }

  return { stopHookActive, lastAssistantMessage, hasModelResponse, userIndex };
}

function currentTurn(event) {
  const entries = readFileSync(event.transcriptPath, 'utf8').split(/\r?\n/).filter((line) => line.trim()).map(JSON.parse);
  const turn = analyzeTurn(entries);
  return { ...turn, key: String(turn.userIndex) };
}

async function prepareHook() {
  const event = JSON.parse(readFileSync(0, 'utf8'));
  const turn = currentTurn(event);
  await prepareChanges('gemini', event.conversationId, turn.key, event.workspacePaths, !turn.stopHookActive && !turn.hasModelResponse);
  return { injectSteps: [] };
}

async function runHook() {
  const event = JSON.parse(readFileSync(0, 'utf8'));
  if (!event || typeof event !== 'object' || Array.isArray(event)
      || typeof event.terminationReason !== 'string' || typeof event.fullyIdle !== 'boolean') {
    throw new Error('Invalid Stop event');
  }
  if (!event.fullyIdle || !['model_stop', 'NO_TOOL_CALL'].includes(event.terminationReason)) {
    return {};
  }
  const { stopHookActive, lastAssistantMessage, key } = currentTurn(event);
  let changes;
  try { changes = await checkChanges('gemini', event.conversationId, key, event.workspacePaths); }
  catch (error) {
    if (!(error instanceof ChangeWatchError)) throw error;
    try { await stopChanges('gemini', event.conversationId, key, event.workspacePaths); } catch { /* The failure is reported below. */ }
    return warn(watchFailureWarning);
  }
  if (changes.terminal) return warn(terminalWarning(changes.terminal, changes.failed));
  if (!changes.changed) return {};
  const reason = `[code-quality-review:request]\n${createReviewRequest()}`;

  if (!stopHookActive || !changes.reviewing) {
    const grant = await changes.record('review-requested');
    if (grant.phase === 'closed') return warn(terminalWarning(grant.action, grant.failed));
    return { decision: 'continue', reason };
  }

  if (hasTerminalReviewStatus(lastAssistantMessage)) {
    await changes.record('review-finished');
    return {};
  }

  const grant = await changes.record('review-requested');
  if (grant.phase === 'closed') return warn(terminalWarning(grant.action, grant.failed));
  return { decision: 'continue', reason };
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
    process.stdout.write(`${JSON.stringify(warn(watchFailureWarning))}\n`);
  } else {
    process.stderr.write('코드 품질 검토 훅의 변경 추적 또는 검토를 실행하지 못했습니다. 자동 검토 완료로 간주하지 말고 준비 훅·작업 폴더·대화 기록·REVIEW.md를 확인하세요.\n');
    process.stdout.write('{}\n');
  }
}
