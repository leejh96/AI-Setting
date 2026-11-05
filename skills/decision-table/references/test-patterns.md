# 언어·프레임워크별 테이블 주도 테스트(Table-Driven Test) 패턴

결정 테이블(Decision Table)의 각 행(`#1, #2, ...`)을 테스트 코드로 옮길 때 참고하는 최소 템플릿입니다. 대상 프로젝트에 이미 확립된 테스트 유틸리티나 픽스처 구조가 있으면 프로젝트 관례를 우선합니다. 압축한 한 행은 여러 테스트로 확장할 수 있습니다. 아래 해지 정책과 상태 코드는 설명용이며 실제 작업에서는 확인된 계약을 사용합니다.

---

## 1. TypeScript / JavaScript (Vitest · Jest)

`it.each` 또는 `test.each`에 결정 테이블의 행과 필요한 추가 조합을 객체 배열로 전달합니다. `#3`은 권한 확인이 상태 검사나 외부 호출보다 먼저 이루어지는지 확인하도록 두 상태로 확장합니다.

아래는 프로젝트별 테스트 도우미를 연결해야 하는 템플릿입니다. `createCancelTestContext()`는 케이스마다 격리된 테스트 저장소, 외부 해지 성공 응답을 반환하는 `external.cancel` 모의 함수, `events.publish` 모의 함수, 이 의존성을 사용하는 `cancelSubscription`을 제공합니다. `subscriptions.create`는 저장하고, `findById`는 저장소에서 독립된 객체를 다시 읽어야 합니다. 호출 인자와 이벤트 형식은 프로젝트 계약에 맞춥니다. Jest에서는 테스트 API의 import를 해당 환경에 맞게 바꿉니다.

```typescript
import { describe, expect, it } from 'vitest';

describe('cancelSubscription', () => {
  it.each([
    {
      caseId: '#1 본인 + ACTIVE 상태에서 정상 해지',
      initialStatus: 'ACTIVE',
      isOwner: true,
      expectedStatus: 200,
      expectedNextState: 'CANCELED',
      expectedExternalCalls: [['sub-1']],
      expectedEventCalls: [[{ type: 'SubscriptionCanceled', subscriptionId: 'sub-1' }]],
    },
    {
      caseId: '#2 본인 + 이미 CANCELED 상태면 중복 해지 차단',
      initialStatus: 'CANCELED',
      isOwner: true,
      expectedStatus: 409,
      expectedNextState: 'CANCELED',
      expectedExternalCalls: [],
      expectedEventCalls: [],
    },
    {
      caseId: '#3a 타인 + ACTIVE: 외부 호출 전 권한 차단',
      initialStatus: 'ACTIVE',
      isOwner: false,
      expectedStatus: 403,
      expectedNextState: 'ACTIVE',
      expectedExternalCalls: [],
      expectedEventCalls: [],
    },
    {
      caseId: '#3b 타인 + CANCELED: 중복 상태 응답 전 권한 차단',
      initialStatus: 'CANCELED',
      isOwner: false,
      expectedStatus: 403,
      expectedNextState: 'CANCELED',
      expectedExternalCalls: [],
      expectedEventCalls: [],
    },
  ])('$caseId', async (tc) => {
    const { subscriptions, external, events, cancelSubscription } = createCancelTestContext();
    const sub = await subscriptions.create({ id: 'sub-1', status: tc.initialStatus });
    const res = await cancelSubscription({ subscriptionId: sub.id, isOwner: tc.isOwner });
    const saved = await subscriptions.findById(sub.id);

    expect(res.status).toBe(tc.expectedStatus);
    expect(saved?.status).toBe(tc.expectedNextState);
    // 전체 호출 기록으로 횟수·인자와 차단 시 호출 생략을 확인합니다.
    expect(external.cancel.mock.calls).toEqual(tc.expectedExternalCalls);
    expect(events.publish.mock.calls).toEqual(tc.expectedEventCalls);
  });
});
```

저장 실패나 외부 타임아웃은 응답·복구·이벤트 발행 규칙을 확인한 뒤 별도 케이스로 추가합니다. 위 성공 응답 모의 함수만으로 실패 시 동작까지 확인했다고 보고하지 않습니다.

---

## 2. Node.js 내장 테스트 러너 (`node:test`)

별도 테스트 라이브러리가 없는 Node.js 프로젝트에서는 내장 `node:test`와 배열 순회를 사용합니다.

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';

const cases = [
  { name: '#1 정상 입력', input: { amount: 1000, rate: 0.1 }, expected: 100 },
  { name: '#2 0원 입력 (수수료 면제)', input: { amount: 0, rate: 0.1 }, expected: 0 },
  { name: '#3 음수 금액 차단', input: { amount: -100, rate: 0.1 }, expected: null },
];

for (const tc of cases) {
  test(tc.name, () => {
    assert.equal(calculateFee(tc.input), tc.expected);
  });
}
```

---

## 3. Java / Kotlin (JUnit 5)

`@ParameterizedTest`와 `@MethodSource`(또는 간단한 값이면 `@CsvSource`)로 결정 테이블 행을 표현합니다.

이하 해지 예시는 매개변수화 문법을 보여주는 골격입니다. 실행 본문에는 위 TypeScript 예시처럼 저장소 재조회와 외부 호출·이벤트 검증을 프로젝트 도우미로 연결합니다.

```java
static Stream<Arguments> cancelCases() {
    return Stream.of(
        Arguments.of("#1 정상 해지", Status.ACTIVE, true, 200, Status.CANCELED),
        Arguments.of("#2 중복 해지 차단", Status.CANCELED, true, 409, Status.CANCELED),
        Arguments.of("#3a 권한 없음 (ACTIVE)", Status.ACTIVE, false, 403, Status.ACTIVE),
        Arguments.of("#3b 권한 없음 (CANCELED)", Status.CANCELED, false, 403, Status.CANCELED)
    );
}

@ParameterizedTest(name = "{0}")
@MethodSource("cancelCases")
void cancelSubscriptionCases(
    String caseId, Status initial, boolean isOwner, int expectedCode, Status expectedState
) {
    // 케이스별 저장소·모의 함수를 준비하고 실행한 뒤, 응답·저장 상태·부수효과 검증
}
```

---

## 4. Python (`pytest`)

`pytest.param(..., id=...)`에 결정 테이블 케이스 식별자를 지정하면 테스트 함수에 불필요한 미사용 인자를 넘기지 않고도 실행 로그에서 케이스 이름을 바로 확인할 수 있습니다.

```python
import pytest

@pytest.mark.parametrize(
    ("initial_status", "is_owner", "expected_code", "expected_state"),
    [
        pytest.param("ACTIVE", True, 200, "CANCELED", id="#1_active_success"),
        pytest.param("CANCELED", True, 409, "CANCELED", id="#2_already_canceled"),
        pytest.param("ACTIVE", False, 403, "ACTIVE", id="#3a_forbidden_active"),
        pytest.param("CANCELED", False, 403, "CANCELED", id="#3b_forbidden_canceled"),
    ],
)
def test_cancel_subscription(initial_status, is_owner, expected_code, expected_state):
    # 케이스별 저장소·모의 함수를 준비하고 실행한 뒤, 응답·저장 상태·부수효과 검증
    ...
```

---

## 5. Go (`testing`)

표준 구조체 슬라이스와 `t.Run` 서브테스트로 결정 테이블을 그대로 코드화합니다.

```go
func TestCancelSubscription(t *testing.T) {
	tests := []struct {
		name          string
		initialStatus Status
		isOwner       bool
		wantCode      int
		wantState     Status
	}{
		{"#1 정상 해지", StatusActive, true, 200, StatusCanceled},
		{"#2 중복 해지 차단", StatusCanceled, true, 409, StatusCanceled},
		{"#3a 권한 없음 (ACTIVE)", StatusActive, false, 403, StatusActive},
		{"#3b 권한 없음 (CANCELED)", StatusCanceled, false, 403, StatusCanceled},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// 케이스별 저장소·모의 함수를 준비하고 실행한 뒤, 응답·저장 상태·부수효과 검증
		})
	}
}
```
