---
name: backend-testing
description: Jest와 Prisma를 사용하여 NestJS, Express, TypeScript 백엔드에 대한 테스트를 작성하고 검토합니다. 단위 테스트, 통합 테스트 작성, 서비스 모킹, 컨트롤러/서비스/리포지토리 테스트, 또는 테스트 커버리지 개선 시 사용합니다. "테스트 작성", "테스트 커버리지", "모킹", "jest", "spec 파일", "단위 테스트", "통합 테스트" 또는 Node.js 백엔드 테스트 관련 요청 시 트리거됩니다.
---

# 백엔드 테스팅 스킬

Jest와 Prisma를 사용하여 NestJS/Express 백엔드를 위한 고품질 테스트를 생성합니다.

## 사용 시점

- 서비스, 컨트롤러 또는 유틸리티에 대한 단위 테스트 작성
- 실제/모의 데이터베이스를 사용한 통합 테스트 생성
- Prisma, 외부 서비스 또는 모듈 모킹
- 완전성을 위한 기존 테스트 검토
- 테스트 커버리지 개선
- 테스트 구성 설정

## 빠른 참조

### 테스트 파일 명명 및 위치

```
src/
├── users/
│   ├── users.service.ts
│   ├── users.service.spec.ts      # 단위 테스트 (같은 디렉토리)
│   ├── users.controller.ts
│   └── users.controller.spec.ts
test/
├── users.e2e-spec.ts              # E2E 테스트
└── jest-e2e.json
```

### 테스트 구조 (AAA 패턴)

```typescript
describe('UsersService', () => {
  describe('create', () => {
    it('should create user with valid data', async () => {
      // Arrange (준비)
      const dto = { email: 'test@example.com', name: 'Test' };
      
      // Act (실행)
      const result = await service.create(dto);
      
      // Assert (검증)
      expect(result).toMatchObject(dto);
      expect(result.id).toBeDefined();
    });
  });
});
```

### NestJS 테스팅 모듈 설정

```typescript
import { Test, TestingModule } from '@nestjs/testing';

let service: UsersService;
let prisma: PrismaService;

beforeEach(async () => {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      UsersService,
      {
        provide: PrismaService,
        useValue: mockPrismaService,  // Prisma 모킹
      },
    ],
  }).compile();

  service = module.get<UsersService>(UsersService);
  prisma = module.get<PrismaService>(PrismaService);
});
```

### Prisma 모킹 (단위 테스트)

```typescript
const mockPrismaService = {
  user: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  $transaction: jest.fn((callback) => callback(mockPrismaService)),
};
```

## 테스트 피라미드 (70-20-10)

| 유형 | 비율 | 속도 | 범위 |
|------|-------|-------|-------|
| 단위 (Unit) | 70% | 빠름 (<10ms) | 단일 함수/클래스 |
| 통합 (Integration) | 20% | 보통 (<100ms) | 모듈 + DB |
| E2E | 10% | 느림 (>1s) | 전체 API 흐름 |

## 명령어

```bash
# 모든 테스트 실행
npm test

# 와치 모드 (변경 감지)
npm run test:watch

# 커버리지 레포트
npm run test:cov

# E2E 테스트
npm run test:e2e

# 특정 파일 테스트
npm test -- users.service.spec.ts
```

## 참조 파일

상세한 패턴과 예시는 다음을 참조하세요:

- **`references/unit-testing.md`** - 서비스, 컨트롤러, 가드, 파이프 테스트 패턴
- **`references/prisma-testing.md`** - Prisma 모킹 전략, 트랜잭션 테스트
- **`references/integration-testing.md`** - Supertest, TestingModule, 데이터베이스 설정
- **`references/mocking-patterns.md`** - Jest 모킹, 스파이, 의존성 주입 모킹

## 워크플로우

1. **테스트 유형 식별** - 단위, 통합, 또는 E2E?
2. **참조 확인** - 관련 참조 파일을 로드하여 패턴 확인
3. **테스트 작성** - AAA 패턴 준수, 서술적인 이름 사용
4. **테스트 실행** - `npm test -- <file>`로 검증
5. **필요 시 수정** - 통과할 때까지 반복

## 핵심 원칙

- **단일 어설션 집중** - 각 테스트는 하나의 동작만 검증
- **서술적인 이름** - `should throw NotFoundException when user not found` (사용자를 찾을 수 없을 때 NotFoundException을 던져야 함)
- **고립된 테스트** - 테스트 간 상태 공유 금지
- **외부 의존성 모킹** - Prisma, HTTP 클라이언트, 서드파티 서비스
- **엣지 케이스 테스트** - Null, undefined, 빈 값, 경계값
- **불안정한 테스트(Flaky tests) 방지** - 타임아웃 회피, 적절한 비동기 처리 사용
