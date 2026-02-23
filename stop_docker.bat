@echo off
echo AI 캐릭터 챗 - Docker 중지
echo.

echo Docker 컨테이너를 중지합니다...
docker-compose -f docker-compose.dev.yml down

if %errorlevel% equ 0 (
    echo.
    echo ✅ 모든 서비스가 중지되었습니다.
) else (
    echo.
    echo ❌ 서비스 중지 중 오류가 발생했습니다.
)

echo.
pause 