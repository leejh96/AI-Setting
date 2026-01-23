# Backend Code Quality (백엔드 코드 품질)

SOLID 원칙, 디자인 패턴, 클린 코드 관행 및 리팩토링 전략 (2025).

## SOLID 원칙

### 단일 책임 원칙 (SRP)
**개념:** 클래스나 모듈은 변경해야 할 이유가 단 하나여야 한다.
사용자 인증, 이메일 발송, 리포트 생성을 분리된 클래스(`AuthService`, `EmailService`, `ReportService`)로 관리합니다.

### 개방-폐쇄 원칙 (OCP)
**개념:** 확장에는 열려 있고, 수정에는 닫혀 있어야 한다.
새로운 결제 수단(PayPal, Stripe)을 추가할 때 기존 코드를 수정(`if/else`)하는 대신, 인터페이스(`PaymentStrategy`)를 구현한 새 클래스를 추가하는 방식을 사용합니다.

### 리스코프 치환 원칙 (LSP)
**개념:** 자식 클래스는 부모 클래스를 대체할 수 있어야 한다.
`Bird` 클래스에 `fly()`가 있다면, 날지 못하는 `Penguin`은 `Bird`를 상속받으면 안 됩니다. `Moveable` 인터페이스 등으로 분리해야 합니다.

### 인터페이스 분리 원칙 (ISP)
**개념:** 자신이 사용하지 않는 인터페이스에 의존하지 않아야 한다.
거대한 하나의 인터페이스보다 구체적인 여러 인터페이스(`Readable`, `Writable`)가 낫습니다.

### 의존성 역전 원칙 (DIP)
**개념:** 구체적인 구현이 아닌 추상화에 의존해야 한다.

**Bad (강한 결합):**
```typescript
class UserService {
  private db = new MySQLDatabase(); // 구체 클래스에 직접 의존
}
```

**Good (의존성 주입):**
```typescript
interface Database {
  query(sql: string): Promise<any>;
}

class MySQLDatabase implements Database { /* MySQL 구현 */ }
class PostgreSQLDatabase implements Database { /* Postgres 구현 */ }

class UserService {
  constructor(private db: Database) {} // 인터페이스에 의존
}

// 사용 시 (DI)
const db = new MySQLDatabase(); // 또는 PostgreSQLDatabase
const service = new UserService(db);
```

## 디자인 패턴

### 리포지토리 패턴 (Repository Pattern)
비즈니스 로직과 데이터 접근 로직을 분리합니다. DB 변경 시 리포지토리 구현체만 교체하면 됩니다.

```typescript
interface UserRepository {
  findById(id: string): Promise<User>;
}

class PostgresUserRepository implements UserRepository {
  // 실제 쿼리 구현
}
```

### 팩토리 패턴 (Factory Pattern)
객체 생성 로직을 캡슐화합니다. 조건에 따라 다른 인스턴스(예: 알림 타입에 따라 Email, SMS, Push 객체)를 반환합니다.

### 데코레이터 패턴 (Decorator Pattern)
객체에 동적으로 책임을 추가합니다. 기존 코드를 수정하지 않고 로깅, 캐싱 등의 기능을 덧붙일 때 유용합니다.

### 옵저버 패턴 (Observer Pattern)
상태 변화를 여러 객체에 알립니다. 이벤트 기반 시스템(Node.js `EventEmitter`)에서 널리 사용됩니다.

## 클린 코드 관행

### 의미 있는 이름
- 변수명은 '무엇'인지, 함수명은 '무엇을 하는지' 명확히 드러나야 합니다.
- `d` 대신 `daysSinceCreation`, `process` 대신 `processOrderPayment`.

### 작은 함수
- 함수는 한 가지 일만 해야 합니다.
- 20줄을 넘어간다면 분리를 고려하세요.

### 매직 넘버 피하기
코드 중간의 숫자 상수는 이름을 가진 상수(`const MAX_RETRY = 3`)로 추출하세요.

### 에러 처리
- 조용히 실패(`try-catch` 후 로그만 찍고 넘어감)하지 마세요.
- 에러의 원인과 컨텍스트를 포함하여 적절히 던지거나 처리하세요.

### DRY (Don't Repeat Yourself)
중복 코드는 버그의 온상입니다. 공통 로직은 함수로 추출하거나 상위 클래스/모듈로 이동시키세요.

## 코드 리팩토링 기법

### 메서드 추출 (Extract Method)
긴 함수에서 특정 작업을 수행하는 코드 블록을 별도 함수로 분리합니다.

### 조건문을 다형성으로 교체
복잡한 `switch`나 `if-else` 문을 인터페이스와 구현 클래스(전략 패턴 등)로 대체하여 확장성을 높입니다.

## 코드 품질 체크리스트

- [ ] SOLID 원칙이 적용되었는가?
- [ ] 함수가 작고 한 가지 일만 하는가?
- [ ] 변수/함수 이름이 의도를 명확히 전달하는가?
- [ ] 매직 넘버/문자열이 없는가?
- [ ] 에러 처리가 적절한가 (Silent failure 없음)?
- [ ] 중복 코드(DRY)가 제거되었는가?
- [ ] 주석은 '무엇'이 아닌 '왜'를 설명하는가?
- [ ] 의존성 주입을 통해 테스트 용이성이 확보되었는가?

## 리소스

- **Clean Code (책):** Robert C. Martin
- **Refactoring (책):** Martin Fowler
- **Design Patterns:** https://refactoring.guru/design-patterns
