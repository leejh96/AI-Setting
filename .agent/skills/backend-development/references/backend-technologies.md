# Backend Technologies (백엔드 기술)

2025년 백엔드 개발을 위한 핵심 기술, 프레임워크, 데이터베이스 및 메시지 큐입니다.

## 프로그래밍 언어 및 프레임워크

### Node.js/TypeScript
**시장 위치:** Node.js 백엔드의 대세 (TypeScript가 산업 표준)

**장점:**
- 풀스택 JavaScript/TypeScript 팀 구성 가능
- 실시간 애플리케이션 (WebSockets, Socket.io)에 최적
- 강력한 npm 생태계 (200만+ 패키지)와 빠른 프로토타이핑
- 비동기, 이벤트 기반 아키텍처

**주요 프레임워크:**
- **NestJS** - 엔터프라이즈급, TypeScript 우선, 모듈형 아키텍처 (Angular 영감)
- **Express** - 경량, 유연성, 가장 널리 사용됨 (주간 다운로드 2,300만)
- **Fastify** - 고성능 (초당 2만 요청 처리, Express 대비 빠름)
- **tRPC** - GraphQL 없이 완벽한 타입 안전성을 제공하는 엔드투엔드 API

**선택 기준:** 팀이 이미 JS/TS를 사용함, 실시간 기능 필요, 빠른 개발 속도 중요

### Python
**시장 위치:** FastAPI 도입 급증 - Flask에서 73%가 이주 중

**장점:**
- 데이터 중심 애플리케이션에 강력
- ML/AI 통합 용이 (TensorFlow, PyTorch)
- 과학 연산 및 데이터 처리 라이브러리 풍부
- 스크립팅 및 자동화에 우수

**주요 프레임워크:**
- **FastAPI** - 현대적, 비동기 지원, OpenAPI 문서 자동 생성, Pydantic 기반 검증
- **Django** - "Batteries-included" (ORM, 관리자 패널, 인증 내장), 생산성 높음
- **Flask** - 경량, 유연, 마이크로서비스에 적합

**선택 기준:** 데이터 사이언스/ML 통합 필요, 팀의 Python 숙련도 높음, 빠른 프로토타이핑

### Go (Golang)
**시장 위치:** 마이크로서비스 및 클라우드 네이티브 인프라의 표준 (Docker, K8s가 Go로 작성됨)

**장점:**
- 고루틴(goroutines)을 이용한 고동시성(High-concurrency) 처리
- 마이크로서비스 아키텍처에 최적
- 단일 바이너리 배포의 간편함
- 뛰어난 성능과 메모리 효율성

**주요 프레임워크:**
- **Gin** - 빠른 HTTP 라우터 (Martini보다 40배 빠름)
- **Echo** - 고성능, 확장성 우수
- **Fiber** - Express와 유사한 API, Fasthttp 기반의 초고성능

**선택 기준:** 고동시성 처리 필요, 마이크로서비스 구축, DevOps 도구 개발

### Rust
**시장 위치:** 가장 사랑받는 언어, 메모리 안전성과 성능의 끝판왕

**장점:**
- C/C++ 급의 성능 (GC 없음)
- 컴파일 타임 메모리 안전성 보장
- 고신뢰성 시스템 구축 가능
- WebAssembly 백엔드

**주요 프레임워크:**
- **Axum** - 인체공학적, 모듈형, tokio 기반 (비동기 런타임 표준)
- **Actix-web** - 웹 프레임워크 벤치마크 리더
- **Rocket** - 타입 안전성, 사용성 우수

**선택 기준:** 극한의 성능 필요, 메모리 안전성 필수, 저수준 제어 필요

## 데이터베이스

### 관계형 (SQL)

#### PostgreSQL
**시장 위치:** 새로운 프로젝트를 위한 가장 인기 있는 오픈소스 RDBMS

**강점:**
- 강력한 ACID 준수 및 데이터 무결성
- JSON/JSONB 지원 (SQL과 NoSQL의 하이브리드 사용 가능)
- 강력한 확장성 (PostGIS 등)
- 고급 인덱싱 (B-tree, Hash, GiST, GIN) 및 윈도우 함수

**사용 사례:**
- 금융, 이커머스 등 트랜잭션이 중요한 시스템
- 복잡한 조인과 리포팅이 필요한 경우

#### MySQL / MariaDB
**시장 위치:** 세계적으로 가장 많이 사용되는 오픈소스 DB, 웹 애플리케이션의 표준

**강점:**
- 널리 퍼진 사용 사례와 방대한 커뮤니티/자료
- 읽기 중심 워크로드에 뛰어난 성능
- 복제(Replication) 구성이 비교적 간편
- 다양한 스토리지 엔진 (InnoDB, MyRocks 등)

**사용 사례:**
- 일반적인 웹 서비스 (LAMP/LEMP 스택)
- 콘텐츠 관리 시스템 (WordPress 등)
- 읽기 트래픽이 많은 서비스

**선택 가이드:**
- **PostgreSQL:** 복잡한 쿼리, 지리 정보(PostGIS), JSON 처리가 많을 때
- **MySQL:** 읽기 위주의 단순한 웹 서비스, 팀 경험이 많을 때

### NoSQL

#### MongoDB
**시장 위치:** 선도적인 문서(Document) 지향 데이터베이스

**강점:**
- 유연하고 변경 가능한 스키마 (Schema-less)
- 수평적 확장 용이 (Sharding 내장)
- 강력한 집계 파이프라인 (Aggregation Pipeline)

**선택 기준:** 스키마 변경이 잦음, 빠른 이터레이션, 대용량 데이터의 수평 확장 필요

### 캐싱 & 인메모리

#### Redis
**시장 위치:** 캐싱 및 세션 저장소의 산업 표준

**기능:**
- 인메모리 키-값 저장소 (디스크 DB보다 10-100배 빠름)
- 자료구조 지원 (List, Set, Sorted Set, Hash 등)
- Pub/Sub 메시징
- 작업 큐 (BullMQ 등) 백엔드

**사용 사례:**
- 세션 저장소
- API 응답 캐싱 (DB 부하 90% 감소)
- 실시간 리더보드 (Sorted Set)
- 속도 제한 (Rate Limiting)

## ORM 및 데이터베이스 도구

### 최신 ORM (2025)

**Drizzle ORM** (TypeScript)
- NestJS 성능 경쟁에서 우위
- 초경량 (zero dependencies), SQL과 유사한 문법
- 최고의 타입 안전성, Serverless 친화적

**Prisma** (TypeScript/Node.js/Go/Rust)
- 자동 생성되는 타입 안전 클라이언트
- 마이그레이션 도구 내장 및 우수한 DX (Prisma Studio)
- **PostgreSQL 및 MySQL** 모두 강력 지원
- 빠른 개발 속도에 최적

**TypeORM** (TypeScript)
- 성숙하고 기능이 풍부함
- Active Record 및 Data Mapper 패턴 지원
- 레거시 프로젝트나 복잡한 엔터프라이즈 앱에서 여전히 강세

**SQLAlchemy** (Python)
- Python 생태계의 표준 ORM
- 강력한 쿼리 빌더 및 유연성

## 메시지 큐 & 이벤트 스트리밍

### RabbitMQ
**용도:** 작업 큐(Task Queue), 복잡한 라우팅이 필요한 비동기 통신

**강점:**
- 유연한 라우팅 (Direct, Topic, Fanout, Header)
- 메시지 신뢰성 (ACK), 내구성 보장
- 널리 사용되는 표준 프로토콜 (AMQP)

**사용 사례:** 백그라운드 작업 처리, 이메일 발송 큐, 마이크로서비스 간 통신

### Apache Kafka
**용도:** 대용량 이벤트 스트리밍, 실시간 데이터 파이프라인

**강점:**
- 초당 수백만 건의 메시지 처리 (High Throughput)
- 분산 아키텍처 및 내결함성
- 메시지 영속성 및 재생(Replay) 가능 (Log 기반)

**사용 사례:** 로그 수집, 실시간 분석, 이벤트 소싱, 변경 데이터 캡처(CDC)

## 기술 선택 흐름도

```
Start → 실시간 기능 필요?
       → Yes → Node.js + Socket.io
       → No → ML/AI 통합 필요?
              → Yes → Python + FastAPI
              → No → 최고 성능 또는 메모리 관리 중요?
                     → Yes → Rust + Axum
                     → No → 고동시성/마이크로서비스 중요?
                            → Yes → Go + Gin/Echo
                            → No → Node.js + NestJS (안전한 기본값)

데이터베이스 선택:
ACID/관계형 데이터 필요? → Yes → 복잡한 쿼리/JSON? → Yes → PostgreSQL
                                                  → No → MySQL (또는 PostgreSQL)
                        → No → 유연한 스키마? → Yes → MongoDB
                                             → No → PostgreSQL (Hybrid)

캐싱 필요? → 무조건 Redis

메시지 큐:
초당 수백만 건/이벤트 스트리밍? → Yes → Kafka
                              → No → RabbitMQ (또는 Redis Streams)
```

## 흔한 함정 (Pitfalls)

1. **관계형 데이터에 NoSQL 선택** - 명확한 관계가 있다면 RDBMS(PostgreSQL/MySQL) 사용
2. **커넥션 풀링 미사용** - DB 성능을 위해 풀링 필수 구현
3. **인덱스 무시** - 자주 조회하는 컬럼에 인덱스 추가 (성능의 핵심)
4. **섣부른 마이크로서비스 도입** - 모놀리스로 시작하고 필요할 때 분리
5. **무분별한 캐싱 미사용** - Redis 등으로 읽기 부하 감소 필수

## 참고 리소스

- **NestJS:** https://nestjs.com
- **FastAPI:** https://fastapi.tiangolo.com
- **PostgreSQL:** https://www.postgresql.org/docs/
- **MySQL:** https://dev.mysql.com/doc/
- **Prisma:** https://www.prisma.io/docs/
- **MongoDB:** https://www.mongodb.com/docs/
- **Redis:** https://redis.io/docs/
- **Kafka:** https://kafka.apache.org/documentation/
