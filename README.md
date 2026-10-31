# AI Setting

여러 기기에서 사용하는 AI 코딩 에이전트의 공통 지침을 관리하는 개인 저장소입니다.
지침의 원본을 한곳에서 수정하고, 각 기기에 최신 내용을 반영하기 위해 사용합니다.

## 현재 구성

```text
ai-setting/
├── AGENTS.md     # 전역 공통 지침의 원본
├── README.md     # 저장소 목적과 공통 안내
├── hooks/
│   ├── prompt-secret-checker/  # 사용자 입력 검사와 OS별 README
│   ├── commit-secret-checker/  # Git 커밋 검사와 OS별 README
│   └── code-quality-review/    # Codex·Gemini 품질 검토와 OS별 README
├── skills/
│   └── agents-md-optimizer/   # AGENTS.md 최적화와 전후 비교
└── .gitignore    # 로컬 환경파일과 생성 파일 제외
```

공통 지침은 `AGENTS.md` 하나로 관리합니다. 스킬 원본은 `skills/`에서 관리합니다. MCP, 도구별 설정과 플러그인은 실제로 추가할 때 필요한 구조를 마련합니다.

## AGENTS.md 최적화 스킬

[`agents-md-optimizer`](skills/agents-md-optimizer/SKILL.md)는 전역 지침과 프로젝트 지침을 각각의 적용 범위에 맞게 평가하고 수정합니다. 전역 지침은 여러 프로젝트에서 공통으로 쓸 수 있는지, 프로젝트 지침은 해당 저장소의 작업 방법과 제약을 정확히 담고 있는지 확인합니다. 규칙을 삭제하거나 완화하면 어떤 행동이 달라지는지 설명하며, 분석이나 수정안만 요청하면 원본을 바꾸지 않습니다. 파일 크기 비교 도구와 실제 작업 비교 방법을 제공하고, 글자 수가 줄었다는 이유만으로 모델 성능이 좋아졌다고 판단하지 않습니다.

같은 스킬을 Codex와 Antigravity에 각각 전역 등록할 수 있습니다. 이 환경에서 사용하는 설치 위치와 호출 방법은 다음과 같습니다.

| 도구 | 전역 설치 위치 | 명시적 호출 |
| --- | --- | --- |
| Codex | `~/.codex/skills/agents-md-optimizer` | `$agents-md-optimizer` |
| Antigravity | `~/.gemini/config/skills/agents-md-optimizer` | `/agents-md-optimizer` |

Codex의 현재 설치는 저장소 원본에 연결하며, Antigravity에는 같은 스킬 폴더를 복사합니다. 연결 설치는 원본 변경을 공유하고, 복사 설치는 원본 수정 후 다시 반영해야 합니다. 기존 항목을 임의로 덮어쓰지 말고, 연결 원본을 이동할 때는 연결도 갱신하세요. 저장소를 받는 것만으로 전역에 설치되지는 않습니다.

Codex의 최신 공식 문서는 사용자 스킬 위치로 `~/.agents/skills`를 안내합니다. 새 환경에서는 실제 지원 경로를 확인하고 한 곳에만 등록해 중복 노출을 피하세요. 위 Codex 경로는 현재 설치에서 사용하는 호환 경로입니다. [Codex 공식 안내](https://developers.openai.com/codex/skills), [Antigravity 공식 안내](https://antigravity.google/docs/skills?app=antigravity).

등록 후 새 세션에서 `$agents-md-optimizer 이 AGENTS.md의 최적화안을 만들어줘`처럼 요청할 수 있습니다. 실제 지침 수정과 다른 도구로의 동기화는 요청 범위를 따릅니다.

- 전역: `$agents-md-optimizer 전역 AGENTS.md를 여러 프로젝트에서 쓰기 좋게 최적화해줘`
- 프로젝트: `$agents-md-optimizer 이 프로젝트 AGENTS.md를 최적화해줘. 전역 지침은 참고만 해줘`
- 함께: `$agents-md-optimizer 전역과 이 프로젝트 지침을 함께 보고 중복·충돌과 수정안을 설명해줘`

## Codex·Antigravity 사용자 입력의 시크릿 검사

사용자가 보낸 문장을 Gitleaks로 검사하는 Codex `UserPromptSubmit`과 Antigravity `PreInvocation` 훅을 제공합니다.
Codex는 시크릿 후보나 검사 오류가 있으면 요청을 차단합니다.
Antigravity는 최신 사용자 입력의 검사 결과를 모델에 보안 경고로 전달합니다.
정상일 때는 사용자 안내나 모델 문맥을 추가하지 않습니다.

설치 조건, 설정 생성, 검증 방법과 적용 범위는 [시크릿 검사 훅 안내](hooks/prompt-secret-checker/README.md)를 확인하세요.

## Git 커밋의 시크릿 검사

전역 Git `pre-commit` 훅에서 커밋할 파일을 Gitleaks로 검사합니다.
Codex·Antigravity·직접 터미널 실행에 같은 검사가 적용되며, 프롬프트 검사와 독립된 규칙을 사용합니다.
`git add && git commit`을 그대로 실행할 수 있고, 시크릿 후보가 있거나 검사를 완료하지 못하면 커밋을 차단합니다.
전역 등록과 검사 범위는 [커밋 검사 훅 안내](hooks/commit-secret-checker/README.md)를 확인하세요.

## Codex·Gemini 완료 전 코드 품질 검토

Codex와 Gemini/Antigravity에서 코드 수정 후 요구사항 충족, AI 슬롭, 과잉 설계와 중복 구현을 검토하는 `Stop` 훅을 제공합니다. 문제가 발견되면 수정·검증 후 새 회차에서 다시 검토하며, 수정 없는 검토에서 미해결 문제가 없을 때 종료합니다. 답변·승인 필요나 실행 불가 상황은 사유를 보고하고 멈춥니다.
기본 구현 원칙은 `AGENTS.md`에 유지하고 상세 점검 절차는 훅의 `REVIEW.md`에서 관리합니다.
동작 범위, 추가 continuation과 사용량, 설치·신뢰 등록·검증은 [코드 품질 검토 훅 안내](hooks/code-quality-review/README.md)를 확인하세요.

## 새 기기에서 사용하기

Git과 이 private 저장소에 접근할 GitHub 인증을 준비한 뒤, 원하는 작업 폴더에서 실행합니다.

```sh
git clone https://github.com/leejh96/AI-Setting.git ai-setting
cd ai-setting
```

사용 중인 도구가 읽는 전역 지침 경로를 확인하고 기존 파일 전체를 백업한 뒤,
이 저장소의 `AGENTS.md`를 도구가 지원하는 파일명과 경로에 반영합니다. 새 세션에서 반영된 지침을 확인합니다.
훅 설치와 검증 절차는 각 훅 폴더의 운영체제별 README를 따릅니다.

| 훅 | macOS | Windows |
| --- | --- | --- |
| 프롬프트 시크릿 검사 | [설정 안내](hooks/prompt-secret-checker/README.macos.md) | [설정 안내](hooks/prompt-secret-checker/README.windows.md) |
| Git 커밋 시크릿 검사 | [설정 안내](hooks/commit-secret-checker/README.macos.md) | [설정 안내](hooks/commit-secret-checker/README.windows.md) |
| 코드 품질 검토 | [설정 안내](hooks/code-quality-review/README.macos.md) | [설정 안내](hooks/code-quality-review/README.windows.md) |

현재 자동 설치·동기화 스크립트는 없습니다. 저장소를 받는 것만으로 다른 프로젝트나 도구의 전역 지침과 훅이 자동 적용되지는 않습니다.

## 지침 갱신하기

수정 전에는 작업 중인 변경을 확인하고 최신 내용을 받습니다.

```sh
git status
git pull --ff-only
```

`AGENTS.md`를 수정하고 변경 내용을 검토한 뒤 커밋·푸시합니다.

```sh
git diff -- AGENTS.md
git add AGENTS.md
git commit -m "Update agent guidelines"
git push
```

다른 기기에서는 최신 내용을 받은 뒤, 위와 같은 방법으로 각 도구의 전역 지침에 다시 반영합니다.

## 저장소에 포함할 내용

공통 지침과 환경을 재구성하는 데 필요한 설정 템플릿·문서를 관리합니다.
인증 토큰, API 키, 계정 인증 파일, 설치 캐시, 기기별 비밀 설정은 커밋하지 않습니다.
