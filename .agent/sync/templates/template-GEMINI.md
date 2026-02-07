# GEMINI.md - 컨텍스트 진입점

> ⚠️ 이 파일은 `.agent` 폴더를 가리키는 포인터입니다.
> 직접 수정하지 마세요. `.agent/` 내용을 수정하세요.

---

## 🚨 핵심 지침 (CRITICAL)

**사용자가 별도로 요청하지 않는 한, 반드시 한국어로 응답하세요.**
**ALWAYS RESPOND IN KOREAN UNLESS REQUESTED OTHERWISE.**

---

## 핵심 규칙 가져오기

{{RULES}}

---

## 스킬 가져오기

{{SKILLS}}

---

## 워크플로우 가져오기

{{WORKFLOWS}}

---

## 에이전트 가져오기

{{AGENTS}}

## Commands

{{COMMANDS}}

---

## 필수 지침

1. **규칙 준수**: `.agent/rules/`에 정의된 규칙을 따르세요.
2. **스킬 참조**: 작업 전 관련 스킬 문서를 확인하세요.
3. **워크플로우 준수**: 정의된 절차가 있으면 따르세요.
4. **Hallucination 금지**: 정의되지 않은 규칙을 만들어내지 마세요.

## MCP 도구

`.agent/mcp/servers.json`에 정의된 도구를 사용할 수 있습니다.
