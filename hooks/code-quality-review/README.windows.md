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

전역 `$env:USERPROFILE\.codex\hooks.json`의 `hooks.UserPromptSubmit`과 `hooks.Stop`에 출력한 그룹을 모두 병합합니다. 앞 이벤트는 파일 감시 준비를 완료하고 Stop은 수정 기록이 있을 때만 검토를 시작합니다. 프로젝트만 적용하려면 `.codex/hooks.json`을 사용합니다. 기존 Stop 핸들러와 `UserPromptSubmit` 시크릿 검사 등을 보존하며 전역·프로젝트·인라인 설정에 중복 등록하지 않습니다. 비활성화한 품질 훅을 임의로 다시 켜지 않습니다.

생성 명령은 Codex가 PowerShell에서 실행하는 형식입니다. 호출 연산자 `&`와 작은따옴표를 유지합니다. 경로의 공백·작은따옴표·곡선형 작은따옴표·`%`·`$`·백틱을 문자 그대로 전달합니다. cmd용 따옴표 형식으로 바꾸지 마세요.

Codex를 새로 시작하고 CLI `/hooks`에서 활성 상태·출처·명령을 검토하고 신뢰 등록합니다. 프로젝트에 등록했다면 프로젝트도 신뢰되어야 합니다. 검토 우회 옵션을 일상 설정에 추가하거나 신뢰 상태를 수동으로 만들지 않습니다.

기존 대화에서 Stop은 실행되는데 감시 준비 기록이 없다면 `UserPromptSubmit --prepare`의 실제 실행을 먼저 확인합니다. 설정 파일과 신뢰 레코드에 항목이 존재하는 것만으로 이미 열려 있던 대화에 적용됐다고 판단하지 않습니다. 준비 훅을 추가·갱신한 뒤에는 앱을 완전히 종료하고 다시 열어 다음 사용자 요청부터 확인하세요. 현재 요청 중간에 감시를 시작하면 그 전의 변경은 확인할 수 없으므로 해당 요청의 실패를 통과로 바꾸지 않습니다. 재시작 후에도 기록이 없다면 준비 훅의 미실행·실행 오류·기록 유실을 로그로 구분해야 합니다.

## Gemini / Antigravity

```powershell
node hooks/code-quality-review/gemini/gemini-code-quality-review.mjs --print-config
```

전역 `$env:USERPROFILE\.gemini\config\hooks.json`에 출력의 `ai-setting-code-quality-review` 키의 `PreInvocation`과 `Stop`을 모두 병합합니다. 기존 `enabled` 상태를 보존합니다. 프로젝트만 적용하려면 `.agents/hooks.json`을 사용합니다. 기존 `ai-setting-secret-checker` 등 다른 키는 유지합니다. Gemini CLI의 `settings.json`에는 이 설정을 넣지 않습니다.

Windows에서는 Node와 훅의 경로가 공백·셸 특수문자·비ASCII 문자 없는 단순 드라이브 절대 경로이면 Node를 직접 실행합니다. 그 외 경로는 기존 `powershell.exe -NoProfile -NonInteractive -EncodedCommand ...` 형식을 사용합니다. Antigravity가 따옴표를 파일명으로 넘기거나 cmd가 `%`를 확장하는 문제를 피하도록, 인용한 호출문을 UTF-16 Base64로 전달합니다. 인코딩은 비밀값 보호 기능이 아니며 기기 경로만 담습니다. 생성한 명령을 그대로 사용합니다. 감시 프로세스는 계속 숨겨진 `Start-Process`로 분리합니다.

이미 등록한 명령에는 저장소 코드 변경만으로 이 실행기 선택이 반영되지 않습니다. 설정을 다시 생성해 해당 훅의 `PreInvocation`·`Stop` 명령만 갱신하고 다른 훅과 활성화 상태는 보존합니다.

등록 전 실제 명령과 경로를 확인하려면 직접 명령은 그대로 출력하고, 인코딩된 호출문만 디코딩합니다.

```powershell
$qualityConfig = node hooks/code-quality-review/gemini/gemini-code-quality-review.mjs --print-config | ConvertFrom-Json
$qualityCommand = $qualityConfig.'ai-setting-code-quality-review'.Stop[0].command
if ($qualityCommand.StartsWith('powershell.exe ')) {
    [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String(($qualityCommand -split ' ')[-1]))
} else {
    $qualityCommand
}
```

Antigravity를 재시작하고 CLI `/hooks` 또는 앱의 Customizations > Hooks에서 해당 훅의 활성 상태를 확인합니다. 명령이 등록됐다는 사실만으로 검토와 반복 종료가 확인된 것은 아닙니다.

## 검증과 갱신

```powershell
node --test hooks/code-quality-review/review-changes.test.mjs hooks/code-quality-review/codex/codex-code-quality-review.test.mjs hooks/code-quality-review/gemini/gemini-code-quality-review.test.mjs
```

자동 테스트는 도구별 입력·종료 표식·오류 처리와 생성 명령을 검사합니다. Codex 테스트는 기본 `powershell.exe`를 사용합니다. 실제 Codex가 다른 PowerShell을 사용한다면 테스트할 때만 `CODE_QUALITY_REVIEW_TEST_SHELL`에 그 실행 파일 경로를 지정합니다. Antigravity 테스트는 생성한 EncodedCommand를 직접 실행하며, 이는 모델의 전체 검토 반복을 증명하지는 않습니다.

새 대화에서 작은 구현을 요청한 뒤 현재 파일 재읽기, 문제 수정·테스트, `revised` 이후 별도 회차의 `clean` 종료를 확인합니다. 터미널·서브에이전트가 작업 폴더 안의 코드를 수정한 경우도 검토해야 합니다. 변경 없는 질문·기존 문서만 수정·읽기 전용 리뷰·답변 대기에서는 추가 검토 프롬프트와 상태 표식 없이 종료해야 합니다. 검증을 실행할 수 없는 상황은 통과로 보고하지 않아야 합니다. CLI와 데스크톱 앱의 확인 결과를 구분합니다.

2026-10-23에 Windows, Node.js 24.14.0, Codex CLI 0.160.0과 Antigravity CLI의 Gemini 3.8 Flash Medium(`gemini-3.8-flash-medium`)에서 파일 감시 방식을 검증했습니다. Codex에서 일반 질문은 검토 요청 없이 종료했고, 실제 서브에이전트가 코드를 수정한 요청은 현재 파일 재읽기·기존 테스트·품질 검토 후 종료했습니다. Flash에서도 무변경 질문의 검토 요청 0회, 코드 수정의 검토 요청 1회와 종료를 확인했습니다. 두 도구 모두 시험용 감시 프로세스 종료를 수정 없음으로 통과시키지 않았고, 실패 상태를 보존하며 추가 검토 프롬프트 없이 원래 작업을 종료했습니다. Flash의 미완료 경고는 실행 로그에서 확인했습니다. 기존 전역 설정과 시크릿 검사 훅은 보존했습니다.

Codex는 공식 `systemMessage` 경고를 반환합니다. 다만 Codex CLI 0.160.0의 `--no-daemon exec --json` 검증에서는 감시 실패 경고가 stdout·stderr에 표시되지 않았습니다. 실패 상태 저장과 추가 프롬프트 방지는 확인했으며, CLI 경고 표시 검사는 실패로 따로 기록했습니다. 이 결과를 경고 표시 성공으로 집계하지 않으며 데스크톱 UI 표시도 확인되지 않았습니다.

별도 실제 Codex·Flash 시험에서는 매 검토마다 시험용 오류를 다시 넣어 수정·검증을 5회 수행하게 했습니다. 두 도구 모두 검토 요청 5회 후 `review-limit` 상태로 종료했고 여섯 번째 검토나 `clean` 판정은 발생하지 않았습니다. 감시 기록을 실행 중에 지운 시험에서도 새 기준으로 재준비하지 않고 실패 상태를 남겼으며 원래 답변은 정상 종료했습니다. 자동 테스트 69개 전체 실행과 이후 정리 로직 회귀 테스트 2개를 통과했습니다.

Windows에서는 Node의 detached 실행만으로 감시를 시작하면 PowerShell 종료 뒤에도 출력 파이프가 감시 프로세스에 남아 Antigravity의 `WaitDelay` 오류가 발생하는 경우를 재현했습니다. 감시 시작만 숨겨진 `Start-Process`로 분리했고, 준비 응답·출력 종료 후에도 감시가 살아 있는 자동 검사와 실제 Flash의 준비·종료 훅 오류 부재를 확인했습니다. 워커 준비 응답은 별도로 확인하므로 실행기 종료만으로 감시 성공을 판단하지 않습니다.

자동 테스트는 요청당 5회 제한, 마지막 허용 회차 정상 종료, 동시 허가·저장 실패, 상태 유실 후 예산 초기화 방지, 종료 뒤 재진입과 무변경 요청의 프로젝트 내용 읽기 차단, 같은 내용 저장·원복, 파일·폴더 이동과 삭제, 겹친 감시 범위, Git ignored·추적 경로, 감시 오류·종료·통신 실패, 실패 후 재준비 방지와 프로세스 정리를 검사합니다. 서브에이전트 검증은 대화 기록을 저장하는 일반 Codex CLI 세션에서 수행했습니다. 비대화형 모델 시험의 자동 승인은 해당 호출에만 허용했고 일상 설정에는 추가하지 않았습니다. 이전 해시 방식의 성능 수치는 현재 감시 방식의 성능을 나타내지 않으므로 이 안내에서 제거했습니다.

실제 macOS 런타임은 이번에 확인하지 않았습니다. 해당 환경에 적용한 뒤 위 대화 검증을 수행하세요. 위 CLI 테스트 결과만으로 앞서 보고된 요청 타임아웃의 원인이나 해소를 확정할 수는 없습니다.

추가로 Codex 데스크톱이 사용하는 바이너리 `0.163.0-alpha.11.1`의 새 CLI 세션에서 일반 질문·문서 수정·서브에이전트 수정·시크릿 차단을 확인했습니다. 같은 바이너리의 격리 app-server 세션에서도 준비 훅 2개(시크릿 검사·감시 준비)와 Stop의 실제 실행·완료 이벤트, 무변경 감시 종료를 확인했습니다. 기존 데스크톱 대화에서 준비 기록이 없었던 세부 원인을 이 새 세션 결과만으로 확정하지는 않습니다.

이후 사용자가 데스크톱 앱을 완전히 재시작한 뒤 같은 대화의 새 요청에서 감시 `ready/prepared`, 수정 기록 없음으로 시작한 것을 확인했습니다. 새 서브에이전트의 임시 코드 파일 생성·수정·삭제 후 수정 기록이 생겼고, 실제 Stop이 검토 프롬프트를 전달했습니다. 감시 상태를 중간에 초기화하지 않았으며 임시 파일은 삭제했습니다. 재시작 전 준비 기록 누락과 재시작 후 복구는 확인했지만, 앱 내부의 설정·신뢰 상태 갱신 중 어느 부분이 원인이었는지는 확정하지 않았습니다.

Node·저장소 경로가 바뀌면 해당 도구의 설정을 다시 생성하고 갱신·등록·검증합니다. 현재 기기의 절대 경로가 든 생성 설정은 저장소에 커밋하지 않습니다.
