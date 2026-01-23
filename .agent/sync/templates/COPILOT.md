# COPILOT.md - 컨텍스트 진입점

> ⚠️ Auto-generated from .agent/sync/templates/ - 직접 수정하지 마세요
> `.agent/` 내용 수정 후 `npm run agent:sync:copilot` 실행

---

## 실제 컨텍스트 위치

이 파일은 `.github/copilot-instructions.md`를 가리키는 포인터입니다.
**모든 규칙, 스킬, 워크플로우, 에이전트, 프롬프트는 해당 파일에 통합되어 있습니다.**

@./.github/copilot-instructions.md

---

## 플로우

```
1. COPILOT.md (현재 파일) 로드
2. @./.github/copilot-instructions.md 참조
3. 모든 규칙/스킬/워크플로우/에이전트/프롬프트 인식
```

---

## 수정 방법

`.agent/` 아래의 다음 폴더들을 수정한 후 동기화 커맨드 실행:

- `.agent/rules/` - 코딩 규칙, 응답 스타일, 프로젝트 컨텍스트
- `.agent/skills/` - 전문 스킬
- `.agent/workflows/` - 작업 흐름
- `.agent/agents/` - AI 페르소나
- `.agent/prompts/` - 재사용 프롬프트

```bash
npm run agent:sync:copilot
```

**위 커맨드가 자동으로 생성합니다:**
- `.github/copilot-instructions.md` (실제 컨텍스트)
- `COPILOT.md` (루트 포인터)

