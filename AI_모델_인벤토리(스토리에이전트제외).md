### AI 모델 인벤토리 (스토리에이전트 제외)

- **작성일**: 2025-12-31
- **목표**: 운영/연동 작업을 위해, 현재 코드베이스에서 “AI 모델이 실제로 어디서/어떤 역할로/어떤 값으로” 사용되는지 SSOT 관점으로 빠르게 파악

---

### 범위(중요)

- **포함**: 일반 캐릭터챗, 원작챗(OrigChat), 스토리다이브(StoryDive), 스토리 임포터(분석), 온보딩(퀵 캐릭터), 스토리 생성 API(`/stories/*`), 이미지 생성(`/media/generate`)
- **제외**: **스토리에이전트 탭 전용 로직**  
  - 예: `/chat/agent/*`, `frontend/.../pages/AgentPage.jsx`, `frontend/.../components/agent/*` 등

---

### 용어 정리

- **provider(제공사/라우팅 키)**: `gemini | claude | gpt` 같은 “라우팅용” 구분값
- **sub_model(세부 모델 문자열)**: `gemini-2.5-pro`, `claude-sonnet-4-20250514`, `gpt-4o` 같은 모델 ID(또는 UI용 별칭)
- **실제 호출 모델**: 백엔드가 provider/sub_model을 받아 내부 매핑/폴백 후 최종적으로 외부 SDK에 전달하는 모델 ID

---

### SSOT: 모델/설정 저장 위치(운영 관점)

- **유저 기본 모델(전역 기본값)**
  - **DB**: `backend-api/app/models/user.py`
    - `preferred_model`, `preferred_sub_model`, `response_length_pref`
  - **API**: `backend-api/app/api/users.py`
    - `GET /me/model-settings`
    - `PUT /me/model-settings?model=...&sub_model=...&response_length=...`
  - **주의**: `backend-api/app/services/user_service.py`의 `update_user_model_settings()`는 **model/sub_model 값 검증 없이 저장**합니다(유효성은 호출 시점의 매핑/폴백에 의존).

- **채팅방(세션) 단위 오버라이드**
  - **Redis room meta**: `temperature`, `response_length_pref` 등 (일반챗/원작챗에서 사용)
  - 적용 위치: `backend-api/app/api/chat.py`의 `/chat/message`, `/chat/origchat/turn`

---

### 백엔드 공통 레이어(텍스트 LLM) — 어디서든 결국 여기로 모임

- **핵심 파일**: `backend-api/app/services/ai_service.py`
- **지원 provider(코드상 허용값)**: `AIModel = "gemini" | "claude" | "gpt"`

#### 통합 호출(단발)

- **함수**: `get_ai_completion(prompt, model, sub_model, temperature, max_tokens)`
- **provider별 기본 sub_model**
  - **gemini**: `sub_model` 없으면 `gemini-2.5-pro`
  - **claude**: `sub_model` 없으면 `CLAUDE_MODEL_PRIMARY = claude-sonnet-4-20250514`
  - **gpt**: `sub_model` 없으면 `gpt-4o`

#### 채팅형 응답(대화 히스토리 포함)

- **함수**: `get_ai_chat_response(character_prompt, user_message, history, preferred_model, preferred_sub_model, response_length_pref, temperature)`
- **실제 모델 매핑/폴백(핵심)**
  - **Gemini**
    - `preferred_sub_model == "gemini-2.5-flash"`일 때만 flash 사용
    - 그 외는 전부 `gemini-2.5-pro`로 수렴
  - **Claude**
    - UI에서 들어오는 여러 별칭(`claude-4-sonnet`, `claude-3.7-sonnet` 등)을 **매핑 후 최종적으로 `claude-sonnet-4-20250514`로 수렴**(기본)
  - **GPT(OpenAI)**
    - `gpt-4.1`, `gpt-4.1-mini`만 분기
    - 그 외는 `gpt-4o`로 수렴

---

### 기능별(API) 모델 사용 인벤토리 (스토리에이전트 제외)

#### 1) 일반 캐릭터챗

- **API(백엔드)**: `backend-api/app/api/chat.py`
  - `POST /chat/start`
  - `POST /chat/start-new`
  - `POST /chat/message`
  - `POST /chat/messages/{message_id}/regenerate`
- **모델 역할**: 캐릭터 대화 응답 생성(텍스트 LLM)
- **모델 선택 방식(SSOT)**
  - 기본: `current_user.preferred_model / current_user.preferred_sub_model`
  - 룸 메타: `temperature`, `response_length_pref`가 있으면 우선 적용
- **실제 호출**: `backend-api/app/services/ai_service.py`의 `get_ai_chat_response()`

#### 2) 원작챗(OrigChat)

- **API(백엔드)**: `backend-api/app/api/chat.py`
  - `POST /chat/origchat/start`
  - `POST /chat/origchat/turn`
- **모델 역할**
  - start: (plain 모드) 인사말 생성
  - turn: 턴 진행 응답 생성
- **모델 선택 방식(현 코드 기준)**
  - **provider는 사실상 Claude 고정**
  - `temperature`, `response_length_pref`는 룸 메타로 조절
- **실제 호출**
  - start(인사말): `get_claude_completion(model=CLAUDE_MODEL_PRIMARY)`
  - turn: `get_ai_chat_response(preferred_model="claude", ...)` → 최종적으로 `claude-sonnet-4-20250514`로 수렴(폴백 포함)

#### 3) 스토리다이브(StoryDive)

- **API(백엔드)**: `backend-api/app/api/storydive.py`
  - `/storydive/sessions/*` 흐름에서 텍스트 생성(턴/continue/retry)
  - (부가) 회차 요약 생성 시 LLM 사용
- **모델 역할**: 원작 텍스트 기반 인터랙티브 소설 텍스트 생성
- **모델 선택 방식(현 코드 기준)**: **Claude 고정**
  - 기본 sub_model: `claude-sonnet-4-20250514` (UI 문자열이지만 결과적으로 PRIMARY로 수렴)
- **실제 호출**
  - `backend-api/app/services/storydive_ai_service.py` → `ai_service.get_ai_chat_response(preferred_model="claude", ...)`
  - `backend-api/app/api/storydive.py`의 회차 요약(리캡) 생성도 동일하게 `get_ai_chat_response(preferred_model="claude", ...)`

#### 4) 스토리 임포터(텍스트 분석 → 캐릭터/세계관 추출)

- **API(백엔드)**: `backend-api/app/api/story_importer.py`
  - `POST /story-importer/analyze`
- **모델 역할**: 입력 텍스트를 JSON 구조로 분석(세계관/플롯/캐릭터)
- **모델 선택 방식**
  - 요청값 `ai_model`을 `"gemini" | "claude" | "gpt"`로만 허용(기타 값은 gemini로 폴백)
  - sub_model 선택은 없음(=각 provider 기본값 사용)
- **실제 호출**
  - `backend-api/app/services/story_importer_service.py` → `get_ai_completion(model=ai_model, sub_model=None)`

#### 5) 온보딩: 30초만에 캐릭터 만나기(퀵 초안 생성)

- **API(백엔드)**: `backend-api/app/api/characters.py`
  - `POST /characters/quick-generate`
- **모델 역할**
  - (1) 이미지 기반 태그/컨텍스트 추출(비전)
  - (2) 캐릭터 설정 초안(JSON) 생성(텍스트 LLM)
- **모델 선택 방식**
  - 비전: 내부적으로 `model="claude"` 경로 사용(=Claude 기반)
  - 텍스트 LLM: 요청값 `ai_model`을 `"gemini" | "claude" | "gpt"`로만 허용(기타 값 gemini 폴백)
  - sub_model 선택은 없음(=각 provider 기본값 사용)
- **실제 호출**
  - `backend-api/app/services/quick_character_service.py`
    - 비전: `analyze_image_tags_and_context(image_url, model="claude")`
    - 텍스트: `get_ai_completion(model=req.ai_model)`

#### 6) 스토리 생성(`/stories/*`)  (스토리에이전트 탭과 별개 API)

- **API(백엔드)**: `backend-api/app/api/stories.py`
  - `POST /stories/generate`
  - `POST /stories/generate/stream` (SSE)
- **모델 역할**: 키워드 기반 스토리 생성(단발/스트리밍)
- **모델 선택 방식**
  - `/stories/generate`: 현재 API 스키마에 모델 파라미터가 없어 **기본값(StoryGenerationService 내부 기본=gemini)**로 동작
  - `/stories/generate/stream`: `body.model` 문자열로 provider를 추정(claude/gpt/gemini)하고 sub_model로 전달
- **실제 호출**
  - `backend-api/app/services/story_service.py` → `get_ai_completion(model=ai_model, sub_model=ai_sub_model)`

#### 7) 이미지 생성(미디어)

- **API(백엔드)**: `backend-api/app/api/media.py`
  - `POST /media/generate?provider=...&model=...&prompt=...`
- **모델 역할**: 텍스트→이미지 생성
- **지원 provider(현재 분기)**
  - `provider=openai`
    - 기본 모델: `gpt-image-1`
  - `provider=gemini`
    - 기본 모델: `gemini-2.5-flash-image-preview`
- **프론트 기본 호출값**
  - `frontend/char-chat-frontend/src/components/ImageGenerateInsertModal.jsx`
    - `genProvider`는 gemini 고정, `genModel` 기본값은 `gemini-2.5-flash-image-preview`

---

### 프론트엔드(스토리에이전트 제외)에서 “모델”이 연결되는 지점

- **모델 선택 UI(일반챗)**
  - `frontend/char-chat-frontend/src/components/ModelSelectionModal.jsx`
  - 사용자 설정 저장/로드
    - 저장: `usersAPI.updateModelSettings(model, sub_model, response_length)`
    - 로드: `usersAPI.getModelSettings()`

- **채팅 페이지에서 적용**
  - `frontend/char-chat-frontend/src/pages/ChatPage.jsx`
  - 실제 전송마다 model을 payload로 실어 보내기보다는, **유저 설정을 서버에 저장해 백엔드가 `current_user.preferred_*`로 사용**하는 구조

- **스토리 임포터(분석 모델 선택)**
  - `frontend/char-chat-frontend/src/components/StoryImporterModal.jsx`
  - `frontend/char-chat-frontend/src/pages/StoryImporterPage.jsx`
  - 선택값: `selectedAiModel = 'gemini' | 'claude' | 'gpt'` → `/story-importer/analyze`로 전달

- **퀵 캐릭터(온보딩)**
  - `frontend/char-chat-frontend/src/components/QuickMeetCharacterModal.jsx`
  - 현재는 `ai_model: 'gemini'`로 고정 전달(백엔드에서 gemini/claude/gpt 허용은 있으나 UI는 고정)

---

### 프론트 “모델 목록”과 백엔드 “실제 매핑”의 갭(운영 이슈 포인트)

- **ModelSelectionModal**에 노출된 subModel id가 많아도,
  - 백엔드 `get_ai_chat_response()`는 provider별로 **실제 분기/매핑이 제한적**이라
  - **결과적으로 특정 모델 선택이 “같은 모델로 수렴”**할 수 있습니다.

- 대표 예시(현 코드 기준)
  - **Gemini**
    - UI에 `gemini-3-*`, `gemini-2.5-pro-positive` 등이 있어도
    - 백엔드 일반챗 분기는 사실상 `gemini-2.5-flash` vs 그 외(= `gemini-2.5-pro`)로 수렴
  - **GPT**
    - UI에 `gpt-5.1`, `gpt-5.2`가 있어도
    - 백엔드 일반챗 분기는 `gpt-4.1`, `gpt-4.1-mini` 아니면 `gpt-4o`로 수렴
  - **Claude**
    - UI에 여러 버전이 있어도
    - 현재 매핑은 대부분 `claude-sonnet-4-20250514`(PRIMARY)로 수렴

---

### 빠른 체크리스트(연동 작업 전에 꼭 확인할 것)

- **(1) CMS 모델 탭의 SSOT 대상 정의**
  - “프론트 드롭다운 목록”이 아니라, **백엔드 매핑/허용모델/기본값/기능별 사용 가능**까지 포함할지 결정 필요
- **(2) 기능별 모델 고정 영역**
  - OrigChat/StoryDive 등은 현재 사실상 Claude 고정 → CMS에서 바꾸려면 백엔드부터 SSOT로 전환 필요
- **(3) 이미지 생성은 LLM과 별도 트랙**
  - `/media/generate`는 provider가 `openai | gemini`로 분기(텍스트 LLM과 정책/키가 별도)


