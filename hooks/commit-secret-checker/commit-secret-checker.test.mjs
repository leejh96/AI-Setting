import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const script = fileURLToPath(new URL('./commit-secret-checker.mjs', import.meta.url));
const parent = resolve(tmpdir());
const root = mkdtempSync(join(parent, 'commit-secret-test-'));
after(() => {
  assert.ok(resolve(root).startsWith(parent + sep));
  rmSync(root, { recursive: true, force: true });
});
const preload = join(root, 'scanner.mjs');
const scannerWorker = join(root, 'scanner-worker.mjs');
writeFileSync(scannerWorker, `import{appendFileSync,readFileSync}from'node:fs';import{createHash}from'node:crypto';let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>input+=chunk);process.stdin.on('end',()=>{
appendFileSync(process.env.SCAN_TRACE,JSON.stringify({scanner:createHash('sha256').update(input).digest('hex')})+'\\n');
const code=Number(process.env.SCAN_STATUS||(input.includes('fixture-secret')?42:0)),mode=process.env.SCANNER_MODE;
if(mode==='hang'){setInterval(()=>{},1000);return;}
if(mode==='leak-peer'||mode==='error-peer'){
  if(input.includes('fixture-secret')){const wait=setInterval(()=>{if(readFileSync(process.env.SCAN_TRACE,'utf8').split('scannerStart').length-1>=2){clearInterval(wait);process.exitCode=mode==='error-peer'?2:42;}},10);}else setInterval(()=>{},1000);return;
}
setTimeout(()=>{process.exitCode=code;},mode==='parallel'?150:0);
});`);
const batchWorker = join(root, 'batch-worker.mjs');
writeFileSync(batchWorker, `let input = '';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>input+=chunk);
process.stdin.on('end',()=>{
  const id=input.trim().split('\\n')[0],mode=process.env.BATCH_MODE;
  if(mode==='stall'){setInterval(()=>{},1000);return;}
  if(mode==='invalid-header'){process.stdout.write(id+' missing\\n');return;}
  if(mode==='wrong-object'){process.stdout.write('0'.repeat(id.length)+' blob 1\\nx\\n');return;}
  if(mode==='wrong-type'){process.stdout.write(id+' tree 0\\n\\n');return;}
  if(mode==='truncated'){process.stdout.write(id+' blob 20\\nshort');return;}
  if(mode==='missing-newline'){process.stdout.write(id+' blob 1\\nx!');return;}
  const body=Buffer.from(mode==='leak-hold'?'fixture-secret':mode==='fragmented'?'한글😀\\n\\0':'clean');
  const frame=Buffer.concat([Buffer.from(id+' blob '+body.length+'\\n'),body,Buffer.from('\\n')]);
  if(mode==='fragmented'){let i=0;const send=()=>{if(i<frame.length){process.stdout.write(frame.subarray(i,i+1));i++;setTimeout(send,1);}};send();return;}
  process.stdout.write(frame);
  if(mode==='extra-data')process.stdout.write('unexpected bytes');
  if(mode==='nonzero')process.exitCode=2;
  if(mode==='leak-hold'||mode==='expired-after-scan')setInterval(()=>{},1000);
});`);
writeFileSync(preload, `import cp from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const original = cp.spawnSync;
const spawn = cp.spawn;
cp.spawn = (program, args, options) => {
  if(program==='fixture-scanner'){
    const child=spawn(process.execPath,[process.env.SCANNER_WORKER],options);
    appendFileSync(process.env.SCAN_TRACE,JSON.stringify({scannerStart:child.pid})+'\\n');
    child.once('close',()=>{appendFileSync(process.env.SCAN_TRACE,JSON.stringify({scannerEnd:child.pid})+'\\n');if(process.env.BATCH_MODE==='expired-after-scan'){const now=Date.now;Date.now=()=>now()+61000;}});
    return child;
  }
  if (program === 'git') appendFileSync(process.env.SCAN_TRACE, JSON.stringify({ git: args[0] }) + '\\n');
  if (program === 'git' && args.includes('--batch')) {
    if(process.env.BATCH_MODE==='expired'){const now=Date.now;Date.now=()=>now()+61000;}
    const child=process.env.BATCH_MODE==='spawn-error'?spawn(process.env.BATCH_WORKER+'-missing',[],options)
      :process.env.BATCH_MODE?spawn(process.execPath,[process.env.BATCH_WORKER],options):spawn(program,args,options);
    appendFileSync(process.env.SCAN_TRACE,JSON.stringify({batchPid:child.pid})+'\\n');
    return child;
  }
  return spawn(program,args,options);
};
if(process.env.BATCH_MODE==='stall'||process.env.SCANNER_MODE==='hang'){const timer=globalThis.setTimeout;globalThis.setTimeout=(fn,ms,...args)=>timer(fn,ms>50000?250:ms,...args);}
cp.spawnSync = (program, args, options) => {
  if (program === 'git') appendFileSync(process.env.SCAN_TRACE, JSON.stringify({ git: args[0] }) + '\\n');
  return original(program, args, options);
};
syncBuiltinESMExports();`);

function fixture({ initialCommit = true } = {}) {
  const cwd = mkdtempSync(join(root, 'repository-'));
  const trace = join(cwd, 'trace.log');
  const env = { ...process.env, AI_SETTING_GITLEAKS_BIN: 'fixture-scanner', SCAN_TRACE: trace,
    BATCH_WORKER: batchWorker,
    SCANNER_WORKER: scannerWorker,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --import=${pathToFileURL(preload).href}`.trim() };
  const git = (...args) => {
    const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '-q');
  git('config', 'core.hooksPath', join(cwd, 'disabled-hooks'));
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  if (initialCommit) git('commit', '--allow-empty', '-qm', 'baseline');
  const write = (name, content) => writeFileSync(join(cwd, name), content);
  const scan = (overrides = {}) => {
    writeFileSync(trace, '');
    const result = spawnSync(process.execPath, [script], { cwd, env: { ...env, ...overrides },
      encoding: 'utf8', windowsHide: true, timeout: 65000 });
    assert.equal(result.error, undefined);
    return { ...result, trace: readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) };
  };
  return { cwd, env, git, write, scan };
}

test('인덱스 메타데이터는 한 번만 조회하고 같은 blob은 한 번만 검사한다', () => {
  const f = fixture();
  f.write('first.js', 'same content\n');
  f.write('odd [name] 한글.js', 'same content\n');
  f.write('third.js', 'different content\n');
  f.git('add', '--', 'first.js', 'odd [name] 한글.js', 'third.js');
  const result = f.scan();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.trace.filter((entry) => entry.git).map((entry) => entry.git), ['diff', 'cat-file']);
  assert.equal(result.trace.filter((entry) => entry.scanner).length, 2);
});

test('빈 인덱스와 아직 HEAD가 없는 첫 커밋도 검사한다', () => {
  const f = fixture({ initialCommit: false });
  assert.equal(f.scan().status, 0);
  f.write('first.js', 'fixture-secret first commit');
  f.git('add', 'first.js');
  assert.equal(f.scan().status, 1);
});

test('작업 파일 대신 staged 전체 내용을 검사하고 차단 시 HEAD와 인덱스를 보존한다', () => {
  const f = fixture();
  f.write('code.js', 'clean staged content');
  f.git('add', 'code.js');
  f.write('code.js', 'fixture-secret in worktree');
  const clean = f.scan();
  assert.equal(clean.status, 0, clean.stderr);
  assert.equal(clean.trace.find((entry) => entry.scanner).scanner,
    createHash('sha256').update('clean staged content').digest('hex'));
  f.git('add', 'code.js');
  f.write('code.js', 'clean worktree content');
  const before = [f.git('rev-parse', 'HEAD'), f.git('write-tree')];
  const blocked = f.scan();
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /시크릿 후보/);
  assert.ok(!blocked.stderr.includes('fixture-secret'));
  assert.deepEqual([f.git('rev-parse', 'HEAD'), f.git('write-tree')], before);
  assert.equal(readFileSync(join(f.cwd, 'code.js'), 'utf8'), 'clean worktree content');
});

test('삭제·서브모듈은 제외하고 이름 변경·실행 모드 변경·심볼릭 링크 내용은 검사한다', () => {
  const f = fixture();
  f.write('old.js', 'rename content');
  f.write('deleted.js', 'removed content');
  f.write('mode.js', 'mode content');
  f.git('add', '--', 'old.js', 'deleted.js', 'mode.js');
  f.git('commit', '-qm', 'files');
  f.git('mv', 'old.js', 'new.js');
  f.git('rm', 'deleted.js');
  f.git('update-index', '--chmod=+x', 'mode.js');
  f.git('update-index', '--add', '--cacheinfo', `160000,${f.git('rev-parse', 'HEAD')},submodule`);
  const result = f.scan();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.trace.filter((entry) => entry.scanner).length, 2);
  f.write('target.txt', 'fixture-secret link target');
  const objectId = f.git('hash-object', '-w', 'target.txt');
  f.git('update-index', '--add', '--cacheinfo', `120000,${objectId},link`);
  assert.equal(f.scan().status, 1);
});

test('검사기 오류와 파일별 10MiB 제한 초과는 커밋을 차단한다', () => {
  const f = fixture();
  f.write('code.js', 'clean');
  f.git('add', 'code.js');
  assert.equal(f.scan({ SCAN_STATUS: '1' }).status, 1);
  assert.equal(f.scan({ AI_SETTING_GITLEAKS_BIN: join(root, 'missing-scanner') }).status, 1);
  f.write('large.txt', Buffer.alloc(10 * 1024 * 1024 + 1, 65));
  f.git('add', 'large.txt');
  assert.equal(f.scan().status, 1);
});

test('실제 pre-commit은 git commit -a와 파일 지정 커밋의 임시 인덱스를 검사한다', () => {
  const f = fixture();
  f.write('code.js', 'clean');
  f.git('add', 'code.js');
  f.git('commit', '-qm', 'tracked file');
  f.git('config', 'core.hooksPath', fileURLToPath(new URL('.', import.meta.url)));
  f.write('code.js', 'fixture-secret unstaged');
  const before = [f.git('rev-parse', 'HEAD'), f.git('write-tree')];
  for (const args of [['commit', '-am', 'blocked'], ['commit', '-m', 'blocked', '--', 'code.js']]) {
    const result = spawnSync('git', args, { cwd: f.cwd, env: f.env, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /시크릿 후보/);
    assert.deepEqual([f.git('rev-parse', 'HEAD'), f.git('write-tree')], before);
  }
});

test('실제 Gitleaks도 정상 입력은 통과하고 합성 시크릿은 차단한다', (t) => {
  const version = spawnSync('gitleaks', ['version'], { encoding: 'utf8', windowsHide: true });
  if (version.status !== 0) return t.skip('Gitleaks not installed');
  const f = fixture();
  f.write('code.js', 'export const value = 123;\n');
  f.git('add', 'code.js');
  assert.equal(f.scan({ AI_SETTING_GITLEAKS_BIN: 'gitleaks' }).status, 0);
  const syntheticToken = 'ghp_' + createHash('sha256').update('public test fixture only').digest('hex').slice(0, 36);
  f.write('code.js', `token = "${syntheticToken}"\n`);
  f.git('add', 'code.js');
  const blocked = f.scan({ AI_SETTING_GITLEAKS_BIN: 'gitleaks' });
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /시크릿 후보/);
});

test('합계가 10MiB를 넘어도 파일별 제한을 적용하고 빈 파일·바이너리 경계를 보존한다', () => {
  const f = fixture();
  f.write('first.bin', Buffer.alloc(6 * 1024 * 1024, 65));
  f.write('second.bin', Buffer.alloc(6 * 1024 * 1024, 66));
  f.write('empty.bin', '');
  const binary = Buffer.from([0xff, 0xfe, 0, 10, 65]);
  f.write('binary.bin', binary);
  f.git('add', '--', 'first.bin', 'second.bin', 'empty.bin', 'binary.bin');
  const result = f.scan();
  assert.equal(result.status, 0, result.stderr);
  const hashes = result.trace.filter((entry) => entry.scanner).map((entry) => entry.scanner);
  assert.equal(hashes.length, 4);
  for (const input of ['', binary.toString('utf8')]) assert.ok(hashes.includes(createHash('sha256').update(input).digest('hex')));
  assert.equal(result.trace.filter((entry) => entry.git === 'cat-file').length, 1);
});

test('분할된 배치 헤더와 UTF-8·NUL·개행이 포함된 내용을 파일 단위로 읽는다', () => {
  const f = fixture(); f.write('code.js', 'fixture'); f.git('add', 'code.js');
  const result = f.scan({ BATCH_MODE: 'fragmented' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.trace.find((entry) => entry.scanner).scanner,
    createHash('sha256').update('한글😀\n\0').digest('hex'));
});

for (const mode of ['invalid-header', 'wrong-object', 'wrong-type', 'truncated', 'missing-newline', 'extra-data', 'nonzero', 'spawn-error', 'expired', 'expired-after-scan', 'stall', 'leak-hold']) {
  test(`배치 오류·시간 초과·조기 차단은 커밋을 막고 하위 프로세스를 정리한다: ${mode}`, () => {
    const f = fixture(); f.write('code.js', 'fixture'); f.git('add', 'code.js');
    const before = [f.git('rev-parse', 'HEAD'), f.git('write-tree')];
    const result = f.scan({ BATCH_MODE: mode });
    assert.equal(result.status, 1, result.stderr);
    if (['expired', 'expired-after-scan', 'stall'].includes(mode)) assert.match(result.stderr, /60초/);
    if (mode === 'leak-hold') assert.match(result.stderr, /시크릿 후보/);
    assert.ok(!result.stderr.includes('fixture-secret'));
    assert.deepEqual([f.git('rev-parse', 'HEAD'), f.git('write-tree')], before);
    const pid = result.trace.find((entry) => entry.batchPid)?.batchPid;
    if (mode !== 'spawn-error') {
      assert.ok(pid);
      assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    }
  });
}

test('서로 다른 파일은 최대 두 검사기만 동시에 실행하고 모두 검사한다', () => {
  const f=fixture();
  for(let i=0;i<6;i++)f.write(`code-${i}.js`,`clean file ${i}`);
  f.git('add','--all');
  const result=f.scan({SCANNER_MODE:'parallel'});
  assert.equal(result.status,0,result.stderr);
  let active=0,peak=0;
  for(const entry of result.trace){if(entry.scannerStart){active++;peak=Math.max(peak,active);}if(entry.scannerEnd)active--;}
  assert.equal(peak,2);assert.equal(active,0);
  assert.equal(result.trace.filter(entry=>entry.scanner).length,6);
  for(const entry of result.trace)if(entry.scannerStart)assert.throws(()=>process.kill(entry.scannerStart,0),{code:'ESRCH'});
});

for(const mode of ['leak-peer','error-peer','hang']){
  test(`병렬 검사 실패는 다른 검사도 정리하고 HEAD·인덱스를 보존한다: ${mode}`,()=>{
    const f=fixture();f.write('a-clean.js','clean peer');f.write('b-secret.js','fixture-secret synthetic');f.write('c-next.js','must not start');f.git('add','--all');
    const before=[f.git('rev-parse','HEAD'),f.git('write-tree')];
    const result=f.scan({SCANNER_MODE:mode});assert.equal(result.status,1);
    if(mode==='leak-peer')assert.match(result.stderr,/시크릿 후보/);
    if(mode==='hang')assert.match(result.stderr,/60초/);
    assert.deepEqual([f.git('rev-parse','HEAD'),f.git('write-tree')],before);
    assert.ok(!result.stderr.includes('fixture-secret'));
    const starts=result.trace.filter(entry=>entry.scannerStart);assert.equal(starts.length,2);
    for(const entry of starts)assert.throws(()=>process.kill(entry.scannerStart,0),{code:'ESRCH'});
    for(const entry of result.trace)if(entry.batchPid)assert.throws(()=>process.kill(entry.batchPid,0),{code:'ESRCH'});
  });
}
