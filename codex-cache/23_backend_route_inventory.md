# 23. backend-api 라우트 인벤토리 (요약)

기준: `backend-api/app/api/*`의 `@router.<method>()` 스캔

## 1) Chat 계열 (`chat.py`, `chat_read.py`)

- 채팅 시작:
  - `POST /chat/start`
  - `POST /chat/start-new`
  - `POST /chat/start-with-context`
- 메시지:
  - `POST /chat/message`
  - `GET /chat/rooms/{room_id}/messages`
  - `PATCH /chat/messages/{message_id}`
  - `POST /chat/messages/{message_id}/regenerate`
  - `POST /chat/messages/{message_id}/feedback`
  - `DELETE /chat/rooms/{room_id}/messages`
- 룸:
  - `GET /chat/rooms`
  - `POST /chat/rooms`
  - `GET /chat/rooms/{room_id}`
  - `GET /chat/rooms/{room_id}/meta`
  - `DELETE /chat/rooms/{room_id}`
- 원작챗:
  - `POST /chat/origchat/start`
  - `POST /chat/origchat/turn`
- 에이전트:
  - `POST /chat/agent/simulate`
  - `POST /chat/agent/partial-regenerate`
  - `POST /chat/agent/classify-intent`
  - `POST /chat/agent/generate-highlights`
- 보조:
  - `POST /chat/rooms/{room_id}/magic-choices`
  - `POST /chat/rooms/{room_id}/next-action`
- 읽음 상태(`chat_read.py`):
  - mark/increment-unread/status/with-unread

## 2) Character 계열 (`characters.py`)

- 목록/상세/내 캐릭터/생성/수정/삭제
- 공개 토글, 좋아요, 댓글 CRUD
- 태그 조회/설정
- 설정 CRUD
- world-settings/custom-modules
- 퀵 생성 다단 endpoint:
  - `quick-generate`
  - `quick-create-30s`
  - `quick-generate-*` 세트(prompt/stat/detail/secret/turn-events/ending...)

## 3) Story 계열 (`stories.py`, `story_chapters.py`, `storydive.py`)

- 스토리 CRUD/목록/내 스토리
- 좋아요/댓글
- 생성:
  - `POST /stories/generate`
  - `POST /stories/generate/stream`
  - job status/cancel
- 추출 캐릭터:
  - 조회/재빌드/삭제/잡 조회/취소
- 공지:
  - create/delete/pin
- 회차(`story_chapters.py`):
  - create/get/update/delete/by-story
- 스토리다이브(`storydive.py`):
  - novel list/detail
  - session create/get/turn/erase
  - `novels/from-story`
  - recent sessions

## 4) Media/CMS/운영 계열

- media (`media.py`)
  - assets list/update/delete
  - upload
  - attach/reorder/detach
  - crop
  - generate + job + cancel
  - events
- cms (`cms.py`)
  - home banners/slots/popups 조회/저장
  - character tag display 조회/저장
- metrics (`metrics.py`)
  - online heartbeat/online
  - summary/content-counts/traffic
- rankings (`rankings.py`)
  - daily 조회 + snapshot

## 5) 공통 계열

- auth (`auth.py`)
  - register/login/refresh/me/logout
  - 이메일 확인/재발송
  - 비번 변경/재설정
  - 이메일/닉네임 중복 체크
- users (`users.py`)
  - 최근 캐릭터, 좋아요 캐릭터/스토리
  - 프로필 조회/수정
  - 관리자 유저 목록/테스트 계정 생성
  - 모델 설정 조회/수정
  - 사용자 통계
- tags (`tags.py`)
  - 목록/사용태그/생성/삭제
- notices/faqs/faq-categories
- payment/point
- files upload
- contact
- user-personas
- memory-notes
- agent-contents
- seo (`robots.txt`, `sitemap.xml`)

## 6) 중요한 운영 특성

- 모든 라우트는 기본 경로 외에 `/api/*` alias 경로로도 접근 가능
- 프론트의 fallback base 전략과 함께 프록시 오설정 내성을 확보하려는 구조
