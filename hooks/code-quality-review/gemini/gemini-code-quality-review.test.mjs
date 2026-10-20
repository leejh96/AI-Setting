import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';

const HOOK_PATH = fileURLToPath(new URL('./gemini-code-quality-review.mjs', import.meta.url));
const REVIEW = readFileSync(new URL('../REVIEW.md', import.meta.url), 'utf8').trim();
const REQUEST = '[code-quality-review:request]\nA recorded review request';
const user = { type: 'USER_INPUT', source: 'USER_EXPLICIT', content: '구현 요청' };
const model = (content) => ({ type: 'PLANNER_RESPONSE', source: 'MODEL', content });
const request = { type: 'SYSTEM_MESSAGE', source: 'SYSTEM', content: REQUEST };

function parse(result) {
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function run(script, input, args = []) {
  return spawnSync(process.execPath, [script, ...args], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8', windowsHide: true, timeout: 15_000,
  });
}

function fixture(fn, { review = REVIEW } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'quality-gemini-'));
  const directory = join(root, 'gemini');
  mkdirSync(directory);
  const script = join(directory, 'gemini-code-quality-review.mjs');
  copyFileSync(HOOK_PATH, script);
  copyFileSync(new URL('../review-request.mjs', import.meta.url), join(root, 'review-request.mjs'));
  copyFileSync(new URL('../review-status.mjs', import.meta.url), join(root, 'review-status.mjs'));
  if (review !== null) writeFileSync(join(root, 'REVIEW.md'), review);
  const transcriptPath = join(root, 'transcript.jsonl');
  const event = { executionNum: 1, fullyIdle: true, terminationReason: 'model_stop', transcriptPath };
  writeFileSync(transcriptPath, [user, model('구현 완료')].map(JSON.stringify).join('\n'));
  try { fn({ root, directory, script, transcriptPath, event }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

function turn(entries, overrides = {}) {
  let output;
  fixture(({ script, transcriptPath, event }) => {
    writeFileSync(transcriptPath, entries.map(JSON.stringify).join('\n'));
    output = parse(run(script, { ...event, ...overrides }));
  });
  return output;
}

function continues(output, expectedReviewPath) {
  assert.equal(output.decision, 'continue');
  assert.ok(output.reason.startsWith('[code-quality-review:request]\n'));
  assert.ok(!output.reason.includes(REVIEW));
  const pathMatch = output.reason.match(/적용 대상이면 ("(?:\\.|[^"\\])*") 파일/);
  assert.ok(pathMatch, 'must include a JSON-quoted REVIEW path');
  const reviewPath = JSON.parse(pathMatch[1]);
  assert.ok(isAbsolute(reviewPath));
  if (expectedReviewPath) assert.equal(reviewPath, expectedReviewPath);
  assert.ok(output.reason.length < REVIEW.length / 3);
  assert.match(output.reason, /이번 회차에 실제로 읽고/);
  assert.match(output.reason, /문서만 변경/);
  assert.match(output.reason, /서브에이전트/);
  assert.match(output.reason, /파일 읽기나 저장소 전체 검색은 하지 마세요/);
  assert.match(output.reason, /읽을 수 없으면[\s\S]*\[code-quality-review:blocked\]/);
}
function warns(result) {
  assert.deepEqual(parse(result), {});
  assert.match(result.stderr, /자동 검토 완료로 간주하지/);
}

test('공식 model_stop과 기존 NO_TOOL_CALL의 첫 종료에서 검토를 요청한다', () => {
  for (const terminationReason of ['model_stop', 'NO_TOOL_CALL']) {
    continues(turn([user, model('구현 완료')], { terminationReason }));
  }
  for (const status of ['clean', 'skipped', 'blocked']) {
    continues(turn([user, model(`[code-quality-review:${status}]`)]));
  }
});

test('수정 회차·누락·잘못된 표식은 반복하며 종료 표식은 재검토 이후에만 허용한다', () => {
  for (const content of ['', '검토 완료', '[code-quality-review:revised]',
    '> [code-quality-review:clean]', '```\n[code-quality-review:clean]\n```',
    '[code-quality-review:clean]\n추가 내용', '[code-quality-review:Clean]']) {
    continues(turn([user, model('구현 완료'), request, model(content)]));
  }
  for (const status of ['clean', 'skipped', 'blocked']) {
    assert.deepEqual(turn([user, model('구현 완료'), request, model(`결과\r\n[code-quality-review:${status}]\r\n`)]), {});
  }
});

test('열린 코드 펜스 안의 종료 표식은 거부하고 닫힌 펜스 뒤의 독립 표식만 허용한다', () => {
  for (const status of ['clean', 'skipped', 'blocked']) {
    const marker = `[code-quality-review:${status}]`;
    for (const prefix of ['```text\n', '~~~text\n', '   ```text\r\n',
      '````text\n```\n', '~~~text\n```\n', '```text\n```not-a-close\n',
      '```text\n    ```\n', '- item\n\n```text\n',
      '- item\n\n# heading\n   ```text\n', '- item\n\ntext\n   ```text\n',
      '* * *\n  ```text\n', '- - -\n  ~~~text\n']) {
      continues(turn([user, request, model(prefix + marker)]));
    }
    for (const prefix of ['', '```text\nexample\n```\n', '~~~text\nexample\n~~~~\n',
      '   ```text\r\nexample\r\n ```\t\r\n', '```not `a fence`\n', '    ```text\n',
      '- ```text\n  example\n  ```\n\n', '1. ~~~text\n   example\n   ~~~\n\n',
      '- item\n  ```text\n  example\n  ```\n\n', '- ```text\n  example\n\n',
      '- item\n  ~~~text\n  example\n\n', '> ```text\n> example\n> ```\n\n',
      '> ```text\n> example\n\n', '- item\nlazy continuation\n  ```text\n  example\n\n',
      '* * *\n  ```text\nexample\n  ```\n', '- - -\n  ~~~text\nexample\n  ~~~\n']) {
      assert.deepEqual(turn([user, request, model(prefix + marker)]), {}, prefix);
    }
  }
});

test('같은 턴의 여러 수정 회차 후 수정 없는 회차에서 종료한다', () => {
  const entries = [user, model('구현 완료')];
  continues(turn(entries));
  for (let i = 0; i < 3; i++) {
    entries.push(request, model('[code-quality-review:revised]'));
    continues(turn(entries, { executionNum: i + 2 }));
  }
  entries.push(request, model('[code-quality-review:clean]'));
  assert.deepEqual(turn(entries, { executionNum: 5 }), {});
});

test('Antigravity가 system message를 감싼 실제 기록 형식도 검토 요청으로 인식한다', () => {
  const wrapped = { ...request, content: `The following is a <SYSTEM_MESSAGE> not actually sent by the user. It is provided by the system as important information to pay attention to.\n\n<SYSTEM_MESSAGE>\nStop hook blocked termination: ${REQUEST}\n</SYSTEM_MESSAGE>` };
  assert.deepEqual(turn([user, model('구현 완료'), wrapped, model('[code-quality-review:skipped]')]), {});
  continues(turn([user, model('구현 완료'), wrapped, model('[code-quality-review:revised]')]));
});

test('이전 턴·사용자나 모델이 인용한 요청·이전 응답으로 새 검토를 생략하지 않는다', () => {
  continues(turn([user, request, model('[code-quality-review:clean]'), user, model('새 작업 완료')]));
  continues(turn([user, model(REQUEST), model('[code-quality-review:clean]')]));
  continues(turn([user, { ...request, source: 'USER_EXPLICIT' }, model('[code-quality-review:clean]')]));
  continues(turn([user, model('[code-quality-review:clean]'), request]));
  continues(turn([user, request, model('[code-quality-review:clean]'), model(undefined)]));
});

test('백그라운드 작업·오류·중단·실행 제한 종료에서는 강제로 재개하지 않는다', () => {
  assert.deepEqual(turn([user], { fullyIdle: false }), {});
  for (const terminationReason of ['USER_CANCELED', 'ERROR', 'MAX_INVOCATIONS', 'error', 'max_steps_exceeded']) {
    assert.deepEqual(turn([user], { terminationReason }), {});
  }
});

test('잘못된 입력·대화 기록 누락·파싱 오류는 원문 없이 경고하고 종료한다', () => {
  fixture(({ script, transcriptPath, event }) => {
    for (const input of ['null', '[]', '{', '{}', { ...event, fullyIdle: undefined },
      { ...event, transcriptPath: join(dirname(transcriptPath), 'missing') }]) warns(run(script, input));
    writeFileSync(transcriptPath, 'SENSITIVE_TEST_VALUE invalid json');
    const result = run(script, event);
    warns(result);
    assert.equal((result.stdout + result.stderr).includes('SENSITIVE_TEST_VALUE'), false);
    writeFileSync(transcriptPath, JSON.stringify(model('사용자 턴 없음')));
    warns(run(script, event));
  });
});

test('REVIEW 누락·빈 파일 테스트는 자체 임시 루트 안에서만 파일을 만든다', () => {
  for (const review of [null, '  \n\t']) {
    fixture(({ script, event }) => warns(run(script, event)), { review });
  }
});

test('잘못된 실행 인자는 경고, 잘못된 설정 생성 인자는 설치 가능한 JSON 없이 실패한다', () => {
  warns(run(HOOK_PATH, '', ['--unexpected']));
  const result = run(HOOK_PATH, '', ['--print-config', '--unexpected']);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /설정을 생성하지 못했습니다/);
});

function generated(script, node = process.execPath) {
  const result = spawnSync(node, [script, '--print-config'], { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
  const config = parse(result)['ai-setting-code-quality-review'];
  assert.equal(config.enabled, true);
  assert.equal(config.Stop.length, 1);
  assert.equal(config.Stop[0].type, 'command');
  assert.equal(config.Stop[0].timeout, 30);
  return config.Stop[0].command;
}

function assertCommand(script, event, node = process.execPath) {
  const command = generated(script, node);
  let result;
  if (process.platform === 'win32') {
    // Antigravity can split the command without treating quotes as shell syntax.
    const [exe, ...args] = command.split(' ');
    assert.equal(exe, 'powershell.exe');
    const decoded = Buffer.from(args.at(-1), 'base64').toString('utf16le');
    const quote = (value) => value.replaceAll('\\', '/').replace(/['\u2018-\u201b]/g, (char) => char + char);
    assert.ok(decoded.includes(quote(node)));
    assert.ok(decoded.includes(quote(script)));
    result = spawnSync(exe, args, { input: JSON.stringify(event), encoding: 'utf8', windowsHide: true, timeout: 15_000 });
  } else {
    result = spawnSync('/bin/sh', ['-c', command], { input: JSON.stringify(event), encoding: 'utf8', timeout: 15_000 });
  }
  continues(parse(result), join(dirname(script), '..', 'REVIEW.md'));
}

test('현재 Node와 훅 경로로 생성한 설정 명령이 셸 해석에 의존하지 않고 실행된다', () => {
  fixture(({ script, event }) => assertCommand(script, event));
});

test('공백·작은따옴표·셸 구문처럼 보이는 훅 경로도 리터럴로 실행한다', () => {
  fixture(({ directory, script, event }) => {
    for (const name of ["reviewer's 한글 hook.mjs", "review'; Write-Output 'INJECTED'; #.mjs",
      'O‘’‚‛Connor $value`!%LITERAL% & (x).mjs']) {
      const target = join(directory, name);
      copyFileSync(script, target);
      assertCommand(target, event);
    }
  });
});

test('Windows의 특수문자가 있는 Node 실행 경로도 리터럴로 실행한다', { skip: process.platform !== 'win32' }, () => {
  fixture(({ root, script, event }) => {
    const node = join(root, "node's O‘’‚‛Connor $value`!%LITERAL% & (x).exe");
    copyFileSync(process.execPath, node);
    assertCommand(script, event, node);
  });
});

test('macOS 형식 명령을 Windows Git sh에서 검사한다(실제 macOS 실행은 아님)', {
  skip: process.platform !== 'win32' || !process.env.CODE_QUALITY_REVIEW_TEST_POSIX_SHELL,
}, () => {
  fixture(({ directory, script, event }) => {
    const target = join(directory, "reviewer's 한글 hook.mjs");
    copyFileSync(script, target);
    const code = `Object.defineProperty(process,'platform',{value:'darwin'});Object.defineProperty(process,'execPath',{value:process.execPath.replaceAll('\\\\','/')});process.argv=[process.execPath,${JSON.stringify(target)},'--print-config'];await import(${JSON.stringify(pathToFileURL(target).href)});`;
    const output = parse(spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', windowsHide: true, timeout: 15_000 }));
    const command = output['ai-setting-code-quality-review'].Stop[0].command;
    const shell = process.env.CODE_QUALITY_REVIEW_TEST_POSIX_SHELL;
    assert.ok(existsSync(shell));
    continues(parse(spawnSync(shell, ['-c', command], { input: JSON.stringify(event), encoding: 'utf8', windowsHide: true, timeout: 15_000 })), join(dirname(target), '..', 'REVIEW.md'));
  });
});
