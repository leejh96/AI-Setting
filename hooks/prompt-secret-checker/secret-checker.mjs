import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const SCAN_TIMEOUT_MS = 30000;
const LEAK_EXIT_CODE = 42;

export function getPromptScanWarning(prompt) {
  const result = spawnSync(process.env.AI_SETTING_GITLEAKS_BIN || 'gitleaks', [
    'stdin',
    '--config', join(HOOK_DIRECTORY, 'gitleaks.toml'),
    '--gitleaks-ignore-path', join(HOOK_DIRECTORY, '.disabled-gitleaksignore'),
    '--ignore-gitleaks-allow',
    '--exit-code', String(LEAK_EXIT_CODE),
    '--redact=100',
    '--no-banner',
    '--no-color',
  ], {
    cwd: HOOK_DIRECTORY,
    input: prompt,
    encoding: 'utf8',
    stdio: ['pipe', 'ignore', 'ignore'],
    timeout: SCAN_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    windowsHide: true,
  });

  if (result.error?.code === 'ETIMEDOUT') {
    return '시크릿 검사 시간이 초과되었습니다. Gitleaks 실행 환경을 확인하세요.';
  }
  if (result.error || result.signal || result.status === null) {
    return '시크릿 검사를 실행할 수 없습니다. Gitleaks 설치와 실행 경로를 확인하세요.';
  }
  if (result.status === LEAK_EXIT_CODE) {
    return '시크릿 후보가 발견되었습니다. API 키·토큰·개인키 등을 제거한 뒤 다시 요청하세요.';
  }
  if (result.status !== 0) {
    return '시크릿 검사 중 오류가 발생했습니다. Gitleaks 버전과 설정을 확인하세요.';
  }
  return null;
}
