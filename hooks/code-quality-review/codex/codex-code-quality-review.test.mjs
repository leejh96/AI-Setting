import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { stopSession, finishWatch } from '../review-changes.mjs';

const NODE_PATH = process.execPath;
const HOOK_DIR = dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = join(HOOK_DIR, 'codex-code-quality-review.mjs');
const REVIEW_PATH = join(HOOK_DIR, '..', 'REVIEW.md');
const TEST_ROOT = mkdtempSync(join(tmpdir(), 'quality-codex-state-'));
const TEST_ENV = { ...process.env, TMP: TEST_ROOT, TEMP: TEST_ROOT, TMPDIR: TEST_ROOT };
after(async () => {
  const directory = join(TEST_ROOT, 'ai-setting-code-quality-review');
  if (existsSync(directory)) for (const name of readdirSync(directory)) {
    if (/^[a-f0-9]{64}\.json$/.test(name)) await finishWatch(JSON.parse(readFileSync(join(directory, name), 'utf8')));
  }
  rmSync(TEST_ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

assert.ok(existsSync(NODE_PATH), `expected Node executable at ${NODE_PATH}`);
assert.ok(existsSync(HOOK_PATH), `expected hook next to this test: ${HOOK_PATH}`);

function parseOutput(result) {
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr?.trim() || 'hook process failed');
  assert.notEqual(result.stdout.trim(), '', 'hook did not emit JSON');
  return JSON.parse(result.stdout);
}

function runHook(hookPath = HOOK_PATH, args = [], input = '', nodePath = NODE_PATH) {
  return spawnSync(nodePath, [hookPath, ...args], {
    encoding: 'utf8',
    input,
    timeout: 10_000,
    windowsHide: true,
    env: TEST_ENV,
  });
}

async function runEvent(hookPath, event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return parseOutput(runHook(hookPath, [], JSON.stringify(event)));
  const cwd = mkdtempSync(join(TEST_ROOT, 'workspace-'));
  const context = { cwd, session_id: cwd, turn_id: 'test-turn' };
  try {
  writeFileSync(join(cwd, 'code.mjs'), 'export const value = 1;');
  parseOutput(runHook(hookPath, ['--prepare'], JSON.stringify({ ...context, hook_event_name: 'UserPromptSubmit' })));
  writeFileSync(join(cwd, 'code.mjs'), 'export const value = 2;');
  if (event.stop_hook_active) runHook(hookPath, [], JSON.stringify({ ...context, hook_event_name: 'Stop', stop_hook_active: false }));
  return parseOutput(runHook(hookPath, [], JSON.stringify({ ...context, ...event })));
  } finally {
    const before = { TMP: process.env.TMP, TEMP: process.env.TEMP, TMPDIR: process.env.TMPDIR };
    Object.assign(process.env, { TMP: TEST_ROOT, TEMP: TEST_ROOT, TMPDIR: TEST_ROOT });
    try { await stopSession('codex', cwd, [cwd]); }
    finally { for (const [key, value] of Object.entries(before)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
  }
}

function assertWarning(output) {
  assert.equal(typeof output.systemMessage, 'string');
  assert.match(output.systemMessage, /코드 품질 검토/);
  assert.equal('decision' in output, false);
}

function copyHookToTemp({ review } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'codex quality hook-'));
  mkdirSync(join(directory, 'codex'));
  const hookPath = join(directory, 'codex', 'codex-code-quality-review.mjs');
  copyFileSync(HOOK_PATH, hookPath);
  copyFileSync(join(HOOK_DIR, '..', 'review-request.mjs'), join(directory, 'review-request.mjs'));
  copyFileSync(join(HOOK_DIR, '..', 'review-status.mjs'), join(directory, 'review-status.mjs'));
  copyFileSync(join(HOOK_DIR, '..', 'review-changes.mjs'), join(directory, 'review-changes.mjs'));
  copyFileSync(join(HOOK_DIR, '..', 'watch-worker.mjs'), join(directory, 'watch-worker.mjs'));
  if (review !== undefined) {
    writeFileSync(join(directory, 'REVIEW.md'), review, 'utf8');
  }
  return { directory, hookPath };
}

function removeTempDirectory(directory) {
  rmSync(directory, { force: true, recursive: true });
}

function assertReviewRequest(output, hookPath = HOOK_PATH) {
  assert.equal(output.decision, 'block');
  const reviewPath = join(dirname(hookPath), '..', 'REVIEW.md');
  assert.ok(output.reason.includes(JSON.stringify(reviewPath)));
  assert.ok(!output.reason.includes(readFileSync(reviewPath, 'utf8').trim()));
  assert.match(output.reason, /이번 회차에 실제로 읽고/);
}

test('첫 Stop은 본문 대신 적용 판단과 절대 REVIEW 경로를 전달한다', async () => {
  const output = await runEvent(HOOK_PATH, {
    hook_event_name: 'Stop',
    stop_hook_active: false,
  });

  assertReviewRequest(output);
  assert.ok(output.reason.length < readFileSync(REVIEW_PATH, 'utf8').trim().length / 3);
  assert.match(output.reason, /원래 요청/);
  assert.match(output.reason, /서브에이전트/);
  assert.match(output.reason, /동작 설정/);
  assert.match(output.reason, /문서만 변경/);
  assert.match(output.reason, /파일 읽기나 저장소 전체 검색은 하지 마세요/);
  assert.match(output.reason, /\[code-quality-review:skipped\]/);
  assert.match(output.reason, /읽을 수 없으면[\s\S]*\[code-quality-review:blocked\]/);
});

test('실제 수정 없는 일반 질문·문서는 프롬프트 없이 종료한다', async () => {
  for (const operation of ['none', 'documentation']) {
    const cwd = mkdtempSync(join(TEST_ROOT, 'unchanged-'));
    const context = { cwd, session_id: cwd, turn_id: operation };
    writeFileSync(join(cwd, 'code.mjs'), 'before');
    assert.deepEqual(parseOutput(runHook(HOOK_PATH, ['--prepare'], JSON.stringify({ ...context, hook_event_name: 'UserPromptSubmit' }))), {});
    if (operation === 'documentation') writeFileSync(join(cwd, 'README.md'), 'docs');
    assert.deepEqual(parseOutput(runHook(HOOK_PATH, [], JSON.stringify({ ...context, hook_event_name: 'Stop', stop_hook_active: false }))), {}, operation);
  }
});

test('준비 기록 누락은 경고만 남기고 모델을 재개하거나 요청을 차단하지 않는다', async () => {
  const event = { hook_event_name: 'Stop', stop_hook_active: false, cwd: TEST_ROOT, session_id: 'no-preparation', turn_id: 'missing' };
  const output = parseOutput(runHook(HOOK_PATH, [], JSON.stringify(event)));
  assertWarning(output); assert.match(output.systemMessage, /검토 미완료/);
  assertWarning(parseOutput(runHook(HOOK_PATH, [], JSON.stringify({ ...event, stop_hook_active: true }))));
  const prepare = parseOutput(runHook(HOOK_PATH, ['--prepare'], JSON.stringify({ ...event, hook_event_name: 'UserPromptSubmit' })));
  assert.deepEqual(prepare, {});
});

test('이전 턴의 늦은 Stop 실패 정리가 새 턴의 감시를 종료하지 않는다', () => {
  const cwd = mkdtempSync(join(TEST_ROOT, 'late-stop-'));
  const context = { cwd, session_id: cwd };
  for (const turn_id of ['old', 'new']) assert.deepEqual(parseOutput(runHook(HOOK_PATH, ['--prepare'], JSON.stringify({
    ...context, turn_id, hook_event_name: 'UserPromptSubmit',
  }))), {});
  const late = parseOutput(runHook(HOOK_PATH, [], JSON.stringify({ ...context, turn_id: 'old', hook_event_name: 'Stop', stop_hook_active: false })));
  assertWarning(late);
  assert.deepEqual(parseOutput(runHook(HOOK_PATH, [], JSON.stringify({ ...context, turn_id: 'new', hook_event_name: 'Stop', stop_hook_active: false }))), {});
});

test('준비 실패도 사용자 요청 차단이나 모델 프롬프트 주입으로 이어지지 않는다', () => {
  const context = { cwd: join(TEST_ROOT, 'missing-workspace'), session_id: 'prepare-failure', turn_id: 'one' };
  const result = parseOutput(runHook(HOOK_PATH, ['--prepare'], JSON.stringify({ ...context, hook_event_name: 'UserPromptSubmit' })));
  assertWarning(result);
  assert.equal('reason' in result, false);
});

test('무마커·연속 revised의 재요청은 5회로 제한하고 새 사용자 요청에서만 초기화한다', () => {
  for (const last_assistant_message of ['표식 없음', '[code-quality-review:revised]']) {
    const cwd = mkdtempSync(join(TEST_ROOT, 'bounded-'));
    const context = { cwd, session_id: cwd, turn_id: 'one' };
    const prepare = (turn_id = 'one') => parseOutput(runHook(HOOK_PATH, ['--prepare'], JSON.stringify({ ...context, turn_id, hook_event_name: 'UserPromptSubmit' })));
    const stop = (active = true, message = last_assistant_message, turn_id = 'one') => parseOutput(runHook(HOOK_PATH, [], JSON.stringify({
      ...context, turn_id, hook_event_name: 'Stop', stop_hook_active: active, last_assistant_message: message,
    })));
    assert.deepEqual(prepare(), {});
    writeFileSync(join(cwd, 'code.mjs'), 'changed');
    for (let i = 0; i < 5; i++) assertReviewRequest(stop(i > 0));
    for (let i = 0; i < 3; i++) {
      const result = stop(); assertWarning(result); assert.match(result.systemMessage, /5회 상한/);
      assert.deepEqual(prepare(), {});
    }
    assert.deepEqual(prepare('two'), {});
    writeFileSync(join(cwd, 'code.mjs'), 'new request change');
    assertReviewRequest(stop(false, '', 'two'));
    assert.deepEqual(stop(true, '[code-quality-review:clean]', 'two'), {});
    assert.deepEqual(stop(true, '', 'two'), {});
    assert.deepEqual(prepare('two'), {});
  }
});

test('다섯 번째 검토의 유효한 종료 응답을 상한 경고보다 먼저 인정한다', () => {
  for (const status of ['clean', 'skipped', 'blocked']) {
    const cwd = mkdtempSync(join(TEST_ROOT, 'last-pass-'));
    const context = { cwd, session_id: cwd, turn_id: 'one' };
    parseOutput(runHook(HOOK_PATH, ['--prepare'], JSON.stringify({ ...context, hook_event_name: 'UserPromptSubmit' })));
    writeFileSync(join(cwd, 'code.mjs'), 'changed');
    for (let i = 0; i < 5; i++) assertReviewRequest(parseOutput(runHook(HOOK_PATH, [], JSON.stringify({
      ...context, hook_event_name: 'Stop', stop_hook_active: i > 0, last_assistant_message: '[code-quality-review:revised]',
    }))));
    const event = { ...context, hook_event_name: 'Stop', stop_hook_active: true, last_assistant_message: `[code-quality-review:${status}]` };
    assert.deepEqual(parseOutput(runHook(HOOK_PATH, [], JSON.stringify(event))), {});
    assert.deepEqual(parseOutput(runHook(HOOK_PATH, [], JSON.stringify(event))), {});
  }
});

test('수정 회차와 상태 누락은 계속 검토하고 수정 없는 통과 회차에서 종료한다', async () => {
  for (const message of [undefined, null, '', '검토했습니다.', '[code-quality-review:revised]',
    '[code-quality-review:revised]', '[code-quality-review:revised]']) {
    const output = await runEvent(HOOK_PATH, {
      hook_event_name: 'Stop',
      stop_hook_active: true,
      last_assistant_message: message,
    });
    assertReviewRequest(output);
    assert.match(output.reason, /앞 검토 회차에서 변경을 마쳤다는 이유로 제외하지 마세요/);
  }
  assert.deepEqual(await runEvent(HOOK_PATH, {
    hook_event_name: 'Stop', stop_hook_active: true,
    last_assistant_message: '수정 없이 현재 코드 검토 완료\r\n[code-quality-review:clean]\r\n',
  }), {});
});

test('비적용과 해결 불가도 통과로 위장하지 않고 반복을 종료한다', async () => {
  for (const status of ['skipped', 'blocked']) {
    assert.deepEqual(await runEvent(HOOK_PATH, {
      hook_event_name: 'Stop', stop_hook_active: true,
      last_assistant_message: `사유 보고\n[code-quality-review:${status}]`,
    }), {});
  }
});

test('첫 응답의 종료 표식이나 인용·중간 표식·오타로 검토를 생략하지 않는다', async () => {
  for (const status of ['clean', 'skipped', 'blocked']) {
    assert.equal((await runEvent(HOOK_PATH, {
      hook_event_name: 'Stop', stop_hook_active: false,
      last_assistant_message: `[code-quality-review:${status}]`,
    })).decision, 'block');
  }
  for (const message of ['> [code-quality-review:clean]', '```\n[code-quality-review:clean]\n```',
    '[code-quality-review:clean]\n추가 내용', '[code-quality-review:Clean]', '[code-quality-review:unknown]']) {
    assert.equal((await runEvent(HOOK_PATH, {
      hook_event_name: 'Stop', stop_hook_active: true, last_assistant_message: message,
    })).decision, 'block');
  }
});

test('실제 훅은 열린 코드 펜스에서 검토를 계속하고 닫힌 펜스 뒤에서 종료한다', async () => {
  for (const status of ['clean', 'skipped', 'blocked']) {
    const marker = `[code-quality-review:${status}]`;
    assert.equal((await runEvent(HOOK_PATH, {
      hook_event_name: 'Stop', stop_hook_active: true, last_assistant_message: '```text\n\tcode\tvalue\n' + marker,
    })).decision, 'block');
    assert.deepEqual(await runEvent(HOOK_PATH, {
      hook_event_name: 'Stop', stop_hook_active: true, last_assistant_message: '~~~text\n\tcode\tvalue\n~~~~\t\n' + marker,
    }), {});
  }
});

test('null과 배열을 포함한 잘못된 Stop 입력은 안전한 경고를 반환한다', async () => {
  const invalidInputs = [
    null,
    [],
    { hook_event_name: 'Other', stop_hook_active: false },
    { hook_event_name: 'Stop', stop_hook_active: 'false' },
    { hook_event_name: 'Stop', stop_hook_active: 0 },
    { hook_event_name: 'Stop' },
  ];

  for (const input of invalidInputs) {
    assertWarning(await runEvent(HOOK_PATH, input));
  }
});

test('잘못된 JSON과 인자는 반복 없이 경고를 반환한다', async () => {
  assertWarning(parseOutput(runHook(HOOK_PATH, [], '{')));
  assertWarning(parseOutput(runHook(HOOK_PATH, ['--unexpected'])));
});

function assertConfigError(result) {
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '', 'configuration errors must not emit installable JSON');
  assert.match(result.stderr, /설정을 생성하지 못했습니다/);
}

test('--print-config의 잘못된 인자는 stderr와 비정상 종료로 알린다', async () => {
  assertConfigError(runHook(HOOK_PATH, ['--print-config', '--unexpected']));
});

test('REVIEW.md 누락 또는 빈 내용은 경고하고 검토 완료로 위장하지 않는다', async () => {
  for (const review of [undefined, ' \n\t']) {
    const { directory, hookPath } = copyHookToTemp({ review });
    try {
      assertWarning(await runEvent(hookPath, {
        hook_event_name: 'Stop',
        stop_hook_active: false,
      }));
      assertWarning(await runEvent(hookPath, {
        hook_event_name: 'Stop', stop_hook_active: true,
        last_assistant_message: '[code-quality-review:clean]',
      }));
    } finally {
      removeTempDirectory(directory);
    }
  }
});

function assertGeneratedCommand(hookPath, nodePath = NODE_PATH) {
  const config = parseOutput(runHook(hookPath, ['--print-config'], '', nodePath));
  const handler = config?.hooks?.Stop?.[0]?.hooks?.[0];
  assert.equal(handler.type, 'command');
  assert.equal(handler.timeout, 10);
  const command = handler.command;
  assert.equal(typeof command, 'string');
  const normalized = (value) => process.platform === 'win32'
    ? value.replaceAll('\\', '/').replace(/['\u2018-\u201b]/g, (char) => char + char)
    : value.replaceAll("'", "'\\''");
  assert.ok(command.includes(normalized(nodePath)), 'command must use the running Node executable');
  assert.ok(command.includes(normalized(hookPath)), 'command must use the actual hook path');
  const cwd = mkdtempSync(join(TEST_ROOT, 'shell-workspace-'));
  const context = { cwd, session_id: cwd, turn_id: 'shell-turn' };
  writeFileSync(join(cwd, 'code.mjs'), 'export const value = 1;');
  parseOutput(runHook(hookPath, ['--prepare'], JSON.stringify({ ...context, hook_event_name: 'UserPromptSubmit' })));
  writeFileSync(join(cwd, 'code.mjs'), 'export const value = 2;');
  assert.equal(config.hooks.UserPromptSubmit[0].hooks[0].command, `${command} --prepare`);

  for (const [active, message, blocks] of [
    [false, '[code-quality-review:clean]', true],
    [true, '[code-quality-review:revised]', true],
    [true, '[code-quality-review:clean]', false],
  ]) {
    const shell = process.platform === 'win32'
      ? (process.env.CODE_QUALITY_REVIEW_TEST_SHELL ?? 'powershell.exe')
      : '/bin/sh';
    const args = process.platform === 'win32' ? ['-NoProfile', '-Command', command] : ['-c', command];
    const result = spawnSync(shell, args, {
      encoding: 'utf8',
      input: JSON.stringify({ ...context, hook_event_name: 'Stop', stop_hook_active: active, last_assistant_message: message }),
      timeout: 10_000,
      windowsHide: true,
      env: TEST_ENV,
    });
    const output = parseOutput(result);
    if (blocks) assertReviewRequest(output, hookPath);
    else assert.deepEqual(output, {});
  }
}

test('--print-config은 현재 Node와 훅 경로로 실행 가능한 설정을 만든다', async () => {
  assertGeneratedCommand(HOOK_PATH);
});

test('공백이 있는 훅 경로에서도 생성된 명령이 실행된다', async () => {
  const { directory, hookPath } = copyHookToTemp({ review: 'temporary review' });
  try {
    assertGeneratedCommand(hookPath);
  } finally {
    removeTempDirectory(directory);
  }
});

test('작은따옴표가 있는 훅 경로에서도 생성된 명령이 실행된다', async () => {
  const { directory } = copyHookToTemp({ review: 'temporary review' });
  try {
    const hookPath = join(directory, 'codex', "reviewer's hook.mjs");
    copyFileSync(HOOK_PATH, hookPath);
    assertGeneratedCommand(hookPath);
  } finally {
    removeTempDirectory(directory);
  }
});

test('Windows의 공백이 있는 Node 실행 경로에서도 생성된 명령이 실행된다', {
  skip: process.platform !== 'win32',
}, async () => {
  const { directory, hookPath } = copyHookToTemp({ review: 'temporary review' });
  try {
    const nodePath = join(directory, 'node runtime.exe');
    copyFileSync(NODE_PATH, nodePath);
    assertGeneratedCommand(hookPath, nodePath);
  } finally {
    removeTempDirectory(directory);
  }
});

test('Windows의 % 포함 스크립트·Node 경로에서도 생성된 명령이 실행된다', {
  skip: process.platform !== 'win32',
}, async () => {
  const { directory, hookPath } = copyHookToTemp({ review: 'temporary review' });
  try {
    const percentHookPath = join(directory, 'codex', '%QUALITY_REVIEW_TEST%.mjs');
    copyFileSync(HOOK_PATH, percentHookPath);
    assertGeneratedCommand(percentHookPath);

    const percentNodePath = join(directory, '%QUALITY_REVIEW_TEST%.exe');
    copyFileSync(NODE_PATH, percentNodePath);
    assertGeneratedCommand(hookPath, percentNodePath);
  } finally {
    removeTempDirectory(directory);
  }
});

test('셸 구문처럼 보이는 스크립트 경로도 리터럴로 실행한다', async () => {
  const { directory } = copyHookToTemp({ review: 'temporary review' });
  try {
    const hookPath = join(directory, 'codex', "review'; Write-Output 'INJECTED'; #.mjs");
    copyFileSync(HOOK_PATH, hookPath);
    assertGeneratedCommand(hookPath);
  } finally {
    removeTempDirectory(directory);
  }
});

test('PowerShell 변수·백틱·작은따옴표를 포함한 Node 경로를 리터럴로 실행한다', {
  skip: process.platform !== 'win32',
}, async () => {
  const { directory, hookPath } = copyHookToTemp({ review: 'temporary review' });
  try {
    const nodePath = join(directory, "node's O’Connor $value`!%QUALITY_REVIEW_TEST% & (x).exe");
    copyFileSync(NODE_PATH, nodePath);
    assertGeneratedCommand(hookPath, nodePath);
  } finally {
    removeTempDirectory(directory);
  }
});

test('PowerShell이 인식하는 곡선형 작은따옴표 경로도 리터럴로 실행한다', {
  skip: process.platform !== 'win32',
}, async () => {
  const { directory } = copyHookToTemp({ review: 'temporary review' });
  try {
    for (const quote of ['\u2018', '\u2019', '\u201a', '\u201b']) {
      const hookPath = join(directory, 'codex', `O${quote}Connor.mjs`);
      copyFileSync(HOOK_PATH, hookPath);
      assertGeneratedCommand(hookPath);
    }
  } finally {
    removeTempDirectory(directory);
  }
});

test('macOS 형식 Codex 명령을 Windows Git sh에서 검사한다(실제 macOS 실행은 아님)', {
  skip: process.platform !== 'win32' || !process.env.CODE_QUALITY_REVIEW_TEST_POSIX_SHELL,
}, async () => {
  const { directory, hookPath } = copyHookToTemp({ review: 'temporary review' });
  try {
    const target = join(directory, 'codex', "reviewer's 한글 hook.mjs");
    copyFileSync(hookPath, target);
    const code = `Object.defineProperty(process,'platform',{value:'darwin'});Object.defineProperty(process,'execPath',{value:process.execPath.replaceAll('\\\\','/')});process.argv=[process.execPath,${JSON.stringify(target)},'--print-config'];await import(${JSON.stringify(pathToFileURL(target).href)});`;
    const config = parseOutput(spawnSync(NODE_PATH, ['--input-type=module', '-e', code], {
      encoding: 'utf8', windowsHide: true, timeout: 10_000,
    }));
    const command = config.hooks.Stop[0].hooks[0].command;
    const cwd = mkdtempSync(join(TEST_ROOT, 'posix-workspace-'));
    const context = { cwd, session_id: cwd, turn_id: 'posix-turn' };
    writeFileSync(join(cwd, 'code.mjs'), 'before');
    parseOutput(runHook(target, ['--prepare'], JSON.stringify({ ...context, hook_event_name: 'UserPromptSubmit' })));
    writeFileSync(join(cwd, 'code.mjs'), 'after');
    const output = parseOutput(spawnSync(process.env.CODE_QUALITY_REVIEW_TEST_POSIX_SHELL, ['-c', command], {
      input: JSON.stringify({ ...context, hook_event_name: 'Stop', stop_hook_active: false }),
      encoding: 'utf8', windowsHide: true, timeout: 10_000, env: TEST_ENV,
    }));
    assertReviewRequest(output, target);
  } finally {
    removeTempDirectory(directory);
  }
});
