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
import { prepareChanges, checkChanges, stopChanges, stopSession, finishWatch, requestWatch, watchErrorCode, ChangeWatchError } from './review-changes.mjs';

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

test('추적·미추적 혼합 배치는 Git 분류 없이 즉시 수정으로 확정한다', async () => {
  const f = fixture(), inject = join(root, 'mixed-tracked-batch.mjs'), calls = join(root, 'mixed-ignore-calls');
  git(f.cwd, 'init', '--quiet'); git(f.cwd, 'add', 'code.mjs');
  writeFileSync(join(f.cwd, 'untracked.mjs'), 'untracked');
  writeFileSync(inject, `import fs from 'node:fs';import cp from 'node:child_process';import{syncBuiltinESMExports}from'node:module';
const watch=fs.watch;fs.watch=(path,options,listener)=>watch(path,options,(event,name)=>{if(name==='batch.trigger'){listener('change','code.mjs');listener('change','untracked.mjs');}else listener(event,name)});
const spawn=cp.spawn;cp.spawn=(file,args,...rest)=>{if(file==='git'&&args.includes('check-ignore')){fs.writeFileSync(${JSON.stringify(calls)},'called');throw Error('Injected ignore failure');}return spawn(file,args,...rest)};syncBuiltinESMExports();`);
  process.env.NODE_OPTIONS = `--import=${pathToFileURL(inject).href}`;
  try { await f.prepare(); }
  finally { if (previous.NODE_OPTIONS === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previous.NODE_OPTIONS; }
  writeFileSync(join(f.cwd, 'batch.trigger'), 'emit mixed events');
  assert.equal((await f.check()).changed, true);
  assert.equal(stateFor(f.cwd).state.failed, undefined);
  assert.equal(readdirSync(root).includes('mixed-ignore-calls'), false);
});

test('7일 지난 종료 쌍·임시 파일만 정리하고 활성·불명확 기록은 보존한다', async () => {
  const closed = fixture(), active = fixture();
  await closed.prepare(); await closed.check(); await active.prepare();
  const done = stateFor(closed.cwd), live = stateFor(active.cwd), directory = join(root, 'ai-setting-code-quality-review');
  const doneOwner = join(directory, `owner-${done.state.owner}.json`), liveOwner = join(directory, `owner-${live.state.owner}.json`);
  const old = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000);
  const doneTmp = `${done.path}.${randomUUID()}.tmp`, liveTmp = `${live.path}.${randomUUID()}.tmp`;
  const orphanTmp = join(directory, `${'a'.repeat(64)}.json.${randomUUID()}.tmp`);
  const unknown = join(directory, `${'b'.repeat(64)}.json`), malformed = join(directory, `${'c'.repeat(64)}.json`);
  const recentTmp = `${done.path}.${randomUUID()}.tmp`, unrelated = join(directory, 'unrelated.tmp');
  for (const path of [doneTmp, liveTmp, orphanTmp, recentTmp, unrelated]) writeFileSync(path, '{}');
  writeFileSync(unknown, JSON.stringify({ version: 2, phase: 'ready' })); writeFileSync(malformed, '{');
  for (const path of [done.path, doneOwner, live.path, liveOwner, doneTmp, liveTmp, orphanTmp, unknown, malformed, unrelated]) utimesSync(path, old, old);
  try {
    await fixture().prepare();
    for (const path of [done.path, doneOwner, doneTmp, orphanTmp]) assert.throws(() => readFileSync(path), { code: 'ENOENT' });
    for (const path of [live.path, liveOwner, liveTmp, unknown, malformed, recentTmp, unrelated]) assert.doesNotThrow(() => readFileSync(path));
    assert.equal((await requestWatch(live.state, 'status')).phase, 'ready');
  } finally { rmSync(malformed, { force: true }); }
});

test('정리 중 현재 owner의 오래된 종료·검토 예산 기록은 보존한다', async () => {
  const f = fixture(); await f.prepare(); writeFileSync(join(f.cwd, 'code.mjs'), 'changed');
  const gate = await f.check(); await gate.record('review-requested'); await gate.record('review-requested'); await gate.record('review-finished');
  const previousState = stateFor(f.cwd), directory = join(root, 'ai-setting-code-quality-review');
  const owner = join(directory, `owner-${previousState.state.owner}.json`), old = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000);
  for (const path of [previousState.path, owner]) utimesSync(path, old, old);
  await f.prepare('next');
  assert.equal(JSON.parse(readFileSync(previousState.path, 'utf8')).reviewRequests, 2);
  assert.equal((await f.check()).terminal, 'review-finished');
  assert.equal((await f.check('next')).changed, false);
});

test('원본 기록을 잃은 오래된 owner는 정리하지 않아 같은 요청의 재준비를 막는다', async () => {
  const f = fixture(); await f.prepare(); const current = stateFor(f.cwd);
  const owner = join(root, 'ai-setting-code-quality-review', `owner-${current.state.owner}.json`);
  rmSync(current.path); const old = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000); utimesSync(owner, old, old);
  await fixture().prepare();
  assert.doesNotThrow(() => readFileSync(owner));
  await assert.rejects(f.prepare(), ChangeWatchError);
  await unavailable(f.check());
});

test('상태 저장 rename 실패는 원본 오류·파일을 보존하고 임시 파일은 지운다', () => {
  const cwd = mkdtempSync(join(root, 'save-failure-')), target = join(cwd, 'state.json'); writeFileSync(target, 'original');
  const script = `import fs from 'node:fs';import{syncBuiltinESMExports}from'node:module';import{saveWatch}from${JSON.stringify(new URL('./review-changes.mjs', import.meta.url).href)};fs.renameSync=()=>{throw Object.assign(Error('original failure'),{code:'EACCES'})};syncBuiltinESMExports();try{saveWatch(${JSON.stringify(target)},{value:2});process.exitCode=1}catch(error){if(error.code!=='EACCES'||error.message!=='original failure')process.exitCode=2}`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { windowsHide: true, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(target, 'utf8'), 'original');
  assert.deepEqual(readdirSync(cwd), ['state.json']);
});

test('진단에는 허용된 오류 코드만 남기며 임의 메시지·코드는 저장하지 않는다', () => {
  assert.equal(watchErrorCode({ code: 'EACCES', message: 'PRIVATE_MESSAGE' }), 'EACCES');
  assert.equal(watchErrorCode({ code: 'PRIVATE_CODE', message: 'PRIVATE_MESSAGE' }), undefined);
  assert.equal(watchErrorCode(Error('PRIVATE_MESSAGE')), undefined);
  assert.equal(watchErrorCode(new ChangeWatchError('safe wrapper', { cause: { code: 'EIO' } })), 'EIO');
});

for (const mode of ['write', 'git']) {
  test(`준비 중 원본 오류를 감싸도 허용 OS 코드를 보존한다: ${mode}`, () => {
    const cwd = mkdtempSync(join(root, 'prepare-code-')), temporary = mkdtempSync(join(root, 'prepare-temp-'));
    const script = `import fs from 'node:fs';import cp from 'node:child_process';import{join}from'node:path';import{syncBuiltinESMExports}from'node:module';import{prepareChanges,finishWatch}from${JSON.stringify(new URL('./review-changes.mjs', import.meta.url).href)};
const write=fs.writeFileSync;let failed=false;fs.writeFileSync=(path,data,options)=>{if(${JSON.stringify(mode)}==='write'&&!failed&&options?.flag==='wx'){failed=true;throw Object.assign(Error('PRIVATE_FAILURE_MESSAGE'),{code:'ENOSPC'})}return write(path,data,options)};
const spawn=cp.spawnSync;cp.spawnSync=(file,args,...rest)=>file==='git'&&${JSON.stringify(mode)}==='git'?{status:null,error:Object.assign(Error('PRIVATE_FAILURE_MESSAGE'),{code:'EIO'})}:spawn(file,args,...rest);syncBuiltinESMExports();
try{await prepareChanges('test','diagnostic','turn',[${JSON.stringify(cwd)}]);process.exitCode=1}catch{const dir=join(process.env.TEMP,'ai-setting-code-quality-review'),name=fs.readdirSync(dir).find(n=>/^[a-f0-9]{64}\\.json$/.test(n));const path=join(dir,name),text=fs.readFileSync(path,'utf8'),state=JSON.parse(text);if(state.failed!=='watch-prepare-failed'||state.errorCode!==${JSON.stringify(mode === 'write' ? 'ENOSPC' : 'EIO')}||!(/^[a-f0-9]{64}$/.test(state.owner))||text.includes('PRIVATE_FAILURE_MESSAGE'))process.exitCode=2;
const old=new Date(Date.now()-9*86400000);fs.utimesSync(path,old,old);try{await prepareChanges('test','cleanup-next','turn',[${JSON.stringify(cwd)}])}catch{}if(fs.existsSync(path))process.exitCode=3;for(const n of fs.readdirSync(dir))if(/^[a-f0-9]{64}\\.json$/.test(n))await finishWatch(JSON.parse(fs.readFileSync(join(dir,n),'utf8')));}`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      windowsHide: true, encoding: 'utf8', env: { ...process.env, TMP: temporary, TEMP: temporary, TMPDIR: temporary },
    });
    assert.equal(result.status, 0, result.stderr);
  });
}

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
  writeFileSync(inject, "import fs from 'node:fs';import{syncBuiltinESMExports}from'node:module';fs.watch=()=>{throw Object.assign(Error('PRIVATE_FAILURE_MESSAGE'),{code:'EACCES'})};syncBuiltinESMExports();");
  process.env.NODE_OPTIONS = `--import=${pathToFileURL(inject).href}`;
  try { await assert.rejects(f.prepare(), ChangeWatchError); }
  finally { if (previous.NODE_OPTIONS === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previous.NODE_OPTIONS; }
  const pid = stateFor(f.cwd).state.pid;
  assert.equal(stateFor(f.cwd).state.failed, 'watch-start-failed');
  assert.equal(stateFor(f.cwd).state.errorCode, 'EACCES');
  assert.equal(readFileSync(stateFor(f.cwd).path, 'utf8').includes('PRIVATE_FAILURE_MESSAGE'), false);
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
  assert.equal(stateFor(f.cwd).state.failed, 'watch-start-failed');
  assert.equal(stateFor(f.cwd).state.errorCode, 'EACCES');
  await unavailable(f.check());
});

test('root 교체와 잘못된 작업 ID는 감시 실패로 처리한다', async () => {
  const f = fixture(); await f.prepare();
  renameSync(f.cwd, f.cwd + '-moved'); mkdirSync(f.cwd);
  await unavailable(f.check());
  await assert.rejects(prepareChanges('test', '', '', [f.cwd]), ChangeWatchError);
});

test('Git 추적 목록 조회 실패의 원본 OS 코드도 보존한다', async () => {
  const f = fixture(), inject = join(root, 'fail-tracked-lookup.mjs'); git(f.cwd, 'init', '--quiet');
  writeFileSync(inject, `import cp from 'node:child_process';import{syncBuiltinESMExports}from'node:module';const spawn=cp.spawnSync;cp.spawnSync=(file,args,...rest)=>file==='git'&&args.includes('ls-files')?{status:null,error:Object.assign(Error('PRIVATE_FAILURE_MESSAGE'),{code:'EIO'})}:spawn(file,args,...rest);syncBuiltinESMExports();`);
  process.env.NODE_OPTIONS = `--import=${pathToFileURL(inject).href}`;
  try { await assert.rejects(f.prepare(), ChangeWatchError); }
  finally { if (previous.NODE_OPTIONS === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previous.NODE_OPTIONS; }
  const current = stateFor(f.cwd);
  assert.equal(current.state.phase, 'closed');
  assert.equal(current.state.failed, 'watch-start-failed');
  assert.equal(current.state.errorCode, 'EIO');
  assert.equal(readFileSync(current.path, 'utf8').includes('PRIVATE_FAILURE_MESSAGE'), false);
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

for (const mode of ['metadata', 'missing-name', 'empty-name', 'native-error']) {
  test(`수정 감지 후 불필요한 분류를 멈추고 실제 감시 오류는 유지한다: ${mode}`, async () => {
    const f = fixture(), inject = join(root, `after-edit-${mode}.mjs`), calls = join(root, `metadata-${mode}.log`);
    writeFileSync(inject, `import fs from 'node:fs';import{syncBuiltinESMExports}from'node:module';
const stat=fs.lstatSync;fs.lstatSync=(path,...args)=>{if(String(path).replaceAll('\\\\','/').endsWith('/noise.mjs')){fs.appendFileSync(${JSON.stringify(calls)},'stat\\n');if(${JSON.stringify(mode)}==='metadata')throw Object.assign(Error('Injected metadata failure'),{code:'EPERM'});}return stat(path,...args)};
const watch=fs.watch;fs.watch=(path,options,listener)=>{const watcher=watch(path,options,(event,filename)=>{if(filename==='noise.mjs'){if(${JSON.stringify(mode)}==='native-error'){watcher.emit('error',Error('Injected native watcher failure'));return;}if(${JSON.stringify(mode)}==='missing-name')filename=null;if(${JSON.stringify(mode)}==='empty-name')filename='';}listener(event,filename)});return watcher};syncBuiltinESMExports();`);
    process.env.NODE_OPTIONS = `--import=${pathToFileURL(inject).href}`;
    try { await f.prepare(); }
    finally { if (previous.NODE_OPTIONS === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previous.NODE_OPTIONS; }
    writeFileSync(join(f.cwd, 'code.mjs'), 'changed');
    for (let i = 0; i < 100 && !stateFor(f.cwd).state.changed; i++) await delay(10);
    assert.equal(stateFor(f.cwd).state.changed, true);
    writeFileSync(join(f.cwd, 'noise.mjs'), 'later event');
    await delay(100);
    if (mode === 'native-error') {
      assert.equal(stateFor(f.cwd).state.failed, 'watch-error');
      await unavailable(f.check());
    } else {
      assert.equal((await f.check()).changed, true);
      assert.equal(stateFor(f.cwd).state.failed, undefined);
      assert.equal(readdirSync(root).includes(`metadata-${mode}.log`), false, 'classified an event after the edit was already known');
    }
  });
}

test('수정 판단 전의 파일 정보 조회 실패는 무변경으로 숨기지 않는다', async () => {
  const f = fixture(), inject = join(root, 'metadata-before-edit.mjs');
  writeFileSync(inject, `import fs from 'node:fs';import{syncBuiltinESMExports}from'node:module';const stat=fs.lstatSync;fs.lstatSync=(path,...args)=>{if(String(path).replaceAll('\\\\','/').endsWith('/noise.mjs'))throw Object.assign(Error('Injected metadata failure'),{code:'EPERM'});return stat(path,...args)};syncBuiltinESMExports();`);
  process.env.NODE_OPTIONS = `--import=${pathToFileURL(inject).href}`;
  try { await f.prepare(); }
  finally { if (previous.NODE_OPTIONS === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previous.NODE_OPTIONS; }
  writeFileSync(join(f.cwd, 'noise.mjs'), 'unknown event');
  await delay(100);
  assert.equal(stateFor(f.cwd).state.failed, 'watch-event-failed');
  await unavailable(f.check());
});

test('같은 root의 Git 분류가 진행 중이어도 추적 파일의 수정은 즉시 확정한다', async () => {
  const f = fixture(); git(f.cwd, 'init', '--quiet'); git(f.cwd, 'add', 'code.mjs');
  const marker = join(root, 'same-root-ignore-started'), inject = join(root, 'same-root-delayed-ignore.mjs');
  writeFileSync(inject, `import cp from 'node:child_process';import fs from 'node:fs';import{syncBuiltinESMExports}from'node:module';const spawn=cp.spawn;cp.spawn=(file,args,options)=>{if(file==='git'&&args.includes('check-ignore')){fs.writeFileSync(${JSON.stringify(marker)},'started');return spawn(process.execPath,['-e','process.stdin.resume();setTimeout(()=>process.exit(2),300)'],options);}return spawn(file,args,options)};syncBuiltinESMExports();`);
  process.env.NODE_OPTIONS = `--import=${pathToFileURL(inject).href}`;
  try { await f.prepare(); }
  finally { if (previous.NODE_OPTIONS === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previous.NODE_OPTIONS; }
  writeFileSync(join(f.cwd, 'untracked.mjs'), 'pending');
  for (let i = 0; i < 100 && !readdirSync(root).includes('same-root-ignore-started'); i++) await delay(10);
  assert.equal(readdirSync(root).includes('same-root-ignore-started'), true);
  writeFileSync(join(f.cwd, 'code.mjs'), 'confirmed tracked edit');
  assert.equal((await f.check()).changed, true);
  assert.equal(stateFor(f.cwd).state.failed, undefined);
});

for (const edited of [false, true]) {
  test(`여러 root의 진행 중 Git 분류 실패는 확정 변경 유무를 따른다: ${edited}`, async () => {
    const first = fixture(), second = fixture(), paths = [first.cwd, second.cwd];
    for (const cwd of paths) { git(cwd, 'init', '--quiet'); git(cwd, 'add', 'code.mjs'); }
    const marker = join(root, `ignore-started-${edited}`), inject = join(root, `delayed-ignore-${edited}.mjs`);
    writeFileSync(inject, `import cp from 'node:child_process';import fs from 'node:fs';import{resolve}from'node:path';import{syncBuiltinESMExports}from'node:module';const spawn=cp.spawn;cp.spawn=(file,args,options)=>{if(file==='git'&&args.includes('check-ignore')&&resolve(args[1])===${JSON.stringify(resolve(first.cwd))}){fs.writeFileSync(${JSON.stringify(marker)},'started');return spawn(process.execPath,['-e','process.stdin.resume();setTimeout(()=>process.exit(2),300)'],options);}return spawn(file,args,options)};syncBuiltinESMExports();`);
    process.env.NODE_OPTIONS = `--import=${pathToFileURL(inject).href}`;
    try { await prepareChanges('test', first.cwd, 'turn', paths); }
    finally { if (previous.NODE_OPTIONS === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previous.NODE_OPTIONS; }
    writeFileSync(join(first.cwd, 'untracked.mjs'), 'pending classification');
    for (let i = 0; i < 100 && !readdirSync(root).includes(`ignore-started-${edited}`); i++) await delay(10);
    assert.equal(readdirSync(root).includes(`ignore-started-${edited}`), true);
    if (edited) writeFileSync(join(second.cwd, 'code.mjs'), 'confirmed tracked edit');
    await delay(500);
    const result = await checkChanges('test', first.cwd, 'turn', paths);
    if (edited) {
      assert.equal(result.changed, true);
      assert.equal(stateFor(first.cwd).state.failed, undefined);
    } else {
      assert.equal(result.failed, true);
      assert.equal(stateFor(first.cwd).state.failed, 'event-filter-failed');
    }
  });
}

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

test('첫 수정 기록의 저장 실패도 감시 실패로 보존한다', async () => {
  const f = fixture(), inject = join(root, 'fail-edit-save.mjs');
  writeFileSync(inject, `import fs from 'node:fs';import{syncBuiltinESMExports}from'node:module';const old=fs.renameSync;fs.renameSync=(a,b)=>{if(JSON.parse(fs.readFileSync(a,'utf8')).action==='edited')throw Error('Injected edit state write failure');return old(a,b)};syncBuiltinESMExports();`);
  process.env.NODE_OPTIONS = `--import=${pathToFileURL(inject).href}`;
  try { await f.prepare(); } finally { if (previous.NODE_OPTIONS === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previous.NODE_OPTIONS; }
  writeFileSync(join(f.cwd, 'code.mjs'), 'changed');
  await delay(150);
  await unavailable(f.check());
  assert.equal(stateFor(f.cwd).state.failed, 'event-filter-failed');
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
