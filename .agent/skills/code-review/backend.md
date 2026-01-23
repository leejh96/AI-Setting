# Backend Review Checklist

Node.js, NestJS, Express, TypeScript, Prisma, 및 MongoDB 코드베이스를 위한 도메인 특화 리뷰 항목입니다.

요약 테이블에 다음 카테고리를 추가하세요:
- 보안 (Backend)
- NestJS 패턴
- DTO 검증
- Prisma/데이터베이스
- 에러 처리 (Backend)
- 비동기 패턴
- Express/미들웨어
- TypeScript 품질

---

## 카테고리: 보안 (Backend)

### SQL 인젝션 (Prisma)

**검색 패턴**:
```bash
# 문자열 보간(interpolation)이 있는 Raw 쿼리
grep -rE "\$queryRaw\`.*\$\{|\$executeRaw\`.*\$\{" --include="*.ts"

# queryRawUnsafe 사용 (지양해야 함)
grep -rE "\$queryRawUnsafe|\$executeRawUnsafe" --include="*.ts"

# Raw 쿼리에서 문자열 연결
grep -rE "Prisma\.sql\`.*\+|\.raw\(.*\+" --include="*.ts"
```

**통과 기준**: `Prisma.sql` 템플릿 태그 또는 ORM 메서드를 사용하여 파라미터화된 쿼리 사용
**심각도**: Critical

---

### NoSQL 인젝션 (MongoDB)

**검색 패턴**:
```bash
# MongoDB 쿼리에 직접적인 사용자 입력 사용
grep -rE "\.find\(\s*\{.*req\.(body|query|params)|\.findOne\(\s*\{.*req\." --include="*.ts"

# $where 연산자 (위험)
grep -rE "\$where" --include="*.ts"

# 사용자 입력으로 검증되지 않은 정규식 생성
grep -rE "new RegExp\(.*req\.|RegExp\(.*body\." --include="*.ts"
```

**통과 기준**: 모든 쿼리 입력을 검증 및 살균(sanitize); `$where` 사용 금지
**심각도**: Critical

---

### 하드코딩된 비밀 (Hardcoded Secrets)

**검색 패턴**:
```bash
# 코드 내 API 키 및 시크릿
grep -rE "(api_?key|apiKey|secret|password|token|credential)\s*[:=]\s*['\"][^'\"]{8,}" --include="*.ts" | grep -v "process\.env\|configService"

# 하드코딩된 JWT 시크릿
grep -rE "secret:\s*['\"][^'\"]+['\"]" --include="*.ts" | grep -v "process\.env\|configService"

# 자격 증명이 포함된 데이터베이스 URL
grep -rE "(mongodb|mysql|postgres)://[^:]+:[^@]+@" --include="*.ts"
```

**통과 기준**: 모든 비밀은 환경 변수 또는 ConfigService에서 가져와야 함
**심각도**: Critical

---

### 경로 순회 (Path Traversal)

**검색 패턴**:
```bash
# 살균되지 않은 파일 경로
grep -rE "path\.join\(.*req\.(body|query|params)|fs\.(readFile|writeFile|unlink).*req\." --include="*.ts"

# 파일 작업에 직접적인 사용자 입력 사용
grep -rE "createReadStream\(.*req\.|createWriteStream\(.*req\." --include="*.ts"
```

**통과 기준**: 모든 파일 경로 검증 및 정규화; 허용 목록(allowlist) 사용
**심각도**: Critical

---

### SSRF (서버 측 요청 위조)

**검색 패턴**:
```bash
# 사용자 제어 URL로 HTTP 요청
grep -rE "(axios|fetch|got|node-fetch)\.(get|post|put|delete)?\(.*req\.(body|query|params)" --include="*.ts"

# 사용자 입력이 있는 HttpService
grep -rE "httpService\.(get|post|put|delete|request)\(.*req\." --include="*.ts"
```

**통과 기준**: URL을 허용 목록과 대조하여 검증; 내부 IP 차단
**심각도**: High

---

### 취약한 암호화 (Weak Cryptography)

**검색 패턴**:
```bash
# 비밀번호나 토큰에 MD5/SHA1 사용
grep -rE "createHash\(['\"]md5['\"]|createHash\(['\"]sha1['\"]" --include="*.ts" | grep -iE "password|token|secret"

# 약한 bcrypt 라운드 (< 10)
grep -rE "bcrypt\.(hash|genSalt)\([^,]+,\s*[0-9]\)" --include="*.ts"
```

**통과 기준**: 비밀번호에는 bcrypt (10+ 라운드) 또는 argon2 사용
**심각도**: High

---

### 속도 제한 누락 (Missing Rate Limiting)

**검색 패턴**:
```bash
# 스로틀링 없는 인증 엔드포인트
grep -rE "@(Post|Put)\(['\"].*/(login|register|auth|password)" --include="*.ts" -B 5 | grep -v "@Throttle\|@UseGuards.*ThrottlerGuard"

# 속도 제한 없는 공개 엔드포인트
grep -rE "@Public\(\)" --include="*.ts" -A 5 | grep -v "@Throttle"
```

**통과 기준**: 인증 및 공개 엔드포인트에 속도 제한 적용
**심각도**: High

---

## 카테고리: NestJS 패턴

### 엔드포인트에 DTO 누락

**검색 패턴**:
```bash
# @Body() DTO 없는 POST/PUT/PATCH
grep -rE "@(Post|Put|Patch)\(" --include="*.controller.ts" -A 5 | grep -E "async\s+\w+\([^)]*\)" | grep -v "@Body\(\)"

# DTO 타입이 없는 @Body()
grep -rE "@Body\(\)\s+\w+:\s*(any|object|Object)" --include="*.ts"

# @Body()에 타입 어노테이션 누락
grep -rE "@Body\(\)\s+\w+[^:]" --include="*.ts"
```

**통과 기준**: 모든 요청 바디는 검증이 포함된 타입화된 DTO 사용
**심각도**: High

---

### ValidationPipe 누락

**검색 패턴**:
```bash
# ValidationPipe 없는 컨트롤러
grep -rE "@Controller\(" --include="*.ts" -l | xargs grep -L "ValidationPipe\|@UsePipes"

# class-validator 데코레이터 없는 DTO
grep -rE "class\s+\w+Dto" --include="*.dto.ts" -A 20 | grep -v "@Is|@Min|@Max|@Length|@Matches|@ValidateNested"
```

**통과 기준**: 전역 또는 컨트롤러별 ValidationPipe 활성화; DTO에 유효성 검사기 포함
**심각도**: High

---

### 응답 타입 누락

**검색 패턴**:
```bash
# 명시적 반환 타입이 없는 엔드포인트
grep -rE "@(Get|Post|Put|Patch|Delete)\(" --include="*.controller.ts" -A 3 | grep -E "async\s+\w+\([^)]*\)\s*\{" | grep -v ":\s*Promise<"

# @ApiResponse 데코레이터 누락 (Swagger 사용 시)
grep -rE "@(Get|Post|Put|Patch|Delete)\(" --include="*.controller.ts" -B 3 | grep -v "@ApiResponse\|@ApiOkResponse\|@ApiCreatedResponse"
```

**통과 기준**: 명시적 반환 타입; 문서화를 위한 Swagger 데코레이터
**심각도**: Medium

---

### 부적절한 의존성 주입

**검색 패턴**:
```bash
# DI 대신 직접 인스턴스화
grep -rE "new\s+\w+Service\(|new\s+\w+Repository\(" --include="*.ts" | grep -v "\.spec\.ts\|\.test\.ts"

# 서비스에 @Injectable() 누락
grep -rE "class\s+\w+Service" --include="*.service.ts" -B 2 | grep -v "@Injectable"
```

**통과 기준**: 생성자 주입 사용; 모든 서비스에 @Injectable() 적용
**심각도**: Medium

---

### 보호된 라우트에 가드 누락

**검색 패턴**:
```bash
# 보호되어야 하지만 가드가 없는 라우트
grep -rE "@(Post|Put|Patch|Delete)\(['\"].*/(admin|user|profile|settings)" --include="*.controller.ts" -B 5 | grep -v "@UseGuards\|@Auth"

# 가드가 전혀 없는 컨트롤러
grep -rE "@Controller\(" --include="*.controller.ts" -A 30 | grep -E "@(Post|Put|Patch|Delete)" | grep -v "@UseGuards\|@Public"
```

**통과 기준**: 보호된 라우트에 적절한 가드 적용
**심각도**: High

---

### 순환 의존성 위험

**검색 패턴**:
```bash
# forwardRef 사용 (잠재적 순환 의존성)
grep -rE "forwardRef\(\)" --include="*.ts"

# 모듈 간 상호 import
grep -rE "import.*from\s+['\"]\.\./" --include="*.module.ts"
```

**통과 기준**: forwardRef 최소화; 순환 의존성 리팩토링
**심각도**: Medium

---

## 카테고리: DTO 검증

### 필수 유효성 검사기 누락

**검색 패턴**:
```bash
# @IsString() 없는 문자열 필드
grep -rE "^\s+\w+:\s*string" --include="*.dto.ts" -B 2 | grep -v "@IsString\|@IsEmail\|@IsUrl\|@IsUUID\|@Matches"

# @IsNumber() 또는 @IsInt() 없는 숫자 필드
grep -rE "^\s+\w+:\s*number" --include="*.dto.ts" -B 2 | grep -v "@IsNumber\|@IsInt\|@Min\|@Max"

# @IsBoolean() 없는 불리언 필드
grep -rE "^\s+\w+:\s*boolean" --include="*.dto.ts" -B 2 | grep -v "@IsBoolean"
```

**통과 기준**: 모든 DTO 필드에 적절한 타입 유효성 검사기 포함
**심각도**: High

---

### 길이/범위 제약조건 누락

**검색 패턴**:
```bash
# 길이 제약 없는 문자열
grep -rE "@IsString\(\)" --include="*.dto.ts" -A 1 | grep -E "^\s+\w+:" | grep -v "@Length\|@MinLength\|@MaxLength"

# 범위 제약 없는 숫자
grep -rE "@Is(Number|Int)\(\)" --include="*.dto.ts" -A 1 | grep -E "^\s+\w+:" | grep -v "@Min\|@Max"
```

**통과 기준**: 문자열은 길이 제한, 숫자는 범위 제한 포함
**심각도**: Medium

---

### 안전하지 않은 선택적 필드

**검색 패턴**:
```bash
# @IsOptional() 없는 선택적 필드
grep -rE "\w+\?:" --include="*.dto.ts" -B 2 | grep -v "@IsOptional"

# 타입 검사기 없는 @IsOptional
grep -rE "@IsOptional\(\)" --include="*.dto.ts" -A 2 | grep -E "^\s+\w+.*:" | grep -v "@Is"
```

**통과 기준**: 선택적 필드에 @IsOptional() 및 타입 검사기 포함
**심각도**: Medium

---

### 중첩 검증 누락

**검색 패턴**:
```bash
# @ValidateNested() 없는 중첩 객체
grep -rE "^\s+\w+:\s*\w+Dto" --include="*.dto.ts" -B 2 | grep -v "@ValidateNested"

# @ValidateNested() 및 @Type() 없는 객체 배열
grep -rE "^\s+\w+:\s*\w+Dto\[\]" --include="*.dto.ts" -B 3 | grep -v "@ValidateNested\|@Type"
```

**통과 기준**: 중첩 DTO에 @ValidateNested() 및 @Type() 사용
**심각도**: High

---

### Transform 데코레이터 누락

**검색 패턴**:
```bash
# 변환되어야 하는 쿼리 파라미터
grep -rE "@Query\(\)\s+\w+:\s*(number|boolean)" --include="*.ts" | grep -v "@Transform\|@Type"

# Transform 없는 배열 파라미터
grep -rE "@Query\(['\"].*['\"].*\)\s+\w+:\s*\w+\[\]" --include="*.ts" | grep -v "@Transform"
```

**통과 기준**: 쿼리 파라미터가 예상 타입으로 적절히 변환됨
**심각도**: Medium

---

## 카테고리: Prisma/데이터베이스

### Raw 쿼리 인젝션 위험

**검색 패턴**:
```bash
# 안전하지 않은 raw 쿼리
grep -rE "\$queryRawUnsafe|\$executeRawUnsafe" --include="*.ts"

# Prisma.sql 없는 템플릿 리터럴
grep -rE "\$queryRaw\`|executeRaw\`" --include="*.ts" | grep -v "Prisma\.sql"
```

**통과 기준**: 파라미터화된 쿼리를 위해 `Prisma.sql` 템플릿 태그 사용
**심각도**: Critical

---

### 트랜잭션 누락

**검색 패턴**:
```bash
# 트랜잭션 없는 다중 쓰기 작업
grep -rE "prisma\.\w+\.(create|update|delete|upsert)" --include="*.ts" -A 5 -B 5 | grep -E "(create|update|delete)" | uniq -d

# 트랜잭션 없는 createMany/updateMany
grep -rE "\.(createMany|updateMany|deleteMany)\(" --include="*.ts" -B 10 | grep -v "\$transaction"
```

**통과 기준**: 관련된 쓰기 작업은 트랜잭션으로 묶어야 함
**심각도**: High

---

### N+1 쿼리 패턴

**검색 패턴**:
```bash
# 루프 내부의 쿼리
grep -rE "for\s*\(|\.forEach\(|\.map\(" --include="*.ts" -A 5 | grep -E "prisma\.\w+\.(find|create|update)"

# findMany에서 include/select 누락
grep -rE "\.findMany\(\s*\{" --include="*.ts" -A 5 | grep -v "include:\|select:"
```

**통과 기준**: Eager loading 사용; 루프 외부에서 배치 쿼리 실행
**심각도**: High

---

### Select/Include 최적화 누락

**검색 패턴**:
```bash
# select 없는 findMany (모든 컬럼 조회)
grep -rE "\.findMany\(\s*\)" --include="*.ts"
grep -rE "\.findMany\(\s*\{[^}]*\}\s*\)" --include="*.ts" | grep -v "select:\|include:"

# select 없는 findFirst/findUnique
grep -rE "\.(findFirst|findUnique)\(\s*\{" --include="*.ts" -A 10 | grep -v "select:"
```

**통과 기준**: 필요한 필드만 가져오도록 select 사용
**심각도**: Medium

---

### 소프트 삭제 미구현

**검색 패턴**:
```bash
# 하드 삭제 사용
grep -rE "\.delete\(|\.deleteMany\(" --include="*.ts" | grep -v "\.spec\.ts\|\.test\.ts"

# deletedAt 필터 누락
grep -rE "\.findMany\(|\.findFirst\(" --include="*.ts" | grep -v "deletedAt"
```

**통과 기준**: deletedAt을 사용한 소프트 삭제; 삭제된 레코드 필터링
**심각도**: Medium (상황에 따라 다름)

---

### 데이터베이스 인덱스 누락

**검색 기법**:
- 자주 조회되는 필드에 대한 Prisma 스키마 검토
- 필터/정렬 필드에 Use @@index가 있는지 확인

**검색 패턴**:
```bash
# 자주 필터링되지만 인덱스가 누락될 수 있는 필드
grep -rE "where:\s*\{[^}]*\w+:" --include="*.ts" -o | sed 's/.*://' | sort | uniq -c | sort -rn

# schema.prisma에서 @@index 확인
grep -E "@@index|@@unique" schema.prisma
```

**통과 기준**: 자주 필터링되는 필드에 인덱스 존재
**심각도**: Medium

---

## 카테고리: 에러 처리 (Backend)

### 빈 Catch 블록

**검색 패턴**:
```bash
# 빈 catch
grep -rE "catch\s*\([^)]*\)\s*\{\s*\}" --include="*.ts"

# console.log만 있는 catch
grep -rE "catch\s*\([^)]*\)\s*\{[^}]*console\.(log|error)[^}]*\}" --include="*.ts" | grep -v "throw"
```

**통과 기준**: 모든 에러는 적절히 로그를 남기고 처리해야 함
**심각도**: High

---

### 일반적인 예외 처리

**검색 패턴**:
```bash
# 구체적인 처리 없이 Error 잡기
grep -rE "catch\s*\(\s*\w+\s*\)" --include="*.ts" -A 3 | grep -v "instanceof\|\.name\s*===\|HttpException\|PrismaClientKnownRequestError"

# HttpException 대신 일반 Error 던지기
grep -rE "throw new Error\(" --include="*.controller.ts"
```

**통과 기준**: 구체적인 예외 타입 사용; 컨트롤러에서는 HttpException 던지기
**심각도**: Medium

---

### Exception Filter 누락

**검색 패턴**:
```bash
# 잡히지 않는 Prisma 에러
grep -rE "PrismaClientKnownRequestError" --include="*.ts" | wc -l
# 이를 처리하는 예외 필터가 있어야 함

# 예외 처리가 없는 컨트롤러
grep -rE "@Controller\(" --include="*.ts" -l | xargs grep -L "HttpException\|@UseFilters"
```

**통과 기준**: Prisma 에러를 위한 전역 또는 컨트롤러 수준의 예외 필터
**심각도**: Medium

---

### 삼켜진(Swallowed) 예외

**검색 패턴**:
```bash
# throw나 return 없는 catch
grep -rE "catch\s*\([^)]*\)\s*\{" --include="*.ts" -A 10 | grep -v "throw\|return\|res\.(status|json|send)"
```

**통과 기준**: 예외를 다시 던지거나(re-throw) 적절히 처리
**심각도**: High

---

### 에러 응답 스키마 누락

**검색 패턴**:
```bash
# 구조화된 세부 정보 없는 HttpException
grep -rE "throw new (Http|Bad|Unauthorized|Forbidden|NotFound)Exception\(['\"][^'\"]+['\"]" --include="*.ts" | grep -v "\{.*message"

# 일관성 없는 에러 포맷
grep -rE "throw new HttpException\(" --include="*.ts" -A 1 | grep -E "HttpStatus\." | sort | uniq
```

**통과 기준**: 일관된 에러 응답 구조
**심각도**: Low

---

## 카테고리: 비동기 패턴

### 처리되지 않은 Promise 거부 (Unhandled Promise Rejection)

**검색 패턴**:
```bash
# try-catch 없는 async
grep -rE "async\s+\w+\([^)]*\)\s*\{" --include="*.ts" -A 20 | grep -v "try\s*\{" | head -50

# catch 없는 Promise
grep -rE "\.then\(" --include="*.ts" | grep -v "\.catch\("

# await 누락
grep -rE "prisma\.\w+\.(find|create|update|delete)" --include="*.ts" | grep -v "await\|return"
```

**통과 기준**: 모든 비동기 작업에 에러 처리 포함
**심각도**: High

---

### Await 누락

**검색 패턴**:
```bash
# await 없는 비동기 호출
grep -rE "(prisma|repository|service)\.\w+\(" --include="*.ts" | grep -v "await\s\|return\s"

# await 없는 Promise.all
grep -rE "Promise\.(all|race|allSettled)\(" --include="*.ts" | grep -v "await"
```

**통과 기준**: 모든 Promise를 await하거나 return
**심각도**: Critical

---

### 비동기 컨텍스트에서 블로킹 작업

**검색 패턴**:
```bash
# 동기 파일 작업
grep -rE "fs\.(readFileSync|writeFileSync|existsSync)" --include="*.ts" | grep -v "\.spec\.ts"

# 핸들러 내 동기 암호화 작업
grep -rE "crypto\.\w+Sync\(" --include="*.ts"
```

**통과 기준**: 요청 핸들러에서는 비동기 버전 사용
**심각도**: Medium

---

## 카테고리: Express/미들웨어

### 요청 검증 누락

**검색 패턴**:
```bash
# 검증 없이 req.body 직접 접근 (Express)
grep -rE "req\.body\.\w+" --include="*.ts" | grep -v "class-validator\|ValidationPipe\|validate\("

# 파싱 없이 req.params 직접 접근
grep -rE "req\.params\.\w+" --include="*.ts" | grep -v "parseInt\|Number\|validate"
```

**통과 기준**: 모든 요청 데이터 사용 전 검증
**심각도**: High

---

### CORS 구성 누락

**검색 패턴**:
```bash
# 옵션 없이 CORS 활성화
grep -rE "app\.enableCors\(\s*\)" --include="*.ts"

# 와일드카드 origin
grep -rE "origin:\s*['\"]?\*['\"]?" --include="*.ts"
```

**통과 기준**: 특정 origin으로 CORS 구성
**심각도**: Medium

---

### Helmet/보안 헤더 누락

**검색 패턴**:
```bash
# helmet 사용 확인
grep -rE "helmet\(" --include="*.ts" | wc -l

# 보안 헤더 미들웨어 확인
grep -rE "app\.use\(.*helmet\|X-Content-Type-Options\|X-Frame-Options" --include="*.ts"
```

**통과 기준**: helmet 또는 수동으로 보안 헤더 구성
**심각도**: Medium

---

### 로그 내 민감 데이터

**검색 패턴**:
```bash
# 요청 바디 로깅 (비밀번호 포함 가능성)
grep -rE "console\.(log|info|debug)\(.*req\.body|logger\.\w+\(.*req\.body" --include="*.ts"

# 사용자 자격 증명 로깅
grep -rE "console\.(log|info)\(.*password|logger\.\w+\(.*password" --include="*.ts"
```

**통과 기준**: 로그에서 민감 필드 마스킹(redact)
**심각도**: High

---

## 카테고리: TypeScript 품질

### Any 타입 사용

**검색 패턴**:
```bash
# 명시적 any
grep -rE ":\s*any\b|<any>|as any" --include="*.ts" | grep -v "\.spec\.ts\|\.test\.ts\|\.d\.ts"

# 암시적 any (함수 파라미터)
grep -rE "function\s+\w+\([^:)]+\)" --include="*.ts" | grep -v "\.spec\.ts"
```

**통과 기준**: any 최소화; unknown 또는 적절한 타입 사용
**심각도**: Medium

---

### Null 체크 누락

**검색 패턴**:
```bash
# Optional chaining 필요 가능성
grep -rE "\w+\.\w+\.\w+" --include="*.ts" | grep -v "\?\.\|&&\|if\s*\("

# findFirst/findUnique 결과 체크 안 함
grep -rE "\.(findFirst|findUnique)\(" --include="*.ts" -A 3 | grep -v "if\s*\(\|?\.\|\?\?"
```

**통과 기준**: 데이터베이스 쿼리의 null 케이스 처리
**심각도**: High

---

### 타입 단언(Assertion) 남용

**검색 패턴**:
```bash
# Non-null 단언
grep -rE "\w+!" --include="*.ts" | grep -v "\.spec\.ts\|\.test\.ts"

# 검증 없는 타입 단언
grep -rE "as\s+\w+" --include="*.ts" | grep -v "as const\|as string\|as number\|\.spec\.ts"
```

**통과 기준**: 단언 전 검증; non-null 단언 지양
**심각도**: Medium

---

### 사용되지 않는 임포트/변수

**검색 패턴**:
```bash
# TypeScript 컴파일러 확인
npx tsc --noEmit 2>&1 | grep -E "is declared but|is defined but never used"

# ESLint 사용되지 않는 변수
npx eslint . --format compact 2>&1 | grep "no-unused-vars"
```

**통과 기준**: 사용되지 않는 임포트나 변수 없음
**심각도**: Low

---

## 카테고리: 테스팅 지표

### 테스트 커버리지 누락

**검색 패턴**:
```bash
# 테스트 파일 없는 서비스
for f in $(find . -name "*.service.ts" -not -name "*.spec.ts"); do
  test_file="${f%.ts}.spec.ts"
  [ ! -f "$test_file" ] && echo "Missing: $test_file"
done

# 테스트 파일 없는 컨트롤러
for f in $(find . -name "*.controller.ts" -not -name "*.spec.ts"); do
  test_file="${f%.ts}.spec.ts"
  [ ! -f "$test_file" ] && echo "Missing: $test_file"
done
```

**통과 기준**: 핵심 서비스 및 컨트롤러에 테스트 파일 존재
**심각도**: Medium

---

### 테스트 어설션 누락

**검색 패턴**:
```bash
# 어설션 없는 테스트
grep -rE "it\(['\"].*['\"],\s*(async\s*)?\(\)\s*=>\s*\{" --include="*.spec.ts" -A 10 | grep -v "expect\|assert\|should"
```

**통과 기준**: 모든 테스트에 의미 있는 어설션 포함
**심각도**: Medium

---

## 에이전트를 위한 참고사항

1. **범위를 diff로 한정**: 변경된 라인의 문제만 지적하세요
2. **파일 확장자**: `.ts` 파일에 집중하고, diff에 명시되지 않는 한 `.js`는 무시하세요
3. **Prisma 특이사항**: 서비스 파일과 schema.prisma 변경을 모두 확인하세요
4. **NestJS 구조**: 리뷰 시 모듈 경계를 고려하세요
5. **TypeScript strict**: strict 모드가 잡아낼 수 있는 문제를 플래그 지정하세요
6. **MongoDB vs SQL**: 사용 중인 데이터베이스에 따라 적절한 체크를 적용하세요
7. **Express vs NestJS**: 일부 패턴이 다릅니다; 임포트/데코레이터로 감지하세요