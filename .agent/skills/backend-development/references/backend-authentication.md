# Backend Authentication & Authorization (백엔드 인증 및 인가)

OAuth 2.1, JWT, RBAC 및 MFA(다중 요소 인증)를 포함한 최신 인증 패턴 (2025 표준).

## OAuth 2.1 (2025 표준)

### OAuth 2.0 대비 주요 변경사항

**필수 사항:**
- 모든 클라이언트에 대해 PKCE (Proof Key for Code Exchange) 사용
- 정확한 리디렉션 URI 매칭
- CSRF 방지를 위한 State 파라미터 사용

**폐기됨:**
- Implicit Grant Flow (보안 위험)
- Resource Owner Password Credentials Grant
- 쿼리 문자열에 Bearer 토큰 전송

### PKCE를 사용한 Authorization Code Flow

```typescript
// 1단계: Code Verifier 및 Challenge 생성
import crypto from 'crypto';

const codeVerifier = crypto.randomBytes(32).toString('base64url');
const codeChallenge = crypto
  .createHash('sha256')
  .update(codeVerifier)
  .digest('base64url');

// 2단계: 인증 엔드포인트로 리디렉션
const authUrl = new URL('https://auth.example.com/authorize');
authUrl.searchParams.set('client_id', 'your-client-id');
// ... (code_challenge 및 method=S256 포함)

// 3단계: 코드를 토큰으로 교환 (verifier 포함)
const tokenResponse = await fetch('https://auth.example.com/token', {
  method: 'POST',
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    code: authCode,
    code_verifier: codeVerifier,
    // ...
  }),
});
```

## JWT (JSON Web Tokens)

### 모범 사례 (2025)

1. **짧은 만료 시간:** Access Token 15분, Refresh Token 7일
2. **RS256 사용:** 비대칭 서명 (HS256 대신) 권장
3. **모든 것 검증:** 서명, 발급자(iss), 대상(aud), 만료(exp) 확인
4. **최소한의 클레임:** 민감 정보 포함 금지
5. **Refresh Token Rotation:** 사용 시마다 새로운 리프레시 토큰 발급

### 구현 (jsonwebtoken)

```typescript
import jwt from 'jsonwebtoken';

// 토큰 생성
const accessToken = jwt.sign(
  { sub: user.id, email: user.email, roles: user.roles },
  process.env.JWT_PRIVATE_KEY,
  { algorithm: 'RS256', expiresIn: '15m' }
);
```

## 역할 기반 접근 제어 (RBAC)

### RBAC 모델
`Users → Roles → Permissions → Resources`

### 구현 예시 (NestJS)

```typescript
// Roles 데코레이터
export const Roles = (...roles: Role[]) => SetMetadata('roles', roles);

// Guard 구현
@Injectable()
export class RolesGuard implements CanActivate {
  // 사용자의 role이 requiredRoles에 포함되는지 확인
}

// 컨트롤러 적용
@Post()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
createPost() { ... }
```

### RBAC 모범 사례
1. **Deny by default:** 명시적 허용 없으면 거부
2. **최소 권한 원칙:** 필요한 최소한의 권한만 부여
3. **역할 계층 구조:** Admin > Editor > Viewer

## 다중 요소 인증 (MFA)

### TOTP (시간 기반 일회용 비밀번호)
Google Authenticator 등과 호환되는 6자리 코드. `speakeasy` 라이브러리 활용.

### FIDO2/WebAuthn (비밀번호 없는 인증)
생체 인식, 보안 키 등을 사용하는 하드웨어 기반 인증. 피싱에 강함.

## 세션 관리

**모범 사례:**
1. **Secure Cookies:** `HttpOnly`, `Secure`, `SameSite=Strict`
2. **Redis 저장소:** 분산 환경을 위해 메모리 대신 Redis 사용
3. **세션 ID 재발급:** 로그인 등 권한 변경 시 ID 갱신

```typescript
app.use(session({
  store: new RedisStore({ client: redisClient }),
  secret: process.env.SESSION_SECRET,
  cookie: { secure: true, httpOnly: true, sameSite: 'strict' }
}));
```

## 비밀번호 보안

### Argon2id (2025 표준)
bcrypt보다 강력하며 GPU/ASIC 공격에 저항성을 가집니다.

```typescript
import argon2 from 'argon2';
const hash = await argon2.hash('password123');
const valid = await argon2.verify(hash, 'password123');
```

### 비밀번호 정책 (NIST 가이드라인)
- 최소 12자 이상
- 복잡성 강제(특수문자 필수 등)보다는 길이 권장
- 주기적 변경 강제 금지 (침해 시에만 변경)

## API 키 인증

**모범 사례:**
- 키에 접두사 사용 (`sk_live_...`)
- DB에는 해시값만 저장
- 읽기/쓰기 스코프 분리

## 인증 결정 매트릭스

| 사용 사례 | 권장 방식 |
|-----------|-----------|
| 웹 앱 | OAuth 2.1 + JWT |
| 모바일 앱 | OAuth 2.1 + PKCE |
| 서버 간 통신 | Client Credentials + mTLS |
| 관리자 | JWT + RBAC + MFA |

## 보안 체크리스트
- [ ] OAuth 2.1 + PKCE 적용
- [ ] JWT 만료 시간 짧게 설정 (15분)
- [ ] Refresh Token Rotation 적용
- [ ] 비밀번호 해싱에 Argon2id 사용
- [ ] 관리자 계정 MFA 강제
- [ ] 세션 쿠키 보안 설정 (HttpOnly, Secure)
- [ ] 로그인 시 속도 제한 (Rate limiting)
