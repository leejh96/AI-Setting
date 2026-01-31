# AGENTS.md

> ⚠️ 이 파일은 `.agent` 폴더를 가리키는 포인터입니다.
> 직접 수정하지 마세요. `.agent/` 내용을 수정하세요.

---

## 🚨 핵심 지침 (CRITICAL)

**사용자가 별도로 요청하지 않는 한, 반드시 한국어로 응답하세요.**
**ALWAYS RESPOND IN KOREAN UNLESS REQUESTED OTHERWISE.**

---

이 프로젝트는 모든 AI 설정에 통합된 `.agent` 디렉토리를 사용합니다.
(OpenCode의 경우 일관성을 위해 `.opencode` 심볼릭 링크를 참조합니다.)

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

## Commands

재사용 프롬프트:

{{COMMANDS}}

## Critical Instructions

1. **규칙 준수**: `.agent/rules/`에 정의된 규칙을 따르세요.
2. **스킬 참조**: 작업 전 관련 스킬 문서를 확인하세요.
3. **워크플로우 준수**: 정의된 절차가 있으면 따르세요.
4. **Hallucination 금지**: 정의되지 않은 규칙을 만들어내지 마세요.

## MCP Tools

`.agent/mcp/servers.json`에 정의된 도구를 사용할 수 있습니다.
