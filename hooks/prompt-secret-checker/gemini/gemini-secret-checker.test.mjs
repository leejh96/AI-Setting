import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const parent = resolve(tmpdir());
const root = mkdtempSync(join(parent, 'prompt-secret-test-'));
const script = fileURLToPath(new URL('./gemini-secret-checker.mjs', import.meta.url));
after(() => {
  assert.ok(resolve(root).startsWith(parent + sep));
  rmSync(root, { recursive: true, force: true });
});
const preload = join(root, 'scanner.mjs');
writeFileSync(preload, `import cp from 'node:child_process';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
const open = fs.openSync, read = fs.readSync, readFile = fs.readFileSync;
let transcriptDescriptor;
fs.openSync = (path, ...args) => { const fd = open(path, ...args); if (path === process.env.TRANSCRIPT) transcriptDescriptor = fd; return fd; };
fs.readFileSync = (path, ...args) => { if (path === process.env.TRANSCRIPT) throw Error('Unexpected whole transcript read'); return readFile(path, ...args); };
fs.readSync = (fd, ...args) => { const size = read(fd, ...args); if (fd === transcriptDescriptor) fs.appendFileSync(process.env.SCAN_TRACE, JSON.stringify({ read: size }) + '\\n'); return size; };
const spawn = cp.spawnSync;
cp.spawnSync = (program, args, options) => {
  if (program !== 'fixture-scanner') return spawn(program, args, options);
  fs.appendFileSync(process.env.SCAN_TRACE, JSON.stringify({ hash: createHash('sha256').update(options.input).digest('hex') }) + '\\n');
  return { status: Number(process.env.SCAN_STATUS || (options.input.includes('fixture-secret') ? 42 : 0)) };
};
syncBuiltinESMExports();`);

function run(transcript, overrides = {}) {
  const directory = mkdtempSync(join(root, 'fixture-'));
  const transcriptPath = join(directory, 'transcript.jsonl');
  const trace = join(directory, 'trace.log');
  writeFileSync(transcriptPath, transcript);
  writeFileSync(trace, '');
  const result = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, script], {
    input: JSON.stringify({ invocationNum: 1, transcriptPath }), encoding: 'utf8', windowsHide: true, timeout: 5000,
    env: { ...process.env, AI_SETTING_GITLEAKS_BIN: 'fixture-scanner', TRANSCRIPT: transcriptPath,
      SCAN_TRACE: trace, ...overrides },
  });
  assert.equal(result.status, 0, result.stderr);
  return { output: JSON.parse(result.stdout), trace: readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) };
}
const user = (content) => JSON.stringify({ type: 'USER_INPUT', content });
const hash = (content) => createHash('sha256').update(content).digest('hex');

test('최신 입력 근처만 읽고 이전 입력을 다시 검사하지 않는다', () => {
  const prefix = JSON.stringify({ type: 'PLANNER_RESPONSE', content: 'a'.repeat(2 * 1024 * 1024) });
  const result = run([user('fixture-secret old input'), prefix, user('clean latest'), '{}', ''].join('\n'));
  assert.deepEqual(result.output, { injectSteps: [] });
  assert.deepEqual(result.trace.filter((entry) => entry.hash), [{ hash: hash('clean latest') }]);
  assert.ok(result.trace.reduce((sum, entry) => sum + (entry.read || 0), 0) <= 64 * 1024);
  const longResponse = run([user('clean latest'), prefix].join('\n'));
  assert.deepEqual(longResponse.trace.filter((entry) => entry.hash), [{ hash: hash('clean latest') }]);
});

test('블록 경계를 넘는 UTF-8 입력과 CRLF·빈 줄·마지막 개행 유무를 보존한다', () => {
  const input = '한글😀'.repeat(20000);
  for (const transcript of [user(input), `${user('old')}\r\n \r\n${user(input)}\r\n{}\r\n\r\n`]) {
    const result = run(transcript);
    assert.deepEqual(result.output, { injectSteps: [] });
    assert.deepEqual(result.trace.filter((entry) => entry.hash), [{ hash: hash(input) }]);
  }
  assert.deepEqual(run(user('')).trace.filter((entry) => entry.hash), [{ hash: hash('') }]);
});

test('합성 시크릿·검사 오류는 원문 없이 경고하며 최신 입력 이전의 손상 기록은 읽지 않는다', () => {
  for (const overrides of [{}, { SCAN_STATUS: '1' }]) {
    const result = run(`malformed old history\n${user('fixture-secret latest')}`, overrides);
    assert.equal(result.output.injectSteps.length, 1);
    assert.match(result.output.injectSteps[0].ephemeralMessage, /보안 경고/);
    assert.ok(!JSON.stringify(result.output).includes('fixture-secret'));
  }
});

test('사용자 입력 없음과 최신 입력 뒤의 파싱 오류는 기존 빈 응답 정책을 유지한다', () => {
  for (const transcript of ['', '\n{}\n', '\n\n\n', '{}\n \n', `${user('fixture-secret')}\nmalformed`, `${user('fixture-secret')}\nnull`]) {
    const result = run(transcript);
    assert.deepEqual(result.output, { injectSteps: [] });
    assert.equal(result.trace.filter((entry) => entry.hash).length, 0);
  }
});
