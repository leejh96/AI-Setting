# Backend Security (백엔드 보안)

보안 모범 사례, OWASP Top 10 완화 전략 및 최신 보안 표준 (2025).

## OWASP Top 10 (2025 RC1)

### 주요 취약점 및 완화 전략

#### 1. 접근 제어 취약점 (Broken Access Control)
**위험:** 사용자가 권한 없는 리소스에 접근 (취약점의 28%)
**완화:** 서버 측에서 RBAC 적용, 기본 거부(Deny by default) 원칙

#### 2. 암호화 실패 (Cryptographic Failures)
**위험:** 민감 데이터 노출, 약한 암호화
**완화:**
- 비밀번호 해싱에 **Argon2id** 사용
- 전송 데이터 TLS 1.3 암호화
- 저장 데이터 AES-256 암호화

#### 3. 인젝션 공격 (Injection Attacks)
**위험:** SQL 인젝션, NoSQL 인젝션 (2024년 6배 증가)
**완화:**
- **항상** 파라미터화된 쿼리 사용 (Parameterized Query)
- ORM의 안전한 메서드 사용

```typescript
// PostgreSQL/MySQL (Node.js)
// Bad: 문자열 연결
const query = `SELECT * FROM users WHERE email = '${email}'`;

// Good: 파라미터 바인딩 ($1 또는 ?)
// Postgres
const query = 'SELECT * FROM users WHERE email = $1';
await db.query(query, [email]);

// MySQL
const query = 'SELECT * FROM users WHERE email = ?';
await connection.execute(query, [email]);
```

#### 4. 불안전한 설계 (Insecure Design)
**완화:** 설계 단계부터 위협 모델링(Threat modeling) 수행

#### 5. 보안 설정 오류 (Security Misconfiguration)
**완화:** 기본 계정 제거, 불필요한 기능 비활성화, 보안 헤더(Helmet 등) 적용

#### 6. 취약하고 오래된 컴포넌트
**완화:** `npm audit`, `Snyk` 등으로 의존성 정기 점검 및 자동 업데이트

#### 7. 식별 및 인증 실패
**완화:** MFA 적용, 강력한 비밀번호 정책, 무차별 대입 공격 방지(Rate Limit)

#### 8. 소프트웨어 및 데이터 무결성 실패
**완화:** CI/CD 파이프라인 보안, 서명된 업데이트, 패키지 잠금 파일 검증

#### 9. 로깅 및 모니터링 실패
**완화:** 인증 실패 등 중요 이벤트 로깅, 중앙 집중식 로그 관리

#### 10. 서버 측 요청 위조 (SSRF)
**완화:** 사용자 입력 URL 검증, 내부 네트워크 접근 차단

## 입력 값 검증 (Input Validation)

취약점의 70% 이상을 예방할 수 있습니다.
- **타입 검증:** `class-validator` 등을 사용해 DTO 검증
- **새니타이제이션(Sanitization):** HTML 태그 제거 등 (`DOMPurify`)
- **허용 리스트(Allow-list):** 허용된 필드만 통과시킴

## 속도 제한 (Rate Limiting)

Token Bucket 알고리즘 등을 사용하여 DoS 공격 및 크리덴셜 스터핑 방지.
- **인증:** 15분에 10회
- **공개 API:** 15분에 100회

## 보안 헤더 (Security Headers)

```typescript
// 필수 헤더 (2025)
{
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains', // HSTS
  'Content-Security-Policy': "default-src 'self'", // CSP
  'X-Frame-Options': 'DENY', // 클릭재킹 방지
  'X-Content-Type-Options': 'nosniff',
}
```

## 시크릿 관리 (Secrets Management)

1. **절대 커밋하지 말 것** (.env 사용)
2. **환경별 분리** (Dev/Prod 시크릿 분리)
3. **주기적 교체** (90일마다)
4. **도구 사용:** AWS Secrets Manager, HashiCorp Vault

```typescript
const dbPassword = process.env.DB_PASSWORD;
if (!dbPassword) throw new Error('DB_PASSWORD not set');
```

## API 보안 체크리스트
- [ ] HTTPS/TLS 1.3 필수 사용
- [ ] OAuth 2.1 + JWT 인증
- [ ] 모든 엔드포인트에 속도 제한 적용
- [ ] 모든 입력값 검증 (Validation)
- [ ] 파라미터화된 쿼리 사용 (SQL 인젝션 방지)
- [ ] 보안 헤더 설정
- [ ] CORS 설정 (프로덕션에서 `*` 금지)
- [ ] 에러 메시지에 시스템 정보 노출 금지
- [ ] 관리자 계정 MFA 강제
- [ ] 정기적인 보안 감사 수행
