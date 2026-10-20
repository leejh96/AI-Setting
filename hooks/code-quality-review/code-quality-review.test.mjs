import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const NODE_PATH = process.execPath;
const HOOK_DIR = dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = join(HOOK_DIR, 'code-quality-review.mjs');
const REVIEW_PATH = join(HOOK_DIR, 'REVIEW.md');

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
  });
}

function runEvent(hookPath, event) {
  return parseOutput(runHook(hookPath, [], JSON.stringify(event)));
}

function assertWarning(output) {
  assert.equal(typeof output.systemMessage, 'string');
  assert.match(output.systemMessage, /코드 품질 검토 훅/);
  assert.equal('decision' in output, false);
}

function copyHookToTemp({ review } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'codex quality hook-'));
  const hookPath = join(directory, 'code-quality-review.mjs');
  copyFileSync(HOOK_PATH, hookPath);
  if (review !== undefined) {
    writeFileSync(join(directory, 'REVIEW.md'), review, 'utf8');
  }
  return { directory, hookPath };
}

function removeTempDirectory(directory) {
  rmSync(directory, { force: true, recursive: true });
}

test('첫 Stop은 REVIEW 지시를 전달하고 원래 사용자 변경 보호를 포함한다', () => {
  const output = runEvent(HOOK_PATH, {
    hook_event_name: 'Stop',
    stop_hook_active: false,
  });

  assert.equal(output.decision, 'block');
  assert.equal(output.reason, readFileSync(REVIEW_PATH, 'utf8').trim());
  assert.match(output.reason, /원래 사용자 요청/);
  assert.match(output.reason, /기존 사용자 변경/);
  assert.match(output.reason, /보존/);
});

test('수정 회차와 상태 누락은 계속 검토하고 수정 없는 통과 회차에서 종료한다', () => {
  for (const message of [undefined, null, '', '검토했습니다.', '[code-quality-review:revised]',
    '[code-quality-review:revised]', '[code-quality-review:revised]']) {
    const output = runEvent(HOOK_PATH, {
      hook_event_name: 'Stop',
      stop_hook_active: true,
      last_assistant_message: message,
    });
    assert.equal(output.decision, 'block');
    assert.equal(output.reason, readFileSync(REVIEW_PATH, 'utf8').trim());
  }
  assert.deepEqual(runEvent(HOOK_PATH, {
    hook_event_name: 'Stop', stop_hook_active: true,
    last_assistant_message: '수정 없이 현재 코드 검토 완료\r\n[code-quality-review:clean]\r\n',
  }), {});
});

test('비적용과 해결 불가도 통과로 위장하지 않고 반복을 종료한다', () => {
  for (const status of ['skipped', 'blocked']) {
    assert.deepEqual(runEvent(HOOK_PATH, {
      hook_event_name: 'Stop', stop_hook_active: true,
      last_assistant_message: `사유 보고\n[code-quality-review:${status}]`,
    }), {});
  }
});

test('첫 응답의 종료 표식이나 인용·중간 표식·오타로 검토를 생략하지 않는다', () => {
  for (const status of ['clean', 'skipped', 'blocked']) {
    assert.equal(runEvent(HOOK_PATH, {
      hook_event_name: 'Stop', stop_hook_active: false,
      last_assistant_message: `[code-quality-review:${status}]`,
    }).decision, 'block');
  }
  for (const message of ['> [code-quality-review:clean]', '```\n[code-quality-review:clean]\n```',
    '[code-quality-review:clean]\n추가 내용', '[code-quality-review:Clean]', '[code-quality-review:unknown]']) {
    assert.equal(runEvent(HOOK_PATH, {
      hook_event_name: 'Stop', stop_hook_active: true, last_assistant_message: message,
    }).decision, 'block');
  }
});

test('null과 배열을 포함한 잘못된 Stop 입력은 안전한 경고를 반환한다', () => {
  const invalidInputs = [
    null,
    [],
    { hook_event_name: 'Other', stop_hook_active: false },
    { hook_event_name: 'Stop', stop_hook_active: 'false' },
    { hook_event_name: 'Stop', stop_hook_active: 0 },
    { hook_event_name: 'Stop' },
  ];

  for (const input of invalidInputs) {
    assertWarning(runEvent(HOOK_PATH, input));
  }
});

test('잘못된 JSON과 인자는 반복 없이 경고를 반환한다', () => {
  assertWarning(parseOutput(runHook(HOOK_PATH, [], '{')));
  assertWarning(parseOutput(runHook(HOOK_PATH, ['--unexpected'])));
});

function assertConfigError(result) {
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '', 'configuration errors must not emit installable JSON');
  assert.match(result.stderr, /설정을 생성하지 못했습니다/);
}

test('--print-config의 잘못된 인자는 stderr와 비정상 종료로 알린다', () => {
  assertConfigError(runHook(HOOK_PATH, ['--print-config', '--unexpected']));
});

test('REVIEW.md 누락 또는 빈 내용은 경고하고 검토 완료로 위장하지 않는다', () => {
  for (const review of [undefined, ' \n\t']) {
    const { directory, hookPath } = copyHookToTemp({ review });
    try {
      assertWarning(runEvent(hookPath, {
        hook_event_name: 'Stop',
        stop_hook_active: false,
      }));
      assertWarning(runEvent(hookPath, {
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
      input: JSON.stringify({ hook_event_name: 'Stop', stop_hook_active: active, last_assistant_message: message }),
      timeout: 10_000,
      windowsHide: true,
    });
    const output = parseOutput(result);
    assert.deepEqual(output, blocks ? {
      decision: 'block', reason: readFileSync(join(dirname(hookPath), 'REVIEW.md'), 'utf8').trim(),
    } : {});
  }
}

test('--print-config은 현재 Node와 훅 경로로 실행 가능한 설정을 만든다', () => {
  assertGeneratedCommand(HOOK_PATH);
});

test('공백이 있는 훅 경로에서도 생성된 명령이 실행된다', () => {
  const { directory, hookPath } = copyHookToTemp({ review: 'temporary review' });
  try {
    assertGeneratedCommand(hookPath);
  } finally {
    removeTempDirectory(directory);
  }
});

test('작은따옴표가 있는 훅 경로에서도 생성된 명령이 실행된다', () => {
  const { directory } = copyHookToTemp({ review: 'temporary review' });
  try {
    const hookPath = join(directory, "reviewer's hook.mjs");
    copyFileSync(HOOK_PATH, hookPath);
    assertGeneratedCommand(hookPath);
  } finally {
    removeTempDirectory(directory);
  }
});

test('Windows의 공백이 있는 Node 실행 경로에서도 생성된 명령이 실행된다', {
  skip: process.platform !== 'win32',
}, () => {
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
}, () => {
  const { directory, hookPath } = copyHookToTemp({ review: 'temporary review' });
  try {
    const percentHookPath = join(directory, '%QUALITY_REVIEW_TEST%.mjs');
    copyFileSync(HOOK_PATH, percentHookPath);
    assertGeneratedCommand(percentHookPath);

    const percentNodePath = join(directory, '%QUALITY_REVIEW_TEST%.exe');
    copyFileSync(NODE_PATH, percentNodePath);
    assertGeneratedCommand(hookPath, percentNodePath);
  } finally {
    removeTempDirectory(directory);
  }
});

test('셸 구문처럼 보이는 스크립트 경로도 리터럴로 실행한다', () => {
  const { directory } = copyHookToTemp({ review: 'temporary review' });
  try {
    const hookPath = join(directory, "review'; Write-Output 'INJECTED'; #.mjs");
    copyFileSync(HOOK_PATH, hookPath);
    assertGeneratedCommand(hookPath);
  } finally {
    removeTempDirectory(directory);
  }
});

test('PowerShell 변수·백틱·작은따옴표를 포함한 Node 경로를 리터럴로 실행한다', {
  skip: process.platform !== 'win32',
}, () => {
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
}, () => {
  const { directory } = copyHookToTemp({ review: 'temporary review' });
  try {
    for (const quote of ['\u2018', '\u2019', '\u201a', '\u201b']) {
      const hookPath = join(directory, `O${quote}Connor.mjs`);
      copyFileSync(HOOK_PATH, hookPath);
      assertGeneratedCommand(hookPath);
    }
  } finally {
    removeTempDirectory(directory);
  }
});
