# AI Setting

**모든 AI 에이전트를 위한 통합 설정 및 컨텍스트 관리 저장소**

이 프로젝트는 다양한 AI 코딩 어시스턴트(Claude, Gemini, Copilot, OpenCode, Codex 등)가 동일한 프로젝트 컨텍스트, 코딩 컨벤션, 워크플로우를 공유할 수 있도록 설정을 중앙화하고 동기화하는 도구입니다.

## 🎯 목적

개발자가 사용하는 AI 도구가 무엇이든 상관없이, 다음과 같은 일관성을 보장합니다:
- **동일한 페르소나**: 시니어 풀스택 엔지니어로서의 행동 지침
- **일관된 규칙**: 코딩 스타일, 프로젝트 구조, 기술 스택 준수
- **공유된 지식**: 스킬(Skills)과 워크플로우(Workflows)의 재사용
- **자동화된 설정**: 에이전트별 설정 파일 및 심볼릭 링크 자동 생성

## 📂 프로젝트 구조

핵심 설정은 `.agent/` 디렉토리 내에서 '단일 진실 공급원(SSOT)'으로 관리됩니다.

```bash
.agent/
├── rules/        # 정적 규칙 (코딩 컨벤션, 응답 스타일, 프로젝트 컨텍스트 등)
├── skills/       # 에이전트가 활용할 전문 스킬 (백엔드, 테스트, 리뷰 등)
├── workflows/    # 표준 작업 절차 (기능 개발, 버그 수정 등)
├── agents/       # 역할별 페르소나 정의 (시니어 백엔드 등)
├── commands/     # AI에게 내릴 수 있는 프롬프트 명령어
├── mcp/          # MCP(Model Context Protocol) 서버 설정
└── sync/         # 설정 동기화 스크립트
```

## 🚀 시작하기

### 1. 설정 동기화 (Setup)
원하는 AI 에이전트 환경에 맞춰 설정을 동기화합니다. 사용하지 않는 에이전트 설정은 자동으로 정리됩니다.

```bash
# 모든 에이전트 설정 동기화 (기본값)
npm run setup:all

# GitHub Copilot 전용 설정 (나머지 에이전트 설정 제거)
npm run setup:copilot

# Claude 전용 설정
npm run setup:claude

# Gemini 전용 설정
npm run setup:gemini

# OpenCode 전용 설정
npm run setup:opencode

# Codex 전용 설정
npm run setup:codex
```

### 2. 새 프로젝트 설정 가이드

새로운 프로젝트에 이 설정을 적용할 때, 다음 파일들을 순서대로 수정하세요.

#### 1단계: 필수 수정 (Must Change)
**`.agent/rules/project-context.md`**를 수정하여 프로젝트의 정체성을 정의합니다.
- **프로젝트 개요**: 비즈니스 로직 설명
- **기술 스택**: 구체적인 버전 및 라이브러리
- **프로젝트 구조**: 폴더 구조 설명
- **환경 변수**: 주요 환경 변수 목록

#### 2단계: 선택 수정 (Optional)
팀의 컨벤션에 맞게 조정이 필요한 경우 수정합니다.
- **`.agent/rules/coding-conventions.md`**: 네이밍 규칙, 파일 구조 등
- **`.agent/rules/response-style.md`**: AI 응답 톤앤매너
- **`.agent/mcp/servers.json`**: 사용할 MCP 서버 목록 정의

### 3. 설정 적용 확인

`setup` 명령어를 실행하면 다음과 같은 파일들이 자동 생성되거나 업데이트됩니다:
- **Copilot**: `.github/` (instructions, agents, prompts 등), `.vscode/mcp.json`
- **Claude**: `.claude/`, `CLAUDE.md`, `.mcp.json`
- **Gemini**: `.gemini/`, `GEMINI.md`
- **OpenCode**: `.opencode/`, `AGENTS.md`, `opencode.json`
- **Codex**: `.codex/`, `AGENTS.md` (Prefix: .codex), `.codex/config.toml`

## ✨ 주요 기능

*   **Integrated Setup**: 한 번의 명령어로 모든 AI 도구의 설정을 최신 상태로 유지합니다.
*   **Mode-Specific Builds**: `setup:copilot`, `setup:claude` 등 필요한 환경만 구축하고 나머지는 제거하여 프로젝트를 깔끔하게 유지합니다.
*   **Dynamic Linking**: 각 에이전트가 참조하는 파일 경로(Prefix)를 자동으로 조정하여 링크 깨짐을 방지합니다.
*   **MCP Integration**: `.agent/mcp/servers.json`을 SSOT로 사용하여 모든 에이전트의 도구 설정을 자동 동기화합니다.
*   **Rules Management**: 프로젝트별 컨텍스트와 코딩 규칙을 한 곳에서 정의하고 모든 에이전트에게 전파합니다.

