# 22. backend-flask (레거시) 정리

기준 디렉터리: `backend-flask`

## 1) 현재 포지션

- Flask + Flask-SocketIO 기반 초기 서버 코드
- `backend-api`/`chat-server` 체계 이전의 레거시 성격이 강함
- 실운영 핵심 SSOT로 보긴 어렵고, 과거 프로토타입/백업 성격에 가까움

## 2) 엔트리포인트

- 파일: `backend-flask/src/main.py`
- 기능:
  - Flask API blueprint 등록
  - Flask-SocketIO 이벤트 처리
  - SQLite 로컬 DB 사용
  - 정적 파일 서빙

## 3) 라우트 구성

- `src/routes/auth.py`
  - register/login/me 등 기본 인증 API
- `src/routes/api.py`
  - in-memory mock DB 기반 캐릭터/채팅/스토리 생성 API
- `src/routes/user.py`
  - 단순 user CRUD

## 4) 한계/주의

- 메모리 DB 및 mock 성격 코드가 많아, 현재 메인 제품 로직과 정합되지 않음
- 최신 기능(원작챗, CMS, media asset, storydive 등)은 `backend-api` 기준으로 봐야 함
- 유지보수/기능 확장 대상은 기본적으로 `backend-api`와 `chat-server`가 우선
