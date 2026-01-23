---
name: backend-development
description: 최신 기술(Node.js, Python, Go, Rust), 프레임워크(NestJS, FastAPI, Django), 데이터베이스(PostgreSQL, MySQL, MongoDB, Redis), API(REST, GraphQL, gRPC), 인증(OAuth 2.1, JWT), 테스트 전략, 보안 모범 사례(OWASP Top 10), 성능 최적화, 확장성 패턴(마이크로서비스, 캐싱, 샤딩), DevOps 관행(Docker, Kubernetes, CI/CD) 및 모니터링을 사용하여 견고한 백엔드 시스템을 구축합니다. API 설계, 인증 구현, 데이터베이스 쿼리 최적화, CI/CD 파이프라인 설정, 보안 취약점 처리, 마이크로서비스 구축 또는 프로덕션 준비가 된 백엔드 시스템 개발 시 사용합니다.
license: MIT
---

# 백엔드 개발 스킬

최신 기술, 모범 사례 및 검증된 패턴을 사용하여 프로덕션 레벨의 백엔드 시스템을 개발합니다.

## 사용 시점

- RESTful, GraphQL 또는 gRPC API 설계
- 인증/인가 시스템 구축
- 데이터베이스 쿼리 및 스키마 최적화
- 캐싱 및 성능 최적화 구현
- OWASP Top 10 보안 완화
- 확장 가능한 마이크로서비스 설계
- 테스트 전략 (단위, 통합, E2E)
- CI/CD 파이프라인 및 배포
- 프로덕션 시스템 모니터링 및 디버깅

## 기술 선택 가이드

**언어:** Node.js/TypeScript (풀스택), Python (데이터/ML), Go (동시성), Rust (성능)
**프레임워크:** NestJS, FastAPI, Django, Express, Gin
**데이터베이스:** PostgreSQL (ACID), MySQL (웹 표준), MongoDB (유연한 스키마), Redis (캐싱)
**API:** REST (단순성), GraphQL (유연성), gRPC (성능)

참조: `references/backend-technologies.md` 에서 상세 비교 확인

## 참조 탐색

**핵심 기술:**
- `backend-technologies.md` - 언어, 프레임워크, 데이터베이스, 메시지 큐, ORM
- `backend-api-design.md` - REST, GraphQL, gRPC 패턴 및 모범 사례

**보안 및 인증:**
- `backend-security.md` - OWASP Top 10 2025, 보안 모범 사례, 입력 검증
- `backend-authentication.md` - OAuth 2.1, JWT, RBAC, MFA, 세션 관리

**성능 및 아키텍처:**
- `backend-performance.md` - 캐싱, 쿼리 최적화, 로드 밸런싱, 스케일링
- `backend-architecture.md` - 마이크로서비스, 이벤트 기반, CQRS, 사가(Saga) 패턴

**품질 및 운영:**
- `backend-testing.md` - 테스트 전략, 프레임워크, 도구, CI/CD 테스트
- `backend-code-quality.md` - SOLID 원칙, 디자인 패턴, 클린 코드
- `backend-devops.md` - Docker, Kubernetes, 배포 전략, 모니터링
- `backend-debugging.md` - 디버깅 전략, 프로파일링, 로깅, 프로덕션 디버깅
- `backend-mindset.md` - 문제 해결, 아키텍처적 사고, 협업

## 주요 모범 사례 (2025)

**보안:** Argon2id 비밀번호 해싱, 파라미터화된 쿼리 (SQL 인젝션 98% 감소), OAuth 2.1 + PKCE, 속도 제한(Rate limiting), 보안 헤더

**성능:** Redis 캐싱 (DB 부하 90% 감소), 데이터베이스 인덱싱 (I/O 30% 감소), CDN (지연 시간 50% 이상 단축), 커넥션 풀링

**테스트:** 70-20-10 피라미드 (단위-통합-E2E), Jest보다 50% 빠른 Vitest, 마이크로서비스를 위한 계약(Contract) 테스트, 테스트 없는 마이그레이션은 83% 실패 확률

**DevOps:** 블루-그린/카나리 배포, 피처 플래그 (장애 90% 감소), Kubernetes 84% 채택, Prometheus/Grafana 모니터링, OpenTelemetry 트레이싱

## 빠른 의사결정 매트릭스

| 요구사항 | 선택 |
|------|--------|
| 빠른 개발 | Node.js + NestJS |
| 데이터/ML 통합 | Python + FastAPI |
| 높은 동시성 | Go + Gin |
| 최대 성능 | Rust + Axum |
| ACID 트랜잭션 | PostgreSQL / MySQL |
| 유연한 스키마 | MongoDB |
| 캐싱 | Redis |
| 내부 서비스 통신 | gRPC |
| 공개 API | GraphQL/REST |
| 실시간 이벤트 | Kafka |

## 구현 체크리스트

**API:** 스타일 선택 → 스키마 설계 → 입력 검증 → 인증 추가 → 속도 제한 → 문서화 → 에러 처리

**데이터베이스:** DB 선택 → 스키마 설계 → 인덱스 생성 → 커넥션 풀링 → 마이그레이션 전략 → 백업/복원 → 성능 테스트

**보안:** OWASP Top 10 → 파라미터화된 쿼리 → OAuth 2.1 + JWT → 보안 헤더 → 속도 제한 → 입력 검증 → Argon2id 비밀번호

**테스트:** 단위 70% → 통합 20% → E2E 10% → 부하 테스트 → 마이그레이션 테스트 → 계약 테스트 (마이크로서비스)

**배포:** Docker → CI/CD → 블루-그린/카나리 → 피처 플래그 → 모니터링 → 로깅 → 헬스 체크

## 리소스

- OWASP Top 10: https://owasp.org/www-project-top-ten/
- OAuth 2.1: https://oauth.net/2.1/
- OpenTelemetry: https://opentelemetry.io/
