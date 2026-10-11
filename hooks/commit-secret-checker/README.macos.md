# macOS Git 커밋 훅 설정

[훅 동작과 한계](README.md) · [Windows 설정](README.windows.md) · [저장소 안내](../../README.md)

Git과 Node.js 22 이상을 준비합니다. Gitleaks는
[macOS 설치·업데이트 안내](../prompt-secret-checker/README.macos.md#gitleaks-설치와-업데이트)에 따라 Homebrew로 설치합니다.
저장소를 받은 뒤 루트에서 명령을 실행합니다.

> 이 Git 시크릿 검사 훅을 macOS 환경에 맞게 전역 적용해줘.
> 기존 설정과 훅은 백업하고, Gitleaks는 Homebrew로 설치한 뒤 임시 저장소의 실제 커밋으로 검증해줘.

## Git 커밋 검사 등록

기존 전역 Git 설정 파일 전체와 각 프로젝트의 실행 가능한 훅을 먼저 확인·백업합니다.
`core.hooksPath`를 지정하면 기존 `.git/hooks` 대신 지정한 폴더의 훅을 실행합니다.
다른 훅이 있으면 필요한 훅을 연결하는 방식을 결정한 뒤 등록합니다.

```bash
chmod +x hooks/commit-secret-checker/pre-commit
git config --global core.hooksPath "$(pwd)/hooks/commit-secret-checker"
git config --show-origin --show-scope --get core.hooksPath
```

Git 실행 환경의 PATH에서 Node를 찾을 수 있어야 합니다.
커밋 검사기는 `/opt/homebrew/bin/gitleaks`가 있으면 우선 사용하고, 그렇지 않으면 PATH에서 찾습니다.
별도 설치 경로는 `AI_SETTING_GITLEAKS_BIN`으로 지정할 수 있습니다.

전역 등록은 즉시 적용됩니다. 프로젝트나 명령별 `core.hooksPath`가 전역 값을 덮어쓰면 이 훅이 적용되지 않습니다.
저장소를 이동하거나 삭제하면 등록 경로도 갱신해야 합니다.

## 실제 커밋 검증

Git 검사는 사용자 저장소 대신 임시 저장소에서 실제 커밋으로 확인합니다.

- 정상 파일의 커밋은 성공해야 합니다.
- 스테이징한 가상 시크릿과 검사기 실행 오류는 커밋을 차단해야 합니다.
- 차단 후 HEAD와 인덱스는 보존되어야 합니다. 값을 제거하고 다시 스테이징하면 커밋할 수 있어야 합니다.
- 작업 폴더와 인덱스가 다를 때 실제 커밋할 인덱스를 검사하고, `git commit -a`도 검사해야 합니다.

실제 인증 키는 시험에 사용하지 않습니다. 검사기 실행 실패를 시험할 때는 원래 경로를 보존하고,
시험 후 설정·환경변수를 복구하고 임시 파일을 정리합니다.
이번 문서 분리 작업에서는 macOS 런타임을 실행해 검증하지 않았습니다.

## 갱신

[공통 갱신 절차](../../README.md#지침-갱신하기)에 따라 최신 내용을 받습니다.
저장소 경로가 바뀌면 Git 훅 경로를 갱신한 뒤 다시 검증합니다.
