# Workflow: Feature Development

## 개요

새로운 기능 개발 시 따르는 표준 워크플로우.

## 단계

### 1️⃣ 요구사항 분석

**입력**: 기능 요청 또는 이슈

**체크리스트**:
- [ ] 요구사항이 명확한가?
- [ ] 영향 범위 파악 (기존 코드, DB 스키마 등)
- [ ] 예외 케이스 정의
- [ ] 필요한 API 엔드포인트 목록화
- [ ] 필요한 권한 확인

**출력**: 기능 명세 문서

```markdown
## 기능: [기능명]

### 요구사항
- 요구사항 1
- 요구사항 2

### API 엔드포인트
| Method | Path | 설명 |
|--------|------|------|
| POST | /api/v1/... | ... |

### DB 변경사항
- 새 테이블: ...
- 컬럼 추가: ...

### 예외 케이스
- 케이스 1: 처리 방법
- 케이스 2: 처리 방법
```

---

### 2️⃣ 설계

**체크리스트**:
- [ ] 모듈/서비스 구조 결정
- [ ] DTO 설계
- [ ] DB 스키마 설계 (필요시)
- [ ] 외부 서비스 연동 고려
- [ ] 에러 코드 정의

**출력**: 설계 문서 또는 간단한 다이어그램

---

### 3️⃣ 브랜치 생성

```bash
# 브랜치 명명: feature/{issue-number}-{description}
git checkout -b feature/123-user-profile

# 또는 이슈 번호 없이
git checkout -b feature/add-user-profile
```

---

### 4️⃣ DB 마이그레이션 (필요시)

```bash
# Prisma 스키마 수정 후
npx prisma migrate dev --name add_user_profile

# 마이그레이션 확인
npx prisma migrate status
```

---

### 5️⃣ 구현

**순서**:
1. **Entity/DTO** 생성
2. **Service** 비즈니스 로직 구현
3. **Controller** API 엔드포인트 구현
4. **Module** 등록

**코드 품질 체크**:
- [ ] TypeScript strict 모드 에러 없음
- [ ] ESLint 경고 없음
- [ ] 적절한 에러 처리
- [ ] 로깅 추가 (중요 작업)

---

### 6️⃣ 테스트 작성

```bash
# Unit 테스트
npm run test -- --watch user.service

# 특정 테스트만
npm run test -- --testNamePattern="should create user"
```

**최소 테스트 범위**:
- [ ] 정상 케이스 (Happy path)
- [ ] 유효성 검증 실패
- [ ] 리소스 없음 (404)
- [ ] 권한 없음 (403)
- [ ] 중복/충돌 (409)

---

### 7️⃣ 로컬 테스트

```bash
# 개발 서버 실행
npm run start:dev

# API 테스트 (curl 또는 Postman)
curl -X POST http://localhost:3000/api/v1/users \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'
```

---

### 8️⃣ 커밋 & 푸시

```bash
# 변경사항 확인
git status
git diff

# 스테이징 & 커밋
git add .
git commit -m "feat(user): add user profile feature

- Add profile DTO and entity
- Implement profile CRUD in service
- Add API endpoints for profile management
- Add unit tests for profile service

Closes #123"

# 푸시
git push origin feature/123-user-profile
```

---

### 9️⃣ PR 생성

**PR 템플릿**:

```markdown
## 개요
[변경 사항 요약]

## 변경 유형
- [ ] 새 기능
- [ ] 버그 수정
- [ ] 리팩토링
- [ ] 문서 업데이트

## 변경 내용
- 변경 1
- 변경 2

## 테스트
- [ ] Unit 테스트 추가/수정
- [ ] 로컬 테스트 완료
- [ ] E2E 테스트 (해당시)

## 스크린샷 (UI 변경시)

## 체크리스트
- [ ] 코드 컨벤션 준수
- [ ] 테스트 통과
- [ ] 문서 업데이트 (필요시)
- [ ] DB 마이그레이션 확인

## 관련 이슈
Closes #123
```

---

### 🔟 코드 리뷰 & 머지

- 리뷰어 지정
- 피드백 반영
- 승인 후 Squash & Merge

---

## 빠른 참조

```bash
# 새 기능 시작
git checkout develop
git pull
git checkout -b feature/xxx-description

# 작업 완료 후
git add .
git commit -m "feat(scope): description"
git push origin feature/xxx-description

# PR 생성 후 머지되면
git checkout develop
git pull
git branch -d feature/xxx-description
```
