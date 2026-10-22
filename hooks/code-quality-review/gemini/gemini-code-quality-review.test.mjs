import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';
import { stopSession, finishWatch } from '../review-changes.mjs';

const HOOK_PATH = fileURLToPath(new URL('./gemini-code-quality-review.mjs', import.meta.url));
const REVIEW = readFileSync(new URL('../REVIEW.md', import.meta.url), 'utf8').trim();
const REQUEST = '[code-quality-review:request]\nA recorded review request';
const user = { type: 'USER_INPUT', source: 'USER_EXPLICIT', content: '구현 요청' };
const model = (content) => ({ type: 'PLANNER_RESPONSE', source: 'MODEL', content });
const request = { type: 'SYSTEM_MESSAGE', source: 'SYSTEM', content: REQUEST };
const TEST_ROOT = mkdtempSync(join(tmpdir(), 'quality-gemini-state-'));
const TEST_ENV = { ...process.env, TMP: TEST_ROOT, TEMP: TEST_ROOT, TMPDIR: TEST_ROOT };
after(() => rmSync(TEST_ROOT, { recursive: true, force: true }));

function parse(result) {
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function run(script, input, args = []) {
  return spawnSync(process.execPath, [script, ...args], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8', windowsHide: true, timeout: 15_000,
    env: TEST_ENV,
  });
}

async function fixture(fn, { review = REVIEW, changed = true } = {}) {
  const root = mkdtempSync(join(TEST_ROOT, 'fixture-'));
  const directory = join(root, 'gemini');
  mkdirSync(directory);
  const script = join(directory, 'gemini-code-quality-review.mjs');
  copyFileSync(HOOK_PATH, script);
  copyFileSync(new URL('../review-request.mjs', import.meta.url), join(root, 'review-request.mjs'));
  copyFileSync(new URL('../review-status.mjs', import.meta.url), join(root, 'review-status.mjs'));
  copyFileSync(new URL('../review-changes.mjs', import.meta.url), join(root, 'review-changes.mjs'));
  copyFileSync(new URL('../watch-worker.mjs', import.meta.url), join(root, 'watch-worker.mjs'));
  if (review !== null) writeFileSync(join(root, 'REVIEW.md'), review);
  const transcriptPath = join(root, 'transcript.jsonl');
  const workspace = join(root, 'workspace');
  mkdirSync(workspace);
  const event = { executionNum: 1, fullyIdle: true, terminationReason: 'model_stop', transcriptPath,
    conversationId: root, workspacePaths: [workspace] };
  writeFileSync(transcriptPath, JSON.stringify(user));
  writeFileSync(join(workspace, 'code.mjs'), 'before');
  parse(run(script, event, ['--prepare']));
  writeFileSync(transcriptPath, [user, model('구현 완료')].map(JSON.stringify).join('\n'));
  if (changed) writeFileSync(join(workspace, 'code.mjs'), 'after');
  try { await fn({ root, directory, script, transcriptPath, event }); }
  finally {
    const before = { TMP: process.env.TMP, TEMP: process.env.TEMP, TMPDIR: process.env.TMPDIR };
    Object.assign(process.env, { TMP: TEST_ROOT, TEMP: TEST_ROOT, TMPDIR: TEST_ROOT });
    try { await stopSession('gemini', root, [workspace]); }
    finally { for (const [key, value] of Object.entries(before)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

async function turn(entries, overrides = {}) {
  let output;
  await fixture(({ script, transcriptPath, event }) => {
    const index = entries.findLastIndex((entry) => entry.type === 'USER_INPUT' && entry.source === 'USER_EXPLICIT');
    writeFileSync(transcriptPath, entries.slice(0, index + 1).map(JSON.stringify).join('\n'));
    parse(run(script, event, ['--prepare']));
    writeFileSync(join(event.workspacePaths[0], 'code.mjs'), 'after current turn');
    writeFileSync(transcriptPath, entries.map(JSON.stringify).join('\n'));
    if (entries.slice(index + 1).some((entry) => entry.type === 'SYSTEM_MESSAGE' && entry.source === 'SYSTEM'
        && entry.content?.includes('[code-quality-review:request]\n'))) run(script, event);
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

test('공식 model_stop과 기존 NO_TOOL_CALL의 첫 종료에서 검토를 요청한다', async () => {
  for (const terminationReason of ['model_stop', 'NO_TOOL_CALL']) {
    continues(await turn([user, model('구현 완료')], { terminationReason }));
  }
  for (const status of ['clean', 'skipped', 'blocked']) {
    continues(await turn([user, model(`[code-quality-review:${status}]`)]));
  }
});

test('실제 수정 없는 질문·문서는 추가 검토 없이 종료한다', async () => {
  for (const operation of ['none', 'documentation']) {
    await fixture(({ script, event }) => {
      if (operation === 'documentation') writeFileSync(join(event.workspacePaths[0], 'README.md'), 'docs');
      assert.deepEqual(parse(run(script, event)), {}, operation);
    }, { changed: false });
  }
});

test('감시 프로세스 종료는 경고만 남기며 프롬프트·blocked 응답을 새로 요구하지 않는다', async () => {
  await fixture(({ script, event, transcriptPath }) => {
    const directory = join(TEST_ROOT, 'ai-setting-code-quality-review');
    const state = readdirSync(directory).filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
      .map((name) => JSON.parse(readFileSync(join(directory, name), 'utf8')))
      .find((value) => value.phase === 'ready' && value.roots.some((root) => root.path === event.workspacePaths[0]));
    assert.ok(state?.pid);
    process.kill(state.pid);
    const result = run(script, event);
    assert.deepEqual(parse(result), {});
    assert.match(result.stderr, /검토 미완료/);
    assert.deepEqual(parse(run(script, event, ['--prepare'])), { injectSteps: [] });
    assert.deepEqual(parse(run(script, { ...event, executionNum: 2 })), {});
  }, { changed: false });
});

test('이전 턴의 늦은 Stop 실패 정리가 새 턴의 감시를 종료하지 않는다', async () => {
  await fixture(({ root, script, event, transcriptPath }) => {
    const oldTranscript = join(root, 'old-transcript.jsonl');
    copyFileSync(transcriptPath, oldTranscript);
    writeFileSync(transcriptPath, [user, model('이전 응답'), user].map(JSON.stringify).join('\n'));
    assert.deepEqual(parse(run(script, event, ['--prepare'])), { injectSteps: [] });
    const late = parse(run(script, { ...event, transcriptPath: oldTranscript }));
    assert.deepEqual(late, {});
    assert.deepEqual(parse(run(script, event)), {});
  }, { changed: false });
});

test('준비 실패도 모델 프롬프트를 주입하지 않고 경고한다', async () => {
  await fixture(({ root, script, event, transcriptPath }) => {
    writeFileSync(transcriptPath, JSON.stringify(user));
    const result = run(script, { ...event, workspacePaths: [join(root, 'missing-workspace')] }, ['--prepare']);
    assert.deepEqual(parse(result), {});
    assert.match(result.stderr, /검토 미완료/);
    assert.equal(result.stdout.includes('injectSteps'), false);
  });
});

test('진행 중 상태와 owner 기록이 사라져도 새 기준·검토 예산으로 재준비하지 않는다', async () => {
  await fixture(async ({ script, event }) => {
    const directory = join(TEST_ROOT, 'ai-setting-code-quality-review');
    const current = readdirSync(directory).filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
      .map((name) => ({ path: join(directory, name), state: JSON.parse(readFileSync(join(directory, name), 'utf8')) }))
      .find(({ state }) => state.phase === 'ready' && state.roots.some((root) => root.path === event.workspacePaths[0]));
    assert.ok(current);
    rmSync(current.path); rmSync(join(directory, `owner-${current.state.owner}.json`));
    try {
      const result = run(script, { ...event, invocationNum: 1 }, ['--prepare']);
      assert.deepEqual(parse(result), {});
      assert.match(result.stderr, /검토 미완료/);
      const stop = run(script, event);
      assert.deepEqual(parse(stop), {}); assert.match(stop.stderr, /검토 미완료/);
    } finally { await finishWatch(current.state); }
  }, { changed: false });
});

test('무마커·연속 revised 재요청은 5회이며 같은 턴 재준비·종료로 예산을 초기화하지 않는다', async () => {
  for (const content of ['표식 없음', '[code-quality-review:revised]']) {
    await fixture(({ script, event, transcriptPath }) => {
      const entries = [user, model('구현 완료')];
      for (let i = 0; i < 5; i++) {
        writeFileSync(transcriptPath, entries.map(JSON.stringify).join('\n'));
        assert.deepEqual(parse(run(script, event, ['--prepare'])), { injectSteps: [] });
        const result = parse(run(script, event)); continues(result);
        entries.push({ ...request, content: result.reason }, model(content));
      }
      writeFileSync(transcriptPath, entries.map(JSON.stringify).join('\n'));
      for (let i = 0; i < 3; i++) {
        const result = run(script, event); assert.deepEqual(parse(result), {}); assert.match(result.stderr, /5회 상한/);
        assert.deepEqual(parse(run(script, event, ['--prepare'])), { injectSteps: [] });
      }
      entries.push(user); writeFileSync(transcriptPath, entries.map(JSON.stringify).join('\n'));
      assert.deepEqual(parse(run(script, event, ['--prepare'])), { injectSteps: [] });
      writeFileSync(join(event.workspacePaths[0], 'code.mjs'), 'new request change');
      const result = parse(run(script, event)); continues(result);
      entries.push({ ...request, content: result.reason }, model('[code-quality-review:clean]'));
      writeFileSync(transcriptPath, entries.map(JSON.stringify).join('\n'));
      assert.deepEqual(parse(run(script, event)), {});
      assert.deepEqual(parse(run(script, event, ['--prepare'])), { injectSteps: [] });
      assert.deepEqual(parse(run(script, event)), {});
    });
  }
});

test('다섯 번째 검토의 clean·skipped·blocked는 정상 종료하고 반복 Stop은 멱등적이다', async () => {
  for (const status of ['clean', 'skipped', 'blocked']) {
    await fixture(({ script, event, transcriptPath }) => {
      const entries = [user, model('구현 완료')];
      for (let i = 0; i < 5; i++) {
        writeFileSync(transcriptPath, entries.map(JSON.stringify).join('\n'));
        const result = parse(run(script, event)); continues(result);
        entries.push({ ...request, content: result.reason }, model(i === 4 ? `[code-quality-review:${status}]` : '[code-quality-review:revised]'));
      }
      writeFileSync(transcriptPath, entries.map(JSON.stringify).join('\n'));
      const result = run(script, event); assert.deepEqual(parse(result), {}); assert.equal(result.stderr, '');
      assert.deepEqual(parse(run(script, event, ['--prepare'])), { injectSteps: [] });
      assert.deepEqual(parse(run(script, event)), {});
    });
  }
});

test('수정 회차·누락·잘못된 표식은 반복하며 종료 표식은 재검토 이후에만 허용한다', async () => {
  for (const content of ['', '검토 완료', '[code-quality-review:revised]',
    '> [code-quality-review:clean]', '```\n[code-quality-review:clean]\n```',
    '[code-quality-review:clean]\n추가 내용', '[code-quality-review:Clean]']) {
    continues(await turn([user, model('구현 완료'), request, model(content)]));
  }
  for (const status of ['clean', 'skipped', 'blocked']) {
    assert.deepEqual(await turn([user, model('구현 완료'), request, model(`결과\r\n[code-quality-review:${status}]\r\n`)]), {});
  }
});

test('열린 코드 펜스 안의 종료 표식은 거부하고 닫힌 펜스 뒤의 독립 표식만 허용한다', async () => {
  for (const status of ['clean', 'skipped', 'blocked']) {
    const marker = `[code-quality-review:${status}]`;
    for (const prefix of ['```text\n', '~~~text\n', '   ```text\r\n',
      '````text\n```\n', '~~~text\n```\n', '```text\n```not-a-close\n',
      '```text\n    ```\n', '- item\n\n```text\n',
      '- item\n\n# heading\n   ```text\n', '- item\n\ntext\n   ```text\n',
      '* * *\n  ```text\n', '- - -\n  ~~~text\n']) {
      continues(await turn([user, request, model(prefix + marker)]));
    }
    for (const prefix of ['', '```text\nexample\n```\n', '~~~text\nexample\n~~~~\n',
      '   ```text\r\nexample\r\n ```\t\r\n', '```not `a fence`\n', '    ```text\n',
      '- ```text\n  example\n  ```\n\n', '1. ~~~text\n   example\n   ~~~\n\n',
      '- item\n  ```text\n  example\n  ```\n\n', '- ```text\n  example\n\n',
      '- item\n  ~~~text\n  example\n\n', '> ```text\n> example\n> ```\n\n',
      '> ```text\n> example\n\n', '- item\nlazy continuation\n  ```text\n  example\n\n',
      '* * *\n  ```text\nexample\n  ```\n', '- - -\n  ~~~text\nexample\n  ~~~\n']) {
      assert.deepEqual(await turn([user, request, model(prefix + marker)]), {}, prefix);
    }
  }
});

test('같은 턴의 여러 수정 회차 후 수정 없는 회차에서 종료한다', async () => {
  const entries = [user, model('구현 완료')];
  continues(await turn(entries));
  for (let i = 0; i < 3; i++) {
    entries.push(request, model('[code-quality-review:revised]'));
    continues(await turn(entries, { executionNum: i + 2 }));
  }
  entries.push(request, model('[code-quality-review:clean]'));
  assert.deepEqual(await turn(entries, { executionNum: 5 }), {});
});

test('Antigravity가 system message를 감싼 실제 기록 형식도 검토 요청으로 인식한다', async () => {
  const wrapped = { ...request, content: `The following is a <SYSTEM_MESSAGE> not actually sent by the user. It is provided by the system as important information to pay attention to.\n\n<SYSTEM_MESSAGE>\nStop hook blocked termination: ${REQUEST}\n</SYSTEM_MESSAGE>` };
  assert.deepEqual(await turn([user, model('구현 완료'), wrapped, model('[code-quality-review:skipped]')]), {});
  continues(await turn([user, model('구현 완료'), wrapped, model('[code-quality-review:revised]')]));
});

test('이전 턴·사용자나 모델이 인용한 요청·이전 응답으로 새 검토를 생략하지 않는다', async () => {
  continues(await turn([user, request, model('[code-quality-review:clean]'), user, model('새 작업 완료')]));
  continues(await turn([user, model(REQUEST), model('[code-quality-review:clean]')]));
  continues(await turn([user, { ...request, source: 'USER_EXPLICIT' }, model('[code-quality-review:clean]')]));
  continues(await turn([user, model('[code-quality-review:clean]'), request]));
  continues(await turn([user, request, model('[code-quality-review:clean]'), model(undefined)]));
});

test('백그라운드 작업·오류·중단·실행 제한 종료에서는 강제로 재개하지 않는다', async () => {
  assert.deepEqual(await turn([user], { fullyIdle: false }), {});
  for (const terminationReason of ['USER_CANCELED', 'ERROR', 'MAX_INVOCATIONS', 'error', 'max_steps_exceeded']) {
    assert.deepEqual(await turn([user], { terminationReason }), {});
  }
});

test('잘못된 입력·대화 기록 누락·파싱 오류는 원문 없이 경고하고 종료한다', async () => {
  await fixture(({ script, transcriptPath, event }) => {
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

test('REVIEW 누락·빈 파일 테스트는 자체 임시 루트 안에서만 파일을 만든다', async () => {
  for (const review of [null, '  \n\t']) {
    await fixture(({ script, event }) => warns(run(script, event)), { review });
  }
});

test('잘못된 실행 인자는 경고, 잘못된 설정 생성 인자는 설치 가능한 JSON 없이 실패한다', async () => {
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
  assert.equal(config.PreInvocation[0].timeout, 10);
  assert.equal(config.PreInvocation[0].type, 'command');
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
    result = spawnSync(exe, args, { input: JSON.stringify(event), encoding: 'utf8', windowsHide: true, timeout: 15_000, env: TEST_ENV });
  } else {
    result = spawnSync('/bin/sh', ['-c', command], { input: JSON.stringify(event), encoding: 'utf8', timeout: 15_000, env: TEST_ENV });
  }
  continues(parse(result), join(dirname(script), '..', 'REVIEW.md'));
}

test('현재 Node와 훅 경로로 생성한 설정 명령이 셸 해석에 의존하지 않고 실행된다', async () => {
  await fixture(({ script, event }) => assertCommand(script, event));
});

test('공백·작은따옴표·셸 구문처럼 보이는 훅 경로도 리터럴로 실행한다', async () => {
  await fixture(({ directory, script, event }) => {
    for (const name of ["reviewer's 한글 hook.mjs", "review'; Write-Output 'INJECTED'; #.mjs",
      'O‘’‚‛Connor $value`!%LITERAL% & (x).mjs']) {
      const target = join(directory, name);
      copyFileSync(script, target);
      assertCommand(target, event);
    }
  });
});

test('Windows의 특수문자가 있는 Node 실행 경로도 리터럴로 실행한다', { skip: process.platform !== 'win32' }, async () => {
  await fixture(({ root, script, event }) => {
    const node = join(root, "node's O‘’‚‛Connor $value`!%LITERAL% & (x).exe");
    copyFileSync(process.execPath, node);
    assertCommand(script, event, node);
  });
});

test('macOS 형식 명령을 Windows Git sh에서 검사한다(실제 macOS 실행은 아님)', {
  skip: process.platform !== 'win32' || !process.env.CODE_QUALITY_REVIEW_TEST_POSIX_SHELL,
}, async () => {
  await fixture(({ directory, script, event }) => {
    const target = join(directory, "reviewer's 한글 hook.mjs");
    copyFileSync(script, target);
    const code = `Object.defineProperty(process,'platform',{value:'darwin'});Object.defineProperty(process,'execPath',{value:process.execPath.replaceAll('\\\\','/')});process.argv=[process.execPath,${JSON.stringify(target)},'--print-config'];await import(${JSON.stringify(pathToFileURL(target).href)});`;
    const output = parse(spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', windowsHide: true, timeout: 15_000 }));
    const command = output['ai-setting-code-quality-review'].Stop[0].command;
    const shell = process.env.CODE_QUALITY_REVIEW_TEST_POSIX_SHELL;
    assert.ok(existsSync(shell));
    continues(parse(spawnSync(shell, ['-c', command], { input: JSON.stringify(event), encoding: 'utf8', windowsHide: true, timeout: 15_000, env: TEST_ENV })), join(dirname(target), '..', 'REVIEW.md'));
  });
});
