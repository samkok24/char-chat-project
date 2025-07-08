"""
AI 캐릭터 챗 플랫폼 - FastAPI 메인 애플리케이션
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from contextlib import asynccontextmanager
import logging

from app.core.config import settings
from app.core.database import engine, Base
from app.api.auth import router as auth_router
from app.api.characters import router as characters_router
from app.api.stories import router as stories_router
from app.api.chat import router as chat_router

# 로깅 설정
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """애플리케이션 시작/종료 시 실행되는 이벤트"""
    # 시작 시
    logger.info("🚀 AI 캐릭터 챗 플랫폼 시작")
    
    # 데이터베이스 테이블 생성 (개발용)
    if settings.ENVIRONMENT == "development":
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("📊 데이터베이스 테이블 생성 완료")
    
    yield
    
    # 종료 시
    logger.info("�� AI 캐릭터 챗 플랫폼 종료")


# FastAPI 앱 생성
app = FastAPI(
    title="AI 캐릭터 챗 플랫폼 API",
    description="character.ai와 비슷한 AI 캐릭터 챗 서비스 + AI 스토리 생성",
    version="1.0.0",
    docs_url="/docs" if settings.ENVIRONMENT == "development" else None,
    redoc_url="/redoc" if settings.ENVIRONMENT == "development" else None,
    lifespan=lifespan
)

# CORS 미들웨어 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 개발용 - 프로덕션에서는 특정 도메인만 허용
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 신뢰할 수 있는 호스트 설정 (선택사항)
if settings.ENVIRONMENT == "production":
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=["localhost", "127.0.0.1", "*.yourdomain.com"]
    )


# 라우터 등록
app.include_router(auth_router, prefix="/auth", tags=["인증"])
app.include_router(characters_router, prefix="/characters", tags=["캐릭터"])
app.include_router(stories_router, prefix="/stories", tags=["스토리"])
app.include_router(chat_router, prefix="/chat", tags=["채팅"])


@app.get("/")
async def root():
    """루트 엔드포인트"""
    return {
        "message": "AI 캐릭터 챗 플랫폼 API",
        "version": "1.0.0",
        "docs": "/docs",
        "status": "running"
    }


@app.get("/health")
async def health_check():
    """헬스 체크 엔드포인트"""
    return {
        "status": "healthy",
        "environment": settings.ENVIRONMENT,
        "database": "connected"  # 실제로는 DB 연결 상태 확인
    }


# @app.exception_handler(404)
# async def not_found_handler(request, exc):
#     """404 에러 핸들러"""
#     return HTTPException(
#         status_code=404,
#         detail="요청한 리소스를 찾을 수 없습니다."
#     )


# @app.exception_handler(500)
# async def internal_error_handler(request, exc):
#     """500 에러 핸들러"""
#     logger.error(f"Internal server error: {exc}")
#     return HTTPException(
#         status_code=500,
#         detail="서버 내부 오류가 발생했습니다."
#     )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True if settings.ENVIRONMENT == "development" else False
    )

