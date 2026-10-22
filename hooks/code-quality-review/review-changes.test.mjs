import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, renameSync, symlinkSync, truncateSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { prepareChanges, checkChanges, stopChanges, stopSession, finishWatch, requestWatch, ChangeWatchError } from './review-changes.mjs';

const previous = { TMP: process.env.TMP, TEMP: process.env.TEMP, TMPDIR: process.env.TMPDIR, NODE_OPTIONS: process.env.NODE_OPTIONS };
const originalTmp = tmpdir(), root = mkdtempSync(join(originalTmp, 'quality-watch-test-'));
process.env.TMP = process.env.TEMP = process.env.TMPDIR = root;
async function cleanup() {
  const directory = join(root, 'ai-setting-code-quality-review');
  try { for (const name of readdirSync(directory)) {
    if (/^[a-f0-9]{64}\.json$/.test(name)) await finishWatch(JSON.parse(readFileSync(join(directory, name), 'utf8')));
  } } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
afterEach(cleanup);
after(async () => {
  await cleanup();
  for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  assert.ok(resolve(root).startsWith(resolve(originalTmp) + sep));
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
function fixture() {
  const cwd = mkdtempSync(join(root, 'workspace-'));
  writeFileSync(join(cwd, 'code.mjs'), 'export const value = 1;\n');
  return { cwd, prepare: (turn = 'turn') => prepareChanges('test', cwd, turn, [cwd]),
    check: (turn = 'turn') => checkChanges('test', cwd, turn, [cwd]) };
}
function stateFor(cwd) {
  const directory = join(root, 'ai-setting-code-quality-review');
  for (const name of readdirSync(directory)) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
    const path = join(directory, name), state = JSON.parse(readFileSync(path, 'utf8'));
    if (state.roots?.some((r) => resolve(r.path) === resolve(cwd))) return { path, state };
  }
  throw Error('Missing fixture state');
}
function git(cwd, ...args) {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
}
async function unavailable(promise) {
  await promise.then((result) => { assert.equal(result.failed, true); assert.equal('changed' in result, false); },
    (error) => assert.ok(error instanceof ChangeWatchError));
}

test('무변경·문서·제외 폴더는 내용 읽기 없이 종료하고 감시를 닫는다', async () => {
  const f = fixture();
  const guard = join(root, 'no-content-read.mjs');
  writeFileSync(guard, `import fs from 'node:fs';import{syncBuiltinESMExports}from'node:module';const old=fs.readFileSync;fs.readFileSync=(p,...a)=>{if(String(p).startsWith(${JSON.stringify(f.cwd + sep)}))throw Error('Unexpected workspace content read');return old(p,...a)};syncBuiltinESMExports();`);
  process.env.NODE_OPTIONS = `--import=${pathToFileURL(guard).href}`;
  try { await f.prepare(); } finally { if (previous.NODE_OPTIONS === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previous.NODE_OPTIONS; }
  writeFileSync(join(f.cwd, 'README.md'), 'documentation');
  mkdirSync(join(f.cwd, 'dist')); writeFileSync(join(f.cwd, 'dist', 'generated.mjs'), 'generated');
  assert.equal((await f.check()).changed, false);
  assert.equal(stateFor(f.cwd).state.phase, 'closed');
});

test('Windows PowerShell 준비 명령의 출력 파이프는 살아 있는 감시와 독립적으로 닫힌다', { skip: process.platform !== 'win32' }, async () => {
  const f = fixture(), script = join(root, 'prepare-through-powershell.mjs');
  writeFileSync(script, `import{prepareChanges}from ${JSON.stringify(new URL('./review-changes.mjs', import.meta.url).href)};await prepareChanges('test',${JSON.stringify(f.cwd)},'turn',[${JSON.stringify(f.cwd)}]);console.log('prepared');`);
  const quote = (value) => `'${value.replaceAll('\\', '/').replace(/['\u2018-\u201b]/g, (char) => char + char)}'`;
  const command = `& ${quote(process.execPath)} ${quote(script)}`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], {
    encoding: 'utf8', timeout: 8000, windowsHide: true,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'prepared');
  const { state } = stateFor(f.cwd);
  assert.equal(state.phase, 'ready');
  assert.doesNotThrow(() => process.kill(state.pid, 0));
  assert.equal((await f.check()).changed, false);
});

test('셸·별도 프로세스의 수정과 실패 전 부분 수정도 감지한다', async () => {
  const f = fixture(); await f.prepare();
  const child = spawnSync(process.execPath, ['-e', "require('node:fs').writeFileSync('code.mjs','export const value = 2;\\n');process.exit(1)"], { cwd: f.cwd, windowsHide: true });
  assert.equal(child.status, 1);
  utimesSync(join(f.cwd, 'code.mjs'), new Date(0), new Date(0));
  assert.equal((await f.check()).changed, true);
});

test('같은 내용 저장·수정 후 원복도 수정 발생으로 기록한다', async () => {
  for (const restore of [false, true]) {
    const f = fixture(), path = join(f.cwd, 'code.mjs'), content = readFileSync(path);
    await f.prepare();
    if (restore) writeFileSync(path, 'temporary');
    writeFileSync(path, content);
    assert.equal((await f.check()).changed, true);
  }
});

test('파일 추가·삭제·이름 변경과 새 폴더 직후 쓰기를 감지한다', async () => {
  for (const operation of ['add', 'delete', 'rename', 'nested']) {
    const f = fixture(); await f.prepare(); const path = join(f.cwd, 'code.mjs');
    if (operation === 'add') writeFileSync(join(f.cwd, 'new.json'), '{}');
    if (operation === 'delete') rmSync(path);
    if (operation === 'rename') renameSync(path, join(f.cwd, 'renamed.mjs'));
    if (operation === 'nested') { mkdirSync(join(f.cwd, 'src')); writeFileSync(join(f.cwd, 'src', 'new.mjs'), 'new'); }
    assert.equal((await f.check()).changed, true, operation);
  }
});

test('기존 Git 사용자 변경은 기준에 포함하고 ignored 변경은 제외한다', async () => {
  const f = fixture(); git(f.cwd, 'init', '--quiet'); git(f.cwd, 'add', 'code.mjs');
  writeFileSync(join(f.cwd, 'code.mjs'), 'existing user change');
  writeFileSync(join(f.cwd, '.gitignore'), 'ignored/\n');
  mkdirSync(join(f.cwd, 'ignored')); await f.prepare();
  writeFileSync(join(f.cwd, 'ignored', 'code.mjs'), 'ignored change');
  assert.equal((await f.check()).changed, false);
});

test('하위 cwd도 Git 최상위 형제 폴더 변경과 ignored 패턴의 추적 폴더 삭제를 감지한다', async () => {
  const f = fixture(); git(f.cwd, 'init', '--quiet');
  mkdirSync(join(f.cwd, 'src')); mkdirSync(join(f.cwd, 'other'));
  writeFileSync(join(f.cwd, 'src', 'code.mjs'), 'tracked'); git(f.cwd, 'add', '.');
  writeFileSync(join(f.cwd, '.gitignore'), 'src/\n');
  await prepareChanges('test', f.cwd, 'child', [join(f.cwd, 'other')]);
  rmSync(join(f.cwd, 'src'), { recursive: true });
  assert.equal((await checkChanges('test', f.cwd, 'child', [join(f.cwd, 'other')])).changed, true);
});

test('폴더 이동·파일 대체·junction 대체를 보수적으로 감지한다', async () => {
  for (const operation of ['move', 'file', 'link']) {
    const f = fixture(), directory = join(f.cwd, 'src'), target = mkdtempSync(join(root, 'target-'));
    mkdirSync(directory); writeFileSync(join(directory, 'code.mjs'), 'before'); await f.prepare();
    if (operation === 'move') renameSync(directory, join(f.cwd, 'dist'));
    else { rmSync(directory, { recursive: true }); if (operation === 'file') writeFileSync(directory, 'replaced'); else symlinkSync(target, directory, process.platform === 'win32' ? 'junction' : 'dir'); }
    assert.equal((await f.check()).changed, true, operation);
  }
});

test('기존 junction 대상 변경은 작업 폴더 밖으로 따라가지 않는다', async () => {
  const f = fixture(), target = mkdtempSync(join(root, 'outside-'));
  writeFileSync(join(target, 'code.mjs'), 'outside');
  symlinkSync(target, join(f.cwd, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await f.prepare(); writeFileSync(join(target, 'code.mjs'), 'outside changed');
  assert.equal((await f.check()).changed, false);
});

test('반복 준비와 revised는 수정 상태를 초기화하지 않고 종료 표식에서 닫는다', async () => {
  const f = fixture(); await f.prepare(); writeFileSync(join(f.cwd, 'code.mjs'), 'changed'); await f.prepare();
  const gate = await f.check(); assert.equal(gate.changed, true); await gate.record('review-requested');
  assert.equal((await f.check()).reviewing, true);
  await (await f.check()).record('review-finished');
  assert.equal(stateFor(f.cwd).state.phase, 'closed');
});

test('독립 세션과 중첩 root의 probe가 가짜 수정을 만들지 않는다', async () => {
  const f = fixture(); mkdirSync(join(f.cwd, 'nested'));
  await f.prepare(); await prepareChanges('test', 'second', 'turn', [f.cwd, join(f.cwd, 'nested')]);
  assert.equal((await f.check()).changed, false);
  assert.equal((await checkChanges('test', 'second', 'turn', [f.cwd, join(f.cwd, 'nested')])).changed, false);
});

test('같은 세션의 새 요청은 이전 감시를 닫고 늦은 Stop은 실패로 처리한다', async () => {
  const f = fixture(); await f.prepare('one'); await f.prepare('two');
  assert.equal((await f.check('one')).terminal, 'superseded');
  writeFileSync(join(f.cwd, 'code.mjs'), 'new request change');
  assert.equal((await f.check('two')).changed, true);
});

test('준비 후 기록 유실은 재준비로 변경·예산을 초기화하지 않는다', async () => {
  const f = fixture(); await f.prepare(); writeFileSync(join(f.cwd, 'code.mjs'), 'changed');
  await (await f.check()).record('review-requested');
  const current = stateFor(f.cwd); rmSync(current.path);
  await assert.rejects(f.prepare(), ChangeWatchError);
  await unavailable(f.check());
  await f.prepare(); assert.equal(stateFor(f.cwd).state.action, 'watch-failed');
});

test('Stop에서 기록 유실을 발견해도 동일 요청 owner backup으로 감시를 닫는다', async () => {
  const f = fixture(); await f.prepare(); const current = stateFor(f.cwd); rmSync(current.path);
  await stopChanges('test', f.cwd, 'turn', [f.cwd]);
  await assert.rejects(requestWatch(current.state, 'status'), ChangeWatchError);
  await f.prepare(); await unavailable(f.check());
  assert.equal(JSON.parse(readFileSync(current.path, 'utf8')).action, 'watch-failed');
});

test('연결 정보 없는 기존 실패 기록도 새 요청 정리에서 감시를 닫고 실패를 보존한다', async () => {
  const f = fixture(); await f.prepare(); const current = stateFor(f.cwd);
  writeFileSync(current.path, JSON.stringify({ version: 2, phase: 'closed', action: 'watch-failed', failed: 'lost-state' }));
  try {
    await stopSession('test', f.cwd, [f.cwd]);
    await assert.rejects(requestWatch(current.state, 'status'), ChangeWatchError);
    assert.equal(JSON.parse(readFileSync(current.path, 'utf8')).failed, 'lost-state');
  } finally { await finishWatch(current.state); }
});

test('큰 파일도 내용을 읽지 않고 감시하며 대량 이벤트는 변경 또는 명시적 실패다', async () => {
  const f = fixture(), large = join(f.cwd, 'large.bin'); writeFileSync(large, ''); truncateSync(large, 512 * 1024 * 1024);
  await f.prepare();
  for (let i = 0; i < 2200; i++) writeFileSync(join(f.cwd, `file-${i}.mjs`), 'new');
  try { const result = await f.check(); assert.ok(result.changed === true || result.failed === true); }
  catch (error) { assert.ok(error instanceof ChangeWatchError); }
});

test('감시 프로세스 종료·준비 기록 누락·구버전 상태를 무변경으로 취급하지 않는다', async () => {
  const f = fixture(); await assert.rejects(f.check(), ChangeWatchError); await f.prepare();
  const current = stateFor(f.cwd); process.kill(current.state.pid);
  await assert.rejects(f.check(), ChangeWatchError);
  writeFileSync(current.path, JSON.stringify({ version: 1, roots: [], reviewing: false }));
  await assert.rejects(f.check(), ChangeWatchError);
});

test('준비 실패는 같은 요청의 재시도에서 초기화하지 않는다', async () => {
  const f = fixture(), inject = join(root, 'fail-watch.mjs');
  writeFileSync(inject, "import fs from 'node:fs';import{syncBuiltinESMExports}from'node:module';fs.watch=()=>{throw Error('Injected watch failure')};syncBuiltinESMExports();");
  process.env.NODE_OPTIONS = `--import=${pathToFileURL(inject).href}`;
  try { await assert.rejects(f.prepare(), ChangeWatchError); }
  finally { if (previous.NODE_OPTIONS === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previous.NODE_OPTIONS; }
  const pid = stateFor(f.cwd).state.pid;
  if (pid) {
    let alive = true;
    for (let i = 0; i < 50 && alive; i++) {
      try { process.kill(pid, 0); } catch { alive = false; }
      if (alive) await delay(20);
    }
    assert.equal(alive, false, 'failed startup left a watcher process running');
  }
  writeFileSync(join(f.cwd, 'code.mjs'), 'changed during failure');
  await f.prepare();
  assert.equal(stateFor(f.cwd).state.pid, pid);
  await unavailable(f.check());
});

test('root 교체와 잘못된 작업 ID는 감시 실패로 처리한다', async () => {
  const f = fixture(); await f.prepare();
  renameSync(f.cwd, f.cwd + '-moved'); mkdirSync(f.cwd);
  await unavailable(f.check());
  await assert.rejects(prepareChanges('test', '', '', [f.cwd]), ChangeWatchError);
});

test('잘못된 RPC 인증·응답은 무변경 응답으로 인정하지 않는다', async () => {
  const f = fixture(); await f.prepare(); const original = stateFor(f.cwd);
  writeFileSync(original.path, JSON.stringify({ ...original.state, token: 'invalid-token' }));
  try { await assert.rejects(f.check(), ChangeWatchError); }
  finally { writeFileSync(original.path, JSON.stringify(original.state)); }
});

test('이벤트 경로 누락과 probe 무응답은 준비 실패로 고정한다', async () => {
  for (const mode of ['missing-name', 'no-events']) {
    const f = fixture(), inject = join(root, `${mode}.mjs`);
    const callback = mode === 'missing-name' ? "(...args)=>listener(args[0],null)" : '()=>{}';
    writeFileSync(inject, `import fs from 'node:fs';import{syncBuiltinESMExports}from'node:module';const old=fs.watch;fs.watch=(path,options,listener)=>old(path,options,${callback});syncBuiltinESMExports();`);
    process.env.NODE_OPTIONS = `--import=${pathToFileURL(inject).href}`;
    try { await assert.rejects(f.prepare(), ChangeWatchError); }
    finally { if (previous.NODE_OPTIONS === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previous.NODE_OPTIONS; }
    await unavailable(f.check());
  }
});

test('동시 검토 허가도 저장된 요청당 예산 5회를 넘지 않는다', async () => {
  const f = fixture(); await f.prepare(); writeFileSync(join(f.cwd, 'code.mjs'), 'changed');
  const gate = await f.check();
  const results = await Promise.allSettled(Array.from({ length: 12 }, () => gate.record('review-requested')));
  const grants = results.filter((r) => r.status === 'fulfilled' && r.value.phase === 'ready');
  assert.equal(grants.length, 5);
  const state = stateFor(f.cwd).state;
  assert.equal(state.phase, 'closed'); assert.equal(state.action, 'review-limit'); assert.equal(state.reviewRequests, 5);
  await f.prepare(); assert.equal(stateFor(f.cwd).state.action, 'review-limit');
  assert.deepEqual(await f.check(), { terminal: 'review-limit', failed: false });
});

test('검토 예산 저장 실패는 continuation 허가로 반환하지 않는다', async () => {
  const f = fixture(), inject = join(root, 'fail-review-save.mjs');
  writeFileSync(inject, `import fs from 'node:fs';import{syncBuiltinESMExports}from'node:module';const old=fs.renameSync;fs.renameSync=(a,b)=>{if(JSON.parse(fs.readFileSync(a,'utf8')).action==='review-requested')throw Error('Injected state write failure');return old(a,b)};syncBuiltinESMExports();`);
  process.env.NODE_OPTIONS = `--import=${pathToFileURL(inject).href}`;
  try { await f.prepare(); } finally { if (previous.NODE_OPTIONS === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previous.NODE_OPTIONS; }
  writeFileSync(join(f.cwd, 'code.mjs'), 'changed');
  const gate = await f.check();
  await assert.rejects(gate.record('review-requested'), ChangeWatchError);
  assert.ok(stateFor(f.cwd).state.failed);
});

test('종료 기록이 정상 형태가 아니면 완료·무변경으로 인정하지 않는다', async () => {
  const f = fixture(); await f.prepare(); const current = stateFor(f.cwd); await finishWatch(current.state);
  for (const action of ['unchanged', 'review-finished', 'review-limit']) {
    writeFileSync(current.path, JSON.stringify({ version: 2, phase: 'closed', action }));
    await assert.rejects(f.check(), ChangeWatchError);
  }
});

test('RPC가 계속 작은 데이터를 보내도 전체 제한 시간에 종료한다', async () => {
  const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\quality-test-${randomUUID()}` : join(root, 'rpc-deadline.sock');
  const server = createServer((socket) => {
    const timer = setInterval(() => socket.write(' '), 30);
    const safety = setTimeout(() => socket.destroy(), 6000);
    socket.on('error', () => {});
    socket.on('close', () => { clearInterval(timer); clearTimeout(safety); });
  });
  await new Promise((resolveListen) => server.listen(endpoint, resolveListen));
  const started = Date.now();
  try { await assert.rejects(requestWatch({ endpoint, token: 'fixture' }, 'status'), ChangeWatchError); }
  finally { await new Promise((resolveClose) => server.close(resolveClose)); }
  assert.ok(Date.now() - started < 5000, 'RPC continued beyond its total deadline');
});

test('계속되는 ignored 이벤트에도 Stop은 유한 시간에 종료한다', async () => {
  const f = fixture(); git(f.cwd, 'init', '--quiet');
  writeFileSync(join(f.cwd, '.gitignore'), 'noise.mjs\n'); await f.prepare();
  const child = spawn(process.execPath, ['-e', "const fs=require('node:fs');setInterval(()=>fs.writeFileSync('noise.mjs','ignored'),1)"], { cwd: f.cwd, stdio: 'ignore', windowsHide: true });
  await delay(100); const started = Date.now();
  try { const result = await f.check(); assert.ok(result.changed === false || result.failed === true); }
  catch (error) { assert.ok(error instanceof ChangeWatchError); }
  finally { child.kill(); await new Promise((resolveClose) => child.on('close', resolveClose)); }
  assert.ok(Date.now() - started < 5000, 'Stop waited indefinitely for background events');
});
