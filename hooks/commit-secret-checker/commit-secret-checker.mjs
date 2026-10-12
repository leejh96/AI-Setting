import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const SCAN_TIMEOUT_MS = 60000;
const LEAK_EXIT_CODE = 42;
class ScanFailure extends Error {}

function getCommitBlockReason() {
  const deadline = Date.now() + SCAN_TIMEOUT_MS;
  const execute = (program, args, options = {}) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new ScanFailure('검사가 60초를 초과해 커밋을 차단했습니다.');
    const result = spawnSync(program, args, {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: remaining,
      killSignal: 'SIGKILL',
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
      ...options,
    });
    if (result.error?.code === 'ETIMEDOUT') throw new ScanFailure('검사가 60초를 초과해 커밋을 차단했습니다.');
    if (result.error || result.signal || result.status === null) {
      throw new ScanFailure('검사에 필요한 프로그램을 실행할 수 없어 커밋을 차단했습니다. Git·Gitleaks 실행 환경을 확인하세요.');
    }
    return result;
  };
  // Git 훅의 작업 폴더와 GIT_INDEX_FILE 등을 유지해 실제 커밋 대상 인덱스를 읽습니다.
  const executeGit = args => execute('git', args);
  try {
    const changed = executeGit(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMRT', '--no-ext-diff', '--']);
    if (changed.status !== 0) return '커밋할 파일 목록을 읽지 못해 명령 실행을 차단했습니다.';
    const gitleaksBin = process.env.AI_SETTING_GITLEAKS_BIN
      || (existsSync('/opt/homebrew/bin/gitleaks') ? '/opt/homebrew/bin/gitleaks' : 'gitleaks');
    for (const file of changed.stdout.split('\0').filter(Boolean)) {
      const staged = executeGit(['--literal-pathspecs', 'ls-files', '--stage', '-z', '--', file]);
      if (staged.status !== 0 || !staged.stdout) return 'Git 인덱스를 읽지 못해 커밋을 차단했습니다.';
      if (staged.stdout.startsWith('160000 ')) continue;
      const content = executeGit(['show', `:${file}`]);
      if (content.status !== 0) return '커밋할 파일 내용을 읽지 못해 명령 실행을 차단했습니다.';
      const result = execute(gitleaksBin, [
        'stdin',
        '--config', join(HOOK_DIRECTORY, 'gitleaks.toml'),
        '--gitleaks-ignore-path', join(HOOK_DIRECTORY, '.disabled-gitleaksignore'),
        '--ignore-gitleaks-allow',
        '--exit-code', String(LEAK_EXIT_CODE),
        '--redact=100',
        '--no-banner',
        '--no-color',
      ], { cwd: HOOK_DIRECTORY, input: content.stdout, stdio: ['pipe', 'ignore', 'ignore'] });
      if (result.status === LEAK_EXIT_CODE) return '커밋 대상에서 시크릿 후보가 발견되어 명령 실행을 차단했습니다. 해당 값을 제거한 뒤 다시 git add 하세요.';
      if (result.status !== 0) return '시크릿 검사를 완료하지 못해 커밋을 차단했습니다. Gitleaks 설정을 확인하세요.';
    }
    return null;
  } catch (error) {
    // 하위 명령 원문이나 파일 내용은 오류 응답에 포함하지 않습니다.
    return error instanceof ScanFailure ? error.message : '검사를 완료하지 못해 커밋을 차단했습니다.';
  }
}

try {
  const reason = getCommitBlockReason();
  if (reason) {
    process.stderr.write(`${reason}\n`);
    process.exitCode = 1;
  }
} catch {
  process.stderr.write('커밋 검사를 완료하지 못해 커밋을 차단했습니다.\n');
  process.exitCode = 1;
}
