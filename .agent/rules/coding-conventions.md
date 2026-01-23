---
trigger: always_on
---

# Coding Conventions

## 언어 및 런타임

- **Node.js** (v22 LTS)
- **TypeScript** 5.x (strict mode)

## 네이밍 컨벤션

### 파일명
- **케밥 케이스** 사용: `user-service.ts`, `create-order.dto.ts`
- 테스트 파일: `*.spec.ts` (unit), `*.e2e-spec.ts` (e2e)

### 변수 및 함수
- **camelCase**: `getUserById`, `isActive`, `orderCount`
- Boolean 변수: `is`, `has`, `can`, `should` 접두사
- 상수: **UPPER_SNAKE_CASE** (`MAX_RETRY_COUNT`)

### 클래스 및 인터페이스
- **PascalCase**: `UserService`, `CreateOrderDto`
- Interface: `I` 접두사 사용
- DTO: `*Dto` 접미사
- Entity: `*Entity` 접미사 (선택적)

### 데이터베이스
- 테이블명: **UPPER_SNAKE_CASE** (`ORDER_ITEM`)
- 컬럼명: **UPPER_SNAKE_CASE** (`CREATED_AT`, `USER_ID`)
- 인덱스: `IDX_{table}_{columns}` (`idx_users_email`)
- FK: `FK_{table}_{ref_table}` (`fk_orders_users`)

## 코드 스타일

### Import 순서
```typescript
// 1. Node.js 내장 모듈
import { readFile } from 'fs/promises';

// 2. 외부 패키지
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// 3. 내부 모듈 (절대 경로)
import { UserService } from '@/modules/user/user.service';

// 4. 상대 경로
import { CreateUserDto } from './dto/create-user.dto';
```

### 함수 작성
- 한 함수는 한 가지 일만 수행
- 함수 길이: 30줄 이하 권장
- Early return 패턴 사용
- 매개변수 3개 초과 시 객체로 전달

### 에러 처리
**절대 Swagger를 사용하지 말 것**
Exception 객체가 있는 경우 RESPONSE와 조합해서 사용
```
thorw new Exception(RESPONSE.FAIL)
```

Exception 객체가 없는 경우 기본 제공 에러 사용
```typescript
// ✅ 커스텀 에러 클래스 사용
throw new NotFoundException(`User #${id} not found`);

// ✅ 에러 메시지에 컨텍스트 포함
throw new BadRequestException(`Invalid email format: ${email}`);

// ❌ 제네릭 에러 사용 금지
throw new Error('Something went wrong');
```

### 주석
- 코드로 설명 가능하면 주석 생략
- TODO, FIXME는 이슈 번호와 함께: `// TODO(#123): Implement caching`
- JSDoc은 public API에만 작성

## Git 컨벤션

### 브랜치
- `main` - 프로덕션
- `develop` - 개발
- `feature/{issue-number}-{description}`
- `fix/{issue-number}-{description}`
- `hotfix/{issue-number}-{description}`

### 커밋 메시지
```
<type>(<scope>): <subject>

<body>

<footer>
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`
