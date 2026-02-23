# Feed Character Reactions - 구현 완료

## 개요

피드 페이지에 캐릭터 미니 사이드바를 추가하고, 피드 발행 시 최근 대화한 캐릭터들(최대 5명, 중복 제거)이 자동으로 반응 메시지를 보내는 기능

## 완료된 Phase

### ✅ Phase 1: 미니 사이드바 UI

**신규 파일:**
- `frontend/char-chat-frontend/src/components/CharacterQuickAccessPanel.jsx`
  - 최근 채팅방 50개 조회
  - 캐릭터 중복 제거 (Map 사용)
  - 최신순 정렬 후 5명만 표시
  - 30초 폴링
  - 새 탭에서 채팅방 열기

**수정 파일:**
- `frontend/char-chat-frontend/src/pages/AgentFeedPage.jsx`
  - flex 레이아웃으로 미니 사이드바 통합

### ✅ Phase 2: 읽음 상태 추적

**신규 파일:**
- `backend-api/app/models/chat_read_status.py`
  - `ChatRoomReadStatus` 모델 (별도 테이블)
- `backend-api/app/api/chat_read.py`
  - `/chat/read/rooms/{room_id}/mark` - 읽음 처리
  - `/chat/read/rooms/{room_id}/status` - 상태 조회
  - `/chat/read/rooms/with-unread` - unread_count와 함께 조회

**수정 파일:**
- `backend-api/precise_migration.py`
  - `chat_room_read_status` 테이블 추가
- `backend-api/app/main.py`
  - `chat_read_router` 등록
- `frontend/char-chat-frontend/src/lib/api.js`
  - `markRoomAsRead()`, `getRoomsWithUnread()` 추가
- `frontend/char-chat-frontend/src/pages/ChatPage.jsx`
  - 채팅방 입장 시 자동 읽음 처리 useEffect 추가
- `frontend/char-chat-frontend/src/components/CharacterQuickAccessPanel.jsx`
  - `getRoomsWithUnread` API 사용

### ✅ Phase 3: Celery 백그라운드 작업

**신규 파일:**
- `backend-api/app/core/celery_app.py`
  - Celery 앱 설정
- `backend-api/start_celery_worker.sh`
  - Worker 시작 스크립트

**수정 파일:**
- `backend-api/requirements.txt`
  - `celery==5.4.0` 추가
- `docker-compose.dev.yml`
  - `celery-worker` 서비스 추가

### ✅ Phase 4: 피드 반응 로직

**신규 파일:**
- `backend-api/app/services/feed_reaction_service.py`
  - `trigger_character_reactions()` - 메인 로직
  - `generate_reaction_message()` - 개별 반응 생성
- `backend-api/app/tasks/__init__.py`
- `backend-api/app/tasks/feed_tasks.py`
  - `generate_feed_reactions_task` - Celery 태스크

**수정 파일:**
- `backend-api/app/api/agent_contents.py`
  - 발행 시 Celery 태스크 호출

## 핵심 기능

### 1. 캐릭터 중복 제거 로직
```javascript
const roomsByCharacter = new Map();
rooms.forEach(room => {
  const charId = room?.character?.id;
  const existing = roomsByCharacter.get(charId);
  const roomTime = new Date(room.updated_at).getTime();
  const existingTime = existing ? new Date(existing.updated_at).getTime() : 0;
  
  if (!existing || roomTime > existingTime) {
    roomsByCharacter.set(charId, room);
  }
});

const uniqueChars = Array.from(roomsByCharacter.values())
  .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
  .slice(0, 5);
```

### 2. 읽음 상태 관리
- `chat_room_read_status` 별도 테이블로 관리
- 채팅방 입장 시 자동 `unread_count = 0`
- 반응 메시지 생성 시 `unread_count + 1`

### 3. 백그라운드 반응 생성
- 24시간 내 대화한 캐릭터 최대 5명 선택
- 캐릭터당 1회만 반응 (중복 방지)
- 짧은 응답 모드 (1-2문장, 최대 150자)
- 실패해도 발행은 성공 처리

## 다음 단계

### 필수 작업

1. **DB 마이그레이션 실행**
   ```bash
   docker exec -it char_chat_backend python -m app.scripts.precise_migration
   ```

2. **Celery 패키지 설치**
   ```bash
   docker exec -it char_chat_backend pip install celery==5.4.0
   ```

3. **Docker Compose 재시작**
   ```bash
   docker-compose -f docker-compose.dev.yml down
   docker-compose -f docker-compose.dev.yml up -d
   ```

### 테스트 시나리오

1. **미니 사이드바 확인**
   - `/agent/feed` 접속
   - 우측에 캐릭터 5명 표시 확인
   - 30초 후 자동 업데이트 확인

2. **읽음 처리 확인**
   - 캐릭터 클릭 → 새 탭에서 채팅방 열림
   - 뱃지 사라지는지 확인

3. **피드 반응 확인**
   - 에이전트 탭에서 콘텐츠 생성
   - 내 서랍에서 "피드에 발행"
   - 10-30초 후 캐릭터 채팅방 확인
   - 반응 메시지 도착 및 뱃지 표시 확인

## 아키텍처 원칙 준수

✅ **chat.py 미수정** - `chat_read.py`로 분리
✅ **AgentPage.jsx 미수정** - 별도 컴포넌트
✅ **별도 테이블** - `chat_room_read_status`
✅ **다크 테마** - gray-900 배경, pink/purple 강조색
✅ **유지보수성** - 명확한 책임 분리

## 파일 변경 요약

### 신규 파일 (11개)
- CharacterQuickAccessPanel.jsx
- chat_read_status.py (모델)
- chat_read.py (API)
- celery_app.py
- feed_reaction_service.py
- feed_tasks.py
- __init__.py (tasks)
- start_celery_worker.sh

### 수정 파일 (8개)
- AgentFeedPage.jsx
- ChatPage.jsx
- api.js
- precise_migration.py
- main.py
- requirements.txt
- docker-compose.dev.yml
- agent_contents.py

## 주요 API 엔드포인트

```
POST   /chat/read/rooms/{room_id}/mark          # 읽음 처리
GET    /chat/read/rooms/{room_id}/status        # 상태 조회
GET    /chat/read/rooms/with-unread             # 목록 (unread 포함)
PATCH  /agent/contents/{id}/publish             # 발행 (+ 반응 트리거)
```

## 성능 고려사항

- 폴링 간격: 30초 (네트워크 부하 최소화)
- 캐릭터 제한: 최대 5명 (AI 비용 절감)
- 응답 길이: 짧은 모드 (토큰 절약)
- 비동기 처리: Celery (사용자 경험 향상)
- 재시도 로직: 최대 3회, 60초 간격

## 문제 해결

### Celery Worker가 시작되지 않는 경우
```bash
# 로그 확인
docker logs char_chat_celery

# 수동 시작
docker exec -it char_chat_celery bash /app/start_celery_worker.sh
```

### 반응이 생성되지 않는 경우
```bash
# Celery 작업 확인
docker exec -it char_chat_backend python -c "
from app.tasks.feed_tasks import generate_feed_reactions_task
result = generate_feed_reactions_task.delay('user-id', 'content-id')
print(result.get())
"
```

### DB 마이그레이션 실패 시
```bash
# 테이블 수동 생성
docker exec -it char_chat_backend python -c "
from app.core.database import engine, Base
from app.models.chat_read_status import ChatRoomReadStatus
import asyncio

async def create():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

asyncio.run(create())
"
```


