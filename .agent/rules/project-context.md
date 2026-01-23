---
trigger: always_on
---

# Project Context

> 이 파일은 프로젝트별로 커스터마이징하세요.

## 프로젝트 개요

- **프로젝트명**: [프로젝트 이름]
- **설명**: [간단한 설명]
- **도메인**: [e.g., LMS, E-commerce, SaaS]

## 기술 스택

### Backend
- **Runtime**: Node.js 24 LTS
- **Framework**: NestJS 10.x
- **Language**: TypeScript 5.x (strict)

### Database
- **Primary**: MySQL 8.0 (AWS RDS)
- **Cache**: Redis 7.x (ElastiCache)
- **Secondary**: MongoDB 7.x (Document storage)

### ORM / ODM
- **SQL**: Prisma 5.x
- **MongoDB**: Mongoose 8.x
- **Redis**: ioredis

### Infrastructure
- **Cloud**: AWS (primary), NCP (secondary)
- **Container**: Docker, ECS Fargate
- **CI/CD**: GitHub Actions
- **Message Queue**: AWS SQS

## 프로젝트 구조

```
project-root/
├── src/
│   ├── common/           # 공통 유틸리티
│   ├── config/           # 설정 모듈
│   ├── modules/          # 기능 모듈
│   │   ├── auth/
│   │   ├── user/
│   │   └── [feature]/
│   ├── prisma/           # Prisma 스키마
│   └── main.ts
├── test/                 # E2E 테스트
├── .agent/               # LLM 설정 (이 폴더)
├── docker-compose.yml
└── package.json
```

## 주요 모듈

### 인증 (Auth)
- JWT 기반 인증
- Refresh Token rotation
- 소셜 로그인 (Google, Kakao)

### 사용자 (User)
- 역할: Admin, Teacher, Student
- 프로필 관리
- 권한 체계

### [Feature Module]
- 설명
- 주요 기능

## 환경 변수

```bash
# Database
DATABASE_URL=mysql://...
MONGODB_URI=mongodb://...
REDIS_URL=redis://...

# Auth
JWT_SECRET=
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES_IN=7d

# AWS
AWS_REGION=ap-northeast-2
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=

# External APIs
[SERVICE]_API_KEY=
```

## 개발 컨벤션

### API 설계
- RESTful 원칙 준수
- 버저닝: `/api/v1/...`
- 응답 포맷: `{ success, data, error, meta }`

### 에러 코드 체계
- `AUTH_xxx`: 인증 관련
- `USER_xxx`: 사용자 관련
- `[DOMAIN]_xxx`: 도메인별 에러

### 테스트
- Unit: 서비스 로직 중심
- E2E: 주요 API 플로우
- 커버리지 목표: 80%+

## 현재 작업 컨텍스트

> 현재 진행 중인 작업이나 주의사항을 여기에 기록

### 진행 중
- [ ] Feature A 개발
- [ ] Bug fix #123

### 주의사항
- DB 마이그레이션 시 백업 필수
- 특정 API는 deprecated 예정

## 참고 링크

- [API 문서](https://...)
- [Wiki](https://...)
- [Figma](https://...)
