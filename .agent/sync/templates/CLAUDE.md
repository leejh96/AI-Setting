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

### 1. 외부 에이전트 활용 (Gemini CLI)
너(Claude)는 로컬 터미널에 설치된 `gemini` CLI 도구를 사용하여 작업을 수행할 수 있다. Gemini는 최신 정보 탐색 및 코드 교차 검증을 담당하는 보조 분석가이다.

### 2. 협업 원칙 (No-File Strategy)
- **표준 출력 활용**: Gemini와의 통신을 위해 임시 파일을 생성하지 않는다. `gemini "질문"` 명령 실행 후 터미널에 출력되는 결과(STDOUT)를 즉시 컨텍스트에 반영하라.
- **예외 상황**: 데이터가 너무 커서 터미널 버퍼를 초과할 것으로 예상되는 경우에만 사용자에게 `.agent/` 폴더 내 파일 저장 여부를 묻는다.
- **선(先) 분석 가이드**: 복합적인 작업 지시를 받으면 먼저 Gemini에게 분석을 요청하고, 그 답변을 바탕으로 최종 코드를 작성하라.

### 3. 상황별 명령어 가이드
- **Fast (Flash 모델)**: 단순 문서 요약, 구글 검색 결과 정리, 간단한 코드 설명
  - 명령어: `gemini -m gemini-flash "..."`
- **Deep (Pro 모델)**: 복잡한 로직 분석, 전체 아키텍처 설계, 정교한 버그 추적
  - 명령어: `gemini -m gemini-pro "..."`
- **자동 (Auto)**: 모델 선택이 애매한 경우 시스템 기본값 사용
  - 명령어: `gemini "..."`

### 4. 실행 및 보고 규칙
- Gemini의 제안이 부적절하다고 판단될 경우, 사용자에게 이유를 설명하고 대안을 제시하라.
- 작업을 마친 뒤에는 "Gemini와 상의하여 [내용]을 반영했습니다"라고 명시하라.