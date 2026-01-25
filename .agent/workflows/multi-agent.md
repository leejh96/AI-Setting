---
description: 
---

# Workflow: Multi-Agent Development

Claude Code와 Gemini CLI를 조합한 효율적인 개발 워크플로우입니다.

## 개요

| Agent | 역할 | 강점 | 추천 모델 유형 |
|-------|------|------|----------------|
| **Gemini CLI** | 분석, 리서치, 리뷰 | 대규모 컨텍스트, 검색 | **Deep (Pro)** 계열 |
| **Claude Code** | 계획, 구현, 리팩토링 | 정확한 구현, 도구 제어 | **Sonnet(Opus)** 계열 |

## 워크플로우 단계

### Phase 1: 코드베이스 분석 (Gemini - Deep Mode)

복잡한 로직 분석이나 전체 아키텍처 설계가 필요할 때는 **Pro 모델**을 사용하여 깊이 있는 분석을 수행합니다.

```bash
# 복잡한 분석 (Pro 모델 사용)
gemini -m gemini-pro "
이 프로젝트의 아키텍처 패턴과 데이터베이스 접근 방식을 심층 분석해줘.
잠재적인 성능 병목 지점도 함께 찾아줘.
"
```

단순한 검색이나 문서 요약은 **Flash 모델**을 사용하여 속도와 비용을 최적화합니다.

```bash
# 단순 리서치 (Flash 모델 사용)
gemini -m gemini-flash "
NestJS에서 파일 업로드 시 메모리 효율적인 방법 검색해줘.
"
```

### Phase 2: 계획 수립 및 구현 (Claude)

Gemini의 분석 결과를 Claude에게 전달하고 구현을 진행합니다. Claude는 상황에 따라 적절한 모델(Haiku, Sonnet, Opus)을 선택하여 호출합니다.

```markdown
# Claude Code 컨텍스트 전달

## Gemini 분석 요약
[Gemini 출력 내용]

## 작업 요청
위 분석을 바탕으로 [기능]을 구현해줘.
```

분석 완료 후, 실행은 다음 명령어로 위임합니다.

```bash
claude -p --model sonnet "
[Gemini의 분석 결과 요약]
위 내용을 바탕으로 [작업]을 수행해줘.
"
```

### Phase 3: 코드 리뷰 (Gemini - Auto/Deep)

변경 사항의 중요도에 따라 모델을 선택합니다.

- **핵심 로직/보안**: `gemini pro 모델` (정밀 검토)
- **단순 수정/문서**: `gemini flash 모델` (빠른 검토)

```bash
# 보안 및 핵심 로직 리뷰
gemini -m gemini-pro "
변경된 인증 모듈의 보안 취약점을 점검해줘.
"
```

---

## 상황별 모델 선택 가이드

### Gemini CLI

| 작업 유형 | 추천 모델 | 명령어 옵션 |
|----------|----------|------------|
| **Deep Analysis** | Pro | `-m gemini-pro` |
| **Quick Research** | Flash | `-m gemini-flash` |
| **Code Review** | Pro (핵심) / Flash (단순) | 상황에 따라 선택 |

### Claude Code

| 작업 유형 | 추천 모델 | 명령어 옵션 |
|----------|----------|------------|
| **Complex Logic** | Sonnet / Opus | `--model sonnet` / `--model opus` |
| **Simple Fix** | Haiku | `--model haiku` |

---

## 작업 유형별 워크플로우 예시

### 1. 대규모 리팩토링 (High Complexity)

1. **Gemini (Pro)**: 전체 의존성 분석 및 리팩토링 전략 수립.
2. **Claude (Opus/Sonnet)**: 안전한 리팩토링 수행 및 테스트 작성.
3. **Gemini (Pro)**: 사이드 이펙트 및 누락된 부분 정밀 검토.

### 2. 간단한 버그 수정 (Low Complexity)

1. **Gemini (Flash)**: 에러 로그 분석 및 관련 코드 위치 찾기.
2. **Claude (Sonnet/Haiku)**: 버그 수정.
3. **Gemini (Flash)**: 수정 사항 확인.

---

## 주의사항

1. **모델 명칭 확인**: `gemini` CLI 버전에 따라 지원하는 모델명(`gemini-pro`, `gemini-flash` 등)이 다를 수 있으므로 `gemini --help`로 확인하세요.
2. **컨텍스트 윈도우**: Pro 모델은 더 긴 컨텍스트를 지원하므로 전체 코드베이스 분석 시 유리합니다.
3. **교차 검증**: Claude가 구현한 코드를 Gemini가 리뷰하고, Gemini가 제안한 설계를 Claude가 검증하는 상호 보완적 관계를 유지하세요.