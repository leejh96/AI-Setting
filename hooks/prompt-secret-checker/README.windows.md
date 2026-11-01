# Windows 프롬프트 훅 설정

[훅 동작과 한계](README.md) · [macOS 설정](README.macos.md) · [저장소 안내](../../README.md)

저장소를 받은 뒤 루트의 PowerShell에서 명령을 실행합니다. Node.js 22 이상과 winget을 준비하고,
기존 전역 훅 설정 파일 전체를 백업한 뒤 Codex·Antigravity 훅을 등록합니다.
현재 기기에서 생성한 명령을 그대로 등록하고, 앱 안에서 실제 실행되는지 확인합니다.

> 이 프롬프트 훅을 Windows 환경에 맞게 전역 적용해줘.
> 기존 설정은 백업하고, Gitleaks는 winget으로 설치한 뒤 실제 대화에서 훅 동작까지 검증해줘.

## Gitleaks 설치와 업데이트

Git for Windows, Node.js 22 이상과 winget을 준비하고 PowerShell에서 실행합니다.

```powershell
winget install --id Gitleaks.Gitleaks --exact --source winget --scope user
```

설치 후 앱과 터미널을 완전히 종료하고 다시 실행한 다음 설치 등록과 명령 경로를 확인합니다.
winget이 추가한 PATH는 이미 실행 중인 프로세스에 바로 반영되지 않습니다.
설치 위치는 winget 설정에 따라 달라질 수 있으므로 고정 경로를 가정하지 않습니다.

```powershell
winget list --id Gitleaks.Gitleaks --exact --source winget
Get-Command gitleaks -All | Select-Object Source
gitleaks version
node --version
```

기존 수동 설치본이 있으면 실행 파일을 백업하고, winget 설치본의 실행을 확인한 뒤 수동 설치본만 제거합니다.
다른 실행 파일이나 PATH 항목은 함께 삭제하지 않습니다.
다시 시작한 터미널에서 `Get-Command gitleaks -All`로 이전 실행 파일이 우선 선택되지 않는지 확인합니다.

이후 업데이트는 다음 명령을 사용하고, 버전 변경 후 훅을 다시 검증합니다.

```powershell
winget upgrade --id Gitleaks.Gitleaks --exact --source winget
```

설치·업데이트 옵션은 [winget 설치 문서](https://learn.microsoft.com/en-us/windows/package-manager/winget/install)와
[업데이트 문서](https://learn.microsoft.com/en-us/windows/package-manager/winget/upgrade)를 참고하세요.

## 프롬프트 훅 등록

생성 설정은 현재 Node와 스크립트 경로를 반영합니다. 기존 설정 전체를 덮어쓰지 말고 해당 훅만 병합합니다.

### Codex 설정 생성과 적용

저장소 루트에서 실행하면 현재 기기의 Node와 훅 스크립트 절대 경로가 들어간 JSON 설정을 출력합니다.
저장소를 이동하거나 Node 설치 경로를 바꾼 경우 다시 생성하세요.

```powershell
node hooks/prompt-secret-checker/codex/codex-secret-checker.mjs --print-config
```

출력된 설정은 다음 위치 중 하나에 등록합니다.

- 전역 적용: `$env:USERPROFILE\.codex\hooks.json`
- 특정 프로젝트에만 적용: 그 프로젝트의 `.codex/hooks.json`

기존 설정이 있다면 변경 직전 파일 전체를 복구할 수 있도록 백업하고,
기존 이벤트와 핸들러를 유지하면서 `hooks.UserPromptSubmit` 배열에 새 핸들러 그룹을 추가하세요.
같은 검사를 전역·프로젝트 양쪽에 중복 등록하지 마세요. 이미 `config.toml`의 인라인 훅을 사용한다면 해당 구성과의 중복도 확인하세요.

저장소에 파일을 추가하거나 JSON을 생성하는 것만으로 훅이 활성화되지는 않습니다.
Codex를 새로 시작한 뒤 CLI의 `/hooks`에서 이 훅의 명령·출처를 검토하고 신뢰 등록하세요.
프로젝트에 적용했다면 프로젝트 자체도 신뢰되어야 합니다. 훅 정의가 변경되면 다시 검토가 필요합니다.
검토 없이 훅을 실행하는 옵션을 일상 설정에 추가하지 마세요.

현재 기기의 경로가 들어간 생성 설정은 이 저장소에 커밋하지 않습니다.

### Antigravity 설정 생성과 적용

저장소 루트에서 다음 명령을 실행하면 Antigravity 설정에 등록할 JSON을 출력합니다.

```powershell
node hooks/prompt-secret-checker/gemini/gemini-secret-checker.mjs --print-config
```

출력된 설정은 다음 위치에 등록합니다:

- 전역 적용: `$env:USERPROFILE\.gemini\config\hooks.json`
- 특정 프로젝트에만 적용: 그 프로젝트의 `.agents/hooks.json`

기존 설정 파일 전체를 백업하고 기존 훅을 유지하면서 출력된 JSON을 병합합니다.
전역·프로젝트 양쪽에 같은 검사를 중복 등록하지 않습니다.
모델 호출 전(`PreInvocation`) 세션 대화 기록(`transcript.jsonl`)의 최신 사용자 입력에 시크릿 후보가 있으면, 모델에 보안 경고 메시지(`ephemeralMessage`)를 주입하여 작업을 즉시 중단하도록 유도합니다.
경고 주입은 모델 전송을 차단하지 않으므로, Antigravity에서는 모델이 비밀값을 받지 않는다고 보장할 수 없습니다.

### 생성되는 Windows 명령

Codex 명령은 PowerShell 호출 연산자 `&`와 작은따옴표를 사용합니다. 공백·작은따옴표·곡선형 작은따옴표·`$`·백틱·`%`가 든 경로도 문자 그대로 전달하도록 생성하므로 따옴표를 제거하지 않습니다.

Antigravity는 Node와 스크립트가 공백·특수문자·비ASCII 문자 없는 단순 드라이브 절대 경로이고 별도 검사기 경로를 지정하지 않았으면 Node를 직접 실행합니다. 그 외에는 `powershell.exe -NoProfile -NonInteractive -EncodedCommand ...`로 인용한 호출문을 전달합니다. 인코딩은 비밀값 보호 기능이 아니며 실행 경로만 담습니다.

Windows에서는 기본적으로 PATH에서 Gitleaks를 찾습니다. 별도 경로가 필요하면 설정 생성 전에 `$env:AI_SETTING_GITLEAKS_BIN`에 실제 실행 파일의 절대 경로를 지정합니다. Antigravity 생성기는 이 경로를 인코딩된 PowerShell 명령의 자식 환경에 반영합니다. Codex 검사기는 실행 환경의 PATH 또는 `AI_SETTING_GITLEAKS_BIN`을 사용합니다.

이미 등록한 명령은 소스 변경만으로 갱신되지 않습니다. 설정을 다시 생성해 해당 핸들러의 명령만 병합하고, 다른 훅·이벤트와 비활성화 상태를 보존합니다. Codex 명령이 바뀌면 다시 검토·신뢰 등록합니다.

### 재시작 후 확인

Codex·Antigravity·터미널을 완전히 종료하고 다시 실행한 뒤 새 대화에서 정상 입력과 가상 토큰을 시험합니다.
Codex는 모델이 응답하기 전에 입력을 차단하고, Antigravity는 보안 경고를 주입하는지 확인합니다.
가상 값이 경고나 검사 로그에 포함되지 않는지, 검사기를 실행할 수 없어도 Codex는 차단하고 Antigravity는 검사 불능을 경고하는지 확인합니다. 검사 실패를 실제 시크릿 탐지라고 안내하면 안 됩니다.

[공통 회귀 테스트](README.md#검증)는 생성 명령의 실행도 검사합니다. 이번 생성기 수정은 macOS에서 POSIX 실행과 Windows 명령 문자열·인코딩 구조를 검증했으며, 수정된 생성기의 실제 Windows 셸·앱 실행은 아직 확인하지 않았습니다. Windows에서는 자동 테스트와 위 실제 대화 검증을 수행해야 합니다.

CLI의 `/hooks`에서 활성 상태여도 이미 열려 있는 데스크톱 대화의 동작 확인은 별도로 필요합니다.
CLI 결과만으로 데스크톱 앱 적용까지 완료됐다고 판단하지 않습니다.

## 프롬프트 훅 검증 기록

2026-10-11에 Windows에서 Node.js 24.14.0, Gitleaks 8.30.1, Codex CLI 0.160.0,
Antigravity CLI 1.3.3으로 정상 입력·가상 시크릿·검사기 실행 실패를 검증했습니다.
Codex CLI의 입력 차단과 Antigravity CLI 대화 기록의 실제 경고 주입·정상 입력 통과도 확인했습니다.
Codex 데스크톱 앱은 재시작 전 입력이 차단되지 않았고, 재시작 후 차단은 사용자가 확인했습니다.
이 결과는 위 환경의 검증 기록이며, 다른 경로·버전·셸에서는 다시 확인해야 합니다.

당시 생성기는 Windows 명령의 수동 보정이 필요했습니다. Codex는 인용된 Node 실행 경로의 PowerShell 실행 오류, Antigravity는 인용된 스크립트 경로의 `MODULE_NOT_FOUND`가 발생해 공백 없는 경로의 따옴표를 제거했고, Antigravity의 macOS용 검사기 경로 지정도 제거했습니다. 현재 생성기는 위의 도구별 실행 방법으로 바뀌었으므로 이 과거 수동 보정 결과를 새 생성기의 Windows 검증으로 간주하지 않습니다.

검사에는 실제 인증 키 대신 탐지 규칙에 맞는 가상 값을 사용합니다.
검사기 실행 실패를 시험할 때는 원래 경로를 보존하고, 시험 후 설정과 환경변수를 복구합니다.
스크립트 동작과 검사 범위는 [프롬프트 훅 안내](README.md)와
[Git 훅 안내](../commit-secret-checker/README.md)를 참고하세요.

## 갱신

[공통 갱신 절차](../../README.md#지침-갱신하기)에 따라 최신 내용을 받습니다.
Node나 저장소 경로가 바뀌면 설정을 다시 생성하고 등록·검증합니다.
