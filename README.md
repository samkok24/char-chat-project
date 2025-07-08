# AI 캐릭터 챗 플랫폼

character.ai와 비슷한 AI 캐릭터 챗 서비스에 AI 스토리 생성 기능을 추가한 웹 플랫폼입니다.

## 🎯 주요 기능

- **캐릭터 생성**: 사용자가 AI 캐릭터를 생성하고 설정할 수 있습니다
- **실시간 채팅**: 생성된 캐릭터와 실시간으로 대화할 수 있습니다
- **AI 스토리 생성**: 특정 키워드를 입력하면 AI가 스토리를 생성합니다
- **회원가입/로그인**: 이메일 기반 사용자 인증
- **캐릭터 공유**: 모든 사용자가 생성된 캐릭터와 대화 가능

## 🛠️ 기술 스택

### 프론트엔드
- **React.js**: 사용자 인터페이스 구축
- **Socket.IO Client**: 실시간 통신

### 백엔드
- **FastAPI (Python)**: 메인 API 서버 (사용자 인증, 캐릭터 관리, AI 통합)
- **Node.js + Socket.IO**: 실시간 채팅 서버
- **PostgreSQL**: 사용자 및 캐릭터 데이터 저장
- **Redis**: 세션 관리 및 캐싱

### AI 서비스
- **Gemini API**: 캐릭터 대화 생성
- **Claude API**: 스토리 생성
- **Imagen 4**: 이미지 생성

### 인프라
- **Docker**: 컨테이너화
- **Docker Compose**: 로컬 개발 환경

## 📁 프로젝트 구조

```
char_chat_project/
├── backend-api/          # FastAPI 메인 서버
│   ├── app/
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env.example
├── chat-server/          # Node.js 채팅 서버
│   ├── src/
│   ├── package.json
│   ├── Dockerfile
│   └── .env.example
├── frontend/             # React 프론트엔드
│   ├── src/
│   ├── package.json
│   ├── Dockerfile
│   └── .env.example
├── docker/               # Docker 설정
│   └── docker-compose.yml
├── docs/                 # 문서
└── README.md
```

## 🚀 개발 로드맵

### Phase 1: 프로젝트 구조 설계 및 초기 설정 ✅
- [x] 프로젝트 디렉토리 구조 생성
- [x] 기본 설정 파일 작성

### Phase 2: 백엔드 API 서버 개발 (FastAPI)
- [ ] 사용자 인증 시스템
- [ ] 캐릭터 CRUD API
- [ ] 데이터베이스 모델 설계
- [ ] AI API 통합 준비

### Phase 3: 실시간 채팅 서버 개발 (Node.js + Socket.IO)
- [ ] WebSocket 연결 관리
- [ ] 실시간 메시지 전송
- [ ] 채팅방 관리

### Phase 4: 프론트엔드 개발 (React)
- [ ] 사용자 인터페이스 구축
- [ ] 캐릭터 생성/관리 페이지
- [ ] 채팅 인터페이스
- [ ] 스토리 생성 페이지

### Phase 5: AI 통합 및 스토리 생성 기능 구현
- [ ] Gemini API 연동 (캐릭터 대화)
- [ ] Claude API 연동 (스토리 생성)
- [ ] Imagen 4 API 연동 (이미지 생성)
- [ ] 웹소설생성봇 로직 통합

### Phase 6: Docker 컨테이너화 및 로컬 테스트
- [ ] 각 서비스 Dockerfile 작성
- [ ] Docker Compose 설정
- [ ] 로컬 환경 테스트

### Phase 7: 통합 테스트 및 최종 확인
- [ ] 전체 시스템 통합 테스트
- [ ] 성능 최적화
- [ ] 배포 준비

## 🔧 로컬 개발 환경 설정

### 필수 요구사항
- Docker & Docker Compose
- Node.js 18+
- Python 3.11+

### 환경 변수 설정
각 서비스의 `.env.example` 파일을 참고하여 `.env` 파일을 생성하세요.

### 실행 방법
```bash
# 전체 서비스 실행
docker-compose -f docker/docker-compose.yml up -d

# 개별 서비스 개발 모드 실행
cd backend-api && uvicorn app.main:app --reload
cd chat-server && npm run dev
cd frontend && npm start
```

## 📝 API 문서

개발 완료 후 FastAPI 자동 생성 문서를 통해 API 명세를 확인할 수 있습니다.
- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

## 🤝 기여 방법

1. 이 저장소를 포크합니다
2. 새로운 기능 브랜치를 생성합니다 (`git checkout -b feature/AmazingFeature`)
3. 변경사항을 커밋합니다 (`git commit -m 'Add some AmazingFeature'`)
4. 브랜치에 푸시합니다 (`git push origin feature/AmazingFeature`)
5. Pull Request를 생성합니다

## 📄 라이선스

이 프로젝트는 MIT 라이선스 하에 배포됩니다. 자세한 내용은 `LICENSE` 파일을 참조하세요.

