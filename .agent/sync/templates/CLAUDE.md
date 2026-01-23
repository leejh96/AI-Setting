# CLAUDE.md

> ⚠️ 이 파일은 `.agent` 폴더를 가리키는 포인터입니다.
> 직접 수정하지 마세요. `.agent/` 내용을 수정하세요.

---

이 프로젝트는 모든 AI 설정에 통합된 `.agent` 디렉토리를 사용합니다.
(Claude의 경우 일관성을 위해 `.claude` 심볼릭 링크를 참조합니다.)

## Core Context

프로젝트 규칙과 컨텍스트:

- **프로젝트 컨텍스트**: .claude/rules/project-context.md
- **코딩 컨벤션**: .claude/rules/coding-conventions.md
- **응답 스타일**: .claude/rules/response-style.md

## Skills

작업별 가이드라인:

- **백엔드 개발**: .claude/skills/backend-development/SKILL.md
- **코드 리뷰**: .claude/skills/code-review/SKILL.md
- **테스트**: .claude/skills/backend-testing/SKILL.md
- **NestJS 전문가**: .claude/skills/nestjs-expert/SKILL.md

## Workflows

작업 흐름:

- **기능 개발**: .claude/workflows/feature-development.md
- **버그 수정**: .claude/workflows/bug-fix.md
- **PR 리뷰**: .claude/workflows/pr-review.md
- **리팩토링**: .claude/workflows/refactoring.md

## Agents (Personas)

역할별 페르소나:

- **시니어 백엔드**: .claude/agents/senior-backend.md
- **코드 리뷰어**: .claude/agents/code-reviewer.md
- **테크 라이터**: .claude/agents/tech-writer.md

## Prompts

재사용 프롬프트:

- **커밋 메시지**: .claude/prompts/commit-message.md
- **PR 설명**: .claude/prompts/pr-description.md
- **API 문서**: .claude/prompts/api-documentation.md

## Critical Instructions

1. **규칙 준수**: `.agent/rules/`에 정의된 규칙을 따르세요.
2. **스킬 참조**: 작업 전 관련 스킬 문서를 확인하세요.
3. **워크플로우 준수**: 정의된 절차가 있으면 따르세요.
4. **Hallucination 금지**: 정의되지 않은 규칙을 만들어내지 마세요.

## MCP Tools

`.agent/mcp/servers.json`에 정의된 도구를 사용할 수 있습니다.
