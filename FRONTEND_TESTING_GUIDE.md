# 프론트엔드 테스트 가이드

## 시작하기

### 1. 백엔드 확인
- Docker로 백엔드가 실행 중인지 확인
- http://localhost:8000/docs 에서 API 문서 확인

### 2. 프론트엔드 실행
```bash
cd frontend/char-chat-frontend
pnpm install  # 패키지 설치 (처음 한 번만)
pnpm run dev  # 개발 서버 시작
```

### 3. 접속
- http://localhost:5173 으로 접속

## 주요 기능 테스트

### 1. 회원가입 / 로그인
- 홈페이지에서 "회원가입" 클릭
- 이메일, 사용자명, 비밀번호 입력
- 가입 후 자동 로그인

### 2. 캐릭터 생성
- 로그인 후 "캐릭터 생성" 버튼 클릭
- 캐릭터 정보 입력:
  - 이름 (필수)
  - 설명 (필수)
  - 성격 및 특징 (필수)
  - 배경 스토리 (선택)
  - 프로필 이미지 URL (선택)
  - 공개/비공개 설정

### 3. 캐릭터 탐색
- 홈페이지에서 공개된 캐릭터들 확인
- 캐릭터 카드 클릭으로 상세 페이지 이동
- 검색 기능으로 캐릭터 찾기

### 4. 캐릭터 상세 페이지
- 캐릭터 정보 확인
- 좋아요 추가/취소
- 댓글 작성 및 삭제
- "대화 시작하기" 버튼으로 채팅 시작

### 5. 채팅
- AI 캐릭터와 실시간 대화
- 메시지 전송 및 AI 응답 수신
- 대화 내용 자동 저장

### 6. 내 캐릭터 관리
- "내 캐릭터" 메뉴에서 관리
- 캐릭터 수정, 삭제
- 통계 확인 (대화 수, 좋아요 등)

## 현재 구현된 페이지

1. **HomePage** (`/`)
   - 공개 캐릭터 목록
   - 검색 기능
   - 로그인/회원가입 링크

2. **LoginPage** (`/login`)
   - 이메일/비밀번호 로그인

3. **RegisterPage** (`/register`)
   - 회원가입 폼

4. **CreateCharacterPage** (`/characters/create`)
   - 새 캐릭터 생성

5. **CharacterDetailPage** (`/characters/:id`)
   - 캐릭터 상세 정보
   - 좋아요, 댓글 기능

6. **ChatPage** (`/chat/:characterId`)
   - AI 캐릭터와 대화

7. **MyCharactersPage** (`/my-characters`)
   - 내가 만든 캐릭터 관리

## 미구현 기능

1. **캐릭터 수정 페이지** (`/characters/:id/edit`)
2. **AI 설정 페이지** (`/characters/:id/settings`)
3. **스토리 기능** (전체)
4. **Socket.IO 실시간 통신** (현재는 API 폴링 사용)

## 주의사항

- 첫 실행 시 캐릭터가 없을 수 있음
- AI 응답은 백엔드에서 Gemini/Claude API 키가 설정되어 있어야 함
- 파일 업로드는 아직 미구현 (이미지 URL만 사용 가능)

## 문제 해결

### 프론트엔드가 실행되지 않을 때
```bash
# 프로세스 종료 후 재시작
pnpm run dev
```

### API 연결 오류
- 백엔드가 실행 중인지 확인
- CORS 설정 확인
- 브라우저 개발자 도구에서 네트워크 오류 확인

### 로그인이 유지되지 않을 때
- localStorage의 토큰 확인
- 토큰 만료 시간 확인 