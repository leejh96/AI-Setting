# Backend Testing Strategies (백엔드 테스트 전략)

포괄적인 테스트 접근 방식, 프레임워크 및 품질 보증 실천 사항 (2025).

## 테스트 피라미드 (70-20-10 법칙)

```
        /\
       /E2E\     10% - E2E(End-to-End) 테스트
      /------\
     /Integr.\ 20% - 통합 테스트
    /----------\
   /   Unit     \ 70% - 단위 테스트
  /--------------\
```

**이유:**
- 단위 테스트: 빠르고, 저렴하며, 버그를 신속하게 격리함
- 통합 테스트: 컴포넌트 간 상호작용 검증
- E2E 테스트: 비싸고 느리지만, 실제 사용자 흐름을 검증

## 단위 테스트 (Unit Testing)

### 언어별 프레임워크

**TypeScript/JavaScript:**
- **Vitest** - CI/CD에서 Jest보다 50% 빠름, ESM 네이티브
- **Jest** - 성숙함, 거대한 생태계, 스냅샷 테스팅

**Python:**
- **Pytest** - 산업 표준, 픽스처(fixtures), 파라미터화 지원

**Go:**
- **testing** - 내장 라이브러리, 테이블 주도 테스트(table-driven)
- **testify** - 어설션 및 모킹 지원

### 모범 사례

단일 책임 원칙 준수, 명확한 테스트 케이스 이름 사용 (`should create user...`), 독립적인 테스트 실행 보장.

### 모킹 (Mocking)

외부 의존성(DB, 이메일 서비스 등)을 모의 객체로 대체하여 비즈니스 로직만 격리해 테스트합니다.

## 통합 테스트 (Integration Testing)

### API 통합 테스트

`supertest` 등을 사용하여 실제 API 엔드포인트를 호출하고, 요청/응답 및 데이터베이스 지속성을 검증합니다.

### TestContainers를 이용한 데이터베이스 테스팅

실제 데이터베이스 인스턴스를 Docker 컨테이너로 띄워 테스트합니다. 가장 신뢰성 높은 방법입니다.

```typescript
import { GenericContainer } from 'testcontainers';

let container;
let db;

beforeAll(async () => {
  // PostgreSQL 예시
  // container = await new GenericContainer('postgres:15')
  //   .withEnvironment({ POSTGRES_PASSWORD: 'test' })
  //   .withExposedPorts(5432)
  //   .start();

  // MySQL 예시
  container = await new GenericContainer('mysql:8.0')
    .withEnvironment({ 
      MYSQL_ROOT_PASSWORD: 'test',
      MYSQL_DATABASE: 'test_db'
    })
    .withExposedPorts(3306)
    .start();

  const port = container.getMappedPort(3306);
  // DB 연결 생성...
}, 60000);

afterAll(async () => {
  await container.stop();
});
```

## 계약 테스트 (Contract Testing) - 마이크로서비스

### Pact (소비자 주도 계약)

마이크로서비스 간의 API 규약(Contract)을 정의하고, 소비자와 공급자가 이를 준수하는지 검증합니다.

## 부하 테스트 (Load Testing)

### 도구 비교

**k6** (현대적, 개발자 친화적)
JavaScript로 시나리오 작성 가능, CI/CD 통합 용이.

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '2m', target: 100 }, // 사용자 100명까지 증가
    { duration: '5m', target: 100 }, // 유지
    { duration: '2m', target: 0 },   // 감소
  ],
};
// ...
```

**성능 임계값 목표:**
- **응답 시간:** p95 < 500ms, p99 < 1s
- **처리량:** SLA에 따른 목표치 (예: 1000 req/sec)
- **에러율:** < 1%

## E2E 테스트

### Playwright (현대적, 멀티 브라우저)

실제 브라우저를 제어하여 사용자 시나리오(회원가입, 로그인 등)를 처음부터 끝까지 검증합니다.

## 데이터베이스 마이그레이션 테스트

**중요:** 적절한 테스트 없이는 마이그레이션 실패 확률이 높음 (83%).

1. V1 스키마에 데이터 삽입
2. 마이그레이션 실행 (V2)
3. 데이터 무결성 검증 (데이터 손실 확인)
4. 롤백 실행 및 V1 스키마 복구 확인

## 보안 테스트

### SAST (정적 애플리케이션 보안 테스트)
- **SonarQube**: 코드 품질 + 보안 취약점
- **Semgrep**: 보안 패턴 스캔

### DAST (동적 애플리케이션 보안 테스트)
- **OWASP ZAP**: 실행 중인 애플리케이션 스캔

### 의존성 스캔 (SCA)
- **Snyk**, **npm audit**: 라이브러리 취약점 점검

## 코드 커버리지

**목표 메트릭:**
- **전체 커버리지:** 80%+
- **핵심 경로:** 100% (인증, 결제 등)
- **신규 코드:** 90%+

## CI/CD 테스트 파이프라인

단위 테스트 → 통합 테스트 → E2E 테스트 → 부하 테스트 → 보안 스캔 → 커버리지 보고 순으로 파이프라인을 구성합니다. (GitHub Actions 예시 참조)

## 테스트 모범 사례 체크리스트

1. **AAA 패턴 (Arrange-Act-Assert)** 준수
2. **테스트당 하나의 어설션** (가능한 경우)
3. **명확한 테스트 이름**
4. **엣지 케이스 테스트** (빈 값, 경계값)
5. **깨끗한 테스트 데이터** (테스트 간 DB 초기화)
6. **빠른 실행 속도**
7. **결정론적(Deterministic)** 테스트 (Flaky 테스트 제거)

## 리소스

- **Vitest:** https://vitest.dev/
- **Playwright:** https://playwright.dev/
- **k6:** https://k6.io/docs/
- **Pact:** https://docs.pact.io/
- **TestContainers:** https://testcontainers.com/
