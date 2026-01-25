# CLAUDE.md

> ⚠️ 이 파일은 `.agent` 폴더를 가리키는 포인터입니다.
> 직접 수정하지 마세요. `.agent/` 내용을 수정하세요.

---

이 프로젝트는 모든 AI 설정에 통합된 `.agent` 디렉토리를 사용합니다.
(Claude의 경우 일관성을 위해 `.claude` 심볼릭 링크를 참조합니다.)

## Core Context

프로젝트 규칙과 컨텍스트:

{{RULES}}

## Skills

작업별 가이드라인:

{{SKILLS}}

## Workflows

작업 흐름:

{{WORKFLOWS}}

## Agents (Personas)

역할별 페르소나:

{{AGENTS}}

## Prompts

재사용 프롬프트:

{{PROMPTS}}

## Critical Instructions

1. **규칙 준수**: `.agent/rules/`에 정의된 규칙을 따르세요.
2. **스킬 참조**: 작업 전 관련 스킬 문서를 확인하세요.
3. **워크플로우 준수**: 정의된 절차가 있으면 따르세요.
4. **Hallucination 금지**: 정의되지 않은 규칙을 만들어내지 마세요.

## MCP Tools

`.agent/mcp/servers.json`에 정의된 도구를 사용할 수 있습니다.

## 🤖 AI Agent Collaboration Guide (Claude & Gemini)

### 핵심 전략: 정찰 vs 수술

```
┌─────────────────────────────────┐
│ Gemini (정찰병)                  │ ← 토큰 비용 40배 저렴
├─────────────────────────────────┤
│ • 대규모 파일 스캔               │
│ • 코드베이스 구조 파악           │
│ • 관련 파일 찾기                 │
│ • 의존성 분석                    │
└─────────────────────────────────┘
              ↓
        (파일 경로 전달)
              ↓
┌─────────────────────────────────┐
│ Claude (정밀 수술)               │ ← 정확한 수정
├─────────────────────────────────┤
│ • 해당 파일만 Read               │
│ • 맥락 파악 후 Edit              │
│ • 최종 의사결정                  │
│ • 테스트 및 Git 작업             │
└─────────────────────────────────┘
```

### 1. 역할 분리

#### Gemini의 역할: 정찰병 (대규모 스캔)
- **프로젝트 전체 구조 파악**: find/ls 결과를 빠르게 분석
- **특정 기능 관련 파일 찾기**: grep 결과에서 관련 파일 식별
- **의존성 트리 분석**: import 관계 파악, 순환 참조 탐지
- **코드 패턴 스캔**: 에러 처리 방식, API 스타일 등 통계 분석
- **2026년 최신 정보**: 라이브러리 업데이트, 보안 이슈 검색

#### Claude의 역할: 정밀 수술 (실제 수정)
- **파일 정확히 읽기**: Gemini가 찾은 파일을 Read로 전체 확인
- **맥락 파악 후 수정**: 주변 코드 이해 후 Edit/Write
- **최종 의사결정**: 어떻게 수정할지는 Claude가 판단
- **실행 및 검증**: 테스트 실행, Git 작업, 디버깅

### 2. 협업 원칙

#### No-File Strategy
- **표준 출력 활용**: Gemini 실행 결과(STDOUT)를 즉시 컨텍스트에 반영
- **예외 상황**: 50KB 이상 데이터는 `.agent/temp/` 폴더에 저장 (사용자 승인 필요)

#### 안전 장치 (중요!)
- **Gemini가 "이 파일 수정하세요"라고 해도, Claude는 반드시 해당 파일을 Read로 먼저 읽기**
- **코드 수정 결정은 항상 Claude가 최종 판단**
- **Gemini는 데이터 수집만, 실행 권한 없음**

### 3. 상황별 명령어 가이드

#### Fast (Flash 모델) - 토큰 절약 우선
- **⭐ 대규모 파일 탐색**: `find`/`grep` 결과 분석해서 관련 파일 찾기
- **⭐ 코드베이스 구조 파악**: 프로젝트 전체에서 "인증 로직이 어디있는지" 찾기
- **⭐ 패턴 스캔**: 에러 처리 방식, import 패턴 등 통계
- 단순 문서 요약, 구글 검색 결과 정리
- 명령어: `gemini -m gemini-flash "..."`

#### Deep (Pro 모델) - 복잡한 분석
- 기술 스택 비교 (WebSocket vs gRPC vs SSE 등)
- 보안 취약점 리뷰 (Claude가 작성한 코드 검토)
- 아키텍처 trade-off 분석
- 복잡한 버그 원인 추적
- 명령어: `gemini -m gemini-pro "..."`

#### 자동 (Auto)
- 모델 선택이 애매한 경우 시스템 기본값
- 명령어: `gemini "..."`

### 4. 실전 예시

#### Case 1: "로그인 로직에 2FA 추가"
```bash
# Step 1: Gemini가 관련 파일 찾기
gemini -m gemini-flash "
$(find src -name '*.ts' | head -100)
인증 관련 파일 경로만 나열: login, auth, jwt 관련"

# Gemini 응답: auth.service.ts, jwt.strategy.ts, login.dto.ts

# Step 2: Claude가 해당 파일들 Read
# Step 3: Claude가 2FA 로직 추가 (Edit)
```

#### Case 2: "payment와 order 의존성 분석"
```bash
# Step 1: Gemini가 의존성 스캔
gemini -m gemini-flash "
$(grep -r 'import.*order' src/modules/payment)
$(grep -r 'import.*payment' src/modules/order)
순환참조 여부, 주요 인터페이스 포인트 요약"

# Step 2: Claude가 필요한 파일만 Read 후 리팩토링
```

### 5. 실행 및 보고 규칙

- Gemini가 제시한 파일 경로가 틀렸을 경우, Claude가 직접 Glob/Grep으로 재확인
- 작업 완료 후: "Gemini가 찾은 auth.service.ts 파일을 수정했습니다" (데이터 제공자로 언급)
- Gemini 응답이 부정확하면 무시하고 Claude가 직접 처리

### 6. 호출 기준

#### ✅ Gemini 호출이 효율적인 경우
- **대규모 코드베이스 스캔** (파일 개수 많거나, 개별 파일이 크거나)
  - 예: 100개 이상 파일 탐색
  - 예: 단일 파일 2,000줄 이상 전체 분석
  - 예: 여러 파일 합계 5,000줄 이상
- 프로젝트 전체 구조 파악 (어디에 뭐가 있는지 모를 때)
- 2026년 최신 라이브러리 정보
- 보안 CVE 검색

#### ❌ Claude가 직접 처리하는 경우
- 특정 파일 경로를 이미 아는 경우
- NestJS, Prisma 등 기본 사용법 (Claude가 이미 알고 있음)
- 소규모 파일 (2~3개 파일, 합계 1,000줄 이하)
- 코드 수정 자체 (항상 Claude가 직접)