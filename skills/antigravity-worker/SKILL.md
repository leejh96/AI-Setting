---
name: antigravity-worker
description: Antigravity를 실행 워커로 요청받았을 때 Windows 또는 macOS의 Antigravity 대화형 화면에서 작업을 진행하고, Codex에서 변경분과 테스트를 검토합니다.
---

# Antigravity 워커

Codex가 작업 범위와 완료 조건을 정합니다. Antigravity가 작업을 수행하고, Codex가 실제 결과를 검토합니다.

## 작업 전달

- Node.js 22 이상과 로그인된 Antigravity 명령줄 도구(CLI) `agy`가 필요합니다. `gemini-3.8-flash-high`, `--effort high`, 대화형 시작 프롬프트(`-i`)와 워크스페이스 훅을 지원하는 버전을 사용합니다.
- 변경 작업은 가능한 경우 승인 범위 안에서 별도 Git 워크트리에 위임합니다. 이미 지정된 작업 트리가 있으면 사용자 변경과 워커 변경을 구분할 수 있게 시작 전 상태를 확인합니다. 같은 워크트리에서 Codex와 워커가 동시에 편집하지 않습니다.
- 저장소 밖 UTF-8 파일에 목표, 절대 작업 경로, 수정 범위, 수용 조건, 검증 방법을 씁니다. 워커에 허용된 셸·MCP·브라우저와 리소스를 명시합니다. 초기 프롬프트는 실행 인자로 전달하므로 비밀값을 넣지 않고, Windows에서는 12,000자 이내로 작성합니다.
- 실행기는 `--dangerously-skip-permissions`와 `--sandbox` 옵션을 사용합니다. 해당 환경에서 터미널 샌드박스가 지원되는지 확인하고, 외부 전송·운영 데이터 변경·커밋·푸시·배포는 현재 사용자 승인 범위에 따릅니다. 브라우저 검증은 별도 요청에 허용된 브라우저 작업과 범위를 적습니다. Chrome 원격 디버깅 승인과 조직 정책은 각 환경에서 확인합니다.
- Codex의 실행 제한으로 CLI 인증, 네트워크 또는 터미널 접근이 막히면 해당 실행에 필요한 승인 절차를 사용합니다. `terminalOpen: null`은 현재 세션에서 터미널 프로세스의 생존 여부를 확인할 권한이 없다는 뜻입니다.

## 실행과 결과 확인

`<runner>`는 이 스킬 폴더의 `scripts/worker.mjs` 절대 경로입니다. 아래 인자는 각각 절대 경로를 사용합니다.

```text
node <runner> start <worktree> <prompt-file> [timeout-seconds]
node <runner> follow-up <job-directory> <prompt-file> [timeout-seconds] [--new-terminal]
node <runner> status <job-directory>
node <runner> cancel <job-directory>
```

1. 최초 요청은 `start`로 전달합니다. Windows PowerShell과 macOS Terminal.app에서 Antigravity 대화형 화면이 열립니다. 반환된 `jobDirectory`로 `status`를 조회합니다. `starting`은 터미널 시작, `agy-starting`은 첫 훅 대기, `agy-running`은 작업 실행, `agy-settling`은 종료 이벤트 확인 단계입니다.
2. `review-ready`가 되면 화면 또는 `transcriptPath`에서 응답을 읽고, diff와 새 파일을 확인한 뒤 필요한 테스트를 직접 실행합니다. 수정이 필요하면 발견 사항과 완료 조건을 적어 `follow-up`으로 전달합니다. 이전 대화형 프로세스가 종료된 뒤 같은 터미널에서 다음 대화가 열립니다. 종료 요청과 새 훅 이벤트가 겹쳐 검토 상태가 해제되면, 상태를 다시 확인하고 새 `review-ready`에서 후속 요청을 재시도합니다. 별도 창을 원하면 `--new-terminal`을 사용합니다. 이전 터미널을 사용할 수 없고 작업 잠금이 정리된 상태라면 새 터미널을 엽니다. 각 자동 요청은 새로운 `agy` 대화이므로 후속 프롬프트에 필요한 문맥을 넣습니다.
3. 화면에 직접 새 프롬프트를 보내면 `changed-after-handoff`로 표시됩니다. 그 작업의 변경분을 다시 확인하고, 화면을 종료한 다음 자동 후속 요청을 보냅니다. `Ctrl+D`는 Antigravity 화면을 종료하고, `cancel`은 워커에 중단을 요청합니다. 빈 워커 터미널은 `Ctrl+C`로 닫습니다. 터미널 재사용이 끝날 때까지 최초 작업의 디렉터리를 보관합니다.

## 작업 기록 보관

작업 기록은 `~/.codex/antigravity-worker/jobs/`에 저장합니다. `CODEX_HOME`을 지정했다면 그 위치를 기준으로 합니다. 후속 요청은 같은 저장 경로에 있는 터미널을 재사용할 수 있습니다.

다음 `start` 또는 `follow-up` 실행 시, 이 경로에서 터미널이 닫힌 지 24시간이 지났고 같은 터미널의 모든 작업에 최종 결과가 있으며 작업 폴더 잠금이 해제된 경우에만 작업 기록을 지웁니다. 현재 `follow-up`에서 참조하는 기록, `cleanup-needed`, 종료를 확인할 수 없는 기록은 보관합니다.

## 실패와 복구

- 터미널이 요청을 받는 기한과 `agy`의 첫 훅 대기 기한은 각각 45초입니다. 작업 실행 한도는 기본 1,800초이며 1~14,400초를 지정할 수 있습니다. `timed-out`이면 `phase`와 `eventPath`를 확인합니다.
- 현재 요청의 정상 `Stop` 이벤트와 `fullyIdle: true`가 확인되면 검토를 시작합니다. 파일 변경 알림이 누락될 때를 대비해 실행 중에는 이벤트 기록도 주기적으로 확인합니다. 완료 신호 없이 화면이 닫히거나 CLI가 예기치 않게 종료되면, 하위 작업이 남을 수 있어 `cleanup-needed`로 잠금을 유지합니다. 이때 `exitStatus`는 각각 `completion-missing` 또는 `failed`입니다. 워커는 작업 폴더의 `.agents/hooks.json`에 훅을 임시로 추가하며, 정상 완료 후 화면을 닫거나 중단이 확인되면 기존 설정을 복원하고 잠금을 해제합니다.
- macOS에서는 화면을 시작하기 전 터미널 입력 설정을 저장하고 화면이 닫힌 뒤 복구합니다. 복구에 실패하면 `terminalError`를 기록하고 해당 터미널은 후속 요청에서 교체합니다.
- `cleanup-needed`이면 다음 순서로 복구합니다.
  1. `workerPid`와 `terminalPid`로 이전 작업을 식별하고 Antigravity 및 그 작업이 시작한 프로세스가 종료됐는지 확인합니다.
  2. `hookPath`의 현재 설정을 `jobDirectory/original-hooks.json`과 대조해 임시 워커 항목만 정리합니다. 원래 설정이 없었다면 백업 파일도 없으며, 임시 훅만 들어 있는 파일은 제거할 수 있습니다. 다른 설정 변경은 보존합니다.
  3. `lockPath` 내용이 복구 중인 `jobDirectory`와 정확히 일치하는지 확인한 뒤 해당 잠금 파일을 제거합니다. 이미 생긴 작업 변경분을 검토하고 재실행합니다.
