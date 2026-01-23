---
description: 
---

# Workflow: Bug Fix

## 개요

버그 수정 시 따르는 표준 워크플로우.

## 심각도 분류

| 등급 | 설명 | 대응 시간 |
|------|------|----------|
| 🔴 P0 | 서비스 장애, 데이터 손실 | 즉시 (Hotfix) |
| 🟠 P1 | 주요 기능 불가, 우회 불가 | 24시간 내 |
| 🟡 P2 | 기능 이상, 우회 가능 | 다음 스프린트 |
| 🟢 P3 | 사소한 이슈, UI 문제 | 백로그 |

---

## 단계

### 1️⃣ 버그 재현

**체크리스트**:
- [ ] 재현 조건 파악 (환경, 데이터, 순서)
- [ ] 일관되게 재현 가능한가?
- [ ] 영향 범위 파악

**재현 정보 기록**:

```markdown
## 버그 재현

### 환경
- 서버: Production / test / development
- 브라우저/클라이언트: 
- 계정/권한: 

### 재현 단계
1. ...
2. ...
3. ...

### 예상 결과
...

### 실제 결과
...

### 에러 로그
\`\`\`
에러 메시지 또는 스택 트레이스
\`\`\`
```

---

### 2️⃣ 원인 분석

**분석 방법**:

```bash
# 로그 확인
tail -f /var/log/app/error.log
# 또는 CloudWatch, DataDog 등

# 관련 코드 검색
grep -r "에러메시지키워드" src/

# Git blame으로 최근 변경 확인
git blame src/modules/user/user.service.ts
git log --oneline -10 -- src/modules/user/

# 특정 커밋 이후 변경사항
git diff abc123..HEAD -- src/modules/user/
```

**원인 유형**:
- 로직 오류
- 타입 불일치
- 예외 처리 누락
- 동시성 이슈
- 환경 설정 문제
- 외부 서비스 문제

---

### 3️⃣ 수정 계획

**고려사항**:
- 근본 원인 vs 증상만 수정?
- 다른 곳에 같은 패턴 있나?
- 사이드 이펙트 가능성?

**수정 방안 문서화**:

```markdown
## 원인
[원인 설명]

## 수정 방안
[수정 계획]

## 영향 범위
- 영향받는 기능:
- 영향받는 API:

## 테스트 계획
- 재현 케이스가 해결되는지
- 기존 기능 정상 동작하는지
```

---

### 4️⃣ 브랜치 생성

```bash
# 일반 버그
git checkout -b fix/456-user-login-error

# 긴급 Hotfix (P0)
git checkout main
git checkout -b hotfix/critical-payment-bug
```

---

### 5️⃣ 수정 구현

**원칙**:
1. **최소한의 변경**: 버그 수정에 필요한 것만
2. **리팩토링 분리**: 구조 개선은 별도 PR로
3. **방어적 코딩**: 같은 유형 재발 방지

**수정 예시**:

```typescript
// ❌ 단순히 에러만 숨김
try {
  await riskyOperation();
} catch (e) {
  // 에러 무시
}

// ✅ 적절한 예외 처리
try {
  await riskyOperation();
} catch (e) {
  this.logger.error('Operation failed', { error: e.message, context });
  throw new InternalServerErrorException('처리 중 오류가 발생했습니다');
}
```

---

### 6️⃣ 테스트 추가

**필수 테스트**:
- [ ] 버그 재현 테스트 (수정 전 실패, 후 성공)
- [ ] 관련 기능 regression 테스트

```typescript
describe('User Login Bug #456', () => {
  it('should handle special characters in password', async () => {
    // 이 테스트는 버그 수정 전에는 실패해야 함
    const result = await service.login({
      email: 'test@example.com',
      password: 'pass@#$%word!',  // 특수문자 포함
    });
    
    expect(result).toBeDefined();
    expect(result.accessToken).toBeDefined();
  });
});
```

---

### 7️⃣ 검증

```bash
# 전체 테스트 실행
npm run test

# 관련 테스트만
npm run test -- user.service.spec.ts

# E2E (해당시)
npm run test:e2e

# 로컬에서 재현 테스트
npm run start:dev
# 버그 재현 시도 → 해결 확인
```

---

### 8️⃣ 커밋 & PR

```bash
git add .
git commit -m "fix(user): handle special characters in password

- Add password encoding before comparison
- Add validation for special characters
- Add regression test for the bug

Fixes #456"

git push origin fix/456-user-login-error
```

**PR 설명**:

```markdown
## 버그
[버그 설명 및 재현 방법]

## 원인
[원인 분석 결과]

## 해결
[수정 내용]

## 테스트
- [x] 버그 재현 → 해결 확인
- [x] 관련 기능 테스트
- [x] 전체 테스트 통과

Fixes #456
```

---

### 9️⃣ Hotfix 절차 (P0)

```bash
# 1. main에서 hotfix 브랜치
git checkout main
git pull
git checkout -b hotfix/critical-bug

# 2. 수정 & 테스트
# (최소한의 수정)

# 3. main으로 머지
git checkout main
git merge hotfix/critical-bug

# 4. 태그 & 배포
git tag v1.2.1
git push origin main --tags

# 5. develop에도 반영
git checkout develop
git merge main
git push origin develop
```

---

## 체크리스트

### 수정 전
- [ ] 버그 재현 가능
- [ ] 원인 파악 완료
- [ ] 영향 범위 확인

### 수정 후
- [ ] 버그 해결 확인
- [ ] 테스트 추가
- [ ] 전체 테스트 통과
- [ ] 다른 기능 영향 없음
- [ ] 문서 업데이트 (필요시)
