---
name: antigravity-worker
description: Codex가 Antigravity CLI에 구현·수정·조사 작업을 위임하고 별도 Windows 또는 macOS 터미널에 실행 과정을 표시한 뒤 변경분과 테스트를 검토할 때 사용합니다. Antigravity를 실행 워커로 요청한 작업에 적용합니다.
---

# Antigravity 워커

Codex가 작업 범위와 완료 조건을 정합니다. Antigravity가 작업을 수행하고, Codex가 실제 결과를 검토합니다.

## 작업 전달

- Node.js 22 이상과 로그인된 `agy` CLI가 필요합니다. CLI에서 `gemini-3.8-flash-high`, `--effort high`, 대화형 초기 프롬프트(`-i`)와 워크스페이스 훅을 지원해야 합니다. 모델이 없거나 로그인이 필요하면 사용자에게 현재 상태를 알립니다.
- 변경 작업은 가능한 경우 승인 범위 안에서 별도 Git 워크트리에 위임합니다. 이미 지정된 작업 트리가 있으면 사용자 변경과 워커 변경을 구분할 수 있게 시작 전 상태를 확인합니다. 같은 워크트리에서 Codex와 워커가 동시에 편집하지 않습니다.
- 저장소 밖 작업용 UTF-8 파일에 작업 목표, 절대 작업 경로, 수정 범위, 수용 조건, 검증 방법을 씁니다. 워커가 사용할 수 있는 셸·MCP·브라우저와 그 작업에 허용된 리소스를 명확히 구분합니다. 초기 지시는 CLI 실행 인자로 전달되므로 비밀값을 넣지 않습니다. Windows에서는 초기 지시를 12,000자 이내로 작성하고, 직접 파일 도구로 수정할 파일에 절대 경로를 제시합니다.
- 실행기는 `--dangerously-skip-permissions`와 Antigravity 터미널 샌드박스를 사용하고 설치된 Antigravity 도구 구성을 따릅니다. 작업 위임은 외부 전송, 운영 데이터 변경, 커밋·푸시·배포에 대한 권한을 추가하지 않습니다. 브라우저 검증을 맡길 때에는 `/browser`로 시작하는 별도 작업으로 전달합니다. Chrome 원격 디버깅 승인과 조직 정책은 각 환경에서 확인합니다.

## 실행과 결과 확인

`<runner>`는 이 스킬 폴더의 `scripts/worker.mjs` 절대 경로입니다. 아래 인자는 각각 절대 경로를 사용합니다.

```text
node <runner> start <worktree> <prompt-file> [timeout-seconds]
node <runner> status <job-directory>
```

1. `start`가 반환한 `jobDirectory`로 상태를 확인합니다. 별도 터미널에서 Antigravity의 대화형 화면이 열립니다. `starting` 또는 `running` 동안 워커를 기다리며 상태가 바뀌면 채팅에 공유합니다. 실행 도구가 자격 증명, 네트워크, 터미널 열기를 막으면 해당 작업에 필요한 실행 승인을 사용합니다.
2. `review-ready`는 Antigravity가 종료 훅을 보냈고 후속 실행이 관찰되지 않아 임시 훅을 복원했다는 뜻입니다. 대화형 화면은 열린 상태로 볼 수 있습니다. 검토 중에는 같은 터미널에서 새 작업을 시작하지 않습니다. 실패·중단·시간 초과 상태에서는 다시 위임하기 전에 기존 실행과 변경분을 확인합니다. `cleanup-needed`이면 상태의 훅 경로와 백업을 확인해 다른 변경을 보존하며 정리합니다. 실행 중 중단은 Antigravity 화면의 `Ctrl+C`를 사용합니다.
3. `transcriptPath`의 현재 작업 응답을 필요에 따라 확인하고, 시작 전 상태 대비 diff와 새 파일을 확인한 뒤 필요한 테스트를 직접 실행합니다. 최종 보고 전 `status`를 다시 확인합니다. `changed-after-handoff`이면 추가 작업 상태를 확인한 뒤 영향 범위를 재검토합니다. 수정이 필요하면 구체적인 발견 사항과 완료 조건을 새 작업으로 전달합니다.

Windows는 PowerShell, macOS는 Terminal.app으로 창을 엽니다. 실행기는 워크트리의 `.agents/hooks.json`에 작업용 훅을 임시 등록하고 원본을 `jobDirectory`의 `original-hooks.json`에 백업합니다. 위임 작업이 훅 설정 파일 자체를 편집하는 경우에는 이 실행기를 사용하기 전에 충돌 가능성을 확인합니다. 강제 종료 뒤 훅이나 잠금 파일이 남으면 워커 종료를 확인하고, 백업과 현재 설정을 대조해 해당 작업의 항목만 정리합니다. Antigravity 창을 닫고 검토를 마치면 작업용 프롬프트와 실행 결과를 정리합니다.
