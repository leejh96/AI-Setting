import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = mkdtempSync(join(tmpdir(), 'prompt-hook-test-'));
after(() => rmSync(root, { recursive: true, force: true }));
const preload = join(root, 'scanner.mjs');
writeFileSync(preload, `import cp from 'node:child_process';import fs from 'node:fs';import{syncBuiltinESMExports}from'node:module';
const original=cp.spawnSync;cp.spawnSync=(program,args,options)=>{
  if(args[0]!=='stdin')return original(program,args,options);
  fs.writeFileSync(process.env.SCAN_TRACE,JSON.stringify({program,args,stdio:options.stdio,timeout:options.timeout,killSignal:options.killSignal,inputMatches:options.input==='synthetic-private-input'}));
  const mode=process.env.SCAN_MODE;
  if(mode==='timeout')return{status:null,error:{code:'ETIMEDOUT'}};
  if(mode==='missing')return{status:null,error:{code:'ENOENT'}};
  if(mode==='signal')return{status:null,signal:'SIGTERM'};
  return{status:Number(mode||0)};
};syncBuiltinESMExports();`);

function fixture(client) {
  const directory = mkdtempSync(join(root, 'fixture-'));
  const adapterDirectory = join(directory, client); mkdirSync(adapterDirectory);
  for (const name of ['secret-checker.mjs', 'gitleaks.toml']) {
    copyFileSync(new URL(name, import.meta.url), join(directory, name));
  }
  const script = join(adapterDirectory, "reviewer's 한글 $value`!%LITERAL% & (x).mjs");
  copyFileSync(new URL(`${client}/${client}-secret-checker.mjs`, import.meta.url), script);
  const transcriptPath = join(directory, 'transcript.jsonl');
  writeFileSync(transcriptPath, JSON.stringify({ type: 'USER_INPUT', content: 'synthetic-private-input' }));
  const trace = join(directory, 'scan.json');
  const input = JSON.stringify(client === 'codex'
    ? { hook_event_name: 'UserPromptSubmit', prompt: 'synthetic-private-input' }
    : { invocationNum: 1, transcriptPath });
  const env = { ...process.env, AI_SETTING_GITLEAKS_BIN: 'fixture-scanner', SCAN_TRACE: trace,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --import=${pathToFileURL(preload).href}`.trim() };
  return { script, input, env, trace };
}

function run(script, args, input, env) {
  const result = spawnSync(process.execPath, [script, ...args], {
    input, env, encoding: 'utf8', windowsHide: true, timeout: 5000,
  });
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
  return result;
}

const failures = [
  ['42', /시크릿 후보가 발견되었습니다/],
  ['1', /검사 중 오류/],
  ['timeout', /검사 시간이 초과/],
  ['missing', /검사를 실행할 수 없습니다/],
  ['signal', /검사를 실행할 수 없습니다/],
];
for (const client of ['codex', 'gemini']) {
  test(`#1 정상 검사: ${client}는 안내 없이 통과한다`, () => {
    const f = fixture(client), result = run(f.script, [], f.input, { ...f.env, SCAN_MODE: '0' });
    if (client === 'codex') assert.equal(result.stdout, '');
    else assert.deepEqual(JSON.parse(result.stdout), { injectSteps: [] });
  });
  for (const [mode, expected] of failures) {
    test(`#2 탐지/#3 검사 실패: ${client}/${mode}의 사유·효과를 구분하고 원문을 숨긴다`, () => {
      const f = fixture(client), result = run(f.script, [], f.input, { ...f.env, SCAN_MODE: mode });
      const output = JSON.parse(result.stdout);
      const message = client === 'codex' ? output.reason : output.injectSteps[0].ephemeralMessage;
      assert.match(message, expected);
      if (client === 'codex') {
        assert.equal(output.decision, 'block'); assert.match(message, /요청을 차단했습니다/);
      } else {
        assert.equal('decision' in output, false);
        assert.match(message, /작업을 즉시 중단/);
        assert.match(message, /모델 전송을 차단하지 않습니다/);
        assert.doesNotMatch(message, /요청을 차단했습니다/);
      }
      if (mode !== '42') assert.doesNotMatch(message, /후보가 (발견|감지)/);
      assert.ok(!(result.stdout + result.stderr).includes('synthetic-private-input'));
      const scan = JSON.parse(readFileSync(f.trace, 'utf8'));
      assert.equal(scan.inputMatches, true);
      assert.deepEqual(scan.stdio, ['pipe', 'ignore', 'ignore']);
      assert.equal(scan.timeout, 30000); assert.equal(scan.killSignal, 'SIGKILL');
      assert.ok(scan.args.includes('--ignore-gitleaks-allow'));
      assert.ok(scan.args.includes('--redact=100'));
      assert.ok(!scan.args.includes('synthetic-private-input'));
    });
  }
  test(`#4 잘못된 입력: ${client}의 기존 차단/빈 주입 정책을 유지한다`, () => {
    const f = fixture(client), output = JSON.parse(run(f.script, [], '{', f.env).stdout);
    if (client === 'codex') assert.equal(output.decision, 'block');
    else assert.deepEqual(output, { injectSteps: [] });
    assert.equal(existsSync(f.trace), false);
  });
}

function commandFrom(client, output) {
  const config = JSON.parse(output);
  const handler = client === 'codex' ? config.hooks.UserPromptSubmit[0].hooks[0]
    : config['ai-setting-secret-checker'].PreInvocation[0];
  assert.equal(handler.timeout, 45); return handler.command;
}

for (const client of ['codex', 'gemini']) {
  test(`${client}의 실제 생성 명령은 특수문자 경로에서 실행된다`, () => {
    const f = fixture(client);
    const command = commandFrom(client, run(f.script, ['--print-config'], '', f.env).stdout);
    let program, args;
    if (process.platform !== 'win32') { program = '/bin/sh'; args = ['-c', command]; }
    else if (client === 'codex') { program = 'powershell.exe'; args = ['-NoProfile', '-NonInteractive', '-Command', command]; }
    else { [program, ...args] = command.split(' '); }
    const result = spawnSync(program, args, {
      input: f.input, env: { ...f.env, SCAN_MODE: '42' }, encoding: 'utf8', windowsHide: true, timeout: 5000,
    });
    assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.match(client === 'codex' ? output.reason : output.injectSteps[0].ephemeralMessage, /시크릿 후보가 발견/);
    assert.equal(JSON.parse(readFileSync(f.trace, 'utf8')).program, 'fixture-scanner');
  });
}

function windowsCommand(client, node, script, gitleaks) {
  const adapter = new URL(`${client}/${client}-secret-checker.mjs`, import.meta.url);
  const code = `import url from 'node:url';import{syncBuiltinESMExports}from'node:module';
Object.defineProperty(process,'platform',{value:'win32'});Object.defineProperty(process,'execPath',{value:${JSON.stringify(node)}});
url.fileURLToPath=()=>${JSON.stringify(script)};syncBuiltinESMExports();
process.argv=[process.execPath,${JSON.stringify(script)},'--print-config'];await import(${JSON.stringify(adapter.href)});`;
  const env = { ...process.env }; delete env.AI_SETTING_GITLEAKS_BIN;
  if (gitleaks !== undefined) env.AI_SETTING_GITLEAKS_BIN = gitleaks;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    env, encoding: 'utf8', windowsHide: true, timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr); return commandFrom(client, result.stdout);
}

test('Windows Codex 명령은 PowerShell 호출 연산자와 리터럴 경로를 사용한다', () => {
  const command = windowsCommand('codex', "C:\\Program Files\\O’Connor\\node.exe", "C:\\repo\\a'b $value`%LITERAL%.mjs");
  assert.equal(command, "& 'C:/Program Files/O’’Connor/node.exe' 'C:/repo/a''b $value`%LITERAL%.mjs'");
});

test('Windows Antigravity 단순 경로는 직접 실행하고 기본 검사기는 PATH를 사용한다', () => {
  assert.equal(windowsCommand('gemini', 'C:\\tools\\node.exe', 'C:\\repo\\hook.mjs'), 'C:/tools/node.exe C:/repo/hook.mjs');
});

for (const special of ['space name', "O’Connor's", '$value`', '%LITERAL%', '한글', 'a&b']) {
  test(`Windows Antigravity 특수 경로는 인코딩된 PowerShell 명령을 사용한다: ${special}`, () => {
    const command = windowsCommand('gemini', `C:/tools/${special}/node.exe`, 'C:/repo/hook.mjs');
    assert.match(command, /^powershell\.exe -NoProfile -NonInteractive -EncodedCommand [A-Za-z0-9+/=]+$/);
    const decoded = Buffer.from(command.split(' ').at(-1), 'base64').toString('utf16le');
    assert.equal(decoded, `& 'C:/tools/${special.replace(/['\u2018-\u201b]/g, char => char + char)}/node.exe' 'C:/repo/hook.mjs'`);
    assert.ok(!decoded.includes('/opt/homebrew'));
  });
}

test('Windows Antigravity의 명시적 검사기 경로는 자식 환경에 리터럴로 지정한다', () => {
  const command = windowsCommand('gemini', 'C:/tools/node.exe', 'C:/repo/hook.mjs', "C:/scanner's 한글/$value`%LITERAL%/gitleaks.exe");
  assert.match(command, /^powershell\.exe /);
  const decoded = Buffer.from(command.split(' ').at(-1), 'base64').toString('utf16le');
  assert.equal(decoded, "$env:AI_SETTING_GITLEAKS_BIN = 'C:/scanner''s 한글/$value`%LITERAL%/gitleaks.exe'; & 'C:/tools/node.exe' 'C:/repo/hook.mjs'");
});
