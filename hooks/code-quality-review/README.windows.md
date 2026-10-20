# Windows 코드 품질 검토 훅 설정

[공통 동작·범위·한계](README.md) · [macOS 설정](README.macos.md) · [저장소 안내](../../README.md)

저장소 루트의 PowerShell에서 실행합니다. Node.js 22 이상을 준비하고 경로를 확인합니다. Gemini용은 기존 secret checker와 같은 Antigravity용입니다.

```powershell
node --version
(Get-Command node).Source
```

설정 변경 전 기존 전역 파일 전체를 복구 가능한 위치에 백업합니다. 생성한 JSON으로 파일 전체를 덮어쓰지 말고, 아래 도구별 항목만 병합합니다.

## Codex

```powershell
node hooks/code-quality-review/codex/codex-code-quality-review.mjs --print-config
```

전역 `$env:USERPROFILE\.codex\hooks.json`의 `hooks.Stop`에 출력한 그룹을 병합합니다. 프로젝트만 적용하려면 `.codex/hooks.json`을 사용합니다. 기존 Stop 핸들러와 `UserPromptSubmit` 시크릿 검사 등을 보존하며 전역·프로젝트·인라인 설정에 중복 등록하지 않습니다.

생성 명령은 Codex가 PowerShell에서 실행하는 형식입니다. 호출 연산자 `&`와 작은따옴표를 유지합니다. 경로의 공백·작은따옴표·곡선형 작은따옴표·`%`·`$`·백틱을 문자 그대로 전달합니다. cmd용 따옴표 형식으로 바꾸지 마세요.

Codex를 새로 시작하고 CLI `/hooks`에서 활성 상태·출처·명령을 검토하고 신뢰 등록합니다. 프로젝트에 등록했다면 프로젝트도 신뢰되어야 합니다. 검토 우회 옵션을 일상 설정에 추가하거나 신뢰 상태를 수동으로 만들지 않습니다.

## Gemini / Antigravity

```powershell
node hooks/code-quality-review/gemini/gemini-code-quality-review.mjs --print-config
```

전역 `$env:USERPROFILE\.gemini\config\hooks.json`에 출력의 `ai-setting-code-quality-review` 키를 병합합니다. 프로젝트만 적용하려면 `.agents/hooks.json`을 사용합니다. 기존 `ai-setting-secret-checker` 등 다른 키는 유지합니다. Gemini CLI의 `settings.json`에는 이 설정을 넣지 않습니다.

Windows 생성 명령은 기본 Windows PowerShell의 `powershell.exe -NoProfile -NonInteractive -EncodedCommand ...` 형식입니다. Antigravity가 경로의 따옴표를 파일명으로 넘기거나 cmd가 `%`를 확장하는 문제를 피하도록, Node와 훅 경로를 인용한 호출문을 UTF-16 Base64로 전달합니다. 인코딩은 비밀값 보호 기능이 아니며 기기 경로만 담습니다. 생성한 명령을 그대로 사용합니다.

등록 전 실제 경로를 확인하려면 다음처럼 호출문을 디코딩합니다.

```powershell
$qualityConfig = node hooks/code-quality-review/gemini/gemini-code-quality-review.mjs --print-config | ConvertFrom-Json
$qualityCommand = $qualityConfig.'ai-setting-code-quality-review'.Stop[0].command
[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String(($qualityCommand -split ' ')[-1]))
```

Antigravity를 재시작하고 CLI `/hooks` 또는 앱의 Customizations > Hooks에서 해당 훅의 활성 상태를 확인합니다. 명령이 등록됐다는 사실만으로 검토와 반복 종료가 확인된 것은 아닙니다.

## 검증과 갱신

```powershell
node --test hooks/code-quality-review/codex/codex-code-quality-review.test.mjs hooks/code-quality-review/gemini/gemini-code-quality-review.test.mjs
```

자동 테스트는 도구별 입력·종료 표식·오류 처리와 생성 명령을 검사합니다. Codex 테스트는 기본 `powershell.exe`를 사용합니다. 실제 Codex가 다른 PowerShell을 사용한다면 테스트할 때만 `CODE_QUALITY_REVIEW_TEST_SHELL`에 그 실행 파일 경로를 지정합니다. Antigravity 테스트는 생성한 EncodedCommand를 직접 실행하며, 이는 모델의 전체 검토 반복을 증명하지는 않습니다.

새 대화에서 작은 구현을 요청한 뒤 현재 파일 재읽기, 문제 수정·테스트, `revised` 이후 별도 회차의 `clean` 종료를 확인합니다. 문서만 수정하는 작업·읽기 전용 리뷰·답변 대기에서는 코드 수정 없이 종료해야 합니다. 검증을 실행할 수 없는 상황은 통과로 보고하지 않아야 합니다. CLI와 데스크톱 앱의 확인 결과를 구분합니다.

2026-10-20에 Windows, Node.js 24.14.0, Codex CLI 0.160.0과 Antigravity CLI 1.3.3에서 검증했습니다. Antigravity의 기본 Argon 모델은 할당량 초과(429)로 실행하지 못해 Gemini 3.8 Flash Medium(`gemini-3.8-flash-medium`)을 사용했습니다. Flash에서 설명·구현·문서·읽기 전용 리뷰·답변 대기·검증 실패의 종료를 확인했고, 연속 두 번의 오류 주입에서도 `revised → revised → clean`으로 종료했습니다. 마지막 회차의 현재 파일 재읽기와 테스트·사용자 파일 보존도 확인했습니다. 비대화형 테스트는 해당 호출에만 도구 자동 승인을 허용하고 샌드박스를 유지했습니다. 일상 설정에 자동 승인 옵션을 추가하지 않습니다.

실제 macOS 런타임과 데스크톱 앱의 재시작 후 적용은 이번에 확인하지 않았습니다. 해당 환경에 적용한 뒤 위 대화 검증을 수행하세요.

Node·저장소 경로가 바뀌면 해당 도구의 설정을 다시 생성하고 갱신·등록·검증합니다. 현재 기기의 절대 경로가 든 생성 설정은 저장소에 커밋하지 않습니다.
