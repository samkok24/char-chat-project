# 20. backend-api 아키텍처

기준 디렉터리: `backend-api`

## 1) 엔트리포인트

- 파일: `backend-api/app/main.py`
- FastAPI 앱 생성 + lifespan 훅 사용
- 주요 특징:
  - 환경별 docs 노출 제어
  - `/static` 마운트
  - CORS + TrustedHost 설정
  - `/api/*` 호환 alias router 제공(운영 프록시 오류 방어)
  - startup 시 SQLite 보정/seed/필수 테이블 보강 로직 포함

## 2) 코어 설정

### `app/core/config.py`

- `.env` 로딩 우선순위 처리
- 주요 설정:
  - DB/Redis/JWT
  - AI 키(Gemini/Claude/OpenAI/Imagen)
  - SMTP/이메일 인증
  - `FRONTEND_BASE_URL`
  - `ORIGCHAT_V2` 플래그
- production에서 최소 보안/키 검증 수행

### `app/core/database.py`

- SQLAlchemy async 엔진
- SQLite/Postgres 동시 지원
- 타입 어댑터:
  - 플랫폼 독립 UUID
  - JSON/JSONB
- Redis async 클라이언트 제공
- `get_db`, `get_redis` dependency 제공

## 3) 라우터 구성(중요)

메인 include 대상:

- `/chat` (`chat.py`)
- `/chat/read` 성격(`chat_read.py`, prefix 없음)
- `/auth`
- `/characters`
- `/users` 계열(prefix 없음, users.py 내부 경로)
- `/story-importer`
- `/memory-notes`
- `/user-personas`
- `/agent/contents`
- `/storydive`
- `/files`
- `/tags`
- `/media`
- `/metrics`
- `/notices`
- `/faqs`
- `/faq-categories`
- `/cms`
- `/stories`
- `/chapters`
- `/rankings`
- `/payment`
- `/point`
- SEO(`robots.txt`, `sitemap.xml`)

동일 라우터가 `/api` prefix alias로도 재등록됨.

## 4) API 파일 규모(리스크 기준)

- `app/api/chat.py` (8k+)
- `app/api/stories.py` (2.4k+)
- `app/api/characters.py` (2.3k+)
- `app/api/storydive.py` (1.2k+)
- `app/api/cms.py` (836)
- `app/api/media.py` (805)

## 5) 서비스 레이어 핵심

- `quick_character_service.py` (5.7k+)
  - 퀵 생성 계열 핵심 로직 집약
- `ai_service.py` (2.7k+)
  - 모델 호출/프롬프트 처리 중심
- `origchat_service.py` (1.8k+)
  - 원작챗 턴 처리 중심
- `character_service.py`, `story_service.py`, `chat_service.py`
- `feed_reaction_service.py`, `metrics_service.py`, `storydive_ai_service.py`

## 6) 모델 레이어 핵심

- 핵심 모델:
  - `User`, `Character`, `Chat`, `Story`, `StoryChapter`, `Tag`
  - `Like`, `Comment`, `MediaAsset`
  - `MemoryNote`, `UserPersona`
  - `Notice`, `FAQ`, `FAQCategory`
  - `Payment`
  - `StoryDiveSession`, `Novel`
  - `AgentContent`

## 7) 관찰 포인트

- 운영 안정성을 위해 방어 코드가 많음:
  - DB 스키마 보정
  - `/api` alias
  - 검증 예외 로깅 강화
- 대형 단일 파일 집중도가 높아, 기능 수정 시 회귀 테스트 범위가 넓음
