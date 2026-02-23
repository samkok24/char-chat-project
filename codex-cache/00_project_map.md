# 00. 프로젝트 전체 맵

## 1) 최상위 디렉터리 역할

- `frontend/char-chat-frontend`
  - React + Vite 프론트엔드 본체
- `backend-api`
  - FastAPI 메인 API 서버 (실운영 기준 핵심 백엔드)
- `chat-server`
  - Socket.IO 기반 실시간 채팅 서버 (Node.js)
- `backend-flask`
  - 초기/레거시 Flask 서버
- `docker`
  - 운영용 도커 컴포즈 및 Nginx 리버스 프록시 설정
- `tools`
  - 품질/시나리오 점검용 스크립트

## 2) 실행 아키텍처(개념)

- 브라우저(React)
  - REST: `backend-api`로 호출
  - WS: `chat-server`로 소켓 연결
- `chat-server`
  - 소켓 인증 시 `backend-api /auth/me`로 검증
  - Redis 캐시/세션 사용
- `backend-api`
  - DB(Postgres/SQLite) + Redis 사용
  - `/api/*` 호환 alias 라우트 제공
- Nginx(운영)
  - 프론트 정적 + API/소켓 프록시

## 3) 포트/기본 엔드포인트

- 프론트 dev: `5173`
- 백엔드 API: `8000`
- 소켓 서버: `3001`
- Nginx(운영 compose): `80`

## 4) 기술 스택 요약

- Frontend
  - React 19, Vite 6, React Router 7, TanStack Query 5, Tailwind 4
- Backend API
  - FastAPI, SQLAlchemy async, Redis, Celery(의존성 포함), APScheduler
- Realtime
  - Socket.IO, Express, Redis
- Infra
  - Docker Compose, Nginx, Render 배포 템플릿

## 5) 코드 규모 기준 위험 구간(우선 주의)

- 프론트
  - `src/pages/CreateCharacterPage.jsx`
  - `src/pages/ChatPage.jsx`
  - `src/pages/AgentPage.jsx`
  - `src/components/QuickMeetCharacterModal.jsx`
- 백엔드
  - `backend-api/app/api/chat.py`
  - `backend-api/app/services/quick_character_service.py`
  - `backend-api/app/api/stories.py`
  - `backend-api/app/api/characters.py`

## 6) 빠른 진입 지점

- 프론트 라우팅/전역 Provider
  - `frontend/char-chat-frontend/src/App.jsx`
  - `frontend/char-chat-frontend/src/main.jsx`
- API 클라이언트 SSOT
  - `frontend/char-chat-frontend/src/lib/api.js`
- 백엔드 라우터 등록 SSOT
  - `backend-api/app/main.py`
- 소켓 이벤트 등록 SSOT
  - `chat-server/src/controllers/socketController.js`

## 7) Fact-Check Memo Link
- `팩트체크_오탐_및_의도된모델강제_2026-02-16.md`
  - Purpose: classify false positives from the 2026-02-16 review and document intentional Claude-forcing routes as policy.
