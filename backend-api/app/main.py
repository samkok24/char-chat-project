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
from app.core.paths import get_upload_dir
from sqlalchemy import text

# API 라우터 임포트 (우선순위 순서)
from app.api.chat import router as chat_router          # 🔥 최우선: 채팅 API
from app.api.auth import router as auth_router          # ✅ 필수: 인증 API  
from app.api.characters import router as characters_router  # ✅ 필수: 캐릭터 API
from app.api.users import router as users_router
from app.api.story_importer import router as story_importer_router # ✨ 신규: 스토리 임포터 API
from app.api.memory_notes import router as memory_notes_router
from app.api.user_personas import router as user_personas_router # ✨ 신규: 기억노트 API
from app.api.stories import router as stories_router    # ⏳ 나중에: 스토리 API (차별점)
from app.api.payment import router as payment_router    # ⏳ 나중에: 결제 API (단순화 예정)
from app.api.point import router as point_router        # ⏳ 나중에: 포인트 API (단순화 예정)
from app.api.files import router as files_router
from app.api.tags import router as tags_router
# 로깅 설정
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """애플리케이션 시작/종료 시 실행되는 이벤트"""
    # 시작 시
    logger.info("🚀 AI 캐릭터 챗 플랫폼 시작 (CAVEDUCK 스타일)")
    
    # 데이터베이스 테이블 생성 (개발용)
    async with engine.begin() as conn:
        if settings.ENVIRONMENT == "development":
            await conn.run_sync(Base.metadata.create_all)
            logger.info("📊 데이터베이스 테이블 생성 완료")

        # SQLite 사용 시 누락 컬럼 자동 보정 (idempotent)
        try:
            if settings.DATABASE_URL.startswith("sqlite"):
                # users 테이블 컬럼 확인
                result = await conn.exec_driver_sql("PRAGMA table_info(users)")
                cols = {row[1] for row in result.fetchall()}  # row[1] == column name
                if "avatar_url" not in cols:
                    await conn.exec_driver_sql("ALTER TABLE users ADD COLUMN avatar_url TEXT")
                    logger.info("🛠️ users.avatar_url 컬럼 추가")
                if "bio" not in cols:
                    await conn.exec_driver_sql("ALTER TABLE users ADD COLUMN bio TEXT")
                    logger.info("🛠️ users.bio 컬럼 추가")
                if "response_length_pref" not in cols:
                    await conn.exec_driver_sql("ALTER TABLE users ADD COLUMN response_length_pref TEXT DEFAULT 'medium'")
                    logger.info("🛠️ users.response_length_pref 컬럼 추가")

                # chat_rooms 테이블 컬럼 확인 (summary)
                result = await conn.exec_driver_sql("PRAGMA table_info(chat_rooms)")
                cols = {row[1] for row in result.fetchall()}
                if "summary" not in cols:
                    await conn.exec_driver_sql("ALTER TABLE chat_rooms ADD COLUMN summary TEXT")
                    logger.info("🛠️ chat_rooms.summary 컬럼 추가")

                # chat_messages 테이블 컬럼 확인 (upvotes/downvotes)
                result = await conn.exec_driver_sql("PRAGMA table_info(chat_messages)")
                cols = {row[1] for row in result.fetchall()}
                if "upvotes" not in cols:
                    await conn.exec_driver_sql("ALTER TABLE chat_messages ADD COLUMN upvotes INTEGER DEFAULT 0")
                    logger.info("🛠️ chat_messages.upvotes 컬럼 추가")
                if "downvotes" not in cols:
                    await conn.exec_driver_sql("ALTER TABLE chat_messages ADD COLUMN downvotes INTEGER DEFAULT 0")
                    logger.info("🛠️ chat_messages.downvotes 컬럼 추가")

                # 메시지 수정 이력 테이블 생성 (존재하지 않으면)
                await conn.exec_driver_sql(
                    """
                    CREATE TABLE IF NOT EXISTS chat_message_edits (
                      id TEXT PRIMARY KEY,
                      message_id TEXT NOT NULL,
                      user_id TEXT NOT NULL,
                      old_content TEXT NOT NULL,
                      new_content TEXT NOT NULL,
                      created_at TEXT DEFAULT (datetime('now')),
                      FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE,
                      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                    )
                    """
                )
                logger.info("📄 chat_message_edits 테이블 확인/생성 완료")
        except Exception as e:
            logger.warning(f"SQLite 컬럼 보정 중 경고: {e}")
    
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
UPLOAD_DIR = get_upload_dir()
app.mount("/static", StaticFiles(directory=UPLOAD_DIR), name="static")
# CORS 미들웨어 설정
# CORS: 개발 환경에선 프론트 도메인을 명시적으로 허용, 그 외 환경에서도 로컬 호스트는 정규식으로 허용
DEV_ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]
ALLOWED_ORIGINS = DEV_ALLOWED_ORIGINS if settings.ENVIRONMENT == "development" else []
ALLOWED_ORIGIN_REGEX = None if settings.ENVIRONMENT == "development" else r"https?://(localhost|127\.0\.0\.1)(:\\d+)?"
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=ALLOWED_ORIGIN_REGEX,
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
app.include_router(users_router, prefix="", tags=["✅ 유저 (필수)"])  # prefix 없음 - /users/{id} 형태
app.include_router(story_importer_router, prefix="/story-importer", tags=["✨ 스토리 임포터 (신규)"])
app.include_router(memory_notes_router, prefix="/memory-notes", tags=["✨ 기억노트 (신규)"])
app.include_router(user_personas_router, prefix="/user-personas", tags=["👤 유저 페르소나 (신규)"])
app.include_router(files_router, prefix="/files", tags=["🗂️ 파일"])
app.include_router(tags_router, prefix="/tags", tags=["🏷️ 태그"])


# ⏳ Phase 3: 콘텐츠 확장 API (향후 개발)
app.include_router(stories_router, prefix="/stories", tags=["📚 스토리"])
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

