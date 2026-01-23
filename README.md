# AI Setting

**모든 AI 에이전트를 위한 통합 설정 및 컨텍스트 관리 저장소**

이 프로젝트는 다양한 AI 코딩 어시스턴트(Claude, Gemini, Copilot 등)가 동일한 프로젝트 컨텍스트, 코딩 컨벤션, 워크플로우를 공유할 수 있도록 설정을 중앙화하고 동기화하는 도구입니다.

## 🎯 목적

개발자가 사용하는 AI 도구가 무엇이든 상관없이, 다음과 같은 일관성을 보장합니다:
- **동일한 페르소나**: 시니어 풀스택 엔지니어로서의 행동 지침
- **일관된 규칙**: 코딩 스타일, 프로젝트 구조, 기술 스택 준수
- **공유된 지식**: 스킬(Skills)과 워크플로우(Workflows)의 재사용

## 📂 프로젝트 구조

핵심 설정은 `.agent/` 디렉토리 내에서 관리됩니다.

```bash
.agent/
├── rules/        # 정적 규칙 (코딩 컨벤션, 응답 스타일, 프로젝트 컨텍스트)
├── skills/       # 에이전트가 활용할 전문 스킬 (백엔드, 테스트, 리뷰 등)
├── workflows/    # 표준 작업 절차 (기능 개발, 버그 수정 등)
├── agents/       # 역할별 페르소나 정의
├── profiles/     # 각 AI 모델별(Gemini, Claude) 최적화 설정
└── sync/         # 설정 동기화 및 심볼릭 링크 생성 스크립트
```

## 🚀 시작하기

### 1. 설정 동기화

이 스크립트는 `.agent`의 설정을 각 AI 도구가 인식할 수 있는 파일(예: `.gemini/`, `.claude/`)로 연결하거나 생성합니다.

```bash
# 최초 설정 및 심볼릭 링크/파일 생성
npm run agent:setup
```



## ✨ 주요 기능

*   **Rules Management**: 프로젝트별 컨텍스트와 코딩 규칙을 한 곳에서 정의합니다.
*   **Skill System**: AI에게 특정 도메인(NestJS, 테스팅 등)의 전문 지식을 주입합니다.
*   **Workflow Automation**: 복잡한 작업(PR 리뷰, 기능 구현)을 단계별로 가이드합니다.
*   **Multi-Model Support**:
    *   **Gemini**
    *   **Claude**
    *   **GitHub Copilot**

## 📝 사용 방법

1.  `.agent/rules/project-context.md`에 현재 프로젝트의 기술 스택과 개요를 작성합니다.
2.  `.agent/rules/coding-conventions.md`에 팀의 코딩 스타일을 정의합니다.
3.  `npm run agent:setup`을 실행하여 모든 AI 에이전트에 변경 사항을 전파합니다.
4.  이제 어떤 AI 오토를 사용하든 정의된 규칙에 따라 코딩을 도와줍니다.
