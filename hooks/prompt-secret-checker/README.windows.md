# Windows 프롬프트 훅 설정

[훅 동작과 한계](README.md) · [macOS 설정](README.macos.md) · [저장소 안내](../../README.md)

저장소를 받은 뒤 루트의 PowerShell에서 명령을 실행합니다. Node.js 22 이상과 winget을 준비하고,
기존 전역 훅 설정 파일 전체를 백업한 뒤 Codex·Antigravity 훅을 등록합니다.
설정 생성기와 검사 스크립트를 그대로 사용하고, 실행 명령은 현재 기기에 맞춰 보정합니다.

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

생성 설정은 아래 Windows 명령 보정을 반영한 뒤 등록합니다.

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

### 전역 실행 명령 보정

현재 `--print-config` 출력은 등록할 설정의 초안입니다. 이번 Windows 적용에서는 전역 JSON의 `command`만 보정했고,
검사 스크립트는 그대로 사용했습니다. 기존 설정 파일 전체를 백업하고 기존 훅을 유지하면서 반영하세요.

아래 예시는 Node와 저장소 경로에 공백이 없는 경우입니다. `C:/tools/nodejs/node.exe`와
`C:/repos/ai-setting`을 `(Get-Command node).Source`와 실제 저장소 경로에 맞게 바꿉니다.

**Codex — `$env:USERPROFILE\.codex\hooks.json`**

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "C:/tools/nodejs/node.exe \"C:/repos/ai-setting/hooks/prompt-secret-checker/codex/codex-secret-checker.mjs\"",
            "timeout": 15
          }
        ]
      }
    ]
  }
}
```

검증한 Codex 환경에서는 생성된 명령의 Node 실행 경로를 따옴표로 감싸면 PowerShell 실행 오류가 발생했습니다.
공백 없는 Node 경로의 따옴표를 제거한 뒤 `/hooks`에서 해당 명령을 다시 검토·신뢰 등록했습니다.

**Antigravity — `$env:USERPROFILE\.gemini\config\hooks.json`**

```json
{
  "ai-setting-secret-checker": {
    "enabled": true,
    "PreInvocation": [
      {
        "type": "command",
        "command": "C:/tools/nodejs/node.exe C:/repos/ai-setting/hooks/prompt-secret-checker/gemini/gemini-secret-checker.mjs",
        "timeout": 15
      }
    ]
  }
}
```

설정 생성기가 넣는 macOS용 `/opt/homebrew/bin/gitleaks` 환경변수 지정 부분을 제거하고, Windows의 PATH에서 Gitleaks를 찾도록 합니다.
검증한 Antigravity CLI에서는 스크립트 경로의 따옴표가 파일명 일부로 전달되어 `MODULE_NOT_FOUND`가 발생했습니다.
공백 없는 Node와 스크립트의 절대 경로를 따옴표 없이 등록해 해결했습니다.

실제 경로에 공백이 있으면 이 따옴표 제거를 그대로 적용하지 마세요.
사용하는 앱의 명령 해석 방식에 맞춰 인용 방식이나 실행 방법을 조정하고, 앱 안에서 실행되는지 확인합니다.

### 재시작 후 확인

Codex·Antigravity·터미널을 완전히 종료하고 다시 실행한 뒤 새 대화에서 정상 입력과 가상 토큰을 시험합니다.
Codex는 모델이 응답하기 전에 입력을 차단하고, Antigravity는 보안 경고를 주입하는지 확인합니다.
가상 값이 경고나 검사 로그에 포함되지 않는지, 검사기를 실행할 수 없어도 Codex는 차단하고 Antigravity는 경고하는지 확인합니다.

CLI의 `/hooks`에서 활성 상태여도 이미 열려 있는 데스크톱 대화의 동작 확인은 별도로 필요합니다.
CLI 결과만으로 데스크톱 앱 적용까지 완료됐다고 판단하지 않습니다.

## 프롬프트 훅 검증 기록

2026-10-11에 Windows에서 Node.js 24.14.0, Gitleaks 8.30.1, Codex CLI 0.160.0,
Antigravity CLI 1.3.3으로 정상 입력·가상 시크릿·검사기 실행 실패를 검증했습니다.
Codex CLI의 입력 차단과 Antigravity CLI 대화 기록의 실제 경고 주입·정상 입력 통과도 확인했습니다.
Codex 데스크톱 앱은 재시작 전 입력이 차단되지 않았고, 재시작 후 차단은 사용자가 확인했습니다.
이 결과는 위 환경의 검증 기록이며, 다른 경로·버전·셸에서는 다시 확인해야 합니다.

검사에는 실제 인증 키 대신 탐지 규칙에 맞는 가상 값을 사용합니다.
검사기 실행 실패를 시험할 때는 원래 경로를 보존하고, 시험 후 설정과 환경변수를 복구합니다.
스크립트 동작과 검사 범위는 [프롬프트 훅 안내](README.md)와
[Git 훅 안내](../commit-secret-checker/README.md)를 참고하세요.

## 갱신

[공통 갱신 절차](../../README.md#지침-갱신하기)에 따라 최신 내용을 받습니다.
Node나 저장소 경로가 바뀌면 명령을 보정하고 등록·검증합니다.
