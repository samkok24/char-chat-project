"""
AI 캐릭터 챗 플랫폼 - FastAPI 메인 애플리케이션
CAVEDUCK 스타일: "Chat First, Story Later"
"""

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from contextlib import asynccontextmanager
import logging
import os
from app.core.config import settings
from app.core.database import engine, Base

# API 라우터 임포트 (우선순위 순서)
from app.api.chat import router as chat_router          # 🔥 최우선: 채팅 API
from app.api.auth import router as auth_router          # ✅ 필수: 인증 API  
from app.api.characters import router as characters_router  # ✅ 필수: 캐릭터 API
from app.api.stories import router as stories_router    # ⏳ 나중에: 스토리 API (차별점)
from app.api.payment import router as payment_router    # ⏳ 나중에: 결제 API (단순화 예정)
from app.api.point import router as point_router        # ⏳ 나중에: 포인트 API (단순화 예정)
from app.api.files import router as files_router
# 로깅 설정
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """애플리케이션 시작/종료 시 실행되는 이벤트"""
    # 시작 시
    logger.info("🚀 AI 캐릭터 챗 플랫폼 시작 (CAVEDUCK 스타일)")
    
    # 데이터베이스 테이블 생성 (개발용)
    if settings.ENVIRONMENT == "development":
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("📊 데이터베이스 테이블 생성 완료")
    
    yield
    
    # 종료 시
    logger.info("👋 AI 캐릭터 챗 플랫폼 종료")


# FastAPI 앱 생성
app = FastAPI(
    title="AI 캐릭터 챗 플랫폼 API",
    description="CAVEDUCK 스타일 AI 캐릭터 채팅 서비스 - Chat First, Story Later",
    version="2.0.0",
    docs_url="/docs" if settings.ENVIRONMENT == "development" else None,
    redoc_url="/redoc" if settings.ENVIRONMENT == "development" else None,
    lifespan=lifespan
)
os.makedirs("/app/data/uploads", exist_ok=True) # 디렉토리 존재 보장
app.mount("/static", StaticFiles(directory="/app/data/uploads"), name="static")
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


# 라우터 등록 (CAVEDUCK 스타일 우선순위)
# 🔥 Phase 4: 채팅 중심 API (최우선 완성)
app.include_router(chat_router, prefix="/chat", tags=["🔥 채팅 (최우선)"])
app.include_router(auth_router, prefix="/auth", tags=["✅ 인증 (필수)"])
app.include_router(characters_router, prefix="/characters", tags=["✅ 캐릭터 (필수)"])
app.include_router(files_router, prefix="/files", tags=["🗂️ 파일"])


# ⏳ Phase 5+: 나중에 개발할 기능들
app.include_router(stories_router, prefix="/stories", tags=["⏳ 스토리 (차별점)"])
app.include_router(payment_router, prefix="/payment", tags=["⏳ 결제 (단순화 예정)"])
app.include_router(point_router, prefix="/point", tags=["⏳ 포인트 (단순화 예정)"])


@app.get("/")
async def root():
    """루트 엔드포인트"""
    return {
        "message": "AI 캐릭터 챗 플랫폼 API - CAVEDUCK 스타일",
        "version": "2.0.0",
        "philosophy": "Chat First, Story Later",
        "docs": "/docs",
        "status": "running"
    }


@app.get("/health")
async def health_check():
    """헬스 체크 엔드포인트"""
    return {
        "status": "healthy",
        "environment": settings.ENVIRONMENT,
        "database": "connected",
        "focus": "AI 채팅 최우선"
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

