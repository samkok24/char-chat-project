# AI 캐릭터챗 플랫폼 - 완전한 개발 로드맵 & DB 설계서

## 🚀 **최신 업데이트 (2025.07.14)**
> **고급 캐릭터 기능 구현 완료!**
> - ✅ **캐릭터 관리 기능 고도화**: 상세 페이지 내 공개/비공개 설정, 이미지 갤러리 및 업로드 기능 구현
> - ✅ **마이페이지 연동**: 캐릭터 제작자 프로필 페이지 연동 및 소유자/방문자 UI 분기 처리
> - ✅ **사용자 경험(UX) 개선**: 캐릭터 생성/수정 후 '뒤로가기' 시 '내 캐릭터 목록'으로 이동하도록 경로 수정
> - ✅ **아키텍처 개선**: 레거시 API 응답 모델을 최신 버전으로 통일하고, 이미지 상태 관리 로직을 리팩토링하여 안정성 및 유지보수성 향상

## 🚀 **최신 업데이트 (2024.01.15)**
> **1단계 결제/포인트 시스템 백엔드 구현 완료!**
> - ✅ 9개 API 엔드포인트 구현 완료
> - ✅ Redis 기반 원자적 포인트 차감 로직 완료
> - ✅ 4개 테이블 데이터베이스 마이그레이션 완료

> **소셜 기능 완전 구현 완료! (2024.01.15)**
> - ✅ 스토리 댓글 시스템 완전 구현 (4개 API + 자동 카운팅)
> - ✅ 좋아요 상태 확인 API 추가 (캐릭터/스토리별)
> - ✅ 댓글 수 자동 추적 시스템 (DB 트리거 적용)
> - ✅ 14개 소셜 기능 API 엔드포인트 완료
> - ✅ 데이터베이스 마이그레이션 스크립트 완료
> - 🔄 **다음 우선순위**: 알림 시스템 개발 시작

---

## 📊 프로젝트 현황 분석

### 🟢 이미 구현된 기능 (✅)
- **인증 시스템**: JWT 기반 회원가입/로그인 완료
- **고급 캐릭터 기능**: 마이페이지 연동, 공개/비공개 설정, 이미지 갤러리 및 업로드, UX 개선 등 상세 기능 고도화
- **캐릭터 관리**: 생성, 수정, 삭제, 좋아요 기능 완료
- **AI 채팅**: Socket.IO 실시간 채팅 + AI 응답 생성 완료
- **스토리 생성**: 웹소설생성봇 로직 기반 16단계 AI 협업 시스템 완료
- **소셜 기능**: 좋아요, 댓글 시스템 완료
- **인프라**: Docker Compose 기반 개발 환경 완료

### 🔴 미구현 기능 (❌)
- **알림 시스템**: 실시간 알림 미구현
- **랭킹/추천**: 인기 캐릭터/스토리 랭킹 미구현
- **TTS/이미지 생성**: 멀티모달 AI 기능 미구현
- **관리자 대시보드**: 통계/모니터링 미구현

### 🟢 최근 완료된 기능 (✅ 2024.01.15)
- **결제/포인트 시스템**: 백엔드 로직 완료
- **포인트 차감 로직**: Redis 기반 원자적 처리 완료
- **결제 상품 관리**: CRUD API 완료
- **포인트 트랜잭션**: 이력 관리 시스템 완료

### 🟢 소셜 기능 완전 구현 완료 (✅ 2024.01.15)
- **스토리 댓글 시스템**: 전체 CRUD + 자동 카운팅 완료
- **좋아요 상태 확인**: 사용자별 좋아요 상태 API 추가
- **댓글 수 자동 추적**: DB 트리거 기반 실시간 동기화
- **14개 소셜 API**: 캐릭터/스토리 좋아요, 댓글 시스템 완료
- **데이터베이스 마이그레이션**: StoryComment 테이블 + 트리거 완료

---

## 🎯 단계별 API 개발 로드맵

### 🟢 0단계 – 현재 구현 완료 ✅
이미 구현되어 있는 API들입니다.

| API | 설명 | 상태 |
|-----|-----|------|
| POST /auth/register | 회원가입 | ✅ |
| POST /auth/login | 로그인 (JWT 발급) | ✅ |
| GET /auth/me | 내 정보 조회 | ✅ |
| POST /characters | 캐릭터 생성 | ✅ |
| GET /characters | 캐릭터 목록 | ✅ |
| PUT /characters/{id} | 캐릭터 수정 | ✅ |
| POST /chat/rooms | 채팅방 생성 | ✅ |
| POST /chat/messages | 메시지 전송 + AI 응답 | ✅ |
| POST /stories/generate | AI 스토리 생성 | ✅ |
| **소셜 기능 (14개 API)** | **캐릭터/스토리 좋아요, 댓글** | **✅** |
| POST /characters/{id}/like | 캐릭터 좋아요 | ✅ |
| DELETE /characters/{id}/like | 캐릭터 좋아요 취소 | ✅ |
| GET /characters/{id}/like-status | 캐릭터 좋아요 상태 확인 | ✅ |
| POST /characters/{id}/comments | 캐릭터 댓글 작성 | ✅ |
| GET /characters/{id}/comments | 캐릭터 댓글 목록 | ✅ |
| PUT /comments/{id} | 댓글 수정 | ✅ |
| DELETE /comments/{id} | 댓글 삭제 | ✅ |
| POST /stories/{id}/like | 스토리 좋아요 | ✅ |
| DELETE /stories/{id}/like | 스토리 좋아요 취소 | ✅ |
| GET /stories/{id}/like-status | 스토리 좋아요 상태 확인 | ✅ |
| POST /stories/{id}/comments | 스토리 댓글 작성 | ✅ |
| GET /stories/{id}/comments | 스토리 댓글 목록 | ✅ |
| PUT /story-comments/{id} | 스토리 댓글 수정 | ✅ |
| DELETE /story-comments/{id} | 스토리 댓글 삭제 | ✅ |

---

### 🟢 1단계 – 포인트/결제 시스템 (완료 ✅)
**개발 기간**: 2-3주 → **완료: 2024.01.15**  
**이유**: 수익 모델의 핵심이며, 다른 기능들의 기반이 됩니다.

#### ✅ **구현 완료된 API**

| 순서 | API | 설명 | 중요도 | 상태 |
|:---:|-----|-----|:------:|:---:|
| 1 | POST /payment/products | 결제 상품 생성 (관리자) | ⭐⭐⭐ | ✅ |
| 2 | GET /payment/products | 결제 상품 목록 | ⭐⭐⭐ | ✅ |
| 3 | POST /payment/checkout | 결제 요청 (토스페이먼츠) | ⭐⭐⭐⭐⭐ | ✅ |
| 4 | POST /payment/webhook | 결제 완료 웹훅 | ⭐⭐⭐⭐⭐ | ✅ |
| 5 | GET /payment/history | 결제 내역 조회 | ⭐⭐⭐ | ✅ |
| 6 | GET /point/balance | 포인트 잔액 조회 | ⭐⭐⭐⭐ | ✅ |
| 7 | POST /point/use | 포인트 사용 (내부 API) | ⭐⭐⭐⭐⭐ | ✅ |
| 8 | GET /point/transactions | 포인트 거래 내역 조회 | ⭐⭐⭐ | ✅ |
| 9 | GET /point/summary | 포인트 통계 요약 | ⭐⭐ | ✅ |

#### 📋 **구현된 주요 기능**

- **결제 상품 관리**: 패키지별 포인트 상품 (1,000원~24,000원)
- **결제 처리**: 토스페이먼츠 연동 준비 (결제 요청/완료 웹훅)
- **포인트 시스템**: Redis 기반 원자적 차감 로직
- **트랜잭션 기록**: 완전한 포인트 이력 관리
- **데이터베이스**: 4개 테이블 (payment_products, payments, point_transactions, user_points)
- **보안**: UUID 기반 ID, 동시성 제어

#### 🔧 **Redis 포인트 차감 (원자적 처리) - 구현 완료**

```python
# backend-api/app/services/point_service.py - 구현 완료
async def deduct_points_atomic(
    redis: Redis,
    user_id: str,
    amount: int,
    reason: str
) -> bool:
    """Redis Lua 스크립트로 원자적 포인트 차감"""
    lua_script = """
    local user_key = KEYS[1]
    local amount = tonumber(ARGV[1])
    local current = tonumber(redis.call('GET', user_key) or 0)
    
    if current >= amount then
        redis.call('DECRBY', user_key, amount)
        return 1
    else
        return 0
    end
    """
    
    result = await redis.eval(
        lua_script,
        keys=[f"points:{user_id}"],
        args=[amount, reason]
    )
    
    return bool(result)
```

#### ✅ **완료된 작업**
- ✅ 토스페이먼츠 SDK 연동 준비
- ✅ Redis Lua 스크립트 작성
- ✅ 결제 실패 시 롤백 로직
- ✅ 포인트 동기화 배치 작업
- ✅ 데이터베이스 마이그레이션 스크립트

---

### 🟢 1.5단계 – 소셜 기능 완전 구현 (완료 ✅)
**개발 기간**: 1주 → **완료: 2024.01.15**  
**이유**: 사용자 참여도 향상과 콘텐츠 상호작용 활성화

#### ✅ **구현 완료된 소셜 기능 API**

| 순서 | API | 설명 | 중요도 | 상태 |
|:---:|-----|-----|:------:|:---:|
| 1 | POST /characters/{id}/like | 캐릭터 좋아요 | ⭐⭐⭐⭐ | ✅ |
| 2 | DELETE /characters/{id}/like | 캐릭터 좋아요 취소 | ⭐⭐⭐⭐ | ✅ |
| 3 | GET /characters/{id}/like-status | 캐릭터 좋아요 상태 확인 | ⭐⭐⭐ | ✅ |
| 4 | POST /characters/{id}/comments | 캐릭터 댓글 작성 | ⭐⭐⭐⭐ | ✅ |
| 5 | GET /characters/{id}/comments | 캐릭터 댓글 목록 | ⭐⭐⭐ | ✅ |
| 6 | PUT /comments/{id} | 댓글 수정 | ⭐⭐⭐ | ✅ |
| 7 | DELETE /comments/{id} | 댓글 삭제 | ⭐⭐⭐ | ✅ |
| 8 | POST /stories/{id}/like | 스토리 좋아요 | ⭐⭐⭐⭐ | ✅ |
| 9 | DELETE /stories/{id}/like | 스토리 좋아요 취소 | ⭐⭐⭐⭐ | ✅ |
| 10 | GET /stories/{id}/like-status | 스토리 좋아요 상태 확인 | ⭐⭐⭐ | ✅ |
| 11 | POST /stories/{id}/comments | 스토리 댓글 작성 | ⭐⭐⭐⭐ | ✅ |
| 12 | GET /stories/{id}/comments | 스토리 댓글 목록 | ⭐⭐⭐ | ✅ |
| 13 | PUT /story-comments/{id} | 스토리 댓글 수정 | ⭐⭐⭐ | ✅ |
| 14 | DELETE /story-comments/{id} | 스토리 댓글 삭제 | ⭐⭐⭐ | ✅ |

#### 📋 **구현된 주요 기능**

- **캐릭터 소셜 기능**: 좋아요, 댓글 완전 구현
- **스토리 소셜 기능**: 좋아요, 댓글 완전 구현 (새로 추가)
- **좋아요 상태 확인**: 사용자별 좋아요 상태 실시간 확인
- **댓글 수 자동 추적**: DB 트리거 기반 자동 카운팅
- **데이터베이스**: StoryComment 테이블 + 자동 카운팅 트리거 추가
- **보안**: JWT 기반 인증, 작성자 권한 확인

#### 🔧 **댓글 수 자동 추적 시스템 - 구현 완료**

```sql
-- 스토리 댓글 수 자동 업데이트 트리거
CREATE OR REPLACE FUNCTION update_story_comment_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE stories 
        SET comment_count = comment_count + 1 
        WHERE id = NEW.story_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE stories 
        SET comment_count = comment_count - 1 
        WHERE id = OLD.story_id;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER story_comment_count_trigger
    AFTER INSERT OR DELETE ON story_comments
    FOR EACH ROW
    EXECUTE FUNCTION update_story_comment_count();
```

#### ✅ **완료된 작업**
- ✅ 스토리 댓글 모델 및 관계 설정
- ✅ 스토리 댓글 서비스 로직 구현
- ✅ 좋아요 상태 확인 API 구현
- ✅ 댓글 수 자동 추적 트리거 구현
- ✅ 데이터베이스 마이그레이션 스크립트 생성
- ✅ 소셜 기능 API 통합 테스트 완료

---

### 🟡 2단계 – 알림 시스템 (현재 우선순위)
**개발 기간**: 1-2주  
**이유**: 사용자 경험 향상의 핵심이며, 리텐션에 중요합니다.

#### ✅ **개발할 API**

| 순서 | API | 설명 | 중요도 |
|:---:|-----|-----|:------:|
| 1 | GET /notifications | 알림 목록 조회 | ⭐⭐⭐ |
| 2 | PUT /notifications/{id}/read | 알림 읽음 처리 | ⭐⭐⭐ |
| 3 | POST /notifications/settings | 알림 설정 변경 | ⭐⭐ |
| 4 | WebSocket /ws/notifications | 실시간 알림 | ⭐⭐⭐⭐ |

#### 📝 **실시간 알림 구현**

```javascript
// chat-server/src/services/notificationService.js
class NotificationService {
    async sendRealTimeNotification(userId, notification) {
        // 1. DB에 알림 저장
        await this.saveNotification(notification);
        
        // 2. Redis Pub/Sub으로 실시간 전송
        await redis.publish(`notifications:${userId}`, JSON.stringify({
            type: 'NEW_NOTIFICATION',
            data: notification
        }));
        
        // 3. 오프라인 사용자를 위한 푸시 알림
        if (!this.isUserOnline(userId)) {
            await this.sendPushNotification(userId, notification);
        }
    }
}
```

---

### 🟡 3단계 – 랭킹/추천 시스템
**개발 기간**: 1주  
**이유**: 사용자 참여도 향상과 콘텐츠 발견성 개선

#### ✅ **개발할 API**

| 순서 | API | 설명 | 중요도 |
|:---:|-----|-----|:------:|
| 1 | GET /rankings/characters | 인기 캐릭터 TOP 100 | ⭐⭐⭐⭐ |
| 2 | GET /rankings/stories | 인기 스토리 TOP 100 | ⭐⭐⭐ |
| 3 | GET /recommendations/characters | 개인화 캐릭터 추천 | ⭐⭐⭐⭐ |
| 4 | GET /trending/daily | 일간 트렌딩 | ⭐⭐⭐ |

#### 🔧 **Redis Sorted Set 활용**

```python
# 랭킹 업데이트 (실시간)
async def update_character_ranking(redis: Redis, character_id: str, score_delta: int):
    """캐릭터 랭킹 업데이트"""
    # 일간/주간/월간 랭킹 동시 업데이트
    today = datetime.now().strftime("%Y%m%d")
    week = datetime.now().strftime("%Y%W")
    month = datetime.now().strftime("%Y%m")
    
    pipe = redis.pipeline()
    pipe.zincrby(f"ranking:character:daily:{today}", score_delta, character_id)
    pipe.zincrby(f"ranking:character:weekly:{week}", score_delta, character_id)
    pipe.zincrby(f"ranking:character:monthly:{month}", score_delta, character_id)
    pipe.zincrby("ranking:character:all", score_delta, character_id)
    await pipe.execute()
```

---

### 🟡 4단계 – TTS/이미지 생성
**개발 기간**: 2주  
**이유**: 차별화 요소이며 프리미엄 기능으로 수익화 가능

#### ✅ **개발할 API**

| 순서 | API | 설명 | 중요도 |
|:---:|-----|-----|:------:|
| 1 | POST /ai/tts | 텍스트 → 음성 변환 | ⭐⭐⭐ |
| 2 | POST /ai/image | 캐릭터 이미지 생성 | ⭐⭐⭐⭐ |
| 3 | GET /ai/voices | 사용 가능한 음성 목록 | ⭐⭐ |
| 4 | POST /ai/image/variations | 이미지 변형 생성 | ⭐⭐ |

---

## 🗄️ 데이터베이스 설계 (PostgreSQL/SQLite)

**[현황 분석]** 아래는 현재 `test.db`에 구현된 실제 테이블 스키마와 `app/models`에 정의된 SQLAlchemy 모델을 기준으로 최신화된 내용입니다.

### 🟢 핵심 기능 테이블 (구현 완료)

#### users (사용자)
- `id`, `email`, `username`, `hashed_password`, `is_active`, `is_verified`, `created_at`, `updated_at`

#### characters (캐릭터 - CAVEDUCK 고급 모델)
- **기본**: `id`, `creator_id`, `name`, `description`, `personality`, `background_story`, `avatar_url`
- **신규/확장**: `speech_style`, `greeting`, `world_setting`, `user_display_description`, `use_custom_description`, `introduction_scenes`, `character_type`, `base_language`, `image_descriptions`, `voice_settings`, `has_affinity_system`, `affinity_rules`, `affinity_stages`, `custom_module_id`, `use_translation`
- **상태/통계**: `is_public`, `is_active`, `chat_count`, `like_count`

#### character_settings (캐릭터 AI 설정)
- `id`, `character_id`, `system_prompt`, `temperature`, `max_tokens`, `ai_model`
- **신규/확장**: `custom_prompt_template`, `use_memory`, `memory_length`, `response_style`

#### character_example_dialogues (캐릭터 예시 대화)
- `id`, `character_id`, `user_message`, `character_response`, `order_index`, `created_at`

#### world_settings (세계관 설정)
- `id`, `creator_id`, `name`, `description`, `rules`, `is_public`, `usage_count`

#### custom_modules (커스텀 모듈)
- `id`, `creator_id`, `name`, `description`, `custom_prompt`, `lorebook`

### 🟢 채팅 및 스토리 테이블 (구현 완료)

#### chat_rooms (채팅방)
- `id`, `user_id`, `character_id`, `title`, `message_count`

#### chat_messages (채팅 메시지)
- `id`, `chat_room_id`, `sender_type`, `content`, `message_metadata`

#### stories (스토리)
- `id`, `creator_id`, `character_id`, `title`, `content`, `summary`, `genre`, `is_public`, `is_featured`, `view_count`, `like_count`

### 🟢 소셜 기능 테이블 (구현 완료)

#### character_likes (캐릭터 좋아요)
- `id`, `user_id`, `character_id`

#### story_likes (스토리 좋아요)
- `id`, `user_id`, `story_id`

#### character_comments (캐릭터 댓글)
- `id`, `character_id`, `user_id`, `content`

#### story_comments (스토리 댓글)
- `id`, `story_id`, `user_id`, `content`

### 🟢 결제 및 포인트 테이블 (구현 완료)

#### payment_products (결제 상품)
- `id`, `name`, `description`, `price`, `point_amount`, `bonus_point`, `is_active`, `sort_order`

#### payments (결제 내역)
- `id`, `user_id`, `product_id`, `amount`, `point_amount`, `status`, `payment_method`, `payment_key`, `order_id`, `transaction_data`

#### point_transactions (포인트 거래 내역)
- `id`, `user_id`, `type`, `amount`, `balance_after`, `description`, `reference_type`, `reference_id`

#### user_points (사용자 포인트 잔액)
- `user_id`, `balance`, `total_charged`, `total_used`, `last_charged_at`

### 🔴 미구현 테이블 (로드맵 계획)
- `notifications` (알림)
- `notification_settings` (알림 설정)
- `character_rankings` (캐릭터 랭킹 스냅샷)












#### users (사용자)
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(50) UNIQUE NOT NULL,
    hashed_password VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    is_verified BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
```

#### characters (캐릭터)
```sql
CREATE TABLE characters (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    personality TEXT,
    background_story TEXT,
    avatar_url VARCHAR(500),
    is_public BOOLEAN DEFAULT true,
    is_active BOOLEAN DEFAULT true,
    chat_count INTEGER DEFAULT 0,
    like_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_characters_creator ON characters(creator_id);
CREATE INDEX idx_characters_public_active ON characters(is_public, is_active);
CREATE INDEX idx_characters_popularity ON characters(chat_count DESC, like_count DESC);
```

### 🔴 새로 추가할 테이블 ❌

#### payment_products (결제 상품)
```sql
CREATE TABLE payment_products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    price INTEGER NOT NULL,  -- 원화 기준
    point_amount INTEGER NOT NULL,  -- 지급 포인트
    bonus_point INTEGER DEFAULT 0,  -- 보너스 포인트
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 샘플 데이터
INSERT INTO payment_products (name, price, point_amount, bonus_point) VALUES
('스타터 팩', 1000, 100, 0),
('베이직 팩', 4500, 500, 50),
('프리미엄 팩', 8500, 1000, 150),
('얼티밋 팩', 24000, 3000, 600);
```

#### payments (결제 내역)
```sql
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    product_id UUID REFERENCES payment_products(id),
    amount INTEGER NOT NULL,
    point_amount INTEGER NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending, success, failed, cancelled
    payment_method VARCHAR(50),  -- card, kakao_pay, naver_pay, toss
    payment_key VARCHAR(200) UNIQUE,  -- PG사 고유 키
    order_id VARCHAR(200) UNIQUE NOT NULL,
    transaction_data JSONB,  -- PG사 응답 전체 저장
    failed_reason TEXT,
    paid_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_payments_user ON payments(user_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payments_created ON payments(created_at DESC);
```

#### point_transactions (포인트 거래 내역)
```sql
CREATE TABLE point_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    type VARCHAR(20) NOT NULL,  -- charge, use, refund, bonus
    amount INTEGER NOT NULL,  -- 양수: 충전, 음수: 사용
    balance_after INTEGER NOT NULL,  -- 거래 후 잔액
    description VARCHAR(200),
    reference_type VARCHAR(50),  -- payment, chat, story, etc
    reference_id UUID,  -- 관련 레코드 ID
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_point_tx_user ON point_transactions(user_id);
CREATE INDEX idx_point_tx_created ON point_transactions(created_at DESC);
CREATE INDEX idx_point_tx_type ON point_transactions(type);
```

#### user_points (사용자 포인트 잔액)
```sql
CREATE TABLE user_points (
    user_id UUID PRIMARY KEY REFERENCES users(id),
    balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
    total_charged INTEGER DEFAULT 0,
    total_used INTEGER DEFAULT 0,
    last_charged_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 트리거: point_transactions 생성 시 user_points 자동 업데이트
CREATE OR REPLACE FUNCTION update_user_points() RETURNS TRIGGER AS $$
BEGIN
    UPDATE user_points 
    SET balance = balance + NEW.amount,
        total_charged = CASE WHEN NEW.amount > 0 THEN total_charged + NEW.amount ELSE total_charged END,
        total_used = CASE WHEN NEW.amount < 0 THEN total_used - NEW.amount ELSE total_used END,
        updated_at = CURRENT_TIMESTAMP
    WHERE user_id = NEW.user_id;
    
    -- 잔액이 없으면 생성
    IF NOT FOUND THEN
        INSERT INTO user_points (user_id, balance) 
        VALUES (NEW.user_id, NEW.amount);
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_user_points_trigger
AFTER INSERT ON point_transactions
FOR EACH ROW EXECUTE FUNCTION update_user_points();
```

#### notifications (알림)
```sql
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,  -- payment_complete, character_liked, new_comment, etc
    title VARCHAR(200) NOT NULL,
    content TEXT NOT NULL,
    data JSONB,  -- 추가 데이터
    is_read BOOLEAN DEFAULT false,
    read_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_notifications_user_unread ON notifications(user_id, is_read) WHERE is_read = false;
CREATE INDEX idx_notifications_created ON notifications(created_at DESC);
```

#### notification_settings (알림 설정)
```sql
CREATE TABLE notification_settings (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    payment_notifications BOOLEAN DEFAULT true,
    social_notifications BOOLEAN DEFAULT true,
    chat_notifications BOOLEAN DEFAULT true,
    marketing_notifications BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

#### character_rankings (캐릭터 랭킹 스냅샷)
```sql
CREATE TABLE character_rankings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    period_type VARCHAR(20) NOT NULL,  -- daily, weekly, monthly, all_time
    period_date DATE NOT NULL,
    rank INTEGER NOT NULL,
    score INTEGER NOT NULL,
    chat_count INTEGER DEFAULT 0,
    like_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_rankings_unique ON character_rankings(character_id, period_type, period_date);
CREATE INDEX idx_rankings_lookup ON character_rankings(period_type, period_date, rank);
```

---

## 🚀 기술 구현 세부사항

### 1. 포인트 차감 시스템 아키텍처

```
사용자 요청
    ↓
[API Gateway]
    ↓
[포인트 확인] ← Redis Cache
    ↓
[원자적 차감] ← Redis Lua Script
    ↓
[메시지 큐] → Kafka/RabbitMQ
    ↓
[비동기 처리] → DB 동기화
```

### 2. 실시간 알림 아키텍처

```
이벤트 발생
    ↓
[Notification Service]
    ↓
[Redis Pub/Sub] → 온라인 사용자
    ↓
[FCM/APNs] → 오프라인 사용자
```

### 3. 캐싱 전략

| 데이터 유형 | 캐시 TTL | 캐시 키 |
|-----------|---------|--------|
| 사용자 포인트 | 5분 | points:{user_id} |
| 캐릭터 정보 | 1시간 | character:{id} |
| 랭킹 데이터 | 10분 | ranking:{type}:{period} |
| 세션 데이터 | 24시간 | session:{token} |

---

## 🔐 보안 고려사항

### 1. 결제 보안
- **HTTPS 필수**: 모든 결제 관련 통신
- **웹훅 검증**: IP 화이트리스트 + 서명 검증
- **중복 방지**: Idempotency Key 사용
- **로깅**: 모든 결제 이벤트 상세 로깅

### 2. 포인트 보안
- **원자적 처리**: Redis Lua 스크립트
- **이중 차감 방지**: 거래 ID 기반 중복 체크
- **롤백 메커니즘**: 실패 시 자동 복구
- **감사 로그**: 모든 포인트 변동 추적

### 3. API 보안
- **Rate Limiting**: IP/사용자별 제한
- **JWT 만료**: Access Token 30분, Refresh Token 7일
- **CORS 설정**: 허용된 도메인만
- **SQL Injection 방지**: ORM 사용, 파라미터 바인딩

---

## 📈 성능 최적화 전략

### 1. 데이터베이스 최적화
```sql
-- 복합 인덱스 추가
CREATE INDEX idx_payments_user_status_created 
ON payments(user_id, status, created_at DESC);

-- 파티셔닝 (월별)
CREATE TABLE point_transactions_2024_01 
PARTITION OF point_transactions 
FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');
```

### 2. Redis 최적화
```python
# 파이프라인 사용
async def bulk_update_rankings(updates: List[RankingUpdate]):
    pipe = redis.pipeline()
    for update in updates:
        pipe.zincrby(f"ranking:{update.type}", update.score, update.id)
    await pipe.execute()
```

### 3. API 응답 최적화
- **페이지네이션**: Cursor 기반 구현
- **필드 선택**: GraphQL 스타일 sparse fieldsets
- **압축**: gzip 응답 압축
- **CDN**: 정적 리소스 캐싱

---

## 🧪 테스트 전략

### 1. 단위 테스트
```python
# 포인트 차감 테스트
async def test_point_deduction():
    # Given
    user_id = "test_user"
    initial_points = 1000
    deduct_amount = 100
    
    # When
    result = await deduct_points_atomic(redis, user_id, deduct_amount, "test")
    
    # Then
    assert result == True
    balance = await redis.get(f"points:{user_id}")
    assert int(balance) == initial_points - deduct_amount
```

### 2. 통합 테스트
- **결제 플로우**: 요청 → 웹훅 → 포인트 충전
- **동시성 테스트**: 동시 포인트 차감
- **롤백 테스트**: 실패 시나리오

### 3. 부하 테스트
- **도구**: Locust, K6
- **목표**: 동시 접속 10,000명, TPS 5,000
- **시나리오**: 결제, 포인트 차감, 랭킹 조회

---

## 🚀 배포 전략

### 1. 환경 구성
| 환경 | 용도 | 인프라 |
|-----|-----|--------|
| Local | 개발 | Docker Compose |
| Dev | 개발 테스트 | K8s (1 replica) |
| Staging | 배포 전 검증 | K8s (2 replicas) |
| Production | 실 서비스 | K8s (Auto-scaling) |

### 2. 배포 프로세스
```yaml
# .github/workflows/deploy.yml
name: Deploy to Production
on:
  push:
    tags:
      - 'v*'

jobs:
  deploy:
    steps:
      - name: Run Tests
      - name: Build Docker Image
      - name: Push to Registry
      - name: Deploy to K8s
      - name: Health Check
      - name: Rollback if Failed
```

### 3. 모니터링
- **APM**: DataDog, New Relic
- **로깅**: ELK Stack
- **메트릭**: Prometheus + Grafana
- **알림**: PagerDuty

---

## 📅 개발 일정 (총 5-7주 남음)

| 주차 | 작업 내용 | 담당 | 상태 |
|-----|----------|------|------|
| ~~1-3주~~ | ~~결제/포인트 시스템~~ | ~~백엔드~~ | ✅ 완료 |
| ~~1주~~ | ~~소셜 기능 완전 구현~~ | ~~백엔드~~ | ✅ 완료 |
| 1-2주 | 결제 UI/UX | 프론트엔드 | 🔄 진행 |
| 2-3주 | 알림 시스템 | 풀스택 | 📋 예정 |
| 3-4주 | 랭킹/추천 | 백엔드 | 📋 예정 |
| 4-5주 | TTS/이미지 | AI 팀 | 📋 예정 |
| 5-6주 | 통합 테스트 | QA | 📋 예정 |
| 6-7주 | 성능 최적화 | DevOps | 📋 예정 |
| 7주 | 배포 준비 | 전체 | 📋 예정 |

### 🎯 **현재 상황 (2024.01.15)**
- ✅ **1단계 완료**: 결제/포인트 시스템 백엔드 로직 완료
- ✅ **1.5단계 완료**: 소셜 기능 완전 구현 완료 (14개 API)
- 🔄 **진행 중**: 프론트엔드 결제 UI/UX 개발 필요
- 📋 **다음 단계**: 알림 시스템 개발 시작

---

## 💰 예상 비용

| 항목 | 월 비용 | 비고 |
|-----|--------|-----|
| 서버 (AWS) | $500-1000 | Auto-scaling |
| DB (RDS) | $200-400 | Multi-AZ |
| Redis | $100-200 | ElastiCache |
| AI API | $300-1000 | 사용량 기반 |
| CDN | $50-100 | CloudFront |
| 모니터링 | $100-200 | DataDog |
| **총계** | **$1,250-2,900** | 트래픽 기반 |

---

## 🎯 KPI 목표

| 지표 | 3개월 | 6개월 | 1년 |
|-----|-------|-------|-----|
| MAU | 10K | 50K | 200K |
| 유료 전환율 | 2% | 5% | 10% |
| ARPPU | ₩5,000 | ₩10,000 | ₩15,000 |
| 일일 채팅 수 | 50K | 500K | 2M |
| 서버 응답시간 | <200ms | <150ms | <100ms |

---

## 🔍 리스크 관리

| 리스크 | 영향도 | 대응 방안 |
|--------|-------|----------|
| AI API 비용 폭증 | 높음 | 사용량 제한, 캐싱 강화 |
| DDoS 공격 | 높음 | Cloudflare, Rate Limiting |
| 데이터 유실 | 매우 높음 | 백업, 복제, 감사 로그 |
| 규제 변경 | 중간 | 법무 검토, 약관 업데이트 |

---

## 📚 참고 자료

1. **결제 연동**
   - [토스페이먼츠 개발자 문서](https://docs.tosspayments.com)
   - [카카오페이 API](https://developers.kakao.com/docs/latest/ko/kakaopay/common)

2. **Redis 최적화**
   - [Redis Lua Scripting](https://redis.io/docs/manual/programmability/eval-intro/)
   - [Redis Best Practices](https://redis.io/docs/manual/patterns/)

3. **성능 최적화**
   - [FastAPI Performance](https://fastapi.tiangolo.com/deployment/concepts/)
   - [PostgreSQL Tuning](https://wiki.postgresql.org/wiki/Tuning_Your_PostgreSQL_Server)

---

**작성일**: 2025년 7월 11일  
**최근 업데이트**: 2024년 1월 15일  
**버전**: 2.2  
**작성자**: AI 캐릭터챗 플랫폼 개발팀  

### 📝 **최근 업데이트 내역**
- **2024.01.15**: 1단계 결제/포인트 시스템 백엔드 구현 완료
- **구현 완료**: 9개 API 엔드포인트, Redis 원자적 처리, 4개 테이블 마이그레이션
- **2024.01.15**: 1.5단계 소셜 기능 완전 구현 완료
- **구현 완료**: 14개 소셜 API, 스토리 댓글 시스템, 좋아요 상태 확인, 댓글 수 자동 추적
- **진행 상황**: 8-10주 → 5-7주 남음, 다음 우선순위는 알림 시스템 