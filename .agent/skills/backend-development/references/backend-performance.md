# Backend Performance & Scalability (백엔드 성능 및 확장성)

성능 최적화 전략, 캐싱 패턴 및 확장성 모범 사례 (2025).

## 데이터베이스 성능

### 쿼리 최적화

#### 인덱싱 전략

**효과:** 디스크 I/O 30% 감소, 쿼리 속도 10-100배 향상

```sql
-- 자주 조회되는 컬럼에 인덱스 생성
CREATE INDEX idx_users_email ON users(email);

-- 다중 컬럼 쿼리를 위한 복합 인덱스 (순서 중요)
CREATE INDEX idx_orders_user_date ON orders(user_id, created_at DESC);

-- 필터링된 쿼리를 위한 부분 인덱스 (PostgreSQL)
CREATE INDEX idx_active_users ON users(email) WHERE active = true;

-- 쿼리 성능 분석
-- PostgreSQL
EXPLAIN ANALYZE SELECT * FROM orders WHERE user_id = 123;
-- MySQL
EXPLAIN SELECT * FROM orders WHERE user_id = 123;
```

**인덱스 유형:**
- **B-tree** - 기본, 범용 (동등 비교, 범위 쿼리)
- **Hash** - 빠른 동등 조회 (범위 쿼리 불가)
- **GIN** (Postgres) / **FullText** (MySQL) - 전문 검색

**인덱스 생성 금지:** 작은 테이블, 자주 업데이트되는 컬럼, 카디널리티가 낮은 컬럼(예: 성별)

### 커넥션 풀링 (Connection Pooling)

**효과:** 5-10배 성능 향상 (연결 설정 오버헤드 제거)

```typescript
// PostgreSQL (pg-pool)
import { Pool } from 'pg';
const pool = new Pool({ max: 20, idleTimeoutMillis: 30000 });

// MySQL (mysql2/promise)
import mysql from 'mysql2/promise';
const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  database: 'test',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// 풀을 사용하여 쿼리
const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [userId]);
```

**권장 풀 크기:** 코어 수 * 2 + 효과적인 스핀들 수 (일반적으로 인스턴스당 20-30개)

### N+1 쿼리 문제

반복문 안에서 쿼리를 수행하지 말고, `JOIN`이나 `WHERE IN`을 사용하여 한 번에 조회해야 합니다. (Prisma의 `include`, TypeORM의 `relations` 활용)

## 캐싱 전략

### Redis 캐싱

**효과:** DB 부하 90% 감소, 응답 속도 10-100배 향상

#### Cache-Aside (Lazy Loading)
1. 캐시 확인
2. 있으면 반환 (Hit)
3. 없으면 DB 조회 후 캐시에 저장하고 반환 (Miss)

#### Write-Through
DB 업데이트 시 캐시도 즉시 업데이트하여 일관성 유지

#### 캐시 레이어
Client → CDN → API Gateway → App Cache (Redis) → DB Query Cache → DB

**모범 사례:**
- 자주 접근하는 데이터 캐싱
- 적절한 TTL(만료 시간) 설정
- 쓰기 시 캐시 무효화(Invalidation) 전략
- 히트율(Hit rate) 모니터링 (>80% 목표)

## 로드 밸런싱

**알고리즘:**
- **Round Robin:** 서버에 순차적으로 분배
- **Least Connections:** 연결이 가장 적은 서버로 보냄
- **IP Hash:** 클라이언트 IP에 따라 고정된 서버로 보냄 (세션 유지)

## 비동기 처리

### 메시지 큐 (Bull, RabbitMQ)
오래 걸리는 작업(이메일 전송, 영상 처리 등)은 큐에 넣고 백그라운드 워커가 처리하도록 하여 API 응답 속도를 높입니다.

## CDN (Content Delivery Network)
정적 자산(이미지, CSS, JS)을 전 세계 엣지 서버에 캐싱하여 지연 시간을 50% 이상 줄입니다. (Cloudflare, AWS CloudFront)

## 확장성 패턴

### 수평적 확장 (Scale Out) vs 수직적 확장 (Scale Up)
- **Scale Out:** 서버 대수를 늘림. 무제한 확장 가능, 내결함성 우수. (권장)
- **Scale Up:** 서버 사양을 높임. 구현 단순하나 한계가 명확함.

### 데이터베이스 확장

#### 읽기 복제본 (Read Replicas)
쓰기는 주(Primary) DB에, 읽기는 여러 복제본(Replica)에 분산. 읽기 비중이 높은 시스템에 적합.

#### 데이터베이스 샤딩 (Sharding)
데이터를 여러 DB에 분할 저장.
- **Range-based:** ID 1~100만은 DB1, 100만~200만은 DB2
- **Hash-based:** ID 해시값에 따라 균등 분배

## 성능 모니터링

### 핵심 메트릭
- **App:** 응답 시간(p95, p99), 처리량(RPS), 에러율
- **DB:** 슬로우 쿼리, 커넥션 풀 포화도, 캐시 히트율

## 성능 최적화 체크리스트

- [ ] 인덱스 최적화
- [ ] 커넥션 풀링 적용
- [ ] N+1 쿼리 제거
- [ ] Redis 캐싱 적용 (Hot data)
- [ ] CDN 적용
- [ ] 비동기 처리 (큐 도입)
- [ ] 응답 압축 (Gzip/Brotli)
- [ ] APM 도구 모니터링 (New Relic/Datadog)

## 리소스

- **PostgreSQL Performance:** https://www.postgresql.org/docs/current/performance-tips.html
- **MySQL Optimization:** https://dev.mysql.com/doc/refman/8.0/en/optimization.html
- **Redis Best Practices:** https://redis.io/docs/management/optimization/
- **Web Performance:** https://web.dev/performance/
- **Database Indexing:** https://use-the-index-luke.com/
