# Command: API Documentation

## 사용 시점

API 엔드포인트 문서화 시 사용.

## 프롬프트 템플릿

```
다음 API 코드를 문서화해줘.

## 코드
{컨트롤러/서비스 코드}

## 규칙
- 요청/응답 예시 포함
- 에러 케이스 명시
- 실제 사용 가능한 예시
```

---

## API 문서 템플릿

```markdown
# API 명세: [모듈명]

## Base URL

\`\`\`
https://api.example.com/api/v1
\`\`\`

## 인증

모든 API는 Bearer 토큰 인증이 필요합니다 (별도 표기 없는 한).

\`\`\`
Authorization: Bearer {access_token}
\`\`\`

---

## 엔드포인트 목록

| Method | Path | 설명 | 인증 |
|--------|------|------|------|
| GET | /users | 사용자 목록 조회 | ✅ |
| GET | /users/:id | 사용자 상세 조회 | ✅ |
| POST | /users | 사용자 생성 | ❌ |
| PATCH | /users/:id | 사용자 수정 | ✅ |
| DELETE | /users/:id | 사용자 삭제 | ✅ |

---

## 상세 명세

### 사용자 목록 조회

사용자 목록을 페이지네이션하여 조회합니다.

**Request**

\`\`\`
GET /users?page=1&limit=10&role=user
\`\`\`

**Query Parameters**

| 이름 | 타입 | 필수 | 기본값 | 설명 |
|------|------|------|--------|------|
| page | number | ❌ | 1 | 페이지 번호 |
| limit | number | ❌ | 20 | 페이지당 항목 수 (최대 100) |
| role | string | ❌ | - | 역할 필터 (admin, user) |
| search | string | ❌ | - | 이메일/이름 검색 |

**Response**

\`\`\`json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "email": "user@example.com",
      "name": "홍길동",
      "role": "user",
      "createdAt": "2024-01-15T10:00:00Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 10,
    "total": 50,
    "totalPages": 5
  }
}
\`\`\`

**에러**

| 코드 | 상태 | 설명 |
|------|------|------|
| UNAUTHORIZED | 401 | 인증 토큰 없음 또는 만료 |
| FORBIDDEN | 403 | 접근 권한 없음 |

---

### 사용자 생성

새로운 사용자를 생성합니다.

**Request**

\`\`\`
POST /users
Content-Type: application/json
\`\`\`

**Body**

| 필드 | 타입 | 필수 | 제약조건 | 설명 |
|------|------|------|----------|------|
| email | string | ✅ | 이메일 형식 | 이메일 주소 |
| password | string | ✅ | 8자 이상 | 비밀번호 |
| name | string | ❌ | 100자 이하 | 사용자 이름 |
| role | string | ❌ | admin, user | 역할 (기본: user) |

**예시**

\`\`\`json
{
  "email": "newuser@example.com",
  "password": "securePassword123!",
  "name": "새사용자"
}
\`\`\`

**Response (201 Created)**

\`\`\`json
{
  "success": true,
  "data": {
    "id": 2,
    "email": "newuser@example.com",
    "name": "새사용자",
    "role": "user",
    "createdAt": "2024-01-15T10:30:00Z"
  }
}
\`\`\`

**에러**

| 코드 | 상태 | 설명 |
|------|------|------|
| VALIDATION_ERROR | 400 | 입력값 검증 실패 |
| EMAIL_EXISTS | 409 | 이미 존재하는 이메일 |

**에러 응답 예시**

\`\`\`json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "입력값이 올바르지 않습니다",
    "details": [
      {
        "field": "email",
        "message": "유효한 이메일 형식이 아닙니다"
      },
      {
        "field": "password",
        "message": "비밀번호는 8자 이상이어야 합니다"
      }
    ],
    "timestamp": "2024-01-15T10:00:00Z",
    "path": "/api/v1/users"
  }
}
\`\`\`

---

### 사용자 상세 조회

특정 사용자의 상세 정보를 조회합니다.

**Request**

\`\`\`
GET /users/:id
\`\`\`

**Path Parameters**

| 이름 | 타입 | 설명 |
|------|------|------|
| id | number | 사용자 ID |

**Response**

\`\`\`json
{
  "success": true,
  "data": {
    "id": 1,
    "email": "user@example.com",
    "name": "홍길동",
    "role": "user",
    "profile": {
      "bio": "안녕하세요",
      "avatarUrl": "https://..."
    },
    "createdAt": "2024-01-15T10:00:00Z",
    "updatedAt": "2024-01-15T12:00:00Z"
  }
}
\`\`\`

**에러**

| 코드 | 상태 | 설명 |
|------|------|------|
| USER_NOT_FOUND | 404 | 사용자를 찾을 수 없음 |

---

## 공통 에러 코드

| 코드 | 상태 | 설명 |
|------|------|------|
| UNAUTHORIZED | 401 | 인증 필요 |
| FORBIDDEN | 403 | 권한 없음 |
| NOT_FOUND | 404 | 리소스 없음 |
| VALIDATION_ERROR | 400 | 입력값 검증 실패 |
| INTERNAL_ERROR | 500 | 서버 오류 |

## Rate Limiting

- 인증된 요청: 분당 100회
- 비인증 요청: 분당 20회

\`\`\`
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1642248000
\`\`\`
```

---

## cURL 예시 템플릿

```bash
# 사용자 목록 조회
curl -X GET "https://api.example.com/api/v1/users?page=1&limit=10" \
  -H "Authorization: Bearer {token}"

# 사용자 생성
curl -X POST "https://api.example.com/api/v1/users" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {token}" \
  -d '{
    "email": "user@example.com",
    "password": "password123",
    "name": "홍길동"
  }'

# 사용자 수정
curl -X PATCH "https://api.example.com/api/v1/users/1" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {token}" \
  -d '{
    "name": "새이름"
  }'

# 사용자 삭제
curl -X DELETE "https://api.example.com/api/v1/users/1" \
  -H "Authorization: Bearer {token}"
```
