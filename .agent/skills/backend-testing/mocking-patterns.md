# Mocking Patterns (모킹 패턴)

NestJS 애플리케이션을 위한 Jest 모킹 전략입니다.

## Jest Mock 기초

### 함수(Function) Mock

```typescript
// 모의 함수 생성
const mockFn = jest.fn();

// 반환값 지정
const mockFn = jest.fn().mockReturnValue('value');

// 비동기 반환값 지정
const mockFn = jest.fn().mockResolvedValue('async value');

// 거부(Rejection) 지정
const mockFn = jest.fn().mockRejectedValue(new Error('error'));

// 구현 지정
const mockFn = jest.fn().mockImplementation((x) => x * 2);

// 1회성 변형
const mockFn = jest.fn()
  .mockResolvedValueOnce('first')
  .mockResolvedValueOnce('second')
  .mockResolvedValue('default');
```

### Mock 어설션(Assertions)

```typescript
// 호출 여부
expect(mockFn).toHaveBeenCalled();
expect(mockFn).toHaveBeenCalledTimes(2);

// 인자 확인
expect(mockFn).toHaveBeenCalledWith('arg1', 'arg2');
expect(mockFn).toHaveBeenLastCalledWith('lastArg');
expect(mockFn).toHaveBeenNthCalledWith(1, 'firstCallArg');

// 호출되지 않음
expect(mockFn).not.toHaveBeenCalled();

// 반환값 확인
expect(mockFn).toHaveReturnedWith('value');
```

## NestJS 프로바이더 모킹

### 기본 프로바이더 Mock

```typescript
const mockUsersService = {
  create: jest.fn(),
  findAll: jest.fn(),
  findOne: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
};

const module: TestingModule = await Test.createTestingModule({
  controllers: [UsersController],
  providers: [
    {
      provide: UsersService,
      useValue: mockUsersService,
    },
  ],
}).compile();
```

### Factory 사용

```typescript
const module: TestingModule = await Test.createTestingModule({
  providers: [
    UsersService,
    {
      provide: PrismaService,
      useFactory: () => ({
        user: {
          create: jest.fn(),
          findUnique: jest.fn(),
        },
      }),
    },
  ],
}).compile();
```

### Class Mock 사용

```typescript
class MockUsersService {
  create = jest.fn();
  findAll = jest.fn().mockResolvedValue([]);
  findOne = jest.fn();
}

const module: TestingModule = await Test.createTestingModule({
  providers: [
    {
      provide: UsersService,
      useClass: MockUsersService,
    },
  ],
}).compile();
```

## 외부 모듈 모킹

### ConfigService

```typescript
const mockConfigService = {
  get: jest.fn((key: string) => {
    const config = {
      JWT_SECRET: 'test-secret',
      JWT_EXPIRATION: '1h',
      DATABASE_URL: 'postgresql://test:test@localhost/test', // or 'mysql://test:test@localhost/test'
    };
    return config[key];
  }),
  getOrThrow: jest.fn((key: string) => {
    const value = mockConfigService.get(key);
    if (!value) throw new Error(`Config ${key} not found`);
    return value;
  }),
};

// TestingModule에서
{
  provide: ConfigService,
  useValue: mockConfigService,
}
```

### HttpService (Axios)

```typescript
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { AxiosResponse } from 'axios';

const mockHttpService = {
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  delete: jest.fn(),
};

// 성공 응답 Mock
mockHttpService.get.mockReturnValue(
  of({
    data: { id: 1, name: 'Test' },
    status: 200,
    statusText: 'OK',
    headers: {},
    config: {},
  } as AxiosResponse),
);

// 에러 Mock
mockHttpService.get.mockReturnValue(
  throwError(() => ({
    response: { status: 404, data: { message: 'Not found' } },
  })),
);

// TestingModule에서
{
  provide: HttpService,
  useValue: mockHttpService,
}
```

### JwtService

```typescript
const mockJwtService = {
  sign: jest.fn().mockReturnValue('mock-jwt-token'),
  signAsync: jest.fn().mockResolvedValue('mock-jwt-token'),
  verify: jest.fn().mockReturnValue({ sub: 'user-id', email: 'test@example.com' }),
  verifyAsync: jest.fn().mockResolvedValue({ sub: 'user-id', email: 'test@example.com' }),
  decode: jest.fn().mockReturnValue({ sub: 'user-id' }),
};

// TestingModule에서
{
  provide: JwtService,
  useValue: mockJwtService,
}
```

### Cache Manager

```typescript
const mockCacheManager = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  reset: jest.fn(),
};

// 캐시 적중 Mock
mockCacheManager.get.mockResolvedValue({ cached: 'data' });

// 캐시 미스 Mock
mockCacheManager.get.mockResolvedValue(null);

// TestingModule에서
{
  provide: CACHE_MANAGER,
  useValue: mockCacheManager,
}
```

### Bull Queue

```typescript
const mockQueue = {
  add: jest.fn().mockResolvedValue({ id: 'job-1' }),
  process: jest.fn(),
  on: jest.fn(),
  getJob: jest.fn(),
  getJobs: jest.fn(),
};

// TestingModule에서
{
  provide: getQueueToken('email'),
  useValue: mockQueue,
}

// 어설션
expect(mockQueue.add).toHaveBeenCalledWith('send-email', {
  to: 'test@example.com',
  subject: 'Welcome',
});
```

## 모듈 Import 모킹

### jest.mock()

```typescript
// 테스트 파일 최상단에서
jest.mock('../email/email.service');

import { EmailService } from '../email/email.service';

// EmailService는 이제 자동 모킹됨
const mockEmailService = EmailService as jest.Mocked<typeof EmailService>;

beforeEach(() => {
  mockEmailService.prototype.sendEmail = jest.fn().mockResolvedValue(true);
});
```

### 수동 Mock 파일

```typescript
// __mocks__/email.service.ts
export const EmailService = jest.fn().mockImplementation(() => ({
  sendEmail: jest.fn().mockResolvedValue(true),
  sendBulk: jest.fn().mockResolvedValue({ sent: 10, failed: 0 }),
}));

// 테스트에서 - import만 하면 mock 파일이 자동 사용됨
jest.mock('../email/email.service');
```

## 스파이(Spying)

### 메서드 Spy

```typescript
const service = module.get<UsersService>(UsersService);

// 구현 변경 없이 감시
const spy = jest.spyOn(service, 'findOne');

await service.findOne('1');

expect(spy).toHaveBeenCalledWith('1');

// 감시 및 반환값 모킹
jest.spyOn(service, 'findOne').mockResolvedValue({ id: '1', email: 'test@example.com' });

// 감시 및 구현 모킹
jest.spyOn(service, 'validate').mockImplementation((data) => {
  return { ...data, validated: true };
});

// 원본 복구
spy.mockRestore();
```

### 프로토타입 Spy

```typescript
// 인스턴스화 전 클래스 메서드 감시
jest.spyOn(UsersService.prototype, 'create').mockResolvedValue({ id: '1' });
```

## 날짜/시간 모킹

```typescript
describe('Time-sensitive tests', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-15T10:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should use mocked date', () => {
    const now = new Date();
    expect(now.toISOString()).toBe('2024-01-15T10:00:00.000Z');
  });

  it('should handle setTimeout', async () => {
    const callback = jest.fn();
    setTimeout(callback, 1000);

    jest.advanceTimersByTime(1000);

    expect(callback).toHaveBeenCalled();
  });

  it('should run all timers', () => {
    const callback = jest.fn();
    setTimeout(callback, 5000);
    setInterval(callback, 1000);

    jest.runAllTimers();

    expect(callback).toHaveBeenCalled();
  });
});
```

## 환경 변수 모킹

```typescript
describe('Environment-dependent tests', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should use test environment', () => {
    process.env.NODE_ENV = 'test';
    process.env.API_KEY = 'test-key';

    // 새 환경 변수를 반영하기 위해 모듈 다시 import
    const { config } = require('../config');

    expect(config.apiKey).toBe('test-key');
  });
});
```

## 부분 모킹 (Partial Mocks)

```typescript
// 특정 메서드만 모킹, 나머지는 실제 구현 유지
jest.mock('../users/users.service', () => {
  const actual = jest.requireActual('../users/users.service');
  return {
    ...actual,
    UsersService: jest.fn().mockImplementation(() => ({
      ...new actual.UsersService(),
      sendNotification: jest.fn(), // 이것만 모킹
    })),
  };
});
```

## Mock 리셋 & 클리어

```typescript
beforeEach(() => {
  // 호출 기록 삭제, 구현 유지
  jest.clearAllMocks();

  // 초기 상태로 리셋 (반환값도 제거)
  jest.resetAllMocks();

  // 원본 구현 복구
  jest.restoreAllMocks();
});

// 또는 특정 mock에 대해
mockFn.mockClear();
mockFn.mockReset();
mockFn.mockRestore();
```

## 일반적인 패턴

### 리포지토리 패턴 Mock

```typescript
const createMockRepository = <T>() => ({
  find: jest.fn(),
  findOne: jest.fn(),
  findOneOrFail: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  count: jest.fn(),
  createQueryBuilder: jest.fn(() => ({
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn(),
    getOne: jest.fn(),
    getManyAndCount: jest.fn(),
  })),
});

// 사용
const mockUserRepository = createMockRepository<User>();
```

### 이벤트 이미터(Event Emitter) Mock

```typescript
const mockEventEmitter = {
  emit: jest.fn(),
  on: jest.fn(),
  once: jest.fn(),
  removeListener: jest.fn(),
};

// 이벤트 방출 검증
expect(mockEventEmitter.emit).toHaveBeenCalledWith('user.created', {
  userId: '1',
  email: 'test@example.com',
});
```

### Logger Mock

```typescript
const mockLogger = {
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
};

// TestingModule에서
{
  provide: Logger,
  useValue: mockLogger,
}

// 어설션
expect(mockLogger.error).toHaveBeenCalledWith(
  expect.stringContaining('Failed to create user'),
  expect.any(String), // 스택 트레이스
);
```

## 문제 해결 (Troubleshooting)

### Mock이 작동하지 않음

```typescript
// 문제: import 후에 Mock 정의
import { Service } from './service';
jest.mock('./service'); // ❌ 너무 늦음

// 해결: import 전에 Mock 정의 (자동 호이스팅되지만 명시적인 것이 명확함)
jest.mock('./service');
import { Service } from './service'; // ✅
```

### 비동기 Mock이 해결되지 않음

```typescript
// 문제: mockResolvedValue 누락
mockService.findOne.mockReturnValue(user); // ❌ 동기용
await service.findOne('1'); // 멈추거나 Promise 반환

// 해결: 비동기용 mockResolvedValue 사용
mockService.findOne.mockResolvedValue(user); // ✅
```

### Mock 상태 누수

```typescript
// 문제: 테스트 간에 Mock 상태 유지됨
// 해결: beforeEach에서 클리어
beforeEach(() => {
  jest.clearAllMocks();
});
```
