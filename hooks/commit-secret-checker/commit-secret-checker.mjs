import { spawn, spawnSync } from 'node:child_process';
import { isUtf8 } from 'node:buffer';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const SCAN_TIMEOUT_MS = 60000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const TIMEOUT_REASON = '검사가 60초를 초과해 커밋을 차단했습니다.';
const LEAK_EXIT_CODE = 42;
class ScanFailure extends Error {}

async function* readBlobs(objectIds, deadline, signal) {
  const child = spawn('git', ['cat-file', '--batch'], {
    cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, signal, killSignal: 'SIGKILL',
  });
  const readFailure = () => new ScanFailure('커밋할 파일 내용을 읽지 못해 명령 실행을 차단했습니다.');
  let failure;
  const closed = new Promise(resolve => child.once('close', (code) => resolve(code)));
  const fail = (error) => {
    if (failure) return;
    failure = error;
    child.stdout.destroy();
    child.kill('SIGKILL');
  };
  child.on('error', () => fail(readFailure()));
  child.stdin.on('error', () => fail(readFailure()));
  child.stderr.on('error', () => fail(readFailure()));
  child.stderr.resume();
  const timer = setTimeout(() => fail(new ScanFailure(TIMEOUT_REASON)), Math.max(1, deadline - Date.now()));
  const check = () => {
    if (failure) throw failure;
    if (Date.now() >= deadline) throw new ScanFailure(TIMEOUT_REASON);
  };
  const output = child.stdout[Symbol.asyncIterator]();
  let chunk = Buffer.alloc(0), offset = 0;
  async function refill() {
    check();
    const next = await output.next();
    check();
    if (next.done) throw readFailure();
    chunk = next.value; offset = 0;
  }
  async function readLine() {
    const parts = [];
    let length = 0;
    while (true) {
      if (offset === chunk.length) await refill();
      const newline = chunk.indexOf(10, offset);
      const end = newline === -1 ? chunk.length : newline;
      const part = chunk.subarray(offset, end);
      length += part.length;
      if (length > 256) throw readFailure();
      parts.push(part);
      offset = newline === -1 ? end : end + 1;
      if (newline !== -1) return (parts.length === 1 ? part : Buffer.concat(parts)).toString('utf8');
    }
  }
  async function readBytes(size) {
    if (size && offset === chunk.length) await refill();
    if (size <= chunk.length - offset) {
      const content = chunk.subarray(offset, offset + size);
      offset += size;
      return content;
    }
    const content = Buffer.allocUnsafe(size);
    for (let written = 0; written < size;) {
      if (offset === chunk.length) await refill();
      const length = Math.min(size - written, chunk.length - offset);
      chunk.copy(content, written, offset, offset + length);
      offset += length; written += length;
    }
    return content;
  }
  try {
    check();
    child.stdin.end([...objectIds].join('\n') + '\n');
    for (const objectId of objectIds) {
      check();
      const header = /^([a-f0-9]+) blob (0|[1-9]\d*)$/.exec(await readLine());
      if (!header || header[1] !== objectId) throw readFailure();
      const size = Number(header[2]);
      if (!Number.isSafeInteger(size) || size > MAX_FILE_BYTES) {
        throw new ScanFailure('커밋 대상 파일이 10MiB를 초과해 커밋을 차단했습니다.');
      }
      const content = await readBytes(size);
      if ((await readBytes(1))[0] !== 10) throw readFailure();
      yield isUtf8(content) ? content : content.toString('utf8');
    }
    check();
    if (offset !== chunk.length || !(await output.next()).done) throw readFailure();
    const code = await closed;
    check();
    if (code !== 0) throw readFailure();
  } catch (error) {
    check();
    throw error instanceof ScanFailure ? error : readFailure();
  } finally {
    clearTimeout(timer);
    child.stdin.destroy(); child.stdout.destroy();
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await closed;
  }
}

async function scanBlobs(objectIds, gitleaksBin, deadline) {
  const controller = new AbortController();
  const active = new Set();
  let reason = null;
  const stop = (message) => {
    if (reason) return;
    reason = message; controller.abort();
  };
  const scan = (content) => new Promise(resolveScan => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) { stop(TIMEOUT_REASON); resolveScan(); return; }
    let child;
    try {
      child = spawn(gitleaksBin, [
        'stdin', '--config', join(HOOK_DIRECTORY, 'gitleaks.toml'),
        '--gitleaks-ignore-path', join(HOOK_DIRECTORY, '.disabled-gitleaksignore'),
        '--ignore-gitleaks-allow', '--exit-code', String(LEAK_EXIT_CODE),
        '--redact=100', '--no-banner', '--no-color',
      ], { cwd: HOOK_DIRECTORY, stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true,
        signal: controller.signal, killSignal: 'SIGKILL' });
    } catch {
      stop('시크릿 검사를 실행할 수 없어 커밋을 차단했습니다. Gitleaks 실행 환경을 확인하세요.');
      resolveScan(); return;
    }
    const timer = setTimeout(() => stop(TIMEOUT_REASON), remaining);
    const failed = () => stop('시크릿 검사를 완료하지 못해 커밋을 차단했습니다. Gitleaks 실행 환경과 설정을 확인하세요.');
    child.on('error', failed);
    child.stdin.on('error', failed);
    child.once('close', code => {
      clearTimeout(timer);
      if (Date.now() >= deadline) stop(TIMEOUT_REASON);
      else if (code === LEAK_EXIT_CODE) stop('커밋 대상에서 시크릿 후보가 발견되어 명령 실행을 차단했습니다. 해당 값을 제거한 뒤 다시 git add 하세요.');
      else if (code !== 0) failed();
      resolveScan();
    });
    child.stdin.end(content);
  });
  try {
    for await (const content of readBlobs(objectIds, deadline, controller.signal)) {
      if (reason) break;
      const task = scan(content).then(() => active.delete(task));
      active.add(task);
      if (active.size >= 2) await Promise.race(active);
      if (reason) break;
    }
    await Promise.all(active);
  } catch (error) {
    stop(error instanceof ScanFailure ? error.message : '검사를 완료하지 못해 커밋을 차단했습니다.');
  } finally {
    if (reason) controller.abort();
    await Promise.all(active);
  }
  return reason;
}

async function getCommitBlockReason() {
  const deadline = Date.now() + SCAN_TIMEOUT_MS;
  const execute = (program, args, options = {}) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new ScanFailure(TIMEOUT_REASON);
    const result = spawnSync(program, args, {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: remaining,
      killSignal: 'SIGKILL',
      maxBuffer: MAX_FILE_BYTES,
      windowsHide: true,
      ...options,
    });
    if (result.error?.code === 'ETIMEDOUT') throw new ScanFailure(TIMEOUT_REASON);
    if (result.error || result.signal || result.status === null) {
      throw new ScanFailure('검사에 필요한 프로그램을 실행할 수 없어 커밋을 차단했습니다. Git·Gitleaks 실행 환경을 확인하세요.');
    }
    return result;
  };
  // Git 훅의 작업 폴더와 GIT_INDEX_FILE 등을 유지해 실제 커밋 대상 인덱스를 읽습니다.
  const executeGit = args => execute('git', args);
  try {
    const changed = executeGit(['diff', '--cached', '--raw', '--no-abbrev', '--no-renames', '-z', '--diff-filter=ACMT', '--no-ext-diff', '--']);
    if (changed.status !== 0) return '커밋할 파일 목록을 읽지 못해 명령 실행을 차단했습니다.';
    const gitleaksBin = process.env.AI_SETTING_GITLEAKS_BIN
      || (existsSync('/opt/homebrew/bin/gitleaks') ? '/opt/homebrew/bin/gitleaks' : 'gitleaks');
    const records = changed.stdout.split('\0');
    if (records.at(-1) !== '' || records.length % 2 !== 1) return 'Git 인덱스를 읽지 못해 커밋을 차단했습니다.';
    const objectIds = new Set();
    for (let index = 0; index < records.length - 1; index += 2) {
      const entry = /^:[0-7]{6} ([0-7]{6}) [a-f0-9]+ ([a-f0-9]+) [ACMT]$/.exec(records[index]);
      if (!entry || !records[index + 1]) return 'Git 인덱스를 읽지 못해 커밋을 차단했습니다.';
      const [, mode, objectId] = entry;
      if (mode !== '160000') objectIds.add(objectId);
    }
    if (!objectIds.size) return null;
    return await scanBlobs(objectIds, gitleaksBin, deadline);
  } catch (error) {
    // 하위 명령 원문이나 파일 내용은 오류 응답에 포함하지 않습니다.
    return error instanceof ScanFailure ? error.message : '검사를 완료하지 못해 커밋을 차단했습니다.';
  }
}

try {
  const reason = await getCommitBlockReason();
  if (reason) {
    process.stderr.write(`${reason}\n`);
    process.exitCode = 1;
  }
} catch {
  process.stderr.write('커밋 검사를 완료하지 못해 커밋을 차단했습니다.\n');
  process.exitCode = 1;
}
