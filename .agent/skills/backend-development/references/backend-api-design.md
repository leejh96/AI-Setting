# Backend API Design (백엔드 API 설계)

RESTful, GraphQL, gRPC API 설계를 위한 포괄적인 가이드 및 모범 사례 (2025).

## REST API 설계

### 리소스 기반 URL

**좋은 예:**
```
GET    /api/v1/users              # 사용자 목록 조회
GET    /api/v1/users/:id          # 특정 사용자 조회
POST   /api/v1/users              # 사용자 생성
PUT    /api/v1/users/:id          # 사용자 전체 수정
PATCH  /api/v1/users/:id          # 사용자 부분 수정
DELETE /api/v1/users/:id          # 사용자 삭제

GET    /api/v1/users/:id/posts    # 사용자의 게시물 조회
POST   /api/v1/users/:id/posts    # 사용자의 게시물 생성
```

**나쁜 예 (피해야 함):**
```
GET /api/v1/getUser?id=123        # RPC 스타일, RESTful하지 않음
POST /api/v1/createUser           # URL에 동사 포함
GET /api/v1/user-posts            # 관계가 불명확함
```

### HTTP 상태 코드 (의미 있는 응답)

**성공:**
- `200 OK` - GET, PUT, PATCH 성공
- `201 Created` - POST 성공 (리소스 생성됨)
- `204 No Content` - DELETE 성공 (본문 없음)

**클라이언트 에러:**
- `400 Bad Request` - 잘못된 입력/유효성 검사 실패
- `401 Unauthorized` - 인증 누락 또는 무효
- `403 Forbidden` - 인증되었으나 권한 없음
- `404 Not Found` - 리소스가 존재하지 않음
- `409 Conflict` - 리소스 충돌 (예: 이메일 중복)
- `422 Unprocessable Entity` - 유효성 검사 오류 (상세)
- `429 Too Many Requests` - 속도 제한 초과

**서버 에러:**
- `500 Internal Server Error` - 일반적인 서버 오류
- `502 Bad Gateway` - 업스트림 서비스 오류
- `503 Service Unavailable` - 일시적 서비스 중단
- `504 Gateway Timeout` - 업스트림 서비스 시간 초과

### 요청/응답 형식

**요청 (Request):**
```typescript
POST /api/v1/users
Content-Type: application/json

{
  "email": "user@example.com",
  "name": "John Doe",
  "age": 30
}
```

**성공 응답 (Success Response):**
```typescript
HTTP/1.1 201 Created
Content-Type: application/json
Location: /api/v1/users/123

{
  "success": true,
  "data": {
    "id": "123",
    "email": "user@example.com",
    "name": "John Doe",
    "age": 30,
    "createdAt": "2025-01-09T12:00:00Z",
    "updatedAt": "2025-01-09T12:00:00Z"
  }
}
```

**에러 응답 (Error Response):**
```typescript
HTTP/1.1 400 Bad Request
Content-Type: application/json

{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input data",
    "details": [
      {
        "field": "email",
        "message": "Invalid email format",
        "value": "invalid-email"
      }
    ],
    "timestamp": "2025-01-09T12:00:00Z",
    "path": "/api/v1/users"
  }
}
```

### 페이지네이션 (Pagination)

```typescript
// 요청
GET /api/v1/users?page=2&limit=50

// 응답
{
  "data": [...],
  "meta": {
    "page": 2,
    "limit": 50,
    "total": 1234,
    "totalPages": 25,
    "hasNext": true,
    "hasPrev": true
  },
  "links": {
    "self": "/api/v1/users?page=2&limit=50",
    "next": "/api/v1/users?page=3&limit=50",
    "prev": "/api/v1/users?page=1&limit=50"
  }
}
```

### 필터링 및 정렬

```
GET /api/v1/users?status=active&role=admin&sort=-createdAt,name&limit=20

# 필터: status=active AND role=admin
# 정렬: createdAt 내림차순 (-), name 오름차순
# 제한: 20개 결과
```

### API 버저닝 전략

**URL 버저닝 (가장 일반적):**
```
/api/v1/users
/api/v2/users
```

**헤더 버저닝:**
```
GET /api/users
Accept: application/vnd.myapi.v2+json
```

**권장사항:** 명시적이고 발견하기 쉬운 URL 버저닝 권장

## GraphQL API 설계

### 스키마 정의

```graphql
type User {
  id: ID!
  email: String!
  name: String!
  posts: [Post!]!
  createdAt: DateTime!
}

type Post {
  id: ID!
  title: String!
  content: String!
  author: User!
  published: Boolean!
  createdAt: DateTime!
}

type Query {
  user(id: ID!): User
  users(limit: Int = 50, offset: Int = 0): [User!]!
  post(id: ID!): Post
  posts(authorId: ID, published: Boolean): [Post!]!
}

type Mutation {
  createUser(input: CreateUserInput!): User!
  updateUser(id: ID!, input: UpdateUserInput!): User!
  deleteUser(id: ID!): Boolean!
  createPost(input: CreatePostInput!): Post!
}
```

### 쿼리 (Queries)

```graphql
# 클라이언트가 필요한 데이터만 정확히 요청
query GetUser($userId: ID!) {
  user(id: $userId) {
    id
    name
    email
    posts(published: true) {
      id
      title
    }
  }
}
```

### 모범 사례 (Best Practices)

1. **N+1 문제 방지**: DataLoader를 사용하여 배치 로딩 구현
2. **페이지네이션**: 커서 기반(Cursor-based) 페이지네이션 (Relay 스타일) 고려
3. **깊이 제한 (Depth Limiting)**: 악의적인 깊은 중첩 쿼리 방지
4. **복잡도 분석**: 과도하게 비싼 쿼리 제한

## gRPC API 설계

### Protocol Buffers 스키마

```protobuf
syntax = "proto3";

package user;

service UserService {
  rpc GetUser (GetUserRequest) returns (User);
  rpc ListUsers (ListUsersRequest) returns (ListUsersResponse);
  rpc CreateUser (CreateUserRequest) returns (User);
  
  // 스트리밍
  rpc StreamUsers (StreamUsersRequest) returns (stream User);
}

message User {
  string id = 1;
  string email = 2;
  string name = 3;
}

message GetUserRequest {
  string id = 1;
}
```

### gRPC 장점
- **성능**: REST보다 7-10배 빠름 (바이너리 프로토콜)
- **스트리밍**: 양방향 스트리밍 지원
- **타입 안전성**: .proto 파일을 통한 엄격한 타입
- **코드 생성**: 클라이언트/서버 코드 자동 생성

## API 설계 결정 매트릭스

| 특징 | REST | GraphQL | gRPC |
|------|------|---------|------|
| **용도** | 공개 API, CRUD | 유연한 데이터 페칭 | 내부 마이크로서비스, 고성능 |
| **성능** | 보통 | 보통 | 최고 |
| **캐싱** | HTTP 캐싱 내장 | 복잡함 | 내장 캐싱 없음 |
| **도구** | 매우 우수 (Swagger) | 우수 (GraphiQL) | 좋음 |
| **러닝 커브** | 쉬움 | 보통 | 높음 |

## API 보안 체크리스트

- [ ] HTTPS/TLS 필수 사용
- [ ] 인증 (OAuth 2.1, JWT) 및 인가 (RBAC)
- [ ] 입력값 검증 (모든 엔드포인트)
- [ ] 속도 제한 (Rate Limiting)
- [ ] 적절한 CORS 설정
- [ ] 보안 헤더 (Helmet 등)
- [ ] 시스템 정보를 노출하지 않는 에러 메시지

## 문서화 (Documentation)

### OpenAPI/Swagger (REST)

API의 계약(Contract)을 정의하고, 클라이언트 SDK 생성 및 테스트 자동화에 활용할 수 있습니다. NestJS의 경우 `@nestjs/swagger`를 통해 코드 기반으로 자동 생성하는 것이 효율적입니다.

## 리소스

- **REST Best Practices:** https://restfulapi.net/
- **GraphQL:** https://graphql.org/learn/
- **gRPC:** https://grpc.io/docs/
- **OpenAPI:** https://swagger.io/specification/
