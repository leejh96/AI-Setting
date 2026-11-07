# 터미널 명령 검사 훅 설치 (macOS)

저장소 루트에서 사용할 도구의 명령을 실행합니다. 먼저 기존 등록 파일과 별도 수정한 설치본을 접근이 제한된 위치에 백업합니다. `--print-config`는 현재 Node 실행 파일과 복사본의 절대 경로가 포함된 JSON을 출력합니다.

## Codex

```sh
codex_guard_dir="${CODEX_HOME:-$HOME/.codex}/hooks/command-guard"
mkdir -p "$codex_guard_dir/codex"
cp hooks/command-guard/{command-guard,hook-cli,shell-commands}.mjs "$codex_guard_dir/"
cp hooks/command-guard/codex/codex-command-guard.mjs "$codex_guard_dir/codex/"
node "$codex_guard_dir/codex/codex-command-guard.mjs" --print-config
```

출력의 `hooks.PreToolUse` 그룹을 `~/.codex/hooks.json`의 해당 배열에 병합합니다. `CODEX_HOME`을 쓰는 경우 그 위치의 `hooks.json`을 사용합니다. 같은 어댑터가 이미 있으면 해당 항목만 교체하고 다른 훅과 설정은 보존합니다. CLI의 `/hooks`에서 새 정의를 확인하고 신뢰를 등록합니다.

## Antigravity

```sh
antigravity_guard_dir="$HOME/.gemini/config/hooks/command-guard"
mkdir -p "$antigravity_guard_dir/gemini"
cp hooks/command-guard/{command-guard,hook-cli,shell-commands}.mjs "$antigravity_guard_dir/"
cp hooks/command-guard/gemini/gemini-command-guard.mjs "$antigravity_guard_dir/gemini/"
node "$antigravity_guard_dir/gemini/gemini-command-guard.mjs" --print-config
```

출력의 `ai-setting-command-guard` 키만 `~/.gemini/config/hooks.json`에 병합합니다. 기존 `enabled` 상태와 다른 훅은 보존합니다. 앱의 Settings → Customizations → Hooks에서 로딩 상태를 확인합니다.

## 설치 후 확인과 해제

새 세션과 폐기 가능한 테스트 저장소에서 `git status`는 통과하고 `git reset --hard`는 두 도구 모두에서 차단되는지 확인합니다. 해제하려면 이 훅의 Codex `PreToolUse` 그룹 또는 Antigravity `ai-setting-command-guard` 키만 제거합니다.
