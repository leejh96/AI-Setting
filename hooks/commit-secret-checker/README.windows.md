# Windows Git 커밋 훅 설정

[훅 동작과 한계](README.md) · [macOS 설정](README.macos.md) · [저장소 안내](../../README.md)

Git for Windows와 Node.js 22 이상을 준비합니다. Gitleaks는
[Windows 설치·업데이트 안내](../prompt-secret-checker/README.windows.md#gitleaks-설치와-업데이트)에 따라 winget으로 설치합니다.
저장소를 받은 뒤 루트의 PowerShell에서 명령을 실행합니다.

> 이 Git 시크릿 검사 훅을 Windows 환경에 맞게 전역 적용해줘.
> 기존 설정과 훅은 백업하고, Gitleaks는 winget으로 설치한 뒤 임시 저장소의 실제 커밋으로 검증해줘.

## Git 커밋 검사 등록

기존 전역 Git 설정과 각 프로젝트의 실행 가능한 훅을 먼저 확인합니다.
`core.hooksPath`를 지정하면 기존 `.git/hooks` 대신 지정한 폴더의 훅을 실행합니다.
다른 훅이 있으면 필요한 훅을 연결하는 방식을 결정한 뒤 등록합니다.
저장소를 이동하면 등록 경로도 갱신해야 하며, 프로젝트나 명령별 `core.hooksPath`가 전역 값을 덮어쓸 수 있습니다.

Git for Windows에는 셸 스크립트를 실행하는 `sh.exe`가 포함됩니다.
PowerShell에서 `git commit`을 실행해도 Git이 `#!/bin/sh` 형식의 `pre-commit`을 실행하므로,
별도로 Git Bash 창을 열거나 이 파일을 `.cmd`로 변환할 필요는 없습니다.
훅 파일명은 확장자 없이 `pre-commit`으로 유지합니다.

기존 전역 Git 설정 파일 전체와 프로젝트 훅을 확인·백업한 뒤 저장소 루트의 PowerShell에서 등록합니다.

```powershell
$commitHookPath = Join-Path (Get-Location).Path 'hooks/commit-secret-checker'
git config --global core.hooksPath ($commitHookPath -replace '\\', '/')
git config --show-origin --show-scope --get core.hooksPath
```

Node.js·Gitleaks 설치로 PATH가 바뀌었다면 터미널과 AI 앱을 완전히 종료하고 다시 실행합니다.
`Get-Command node,gitleaks`와 `gitleaks version`으로 실행 환경을 확인하고,
사용자 저장소 대신 임시 저장소에서 실제 커밋으로 검증합니다.

- 정상 파일을 스테이징한 커밋은 성공해야 합니다.
- 탐지 규칙에 맞는 가상 시크릿을 스테이징하면 커밋이 실패하고 HEAD는 그대로여야 합니다.
- 차단 후 스테이징된 내용이 보존되고, 값을 제거해 다시 `git add`하면 커밋할 수 있어야 합니다.
- 검사기를 실행할 수 없는 경우에도 커밋이 차단돼야 합니다. 검증 후 환경변수와 임시 파일을 복구·정리합니다.

2026-10-11에 Windows에서 실제 전역 `pre-commit` 실행을 검증했습니다.
정상 커밋, 시크릿·검사기 오류 시 차단, 인덱스 보존, `git commit -a`의 검사가 통과했습니다.
작업 폴더와 인덱스의 내용이 다르면 실제 커밋할 인덱스 내용을 기준으로 검사하는 것도 확인했습니다.

## 갱신

[공통 갱신 절차](../../README.md#지침-갱신하기)에 따라 최신 내용을 받습니다.
저장소 경로가 바뀌면 Git 훅 경로를 갱신한 뒤 다시 검증합니다.
