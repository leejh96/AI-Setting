import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import process from 'node:process';

function runLint(runner, project, file, expectViolation) {
  const label = expectViolation ? 'TypeScript 위반 예제' : 'JavaScript 정상 예제';
  const result = spawnSync(process.execPath, [runner, project, file], {
    cwd: project, env: { ...process.env, FORCE_COLOR: '0' }, encoding: 'utf8',
    windowsHide: true, timeout: 20_000, killSignal: 'SIGKILL',
    stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024,
  });
  if (result.error) return `${label} 실행 실패 (${result.error.code})`;
  if (result.signal) return `${label} 실행 중단 (${result.signal})`;
  const expected = expectViolation ? 1 : 0;
  if (result.status !== expected) return `${label} 종료 코드 ${result.status} (기대 ${expected})`;
  if (expectViolation && !/(?:^|\s)@typescript-eslint\/no-floating-promises\s*$/m.test(result.stdout)) {
    return `${label}에서 @typescript-eslint/no-floating-promises 진단 누락`;
  }
}

export function checkLintRuntime(runner) {
  const problems = [];
  let project;
  try {
    project = mkdtempSync(join(tmpdir(), 'ai-setting-install-lint-'));
    writeFileSync(join(project, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { target: 'ES2022', noEmit: true }, files: ['floating.ts'],
    }));
    writeFileSync(join(project, 'valid.mjs'), 'export async function run() { await Promise.resolve(1); }\n');
    writeFileSync(join(project, 'floating.ts'), 'Promise.resolve(1);\n');
    const valid = runLint(runner, project, 'valid.mjs', false);
    if (valid) problems.push(valid);
    const violation = runLint(runner, project, 'floating.ts', true);
    if (violation) problems.push(violation);
  } catch (error) {
    problems.push(`린트 임시 예제 준비·실행 실패 (${error.code ?? '오류'})`);
  } finally {
    if (project) {
      try { rmSync(project, { recursive: true, force: true }); }
      catch (error) { problems.push(`린트 임시 폴더 정리 실패 (${error.code}, ${project})`); }
    }
  }
  return problems;
}

export function checkStorageRuntime(directory) {
  if (!isAbsolute(directory)) return ['저장 폴더에 절대 경로가 필요함'];
  const token = randomUUID();
  const path = join(directory, `.ai-setting-check-${token}.tmp`);
  const problems = [];
  let owned = false;
  let step = '파일 생성';
  try {
    const fd = openSync(path, 'wx', 0o600);
    owned = true;
    try {
      step = '파일 쓰기';
      writeFileSync(fd, token);
    } finally { closeSync(fd); }
    step = '파일 읽기';
    if (readFileSync(path, 'utf8') !== token) problems.push('쓴 내용과 다시 읽은 내용이 다름');
  } catch (error) {
    problems.push(`${step} 실패 (${error.code ?? '오류'})`);
  } finally {
    if (owned) {
      try { unlinkSync(path); }
      catch (error) { problems.push(`검사 파일 정리 실패 (${error.code}, ${path})`); }
    }
  }
  return problems;
}
