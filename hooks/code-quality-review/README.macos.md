# macOS 코드 품질 검토 훅 설정

[공통 동작·범위·한계](README.md) · [Windows 설정](README.windows.md) · [저장소 안내](../../README.md)

저장소 루트의 터미널에서 실행합니다. Node.js 22 이상을 준비합니다. Gemini용은 기존 secret checker와 같은 Antigravity용입니다.

```sh
node --version
command -v node
```

아래 명령은 현재 Node와 훅의 절대 경로를 포함한 JSON을 출력합니다. 생성 명령은 POSIX 셸의 작은따옴표 형식이며 공백·작은따옴표가 있는 경로도 인용합니다. 저장소·Node 경로가 바뀌면 다시 생성합니다. 데스크톱 앱에서도 해당 Node를 실행할 수 있어야 합니다.

## Codex

```sh
node hooks/code-quality-review/codex/codex-code-quality-review.mjs --print-config
```

기존 `~/.codex/hooks.json` 전체를 백업하고 출력의 `hooks.Stop` 그룹만 기존 이벤트·핸들러를 유지하며 병합합니다. 프로젝트만 적용하려면 `.codex/hooks.json`을 사용합니다. 전역·프로젝트·인라인 설정에 같은 훅을 중복 등록하지 않습니다.

Codex를 재시작하고 CLI `/hooks`에서 출처와 명령을 검토해 신뢰 등록합니다. 프로젝트에 등록했다면 프로젝트도 신뢰되어야 합니다. 검토 우회 옵션을 일상 설정에 추가하거나 신뢰 상태를 수동으로 만들지 않습니다. 훅 명령이 바뀌면 다시 검토·등록합니다. 공통 `REVIEW.md` 변경 내용도 검토합니다.

## Gemini / Antigravity

```sh
node hooks/code-quality-review/gemini/gemini-code-quality-review.mjs --print-config
```

기존 `~/.gemini/config/hooks.json` 전체를 백업하고 출력의 `ai-setting-code-quality-review` 키만 기존 훅을 유지하며 병합합니다. 프로젝트만 적용하려면 `.agents/hooks.json`을 사용합니다. Gemini CLI의 `settings.json`에는 이 설정을 넣지 않습니다.

Antigravity를 재시작하고 CLI `/hooks` 또는 앱의 Customizations > Hooks에서 활성 상태를 확인합니다. 생성한 따옴표를 임의로 제거하지 말고 앱 안에서 명령이 실제로 실행되는지 확인합니다.

## 검증과 갱신

```sh
node --test hooks/code-quality-review/codex/codex-code-quality-review.test.mjs hooks/code-quality-review/gemini/gemini-code-quality-review.test.mjs
```

macOS에서 테스트하면 생성 명령을 `/bin/sh`로 실행하여 입력·표식·오류 처리와 특수 경로를 확인합니다. 자동 테스트만으로 모델의 전체 검토 반복을 증명하지는 않습니다.

두 도구의 새 대화에서 작은 구현을 요청합니다. 현재 파일을 실제로 다시 읽고, 문제가 있으면 수정·검증한 뒤 `revised` 상태로 끝내고, 다음 회차에서 수정 없이 `clean`으로 종료하는지 확인합니다. 문서만 수정하는 작업·읽기 전용 리뷰·답변 대기에서는 코드 수정 없이 종료해야 합니다. 검증 실패·실행 불가를 통과로 보고하지 않는지도 확인합니다. CLI 결과와 데스크톱 앱 결과를 구분합니다.

이번 정리는 Windows에서 수행했으며 실제 macOS 런타임·앱 동작은 확인하지 않았습니다. POSIX 명령 생성과 Windows의 Git sh 실행 검사는 macOS 기기 검증을 대신하지 않습니다. macOS에서 설치한 뒤 위 테스트와 실제 대화 확인을 수행하세요.

Node·저장소 경로 변경 후에는 생성·갱신·등록·검증을 다시 수행합니다. 현재 기기의 절대 경로가 든 생성 설정은 저장소에 커밋하지 않습니다.
