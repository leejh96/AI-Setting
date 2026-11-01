# macOS 프롬프트 훅 설정

[훅 동작과 한계](README.md) · [Windows 설정](README.windows.md) · [저장소 안내](../../README.md)

저장소를 받은 뒤 루트에서 명령을 실행합니다. Node.js 22 이상과 Homebrew를 준비하고,
기존 전역 훅 설정 파일 전체를 백업한 뒤 Codex·Antigravity 훅을 등록합니다.

> 이 프롬프트 훅을 macOS 환경에 맞게 전역 적용해줘.
> 기존 설정은 백업하고, Gitleaks는 Homebrew로 설치한 뒤 실제 대화에서 훅 동작까지 검증해줘.

## Gitleaks 설치와 업데이트

```bash
brew install gitleaks
node --version
gitleaks version
command -v node
command -v gitleaks
```

이후 Gitleaks 업데이트는 다음 명령을 사용합니다.

```bash
brew upgrade gitleaks
gitleaks version
```

에이전트를 실행하는 환경에서도 Node와 Gitleaks를 찾을 수 있어야 합니다.
PATH를 변경했다면 앱과 터미널을 완전히 종료하고 다시 실행합니다.
터미널에서 실행된다는 사실만으로 데스크톱 앱에서도 실행된다고 판단하지 않습니다.

## Codex 프롬프트 훅 등록

현재 Node와 훅 스크립트의 절대 경로가 들어간 JSON을 생성합니다.

```bash
node hooks/prompt-secret-checker/codex/codex-secret-checker.mjs --print-config
```

기존 `~/.codex/hooks.json` 전체를 백업한 뒤 기존 이벤트와 핸들러를 유지하면서
출력의 `hooks.UserPromptSubmit` 그룹을 병합합니다. 특정 프로젝트에만 적용하려면 그 프로젝트의 `.codex/hooks.json`을 사용합니다.
전역·프로젝트 양쪽 또는 `config.toml`의 인라인 훅에 같은 검사를 중복 등록하지 않습니다.

Codex를 다시 시작하고 CLI의 `/hooks`에서 명령과 출처를 검토해 신뢰 등록합니다.
프로젝트에 적용했다면 프로젝트 자체도 신뢰되어야 합니다. 명령이 바뀌면 다시 검토합니다.
검토를 건너뛰는 옵션을 일상 설정에 추가하지 않습니다.

Codex 검사기는 기본적으로 PATH에서 Gitleaks를 찾습니다.
앱 환경에서 찾지 못한다면 앱의 PATH를 확인하거나 훅 명령에 `AI_SETTING_GITLEAKS_BIN`의 절대 경로를 지정합니다.

## Antigravity 프롬프트 훅 등록

설정 생성기는 기본 Gitleaks 경로로 `/opt/homebrew/bin/gitleaks`를 넣습니다.
실제 설치 경로를 사용하도록 아래처럼 생성합니다. Intel Mac 등 다른 설치 경로에서도 같은 방법을 사용합니다.

```bash
AI_SETTING_GITLEAKS_BIN="$(command -v gitleaks)" node hooks/prompt-secret-checker/gemini/gemini-secret-checker.mjs --print-config
```

기존 `~/.gemini/config/hooks.json` 전체를 백업하고 기존 훅을 유지하면서 출력된 설정을 병합합니다.
특정 프로젝트에만 적용하려면 그 프로젝트의 `.agents/hooks.json`을 사용하며 중복 등록하지 않습니다.

`PreInvocation` 훅은 최신 사용자 입력에서 시크릿 후보를 발견하면 모델에 보안 경고를 주입합니다.
이 경고는 모델 전송을 차단하지 않으므로 모델이 비밀값을 받지 않는다고 보장할 수 없습니다.
현재 기기의 경로가 들어간 생성 설정은 저장소에 커밋하지 않습니다.

## 실제 사용 환경에서 검증

먼저 [공통 회귀 테스트](README.md#검증)를 실행해 생성 명령의 POSIX 셸 실행과 검사 결과별 응답을 확인합니다.
앱과 터미널을 다시 시작한 뒤 새 대화에서 정상 문장과 탐지 규칙에 맞는 가상 시크릿을 시험합니다.
Codex는 정상 입력을 통과시키고 시크릿 입력을 모델 응답 전에 차단해야 합니다.
Antigravity는 정상 입력에 경고를 추가하지 않고 시크릿 입력에 보안 경고를 주입해야 합니다.
검사기를 실행할 수 없는 경우 Codex는 차단하고 Antigravity는 검사 불능을 경고해야 합니다. 실제 시크릿을 탐지했다고 안내하면 안 됩니다.
가상 값이 차단 안내나 검사 로그에 포함되지 않는지도 확인합니다.

실제 인증 키는 시험에 사용하지 않습니다. 검사기 실행 실패를 시험할 때는 원래 경로를 보존하고,
시험 후 설정·환경변수를 복구하고 임시 파일을 정리합니다.
CLI에서 확인한 결과와 데스크톱 앱에서 확인한 결과를 구분해 기록합니다.

이 문서는 기존 macOS 안내와 현재 검사기 구현을 기준으로 정리했습니다.
이번 문서 분리 작업에서는 macOS 런타임을 실행해 검증하지 않았습니다.

## 갱신

[공통 갱신 절차](../../README.md#지침-갱신하기)에 따라 최신 내용을 받습니다.
Node나 저장소 경로가 바뀌면 설정을 다시 생성하고 등록·검증합니다.
