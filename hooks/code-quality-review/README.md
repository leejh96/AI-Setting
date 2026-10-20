# Codex·Gemini 완료 전 코드 품질 검토

Codex와 Gemini/Antigravity의 `Stop` 훅이 같은 대화에 검토 지시를 전달합니다. 코드·스크립트·동작 설정을 변경한 구현 요청에서 요구사항, AI 슬롭, 과잉 설계와 중복 구현을 점검합니다. 문제가 있으면 수정·검증 후 새 회차에서 재검토하고, 수정 없는 회차에서 미해결 문제가 없고 필요한 검증이 충족되면 종료합니다. 별도 모델·API 키·패키지는 필요하지 않으며 Node.js 22 이상을 사용합니다.

이 저장소의 `gemini/`는 기존 secret checker와 같은 **Google Antigravity용**입니다. 별도 제품인 Gemini CLI의 `AfterAgent`나 `.gemini/settings.json` 설정과는 구분합니다.

## 도구별 동작

| 도구 | 등록 파일 | 검토 재개 응답 | 검토 상태 확인 |
| --- | --- | --- | --- |
| Codex | 전역 `~/.codex/hooks.json`, 프로젝트 `.codex/hooks.json` | `decision: "block"`과 `reason` | `stop_hook_active`, `last_assistant_message` |
| Gemini/Antigravity | 전역 `~/.gemini/config/hooks.json`, 프로젝트 `.agents/hooks.json` | `decision: "continue"`와 `reason` | 현재 사용자 턴의 transcript 내 검토 요청과 마지막 모델 응답 |

첫 종료 시도에서는 검토 지침을 전달합니다. 모델은 원래 요청과 이후 정정을 기준으로 적용 여부를 판단합니다. 설명·조사·읽기 전용 리뷰·문서만 변경한 작업 등은 검토와 수정을 생략합니다. 따라서 일반 대화에도 적용 여부를 판단하는 추가 응답이 한 번 발생할 수 있습니다.

응답 마지막 줄의 상태로 다음 동작을 결정합니다.

- `[code-quality-review:revised]`: 이번 회차에서 수정·검증했으므로 다음 Stop에서 새 검토를 요청합니다.
- `[code-quality-review:clean]`: 수정 없는 검토에서 미해결 문제가 없고 필요한 검증이 충족됐으므로 종료합니다.
- `[code-quality-review:skipped]`: 비적용 작업으로 종료합니다. 검토 통과를 뜻하지 않습니다.
- `[code-quality-review:blocked]`: 답변·승인 필요, 검증 실패·실행 불가 등 사유를 보고하고 종료합니다. 검토 통과를 뜻하지 않습니다.

첫 응답의 종료 표식으로 검토를 생략할 수 없습니다. 검토 이후 표식이 없거나 revised이면 다시 요청합니다. 횟수 제한은 없으며, 검토·수정·검증이 반복될수록 시간과 모델 사용량이 늘어납니다. 사용자가 중단할 수 있습니다. 다른 Stop 훅의 반복까지 제어하지는 않습니다.

Antigravity는 `fullyIdle: true`이고 정상 종료 사유인 `model_stop` 또는 기존 버전의 `NO_TOOL_CALL`일 때만 검토합니다. 백그라운드 작업이 남았거나 오류·취소·실행 제한으로 종료하면 강제로 재개하지 않습니다. 대화 기록에서 현재 `USER_INPUT/USER_EXPLICIT` 이후 이 훅의 요청 표식을 담은 `SYSTEM_MESSAGE/SYSTEM`과 마지막 `PLANNER_RESPONSE/MODEL`을 확인합니다. 이 기록 형식은 공식 입력 필드처럼 안정성이 보장된 규약이 아니므로 앱 버전이 바뀌면 실제 기록과 반복 종료를 다시 검증해야 합니다.

## 검토 범위와 한계

상세 기준은 [REVIEW.md](REVIEW.md) 한곳에서 관리합니다. 이번 요청의 변경과 필요한 관련 코드만 검토하며 기존 사용자 작업을 보존합니다. 요구사항 변경으로 남은 코드·테스트·설정도 승인 범위와 참조·계약을 확인한 뒤 정리합니다. `AGENTS.md`의 원래 승인·업무 규칙을 유지하며, 훅이 새 권한을 부여하지 않습니다.

검토는 같은 대화의 AI 판단입니다. 특정 모델이나 새 서브에이전트를 훅 자체가 고정 호출하지 않으며, 원래 사용자가 지정한 모델·리뷰어 조건을 따르도록 지시합니다. 상태 표식은 모델의 자기 보고이므로 모든 버그의 발견이나 실제 테스트 결과를 훅 자체가 독립적으로 증명하지는 않습니다.

입력·지침·대화 기록을 읽거나 해석하지 못하면 반복을 멈추며 자동 검토 완료로 간주하지 않습니다. Codex는 `systemMessage` 경고 JSON, Antigravity는 stderr 경고와 빈 JSON을 반환합니다. 클라이언트에 따라 경고가 출력에 나타나지 않을 수 있으므로 문제가 의심되면 훅 실행 로그를 확인합니다. Node나 훅 자체를 시작하지 못하는 오류도 별도로 확인해야 합니다.

## 파일 구성

```text
hooks/code-quality-review/
├── codex/
│   ├── codex-code-quality-review.mjs
│   └── codex-code-quality-review.test.mjs
├── gemini/
│   ├── gemini-code-quality-review.mjs
│   └── gemini-code-quality-review.test.mjs
├── REVIEW.md                            # 공통 검토 지침
├── README.md                            # 공통 동작과 한계
├── README.windows.md                    # 두 도구의 Windows 설정
└── README.macos.md                      # 두 도구의 macOS 설정
```

## 설치·검증·해제

- [Windows 설정](README.windows.md)
- [macOS 설정](README.macos.md)

기존 전역 설정 전체를 백업하고, 생성한 설정을 기존 훅·이벤트·핸들러를 보존하며 병합합니다. 전역과 프로젝트 양쪽에 같은 훅을 중복 등록하지 않습니다. 저장소를 받거나 이 파일을 수정하는 것만으로 전역 등록이 변경되지는 않습니다.

기존 Codex 루트 스크립트는 제거했습니다. 이전 경로를 등록한 환경은 저장소 루트에서 `node hooks/code-quality-review/codex/codex-code-quality-review.mjs --print-config`로 설정을 다시 생성해 해당 Stop 핸들러를 갱신하고 검토·신뢰 등록합니다.

코드를 변경한 경우 다음 자동 테스트를 실행합니다. 운영체제별 명령 실행과 실제 대화 확인은 각 안내를 따릅니다.

```sh
node --test hooks/code-quality-review/codex/codex-code-quality-review.test.mjs hooks/code-quality-review/gemini/gemini-code-quality-review.test.mjs
```

해제할 때는 Codex의 해당 Stop 핸들러 또는 Antigravity의 `ai-setting-code-quality-review` 키만 비활성화하거나 제거합니다. 시크릿 검사 등 다른 훅과 기존 기능 설정을 유지합니다.

공식 계약: [Codex Hooks](https://learn.chatgpt.com/docs/hooks), [Antigravity Hooks](https://antigravity.google/docs/hooks).
