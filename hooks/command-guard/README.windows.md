# 터미널 명령 검사 훅 설치 (Windows)

저장소 루트의 PowerShell에서 사용할 도구의 명령을 실행합니다. 먼저 기존 등록 파일과 별도 수정한 설치본을 접근이 제한된 위치에 백업합니다.

## Codex

```powershell
$codexGuardHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
$codexGuardDir = Join-Path $codexGuardHome 'hooks/command-guard'
New-Item -ItemType Directory -Force -Path "$codexGuardDir/codex" | Out-Null
Copy-Item -LiteralPath 'hooks/command-guard/command-guard.mjs','hooks/command-guard/hook-cli.mjs','hooks/command-guard/shell-commands.mjs' -Destination $codexGuardDir
Copy-Item -LiteralPath 'hooks/command-guard/codex/codex-command-guard.mjs' -Destination "$codexGuardDir/codex/"
node "$codexGuardDir/codex/codex-command-guard.mjs" --print-config
```

출력의 `hooks.PreToolUse` 그룹만 `$codexGuardHome/hooks.json`에 병합하고 기존 등록을 보존합니다. CLI의 `/hooks`에서 새 정의를 확인하고 신뢰를 등록합니다.

## Antigravity

```powershell
$antigravityGuardDir = Join-Path $env:USERPROFILE '.gemini/config/hooks/command-guard'
New-Item -ItemType Directory -Force -Path "$antigravityGuardDir/gemini" | Out-Null
Copy-Item -LiteralPath 'hooks/command-guard/command-guard.mjs','hooks/command-guard/hook-cli.mjs','hooks/command-guard/shell-commands.mjs' -Destination $antigravityGuardDir
Copy-Item -LiteralPath 'hooks/command-guard/gemini/gemini-command-guard.mjs' -Destination "$antigravityGuardDir/gemini/"
node "$antigravityGuardDir/gemini/gemini-command-guard.mjs" --print-config
```

출력의 `ai-setting-command-guard` 키만 `$env:USERPROFILE/.gemini/config/hooks.json`에 병합합니다. 기존 `enabled` 상태와 다른 훅을 보존합니다. 공백이 있는 실행 경로에서는 생성된 PowerShell 래퍼를 그대로 사용합니다.

## 설치 후 확인과 해제

새 세션과 폐기 가능한 테스트 저장소에서 `git status`는 통과하고 `git reset --hard`는 두 도구 모두에서 차단되는지 확인합니다. 해제하려면 이 훅의 Codex `PreToolUse` 그룹 또는 Antigravity `ai-setting-command-guard` 키만 제거합니다.
