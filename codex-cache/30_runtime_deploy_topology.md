# 30. 런타임/배포 토폴로지

## 1) 로컬 개발 compose

파일: `docker-compose.dev.yml`

- 서비스:
  - `backend` (FastAPI, 8000)
  - `chat-server` (Socket, 3001)
  - `redis` (6379)
  - `frontend` (Vite dev, 5173)
- 특징:
  - backend는 SQLite 파일 기반
  - frontend는 dev 서버로 실행
  - 코드 볼륨 마운트로 즉시 반영

## 2) 운영 compose

파일: `docker/docker-compose.yml`

- 서비스:
  - `redis`
  - `backend` (FastAPI)
  - `chat-server` (Socket)
  - `frontend` (nginx 정적 제공, 3000)
  - `nginx` (80, reverse proxy)
- 특징:
  - backend는 보통 Postgres(Supabase 등) + Redis
  - media/upload 볼륨 마운트
  - 환경변수 기반으로 AI 키/스토리지/R2/SMTP 설정

## 3) Dockerfile 요약

- `backend-api/Dockerfile`
  - Python 3.11 slim
  - requirements 설치 후 `uvicorn app.main:app`
- `chat-server/Dockerfile`
  - Node 18 alpine
  - production deps 설치 + healthcheck
- `frontend/char-chat-frontend/Dockerfile`
  - multi-stage:
    - dev stage: Vite
    - build stage: pnpm build
    - prod stage: nginx static serving

## 4) Render 배포

파일: `render.yaml`

- 구성:
  - PostgreSQL 관리형 DB
  - Redis keyvalue
  - backend web service(FastAPI)
  - frontend static service
  - socket web service(Node)
- 주요 env:
  - backend:
    - `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET_KEY`
    - AI 키, 스토리지 키
    - `FRONTEND_BASE_URL`, `ALLOW_ORIGIN_REGEX`
  - socket:
    - `BACKEND_API_URL`, `REDIS_URL`, `JWT_SECRET_KEY`
    - AI 키, `CORS_ORIGINS`
  - frontend:
    - `VITE_API_URL`

## 5) 실행 순서 개념

1. Redis 가용
2. Backend 부팅 + DB/마이그레이션/seed
3. Socket 서버가 backend 인증 경로 사용해 정상 동작
4. Frontend가 API/Socket endpoint로 연결
5. Nginx가 외부 단일 진입점 제공(운영 compose 기준)

## 6) 운영 리스크 포인트

- `VITE_API_URL`/프록시 설정 불일치 시 프론트에서 HTML 응답 수신 문제 발생 가능
- socket auth는 backend `/auth/me` 의존 -> backend host/trusted host 이슈가 채팅 로그인 장애로 연결
- 스토리지/R2 설정 미완료 시 media 처리 경로에서 오류 발생
