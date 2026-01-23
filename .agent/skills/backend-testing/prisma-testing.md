# Prisma Testing Patterns (Prisma 테스팅 패턴)

Prisma 기반 리포지토리 및 서비스를 테스트하기 위한 전략입니다.

## 모킹 전략

### 전략 1: 수동 Mock 객체 (단위 테스트용으로 권장)

```typescript
// test/mocks/prisma.mock.ts
export const mockPrismaService = {
  user: {
    create: jest.fn(),
    createMany: jest.fn(),
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
    count: jest.fn(),
    aggregate: jest.fn(),
    groupBy: jest.fn(),
  },
  post: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  // 필요에 따라 다른 모델 추가
  $transaction: jest.fn(),
  $connect: jest.fn(),
  $disconnect: jest.fn(),
  $queryRaw: jest.fn(),
  $executeRaw: jest.fn(),
};

// 모든 모의 객체 초기화
export const resetPrismaMocks = () => {
  Object.values(mockPrismaService).forEach((model) => {
    if (typeof model === 'object') {
      Object.values(model).forEach((method) => {
        if (jest.isMockFunction(method)) {
          method.mockReset();
        }
      });
    } else if (jest.isMockFunction(model)) {
      model.mockReset();
    }
  });
};
```

### 전략 2: jest-mock-extended를 사용한 Deep Mock

```typescript
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';

// 타입 안전한 Deep Mock 생성
export type MockPrismaClient = DeepMockProxy<PrismaClient>;

export const createMockPrismaClient = (): MockPrismaClient => {
  return mockDeep<PrismaClient>();
};

// 테스트에서 사용
describe('UsersService', () => {
  let service: UsersService;
  let prisma: MockPrismaClient;

  beforeEach(async () => {
    prisma = createMockPrismaClient();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should create user', async () => {
    const user = { id: '1', email: 'test@example.com', name: 'Test' };
    prisma.user.create.mockResolvedValue(user);

    const result = await service.create({ email: 'test@example.com', name: 'Test' });

    expect(result).toEqual(user);
  });
});
```

### 전략 3: Singleton Mock 모듈

```typescript
// test/mocks/prisma.singleton.ts
import { PrismaClient } from '@prisma/client';
import { mockDeep, mockReset, DeepMockProxy } from 'jest-mock-extended';

import prisma from '../../src/prisma/client';

jest.mock('../../src/prisma/client', () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));

beforeEach(() => {
  mockReset(prismaMock);
});

export const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
```

## 트랜잭션 테스팅

### 콜백을 사용하는 $transaction 테스트

```typescript
describe('Transaction Operations', () => {
  it('should execute operations in transaction', async () => {
    const user = { id: '1', email: 'test@example.com' };
    const profile = { id: '1', userId: '1', bio: 'Test bio' };

    // 모의 클라이언트로 콜백을 실행하도록 트랜잭션 모킹
    mockPrismaService.$transaction.mockImplementation(async (callback) => {
      return callback(mockPrismaService);
    });
    mockPrismaService.user.create.mockResolvedValue(user);
    mockPrismaService.profile.create.mockResolvedValue(profile);

    const result = await service.createUserWithProfile({
      email: 'test@example.com',
      bio: 'Test bio',
    });

    expect(mockPrismaService.$transaction).toHaveBeenCalled();
    expect(result).toEqual({ user, profile });
  });

  it('should rollback on error', async () => {
    mockPrismaService.$transaction.mockImplementation(async (callback) => {
      return callback(mockPrismaService);
    });
    mockPrismaService.user.create.mockResolvedValue({ id: '1' });
    mockPrismaService.profile.create.mockRejectedValue(new Error('DB Error'));

    await expect(
      service.createUserWithProfile({ email: 'test@example.com', bio: 'Test' }),
    ).rejects.toThrow('DB Error');
  });
});
```

### 배열을 사용하는 $transaction 테스트

```typescript
it('should execute batch operations', async () => {
  const users = [
    { id: '1', email: 'user1@example.com' },
    { id: '2', email: 'user2@example.com' },
  ];

  mockPrismaService.$transaction.mockResolvedValue(users);

  const result = await service.createManyUsers([
    { email: 'user1@example.com' },
    { email: 'user2@example.com' },
  ]);

  expect(mockPrismaService.$transaction).toHaveBeenCalledWith([
    expect.objectContaining({ model: 'User', action: 'create' }),
    expect.objectContaining({ model: 'User', action: 'create' }),
  ]);
  expect(result).toEqual(users);
});
```

## Prisma 에러 테스팅

```typescript
import { Prisma } from '@prisma/client';

describe('Prisma Error Handling', () => {
  it('should handle unique constraint violation', async () => {
    const prismaError = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '5.0.0',
      meta: { target: ['email'] },
    });
    mockPrismaService.user.create.mockRejectedValue(prismaError);

    await expect(service.create({ email: 'duplicate@example.com' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('should handle record not found', async () => {
    const prismaError = new Prisma.PrismaClientKnownRequestError('Record not found', {
      code: 'P2025',
      clientVersion: '5.0.0',
    });
    mockPrismaService.user.update.mockRejectedValue(prismaError);

    await expect(service.update('nonexistent', { name: 'New' })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('should handle foreign key constraint', async () => {
    const prismaError = new Prisma.PrismaClientKnownRequestError('Foreign key constraint failed', {
      code: 'P2003',
      clientVersion: '5.0.0',
      meta: { field_name: 'authorId' },
    });
    mockPrismaService.post.create.mockRejectedValue(prismaError);

    await expect(
      service.createPost({ title: 'Test', authorId: 'nonexistent' }),
    ).rejects.toThrow(BadRequestException);
  });
});
```

### Prisma 에러 코드 참조

| 코드 | 설명 | 권장 예외 |
|------|-------------|---------------------|
| P2000 | 값이 너무 김 | BadRequestException |
| P2001 | 레코드를 찾을 수 없음 (where) | NotFoundException |
| P2002 | 고유 제약 조건 실패 | ConflictException |
| P2003 | 외래 키 제약 조건 | BadRequestException |
| P2025 | 레코드를 찾을 수 없음 (update/delete) | NotFoundException |

## Include/Select 테스팅

```typescript
describe('Query with Relations', () => {
  it('should fetch user with posts', async () => {
    const userWithPosts = {
      id: '1',
      email: 'test@example.com',
      posts: [
        { id: '1', title: 'Post 1' },
        { id: '2', title: 'Post 2' },
      ],
    };
    mockPrismaService.user.findUnique.mockResolvedValue(userWithPosts);

    const result = await service.findOneWithPosts('1');

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: '1' },
      include: { posts: true },
    });
    expect(result.posts).toHaveLength(2);
  });

  it('should select specific fields', async () => {
    const partialUser = { id: '1', email: 'test@example.com' };
    mockPrismaService.user.findUnique.mockResolvedValue(partialUser);

    const result = await service.findOneBasic('1');

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: '1' },
      select: { id: true, email: true },
    });
    expect(result).not.toHaveProperty('password');
  });
});
```

## 페이지네이션 테스팅

```typescript
describe('Pagination', () => {
  it('should return paginated results', async () => {
    const users = createMockUsers(5);
    mockPrismaService.user.findMany.mockResolvedValue(users);
    mockPrismaService.user.count.mockResolvedValue(100);

    const result = await service.findAll({ page: 1, limit: 5 });

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      skip: 0,
      take: 5,
      orderBy: { createdAt: 'desc' },
    });
    expect(result).toEqual({
      data: users,
      meta: {
        total: 100,
        page: 1,
        limit: 5,
        totalPages: 20,
      },
    });
  });

  it('should calculate correct offset for page 3', async () => {
    mockPrismaService.user.findMany.mockResolvedValue([]);
    mockPrismaService.user.count.mockResolvedValue(100);

    await service.findAll({ page: 3, limit: 10 });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 20, // (3-1) * 10
        take: 10,
      }),
    );
  });
});
```

## 소프트 삭제 테스팅

```typescript
describe('Soft Delete', () => {
  it('should set deletedAt on soft delete', async () => {
    const user = { id: '1', deletedAt: null };
    mockPrismaService.user.findUnique.mockResolvedValue(user);
    mockPrismaService.user.update.mockResolvedValue({ ...user, deletedAt: new Date() });

    await service.softDelete('1');

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: '1' },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it('should filter soft-deleted records by default', async () => {
    mockPrismaService.user.findMany.mockResolvedValue([]);

    await service.findAll();

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deletedAt: null },
      }),
    );
  });

  it('should include soft-deleted when requested', async () => {
    mockPrismaService.user.findMany.mockResolvedValue([]);

    await service.findAll({ includeDeleted: true });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.not.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      }),
    );
  });

  it('should restore soft-deleted record', async () => {
    const deletedUser = { id: '1', deletedAt: new Date() };
    mockPrismaService.user.findUnique.mockResolvedValue(deletedUser);
    mockPrismaService.user.update.mockResolvedValue({ ...deletedUser, deletedAt: null });

    await service.restore('1');

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: '1' },
      data: { deletedAt: null },
    });
  });
});
```

## Raw 쿼리 테스팅

```typescript
describe('Raw Queries', () => {
  it('should execute raw query safely', async () => {
    const stats = [{ count: 10, status: 'active' }];
    mockPrismaService.$queryRaw.mockResolvedValue(stats);

    const result = await service.getStatusStats();

    expect(prisma.$queryRaw).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.stringContaining('SELECT'),
      ]),
    );
    expect(result).toEqual(stats);
  });

  it('should use parameterized query', async () => {
    mockPrismaService.$queryRaw.mockResolvedValue([{ id: '1' }]);

    await service.findByEmail('test@example.com');

    // Prisma.sql 템플릿 태그가 사용되었는지 확인 (파라미터화됨)
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });
});
```

## 실제 데이터베이스를 사용한 통합 테스트

통합 테스트에 대해서는 `references/integration-testing.md`를 참조하세요.

```typescript
// 테스트 DB를 사용한 빠른 예제
describe('UsersService (Integration)', () => {
  let service: UsersService;
  let prisma: PrismaService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [UsersService, PrismaService],
    }).compile();

    service = module.get<UsersService>(UsersService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  beforeEach(async () => {
    // 각 테스트 전 데이터베이스 정리
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('should create and retrieve user', async () => {
    const created = await service.create({ email: 'test@example.com', name: 'Test' });
    const found = await service.findOne(created.id);

    expect(found).toMatchObject({ email: 'test@example.com', name: 'Test' });
  });
});
```
