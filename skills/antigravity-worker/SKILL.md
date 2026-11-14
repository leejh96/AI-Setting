---
name: antigravity-worker
description: Antigravity 워커를 ACP로 실행하거나 시험해 달라고 요청할 때 사용합니다. ACP로 진행과 완료를 확인하고 Codex에서 변경분을 검토합니다.
---

# Antigravity 워커

Codex가 목표와 수용 조건을 작성하고, Antigravity가 격리 작업 폴더에서 실행합니다. Codex는 변경분을 검토하고 검증·반영·정리를 맡습니다.

## 실행

Node.js 22 이상과 로그인된 Antigravity CLI가 필요합니다. macOS의 `agy 1.5.9`에서 검증합니다. 아래 `<runner>`는 이 스킬의 `scripts/worker.mjs` 절대 경로입니다.

```text
node <runner> update
node <runner> capabilities [absolute-workspace]
node <runner> quota
node <runner> prepare <absolute-original-folder>
node <runner> prepare --copy <original-worktree>
node <runner> prepare
node <runner> start <job> <prompt-file> [--edit] [--model <id>] [--effort <level>]
node <runner> status <job>
node <runner> follow-up <job> <prompt-file> [--edit] [--model <id>] [--effort <level>]
node <runner> cancel <job>
node <runner> review <job>
node <runner> finish <job> <review-id> --apply
node <runner> finish <job> <review-id> --keep
node <runner> discard <job> [--confirmed-stopped]
```

Codex 기본 작업 경로인 `$CODEX_HOME/antigravity-worker/worktrees/`에 쓰는 `prepare`, 프롬프트 파일 저장, `start`, `follow-up`, `cancel`, `review`, `finish`, `discard`는 실행 도구의 명령별 권한 검토를 사용합니다. `exec_command`에서는 `sandbox_permissions: "require_escalated"`와 실제 명령·대상을 설명하는 `justification`을 지정합니다. `status`와 로그 읽기는 기본 권한으로 실행합니다. 권한 검토가 거부되면 사유와 남은 작업을 알립니다.

새 워커 작업을 시작할 때 `prepare` 전에 한 번 `node <runner> update`를 별도 권한 검토로 실행합니다. 이 명령은 ACP가 사용할 바이너리의 `agy update`로 최신 버전을 확인하고 필요한 경우 업데이트한 뒤 `--version`으로 설치 버전을 확인합니다. 실패하면 오류를 알려주고 작업 폴더를 만들기 전에 멈춥니다. 같은 작업의 후속 턴, 조회, 중단, 정리에서는 반복하지 않습니다.

1. `prepare <absolute-original-folder>`에 반영 대상인 실제 폴더를 전달합니다. Git이면 현재 커밋의 별도 워크트리를 만들고, 일반 폴더면 파일을 작업 폴더에 복사합니다. Git 메타데이터 쓰기가 제한되면 `prepare --copy <original-worktree>`로 로컬 develop 또는 기본 브랜치의 커밋에서 파일을 복사합니다. 반환된 `job`과 `cwd`를 확인합니다. 새 작업은 `~/.codex/antigravity-worker/worktrees/`에 생성되며, `CODEX_HOME`이 설정돼 있으면 그 경로를 기준으로 합니다. 이전 버전에서 OS 임시 디렉터리에 만든 작업은 기존 경로로 엽니다.
2. 반환된 `job` 아래에 UTF-8 프롬프트 파일을 만들고 목표, `cwd`, 변경 범위, 수용 조건, 검증 방법, 허용 도구를 씁니다. 확인용 요청에는 도구가 필요한지 명시합니다. 커밋·푸시·배포·외부 변경은 사용자 승인 범위에서만 진행합니다.
3. `start`를 실행하고 도구 실행 세션을 계속 확인합니다. 사용자가 파일 편집을 승인한 작업에만 `--edit`를 붙입니다. 이 옵션은 ACP의 `accept-edits` 모드를 사용합니다. 별도 승인 요청은 취소 처리되며 `permission-denied`에서 요청된 작업을 확인할 수 있습니다. 실행기는 `agy acp --sandbox`와 표준 입출력으로 통신하고, 작업별 임시 프로필에 대화 상태를 저장합니다. 적용한 모델과 추론 수준은 `running.settings`에서 확인합니다.
4. `review-ready`는 ACP가 `end_turn`을 반환하고 프로세스가 정상 종료된 상태입니다. `status`에 표시된 `turn/response.txt`와 `turn/events.jsonl`에서 답변과 도구 상태를 확인합니다. 아래 기준으로 변경을 직접 검토합니다. 수정이 필요하면 `follow-up`으로 같은 ACP 세션을 재개합니다.
5. 최종 검토와 필요한 테스트를 마치면 아래의 적용 여부 질문을 진행합니다.

## 결과 검토

- 요청의 완료 조건을 변경분과 대조합니다. diff와 새 파일을 직접 읽고 기존 사용자 변경, 범위 밖 수정, 임시 파일과 로그가 반영 대상에 섞였는지 확인합니다.
- 정상 사용 경로와 변경에 영향을 받는 실패 분기를 직접 실행합니다. 입력·권한·데이터를 바꿨다면 실패 후 사용자에게 보이는 결과와 최종 파일 상태도 확인합니다. 성능이 요구 사항이면 같은 조건에서 변경 전후를 비교합니다.
- 기존 코드 재사용, 불필요한 구조나 의존성 추가, 숨겨진 오류 처리를 점검합니다. 문제가 있으면 재현 조건과 기대 결과를 후속 턴에 전달하고 수정분을 다시 검증합니다.

## 중단·실패 후 정리

- `cancel`은 실행 중인 턴에 중단을 요청합니다. `status`에서 최종 상태를 확인하고 남은 변경과 로그를 확인합니다. 사용자가 작업을 폐기하기로 하면 `discard <job>`을 실행합니다. `prepared`, `cancelled`, `failed`, `permission-denied` 상태에서 Git 워크트리 등록, 작업 폴더, 로그, 세션 프로필을 정리합니다. 원본 파일에 반영하는 단계는 `finish --apply`입니다.
- `cleanup-needed`이거나 실행기가 강제 종료돼 `starting` 또는 `running` 상태에 머물러 있으면 먼저 `runnerPid`, `workerPid`, `turn/agy.log`, `turn/stderr.log`를 확인합니다. 실행기, Antigravity, 관련 하위 작업이 모두 종료된 것이 확인되면 `discard <job> --confirmed-stopped`를 사용합니다. 기록된 프로세스가 살아 있거나 종료를 확인할 수 없으면 작업을 보존하고 경로를 알립니다.
- 결과를 남기기로 하면 현재 작업 폴더를 보존합니다. 실패한 턴은 다른 세션에서 자동 재시도하지 않습니다.

## 원본 적용 또는 별도 보관

- `review <job>`으로 원본 경로, 변경 목록, `reviewId`를 확인합니다. 목록과 실제 변경분을 대조하고 원본 경로, 주요 변경, 검증 결과를 보여준 뒤 **매 작업마다** “원본에 적용하고 정리할까요, 현재 작업 폴더에 남길까요?”라고 묻습니다. 답변을 기다리는 동안 작업을 보존합니다. 사용자가 수정·재검토를 요청하면 마지막 결과를 다시 검토하고 묻습니다. 원본 없이 만든 실험이나 원본 상태를 기록하기 전 버전에서 만든 작업은 현재 작업 폴더 경로를 안내합니다.
- 사용자가 적용을 선택하면 `finish <job> <review-id> --apply`를 실행합니다. 검토한 변경만 원본 파일에 적용합니다. 원본 Git의 브랜치·커밋이 바뀌거나 같은 파일의 현재 내용이 작업 시작 상태와 결과 양쪽에 모두 다르면 충돌을 보고하고 작업을 보존합니다. 적용은 원본 작업 폴더에서 확인하며, 커밋과 푸시는 별도 승인 범위를 따릅니다.
- 사용자가 현재 작업 폴더에 남기기를 선택하면 `finish <job> <review-id> --keep`을 실행하고 반환된 `cwd`를 알려줍니다. Git 워크트리 등록, 작업 파일, 기록과 세션 프로필을 같은 위치에 둡니다.
- 원본 적용을 검증한 뒤 작업 폴더, 작업 기록과 세션 프로필을 정리합니다. 옮기거나 작업 폴더를 삭제할 때 심볼릭 링크가 끊기거나 다른 곳을 가리키게 되면 작업을 보존하고 경로를 알립니다. 종료·검증이 불확실한 경우에도 작업을 보존합니다. 적용은 확인됐으나 정리만 실패했다면 같은 검토 ID로 `finish --apply`를 재시도합니다.

## 모델과 추론 수준 선택

- 새 작업의 기본값은 Gemini 4 Hydrogen High입니다. 요청에 모델이나 추론 수준이 지정돼 있으면 `--model` 또는 `--effort`로 전달합니다. 예를 들어 Claude Sonnet 5.5 High는 `--model claude-sonnet-5-5 --effort high`입니다. 모델 ID는 `capabilities`의 `options`에서 `model` 선택지를 확인합니다.
- 모델만 바꾸면 변경 직후 서버가 알려준 추론 수준을 사용합니다. Orchestrator처럼 추론 수준 선택을 제공하지 않는 모델에는 `--model gemini-pro-orchestrator-g1-pro`만 전달합니다. 지원하지 않는 모델·추론 수준을 명시하면 실행기가 프롬프트 전송 전에 오류를 반환합니다.
- 같은 세션의 `follow-up`은 마지막으로 적용한 모델과 추론 수준을 이어받습니다. 후속 턴에 다른 설정을 요청하면 같은 세션에서 바꿉니다.

## 남은 할당량 조회

- 사용자가 남은 할당량을 요청하면 `quota`를 실행합니다. 실행기는 Antigravity CLI의 `agy -p /usage`를 호출합니다. 조회만 요청한 경우 작업 폴더를 준비하거나 ACP 세션을 열 필요가 없습니다.
- `report`의 모델 그룹별 잔여 비율과 갱신 시각을 채팅에 표시합니다. 조회가 실패하면 실패를 알립니다. 할당량은 요청 시에만 조회합니다.

## 슬래시 명령 목록

- 사용자가 ACP에서 가능한 `/` 명령을 물으면 `capabilities`를 실행합니다. 작업 경로가 정해졌다면 그 경로를 전달합니다. 이 명령은 ACP 세션을 열어 목록을 받고 닫으며 작업 프롬프트는 전송하지 않습니다.
- 채팅에 `commands`의 명령 이름을 `/`로 시작하는 마크다운 목록으로 표시하고, 요청에 따라 설명과 입력 힌트를 덧붙입니다. 실행한 세션에서는 `available-commands` 이벤트나 `status`의 마지막 명령 목록을 사용합니다. `null`은 서버가 목록을 보내지 않은 상태이고 빈 배열은 서버가 빈 목록을 보낸 상태입니다.
- 사용자가 특정 명령의 실행을 요청하면 해당 세션이 제공한 이름을 확인한 뒤 명령과 인자를 프롬프트로 전달합니다. `/model`과 `/effort`에 해당하는 설정은 위 실행기 옵션으로 전달합니다.

## 채팅에 턴 표시

- `start`와 `follow-up`을 실행하기 직전에 **N턴 · Codex → Antigravity**라는 진행 메시지로 실제 전송할 프롬프트 전문을 보여줍니다. 프롬프트 파일에서 앞뒤 공백을 제거한 내용이 전송됩니다. 작업 경로, 조건, 검증 지시까지 포함해 줄바꿈을 유지합니다. 메시지 한도에 닿으면 번호를 붙여 나누어 표시합니다.
- 실행 중에도 출력을 읽을 수 있도록 `start`와 `follow-up`을 실행합니다. `running` 이벤트를 받으면 해당 턴에 서버가 적용한 모델과 추론 수준을 `settings`에서 읽어 곧바로 진행 메시지로 표시합니다. 추론 수준이 없는 모델은 모델 이름만 표시합니다.
- 각 턴이 끝나는 즉시 **N턴 · Antigravity → Codex**라는 진행 메시지로 `response.txt`의 응답 전문을 그대로 표시합니다. ACP 종료 상태는 원문 밖에 씁니다. 중단이나 오류가 발생하면 그때까지 받은 응답과 상태를 표시합니다. 다음 요청은 이전 턴의 응답을 공유한 뒤 보냅니다.
- 프롬프트와 응답의 각 줄을 마크다운 인용문(`>`)으로 표시합니다. 원문의 문단, 목록, 링크, 코드 서식을 살리고, 문장 사이 줄바꿈은 필요하면 마크다운 강제 줄바꿈으로 표시합니다. 메시지 전체를 코드 블록으로 감싸지 않습니다. 세션 ID와 도구 이벤트는 필요한 경우 본문 바깥에 표시합니다. 인증정보 등 비밀값이 응답에 포함되면 해당 부분을 가리고 표시합니다.

## 사용자 체험

“`$antigravity-worker`로 체험해줘. 임시 폴더에 `acp-demo.txt`를 만들고, 같은 ACP 세션의 후속 요청으로 한 줄을 추가해줘. 두 턴의 ACP 결과와 파일 내용을 보여줘.”

이 요청에서는 빈 작업 폴더를 사용합니다. 각 턴이 끝나면 Codex에서 파일을 직접 읽어 검증하고, 채팅에 ACP 서버 버전, 각 턴의 도구 이벤트와 종료 상태, 같은 세션이 재개됐는지, 최종 파일 내용을 보여줍니다. 결과가 남아 있는 작업 폴더의 링크를 알려줍니다.
