import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, isAbsolute, join } from 'node:path';
import { stopSession, finishWatch } from '../review-changes.mjs';
import { createWatchTestRoot } from '../test-temp.mjs';

const HOOK_PATH = fileURLToPath(new URL('./gemini-code-quality-review.mjs', import.meta.url));
const REVIEW = readFileSync(new URL('../REVIEW.md', import.meta.url), 'utf8').trim();
const REQUEST = '[code-quality-review:request]\nA recorded review request';
const user = { type: 'USER_INPUT', source: 'USER_EXPLICIT', content: '구현 요청' };
const model = (content) => ({ type: 'PLANNER_RESPONSE', source: 'MODEL', content });
const request = { type: 'SYSTEM_MESSAGE', source: 'SYSTEM', content: REQUEST };
const { root: TEST_ROOT } = createWatchTestRoot();
const TEST_ENV = { ...process.env, TMP: TEST_ROOT, TEMP: TEST_ROOT, TMPDIR: TEST_ROOT };
after(() => rmSync(TEST_ROOT, { recursive: true, force: true }));

function parse(result) {
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function run(script, input, args = [], env = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8', windowsHide: true, timeout: 15_000,
    env: { ...TEST_ENV, ...env },
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

test('필수 메모리 출처가 뒤따라도 현재 검토의 종료 표식을 인정한다', async () => {
  const footer = '<oai-mem-citation>\n<citation_entries>\nMEMORY.md:1-2|note=[verified]\n</citation_entries>\n<rollout_ids>\n</rollout_ids>\n</oai-mem-citation>';
  assert.deepEqual(await turn([user, model('구현 완료'), request,
    model(`검토 결과\n[code-quality-review:clean]\n\n${footer}`)]), {});
});

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
  assert.match(output.reason, /문서만 변경한 작업도 포함/);
  assert.match(output.reason, /미추적 파일·문서 문구·테스트·임시 스크립트·백업 사본/);
  assert.match(output.reason, /적용 전 답변·승인 대기·중단 요청[\s\S]*\[code-quality-review:skipped\]/);
  assert.match(output.reason, /적용 대상인 구현·수정 작업에서 답변·승인 대기나 중단 요청[\s\S]*\[code-quality-review:blocked\]/);
  assert.match(output.reason, /중단 요청 시에는 추가 검토·수정을 진행하지 마세요/);
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

test('무변경은 종료하고 문서만 변경한 작업도 검토를 요청한다', async () => {
  for (const operation of ['none', 'documentation']) {
    await fixture(({ script, event }) => {
      if (operation === 'documentation') writeFileSync(join(event.workspacePaths[0], 'README.md'), 'docs');
      const output = parse(run(script, event));
      if (operation === 'none') assert.deepEqual(output, {});
      else continues(output);
    }, { changed: false });
  }
});

test('긴 이전 기록·빈 줄·UTF-8 경계에서도 현재 턴의 식별과 검토 종료를 유지한다', async () => {
  await fixture(({ script, transcriptPath, event }) => {
    const history = [user, ...Array.from({ length: 3000 }, () => model('이전 기록😀')), user];
    const serialize = (entries) => entries.map(JSON.stringify).join('\r\n \r\n');
    writeFileSync(transcriptPath, serialize(history));
    parse(run(script, event, ['--prepare']));
    writeFileSync(join(event.workspacePaths[0], 'code.mjs'), 'changed in long transcript turn');
    writeFileSync(transcriptPath, serialize([...history, model('완료😀'.repeat(20000))]));
    continues(parse(run(script, event)));
    writeFileSync(transcriptPath, serialize([...history, model('완료'), request, model('[code-quality-review:clean]')]));
    assert.deepEqual(parse(run(script, event)), {});
  });
});

test('정확한 청크 경계와 긴 UTF-8 사용자 입력·미완성 마지막 줄을 처리한다', async () => {
  await fixture(({ script, transcriptPath, event }) => {
    const empty = JSON.stringify({ ...user, content: '' });
    const boundary = JSON.stringify({ ...user, content: 'a'.repeat(64 * 1024 - Buffer.byteLength(empty) - 1) }) + '\n';
    assert.equal(Buffer.byteLength(boundary), 64 * 1024);
    const history = boundary + JSON.stringify(model('이전 응답')) + '\r\n \r\n'
      + JSON.stringify({ ...user, content: '가나다😀'.repeat(650000) });
    writeFileSync(transcriptPath, history);
    assert.deepEqual(parse(run(script, event, ['--prepare'])), { injectSteps: [] });
    writeFileSync(join(event.workspacePaths[0], 'code.mjs'), 'changed after long user input');
    writeFileSync(transcriptPath, history + '\n' + JSON.stringify(model('구현 완료')));
    continues(parse(run(script, event)));
    writeFileSync(transcriptPath, history + '\n' + [model('구현 완료'), request, model('[code-quality-review:clean]')].map(JSON.stringify).join('\n'));
    assert.deepEqual(parse(run(script, event)), {});
    writeFileSync(transcriptPath, history + '\n{"content":"' + 'a'.repeat(128 * 1024));
    warns(run(script, event));
  });
});

test('여러 긴 JSON 줄을 완성한 뒤에도 새 요청·검토 상태와 이전 기록 검증을 유지한다', async () => {
  for (const newline of ['\n', '\r\n']) {
    await fixture(({ script, transcriptPath, event }) => {
      const serialize = entries => entries.map(JSON.stringify).join(newline + ' ' + newline) + newline;
      const history = [user, model('이전 기록😀'.repeat(20000)), request, model('[code-quality-review:clean]'), user];
      writeFileSync(transcriptPath, serialize(history));
      assert.deepEqual(parse(run(script, event, ['--prepare'])), { injectSteps: [] });
      writeFileSync(join(event.workspacePaths[0], 'code.mjs'), 'edited after long history');
      const entries = [...history, model('첫 긴 응답😀'.repeat(30000)), model('다음 긴 응답😀'.repeat(30000))];
      writeFileSync(transcriptPath, serialize(entries));
      continues(parse(run(script, event)));
      writeFileSync(transcriptPath, serialize([...entries, request, model('검토 내용😀'.repeat(30000) + '\n[code-quality-review:clean]')]));
      assert.deepEqual(parse(run(script, event)), {});
      writeFileSync(transcriptPath, '{"content":"' + 'PRIVATE_LONG_TRANSCRIPT'.repeat(20000) + newline + JSON.stringify(user));
      const malformed = run(script, event); warns(malformed);
      assert.ok(!malformed.stderr.includes('PRIVATE_LONG_TRANSCRIPT'));
    }, { changed: false });
  }
});

test('읽는 도중 잘린 기록의 이전 clean 표식으로 검토를 종료하지 않는다', async () => {
  await fixture(({ root, script, transcriptPath, event }) => {
    continues(parse(run(script, event)));
    const head = [user, request, model('[code-quality-review:clean]')].map(JSON.stringify).join('\n') + '\n';
    const padding = { type: 'TOOL_RESPONSE', source: 'TOOL', content: '' };
    padding.content = 'a'.repeat(64 * 1024 - Buffer.byteLength(head + JSON.stringify(padding) + '\n'));
    const prefix = head + JSON.stringify(padding) + '\n';
    assert.equal(Buffer.byteLength(prefix), 64 * 1024);
    const transcript = prefix + JSON.stringify(model('추가 수정 후 검토 필요')) + '\n';
    writeFileSync(transcriptPath, transcript);
    const preload = join(root, 'truncate-transcript.mjs');
    writeFileSync(preload, `import fs from 'node:fs';import{syncBuiltinESMExports}from'node:module';
const path=${JSON.stringify(transcriptPath)};let descriptor;
const open=fs.openSync;fs.openSync=(p,...args)=>{const fd=open(p,...args);if(p===path)descriptor=fd;return fd};
const read=fs.readSync;fs.readSync=(fd,buffer,offset,length,position)=>{const bytes=read(fd,buffer,offset,length,position);if(fd===descriptor&&position===0)fs.truncateSync(path,64*1024);return bytes};syncBuiltinESMExports();`);
    warns(run(script, event, [], { NODE_OPTIONS: `--import=${pathToFileURL(preload).href}` }));
    writeFileSync(transcriptPath, transcript);
    continues(parse(run(script, event)));
  });
});

for (const mode of ['snapshot', 'stat-error', 'read-error', 'parse-error']) {
  test(`버퍼 읽기의 시작 크기·짧은 읽기·실패 시 파일 닫기를 보장한다: ${mode}`, async () => {
    await fixture(({ root, script, transcriptPath, event }) => {
      const preload = join(root, `buffer-${mode}.mjs`), trace = preload + '.log';
      if (mode === 'parse-error') writeFileSync(transcriptPath, JSON.stringify(user) + '\nPRIVATE_INVALID_TRANSCRIPT');
      writeFileSync(preload, `import fs from 'node:fs';import{syncBuiltinESMExports}from'node:module';
const path=${JSON.stringify(transcriptPath)},trace=${JSON.stringify(trace)},mode=${JSON.stringify(mode)};let descriptor;
const log=value=>fs.appendFileSync(trace,JSON.stringify(value)+'\\n');
const open=fs.openSync;fs.openSync=(p,...args)=>{const fd=open(p,...args);if(p===path)descriptor=fd;return fd};
const stat=fs.fstatSync;fs.fstatSync=fd=>{if(fd!==descriptor)return stat(fd);if(mode==='stat-error')throw Error('PRIVATE_STAT_FAILURE');const value=stat(fd);if(mode==='snapshot')fs.appendFileSync(path,'\\n'+${JSON.stringify(JSON.stringify(user))});return value};
const read=fs.readSync;fs.readSync=(fd,buffer,offset,length,position)=>{if(fd!==descriptor)return read(fd,buffer,offset,length,position);log({read:length});if(mode==='read-error')throw Error('PRIVATE_READ_FAILURE');return read(fd,buffer,offset,Math.min(length,31),position)};
const close=fs.closeSync;fs.closeSync=fd=>{const result=close(fd);if(fd===descriptor){descriptor=undefined;log({closed:true})}return result};syncBuiltinESMExports();`);
      const result = run(script, event, [], { NODE_OPTIONS: `${TEST_ENV.NODE_OPTIONS || ''} --import=${pathToFileURL(preload).href}`.trim() });
      if (mode === 'snapshot') continues(parse(result));
      else { warns(result); assert.ok(!result.stderr.includes('PRIVATE_')); }
      const events = readFileSync(trace, 'utf8').trim().split('\n').map(JSON.parse);
      assert.equal(events.filter(entry => entry.closed).length, 1);
      if (mode !== 'stat-error') {
        assert.ok(events.some(entry => entry.read));
        assert.ok(events.filter(entry => entry.read).every(entry => entry.read <= 64 * 1024));
      }
    });
  });
}

test('현재 턴 이전의 잘못된 JSON도 경고하며 검토 완료로 처리하지 않는다', async () => {
  await fixture(({ script, transcriptPath, event }) => {
    writeFileSync(transcriptPath, `malformed old history\n${[user, model('완료')].map(JSON.stringify).join('\n')}`);
    warns(run(script, event));
    warns(run(script, event, ['--prepare']));
  });
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

test('수정 회차·누락은 검토를 이어가고 유효한 종료 표식은 검토를 끝낸다', async () => {
  for (const content of ['', '[code-quality-review:revised]']) {
    continues(await turn([user, model('구현 완료'), request, model(content)]));
  }
  assert.deepEqual(await turn([user, model('구현 완료'), request, model('결과\r\n[code-quality-review:clean]\r\n')]), {});
});

test('실제 훅은 코드 펜스와 인용문 제목의 종료 경계를 구분한다', async () => {
  const marker = '[code-quality-review:clean]';
  continues(await turn([user, request, model('```text\r\n\tcode\tvalue\n' + marker)]));
  assert.deepEqual(await turn([user, request, model('~~~text\n\tcode\tvalue\r\n~~~~\t\r\n' + marker)]), {});
  assert.deepEqual(await turn([user, request, model('> 검토 결과\n> ===\n' + marker)]), {});
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

function generated(script, node = process.execPath, event = 'Stop') {
  const result = spawnSync(node, [script, '--print-config'], { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
  const config = parse(result)['ai-setting-code-quality-review'];
  assert.equal(config.enabled, true);
  assert.equal(config.Stop.length, 1);
  assert.equal(config.Stop[0].type, 'command');
  assert.equal(config.Stop[0].timeout, 30);
  assert.equal(config.PreInvocation[0].timeout, 10);
  assert.equal(config.PreInvocation[0].type, 'command');
  return config[event][0].command;
}

function assertCommand(script, event, node = process.execPath) {
  const command = generated(script, node);
  let result;
  if (process.platform === 'win32') {
    // Antigravity can split the command without treating quotes as shell syntax.
    const [exe, ...args] = command.split(' ');
    if (exe === 'powershell.exe') {
      const decoded = Buffer.from(args.at(-1), 'base64').toString('utf16le');
      const quote = (value) => value.replaceAll('\\', '/').replace(/['\u2018-\u201b]/g, (char) => char + char);
      assert.ok(decoded.includes(quote(node)));
      assert.ok(decoded.includes(quote(script)));
    } else {
      assert.equal(exe, node.replaceAll('\\', '/'));
      assert.deepEqual(args, [script.replaceAll('\\', '/')]);
      continues(parse(spawnSync('cmd.exe', ['/d', '/s', '/c', command], {
        input: JSON.stringify(event), encoding: 'utf8', windowsHide: true, timeout: 15_000, env: TEST_ENV,
      })), join(dirname(script), '..', 'REVIEW.md'));
    }
    result = spawnSync(exe, args, { input: JSON.stringify(event), encoding: 'utf8', windowsHide: true, timeout: 15_000, env: TEST_ENV });
  } else {
    result = spawnSync('/bin/sh', ['-c', command], { input: JSON.stringify(event), encoding: 'utf8', timeout: 15_000, env: TEST_ENV });
  }
  continues(parse(result), join(dirname(script), '..', 'REVIEW.md'));
}

test('현재 Node와 훅 경로로 생성한 설정 명령이 셸 해석에 의존하지 않고 실행된다', async () => {
  await fixture(({ script, event }) => assertCommand(script, event));
});

test('단순 Windows 경로의 직접 준비 명령도 출력을 닫고 살아 있는 감시로 검토한다', {
  skip: process.platform !== 'win32'
    || ![process.execPath, TEST_ROOT].every(path => /^[a-z]:[\\/][a-z0-9_./\\-]+$/i.test(path)),
}, async () => {
  await fixture(({ script, transcriptPath, event }) => {
    const command = generated(script, process.execPath, 'PreInvocation');
    assert.equal(command, `${process.execPath.replaceAll('\\', '/')} ${script.replaceAll('\\', '/')} --prepare`);
    writeFileSync(transcriptPath, [user, model('이전 응답'), user].map(JSON.stringify).join('\n'));
    const [exe, ...args] = command.split(' ');
    const result = spawnSync(exe, args, { input: JSON.stringify(event), encoding: 'utf8', windowsHide: true, timeout: 15_000, env: TEST_ENV });
    assert.deepEqual(parse(result), { injectSteps: [] });
    const directory = join(TEST_ROOT, 'ai-setting-code-quality-review');
    const state = readdirSync(directory).filter(name => /^[a-f0-9]{64}\.json$/.test(name))
      .map(name => JSON.parse(readFileSync(join(directory, name), 'utf8')))
      .find(state => state.phase === 'ready' && state.roots.some(root => root.path === event.workspacePaths[0]));
    assert.ok(state); assert.doesNotThrow(() => process.kill(state.pid, 0));
    writeFileSync(join(event.workspacePaths[0], 'code.mjs'), 'changed after direct preparation');
    assertCommand(script, event);
  }, { changed: false });
});

test('Windows 경로의 공백·특수문자·비ASCII 문자는 인코딩된 실행기를 유지한다', {
  skip: process.platform !== 'win32',
}, async () => {
  await fixture(({ directory, script }) => {
    for (const name of ['space hook.mjs', "quote'hook.mjs", 'value$hook.mjs', 'percent%LITERAL%.mjs',
      'bang!hook.mjs', 'amp&hook.mjs', 'caret^hook.mjs', 'round(x).mjs', 'square[x].mjs', '한글.mjs']) {
      const target = join(directory, name); copyFileSync(script, target);
      assert.match(generated(target), /^powershell\.exe -NoProfile -NonInteractive -EncodedCommand [A-Za-z0-9+/=]+$/);
    }
  }, { changed: false });
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
