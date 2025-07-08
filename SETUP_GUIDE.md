# AI 캐릭터 챗 프로젝트 설정 가이드

## 🚀 빠른 시작

### Windows 사용자
```bash
# 프로젝트 루트에서 실행
start_servers.bat
```

### 수동 실행

#### 1. 백엔드 서버 (FastAPI) 실행
```bash
cd backend-api
pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

#### 2. 프론트엔드 서버 (React) 실행
```bash
cd frontend/char-chat-frontend
npm install
npm run dev
```

## 📝 주요 수정 사항

### 1. 회원가입 문제 해결
- **문제**: User 모델의 필드명 불일치 (`hashed_password` vs `password_hash`)
- **해결**: 서비스 코드에서 올바른 필드명 사용하도록 수정

### 2. 데이터베이스 설정
- **변경**: PostgreSQL → SQLite (개발 환경)
- **파일**: `backend-api/app/core/config.py`, `backend-api/app/core/database.py`

### 3. API 키 설정
- **위치**: `backend-api/app/core/config.py`에 하드코딩 (개발용)
- **포함된 API 키**:
  - Gemini API
  - Claude API
  - OpenAI API

## 🔧 환경 설정

### 필수 요구사항
- Python 3.8+
- Node.js 16+
- npm 또는 pnpm

### 포트 정보
- **백엔드 API**: http://localhost:8000
- **프론트엔드**: http://localhost:5173
- **채팅 서버** (선택): http://localhost:3001

## 🌟 기능 확인

1. **회원가입**: http://localhost:5173/register
2. **로그인**: http://localhost:5173/login
3. **메인 페이지**: http://localhost:5173

## ⚠️ 주의사항

1. **API 키 보안**: 현재 API 키가 코드에 하드코딩되어 있습니다. 프로덕션에서는 환경 변수 사용을 권장합니다.

2. **데이터베이스**: SQLite는 개발용입니다. 프로덕션에서는 PostgreSQL 사용을 권장합니다.

3. **Redis**: 현재 Redis가 없어도 실행되지만, 채팅 기능에는 Redis가 필요할 수 있습니다.

## 🐛 문제 해결

### 회원가입이 안 될 때
1. 백엔드 서버가 실행 중인지 확인 (포트 8000)
2. 브라우저 개발자 도구에서 네트워크 오류 확인
3. `test.db` 파일 권한 확인

### 데이터베이스 오류
```bash
# test.db 파일 삭제 후 재시작
cd backend-api
del test.db  # Windows
rm test.db   # Linux/Mac
```

### 포트 충돌
다른 프로그램이 포트를 사용 중인 경우:
- 백엔드: `--port 8001`로 변경
- 프론트엔드: `vite.config.js`에서 포트 변경

## 📚 추가 개발

### 캐릭터 생성 기능 추가
1. 캐릭터 관리 페이지 개발
2. AI 모델 연동 강화
3. 이미지 업로드 기능 구현

### 채팅 기능 개선
1. Redis 설치 및 설정
2. Socket.IO 서버 활성화
3. 실시간 채팅 UI 개선

## 🤝 도움말

문제가 있으시면 다음을 확인해주세요:
1. 모든 의존성이 설치되었는지 확인
2. Python과 Node.js 버전 확인
3. 방화벽 설정 확인 (포트 8000, 5173) 