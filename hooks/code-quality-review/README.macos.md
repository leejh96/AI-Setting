# macOS 코드 품질 검토 훅 설정

[공통 동작·범위·한계](README.md) · [Windows 설정](README.windows.md) · [저장소 안내](../../README.md)

저장소 루트의 터미널에서 실행합니다. Node.js 22 이상을 준비합니다. Gemini용은 기존 secret checker와 같은 Antigravity용입니다.

```sh
node --version
command -v node
```

아래 명령은 현재 Node와 훅의 절대 경로를 포함한 JSON을 출력합니다. 생성 명령은 POSIX 셸의 작은따옴표 형식이며 공백·작은따옴표가 있는 경로도 인용합니다. 설치본·Node 경로가 바뀌면 다시 생성합니다. 데스크톱 앱에서도 해당 Node를 실행할 수 있어야 합니다.

## 실행 파일 복사

등록 전에 기존 설정·설치본의 별도 수정과 복구 수단을 확인합니다. 저장소 루트에서 공통 파일과 해당 도구 어댑터만 실제 파일로 복사합니다. 아래 명령은 기존 파일을 교체하므로 대조·백업 후 실행하며, 폐기된 설치 파일이 있으면 용도를 확인해 별도로 정리합니다.

```sh
codex_hook_target="${CODEX_HOME:-$HOME/.codex}/hooks/code-quality-review"
gemini_hook_target="$HOME/.gemini/config/hooks/code-quality-review"
mkdir -p "$codex_hook_target/codex" "$gemini_hook_target/gemini"
for hook_runtime_file in REVIEW.md review-request.mjs review-status.mjs review-changes.mjs watch-worker.mjs; do
  cp "hooks/code-quality-review/$hook_runtime_file" "$codex_hook_target/"
  cp "hooks/code-quality-review/$hook_runtime_file" "$gemini_hook_target/"
done
cp "hooks/code-quality-review/codex/codex-code-quality-review.mjs" "$codex_hook_target/codex/"
cp "hooks/code-quality-review/gemini/gemini-code-quality-review.mjs" "$gemini_hook_target/gemini/"
```

설정은 아래 설치본에서 생성합니다. 심볼릭 링크·테스트·개발 문서·반대 도구 어댑터는 설치하지 않으며, 원본을 수정한 뒤에는 다시 복사합니다.

## Codex

```sh
node "$codex_hook_target/codex/codex-code-quality-review.mjs" --print-config
```

기존 `${CODEX_HOME:-$HOME/.codex}/hooks.json` 전체를 백업하고 출력의 `hooks.UserPromptSubmit`과 `hooks.Stop` 그룹을 기존 이벤트·핸들러를 유지하며 함께 병합합니다. 준비 이벤트에서 파일 감시가 시작돼야 Stop이 수정 기록과 감시 정상 여부를 확인할 수 있습니다. 프로젝트만 적용하려면 `.codex/hooks.json`을 사용합니다. 전역·프로젝트·인라인 설정에 같은 훅을 중복 등록하지 않으며 비활성화 상태를 보존합니다.

Codex를 재시작하고 CLI `/hooks`에서 출처와 명령을 검토해 신뢰 등록합니다. 프로젝트에 등록했다면 프로젝트도 신뢰되어야 합니다. 검토 우회 옵션을 일상 설정에 추가하거나 신뢰 상태를 수동으로 만들지 않습니다. 훅 정의가 바뀌면 다시 검토·등록합니다. 공통 `REVIEW.md` 변경 내용도 검토합니다.

## Gemini / Antigravity

```sh
node "$gemini_hook_target/gemini/gemini-code-quality-review.mjs" --print-config
```

기존 `~/.gemini/config/hooks.json` 전체를 백업하고 출력의 `ai-setting-code-quality-review` 안의 `PreInvocation`과 `Stop`을 함께 병합합니다. 기존 `enabled` 상태와 시크릿 검사 등 다른 훅을 보존합니다. 프로젝트만 적용하려면 `.agents/hooks.json`을 사용합니다. Gemini CLI의 `settings.json`에는 이 설정을 넣지 않습니다.

Antigravity를 재시작하고 CLI `/hooks` 또는 앱의 Customizations > Hooks에서 활성 상태를 확인합니다. 생성한 따옴표를 임의로 제거하지 말고 앱 안에서 명령이 실제로 실행되는지 확인합니다.

## 검증과 갱신

```sh
node --test --test-concurrency=1 hooks/code-quality-review/review-changes.test.mjs hooks/code-quality-review/review-status.test.mjs hooks/code-quality-review/codex/codex-code-quality-review.test.mjs hooks/code-quality-review/gemini/gemini-code-quality-review.test.mjs
```

macOS에서 테스트하면 생성 명령을 `/bin/sh`로 실행하여 입력·표식·오류 처리와 특수 경로를 확인합니다. 자동 테스트만으로 모델의 전체 검토 반복을 증명하지는 않습니다.

두 도구의 새 대화에서 작은 구현을 요청합니다. 현재 파일과 산출물 목록·용도를 실제로 확인하고, 문제가 있으면 수정·검증한 뒤 `revised` 상태로 끝내고, 다음 회차에서 수정 없이 `clean`으로 종료하는지 확인합니다. 터미널·서브에이전트의 수정, 문서만 수정한 경우, ignored 백업 후보를 만든 경우도 검토해야 합니다. 변경 없는 질문·읽기 전용 리뷰와 적용 대상 수정 전의 답변·승인 대기에서는 추가 프롬프트와 상태 표식 없이 종료해야 합니다. 이미 적용 대상인 변경을 수행한 뒤 답변·승인을 기다리는 경우에는 `blocked`로 종료하고 미완료 범위를 보고해야 합니다. 검증 실패·실행 불가를 통과로 보고하지 않는지도 확인합니다. CLI 결과와 데스크톱 앱 결과를 구분합니다.

이번 정리는 Windows에서 수행했으며 실제 macOS 런타임·앱 동작은 확인하지 않았습니다. POSIX 명령 생성과 Windows의 Git sh 실행 검사는 macOS 기기 검증을 대신하지 않습니다. macOS에서 설치한 뒤 위 테스트와 실제 대화 확인을 수행하세요.

Node·설치본 경로 변경 후에는 생성·갱신·등록·검증을 다시 수행합니다. 현재 기기의 절대 경로가 든 생성 설정은 저장소에 커밋하지 않습니다.
