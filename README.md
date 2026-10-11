# AI Setting

여러 기기에서 사용하는 AI 코딩 에이전트의 공통 지침을 관리하는 개인 저장소입니다.
지침의 원본을 한곳에서 수정하고, 각 기기에 최신 내용을 반영하기 위해 사용합니다.

## 현재 구성

```text
ai-setting/
├── AGENTS.md     # 전역 공통 지침의 원본
├── README.md     # 저장소 목적과 사용 방법
├── hooks/
│   ├── prompt-secret-checker/  # Codex·Antigravity 사용자 입력 검사
│   └── commit-secret-checker/  # 전역 Git 커밋 시크릿 검사
└── .gitignore    # 로컬 환경파일과 생성 파일 제외
```

공통 지침은 `AGENTS.md` 하나로 관리합니다. 스킬, MCP, 도구별 설정과 플러그인은 실제로 추가할 때 필요한 구조를 마련합니다.

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

## 새 기기에서 사용하기

Git과 이 private 저장소에 접근할 수 있는 GitHub 인증을 준비한 뒤, 원하는 작업 폴더에서 실행합니다.

```powershell
git clone https://github.com/leejh96/AI-Setting.git ai-setting
cd ai-setting
```

사용 중인 도구가 실제로 읽는 전역 지침 경로를 확인하고, 기존 파일이 있으면 백업한 뒤 이 저장소의 `AGENTS.md` 내용을 반영합니다.
파일명과 적용 경로는 해당 도구가 지원하는 방식에 맞춥니다. 이후 도구에서 지침을 다시 불러오거나 새 세션을 시작하고, 반영된 내용을 확인합니다.

현재 자동 설치·동기화 스크립트는 없습니다. 저장소를 받는 것만으로 다른 프로젝트나 도구의 전역 지침이 자동 갱신되지는 않습니다.

## 지침 갱신하기

수정 전에는 작업 중인 변경을 확인하고 최신 내용을 받습니다.

```powershell
git status
git pull --ff-only
```

`AGENTS.md`를 수정하고 변경 내용을 검토한 뒤 커밋·푸시합니다.

```powershell
git diff -- AGENTS.md
git add AGENTS.md
git commit -m "Update agent guidelines"
git push
```

다른 기기에서는 최신 내용을 받은 뒤, 위와 같은 방법으로 각 도구의 전역 지침에 다시 반영합니다.

## 저장소에 포함할 내용

공통 지침과 환경을 재구성하는 데 필요한 설정 템플릿·문서를 관리합니다.
인증 토큰, API 키, 계정 인증 파일, 설치 캐시, 기기별 비밀 설정은 커밋하지 않습니다.
