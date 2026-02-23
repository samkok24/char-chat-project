# CAVEDUCK 스타일 개발 로드맵 🦆

## 📊 현재 프로젝트 vs CAVEDUCK 비교 분석

### 현재 프로젝트 현황
- **과도한 기능**: 복잡한 결제 시스템, 너무 많은 설정
- **복잡한 UI**: 너무 많은 페이지와 옵션
- **성능 이슈**: 무거운 프론트엔드, 느린 로딩
- **모바일 미최적화**: 데스크톱 중심 설계

### CAVEDUCK의 강점
- **극도로 심플한 UI**: 채팅에만 집중
- **빠른 로딩**: 최소한의 리소스
- **모바일 퍼스트**: 터치 친화적 인터페이스
- **직관적 UX**: 클릭 2번 이내로 채팅 시작

## 🎯 개발 목표: "Chat First, Story Later"

### 핵심 원칙
1. **AI 채팅 최우선**: 완벽한 채팅 경험에 집중
2. **속도 최우선**: 3초 이내 페이지 로드
3. **모바일 중심**: 모든 기능이 모바일에서 완벽 작동
4. **단계적 개선**: 채팅 → 댓글 → 스토리 순으로 개발

## 📋 Phase 1: AI 채팅 서비스 집중 (2주차) - 현재 진행 중 🔥

### 1.1 제거할 기능들
```
❌ 복잡한 결제 시스템 (단순화)
❌ 프로필 페이지
❌ 복잡한 캐릭터 설정
❌ 불필요한 관리 페이지들
```

### 1.2 단순화할 기능들
```
✂️ 회원가입: 이메일/비밀번호만 또는 소셜 로그인
✂️ 캐릭터 생성: 이름과 간단한 설명만
✂️ 좋아요: 단순 카운트만 표시
✂️ 결제: 단일 구독 모델로 단순화
```

### 1.3 유지할 핵심 기능
```
✅ 캐릭터 목록 (갤러리)
✅ 1:1 AI 채팅 (최우선)
✅ 간단한 로그인/회원가입
✅ 캐릭터 좋아요
✅ 댓글 시스템 (백엔드 유지, UI 연동 예정)
✅ 스토리 생성 (백엔드 유지, 나중에 개발)
```

## 📋 Phase 2: 채팅 최적화 (1주차)

### 2.1 실시간 채팅 개선
```javascript
// 1. Socket.IO 연결 안정화
const socket = io({
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionAttempts: 5
});

// 2. 메시지 스트리밍
socket.on('ai_response_chunk', (chunk) => {
  appendToMessage(chunk);
});

// 3. 타이핑 인디케이터
socket.on('ai_typing', () => {
  showTypingIndicator();
});
```

### 2.2 AI 응답 최적화
```python
# 1. 캐릭터별 프롬프트 최적화
def get_character_prompt(character):
    return f"""
    당신은 {character.name}입니다.
    성격: {character.personality}
    말투: {character.speech_style}
    배경: {character.background}
    """

# 2. 컨텍스트 관리
def get_chat_context(session_id, limit=10):
    # 최근 10개 메시지만 컨텍스트로 사용
    return get_recent_messages(session_id, limit)

# 3. 응답 속도 개선
async def generate_response(character, message, context):
    # 스트리밍 응답으로 빠른 피드백
    async for chunk in ai_service.stream_response(
        prompt=get_character_prompt(character),
        message=message,
        context=context,
        max_tokens=150
    ):
        yield chunk
```

## 📋 Phase 3: DB 스키마 최적화 (3일)

### 3.1 현재 유지할 스키마 (채팅 중심)
```sql
-- 사용자 테이블 (최소화)
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255),
    username VARCHAR(50) UNIQUE NOT NULL,
    is_premium BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 캐릭터 테이블 (AI 채팅용)
CREATE TABLE characters (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    personality TEXT,
    speech_style TEXT,
    avatar_url VARCHAR(500),
    greeting TEXT DEFAULT 'Hello! How can I help you today?',
    creator_id INTEGER REFERENCES users(id),
    like_count INTEGER DEFAULT 0,
    chat_count INTEGER DEFAULT 0,
    is_public BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 채팅 세션 (핵심)
CREATE TABLE chat_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    character_id INTEGER REFERENCES characters(id),
    last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 채팅 메시지 (최적화)
CREATE TABLE chat_messages (
    id SERIAL PRIMARY KEY,
    session_id INTEGER REFERENCES chat_sessions(id),
    role VARCHAR(10) CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 좋아요 (단순화)
CREATE TABLE character_likes (
    user_id INTEGER REFERENCES users(id),
    character_id INTEGER REFERENCES characters(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, character_id)
);

-- 캐릭터 댓글 (유지)
CREATE TABLE character_comments (
    id SERIAL PRIMARY KEY,
    character_id INTEGER REFERENCES characters(id),
    user_id INTEGER REFERENCES users(id),
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 스토리 테이블 (유지하되 나중에 활용)
CREATE TABLE stories (
    id SERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    content TEXT NOT NULL,
    character_id INTEGER REFERENCES characters(id),
    user_id INTEGER REFERENCES users(id),
    is_public BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 인덱스 추가 (채팅 성능 최적화)
CREATE INDEX idx_chat_sessions_user ON chat_sessions(user_id);
CREATE INDEX idx_chat_messages_session ON chat_messages(session_id);
CREATE INDEX idx_characters_public ON characters(is_public);
CREATE INDEX idx_character_comments_character ON character_comments(character_id);
```

### 3.2 제거할 테이블들
```sql
DROP TABLE IF EXISTS payment_products CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS point_transactions CASCADE;
DROP TABLE IF EXISTS user_points CASCADE;
DROP TABLE IF EXISTS character_settings CASCADE;
```

## 📋 Phase 4: API 엔드포인트 우선순위 (1주차)

### 4.1 즉시 구현할 핵심 API (채팅 중심)
```yaml
# 인증 (3개)
POST   /api/auth/register     # 간단한 회원가입
POST   /api/auth/login        # 로그인
POST   /api/auth/logout       # 로그아웃

# 캐릭터 (5개)
GET    /api/characters        # 캐릭터 목록 (페이지네이션)
GET    /api/characters/:id    # 캐릭터 상세
POST   /api/characters        # 캐릭터 생성 (프리미엄)
POST   /api/characters/:id/like    # 좋아요
DELETE /api/characters/:id/like    # 좋아요 취소

# 채팅 (4개) - 최우선
POST   /api/chat/start        # 채팅 시작
POST   /api/chat/message      # 메시지 전송
GET    /api/chat/history/:session_id  # 채팅 기록
GET    /api/chat/sessions     # 내 채팅 목록
```

### 4.2 Phase 5에서 구현할 API (댓글)
```yaml
# 댓글 (4개)
GET    /api/characters/:id/comments    # 댓글 목록
POST   /api/characters/:id/comments    # 댓글 작성
PUT    /api/comments/:id              # 댓글 수정
DELETE /api/comments/:id              # 댓글 삭제
```

### 4.3 나중에 구현할 API (스토리)
```yaml
# 스토리 (백엔드는 유지, 나중에 프론트엔드 연동)
POST   /api/stories/generate   # AI 스토리 생성
GET    /api/stories           # 스토리 목록
GET    /api/stories/:id       # 스토리 상세
POST   /api/stories           # 스토리 저장
```

## 📋 Phase 5: 프론트엔드 최적화 (2주차)

### 5.1 페이지 구조 (채팅 중심)
```
/ (홈 - 캐릭터 갤러리)
├── /login (로그인/회원가입 통합)
├── /chat/:characterId (채팅 페이지) ⭐ 핵심
├── /character/:id (캐릭터 상세 + 댓글)
└── /create (캐릭터 생성 - 프리미엄 전용)
```

### 5.2 채팅 UI 최적화
```typescript
// 1. 메시지 컴포넌트 최적화
const ChatMessage = memo(({ message }) => {
  return (
    <div className={`message ${message.role}`}>
      {message.role === 'assistant' && (
        <Avatar src={character.avatar_url} />
      )}
      <div className="message-content">
        {message.content}
      </div>
      <time>{formatTime(message.created_at)}</time>
    </div>
  );
});

// 2. 실시간 타이핑 효과
const TypingIndicator = () => {
  return (
    <div className="typing-indicator">
      <span></span>
      <span></span>
      <span></span>
    </div>
  );
};

// 3. 무한 스크롤 채팅 히스토리
const useChatHistory = (sessionId) => {
  return useInfiniteQuery({
    queryKey: ['chat', sessionId],
    queryFn: ({ pageParam = 0 }) => 
      api.getChatHistory(sessionId, pageParam),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
};
```

### 5.3 모바일 채팅 최적화
```css
/* 채팅 인터페이스 */
.chat-container {
  height: 100vh;
  display: flex;
  flex-direction: column;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.chat-input {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 12px;
  padding-bottom: calc(12px + env(safe-area-inset-bottom));
  background: white;
  border-top: 1px solid #eee;
}

/* 메시지 버블 */
.message {
  margin: 8px 12px;
  display: flex;
  align-items: flex-end;
}

.message.user {
  flex-direction: row-reverse;
}

.message-content {
  max-width: 70%;
  padding: 8px 12px;
  border-radius: 18px;
  background: #f0f0f0;
}

.message.user .message-content {
  background: #007AFF;
  color: white;
}
```

## 📋 Phase 6: 성능 최적화 (1주차)

### 6.1 채팅 성능 최적화
```python
# 1. Redis 캐싱 활용
async def get_character_with_cache(character_id):
    cached = await redis.get(f"character:{character_id}")
    if cached:
        return json.loads(cached)
    
    character = await get_character(character_id)
    await redis.setex(
        f"character:{character_id}", 
        3600,  # 1시간 캐시
        json.dumps(character)
    )
    return character

# 2. 세션 관리 최적화
async def get_or_create_session(user_id, character_id):
    # 기존 세션 재사용
    existing = await db.query(ChatSession).filter(
        ChatSession.user_id == user_id,
        ChatSession.character_id == character_id
    ).first()
    
    if existing:
        return existing
    
    return await create_new_session(user_id, character_id)
```

### 6.2 프론트엔드 채팅 최적화
```javascript
// 1. 메시지 가상화 (대량 메시지 처리)
import { VariableSizeList } from 'react-window';

const VirtualizedChat = ({ messages }) => {
  const getItemSize = (index) => {
    // 메시지 길이에 따른 동적 높이
    return estimateMessageHeight(messages[index]);
  };

  return (
    <VariableSizeList
      height={window.innerHeight - 100}
      itemCount={messages.length}
      itemSize={getItemSize}
      width="100%"
    >
      {({ index, style }) => (
        <div style={style}>
          <ChatMessage message={messages[index]} />
        </div>
      )}
    </VariableSizeList>
  );
};

// 2. 메시지 전송 최적화
const useOptimisticMessage = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: api.sendMessage,
    onMutate: async (newMessage) => {
      // 낙관적 업데이트
      await queryClient.cancelQueries(['chat', sessionId]);
      
      const previousMessages = queryClient.getQueryData(['chat', sessionId]);
      
      queryClient.setQueryData(['chat', sessionId], old => [
        ...old,
        { ...newMessage, id: 'temp-' + Date.now(), status: 'sending' }
      ]);
      
      return { previousMessages };
    },
    onError: (err, newMessage, context) => {
      // 실패 시 롤백
      queryClient.setQueryData(['chat', sessionId], context.previousMessages);
    },
    onSettled: () => {
      queryClient.invalidateQueries(['chat', sessionId]);
    }
  });
};
```

## 📋 Phase 7: 댓글 UI 연동 (1주차)

### 7.1 캐릭터 상세 페이지에 댓글 추가
```typescript
// CharacterDetailPage.jsx 수정
const CharacterDetailPage = () => {
  const { id } = useParams();
  const { data: character } = useQuery(['character', id], () => api.getCharacter(id));
  const { data: comments } = useQuery(['comments', id], () => api.getCharacterComments(id));
  
  return (
    <div className="character-detail">
      <CharacterInfo character={character} />
      <ChatStartButton characterId={id} />
      
      {/* 댓글 섹션 추가 */}
      <CommentSection 
        comments={comments}
        characterId={id}
      />
    </div>
  );
};

// 댓글 컴포넌트
const CommentSection = ({ comments, characterId }) => {
  const [newComment, setNewComment] = useState('');
  const addComment = useAddComment(characterId);
  
  return (
    <div className="comment-section">
      <h3>댓글 ({comments?.length || 0})</h3>
      
      <form onSubmit={(e) => {
        e.preventDefault();
        addComment.mutate(newComment);
        setNewComment('');
      }}>
        <textarea
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          placeholder="댓글을 입력하세요..."
        />
        <button type="submit">작성</button>
      </form>
      
      <div className="comment-list">
        {comments?.map(comment => (
          <Comment key={comment.id} comment={comment} />
        ))}
      </div>
    </div>
  );
};
```

## 📋 Phase 8: 모니터링 및 분석 (지속적)

### 8.1 채팅 중심 메트릭
```yaml
# 추적할 핵심 메트릭
- 평균 채팅 세션 길이
- 캐릭터별 인기도
- 응답 시간
- 사용자 재방문율
- 채팅 만족도
```

### 8.2 A/B 테스트 항목
```yaml
- AI 응답 스타일 (친근함 vs 전문적)
- 채팅 UI 레이아웃
- 캐릭터 추천 알고리즘
- 온보딩 프로세스
```

## 🚀 예상 일정 (채팅 우선)

| Phase | 기간 | 주요 작업 |
|-------|------|----------|
| Phase 1 | 2주 | AI 채팅 서비스 집중 |
| Phase 2 | 1주 | 채팅 최적화 |
| Phase 3 | 3일 | DB 스키마 최적화 |
| Phase 4 | 1주 | API 구현 (채팅 중심) |
| Phase 5 | 2주 | 프론트엔드 채팅 UI |
| Phase 6 | 1주 | 성능 최적화 |
| Phase 7 | 1주 | 댓글 UI 연동 |
| **총계** | **8주** | **채팅 서비스 완성** |

## 💡 성공 지표

### 단기 목표 (3개월) - 채팅 중심
- 평균 채팅 세션: > 15분
- 일일 활성 사용자: 1,000명
- 캐릭터당 일일 채팅: > 50회
- AI 응답 만족도: > 4.0/5.0

### 중기 목표 (6개월)
- 댓글 활성화: 캐릭터당 평균 10개
- 스토리 기능 출시
- 유료 구독자: 5% 전환율
- 월간 활성 사용자: 10,000명

## 🎯 핵심 차별화 포인트

### AI 채팅에 집중한 강점
1. **더 자연스러운 대화**: 캐릭터별 성격과 말투 완벽 구현
2. **빠른 응답**: 스트리밍 + 캐싱으로 즉각 반응
3. **컨텍스트 유지**: 대화 흐름을 자연스럽게 이어감
4. **모바일 최적화**: 언제 어디서나 편하게 채팅

## 📝 주의사항

### 꼭 지켜야 할 것
- ✅ AI 채팅 품질이 최우선
- ✅ 3초 이내 응답 시작
- ✅ 모바일에서 완벽 작동
- ✅ 캐릭터 개성 살리기

### 나중으로 미룰 것
- ⏳ 스토리 생성 UI (백엔드만 유지)
- ⏳ 복잡한 설정 옵션
- ⏳ 고급 관리 기능
- ⏳ 통계 대시보드

## 🦆 CAVEDUCK + AI 채팅 = 완벽한 조합

심플한 UI에 강력한 AI 채팅을 결합하여, 사용자가 쉽고 빠르게 AI 캐릭터와 대화할 수 있는 최고의 서비스를 만듭니다! 