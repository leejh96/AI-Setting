# Backend Debugging Strategies (백엔드 디버깅 전략)

백엔드 시스템을 위한 포괄적인 디버깅 기법, 도구 및 모범 사례 (2025).

## 디버깅 마인드셋

### 디버깅을 위한 과학적 방법
1. **관찰 (Observe)** - 증상과 데이터를 수집
2. **가설 (Hypothesize)** - 원인에 대한 이론 수립
3. **테스트 (Test)** - 이론 검증 또는 반증
4. **반복 (Iterate)** - 이해도 개선
5. **수정 (Fix)** - 해결책 적용
6. **검증 (Verify)** - 수정 사항 확인

### 황금률
1. **먼저 재현하라** - 재현 없는 디버깅은 추측일 뿐이다.
2. **문제를 단순화하라** - 변수를 격리시켜라.
3. **로그를 읽어라** - 에러 메시지에 단서가 있다.
4. **가정을 확인하라** - "당연히 동작하겠지"는 디버깅이 아니다.
5. **무작위 변경 금지** - 과학적 방법을 사용하라.
6. **발견 사항 문서화** - 미래의 자신을 위해 기록하라.

## 로깅 모범 사례

### 구조화된 로깅 (Structured Logging)

**Node.js (Pino - 초고속)**
```typescript
import pino from 'pino';
const logger = pino();

// 컨텍스트와 함께 로깅
logger.info({ userId: '123', action: 'login' }, '사용자 로그인');

// 에러 객체와 함께 로깅
try {
  await riskyOperation();
} catch (err) {
  logger.error({ err, userId: '123' }, '작업 실패');
}
```

### 로그 레벨

| 레벨 | 목적 | 예시 |
|------|------|------|
| **TRACE** | 매우 상세, 개발용 | 요청/응답 본문 |
| **DEBUG** | 디버깅 정보 | SQL 쿼리, 캐시 히트 |
| **INFO** | 일반 정보 | 로그인, API 호출 |
| **WARN** | 잠재적 문제 | Deprecated API 사용 |
| **ERROR** | 에러 상황 | API 실패, 예외 발생 |
| **FATAL** | 치명적 오류 | DB 연결 끊김 |

### 무엇을 로그할 것인가

**✅ DO LOG:**
- 요청/응답 메타데이터 (프로덕션에서는 본문 제외)
- 컨텍스트(사용자 ID, 요청 ID)가 포함된 에러
- 성능 메트릭 (소요 시간)
- 보안 이벤트

**❌ DON'T LOG:**
- 비밀번호, 시크릿 키
- 신용카드 번호
- PII (개인 식별 정보) - 필요시 마스킹
- 세션 토큰

## 언어별 디버깅 도구

### Node.js / TypeScript
1. **Chrome DevTools:** `node --inspect-brk app.js` 후 `chrome://inspect` 접속
2. **VS Code Debugger:** `launch.json` 설정하여 사용
3. **Debug 모듈:** `DEBUG=app:* node app.js`

### Python
1. **PDB/IPython:** `pdb.set_trace()` 또는 `embed()` 사용
2. **VS Code Debugger:** FastAPI/Django 앱 디버깅에 최적화

### Go
1. **Delve (dlv):** Go 표준 디버거 (`dlv debug main.go`)
2. **VS Code Debugger:** Delve 통합 지원

## 데이터베이스 디버깅

### SQL 쿼리 디버깅

**1. 실행 계획 분석 (EXPLAIN)**

```sql
-- PostgreSQL
EXPLAIN ANALYZE SELECT * FROM orders WHERE user_id = 123;
-- MySQL
EXPLAIN SELECT * FROM orders WHERE user_id = 123;
```
확인할 점:
- `Seq Scan` / `ALL` (전체 스캔 - 인덱스 누락)
- 높은 `execution time`
- 부정확한 행 개수 추정 (통계 정보 갱신 필요)

**2. 슬로우 쿼리 로깅**

```sql
-- PostgreSQL (postgresql.conf)
log_min_duration_statement = 1000  -- 1초 이상 쿼리 로깅

-- MySQL (my.cnf)
slow_query_log = 1
long_query_time = 1
```

**3. 활성 쿼리 모니터링**

```sql
-- PostgreSQL
SELECT pid, query FROM pg_stat_activity WHERE state = 'active';

-- MySQL
SHOW PROCESSLIST;
```

### MongoDB 디버깅
`db.collection.find().explain('executionStats')`를 사용하여 `COLLSCAN`(인덱스 미사용) 여부를 확인합니다.

### Redis 디버깅
- `redis-cli MONITOR`: 실시간 명령 확인 (부하 주의)
- `redis-cli --bigkeys`: 메모리 많이 쓰는 키 찾기
- `redis-cli SLOWLOG GET`: 느린 명령 확인

## API 디버깅

**cURL / HTTPie:**
터미널에서 요청 헤더, 바디를 상세하게 확인하며 테스트합니다.
```bash
curl -v -X POST https://api.example.com/users -d '...'
http POST https://api.example.com/users name=John
```

**Request Logging Middleware:**
Express의 `morgan`, FastAPI의 미들웨어 등을 사용하여 들어오는 모든 요청을 로깅합니다.

## 성능 디버깅 (Profiling)

### CPU 프로파일링
- **Node.js:** `0x`, `clinic doctor` 사용하여 불꽃 그래프(Flamegraph) 분석
- **Python:** `cProfile`
- **Go:** `pprof`

### 메모리 디버깅
- **Node.js:** 힙 스냅샷(`v8.writeHeapSnapshot`)을 찍어 Chrome DevTools에서 비교 분석 (메모리 누수 찾기)
- **Python:** `memory_profiler`

## 프로덕션 디버깅 도구

- **APM (Application Performance Monitoring):** New Relic, Datadog (성능 병목 구간 시각화)
- **에러 트래킹:** Sentry (스택 트레이스, 사용자 컨텍스트 수집)
- **분산 트레이싱:** OpenTelemetry, Jaeger (마이크로서비스 간 흐름 추적)
- **로그 통합:** ELK Stack (Logstash, Elasticsearch, Kibana), Loki

## 일반적인 디버깅 시나리오

1. **높은 CPU 사용량:** 무한 루프, 비효율적 정규식(ReDoS), 블로킹 작업 확인. 프로파일러 사용.
2. **메모리 누수:** 해제되지 않은 리스너, 전역 캐시, 클로저 확인. 힙 스냅샷 비교.
3. **느린 DB 쿼리:** 인덱스 누락, N+1 문제, 불필요한 데이터 조인 확인. EXPLAIN 사용.
4. **커넥션 풀 고갈:** 커넥션 반환(`release()`) 누락, 트랜잭션 종료 실패 확인.
