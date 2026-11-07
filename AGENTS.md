# AI-Setting 저장소 작업 지침

이 저장소는 여러 기기에 배포할 전역 지침·스킬·훅의 원본을 관리합니다.

## 지침과 원본의 구분

- 루트 `AGENTS.md`는 이 저장소의 프로젝트 지침입니다. 다른 프로젝트나 도구의 전역 지침으로 복사하지 않습니다.
- `global/AGENTS.md`는 전역 동기화용 원본입니다. 전역 지침을 수정·동기화할 때 이 파일을 사용하고, 저장소 전용 경로·설치 규칙을 섞지 않습니다.
- 전역 지침은 도구가 실제로 읽는 파일명·위치를 확인해 반영합니다. 현재 Codex는 `~/.codex/AGENTS.md`, Antigravity는 `~/.gemini/GEMINI.md`를 사용합니다. 전역 동기화 요청 없이 설치된 지침을 덮어쓰지 않습니다.
- `skills/`와 `hooks/`는 배포 원본입니다. 설치본만 고쳐 원본과 다르게 남기지 않습니다.

## 스킬 설치·동기화

- 스킬을 설치하거나 갱신할 때 README에서 스킬별 배포 대상을 확인합니다. Codex와 Antigravity를 함께 동기화하는 경우에도 각 도구에 해당하는 스킬만 복사합니다.
- `skills/antigravity-worker/`는 Codex 전용입니다. Codex 설치·갱신에 포함하고 Antigravity 스킬 동기화에서는 제외합니다.

## Codex·Antigravity 훅 설치·갱신

- 전역 훅 코드는 각 도구의 사용자 디렉터리에 실제 파일로 복사합니다. 저장소의 스크립트를 직접 실행하도록 등록하거나 심볼릭 링크로 연결하지 않습니다.
- Codex 설치 기준은 `~/.codex/hooks/<훅 이름>/`, 등록 파일은 `~/.codex/hooks.json`입니다. `CODEX_HOME`을 별도로 사용하면 해당 홈을 기준으로 합니다.
- Antigravity 설치 기준은 `~/.gemini/config/hooks/<훅 이름>/`, 등록 파일은 `~/.gemini/config/hooks.json`입니다. Gemini CLI 설정과 혼동하지 않습니다.
- 설치·동기화가 요청된 범위에서 원본을 수정·검증한 뒤 공통 모듈·워커·규칙 파일·`REVIEW.md`와 해당 도구의 어댑터를 상대 경로 구조 그대로 복사합니다. 테스트·개발 문서·반대 도구 어댑터는 런타임 설치 대상에서 제외합니다.
- 설정은 복사한 어댑터의 `--print-config`로 생성하고 기존 항목에 병합합니다. 다른 훅·이벤트·옵션·활성화 상태를 보존하고 중복 등록하지 않습니다.
- 훅을 추가하거나 갱신할 때 역할이 드러나는 이름을 사용합니다. Codex는 핸들러의 실행 상태 문구(`statusMessage`)를 지정하고, Antigravity는 역할별로 고유한 그룹 키를 사용합니다. 기존 그룹의 키는 활성화 설정을 유지하도록 보존합니다.
- 변경 전 설정 전체와 기존 설치본을 복구할 수 있게 준비하고, 설치본에 별도 수정이 있으면 대조합니다. 복구용 사본은 저장소 밖에 접근 권한을 보호해 보관합니다.
- 복사 후 원본과 설치본의 파일 내용, 생성된 명령과 등록 경로를 확인하고 설치본으로 필요한 검증을 수행합니다. 저장소 경로 의존성과 빠진 상대 경로 의존성이 없어야 합니다.
- Codex 훅의 정의를 변경한 후에는 공식 훅 관리 기능으로 신뢰를 다시 등록합니다. 신뢰 해시를 수동 조작하거나 검토 우회 옵션을 일상 설정에 넣지 않습니다. 등록·신뢰·실제 실행 확인을 구분해 보고합니다.
- 원본을 수정하거나 Git pull한 것만으로 설치본이 갱신되지는 않습니다. 적용 요청 시 다시 복사·설정 생성·등록·검증합니다.
- Git 전역 `pre-commit` 훅은 위 두 도구와 별도 설치 대상입니다. `core.hooksPath`와 기존 훅을 확인하고 해당 설치 요청 범위에서만 변경합니다.

## 검증과 안내

- Node.js 22 이상을 사용합니다. 각 훅의 동작·설치·검증은 `hooks/<훅 이름>/README.md`와 해당 운영체제 README를 확인합니다.
- 품질 검토 훅의 회귀 테스트는 저장소 루트에서 다음과 같이 순차 실행합니다.

```sh
node --test --test-concurrency=1 hooks/code-quality-review/review-status.test.mjs hooks/code-quality-review/review-changes.test.mjs hooks/code-quality-review/codex/codex-code-quality-review.test.mjs hooks/code-quality-review/gemini/gemini-code-quality-review.test.mjs
```

- 실행 코드·지침의 배치를 바꾸면 README의 원본 위치·복사 대상·설정 생성 명령도 함께 맞춥니다.
- 기기별 생성 설정, 인증정보, 설치 백업과 일회성 검증 산출물은 커밋하지 않습니다. 검증 실패·미실행과 재시작·신뢰 등록이 남은 상태는 완료로 보고하지 않습니다.
