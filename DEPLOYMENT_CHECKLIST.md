# 🚀 배포 체크리스트 및 가이드

> AI 캐릭터 챗 플랫폼 전체 배포를 위한 종합 가이드

## 📋 목차

1. [인프라 구성요소](#인프라-구성요소)
2. [환경 변수 설정](#환경-변수-설정)
3. [데이터베이스 설정](#데이터베이스-설정)
4. [Docker 배포](#docker-배포)
5. [클라우드 플랫폼 배포](#클라우드-플랫폼-배포)
6. [보안 설정](#보안-설정)
7. [모니터링 및 로깅](#모니터링-및-로깅)
8. [배포 전 체크리스트](#배포-전-체크리스트)

---

## 🏗 인프라 구성요소

### 필수 서비스

| 서비스 | 기술 스택 | 포트 | 역할 |
|--------|----------|------|------|
| **Frontend** | React + Vite | 5173 | 사용자 인터페이스 |
| **Backend API** | FastAPI (Python 3.11) | 8000 | REST API 서버 |
| **Chat Server** | Node.js + Socket.IO | 3001 | 실시간 채팅 서버 |
| **Database** | PostgreSQL 15 / SQLite | 5432 | 데이터 저장소 |
| **Redis** | Redis 7 | 6379 | 캐시 및 세션 관리 |
| **Nginx** | Nginx Alpine | 80/443 | 리버스 프록시 |

### 선택적 서비스

- **Celery Worker**: 백그라운드 작업 처리 (선택사항)
- **PostgreSQL**: 프로덕션 환경 권장
- **SQLite**: 개발 환경용 (간단한 설정)

---

## 🔐 환경 변수 설정

### 1. 프로젝트 루트 `.env` 파일

```env
# ============================================
# 환경 설정
# ============================================
ENVIRONMENT=production
DEBUG=false
NODE_ENV=production

# ============================================
# 데이터베이스 설정
# ============================================
# PostgreSQL (프로덕션 권장)
DATABASE_URL=postgresql+asyncpg://user:password@host:5432/dbname

# SQLite (개발용)
# DATABASE_URL=sqlite:///./data/test.db

# ============================================
# Redis 설정
# ============================================
REDIS_URL=redis://localhost:6379/0

# ============================================
# JWT 인증 설정
# ============================================
JWT_SECRET_KEY=your-super-secret-jwt-key-change-this-in-production-MUST-CHANGE
JWT_ALGORITHM=HS256
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=30
JWT_REFRESH_TOKEN_EXPIRE_DAYS=7

# ============================================
# AI API 키 (최소 1개 필수)
# ============================================
GEMINI_API_KEY=your-gemini-api-key-here
CLAUDE_API_KEY=your-claude-api-key-here
OPENAI_API_KEY=your-openai-api-key-here
IMAGEN_API_KEY=your-imagen-api-key-here

# ============================================
# 프론트엔드 URL 설정
# ============================================
FRONTEND_BASE_URL=https://your-domain.com
VITE_API_URL=https://api.your-domain.com
VITE_SOCKET_URL=wss://socket.your-domain.com

# ============================================
# 이메일 설정 (선택사항)
# ============================================
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your-email@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_USE_TLS=true
EMAIL_FROM_ADDRESS=noreply@your-domain.com
EMAIL_FROM_NAME=AI 캐릭터 챗

# ============================================
# 파일 저장소 설정 (S3/R2 호환)
# ============================================
STORAGE_BACKEND=S3
R2_ENDPOINT_URL=https://your-r2-endpoint.com
R2_ACCESS_KEY_ID=your-access-key
R2_SECRET_ACCESS_KEY=your-secret-key
R2_BUCKET=your-bucket-name
R2_PUBLIC_BASE_URL=https://your-cdn-domain.com
R2_ADDRESSING_STYLE=path

# ============================================
# 기능 플래그
# ============================================
ORIGCHAT_V2=true
RANKING_SCHEDULER_ENABLED=1

# ============================================
# CORS 설정
# ============================================
ALLOW_ORIGIN_REGEX=.*
# 또는 특정 도메인만 허용
# ALLOW_ORIGIN_REGEX=https://your-domain\.com|https://www\.your-domain\.com
```

### 2. 백엔드 전용 환경 변수

`backend-api/.env` 파일 (선택사항, 루트 `.env` 우선)

### 3. 프론트엔드 빌드 시 환경 변수

프로덕션 빌드 시 다음 변수들이 빌드에 포함됩니다:

```env
VITE_API_URL=https://api.your-domain.com
VITE_SOCKET_URL=wss://socket.your-domain.com
```

---

## 🗄 데이터베이스 설정

### PostgreSQL (프로덕션 권장)

#### 1. 데이터베이스 생성

```sql
CREATE DATABASE char_chat_db;
CREATE USER char_chat_user WITH PASSWORD 'your-secure-password';
GRANT ALL PRIVILEGES ON DATABASE char_chat_db TO char_chat_user;
```

#### 2. 마이그레이션 실행

```bash
# 백엔드 컨테이너 내에서 실행
cd backend-api
python postgres_migration.py

# 또는 수동으로 SQL 파일 실행
psql -U char_chat_user -d char_chat_db -f migrations/create_advanced_character_tables.sql
psql -U char_chat_user -d char_chat_db -f migrations/create_payment_tables.sql
psql -U char_chat_user -d char_chat_db -f migrations/create_user_personas_table.sql
psql -U char_chat_user -d char_chat_db -f migrations/add_story_comments.sql
psql -U char_chat_user -d char_chat_db -f migrations/add_webtoon_support.sql
```

#### 3. 마이그레이션 파일 목록

- `create_advanced_character_tables.sql`
- `create_payment_tables.sql`
- `create_user_personas_table.sql`
- `add_story_comments.sql`
- `add_webtoon_support.sql`
- `sqlite_add_missing_columns.sql` (SQLite 전용)

### SQLite (개발 환경)

```bash
# 데이터베이스 파일은 자동 생성됨
# 위치: backend-api/data/test.db
```

---

## 🐳 Docker 배포

### 1. 개발 환경 (docker-compose.dev.yml)

```bash
# Windows
start_docker.bat

# Mac/Linux
docker-compose -f docker-compose.dev.yml up --build
```

**특징:**
- SQLite 사용
- 핫 리로드 활성화
- 디버그 모드 활성화
- 볼륨 마운트로 코드 변경 즉시 반영

### 2. 프로덕션 환경 (docker/docker-compose.yml)

```bash
cd docker
docker-compose up -d --build
```

**특징:**
- PostgreSQL 사용
- Nginx 리버스 프록시
- 프로덕션 빌드
- 자동 재시작 설정

### 3. Docker 이미지 빌드

#### 백엔드
```bash
cd backend-api
docker build -t char-chat-backend:latest .
```

#### 프론트엔드
```bash
cd frontend/char-chat-frontend
docker build -t char-chat-frontend:latest .
```

#### 채팅 서버
```bash
cd chat-server
docker build -t char-chat-socket:latest .
```

### 4. Docker 네트워크 및 볼륨

```bash
# 네트워크 생성
docker network create char_chat_network

# 볼륨 생성 (PostgreSQL 데이터 유지)
docker volume create postgres_data
docker volume create redis_data
```

---

## ☁️ 클라우드 플랫폼 배포

### Render.com 배포

#### 1. render.yaml 설정 확인

`render.yaml` 파일이 프로젝트 루트에 있습니다.

#### 2. 필요한 서비스

1. **PostgreSQL Database** (managed)
2. **Redis** (keyvalue)
3. **Backend Web Service** (Python)
4. **Frontend Static Site** (static)
5. **Chat Server Web Service** (Node.js)

#### 3. 환경 변수 설정

Render 대시보드에서 각 서비스에 환경 변수를 설정합니다:

**Backend Service:**
- `DATABASE_URL` (자동 주입)
- `REDIS_URL` (자동 주입)
- `JWT_SECRET_KEY` (수동 설정)
- `GEMINI_API_KEY` (수동 설정)
- `CLAUDE_API_KEY` (수동 설정)
- `FRONTEND_BASE_URL` (수동 설정)

**Frontend Service:**
- `VITE_API_URL` (백엔드 URL)
- `VITE_SOCKET_URL` (채팅 서버 URL)

**Chat Server:**
- `REDIS_URL` (자동 주입)
- `BACKEND_API_URL` (백엔드 URL)
- `JWT_SECRET_KEY` (백엔드와 동일)

#### 4. 배포 순서

1. PostgreSQL 데이터베이스 생성
2. Redis 생성
3. Backend 배포
4. Chat Server 배포
5. Frontend 배포

### 다른 플랫폼 (AWS, GCP, Azure)

#### AWS (ECS/EKS)

```bash
# ECR에 이미지 푸시
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com

docker tag char-chat-backend:latest <account-id>.dkr.ecr.us-east-1.amazonaws.com/char-chat-backend:latest
docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/char-chat-backend:latest
```

#### GCP (Cloud Run)

```bash
# 이미지 빌드 및 푸시
gcloud builds submit --tag gcr.io/PROJECT_ID/char-chat-backend

# Cloud Run에 배포
gcloud run deploy char-chat-backend --image gcr.io/PROJECT_ID/char-chat-backend
```

---

## 🔒 보안 설정

### 1. JWT 시크릿 키

**절대 기본값 사용 금지!**

```bash
# 강력한 시크릿 키 생성
python -c "import secrets; print(secrets.token_urlsafe(64))"
```

### 2. 데이터베이스 비밀번호

**강력한 비밀번호 사용:**
- 최소 16자 이상
- 대소문자, 숫자, 특수문자 포함
- 공통 비밀번호 사용 금지

### 3. CORS 설정

프로덕션에서는 특정 도메인만 허용:

```python
# backend-api/app/main.py
CORS_ORIGINS = [
    "https://your-domain.com",
    "https://www.your-domain.com"
]
```

### 4. HTTPS 설정

**Nginx SSL 설정:**

```nginx
server {
    listen 443 ssl http2;
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    # SSL 보안 설정
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
}
```

**Let's Encrypt 사용:**

```bash
certbot --nginx -d your-domain.com -d www.your-domain.com
```

### 5. 환경 변수 보안

- `.env` 파일은 절대 Git에 커밋하지 않음
- 프로덕션 환경 변수는 플랫폼의 시크릿 관리 기능 사용
- API 키는 정기적으로 로테이션

### 6. 방화벽 설정

```bash
# 필요한 포트만 열기
# 80 (HTTP)
# 443 (HTTPS)
# 22 (SSH, 선택사항)

# 불필요한 포트 차단
ufw deny 8000  # 백엔드 직접 접근 차단
ufw deny 3001  # 채팅 서버 직접 접근 차단
```

---

## 📊 모니터링 및 로깅

### 1. 로그 설정

**백엔드 로깅:**

```python
# backend-api/app/core/logger.py
import logging

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('app.log'),
        logging.StreamHandler()
    ]
)
```

**Docker 로그 확인:**

```bash
# 모든 서비스 로그
docker-compose logs -f

# 특정 서비스 로그
docker-compose logs -f backend
docker-compose logs -f frontend
docker-compose logs -f chat-server
```

### 2. 헬스 체크

**백엔드 헬스 체크:**

```bash
curl http://localhost:8000/health
```

**채팅 서버 헬스 체크:**

```bash
curl http://localhost:3001/health
```

### 3. 메트릭 수집 (선택사항)

- **Prometheus**: 메트릭 수집
- **Grafana**: 시각화
- **Sentry**: 에러 추적

---

## ✅ 배포 전 체크리스트

### 필수 확인 사항

#### 환경 설정
- [ ] `.env` 파일 생성 및 모든 필수 변수 설정
- [ ] `JWT_SECRET_KEY` 기본값에서 변경
- [ ] `DATABASE_URL` 올바르게 설정
- [ ] `REDIS_URL` 올바르게 설정
- [ ] AI API 키 최소 1개 이상 설정
- [ ] `FRONTEND_BASE_URL` 프로덕션 URL로 설정
- [ ] `ENVIRONMENT=production` 설정
- [ ] `DEBUG=false` 설정

#### 데이터베이스
- [ ] 데이터베이스 생성 완료
- [ ] 마이그레이션 스크립트 실행 완료
- [ ] 데이터베이스 연결 테스트 완료
- [ ] 백업 전략 수립

#### 보안
- [ ] 강력한 비밀번호 설정
- [ ] CORS 설정 확인
- [ ] HTTPS 설정 완료
- [ ] 방화벽 규칙 설정
- [ ] API 키 보안 관리

#### Docker (로컬 배포 시)
- [ ] Docker 이미지 빌드 성공
- [ ] 컨테이너 시작 확인
- [ ] 네트워크 연결 확인
- [ ] 볼륨 마운트 확인

#### 클라우드 플랫폼 (클라우드 배포 시)
- [ ] 서비스 생성 완료
- [ ] 환경 변수 설정 완료
- [ ] 데이터베이스 연결 확인
- [ ] 도메인 설정 완료
- [ ] SSL 인증서 설정 완료

#### 기능 테스트
- [ ] 사용자 회원가입/로그인 테스트
- [ ] 캐릭터 채팅 기능 테스트
- [ ] 실시간 채팅 연결 테스트
- [ ] 파일 업로드 기능 테스트
- [ ] API 엔드포인트 테스트

#### 성능
- [ ] 로드 테스트 수행
- [ ] 응답 시간 확인
- [ ] 데이터베이스 쿼리 최적화
- [ ] 캐싱 전략 확인

#### 모니터링
- [ ] 로그 수집 설정
- [ ] 에러 알림 설정
- [ ] 헬스 체크 엔드포인트 확인

---

## 🚨 문제 해결

### 일반적인 문제

#### 1. 데이터베이스 연결 실패

```bash
# 연결 테스트
psql -U char_chat_user -d char_chat_db -h localhost

# 환경 변수 확인
echo $DATABASE_URL
```

#### 2. Redis 연결 실패

```bash
# Redis 연결 테스트
redis-cli -h localhost -p 6379 ping

# 환경 변수 확인
echo $REDIS_URL
```

#### 3. 포트 충돌

```bash
# 포트 사용 확인
netstat -ano | findstr :8000  # Windows
lsof -i :8000                 # Mac/Linux

# docker-compose.yml에서 포트 변경
```

#### 4. 환경 변수 로드 실패

```bash
# 환경 변수 확인
docker-compose exec backend env | grep DATABASE_URL

# .env 파일 위치 확인
# 우선순위: OS 환경변수 > 루트 .env > backend-api/.env
```

---

## 📚 추가 리소스

- [Docker 가이드](./DOCKER_GUIDE.md)
- [설정 가이드](./SETUP_GUIDE.md)
- [API 문서](http://localhost:8000/docs) (로컬 실행 시)
- [Render 배포 가이드](https://render.com/docs)

---

## 📞 지원

배포 관련 문제가 발생하면:

1. 로그 확인: `docker-compose logs -f`
2. 환경 변수 확인: `.env` 파일 검토
3. 헬스 체크: `/health` 엔드포인트 확인
4. 문서 확인: 위의 가이드 참조

---

**마지막 업데이트**: 2024년 8월
**버전**: 2.0


