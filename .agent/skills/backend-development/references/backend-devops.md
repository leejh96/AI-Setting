# Backend DevOps Practices (백엔드 데웁스 프랙티스)

CI/CD 파이프라인, 컨테이너화, 배포 전략 및 모니터링 (2025).

## 배포 전략 (Deployment Strategies)

### 블루-그린 배포 (Blue-Green Deployment)

**개념:** 두 개의 동일한 환경 (Blue=현재, Green=신규)

```
운영 트래픽    → Blue (v1.0)
                 Green (v2.0) ← 배포 및 테스트

스위칭(Switch):
운영 트래픽    → Green (v2.0)
                 Blue (v1.0) ← 즉시 롤백 가능 상태로 대기
```

**장점:**
- 무중단 배포 (Zero downtime)
- 즉각적인 롤백 가능
- 전환 전 실제 환경과 동일한 곳에서 테스트 가능

**단점:**
- 인프라 비용 2배
- 데이터베이스 마이그레이션 전략 복잡 (하위 호환성 유지 필요)

### 카나리 배포 (Canary Deployment)

**개념:** 점진적인 트래픽 전환 (1% → 5% → 25% → 100%)

```bash
# Kubernetes 카나리 배포 예시
kubectl set image deployment/api api=myapp:v2
kubectl rollout pause deployment/api  # 초기 복제본에서 일시 정지

# 메트릭 모니터링 후 정상적이면 진행
kubectl rollout resume deployment/api
```

**장점:**
- 리스크 최소화
- 조기 문제 감지
- 실제 사용자 피드백 반영

**단점:**
- 모니터링 시스템 필수
- 배포 시간 길어짐

### 피처 플래그 (Feature Flags - 점진적 전달)

**효과:** 카나리와 결합 시 배포 실패율 90% 감소

```typescript
import { LaunchDarkly } from 'launchdarkly-node-server-sdk';

const client = LaunchDarkly.init(process.env.LD_SDK_KEY);

// 피처 플래그 확인
const showNewCheckout = await client.variation('new-checkout', user, false);

if (showNewCheckout) {
  return newCheckoutFlow(req, res);
} else {
  return oldCheckoutFlow(req, res);
}
```

**사용 사례:** 점진적 기능 출시, A/B 테스팅, 킬 스위치(Kill switch)

## Docker 컨테이너화

### 멀티 스테이지 빌드 (이미지 크기 최적화)

```dockerfile
# 빌드 단계
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build

# 프로덕션 단계
FROM node:20-alpine
WORKDIR /app

# 필요한 파일만 복사
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./

# 보안: non-root 유저로 실행
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001
USER nodejs

EXPOSE 3000
CMD ["node", "dist/main.js"]
```

**이점:** 이미지 크기 50-90% 감소, 배포 속도 향상, 공격 표면 감소

### Docker Compose (로컬 개발용)

```yaml
version: '3.8'

services:
  api:
    build: .
    ports:
      - "3000:3000"
    environment:
      # PostgreSQL 예시
      - DATABASE_URL=postgresql://postgres:password@db:5432/myapp
      # MySQL 예시
      # - DATABASE_URL=mysql://root:password@db-mysql:3306/myapp
      - REDIS_URL=redis://redis:6379
    depends_on:
      - db
      # - db-mysql
      - redis

  db:
    image: postgres:15-alpine
    environment:
      - POSTGRES_PASSWORD=password
      - POSTGRES_DB=myapp
    volumes:
      - postgres-data:/var/lib/postgresql/data

  # MySQL 서비스 추가
  # db-mysql:
  #   image: mysql:8.0
  #   environment:
  #     MYSQL_ROOT_PASSWORD: password
  #     MYSQL_DATABASE: myapp
  #     MYSQL_USER: user
  #     MYSQL_PASSWORD: password
  #   volumes:
  #     - mysql-data:/var/lib/mysql

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  postgres-data:
  # mysql-data:
```

## Kubernetes 오케스트레이션

### Deployment Manifest

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-deployment
spec:
  replicas: 3
  selector:
    matchLabels:
      app: api
  template:
    metadata:
      labels:
        app: api
    spec:
      containers:
      - name: api
        image: myregistry/api:v1.0.0
        ports:
        - containerPort: 3000
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: db-secret
              key: url
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
```

### 수평적 파드 오토스케일링 (HPA)

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api-deployment
  minReplicas: 3
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
```

## CI/CD 파이프라인

### GitHub Actions (모던, 통합형)

`jobs` 단계에서 테스트, 보안 스캔(Snyk), Docker 빌드 및 푸시, Kubernetes 배포까지 자동화하는 파이프라인 예시입니다. (원본 참조)

## 모니터링 & 관측 가능성 (Observability)

### 관측 가능성의 3대 기둥

**1. 메트릭 (Prometheus + Grafana)**
`prom-client`를 사용하여 요청 수(`http_requests_total`), 응답 시간(`http_request_duration_seconds`) 등을 수집하고 `/metrics` 엔드포인트로 노출합니다.

**2. 로그 (ELK Stack)**
Winston 등을 사용해 구조화된 JSON 로그를 생성하고 Elasticsearch, Logstash, Kibana로 전송하여 분석합니다.

**3. 트레이싱 (Jaeger/OpenTelemetry)**
OpenTelemetry SDK를 사용해 마이크로서비스 간의 요청 흐름(Trace)을 추적합니다. DB 쿼리, HTTP 요청 등이 자동으로 추적됩니다.

### 헬스 체크

- **Liveness Probe:** 애플리케이션이 살아있는지 확인 (실패 시 재시작)
- **Readiness Probe:** 트래픽을 받을 준비가 되었는지 확인 (DB 연결 등 확인, 실패 시 트래픽 차단)

## 시크릿 관리

### Kubernetes Secrets

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: db-secret
type: Opaque
stringData:
  # PostgreSQL
  url: postgresql://user:pass@host:5432/db
  # MySQL
  # url: mysql://user:pass@host:3306/db
```

## Infrastructure as Code (Terraform)

```hcl
# main.tf

# PostgreSQL RDS
resource "aws_db_instance" "postgres" {
  identifier        = "myapp-pg"
  engine            = "postgres"
  engine_version    = "15.3"
  instance_class    = "db.t3.micro"
  allocated_storage = 20
  username          = "admin"
  password          = var.db_password
}

# MySQL RDS
resource "aws_db_instance" "mysql" {
  identifier        = "myapp-mysql"
  engine            = "mysql"
  engine_version    = "8.0"
  instance_class    = "db.t3.micro"
  allocated_storage = 20
  username          = "admin"
  password          = var.db_password
}

resource "aws_elasticache_cluster" "redis" {
  cluster_id           = "myapp-redis"
  engine               = "redis"
  node_type            = "cache.t3.micro"
  num_cache_nodes      = 1
}
```

## DevOps 체크리스트

- [ ] CI/CD 파이프라인 구성 (GitHub Actions/GitLab CI)
- [ ] Docker 멀티 스테이지 빌드 적용
- [ ] Kubernetes 배포 매니페스트 작성
- [ ] 무중단 배포 전략 (Blue-Green/Canary)
- [ ] 피처 플래그 구성
- [ ] 헬스 체크 구현 (Liveness/Readiness)
- [ ] 모니터링 설정 (Prometheus + Grafana)
- [ ] 로깅 통합 (ELK Stack)
- [ ] 분산 트레이싱 (Jaeger/OpenTelemetry)
- [ ] 시크릿 관리 (Vault/K8s Secrets)
- [ ] IaC 적용 (Terraform)
- [ ] 오토스케일링 구성
- [ ] 백업 및 재해 복구(DR) 계획

## 리소스

- **Kubernetes:** https://kubernetes.io/docs/
- **Docker:** https://docs.docker.com/
- **Prometheus:** https://prometheus.io/docs/
- **OpenTelemetry:** https://opentelemetry.io/docs/
- **Terraform:** https://www.terraform.io/docs/
