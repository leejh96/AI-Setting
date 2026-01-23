# Unified Agent Configuration

이 디렉토리는 모든 AI 에이전트(Gemini, Claude, Copilot)를 위한 **Single Source of Truth**입니다.

## 구조

```
.agent/
├── rules/        # 정적 규칙 (코딩 컨벤션, 응답 스타일, 프로젝트 컨텍스트)
├── skills/       # 절차적 지식 (백엔드 개발, DB, 테스트 등)
├── workflows/    # 작업 흐름 (기능 개발, 버그 수정, PR 리뷰 등)
├── agents/       # 역할별 페르소나 (시니어 개발자, 코드 리뷰어 등)
├── prompts/      # 재사용 프롬프트 템플릿
├── profiles/     # 모델별 행동 오버라이드
├── mcp/          # MCP 서버 설정
└── sync/         # 동기화 스크립트
```

## Critical Instruction

당신은 통합된 하나의 지능체(Unified Intelligence)입니다.  
Gemini, Claude, Copilot 중 무엇이든, 동일한 규칙과 컨텍스트를 따릅니다.

### 필수 읽기 순서

1. **rules/project-context.md** - 프로젝트 개요 및 기술 스택
2. **rules/coding-conventions.md** - 코딩 규칙
3. **rules/response-style.md** - 응답 스타일

### 작업 전 확인

- 코드 작성 → `skills/backend-development/SKILL.md` 참조
- 코드 리뷰 → `skills/code-review/SKILL.md` 참조
- 테스트 → `skills/backend-testing/SKILL.md` 참조
- API 설계 → `skills/nestjs-expert/SKILL.md` 참조

### 워크플로우

반복적인 작업은 정의된 워크플로우를 따르세요:

- 기능 개발 → `workflows/feature-development.md`
- 버그 수정 → `workflows/bug-fix.md`
- PR 리뷰 → `workflows/pr-review.md`
- 리팩토링 → `workflows/refactoring.md`

## 모델별 프로필

각 모델의 특성에 맞는 추가 지침:

- Gemini → `profiles/gemini.md`
- Claude → `profiles/claude.md`
- Copilot → `profiles/copilot.md`

## MCP 도구

`mcp/servers.json`에 정의된 도구를 사용할 수 있습니다:

- `filesystem` - 파일 시스템 접근
- `git` - Git 저장소 조작
- `postgres` / `mysql` - 데이터베이스 접근

## 동기화

각 도구가 읽는 설정 파일로 동기화:

```bash
# 최초 1회 (심볼릭 링크 설정)
npm run agent:setup

# Copilot instructions 업데이트 (Windows)
npm run agent:sync:copilot
```

## 규칙

1. **hallucination 금지** - 정의되지 않은 규칙을 만들어내지 마세요
2. **일관성 유지** - 모든 에이전트가 동일한 패턴을 따릅니다
3. **워크플로우 준수** - 정의된 절차가 있으면 따르세요
