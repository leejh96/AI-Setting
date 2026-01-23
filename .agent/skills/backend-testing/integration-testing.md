# Integration Testing Patterns (통합 테스트 패턴)

실제 HTTP 요청과 데이터베이스 상호작용을 통한 NestJS 애플리케이션 테스팅.

## E2E 테스트 설정

### jest-e2e.json 구성

```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": ".",
  "testEnvironment": "node",
  "testRegex": ".e2e-spec.ts$",
  "transform": {
    "^.+\\.(t|j)s$": "ts-jest"
  },
  "moduleNameMapper": {
    "^@/(.*)$": "<rootDir>/../src/$1"
  },
  "setupFilesAfterEnv": ["<rootDir>/setup.ts"],
  "testTimeout": 30000
}
```

### 테스트 설정 파일

```typescript
// test/setup.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

beforeAll(async () => {
  // 테스트 데이터베이스 연결
  await prisma.$connect();
});

afterAll(async () => {
  // 모든 테스트 후 연결 해제
  await prisma.$disconnect();
});

// 전역 테스트 유틸리티
global.prisma = prisma;
```

## 기본 E2E 테스트 구조

```typescript
// test/users.e2e-spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('UsersController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    
    // 프로덕션과 동일한 파이프 적용
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    prisma = app.get<PrismaService>(PrismaService);

    await app.init();
  });

  beforeEach(async () => {
    // 각 테스트 전 데이터베이스 정리
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  describe('POST /users', () => {
    it('should create a user', () => {
      return request(app.getHttpServer())
        .post('/users')
        .send({
          email: 'test@example.com',
          name: 'Test User',
          password: 'Password123!',
        })
        .expect(201)
        .expect((res) => {
          expect(res.body).toMatchObject({
            email: 'test@example.com',
            name: 'Test User',
          });
          expect(res.body.id).toBeDefined();
          expect(res.body.password).toBeUndefined(); // 비밀번호는 노출되지 않아야 함
        });
    });

    it('should return 400 for invalid email', () => {
      return request(app.getHttpServer())
        .post('/users')
        .send({
          email: 'invalid-email',
          name: 'Test',
          password: 'Password123!',
        })
        .expect(400)
        .expect((res) => {
          expect(res.body.message).toContain('email');
        });
    });

    it('should return 409 for duplicate email', async () => {
      // 첫 번째 사용자 생성
      await request(app.getHttpServer())
        .post('/users')
        .send({
          email: 'test@example.com',
          name: 'First User',
          password: 'Password123!',
        });

      // 중복 시도
      return request(app.getHttpServer())
        .post('/users')
        .send({
          email: 'test@example.com',
          name: 'Second User',
          password: 'Password123!',
        })
        .expect(409);
    });
  });

  describe('GET /users', () => {
    beforeEach(async () => {
      // 테스트 데이터 시딩
      await prisma.user.createMany({
        data: [
          { email: 'user1@example.com', name: 'User 1', password: 'hash1' },
          { email: 'user2@example.com', name: 'User 2', password: 'hash2' },
          { email: 'user3@example.com', name: 'User 3', password: 'hash3' },
        ],
      });
    });

    it('should return paginated users', () => {
      return request(app.getHttpServer())
        .get('/users')
        .query({ page: 1, limit: 2 })
        .expect(200)
        .expect((res) => {
          expect(res.body.data).toHaveLength(2);
          expect(res.body.meta.total).toBe(3);
          expect(res.body.meta.totalPages).toBe(2);
        });
    });

    it('should filter users by search', () => {
      return request(app.getHttpServer())
        .get('/users')
        .query({ search: 'user1' })
        .expect(200)
        .expect((res) => {
          expect(res.body.data).toHaveLength(1);
          expect(res.body.data[0].email).toBe('user1@example.com');
        });
    });
  });

  describe('GET /users/:id', () => {
    let userId: string;

    beforeEach(async () => {
      const user = await prisma.user.create({
        data: { email: 'test@example.com', name: 'Test', password: 'hash' },
      });
      userId = user.id;
    });

    it('should return user by id', () => {
      return request(app.getHttpServer())
        .get(`/users/${userId}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.id).toBe(userId);
          expect(res.body.email).toBe('test@example.com');
        });
    });

    it('should return 404 for nonexistent user', () => {
      return request(app.getHttpServer())
        .get('/users/nonexistent-id')
        .expect(404);
    });
  });

  describe('PATCH /users/:id', () => {
    let userId: string;

    beforeEach(async () => {
      const user = await prisma.user.create({
        data: { email: 'test@example.com', name: 'Original', password: 'hash' },
      });
      userId = user.id;
    });

    it('should update user', () => {
      return request(app.getHttpServer())
        .patch(`/users/${userId}`)
        .send({ name: 'Updated Name' })
        .expect(200)
        .expect((res) => {
          expect(res.body.name).toBe('Updated Name');
          expect(res.body.email).toBe('test@example.com'); // 변경되지 않음
        });
    });
  });

  describe('DELETE /users/:id', () => {
    let userId: string;

    beforeEach(async () => {
      const user = await prisma.user.create({
        data: { email: 'test@example.com', name: 'Test', password: 'hash' },
      });
      userId = user.id;
    });

    it('should soft delete user', async () => {
      await request(app.getHttpServer())
        .delete(`/users/${userId}`)
        .expect(204);

      // 소프트 삭제 검증
      const user = await prisma.user.findUnique({ where: { id: userId } });
      expect(user.deletedAt).not.toBeNull();
    });
  });
});
```

## 인증 테스팅

```typescript
describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken: string;

  beforeAll(async () => {
    // ... 앱 설정
  });

  describe('POST /auth/register', () => {
    it('should register new user', () => {
      return request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'new@example.com',
          password: 'Password123!',
          name: 'New User',
        })
        .expect(201)
        .expect((res) => {
          expect(res.body.accessToken).toBeDefined();
          expect(res.body.user.email).toBe('new@example.com');
        });
    });
  });

  describe('POST /auth/login', () => {
    beforeEach(async () => {
      // 알려진 비밀번호로 사용자 생성
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'test@example.com',
          password: 'Password123!',
          name: 'Test',
        });
    });

    it('should login with valid credentials', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'test@example.com',
          password: 'Password123!',
        })
        .expect(200);

      expect(response.body.accessToken).toBeDefined();
      accessToken = response.body.accessToken;
    });

    it('should return 401 with invalid password', () => {
      return request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'test@example.com',
          password: 'WrongPassword',
        })
        .expect(401);
    });
  });

  describe('Protected Routes', () => {
    beforeEach(async () => {
      // 로그인하고 토큰 획득
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'test@example.com',
          password: 'Password123!',
        });
      accessToken = response.body.accessToken;
    });

    it('should access protected route with valid token', () => {
      return request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.email).toBe('test@example.com');
        });
    });

    it('should return 401 without token', () => {
      return request(app.getHttpServer())
        .get('/users/me')
        .expect(401);
    });

    it('should return 401 with invalid token', () => {
      return request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });

    it('should return 401 with expired token', () => {
      const expiredToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'; // 만료된 JWT
      return request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);
    });
  });
});
```

## 테스트 데이터베이스를 사용한 테스팅

### 테스트 DB를 위한 Docker 사용

```typescript
// test/test-database.ts
import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';

const TEST_DATABASE_URL = 'postgresql://test:test@localhost:5433/test_db';
// MySQL: 'mysql://test:test@localhost:3307/test_db'

export const setupTestDatabase = async () => {
  // 테스트 데이터베이스 컨테이너 시작
  execSync('docker-compose -f docker-compose.test.yml up -d', { stdio: 'inherit' });

  // 데이터베이스 준비 대기
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // 마이그레이션 실행
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
};

export const teardownTestDatabase = async () => {
  execSync('docker-compose -f docker-compose.test.yml down -v', { stdio: 'inherit' });
};

export const cleanDatabase = async (prisma: PrismaClient) => {
  const provider = (prisma as any)._activeProvider; // 내부 API 사용 또는 config 확인

  if (provider === 'postgresql') {
    // 외래 키를 고려하여 삭제 (PostgreSQL)
    const tablenames = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname='public'
    `;

    for (const { tablename } of tablenames) {
      if (tablename !== '_prisma_migrations') {
        await prisma.$executeRawUnsafe(`TRUNCATE TABLE "public"."${tablename}" CASCADE;`);
      }
    }
  } else if (provider === 'mysql') {
    // MySQL 초기화
    await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0;');
    
    const tablenames = await prisma.$queryRaw<Array<{ TABLE_NAME: string }>>`
      SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema = DATABASE()
    `;

    for (const { TABLE_NAME } of tablenames) {
      if (TABLE_NAME !== '_prisma_migrations') {
        await prisma.$executeRawUnsafe(`TRUNCATE TABLE \`${TABLE_NAME}\`;`);
      }
    }
    
    await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1;');
  }
};
```

### docker-compose.test.yml

```yaml
version: '3.8'
services:
  test-db:
    image: postgres:15
    environment:
      POSTGRES_USER: test
      POSTGRES_PASSWORD: test
      POSTGRES_DB: test_db
    ports:
      - '5433:5432'
    tmpfs:
      - /var/lib/postgresql/data  # 속도를 위해 인메모리 사용

  # MySQL 사용 시
  # test-db-mysql:
  #   image: mysql:8.0
  #   environment:
  #     MYSQL_USER: test
  #     MYSQL_PASSWORD: test
  #     MYSQL_DATABASE: test_db
  #     MYSQL_ROOT_PASSWORD: root
  #   ports:
  #     - '3307:3306'
  #   tmpfs:
  #     - /var/lib/mysql
```

## 파일 업로드 테스팅

```typescript
describe('File Upload (e2e)', () => {
  it('should upload file', () => {
    return request(app.getHttpServer())
      .post('/files/upload')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', Buffer.from('test content'), 'test.txt')
      .expect(201)
      .expect((res) => {
        expect(res.body.filename).toBeDefined();
        expect(res.body.url).toBeDefined();
      });
  });

  it('should reject oversized file', () => {
    const largeBuffer = Buffer.alloc(10 * 1024 * 1024); // 10MB
    return request(app.getHttpServer())
      .post('/files/upload')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', largeBuffer, 'large.txt')
      .expect(413);
  });

  it('should reject invalid file type', () => {
    return request(app.getHttpServer())
      .post('/files/upload')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', Buffer.from('test'), 'test.exe')
      .expect(400);
  });
});
```

## WebSocket 테스팅

```typescript
import { io, Socket } from 'socket.io-client';

describe('WebSocket (e2e)', () => {
  let socket: Socket;

  beforeEach((done) => {
    socket = io('http://localhost:3000', {
      auth: { token: accessToken },
    });
    socket.on('connect', done);
  });

  afterEach(() => {
    socket.disconnect();
  });

  it('should receive message event', (done) => {
    socket.on('message', (data) => {
      expect(data).toMatchObject({ content: 'Hello' });
      done();
    });

    socket.emit('sendMessage', { content: 'Hello' });
  });

  it('should join room', (done) => {
    socket.emit('joinRoom', { roomId: 'test-room' });

    socket.on('roomJoined', (data) => {
      expect(data.roomId).toBe('test-room');
      done();
    });
  });
});
```

## 외부 서비스 테스팅 (Mock 사용)

```typescript
// test/mocks/external-service.mock.ts
import * as nock from 'nock';

export const mockExternalApi = () => {
  nock('https://api.external.com')
    .get('/users/123')
    .reply(200, { id: '123', name: 'External User' });

  nock('https://api.external.com')
    .post('/notifications')
    .reply(201, { sent: true });
};

export const cleanupMocks = () => {
  nock.cleanAll();
};

// 테스트 내 사용
describe('ExternalService Integration', () => {
  beforeEach(() => {
    mockExternalApi();
  });

  afterEach(() => {
    cleanupMocks();
  });

  it('should fetch external user', async () => {
    const response = await request(app.getHttpServer())
      .get('/external/users/123')
      .expect(200);

    expect(response.body.name).toBe('External User');
  });
});
```

## E2E에서의 성능 테스팅

```typescript
describe('Performance', () => {
  it('should respond within 200ms', async () => {
    const start = Date.now();

    await request(app.getHttpServer())
      .get('/users')
      .expect(200);

    const duration = Date.now() - start;
    expect(duration).toBeLessThan(200);
  });

  it('should handle concurrent requests', async () => {
    const requests = Array.from({ length: 10 }, () =>
      request(app.getHttpServer()).get('/users'),
    );

    const responses = await Promise.all(requests);

    responses.forEach((res) => {
      expect(res.status).toBe(200);
    });
  });
});
```
