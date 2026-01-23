# Unit Testing Patterns (단위 테스트 패턴)

NestJS 서비스, 컨트롤러, 가드, 파이프 및 유틸리티를 테스트하기 위한 상세 패턴입니다.

## 서비스 테스팅

### 기본 서비스 테스트

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException, ConflictException } from '@nestjs/common';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: PrismaService;

  const mockPrismaService = {
    user: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    prisma = module.get<PrismaService>(PrismaService);

    // 각 테스트 전 모의 객체 초기화
    jest.clearAllMocks();
  });

  describe('create', () => {
    const createUserDto = {
      email: 'test@example.com',
      name: 'Test User',
      password: 'password123',
    };

    it('should create a user successfully', async () => {
      const expectedUser = { id: 'uuid-1', ...createUserDto, createdAt: new Date() };
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.user.create.mockResolvedValue(expectedUser);

      const result = await service.create(createUserDto);

      expect(result).toEqual(expectedUser);
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: createUserDto.email,
          name: createUserDto.name,
        }),
      });
    });

    it('should throw ConflictException if email already exists', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({ id: 'existing-id' });

      await expect(service.create(createUserDto)).rejects.toThrow(ConflictException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should return user when found', async () => {
      const expectedUser = { id: 'uuid-1', email: 'test@example.com' };
      mockPrismaService.user.findUnique.mockResolvedValue(expectedUser);

      const result = await service.findOne('uuid-1');

      expect(result).toEqual(expectedUser);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
      });
    });

    it('should throw NotFoundException when user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.findOne('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update user successfully', async () => {
      const existingUser = { id: 'uuid-1', email: 'old@example.com', name: 'Old' };
      const updateDto = { name: 'Updated Name' };
      const updatedUser = { ...existingUser, ...updateDto };

      mockPrismaService.user.findUnique.mockResolvedValue(existingUser);
      mockPrismaService.user.update.mockResolvedValue(updatedUser);

      const result = await service.update('uuid-1', updateDto);

      expect(result.name).toBe('Updated Name');
    });

    it('should throw NotFoundException when updating nonexistent user', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.update('nonexistent', { name: 'New' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('should soft delete user', async () => {
      const existingUser = { id: 'uuid-1', deletedAt: null };
      mockPrismaService.user.findUnique.mockResolvedValue(existingUser);
      mockPrismaService.user.update.mockResolvedValue({ ...existingUser, deletedAt: new Date() });

      await service.remove('uuid-1');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
        data: { deletedAt: expect.any(Date) },
      });
    });
  });
});
```

## 컨트롤러 테스팅

### 기본 컨트롤러 테스트

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { NotFoundException } from '@nestjs/common';

describe('UsersController', () => {
  let controller: UsersController;
  let service: UsersService;

  const mockUsersService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
    service = module.get<UsersService>(UsersService);

    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a user', async () => {
      const dto = { email: 'test@example.com', name: 'Test' };
      const expectedResult = { id: '1', ...dto };
      mockUsersService.create.mockResolvedValue(expectedResult);

      const result = await controller.create(dto);

      expect(result).toEqual(expectedResult);
      expect(service.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('findAll', () => {
    it('should return array of users', async () => {
      const users = [{ id: '1', email: 'test@example.com' }];
      mockUsersService.findAll.mockResolvedValue(users);

      const result = await controller.findAll();

      expect(result).toEqual(users);
    });

    it('should pass query params to service', async () => {
      const query = { page: 1, limit: 10, search: 'test' };
      mockUsersService.findAll.mockResolvedValue([]);

      await controller.findAll(query);

      expect(service.findAll).toHaveBeenCalledWith(query);
    });
  });

  describe('findOne', () => {
    it('should return a user by id', async () => {
      const user = { id: '1', email: 'test@example.com' };
      mockUsersService.findOne.mockResolvedValue(user);

      const result = await controller.findOne('1');

      expect(result).toEqual(user);
    });

    it('should propagate NotFoundException from service', async () => {
      mockUsersService.findOne.mockRejectedValue(new NotFoundException());

      await expect(controller.findOne('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });
});
```

## 가드(Guard) 테스팅

### AuthGuard 테스트

```typescript
import { ExecutionContext } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: Reflector;
  let jwtService: JwtService;

  const mockReflector = {
    getAllAndOverride: jest.fn(),
  };

  const mockJwtService = {
    verify: jest.fn(),
  };

  beforeEach(() => {
    reflector = mockReflector as any;
    jwtService = mockJwtService as any;
    guard = new JwtAuthGuard(reflector, jwtService);

    jest.clearAllMocks();
  });

  const createMockExecutionContext = (token?: string): ExecutionContext => ({
    switchToHttp: () => ({
      getRequest: () => ({
        headers: {
          authorization: token ? `Bearer ${token}` : undefined,
        },
      }),
    }),
    getHandler: () => jest.fn(),
    getClass: () => jest.fn(),
  } as any);

  it('should allow access for public routes', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(true); // IS_PUBLIC_KEY
    const context = createMockExecutionContext();

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
  });

  it('should allow access with valid token', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(false);
    mockJwtService.verify.mockReturnValue({ sub: 'user-id', email: 'test@example.com' });
    const context = createMockExecutionContext('valid-token');

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(jwtService.verify).toHaveBeenCalledWith('valid-token');
  });

  it('should deny access without token', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(false);
    const context = createMockExecutionContext();

    await expect(guard.canActivate(context)).rejects.toThrow();
  });

  it('should deny access with invalid token', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(false);
    mockJwtService.verify.mockImplementation(() => {
      throw new Error('Invalid token');
    });
    const context = createMockExecutionContext('invalid-token');

    await expect(guard.canActivate(context)).rejects.toThrow();
  });
});
```

## 파이프(Pipe) 테스팅

### ValidationPipe 테스트

```typescript
import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { CreateUserDto } from './create-user.dto';

describe('CreateUserDto Validation', () => {
  let validationPipe: ValidationPipe;

  beforeEach(() => {
    validationPipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });
  });

  it('should pass with valid data', async () => {
    const dto = { email: 'test@example.com', name: 'Test', password: 'Pass123!' };

    const result = await validationPipe.transform(dto, {
      type: 'body',
      metatype: CreateUserDto,
    });

    expect(result).toEqual(dto);
  });

  it('should fail with invalid email', async () => {
    const dto = { email: 'invalid-email', name: 'Test', password: 'Pass123!' };

    await expect(
      validationPipe.transform(dto, { type: 'body', metatype: CreateUserDto }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should fail with missing required field', async () => {
    const dto = { email: 'test@example.com' }; // missing name and password

    await expect(
      validationPipe.transform(dto, { type: 'body', metatype: CreateUserDto }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should strip non-whitelisted properties', async () => {
    const dto = {
      email: 'test@example.com',
      name: 'Test',
      password: 'Pass123!',
      admin: true, // non-whitelisted
    };

    await expect(
      validationPipe.transform(dto, { type: 'body', metatype: CreateUserDto }),
    ).rejects.toThrow(BadRequestException);
  });
});
```

## 커스텀 데코레이터 테스팅

```typescript
import { ExecutionContext } from '@nestjs/common';
import { CurrentUser } from './current-user.decorator';

describe('CurrentUser Decorator', () => {
  const mockGetRequest = jest.fn();

  const createMockExecutionContext = (user?: any): ExecutionContext => ({
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as any);

  it('should return user from request', () => {
    const user = { id: '1', email: 'test@example.com' };
    const ctx = createMockExecutionContext(user);
    
    // 팩토리 함수 직접 테스트
    const factory = (data: unknown, ctx: ExecutionContext) => {
      return ctx.switchToHttp().getRequest().user;
    };

    const result = factory(undefined, ctx);

    expect(result).toEqual(user);
  });

  it('should return undefined when no user', () => {
    const ctx = createMockExecutionContext(undefined);
    
    const factory = (data: unknown, ctx: ExecutionContext) => {
      return ctx.switchToHttp().getRequest().user;
    };

    const result = factory(undefined, ctx);

    expect(result).toBeUndefined();
  });
});
```

## 유틸리티 함수 테스팅

```typescript
describe('Utility Functions', () => {
  describe('slugify', () => {
    it('should convert string to slug', () => {
      expect(slugify('Hello World')).toBe('hello-world');
      expect(slugify('Test 123')).toBe('test-123');
      expect(slugify('  Trim  Spaces  ')).toBe('trim-spaces');
    });

    it('should handle special characters', () => {
      expect(slugify('Hello@World!')).toBe('helloworld');
      expect(slugify('한글 테스트')).toBe('한글-테스트');
    });

    it('should handle empty string', () => {
      expect(slugify('')).toBe('');
    });
  });

  describe('formatCurrency', () => {
    it.each([
      [1000, 'KRW', '₩1,000'],
      [1000.5, 'USD', '$1,000.50'],
      [0, 'KRW', '₩0'],
    ])('formatCurrency(%d, %s) should return %s', (amount, currency, expected) => {
      expect(formatCurrency(amount, currency)).toBe(expected);
    });
  });
});
```

## 비동기 코드 테스팅

```typescript
describe('Async Operations', () => {
  // Promise 기반
  it('should resolve with data', async () => {
    const result = await asyncFunction();
    expect(result).toBe('data');
  });

  // Rejection
  it('should reject with error', async () => {
    await expect(asyncFunctionThatFails()).rejects.toThrow('Error message');
  });

  // Fake Timers 사용
  it('should handle delayed operations', async () => {
    jest.useFakeTimers();
    
    const promise = delayedFunction(1000);
    
    jest.advanceTimersByTime(1000);
    
    const result = await promise;
    expect(result).toBe('done');
    
    jest.useRealTimers();
  });

  // Timeout 사용
  it('should complete within timeout', async () => {
    const result = await asyncFunction();
    expect(result).toBeDefined();
  }, 5000); // 5초 타임아웃
});
```

## 테스트 헬퍼

### 팩토리 함수

```typescript
// test/factories/user.factory.ts
export const createMockUser = (overrides = {}) => ({
  id: 'test-uuid',
  email: 'test@example.com',
  name: 'Test User',
  password: 'hashedPassword',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  deletedAt: null,
  ...overrides,
});

export const createMockUsers = (count: number, overrides = {}) =>
  Array.from({ length: count }, (_, i) =>
    createMockUser({ id: `uuid-${i}`, email: `user${i}@example.com`, ...overrides }),
  );

// 테스트에서 사용
it('should return paginated users', async () => {
  const users = createMockUsers(10);
  mockPrismaService.user.findMany.mockResolvedValue(users.slice(0, 5));
  mockPrismaService.user.count.mockResolvedValue(10);

  const result = await service.findAll({ page: 1, limit: 5 });

  expect(result.data).toHaveLength(5);
  expect(result.total).toBe(10);
});
```
