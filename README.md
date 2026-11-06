# AI Setting

여러 기기에서 사용하는 AI 코딩 에이전트의 공통 지침을 관리하는 개인 저장소입니다.
지침의 원본을 한곳에서 수정하고, 각 기기에 최신 내용을 반영하기 위해 사용합니다.

## 현재 구성

```text
ai-setting/
├── AGENTS.md     # 이 저장소의 작업·설치 규칙
├── global/
│   └── AGENTS.md # 전역 동기화용 지침 원본
├── README.md     # 저장소 목적과 공통 안내
├── hooks/
│   ├── prompt-secret-checker/  # 사용자 입력 검사와 OS별 README
│   ├── commit-secret-checker/  # Git 커밋 검사와 OS별 README
│   └── code-quality-review/    # Codex·Gemini 품질 검토와 OS별 README
├── skills/
│   ├── agents-md-editor/   # AGENTS.md 최적화와 전후 비교
│   ├── concept-explainer/    # 질문에 필요한 개념과 예시 설명
│   ├── decision-table/    # 업무 분기를 표로 정리하고 구현·테스트에 연결
│   ├── dev-checklist/         # 개발 작업의 진행 상태와 완료 조건 관리
│   ├── bug-diagnosis/  # 불명확·반복 실패의 원인 분리와 최소 수정
│   ├── tech-research/    # 공식 근거와 적용 조건을 대조하는 기술 조사
│   └── antigravity-worker/ # Antigravity에 작업을 위임하고 Codex에서 검토
└── .gitignore    # 로컬 환경파일과 생성 파일 제외
```

전역 공통 지침은 `global/AGENTS.md`로 관리하며, 루트 `AGENTS.md`는 이 저장소에만 적용합니다. 스킬 원본은 `skills/`에서 관리합니다. MCP, 도구별 설정과 플러그인은 실제로 추가할 때 필요한 구조를 마련합니다.

## 지침·스킬·훅의 역할

| 위치 | 관리할 내용 |
| --- | --- |
| `global/AGENTS.md` | 항상 적용할 협업·권한·작업 보존·요구사항 확인·완료·응답 원칙 |
| `skills/*/SKILL.md` | 작업에 맞춰 선택할 조건과 해당 작업의 전문 절차 |
| `hooks/code-quality-review/REVIEW.md` | 파일 변경 후 산출물·품질 점검, 수정·재검토와 종료 판정 |
| 시크릿 검사 훅 | 사용자 입력과 Git 커밋이라는 각 경계의 자동 검사·차단 또는 경고 |

전역지침에 특정 스킬을 확인·호출하라는 목록을 두지 않습니다. 스킬은 각 `SKILL.md`의 `name`·`description`에 담긴 적용 조건으로 자동 선택할 수 있게 구성합니다. 사용자는 평소처럼 작업을 요청하며, 명시적 호출은 특정 스킬을 직접 지정하고 싶을 때 사용하는 선택 사항입니다. 자동 선택 허용은 매 요청에서의 선택이나 올바른 수행을 보장하지 않습니다.

전역지침의 구현·작업 보존 원칙은 스킬 선택이나 훅 실행 여부와 관계없이 유지합니다. 스킬은 작업별 실행 방법을, 품질 검토 훅은 변경 결과의 점검 방법을 다룹니다. 독립 배포에 필요한 적용 범위·권한 경계는 각 구성요소에도 짧게 유지합니다.

## 스킬과 적용 조건

| 스킬 | 자동 선택할 작업 | 전문 절차 |
| --- | --- | --- |
| [agents-md-editor](skills/agents-md-editor/SKILL.md) | 전역·프로젝트 지침 평가·최적화·초기 작성 | 적용 범위·의미·예외 보존, 독립 최종 검토, 요청 시 크기·실행 비교 |
| [concept-explainer](skills/concept-explainer/SKILL.md) | 개념 질문, 전략·기획·조사 이해에 필요한 설명 | 용어·필요성·쉬운 예시와 핵심 동작 연결 |
| [dev-checklist](skills/dev-checklist/SKILL.md) | 기능 구현·수정·버그 수정·리팩터링 | 작업별 상태와 완료 조건·검증 추적, 단순 작업은 목록 생략 |
| [bug-diagnosis](skills/bug-diagnosis/SKILL.md) | 원인이 불명확하거나 수정 후 반복되는 실패 | 가설을 구별할 증거 수집, 최소 수정, 원래 실패 경로 검증 |
| [decision-table](skills/decision-table/SKILL.md) | 결과가 갈리는 분기가 2개 이상인 백엔드 API·비즈니스 로직 | 조건·결과·부수효과의 결정 테이블을 구현·테스트에 연결 |
| [tech-research](skills/tech-research/SKILL.md) | 공식 근거·기술 선택·호환성·상충하는 기술 주장 조사 | 관련 코드와 공식 원문·버전 대조, 사실·추론·실행 확인 구분 |
| [antigravity-worker](skills/antigravity-worker/SKILL.md) | Codex에서 Antigravity를 실행 워커로 위임 | Windows·macOS 별도 터미널, 작업 종료 감지, Codex 검토 |

여러 스킬의 적용 조건이 겹치면 각 전문 절차를 필요한 범위에서 함께 사용합니다. 예를 들어 복잡한 버그 수정은 진행 상태를 추적하면서 원인을 좁힐 수 있고, 업무 분기가 바뀌면 결정 테이블로 확인할 수 있습니다. 같은 계획·조사·검증 결과는 공유하고 중복 작성·실행하지 않습니다.

## 스킬 설치·갱신

아래는 현재 환경에서 사용하는 설치 경로입니다. `<스킬 이름>`에 위 표의 폴더 이름을 사용합니다.

| 도구 | 전역 설치 위치 | 선택적인 명시적 호출 |
| --- | --- | --- |
| Codex | `~/.codex/skills/<스킬 이름>` | `$<스킬 이름>` |
| Antigravity | `~/.gemini/config/skills/<스킬 이름>` | `/<스킬 이름>` |

**`antigravity-worker`는 Codex 전용입니다.** Windows와 macOS의 Codex에 설치합니다. 두 에이전트를 함께 동기화할 때도 Antigravity의 스킬 설치 대상에서는 제외합니다. 각 기기에서 Node.js 22 이상과 로그인된 Antigravity CLI가 필요합니다.

저장소의 스킬 폴더 전체를 각 설치 위치에 직접 복사하며 심볼릭 링크는 사용하지 않습니다. 교체 전에는 설치본의 별도 수정 여부를 대조하고 기존 파일 전체를 복구할 수 있게 백업합니다. 원본 수정이나 Git pull만으로 설치본은 갱신되지 않으므로 다시 복사하고 새 세션에서 반영을 확인합니다.

스킬 이름이 바뀌었다면 새 이름의 폴더를 복사하고, 이전 이름의 설치 폴더는 스킬 검색 경로 밖에 복구용으로 보관합니다.

새 환경에서는 실제 지원 경로를 확인하고 한 곳에만 등록해 중복 노출을 피하세요. Codex의 `~/.codex/skills`는 이 환경에서 사용하는 호환 경로이며 공식 안내의 `~/.agents/skills`와 중복 설치하지 않습니다. [Codex 공식 안내](https://developers.openai.com/codex/skills), [Antigravity 공식 안내](https://antigravity.google/docs/skills?app=antigravity).

예를 들어 “이 프로젝트 지침의 중복을 정리해줘”, “이 테스트가 계속 실패하는 원인을 찾고 수정해줘”, “이 라이브러리 조합이 공식 지원되는지 조사해줘”처럼 요청합니다. 명시적으로 지정하려면 Codex의 `$agents-md-editor 이 프로젝트 지침을 최적화해줘`처럼 호출할 수 있습니다. 실제 수정·설치·다른 도구로의 동기화는 각각 요청 범위를 따릅니다.

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
기본 구현 원칙은 `global/AGENTS.md`에 유지하고 상세 점검 절차는 훅의 `REVIEW.md`에서 관리합니다.
동작 범위, 추가 continuation과 사용량, 설치·신뢰 등록·검증은 [코드 품질 검토 훅 안내](hooks/code-quality-review/README.md)를 확인하세요.

## Codex·Antigravity 훅의 복사 설치

훅 실행 코드는 저장소를 직접 참조하지 않고 각 도구의 사용자 디렉터리에 복사합니다. Codex는 `~/.codex/hooks/<훅 이름>/`, Antigravity는 `~/.gemini/config/hooks/<훅 이름>/`를 사용합니다. `CODEX_HOME`을 별도로 지정한 Codex는 설치 경로와 등록 파일 `hooks.json` 모두 해당 홈을 기준으로 합니다.

각 훅의 운영체제별 안내에 따라 필요한 공통 파일과 해당 도구 어댑터를 같은 상대 경로 구조로 복사한 뒤, 설치본의 `--print-config`를 실행합니다. 기존 등록을 해당 명령으로 갱신하고 다른 훅·활성화 상태를 보존합니다. 심볼릭 링크는 사용하지 않으며 테스트·개발 문서는 런타임 설치에서 제외합니다.

원본 변경이나 Git pull만으로 설치본은 갱신되지 않습니다. 설치·동기화 요청 시 다시 복사하고 파일 내용·등록 경로·설치본 동작을 확인합니다. 기존 설정과 별도 수정된 설치본은 복구 가능하게 보존하며, Codex 명령이 바뀌면 공식 훅 관리 기능으로 신뢰를 다시 등록합니다. Git 커밋 훅의 설치는 별도 안내를 따릅니다.

## 새 기기에서 사용하기

Git과 이 private 저장소에 접근할 GitHub 인증을 준비한 뒤, 원하는 작업 폴더에서 실행합니다.

```sh
git clone https://github.com/leejh96/AI-Setting.git ai-setting
cd ai-setting
```

사용 중인 도구가 읽는 전역 지침 경로를 확인하고 기존 파일 전체를 백업한 뒤,
이 저장소의 `global/AGENTS.md`를 도구가 지원하는 파일명과 경로에 반영합니다. 루트 `AGENTS.md`는 전역 동기화하지 않습니다. 새 세션에서 반영된 지침을 확인합니다.
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

`global/AGENTS.md`를 수정하고 변경 내용을 검토한 뒤 커밋·푸시합니다.
아래 예시는 다른 파일의 스테이징된 변경을 보존하면서 `global/AGENTS.md`의 작업 트리 변경 전체만 커밋합니다. 이 파일을 부분 스테이징했거나 커밋하지 않을 변경이 있다면 이 예시를 그대로 실행하지 말고 커밋할 변경을 먼저 분리합니다.

```sh
git diff HEAD -- global/AGENTS.md
git commit --only -m "docs: 전역 에이전트 지침 갱신" -- global/AGENTS.md
git push
```

다른 기기에서는 최신 내용을 받은 뒤, 위와 같은 방법으로 각 도구의 전역 지침에 다시 반영합니다.

## 저장소에 포함할 내용

공통 지침과 환경을 재구성하는 데 필요한 설정 템플릿·문서를 관리합니다.
인증 토큰, API 키, 계정 인증 파일, 설치 캐시, 기기별 비밀 설정은 커밋하지 않습니다.
