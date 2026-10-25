import { readFileSync, existsSync, openSync, fstatSync, readSync, closeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getPromptBlockReason } from '../secret-checker.mjs';

function respondPreInvocation(injectSteps = []) {
  process.stdout.write(`${JSON.stringify({ injectSteps })}\n`);
}

function printConfig() {
  const quote = process.platform === 'win32'
    ? (value) => `"${value.replaceAll('\\', '/')}"`
    : (value) => `'${value.replaceAll("'", "'\\''")}'`;
  const gitleaksBin = process.env.AI_SETTING_GITLEAKS_BIN || '/opt/homebrew/bin/gitleaks';
  const prefix = process.platform === 'win32'
    ? `set AI_SETTING_GITLEAKS_BIN=${quote(gitleaksBin)} && `
    : `AI_SETTING_GITLEAKS_BIN=${quote(gitleaksBin)} `;
  const command = `${prefix}${quote(process.execPath)} ${quote(fileURLToPath(import.meta.url))}`;

  process.stdout.write(`${JSON.stringify({
    'ai-setting-secret-checker': {
      enabled: true,
      PreInvocation: [
        {
          type: 'command',
          command,
          timeout: 45,
        },
      ],
    },
  }, null, 2)}\n`);
}

function latestUserInput(path) {
  const descriptor = openSync(path, 'r');
  try {
    let position = fstatSync(descriptor).size;
    let pending = [];
    let reusable;
    while (position > 0) {
      const length = Math.min(position, 64 * 1024);
      position -= length;
      const chunk = reusable?.length === length ? reusable : Buffer.allocUnsafe(length);
      if (readSync(descriptor, chunk, 0, length, position) !== length) throw new Error('Transcript changed');
      let end = chunk.length;
      for (let index = chunk.lastIndexOf(10); index >= 0; index = index === 0 ? -1 : chunk.lastIndexOf(10, index - 1)) {
        const segment = chunk.subarray(index + 1, end);
        const line = (pending.length ? Buffer.concat([segment, ...pending.reverse()]) : segment).toString('utf8').trim();
        pending = [];
        end = index;
        if (!line) continue;
        const entry = JSON.parse(line);
        if (entry.type === 'USER_INPUT' && typeof entry.content === 'string') return entry.content;
      }
      if (position > 0 && end < chunk.length) {
        pending.push(Buffer.from(chunk.subarray(0, end)));
        reusable = chunk;
      } else {
        pending.push(chunk.subarray(0, end));
        reusable = undefined;
      }
    }
    const line = Buffer.concat(pending.reverse()).toString('utf8').trim();
    if (line) {
      const entry = JSON.parse(line);
      if (entry.type === 'USER_INPUT' && typeof entry.content === 'string') return entry.content;
    }
    return null;
  } finally {
    closeSync(descriptor);
  }
}

function runHook() {
  let event;
  try {
    event = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    respondPreInvocation([]);
    return;
  }

  if (typeof event?.invocationNum === 'number' || event?.transcriptPath) {
    let warning = null;
    if (event.transcriptPath && existsSync(event.transcriptPath)) {
      try {
        const input = latestUserInput(event.transcriptPath);
        if (input !== null) warning = getPromptBlockReason(input);
      } catch {
        // 대화 기록 파싱 오류 시 정상 진행
      }
    }

    if (warning) {
      respondPreInvocation([
        {
          ephemeralMessage: `[보안 경고] 사용자의 최신 입력에서 시크릿 후보가 감지되었습니다 (${warning}). 이 비밀값을 코드, 도구 호출 인자, 터미널 명령, 파일 저장 등에 절대 사용하거나 출력하지 마시고, 사용자에게 시크릿 노출 위험을 알리고 작업을 즉시 중단하세요.`,
        },
      ]);
    } else {
      respondPreInvocation([]);
    }
    return;
  }

  process.stdout.write('{}\n');
}

try {
  if (process.argv.length === 3 && process.argv[2] === '--print-config') {
    printConfig();
  } else if (process.argv.length === 2) {
    runHook();
  } else {
    respondPreInvocation([]);
  }
} catch {
  respondPreInvocation([]);
}
