# Codex·Antigravity 사용자 입력의 시크릿 검사

API 키나 토큰을 실수로 채팅에 붙여 넣었을 때 사용자 입력을 Gitleaks로 검사하는 로컬 훅입니다.
Codex는 모델 전송 전에 요청을 차단하며, Antigravity는 모델에 보안 경고를 주입합니다.
Antigravity의 경고 주입은 모델 전송을 차단하지 않으므로 모델이 비밀값을 받지 않는다고 보장할 수 없습니다.
Gitleaks의 기본 탐지 규칙을 사용하며 별도 LLM 호출이나 키의 유효성 확인 요청은 하지 않습니다.

## 입력과 차단 동작

- **Codex**: 사용자 입력 → Codex의 `UserPromptSubmit` → 로컬 Gitleaks 검사 → 통과 또는 차단 순서로 실행합니다.
- **Antigravity**: 사용자 입력 → Antigravity의 `PreInvocation` → 로컬 Gitleaks 검사 순서로 실행합니다.

- 탐지 결과가 없으면 모델 문맥이나 사용자 안내를 추가하지 않고 통과합니다.
  Codex는 출력 없이 종료하고, Antigravity는 빈 주입 응답을 반환합니다.
- 시크릿 후보 또는 검사 오류가 있으면 Codex는 요청을 차단하고 Antigravity는 보안 경고를 주입합니다.
  가짜 예제라도 탐지 규칙에 맞으면 같은 처리를 받습니다.
- Gitleaks 미설치, 실행 오류, 5초 시간 초과도 검사 오류로 처리합니다.
- Codex는 잘못된 훅 입력도 차단합니다. Antigravity는 훅 입력·대화 기록을 읽거나 해석하지 못하면 경고 없이 진행합니다.
- 차단 안내와 경고에는 입력 원문, 시크릿 값, Gitleaks 로그를 포함하지 않습니다.

검사 입력은 프로세스의 표준 입력으로 전달하며 셸 명령 인자나 임시파일로 저장하지 않습니다.
원문 대신 탐지 여부만 사용하고, Gitleaks의 출력과 로그는 폐기합니다.
`gitleaks:allow` 주석으로 검사를 건너뛸 수 없습니다. 프로젝트별 Gitleaks 설정·예외 파일 대신 `gitleaks.toml`의 검사 설정을 사용합니다.

## 파일 구성

```text
hooks/prompt-secret-checker/
├── codex/
│   └── codex-secret-checker.mjs
├── gemini/
│   └── gemini-secret-checker.mjs
├── secret-checker.mjs       # 공통 검사기와 차단 사유
├── gitleaks.toml            # 공통 탐지 규칙
└── README.md
```

두 도구(Codex, Gemini/Antigravity)가 같은 공통 검사 함수와 설정을 사용합니다.
`gitleaks.toml`은 Gitleaks의 기본 탐지 규칙을 불러오는 공통 설정입니다.

## 설치와 설정

운영체제별 설치·설정 생성·전역 등록·재시작 절차는 아래 문서를 따릅니다.

- [macOS 설정 안내](README.macos.md)
- [Windows 설정 안내](README.windows.md)

Node.js 22 이상과 `stdin` 명령을 지원하는 Gitleaks가 필요합니다. Gitleaks 8.30.1로 검증했습니다.
공식 설치 방법은 [Gitleaks 프로젝트](https://github.com/gitleaks/gitleaks#installing)를 참고하세요.
Linux에서는 공식 릴리스나 해당 운영체제의 설치 방법을 사용하며, 실행은 아직 검증하지 않았습니다.
검사기는 PATH 또는 `AI_SETTING_GITLEAKS_BIN`으로 지정한 절대 경로에서 Gitleaks를 찾습니다.
이 환경변수는 비밀값을 담는 용도가 아닙니다.

## 검증

테스트 파일은 저장소에 상시 보관하지 않습니다. 변경 시 필요한 테스트를 임시 파일로 작성해 실행하고,
검증 후 임시 파일을 삭제합니다. 실제로 확인한 범위와 확인하지 못한 부분은 작업 결과에 기록합니다.
검사 동작을 변경할 때는 정상 입력, 탐지, 비밀값 비노출과 검사 실패 시 차단을 확인합니다.
실제 인증 키 대신 가상의 문자열을 사용합니다.

실제 Codex 적용 후에는 정상 문장의 통과와 가상 토큰 입력의 차단을 새 세션에서 확인하세요.
검사기 경로를 존재하지 않는 경로로 바꾼 세션에서도 요청이 차단되는지 확인한 뒤 원래 경로로 복구하세요.

Windows의 실제 적용·검증 기록은 [Windows 설정 안내](README.windows.md#프롬프트-훅-검증-기록)에 기록했습니다.

## 적용 범위와 한계

이 훅은 사용자가 제출한 텍스트만 검사합니다. 파일 첨부, 도구 실행 결과, 이전 대화,
자동으로 읽은 파일과 이후의 모든 LLM 요청을 검사하지는 않습니다.
Gitleaks 규칙이 모르는 형식이나 특징 없는 짧은 비밀번호는 놓칠 수 있습니다.
원문의 마스킹, 자동 수정, 별도 저장은 하지 않습니다. 에이전트 자체의 대화 기록·동기화 정책은 별개입니다.

Codex는 검사 중 발생한 오류를 명시적 차단 JSON으로 바꿉니다. 다만 Node가 없어 훅 자체가 시작되지 않거나,
신뢰가 필요한 훅을 승인하지 않았거나, 훅을 끄거나, 에이전트가 훅 프로세스를 먼저 강제 종료하는 상황은
이 스크립트가 제어할 수 없습니다. **모든 실행 환경에서 실패 시 차단을 보장하는 보안 경계는 아닙니다.**
두 도구의 훅 제한은 15초이고 검사기는 5초에 종료해, 검사 시간 초과를 처리할 여유를 둡니다.

공식 동작은 [Codex 훅 문서](https://learn.chatgpt.com/docs/hooks#userpromptsubmit)와
[훅 신뢰 등록](https://learn.chatgpt.com/docs/hooks#review-and-trust-hooks)을 참고하세요.
Antigravity 훅 설정과 동작은 [Antigravity 훅 문서](https://antigravity.google/docs/hooks)를 참고하세요.
