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
│   ├── agents-md-optimizer/   # AGENTS.md 최적화와 전후 비교
│   ├── decision-table-dev/    # 업무 분기를 표로 정리하고 구현·테스트에 연결
│   ├── root-cause-debugging/  # 불명확·반복 실패의 원인 분리와 최소 수정
│   └── technical-research/    # 공식 근거와 적용 조건을 대조하는 기술 조사
└── .gitignore    # 로컬 환경파일과 생성 파일 제외
```

공통 지침은 `AGENTS.md` 하나로 관리합니다. 스킬 원본은 `skills/`에서 관리합니다. MCP, 도구별 설정과 플러그인은 실제로 추가할 때 필요한 구조를 마련합니다.

전역 지침은 사용자가 밝힌 목적과 후속 정정을 유지하며, 선택이 필요한 경우에만 근거·차이를 담은 선택지로 질문하도록 합니다. 구현에 필요한 변경 위치·계약·영향·검증 방법이 판단되면 추가 탐색을 멈추고 실행합니다. 큰 요청은 범위와 순서를 짧게 정리하되 이미 확정된 내용을 별도 인터뷰나 계획 승인으로 다시 확인하지 않습니다.

## AGENTS.md 최적화 스킬

[`agents-md-optimizer`](skills/agents-md-optimizer/SKILL.md)는 전역 지침과 프로젝트 지침을 각각의 적용 범위에 맞게 평가·수정하고, 요청받으면 프로젝트 지침을 처음 작성합니다. 전역 지침은 여러 프로젝트에서 공통으로 쓸 수 있는지, 프로젝트 지침은 해당 저장소의 작업 방법과 제약을 정확히 담고 있는지 확인합니다. 규칙을 삭제하거나 완화하면 어떤 행동이 달라지는지 설명하며, 분석이나 수정안만 요청하면 원본을 바꾸지 않습니다. 파일 크기 비교 도구와 실제 작업 비교 방법을 제공하고, 글자 수가 줄었다는 이유만으로 모델 성능이 좋아졌다고 판단하지 않습니다.

초기 작성에서는 확인된 사용자 용어와 실제 코드 이름, 주요 책임 경계, 작업별 실행·검증 명령과 제약을 정리합니다. 프로젝트에 공통 규칙이나 반복되는 코드·문서 틀이 있으면 생성·수정 시 적용 범위·예외·대표 경로를 유지하며, 축약이나 중복 제거를 이유로 임의로 바꾸지 않습니다. 상세 문서는 필요한 때 읽도록 연결하고, 저장소 루트의 파일이 전역 배포용 원본이면 프로젝트 정보로 덮어쓰지 않습니다. 명령의 존재 확인과 실제 실행 성공도 구분합니다.

같은 스킬을 Codex와 Antigravity에 각각 전역 등록할 수 있습니다. 이 환경에서 사용하는 설치 위치와 호출 방법은 다음과 같습니다.

| 도구 | 전역 설치 위치 | 명시적 호출 |
| --- | --- | --- |
| Codex | `~/.codex/skills/agents-md-optimizer` | `$agents-md-optimizer` |
| Antigravity | `~/.gemini/config/skills/agents-md-optimizer` | `/agents-md-optimizer` |

Codex와 Antigravity 모두 저장소의 스킬 폴더를 각 전역 설치 위치에 직접 복사합니다. 심볼릭 링크는 사용하지 않습니다. 저장소 원본을 수정한 뒤에는 두 설치 위치에 다시 복사해야 반영됩니다. 기존 항목을 교체하기 전에는 별도 수정 여부를 확인하고 복구할 수 있도록 백업하세요. 저장소를 받는 것만으로 전역에 설치되지는 않습니다.

Codex의 최신 공식 문서는 사용자 스킬 위치로 `~/.agents/skills`를 안내합니다. 새 환경에서는 실제 지원 경로를 확인하고 한 곳에만 등록해 중복 노출을 피하세요. 위 Codex 경로는 현재 설치에서 사용하는 호환 경로입니다. [Codex 공식 안내](https://developers.openai.com/codex/skills), [Antigravity 공식 안내](https://antigravity.google/docs/skills?app=antigravity).

등록 후 새 세션에서 `$agents-md-optimizer 이 AGENTS.md의 최적화안을 만들어줘`처럼 요청할 수 있습니다. 실제 지침 수정과 다른 도구로의 동기화는 요청 범위를 따릅니다.

- 전역: `$agents-md-optimizer 전역 AGENTS.md를 여러 프로젝트에서 쓰기 좋게 최적화해줘`
- 프로젝트: `$agents-md-optimizer 이 프로젝트 AGENTS.md를 최적화해줘. 전역 지침은 참고만 해줘`
- 초기 작성: `$agents-md-optimizer 이 저장소의 확인된 용어·실행 명령·제약으로 프로젝트 AGENTS.md를 만들어줘`
- 함께: `$agents-md-optimizer 전역과 이 프로젝트 지침을 함께 보고 중복·충돌과 수정안을 설명해줘`

## 원인 추적 디버깅 스킬

[`root-cause-debugging`](skills/root-cause-debugging/SKILL.md)는 원인이 불명확하거나 수정 후 반복되는 버그·테스트 실패·실행 오류를 다룹니다. 재현 조건과 관련 경로를 확인하고 코드·의존성·권한·외부 서비스의 원인을 구별할 작은 확인을 선택합니다. 근거 없는 여러 수정을 한꺼번에 적용하거나 같은 실패 명령을 반복하지 않으며, 수정 요청이면 최소 수정 후 원래 실패 경로와 중요한 영향을 검증합니다.

원인이 명백한 단순 오류에는 긴 절차를 강제하지 않습니다. 분석 요청만으로 코드를 바꾸지 않고, 권한·인증 검사를 꺼서 우회하지 않으며, 근거가 부족하면 미확인 사항과 다음 확인을 제시합니다. 별도 패키지나 MCP 서버는 요구하지 않습니다.

Codex는 `~/.codex/skills/root-cause-debugging`, Antigravity는 `~/.gemini/config/skills/root-cause-debugging`에 같은 복사 방식으로 설치·갱신합니다. 새 환경에서는 위의 경로 확인·백업·중복 방지 원칙을 따릅니다.

- Codex: `$root-cause-debugging 이 테스트 실패의 원인을 좁히고 최소 수정 후 같은 경로로 검증해줘`
- Antigravity: `/root-cause-debugging 이 실행 오류의 원인만 분석해줘. 코드는 수정하지 마`

## 결정 테이블 기반 구현·테스트 스킬

[`decision-table-dev`](skills/decision-table-dev/SKILL.md)는 조건에 따라 결과가 갈리는 백엔드 API와 비즈니스 로직을 다룹니다. 코드 작성 전에 조건과 기대 결과를 정리한 결정 테이블(Decision Table)을 만들고, 권한·입력·상태·외부 연동에 따른 반환 결과와 데이터 변경을 확인합니다.

미확정 업무 규칙은 질문으로 분리하고, 확정된 분기는 구현과 테스트에 연결합니다. 차단 조건은 상태 변경이나 외부 호출 전에 처리하도록 검사 순서를 확인하며, 테스트는 반환 결과와 부수효과를 함께 검증합니다. 설계·분석·리뷰만 요청하면 코드를 수정하지 않습니다. 분기 없는 단순 조회나 업무 결과에 영향을 주지 않는 문구·설정 변경에는 사용하지 않습니다.

| 도구 | 전역 설치 위치 | 명시적 호출 |
| --- | --- | --- |
| Codex | `~/.codex/skills/decision-table-dev` | `$decision-table-dev` |
| Antigravity | `~/.gemini/config/skills/decision-table-dev` | `/decision-table-dev` |

이 스킬도 위의 AGENTS.md 최적화 스킬과 같은 복사 방식으로 설치·갱신합니다. 예를 들어 `$decision-table-dev 이 API의 권한·상태별 분기를 정리하고 구현과 테스트에 반영해줘`처럼 요청합니다.

## 기술 조사 스킬

[`technical-research`](skills/technical-research/SKILL.md)는 여러 프로젝트에서 공식 근거 확인, 기술 선택, 버전 호환성과 상충하는 기술 주장을 조사하는 전역 스킬의 원본입니다. 특정 저장소 구조나 오케스트레이션 스킬에 의존하지 않습니다. Context7을 사용할 수 있으면 라이브러리 문서 조사에 우선 활용하고, 사용할 수 없거나 근거가 부족하면 공식 문서·릴리스 노트·소스로 확인합니다.

단순 조회에는 짧게 답하고, 버전·구성요소 조합이 결론에 영향을 줄 때만 호환성을 조사합니다. 공식 지원 여부와 실제 실행 확인을 구분하고, 결론에 근거와 적용 조건을 연결합니다. 조사만 요청하면 코드·설정을 바꾸지 않으며, 사용자 요청이나 프로젝트 작업 규칙이 있을 때만 조사 문서를 기록합니다.

이 스킬도 위의 스킬과 같은 복사 방식으로 전역 설치·갱신합니다. Codex의 현재 설치에서 사용하는 호환 경로는 `~/.codex/skills/technical-research`, Antigravity 경로는 `~/.gemini/config/skills/technical-research`입니다. 새 환경에서는 각 도구가 지원하는 경로를 확인하고 중복 등록을 피하세요. 저장소에 원본을 추가하는 것만으로 전역 설치되지는 않습니다.

- Codex: `$technical-research 현재 프로젝트의 클라이언트와 서버 버전이 공식 지원 조합인지 조사해줘`
- Antigravity: `/technical-research 이 라이브러리의 공식 지원 환경과 선택 시 제약을 조사해줘`

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
아래 예시는 다른 파일의 스테이징된 변경을 보존하면서 `AGENTS.md`의 작업 트리 변경 전체만 커밋합니다. 이 파일을 부분 스테이징했거나 커밋하지 않을 변경이 있다면 이 예시를 그대로 실행하지 말고 커밋할 변경을 먼저 분리합니다.

```sh
git diff HEAD -- AGENTS.md
git commit --only -m "docs: 전역 에이전트 지침 갱신" -- AGENTS.md
git push
```

다른 기기에서는 최신 내용을 받은 뒤, 위와 같은 방법으로 각 도구의 전역 지침에 다시 반영합니다.

## 저장소에 포함할 내용

공통 지침과 환경을 재구성하는 데 필요한 설정 템플릿·문서를 관리합니다.
인증 토큰, API 키, 계정 인증 파일, 설치 캐시, 기기별 비밀 설정은 커밋하지 않습니다.
