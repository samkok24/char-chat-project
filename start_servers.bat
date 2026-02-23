@echo off
echo AI 캐릭터 챗 서비스 시작...

:: 백엔드 API 서버 시작 (포트 18000)
echo.
echo 1. FastAPI 백엔드 서버 시작 중...
cd backend-api
start cmd /k "pip install -r requirements.txt && python -m uvicorn app.main:app --host 0.0.0.0 --port 18000 --reload"

:: 프론트엔드 개발 서버 시작 (포트 5173)
echo.
echo 2. React 프론트엔드 서버 시작 중...
cd ..\frontend\char-chat-frontend
start cmd /k "npm install && npm run dev"

:: 채팅 서버 시작 (포트 13001) - 선택사항
:: echo.
:: echo 3. Socket.IO 채팅 서버 시작 중...
:: cd ..\..\chat-server
:: start cmd /k "npm install && npm start"

echo.
echo 모든 서버가 시작되었습니다!
echo.
echo 웹 브라우저에서 http://localhost:5173 으로 접속하세요.
echo.
pause 
