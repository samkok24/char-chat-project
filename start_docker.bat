@echo off
echo AI 캐릭터 챗 - Docker 실행
echo.

:: Docker Desktop이 실행 중인지 확인
docker version >nul 2>&1
if %errorlevel% neq 0 (
    echo Docker Desktop이 실행되지 않았습니다!
    echo Docker Desktop을 먼저 실행해주세요.
    echo.
    pause
    exit /b 1
)

echo Docker Desktop이 실행 중입니다.
echo.

:: 개발 환경 Docker Compose 실행
echo 개발 환경으로 서비스를 시작합니다...
echo.

docker-compose -f docker-compose.dev.yml up --build -d

if %errorlevel% equ 0 (
    echo.
    echo ✅ 서비스가 성공적으로 시작되었습니다!
    echo.
    echo 다음 주소로 접속하세요:
    echo - 웹사이트: http://localhost:5173
    echo - API 문서: http://localhost:8000/docs
    echo.
    echo 로그 확인: docker-compose -f docker-compose.dev.yml logs -f
    echo 중지하기: stop_docker.bat
) else (
    echo.
    echo ❌ 서비스 시작에 실패했습니다.
    echo 오류 메시지를 확인해주세요.
)

echo.
pause 