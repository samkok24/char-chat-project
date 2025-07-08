# Docker로 AI 캐릭터 챗 프로젝트 실행하기

## 🚀 빠른 시작 (개발 환경)

### 1. Docker Desktop 설치
- Windows/Mac: [Docker Desktop](https://www.docker.com/products/docker-desktop) 다운로드 및 설치
- Linux: Docker와 Docker Compose 설치

### 2. 프로젝트 실행

#### Windows 사용자:
```bash
# 프로젝트 루트에서 실행
start_docker.bat
```

#### Mac/Linux 사용자:
```bash
# 프로젝트 루트에서 실행
docker-compose -f docker-compose.dev.yml up --build
```

### 3. 접속하기
- **웹사이트**: http://localhost:5173
- **백엔드 API**: http://localhost:8000
- **API 문서**: http://localhost:8000/docs

## 📦 전체 스택 실행 (PostgreSQL 포함)

### 1. 환경 변수 파일 생성
`docker/.env` 파일을 생성하고 다음 내용을 추가:

```env
# PostgreSQL 설정
POSTGRES_DB=char_chat_db
POSTGRES_USER=char_chat_user
POSTGRES_PASSWORD=char_chat_password

# JWT 설정
SECRET_KEY=your-super-secret-key-change-this-in-production
ACCESS_TOKEN_EXPIRE_MINUTES=30



# 환경 설정
ENVIRONMENT=development
DEBUG=true
NODE_ENV=development
```

### 2. 전체 스택 실행

```bash
cd docker
docker-compose up --build
```

이렇게 하면 다음이 실행됩니다:
- PostgreSQL 데이터베이스
- Redis (캐시 및 세션)
- FastAPI 백엔드
- Node.js 채팅 서버
- React 프론트엔드
- Nginx 리버스 프록시

### 3. 접속하기
- **웹사이트**: http://localhost (Nginx 경유)
- **백엔드 API**: http://localhost:8000
- **채팅 서버**: http://localhost:3001

## 🔧 Docker 명령어

### 컨테이너 시작/중지

#### Windows:
```bash
# 시작
start_docker.bat

# 중지
stop_docker.bat
```

#### Mac/Linux:
```bash
# 시작
docker-compose -f docker-compose.dev.yml up -d

# 중지
docker-compose -f docker-compose.dev.yml down
```

### 로그 확인
```bash
# 모든 서비스 로그
docker-compose -f docker-compose.dev.yml logs -f

# 특정 서비스 로그
docker-compose -f docker-compose.dev.yml logs -f backend
docker-compose -f docker-compose.dev.yml logs -f frontend
```

### 컨테이너 재빌드
```bash
# 모든 이미지 재빌드
docker-compose -f docker-compose.dev.yml up --build

# 특정 서비스만 재빌드
docker-compose -f docker-compose.dev.yml up --build backend
```

### 데이터 정리
```bash
# 컨테이너, 네트워크, 볼륨 모두 삭제
docker-compose -f docker-compose.dev.yml down -v

# 이미지까지 삭제
docker-compose -f docker-compose.dev.yml down -v --rmi all
```

## 🐛 문제 해결

### 포트 충돌
다른 프로그램이 포트를 사용 중인 경우:
```yaml
# docker-compose.dev.yml에서 포트 변경
ports:
  - "8001:8000"  # 백엔드를 8001로 변경
  - "5174:5173"  # 프론트엔드를 5174로 변경
```

### 빌드 실패
```bash
# Docker 캐시 정리
docker system prune -a

# 재빌드
docker-compose -f docker-compose.dev.yml build --no-cache
```

### 데이터베이스 연결 오류
PostgreSQL을 사용하는 경우:
```bash
# 데이터베이스 초기화
docker-compose exec backend python -c "from app.core.database import engine, Base; import asyncio; asyncio.run(engine.begin().run_sync(Base.metadata.create_all))"
```

## 📁 볼륨 및 데이터 유지

### SQLite 데이터 유지 (개발 환경)
`docker-compose.dev.yml`에서 데이터 폴더를 마운트하여 `test.db` 파일을 유지합니다:
```yaml
volumes:
  - ./backend-api/data:/app/data
```
컨테이너의 `/app/data` 폴더가 호스트의 `./backend-api/data` 폴더와 동기화됩니다.

### PostgreSQL 데이터 유지 (프로덕션)
Docker 볼륨을 사용하여 자동으로 유지됩니다:
```
```