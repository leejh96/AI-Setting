# Frontend Review Checklist

React, TypeScript, Tailwind CSS, 및 React Query 코드베이스를 위한 도메인 특화 리뷰 항목입니다.

요약 테이블에 다음 카테고리를 추가하세요:
- React 아키텍처
- 상태 관리
- TypeScript 품질
- React Query
- Tailwind CSS
- 성능 (React)

---

## 카테고리: 보안 (Frontend)

### 위험한 HTML 렌더링 (XSS)

**검색 패턴**:
```bash
# dangerouslySetInnerHTML 사용 찾기
grep -r "dangerouslySetInnerHTML" --include="*.tsx" --include="*.jsx"

# innerHTML 할당 찾기
grep -r "\.innerHTML\s*=" --include="*.ts" --include="*.tsx" --include="*.js"
```

**통과 기준**: 사용하지 않거나, DOMPurify 등으로 입력을 적절히 살균(sanitize)해야 함
**심각도**: Critical

---

### 살균되지 않은 URL 파라미터

**검색 패턴**:
```bash
# URL 파라미터 직접 사용
grep -rE "(window\.location|useSearchParams|URLSearchParams)" --include="*.tsx" --include="*.ts"

# href/src 내 템플릿 리터럴
grep -rE "(href|src)=\{`" --include="*.tsx"
```

**통과 기준**: 사용 전 모든 URL 파라미터 검증
**심각도**: High

---

### localStorage 내 민감 데이터

**검색 패턴**:
```bash
grep -rE "localStorage\.(setItem|getItem).*['\"]?(token|auth|password|secret|key|credential)" --include="*.ts" --include="*.tsx"
```

**통과 기준**: 인증 토큰이나 비밀을 localStorage에 저장 금지 (httpOnly 쿠키 사용)
**심각도**: High

---

## 카테고리: React 아키텍처

### 갓 컴포넌트 (God Components - 과도하게 큰 컴포넌트)

**검색 기법**:
```bash
# 큰 컴포넌트 파일 찾기 (>300줄)
find . -name "*.tsx" -exec wc -l {} \; | awk '$1 > 300 {print}'

# 각 파일을 리뷰하여 확인:
# - 여러 관련 없는 책임
# - 많은 useState 호출 (>5)
# - 관심사 혼합 (데이터 페칭 + 로직 + UI)
```

**통과 기준**: 300줄을 넘거나 관심사가 혼합된 컴포넌트 없어야 함
**심각도**: Medium

---

### 배열 인덱스를 Key로 사용

**검색 패턴**:
```bash
grep -rE "key=\{(index|i|idx)\}" --include="*.tsx" --include="*.jsx"
grep -rE "\.map\([^)]*,\s*(index|i|idx)\)" --include="*.tsx" --include="*.jsx"
```

**통과 기준**: 동적 리스트에서 인덱스 기반 키 사용 금지
**심각도**: Medium

---

### 리스트에 Key 누락

**검색 기법**:
```bash
# map 호출을 찾은 후 key prop 존재 여부 확인
grep -rn "\.map(" --include="*.tsx" --include="*.jsx"
# 반환된 요소에 key prop이 있는지 리뷰
```

**통과 기준**: 모든 매핑된 요소는 고유하고 안정적인 key를 가져야 함
**심각도**: Medium

---

### Prop Drilling (3단계 이상)

**검색 기법**:
- 사용하지 않고 props를 전달하는 컴포넌트 식별
- 여러 중첩된 컴포넌트 시그니처에서 동일한 prop 이름 확인
- 중간 컴포넌트를 통해 변경 없이 전달되는 props 검색

**통과 기준**: Props가 2단계 이상의 컴포넌트를 거쳐 전달되지 않아야 함
**심각도**: Low

---

### 알 수 없는 Props 전파 (Spreading Unknown Props)

**검색 패턴**:
```bash
grep -rE "\{\.\.\.props\}|\{\.\.\.rest\}" --include="*.tsx"
```

**리뷰**: 전파가 의도적이고 타입이 지정되었는지 확인, DOM 요소에 전파하지 않는지 확인
**통과 기준**: 타입이 지정되지 않은 props를 DOM 요소에 전파 금지
**심각도**: Medium

---

## 카테고리: 상태 관리

### 변수로 선언된 상태

**검색 패턴**:
```bash
# 상태여야 하는 컴포넌트 본문 내 변수
grep -rE "^\s+(let|var)\s+\w+\s*=" --include="*.tsx" -A 5 | grep -v "const"
```

**통과 기준**: 지속되는 값은 useState 또는 useRef 사용
**심각도**: High

---

### 직접적인 상태 변조 (Direct State Mutation)

**검색 패턴**:
```bash
# 배열 변조
grep -rE "\.(push|pop|shift|unshift|splice|sort|reverse)\(" --include="*.tsx" --include="*.ts"

# 상태 객체 속성 할당
grep -rE "state\.\w+\s*=" --include="*.tsx"
```

**통과 기준**: 모든 상태 업데이트는 새로운 참조를 생성해야 함
**심각도**: High

---

### Props를 State로 복사

**검색 패턴**:
```bash
grep -rE "useState\(props\." --include="*.tsx"
grep -rE "useState\(\{.*props\." --include="*.tsx"
```

**통과 기준**: Props를 State로 복사 금지 (의도적인 "초기값" 패턴 제외)
**심각도**: Medium

---

### 파생 상태 저장

**검색 기법**:
- 다른 상태로부터 계산되는 useState 찾기
- "total", "count", "sum", "filtered", "sorted" 같은 상태 변수 검색
- useMemo로 계산 가능한지 확인

**통과 기준**: 계산된 값은 렌더링 중 또는 useMemo로 도출, 별도 저장 금지
**심각도**: Medium

---

### useEffect 의존성 누락

**검색 패턴**:
```bash
# 외부 스코프를 참조하지만 빈 의존성 배열
grep -rE "useEffect\([^)]+,\s*\[\s*\]\)" --include="*.tsx" -A 10
```

**리뷰**: 이펙트 본문이 deps 배열에 없는 변수를 참조하는지 확인
**통과 기준**: 참조된 모든 변수가 의존성 배열에 있어야 함
**심각도**: High

---

### useEffect 내 데이터 페칭

**검색 패턴**:
```bash
grep -rE "useEffect.*fetch\(|useEffect.*axios\.|useEffect.*\.get\(" --include="*.tsx"
```

**통과 기준**: 데이터 페칭은 raw useEffect 대신 React Query 사용
**심각도**: Medium

---

## 카테고리: TypeScript 품질

### Any 타입 사용

**검색 패턴**:
```bash
grep -rE ":\s*any\b|<any>|as any" --include="*.ts" --include="*.tsx"
```

**통과 기준**: `any` 타입 금지 (또는 주석으로 정당화)
**심각도**: High

---

### 타입 단언 (as Type)

**검색 패턴**:
```bash
grep -rE "\bas\s+\w+" --include="*.ts" --include="*.tsx" | grep -v "as const"
```

**리뷰**: 각 단언이 필요하고 안전한지 확인
**통과 기준**: 최소한의 단언, 안전하지 않게 타입 체크를 우회하는 단언 금지
**심각도**: Medium

---

### 컴포넌트 Prop 타입 누락

**검색 패턴**:
```bash
# 타입 없는 props를 가진 함수
grep -rE "function\s+\w+\s*\(\s*props\s*\)" --include="*.tsx"
grep -rE "const\s+\w+\s*=\s*\(\s*props\s*\)" --include="*.tsx"

# 타입 어노테이션 없는 화살표 함수
grep -rE "=>\s*\{" --include="*.tsx" -B 2 | grep -v "Props"
```

**통과 기준**: 모든 컴포넌트는 명시적 prop 인터페이스를 가져야 함
**심각도**: Medium

---

### 이벤트 핸들러 타입

**검색 패턴**:
```bash
grep -rE "\(e\)|\(event\)|\(e:\s*any\)" --include="*.tsx"
```

**통과 기준**: 이벤트 핸들러는 적절한 React 이벤트 타입 사용
**심각도**: Low

---

### 타입 없는 API 응답

**검색 패턴**:
```bash
grep -rE "\.then\(\s*\(?\s*data\s*\)?" --include="*.ts" --include="*.tsx"
grep -rE "await fetch" --include="*.ts" --include="*.tsx"
```

**통과 기준**: 모든 API 응답은 정의된 타입을 가져야 함
**심각도**: High

---

### ts-ignore 및 ts-nocheck

**검색 패턴**:
```bash
grep -rE "@ts-ignore|@ts-nocheck|@ts-expect-error" --include="*.ts" --include="*.tsx"
```

**통과 기준**: 억제(suppression) 금지, 또는 정당화 주석 포함
**심각도**: High

---

## 카테고리: React Query (TanStack Query)

### QueryClientProvider 누락

**검색 기법**:
- 앱 루트/진입점에서 QueryClientProvider 확인
- Provider가 전체 애플리케이션을 감싸는지 검증

**통과 기준**: 앱 루트에 QueryClientProvider 존재
**심각도**: Critical (React Query 사용 시)

---

### Query Key에 동적 파라미터 누락

**검색 패턴**:
```bash
grep -rE "queryKey:\s*\[['\"]" --include="*.ts" --include="*.tsx" -A 5
```

**리뷰**: queryFn이 queryKey에 없는 변수를 사용하는지 확인
**통과 기준**: 모든 동적 파라미터가 queryKey에 포함되어야 함
**심각도**: High

---

### Query 데이터를 Redux/Context로 복사

**검색 패턴**:
```bash
grep -rE "dispatch\(.*data\)" --include="*.tsx"
grep -rE "useEffect.*set.*\(.*data" --include="*.tsx"
```

**통과 기준**: Query 데이터는 직접 사용해야 하며, 다른 상태로 동기화 금지
**심각도**: Medium

---

### 조건부 쿼리에 Enabled 플래그 누락

**검색 패턴**:
```bash
grep -rE "useQuery\(" --include="*.tsx" -A 10 | grep -v "enabled"
```

**리뷰**: 쿼리가 undefined 값에 의존하는지 확인
**통과 기준**: 조건부 쿼리는 `enabled` 플래그 사용
**심각도**: Medium

---

### Mutation 후 Query 무효화 누락

**검색 패턴**:
```bash
grep -rE "useMutation\(" --include="*.tsx" -A 15
```

**리뷰**: queryClient.invalidateQueries와 함께 onSuccess/onSettled 확인
**통과 기준**: Mutation은 관련 쿼리를 무효화해야 함
**심각도**: High

---

## 카테고리: Tailwind CSS

### 임의 값 (Magic Numbers)

**검색 패턴**:
```bash
grep -rE "\[([\d]+px|[\d]+rem|#[a-fA-F0-9]+)\]" --include="*.tsx" --include="*.jsx"
```

**플래그 예시**: `w-[347px]`, `text-[13px]`, `bg-[#ff5733]`
**통과 기준**: 임의 값 대신 config의 디자인 토큰 사용
**심각도**: Medium

---

### 반응형 변형 누락

**검색 기법**:
- 레이아웃 컴포넌트의 반응형 중단점(breakpoints) 확인
- `sm:`, `md:`, `lg:` 변형 없는 고정 너비 찾기

**통과 기준**: 주요 레이아웃에 반응형 변형 포함
**심각도**: Medium

---

### 포커스 상태 누락

**검색 패턴**:
```bash
grep -rE "<button|<a\s|onClick" --include="*.tsx" | grep -v "focus:"
```

**통과 기준**: 상호작용 요소에 포커스 표시기 포함
**심각도**: High (접근성)

---

### !important 과용

**검색 패턴**:
```bash
grep -rE "!\w+-" --include="*.tsx"
```

**예시**: `!mt-4`, `!text-red-500`
**통과 기준**: `!important` 사용 최소화 또는 금지
**심각도**: Low

---

### 충돌하는 클래스

**검색 패턴**:
```bash
# 동일한 className 내의 모순되는 유틸리티 찾기
grep -rE "flex.*block|block.*flex|hidden.*visible|mt-\d+.*mt-\d+" --include="*.tsx"
```

**통과 기준**: 충돌하는 유틸리티 클래스 없음
**심각도**: Low

---

### 인라인 스타일과 Tailwind 혼용

**검색 패턴**:
```bash
grep -rE "style=\{" --include="*.tsx" | grep "className"
```

**통과 기준**: 일관된 접근 방식 - Tailwind 또는 인라인 중 하나만 사용
**심각도**: Low

---

## 카테고리: 성능 (React)

### 비용이 큰 연산에 useMemo 누락

**검색 기법**:
- 렌더링 내의 `.filter()`, `.map()`, `.reduce()`, `.sort()` 찾기
- 결과가 메모이제이션 되었는지 확인

**통과 기준**: 비용이 큰 연산은 메모이제이션
**심각도**: Medium

---

### Prop 함수에 useCallback 누락

**검색 패턴**:
```bash
grep -rE "on\w+=\{\s*\(" --include="*.tsx"
```

**리뷰**: 인라인 함수가 메모이제이션된 자식에게 전달되는지 확인
**통과 기준**: 적절한 경우 콜백 props에 useCallback 사용
**심각도**: Low

---

### 가상화 없는 대용량 리스트

**검색 기법**:
- 리스트를 렌더링하는 `.map()` 호출 찾기
- 배열 크기(정적인 경우) 또는 데이터 소스 크기 확인

**통과 기준**: 100개 이상의 항목 리스트는 가상화 사용
**심각도**: Medium

---

### Error Boundary 누락

**검색 패턴**:
```bash
grep -rE "componentDidCatch|ErrorBoundary" --include="*.tsx"
```

**통과 기준**: 중요 섹션에 에러 경계(Error boundaries) 존재
**심각도**: Medium

---

### 로딩 상태 누락

**검색 기법**:
- 데이터를 페칭하는 컴포넌트 리뷰
- 로딩 표시기 확인

**검색 패턴**:
```bash
grep -rE "isLoading|isPending|loading" --include="*.tsx"
```

**통과 기준**: 비동기 작업에 로딩 상태 표시
**심각도**: Medium

---

### 에러 상태 누락

**검색 패턴**:
```bash
grep -rE "isError|error\s*\?" --include="*.tsx"
```

**통과 기준**: 에러 조건이 처리되고 표시됨
**심각도**: Medium
