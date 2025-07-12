# CAVEDUCK 스타일 설정 가이드 🦆

> **Simple is Best** - 최소한의 설정으로 빠르게 시작하기

## 🚀 30초 빠른 시작

### Windows 사용자
```bash
# 프로젝트 루트에서 실행
start_servers.bat
```

### Mac/Linux 사용자
```bash
# 실행 권한 부여
chmod +x start_servers.sh
./start_servers.sh
```

**끝! 브라우저에서 http://localhost:5173 접속**

## 📦 최소 요구사항

- **Python** 3.8+ 
- **Node.js** 16+
- **Redis** (선택사항)

## 🛠️ 수동 설치 (3단계)

### 1️⃣ 백엔드 설정 (1분)
```bash
cd backend-api
pip install -r requirements.txt
python -m uvicorn app.main:app --reload
```

### 2️⃣ 채팅 서버 설정 (1분)
```bash
cd chat-server
npm install
npm run dev
```

### 3️⃣ 프론트엔드 설정 (1분)
```bash
cd frontend/char-chat-frontend
pnpm install  # 또는 npm install
pnpm run dev  # 또는 npm run dev
```

## 🔑 환경 설정 (필수)

### `.env` 파일 생성
```bash
# backend-api/.env
GEMINI_API_KEY=your_gemini_key_here
DATABASE_URL=sqlite:///./test.db  # 개발용
SECRET_KEY=your-secret-key-here
```

### API 키 발급처
- **Gemini**: https://makersuite.google.com/app/apikey
- **Claude** (선택): https://console.anthropic.com/

## 🌐 접속 정보

| 서비스 | URL | 용도 |
|--------|-----|------|
| 프론트엔드 | http://localhost:5173 | 메인 웹사이트 |
| 백엔드 API | http://localhost:8000 | API 서버 |
| API 문서 | http://localhost:8000/docs | Swagger UI |
| 채팅 서버 | http://localhost:3001 | Socket.IO |

## ⚡ Docker로 한 번에 실행

```bash
docker-compose up -d
```

**Docker가 없다면?**
```bash
# Windows
winget install Docker.DockerDesktop

# Mac
brew install --cask docker

# Linux
curl -fsSL https://get.docker.com | sh
```

## 🚨 자주 발생하는 문제

### 포트 충돌
```bash
# 사용 중인 포트 확인
netstat -ano | findstr :8000  # Windows
lsof -i :8000                  # Mac/Linux

# 포트 변경
python -m uvicorn app.main:app --port 8001
```

### 데이터베이스 초기화
```bash
cd backend-api
rm test.db  # 기존 DB 삭제
python -m uvicorn app.main:app  # 재시작하면 자동 생성
```

### npm 에러
```bash
# 캐시 정리
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```

## 🎯 개발 팁

### 빠른 재시작
- **백엔드**: 코드 수정하면 자동 재시작 (--reload 옵션)
- **프론트엔드**: HMR로 즉시 반영
- **채팅 서버**: nodemon으로 자동 재시작

### 로그 확인
```bash
# 백엔드 로그
tail -f backend-api/logs/app.log

# 프론트엔드 로그
브라우저 개발자 도구 (F12) > Console

# 채팅 서버 로그
콘솔에 실시간 출력
```

## 🦆 CAVEDUCK 스타일 체크리스트

- [ ] 3초 이내 페이지 로드
- [ ] 모바일에서 테스트
- [ ] 불필요한 기능 제거
- [ ] 심플한 UI 유지
- [ ] 직관적인 UX

## 📞 도움이 필요하면

1. **에러 메시지 복사** → Google 검색
2. **ChatGPT에 물어보기** → 빠른 해결
3. **GitHub Issues** → 커뮤니티 도움

---

**Remember: Keep It Simple! 🦆** 