# Workflow: Refactoring

## 개요

기존 코드를 개선하는 리팩토링 워크플로우.
**핵심 원칙**: 기능 변경 없이 구조만 개선.

## 리팩토링 유형

| 유형 | 설명 | 위험도 |
|------|------|--------|
| 네이밍 개선 | 변수/함수명 명확화 | 🟢 낮음 |
| 함수 추출 | 긴 함수를 작은 단위로 분리 | 🟢 낮음 |
| 중복 제거 | 반복 코드 통합 | 🟡 중간 |
| 구조 변경 | 모듈/클래스 재구성 | 🟠 높음 |
| 타입 강화 | any → 구체적 타입 | 🟡 중간 |
| 의존성 정리 | 순환 참조 제거 등 | 🟠 높음 |

---

## 단계

### 1️⃣ 리팩토링 대상 선정

**냄새 나는 코드 (Code Smells)**:
- [ ] 긴 함수 (30줄+)
- [ ] 거대한 클래스
- [ ] 중복 코드
- [ ] 긴 매개변수 목록
- [ ] 복잡한 조건문
- [ ] any 타입 남용
- [ ] 순환 참조
- [ ] 미사용 코드

**측정 도구**:
```bash
# 코드 복잡도 체크
npx ts-complexity ./src

# 미사용 export 찾기
npx ts-prune ./src

# 순환 참조 체크
npx madge --circular ./src
```

---

### 2️⃣ 테스트 확인

**⚠️ 필수**: 리팩토링 전 테스트 커버리지 확인

```bash
# 현재 테스트 상태 확인
npm run test -- --coverage

# 관련 테스트 실행
npm run test -- user.service.spec.ts
```

**테스트 부족 시**:
1. 리팩토링 전에 테스트 추가
2. 기존 동작을 검증하는 테스트 작성

---

### 3️⃣ 작은 단위로 분리

**원칙**: 한 번에 하나의 리팩토링만

```markdown
❌ 나쁜 예:
- 함수 추출 + 네이밍 변경 + 타입 수정 (한 커밋에)

✅ 좋은 예:
- 커밋 1: 함수 추출
- 커밋 2: 네이밍 변경  
- 커밋 3: 타입 수정
```

---

### 4️⃣ 리팩토링 패턴

#### 긴 함수 → 함수 추출

```typescript
// Before: 긴 함수
async createOrder(dto: CreateOrderDto) {
  // 30줄의 코드...
  // 재고 확인 로직
  // 결제 처리 로직
  // 주문 생성 로직
  // 알림 발송 로직
}

// After: 의미 있는 단위로 분리
async createOrder(dto: CreateOrderDto) {
  await this.validateStock(dto.items);
  const payment = await this.processPayment(dto.payment);
  const order = await this.saveOrder(dto, payment);
  await this.sendNotification(order);
  return order;
}

private async validateStock(items: OrderItem[]) { /* ... */ }
private async processPayment(payment: PaymentInfo) { /* ... */ }
private async saveOrder(dto: CreateOrderDto, payment: Payment) { /* ... */ }
private async sendNotification(order: Order) { /* ... */ }
```

#### 복잡한 조건문 → 가드 클로즈

```typescript
// Before: 중첩된 조건문
async processRequest(user: User, request: Request) {
  if (user) {
    if (user.isActive) {
      if (request.isValid) {
        // 실제 로직
      } else {
        throw new BadRequestException();
      }
    } else {
      throw new ForbiddenException();
    }
  } else {
    throw new UnauthorizedException();
  }
}

// After: 가드 클로즈 패턴
async processRequest(user: User, request: Request) {
  if (!user) {
    throw new UnauthorizedException();
  }
  if (!user.isActive) {
    throw new ForbiddenException();
  }
  if (!request.isValid) {
    throw new BadRequestException();
  }
  
  // 실제 로직 (들여쓰기 없음)
}
```

#### 중복 코드 → 공통 함수

```typescript
// Before: 중복 코드
class UserService {
  async create(dto: CreateUserDto) {
    const exists = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (exists) throw new ConflictException('Email exists');
    // ...
  }
  
  async update(id: number, dto: UpdateUserDto) {
    const exists = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (exists && exists.id !== id) throw new ConflictException('Email exists');
    // ...
  }
}

// After: 공통 메서드 추출
class UserService {
  async create(dto: CreateUserDto) {
    await this.ensureEmailNotExists(dto.email);
    // ...
  }
  
  async update(id: number, dto: UpdateUserDto) {
    await this.ensureEmailNotExists(dto.email, id);
    // ...
  }
  
  private async ensureEmailNotExists(email: string, excludeId?: number) {
    const exists = await this.prisma.user.findUnique({ where: { email } });
    if (exists && exists.id !== excludeId) {
      throw new ConflictException('Email exists');
    }
  }
}
```

#### any 타입 → 구체적 타입

```typescript
// Before
function processData(data: any): any {
  return data.map((item: any) => item.value);
}

// After
interface DataItem {
  id: number;
  value: string;
}

function processData(data: DataItem[]): string[] {
  return data.map((item) => item.value);
}
```

---

### 5️⃣ 테스트 실행

**매 변경 후 테스트**:

```bash
# 관련 테스트 실행
npm run test -- --watch user.service

# 전체 테스트
npm run test

# 타입 체크
npx tsc --noEmit
```

---

### 6️⃣ 커밋

```bash
# 각 리팩토링 단계별 커밋
git commit -m "refactor(user): extract validateStock method"
git commit -m "refactor(user): simplify conditional with guard clauses"
git commit -m "refactor(user): add strict types to processData"
```

---

### 7️⃣ PR 생성

```markdown
## 리팩토링: [대상]

### 변경 사항
- 긴 함수를 작은 단위로 분리
- 중복 코드 제거
- 타입 강화

### 기능 변경
**없음** (리팩토링만)

### 테스트
- [x] 기존 테스트 모두 통과
- [x] 타입 체크 통과

### Before/After (선택)
간단한 코드 비교나 복잡도 개선 수치
```

---

## 주의사항

1. **기능 변경과 분리**: 리팩토링 PR에 기능 변경 섞지 않기
2. **한 번에 하나씩**: 여러 리팩토링 동시 진행 금지
3. **테스트 필수**: 테스트 없으면 먼저 테스트 추가
4. **점진적으로**: 큰 리팩토링은 여러 PR로 분할

## 리팩토링 하지 말아야 할 때

- 마감 직전
- 테스트 없는 레거시 코드 (테스트 먼저)
- 곧 삭제될 코드
- 동작 이해가 불완전할 때
