# Workflow: PR Review

## 개요

Pull Request 리뷰 시 따르는 표준 워크플로우.

## 리뷰 전 준비

### 1️⃣ 컨텍스트 파악

```markdown
확인할 것:
- [ ] PR 설명 읽기
- [ ] 관련 이슈 확인
- [ ] 변경 파일 목록 훑어보기
- [ ] 변경 규모 파악 (몇 개 파일, 몇 줄)
```

### 2️⃣ 로컬 체크아웃 (필요시)

```bash
# PR 브랜치 가져오기
git fetch origin pull/123/head:pr-123
git checkout pr-123

# 또는 GitHub CLI
gh pr checkout 123
```

---

## 리뷰 체크리스트

### 🔴 필수 확인 (Blocking)

**보안**
- [ ] SQL Injection 취약점 없음
- [ ] XSS 취약점 없음
- [ ] 인증/인가 체크 존재
- [ ] 민감 정보 노출 없음 (로그, 응답)
- [ ] Rate limiting 고려

**데이터 무결성**
- [ ] 트랜잭션 적절히 사용
- [ ] 데이터 유효성 검증
- [ ] 동시성 이슈 고려

**에러 처리**
- [ ] 예외 적절히 처리
- [ ] 에러 응답 일관성
- [ ] 에러 로깅 충분

---

### 🟠 중요 확인 (Should Fix)

**성능**
- [ ] N+1 쿼리 없음
- [ ] 불필요한 쿼리 없음
- [ ] 대용량 데이터 페이지네이션
- [ ] 적절한 인덱스 사용

**테스트**
- [ ] 테스트 추가/수정됨
- [ ] 주요 케이스 커버
- [ ] Edge case 테스트

**비즈니스 로직**
- [ ] 요구사항 충족
- [ ] Edge case 처리
- [ ] 기존 기능 영향 없음

---

### 🟡 개선 권장 (Nice to Have)

**코드 품질**
- [ ] 네이밍 명확성
- [ ] 함수 길이 적절
- [ ] 중복 코드 없음
- [ ] 주석 적절성

**타입 안전성**
- [ ] any 타입 사용 최소화
- [ ] 타입 가드 적절히 사용
- [ ] nullable 처리

---

## 리뷰 코멘트 작성

### 위치 선정
- 해당 코드 라인에 직접 코멘트
- 여러 줄이면 범위 선택하여 코멘트

### 코멘트 유형

```markdown
# 블로킹 이슈 (반드시 수정)
🔴 **[Security]** SQL Injection 취약점이 있습니다.

\`\`\`typescript
// 현재 코드
const result = await db.query(\`SELECT * FROM users WHERE id = \${id}\`);

// 제안
const result = await db.query('SELECT * FROM users WHERE id = ?', [id]);
\`\`\`

---

# 질문/확인
❓ 이 부분에서 null 체크가 필요하지 않을까요? 
\`user.profile\`이 없는 경우도 있을 것 같은데요.

---

# 제안 (선택적)
💡 **[Suggestion]** 여기서 early return 패턴을 사용하면 더 읽기 쉬울 것 같아요.

\`\`\`typescript
// 현재
if (user) {
  // 많은 로직
}

// 제안
if (!user) {
  throw new NotFoundException();
}
// 로직 계속
\`\`\`

---

# 칭찬
👍 에러 처리가 깔끔하네요!
```

---

## 최종 판단

### ✅ Approve

```
조건:
- 🔴 이슈 없음
- 🟠 이슈 없거나 minor
- 테스트 통과
```

### 🔄 Request Changes

```
조건:
- 🔴 이슈 있음
- 또는 🟠 이슈가 여러 개
```

### 💬 Comment

```
조건:
- 질문이나 논의가 필요
- 확인 후 다시 리뷰 예정
```

---

## 리뷰 완료 메시지 템플릿

### Approve

```markdown
## ✅ LGTM!

코드 깔끔하고, 테스트도 잘 작성되었습니다.

### 작은 제안 (optional)
- L45: early return 패턴 고려해 보세요

머지해도 좋을 것 같아요! 🚀
```

### Request Changes

```markdown
## 🔄 수정 필요

전반적으로 좋은데, 몇 가지 수정이 필요합니다.

### 반드시 수정
- L23: SQL Injection 취약점 수정 필요
- L56: 트랜잭션 처리 필요

### 권장 수정
- L78: N+1 쿼리 개선
- L92: 테스트 케이스 추가

수정 후 다시 리뷰 요청해 주세요!
```

---

## 리뷰 시간 가이드

| PR 규모 | 예상 시간 |
|---------|----------|
| Small (< 100줄) | 15-30분 |
| Medium (100-500줄) | 30-60분 |
| Large (> 500줄) | 분할 요청 권장 |

---

## 빠른 참조

```bash
# PR 로컬 테스트
gh pr checkout 123
npm install
npm run test
npm run start:dev

# 리뷰 완료 후
gh pr review 123 --approve
# 또는
gh pr review 123 --request-changes --body "수정 필요한 부분..."
```
