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

const NODE_PATH = 'C:\\nvm4w\\nodejs\\node.exe';
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

function runHook(hookPath = HOOK_PATH, args = [], input = '') {
  return spawnSync(NODE_PATH, [hookPath, ...args], {
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
  const directory = mkdtempSync(join(tmpdir(), 'codex-quality-hook-'));
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

test('첫 Stop은 REVIEW 지시를 한 번 전달하고 원래 사용자 변경 보호를 포함한다', () => {
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

test('stop_hook_active true는 REVIEW.md가 없어도 재요청하지 않는다', () => {
  const { directory, hookPath } = copyHookToTemp();
  try {
    const output = runEvent(hookPath, {
      hook_event_name: 'Stop',
      stop_hook_active: true,
    });
    assert.deepEqual(output, {});
  } finally {
    removeTempDirectory(directory);
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
  assertWarning(parseOutput(runHook(HOOK_PATH, ['--print-config', '--unexpected'])));
});

test('REVIEW.md 누락 또는 빈 내용은 경고하고 검토 완료로 위장하지 않는다', () => {
  for (const review of [undefined, ' \n\t']) {
    const { directory, hookPath } = copyHookToTemp({ review });
    try {
      assertWarning(runEvent(hookPath, {
        hook_event_name: 'Stop',
        stop_hook_active: false,
      }));
    } finally {
      removeTempDirectory(directory);
    }
  }
});

test('--print-config은 실제 Node와 훅 파일 경로를 포함하고 cmd.exe에서도 실행된다', () => {
  const config = parseOutput(runHook(HOOK_PATH, ['--print-config']));
  const command = config?.hooks?.Stop?.[0]?.hooks?.[0]?.command;
  assert.equal(typeof command, 'string');

  const expectedNode = NODE_PATH.replaceAll('\\', '/');
  const expectedHook = HOOK_PATH.replaceAll('\\', '/');
  const match = command.match(/^(?:"([^"]+)"|(\S+))\s+"([^"]+)"$/);
  assert.ok(match, 'generated command must contain an executable and quoted script path');
  const executablePath = match[1] ?? match[2];
  const scriptPath = match[3];
  assert.equal(executablePath, expectedNode);
  assert.equal(scriptPath, expectedHook);
  assert.equal(existsSync(executablePath), true, 'generated executable path must exist');
  assert.equal(existsSync(scriptPath), true, 'generated script path must exist');

  const direct = spawnSync(executablePath, [scriptPath, '--print-config'], {
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true,
  });
  const directConfig = parseOutput(direct);
  assert.equal(directConfig?.hooks?.Stop?.[0]?.hooks?.[0]?.command, command);

  const viaCmd = spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', command], {
    encoding: 'utf8',
    input: JSON.stringify({ hook_event_name: 'Stop', stop_hook_active: true }),
    timeout: 10_000,
    windowsVerbatimArguments: true,
    windowsHide: true,
  });
  assert.deepEqual(parseOutput(viaCmd), {});
});
