# GEMINI.md - 컨텍스트 진입점

> ⚠️ 이 파일은 `.agent` 폴더를 가리키는 포인터입니다.
> 직접 수정하지 마세요. `.agent/` 내용을 수정하세요.

---

## 시스템 공지

이 컨텍스트는 통합된 `.agent` 저장소에서 동적으로 가져옵니다.
당신은 엄격한 프로젝트 규칙 하에 작동하는 AI 에이전트입니다.
(Gemini의 경우 `.gemini` 심볼릭 링크를 통해 참조합니다.)

---

## 핵심 규칙 가져오기

@./.gemini/rules/project-context.md
@./.gemini/rules/coding-conventions.md
@./.gemini/rules/response-style.md

---

## 스킬 가져오기

@./.gemini/skills/backend-development/SKILL.md
@./.gemini/skills/code-review/SKILL.md
@./.gemini/skills/backend-testing/SKILL.md
@./.gemini/skills/nestjs-expert/SKILL.md

---

## 워크플로우 가져오기

@./.gemini/workflows/feature-development.md
@./.gemini/workflows/bug-fix.md
@./.gemini/workflows/pr-review.md
@./.gemini/workflows/refactoring.md

---

## 에이전트 가져오기

@./.gemini/agents/senior-backend.md
@./.gemini/agents/code-reviewer.md
@./.gemini/agents/tech-writer.md

## 프롬프트 가져오기

@./.gemini/prompts/commit-message.md
@./.gemini/prompts/pr-description.md
@./.gemini/prompts/api-documentation.md

---

## 필수 지침

1. **규칙 준수**: `.agent/rules/`에 정의된 규칙을 따르세요.
2. **스킬 참조**: 작업 전 관련 스킬 문서를 확인하세요.
3. **워크플로우 준수**: 정의된 절차가 있으면 따르세요.
4. **Hallucination 금지**: 정의되지 않은 규칙을 만들어내지 마세요.

## MCP 도구

`.agent/mcp/servers.json`에 정의된 도구를 사용할 수 있습니다.
