# 12. 프론트 API 계약 맵

기준 파일: `frontend/char-chat-frontend/src/lib/api.js`

## 1) 공통 동작

- Axios 인스턴스: `api`
- Base URL 결정:
  - dev 기본: `http://localhost:8000`
  - prod 기본: `window.origin + /api` 계열
  - 설정 이상/HTML 응답/Network Error 시 fallback 재시도 로직 포함
- 인증:
  - access token 자동 부착(공개 endpoint 제외)
  - 401/`Not authenticated` 시 refresh token 시도
  - refresh 실패 시 토큰 제거 + `auth:required` 이벤트

## 2) API 객체별 핵심 엔드포인트

### `authAPI`

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/me`
- `POST /auth/refresh`
- `GET /auth/check-email`
- `GET /auth/check-username`
- `GET /auth/generate-username`
- `POST /auth/update-password`
- `POST /auth/forgot-password`
- `POST /auth/reset-password`
- `POST /auth/verify-email`
- `POST /auth/send-verification-email`

### `usersAPI`

- 내/타 유저 프로필 조회/수정
- 최근 대화 캐릭터
- 좋아요한 캐릭터/스토리
- 관리자 유저 목록/테스트 계정 생성
- 모델 설정 조회/수정 (`/me/model-settings`)
- 통계 조회 (`/users/{user_id}/stats/*`)

### `charactersAPI`

- 목록/내 캐릭터/상세/생성/수정/삭제
- 공개 전환, 좋아요/좋아요 상태
- 댓글 CRUD
- 태그 조회/설정
- 캐릭터 설정 조회/수정
- 퀵 생성 계열:
  - `quick-generate`
  - `quick-create-30s`
  - `quick-generate-prompt/stat/first-start/detail/secret/turn-events/ending-*`
  - `quick-vision-hints`, `quick-profile-theme-suggestions`

### `chatAPI`

- 채팅 시작:
  - `/chat/start`
  - `/chat/start-new`
  - `/chat/start-with-context`
- 메시지:
  - `/chat/message`
  - `/chat/rooms/{roomId}/messages`
  - 메시지 수정/재생성/피드백
- 룸:
  - `/chat/rooms`, `/chat/rooms/{id}`, `/chat/rooms/{id}/meta`
  - 룸 삭제/메시지 전체 삭제
- 부가기능:
  - `magic-choices`
  - `next-action`
- 에이전트:
  - `agent/simulate`
  - `agent/partial-regenerate`
  - `agent/classify-intent`
  - `agent/generate-highlights`
  - `agent contents` save/list/delete/publish/unpublish/feed

### `origChatAPI`

- `GET /stories/{storyId}/context-pack`
- `POST /chat/origchat/start`
- `POST /chat/origchat/turn`

### `storiesAPI`

- 스토리 CRUD/목록/내 스토리
- 좋아요/댓글/회차
- 생성:
  - `POST /stories/generate`
  - `POST /stories/generate/stream` (SSE 스트리밍)
  - 생성 잡 상태/취소/patch
- 원작챗/스토리다이브 보조:
  - `start-options`
  - `context-status`
  - `recap`
  - `scene-excerpt`
  - `storydive/slots`
- 추출 캐릭터:
  - 조회
  - 동기/비동기 재빌드
  - 단일 재빌드
  - 삭제
  - job status/cancel
- 작품 공지:
  - create/delete/pin

### 기타 객체

- `tagsAPI`: 태그 목록/사용태그/생성/삭제
- `rankingAPI`: 일간 랭킹
- `metricsAPI`: summary/content-counts/traffic/online heartbeat
- `chaptersAPI`: 회차 CRUD + by-story
- `storyImporterAPI`: 스토리 분석
- `noticesAPI`: 공지 CRUD + latest
- `faqsAPI`, `faqCategoriesAPI`
- `cmsAPI`: 홈 배너/구좌/팝업/태그표시 설정 조회/저장
- `pointAPI`, `paymentAPI`
- `filesAPI`: 이미지 업로드
- `mediaAPI`: media asset 목록/업로드/attach/reorder/crop/delete/generate/job/event
- `memoryNotesAPI`: 기억노트 CRUD
- `userPersonasAPI`: 페르소나 CRUD + active 설정
- `storydiveAPI`: novel/session/turn/erase

## 3) 프론트-백엔드 정합성 메모

- 프론트는 `/api/*`와 비(`/`) prefix 경로를 모두 흡수하도록 설계되어 있음
- 백엔드도 `/api` alias router를 제공해 운영 프록시 설정 오류에 대한 방어가 들어가 있음
