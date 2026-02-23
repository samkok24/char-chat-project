# 21. chat-server 아키텍처

기준 디렉터리: `chat-server`

## 1) 개요

- Node.js + Express + Socket.IO 서버
- 포트 기본값: `3001`
- 역할:
  - 실시간 채팅 이벤트 처리
  - 소켓 인증
  - Redis 기반 세션/메시지 캐시
  - 필요 시 백엔드 API 호출

## 2) 엔트리포인트

- 파일: `chat-server/src/server.js`
- 구성:
  - Express + Socket.IO 서버 생성
  - `/health` 제공
  - `io.use(authMiddleware.authenticateSocket)`로 인증
  - 연결 시 `socketController.handleConnection`로 이벤트 등록
  - startup 시 backend probe(`/auth/me`) 수행
  - `uncaughtException`/`unhandledRejection` 방어 종료 처리 포함

## 3) 인증 흐름

- 파일: `src/middleware/authMiddleware.js`
- handshake token 추출 -> JWT verify -> `backend-api /auth/me`로 사용자 확인
- 성공 시:
  - `socket.userId`, `socket.userInfo`, `socket.token` 주입
  - Redis에 user session 저장
- 실패 시:
  - 소켓 연결 reject

## 4) 소켓 이벤트

핵심 등록 파일: `src/controllers/socketController.js`

수신 이벤트:

- `join_room`
- `leave_room`
- `send_message`
- `continue`
- `typing_start`
- `typing_stop`
- `get_message_history`
- `error`

핵심 설계:

- 다중 디바이스 대응:
  - `connectedUsers: userId -> Set(socketId)`
  - `activeRooms: roomId -> { userId, sockets:Set }`
- room 권한 보장:
  - `_getRoomData`로 Redis/백엔드 조회
  - user-room 소유자 확인
- disconnect 시 socket 단위 정리(전체 사용자 상태 오염 방지)

## 5) AI 서비스(레거시 성격 포함)

- 파일: `src/services/aiService.js`
- Gemini 중심 응답/스트리밍 로직이 구현되어 있으나,
  현 구조는 실제 대화 핵심을 `backend-api`가 더 많이 담당하는 방향으로 보임.

## 6) Redis 서비스

- 파일: `src/services/redisService.js`
- 키 네임스페이스:
  - `USER_SESSION`
  - `CHAT_ROOM`
  - `MESSAGE_CACHE`
  - `RATE_LIMIT`
  - `AI_CONTEXT`
- 기능:
  - 세션 저장
  - 룸 캐시
  - 메시지 캐시(list)
  - rate limit
  - AI context 저장/조회

## 7) 설정

- 파일: `src/config/config.js`
- 주요 env:
  - `REDIS_URL`
  - `BACKEND_API_URL`
  - `JWT_SECRET_KEY`
  - AI 키
  - CORS_ORIGINS

## 8) 운영 시 주의점

- 인증 성공이 `backend-api /auth/me`에 의존하므로,
  백엔드 CORS/TrustedHost/네트워크 이슈가 소켓 로그인 실패로 직결됨
- 현재 코드에 방어 로그가 많이 들어가 있어 장애 원인 추적은 비교적 수월한 편
