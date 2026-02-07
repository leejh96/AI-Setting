---
name: api-documentation
description: API 엔드포인트 문서화를 위한 가이드와 템플릿을 제공합니다. RESTful API 문서 작성, 요청/응답 예시 포함, 에러 케이스 명시, cURL 예시 생성 등 API 문서화 작업 시 사용합니다.
---

# API 문서화 스킬

API 엔드포인트를 체계적으로 문서화하기 위한 가이드와 템플릿을 제공합니다.

## 사용 시점

- RESTful API 엔드포인트 문서화
- 요청/응답 스키마 정의
- 에러 코드 및 에러 응답 문서화
- cURL 예시 및 SDK 사용 예시 작성
- API 변경 이력 관리

## 문서화 체크리스트

1. **기본 정보**: Base URL, 인증 방식, Rate Limiting
2. **엔드포인트 목록**: Method, Path, 설명, 인증 필요 여부
3. **요청 상세**: Path/Query Parameters, Request Body
4. **응답 상세**: 성공 응답, 에러 응답
5. **예시**: cURL, SDK 사용 예시

## API 문서 템플릿

### 엔드포인트 정의

```markdown
### [엔드포인트 이름]

[간단한 설명]

**Request**

\`\`\`
[METHOD] /path/:param?query=value
\`\`\`

**Path Parameters**

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| param | string | ✅ | 설명 |

**Query Parameters**

| 이름 | 타입 | 필수 | 기본값 | 설명 |
|------|------|------|--------|------|
| query | string | ❌ | - | 설명 |

**Request Body**

| 필드 | 타입 | 필수 | 제약조건 | 설명 |
|------|------|------|----------|------|
| field | string | ✅ | 100자 이하 | 설명 |

**Response (200 OK)**

\`\`\`json
{
  "success": true,
  "data": { ... }
}
\`\`\`

**에러**

| 코드 | 상태 | 설명 |
|------|------|------|
| NOT_FOUND | 404 | 리소스 없음 |
```

### 공통 응답 형식

```json
// 성공
{
  "success": true,
  "data": { ... },
  "meta": { "page": 1, "limit": 10, "total": 50 }
}

// 에러
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "에러 메시지",
    "details": [ ... ]
  }
}
```

### 공통 에러 코드

| 코드 | 상태 | 설명 |
|------|------|------|
| UNAUTHORIZED | 401 | 인증 필요 |
| FORBIDDEN | 403 | 권한 없음 |
| NOT_FOUND | 404 | 리소스 없음 |
| VALIDATION_ERROR | 400 | 입력값 검증 실패 |
| INTERNAL_ERROR | 500 | 서버 오류 |

## cURL 예시 템플릿

```bash
# GET 요청
curl -X GET "https://api.example.com/api/v1/resource" \
  -H "Authorization: Bearer {token}"

# POST 요청
curl -X POST "https://api.example.com/api/v1/resource" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {token}" \
  -d '{ "field": "value" }'

# PATCH 요청
curl -X PATCH "https://api.example.com/api/v1/resource/:id" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {token}" \
  -d '{ "field": "updated" }'

# DELETE 요청
curl -X DELETE "https://api.example.com/api/v1/resource/:id" \
  -H "Authorization: Bearer {token}"
```

## Rate Limiting 문서화

```markdown
## Rate Limiting

- 인증된 요청: 분당 100회
- 비인증 요청: 분당 20회

응답 헤더:
- `X-RateLimit-Limit`: 허용 횟수
- `X-RateLimit-Remaining`: 남은 횟수
- `X-RateLimit-Reset`: 리셋 시간 (Unix timestamp)
```
