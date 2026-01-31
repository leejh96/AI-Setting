# Command: Commit Message

## 사용 시점

코드 변경 후 커밋 메시지 작성 시 사용.

## 프롬프트 템플릿

```
다음 변경사항에 대한 커밋 메시지를 작성해줘.

## 변경된 파일
{변경된 파일 목록}

## 변경 내용 요약
{간단한 설명}

## 규칙
- Conventional Commits 형식 사용
- 한글로 작성
- 제목은 50자 이내
- 본문은 선택적 (복잡한 변경일 경우)
```

---

## Conventional Commits 형식

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Type

| Type | 설명 | 예시 |
|------|------|------|
| feat | 새로운 기능 | 회원가입 기능 추가 |
| fix | 버그 수정 | 로그인 오류 수정 |
| docs | 문서 변경 | README 업데이트 |
| style | 코드 스타일 (포맷팅 등) | 들여쓰기 수정 |
| refactor | 리팩토링 | 함수 분리 |
| test | 테스트 추가/수정 | 단위 테스트 추가 |
| chore | 기타 (빌드, 설정 등) | 의존성 업데이트 |
| perf | 성능 개선 | 쿼리 최적화 |
| ci | CI 설정 | GitHub Actions 수정 |

### Scope

영향 받는 모듈/기능 (선택적)

```
feat(user): 프로필 이미지 업로드 기능 추가
fix(auth): 토큰 만료 처리 오류 수정
refactor(order): 주문 생성 로직 분리
```

---

## 예시

### 간단한 변경

```
feat(user): 프로필 조회 API 추가
```

### 상세 설명 필요 시

```
fix(order): 동시 주문 시 재고 초과 문제 수정

- 재고 차감 시 비관적 락 적용
- 트랜잭션 격리 수준 SERIALIZABLE로 변경
- 재고 부족 시 명확한 에러 메시지 반환

Fixes #234
```

### Breaking Change

```
feat(api)!: 응답 형식 변경

BREAKING CHANGE: 모든 API 응답이 { success, data, error } 형식으로 변경됩니다.
기존 { data } 형식은 더 이상 지원하지 않습니다.
```

### 여러 이슈 참조

```
fix(user): 이메일 인증 관련 버그 수정

- 인증 링크 만료 시간 24시간으로 연장
- 중복 인증 요청 방지 로직 추가
- 인증 완료 후 리다이렉트 URL 수정

Fixes #123
Closes #124
Related to #100
```

---

## Git Hooks로 자동화

```bash
# .husky/commit-msg
#!/bin/sh
npx --no -- commitlint --edit $1
```

```javascript
// commitlint.config.js
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'docs', 'style', 'refactor', 'test', 'chore', 'perf', 'ci'],
    ],
    'subject-max-length': [2, 'always', 50],
    'body-max-line-length': [2, 'always', 72],
  },
};
```

---

## 빠른 참조

```bash
# 기본 형식
git commit -m "type(scope): subject"

# 본문 포함
git commit -m "type(scope): subject" -m "본문 설명"

# 대화형 커밋 (commitizen)
npx cz
```
