# 스토리 다이브 설치 및 테스트 가이드

## 1. 데이터베이스 마이그레이션

새로운 테이블(`novels`, `storydive_sessions`)이 추가되었습니다.

### SQLite (개발 환경)
서버 재시작 시 자동으로 테이블이 생성됩니다.

```bash
# 백엔드 서버 시작 (테이블 자동 생성)
cd backend-api
python -m uvicorn app.main:app --reload
```

## 2. 초기 소설 데이터 삽입

하드코딩된 샘플 소설 2개를 DB에 삽입합니다.

```bash
cd backend-api
python scripts/init_novels.py
```

### 예상 출력:
```
📚 스토리 다이브 초기 소설 데이터 삽입 시작...

✅ '로또1등이라 엄청 즐겁게 회사생활하기' 추가 완료
✅ '전셋집에서 시작하는 나의 히어로 아카데미아' 추가 완료

🎉 총 2개의 소설이 성공적으로 삽입되었습니다!
```

## 3. 프론트엔드 실행

```bash
cd frontend/char-chat-frontend
npm run dev
```

## 4. 테스트 플로우

### 4.1 진입 경로 1: 메인 대시보드
1. `/dashboard` 접속
2. "신비한천사60님. 이런 상상, 해본 적 있으세요?" 섹션의 이미지 클릭
3. 스토리 다이브 목록 페이지로 이동

### 4.2 진입 경로 2: 직접 URL
- `/storydive` - 소설 목록 페이지

### 4.3 플로우 테스트
1. **목록 페이지** (`/storydive`)
   - 2개의 소설 카드 확인
   - "소설 읽기" 버튼 클릭

2. **원문 페이지** (`/storydive/novels/{novel_id}`)
   - 소설 원문이 표시됨
   - 스크롤하면서 5문단씩 포커싱 (흰색 ↔ 회색 전환) 확인
   - 문단에 마우스 호버 시 우측에 "🏊 다이브" 버튼 표시
   - 다이브 버튼 클릭

3. **플레이 페이지** (`/storydive/play/{session_id}`)
   - AI Dungeon 스타일 UI 확인
   - 우상단 톱니바퀴 클릭 → Story Cards 사이드패널 확인
   - 하단 툴바:
     - Do/Say/Story/See 라디오 버튼 선택
     - 텍스트 입력
     - Send 버튼 클릭 → AI 응답 생성
     - Continue 버튼 → 이어쓰기
     - Retry 버튼 → 마지막 응답 재생성
     - Erase 버튼 → 마지막 응답 삭제

## 5. API 엔드포인트 테스트

### FastAPI Docs
http://localhost:8000/docs

### 주요 엔드포인트:
- `GET /storydive/novels` - 소설 목록
- `GET /storydive/novels/{novel_id}` - 소설 상세
- `POST /storydive/sessions` - 세션 생성
- `GET /storydive/sessions/{session_id}` - 세션 조회
- `POST /storydive/sessions/{session_id}/turn` - 턴 진행
- `DELETE /storydive/sessions/{session_id}/erase` - 마지막 턴 삭제

## 6. 문제 해결

### "Novel not found" 오류
→ `python scripts/init_novels.py` 실행 확인

### "Session not found" 오류
→ 브라우저 새로고침 후 다시 다이브 시도

### AI 응답이 생성되지 않음
→ `app/core/config.py`에서 API 키 설정 확인 (GEMINI_API_KEY, CLAUDE_API_KEY 등)

### 프론트엔드 빌드 오류
→ `npm install` 재실행

## 7. 향후 확장

- See 모드 이미지 생성 기능 (기존 이미지 생성 모달 통합)
- 세션 목록 페이지 (내가 플레이한 세션 보기)
- 북마크 및 공유 기능
- 더 많은 샘플 소설 추가

## 8. 주의사항

- **chat.py 수정 없음**: 기존 채팅 시스템과 완전히 독립적으로 구현됨
- **AgentPage.jsx 수정 없음**: 별도의 페이지로 구현됨
- **기존 코드 충돌 없음**: 모든 파일이 신규 생성되거나 최소 변경됨

