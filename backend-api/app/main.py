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
# from app.api.generation import router as generation_router # ✨ 신규: 생성 API (임시 비활성화)
from app.api.users import router as users_router
from app.api.story_importer import router as story_importer_router # ✨ 신규: 스토리 임포터 API
from app.api.rankings import router as rankings_router
import os
try:
    from apscheduler.schedulers.asyncio import AsyncIOScheduler
    _aps_available = True
except Exception:  # ModuleNotFoundError 등
    AsyncIOScheduler = None  # type: ignore
    _aps_available = False
from app.services.ranking_service import build_daily_ranking, persist_daily_ranking, today_kst
from app.core.database import AsyncSessionLocal
from app.api.story_chapters import router as story_chapters_router  # 📚 회차 API
from app.api.memory_notes import router as memory_notes_router
from app.api.user_personas import router as user_personas_router # ✨ 신규: 기억노트 API
from app.api.stories import router as stories_router    # ⏳ 나중에: 스토리 API (차별점)
from app.api.payment import router as payment_router    # ⏳ 나중에: 결제 API (단순화 예정)
from app.api.point import router as point_router        # ⏳ 나중에: 포인트 API (단순화 예정)
from app.api.files import router as files_router
from app.api.tags import router as tags_router
from app.models.tag import Tag
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
            
            # 전역 태그 시드
            try:
                seed_tags = [
                    # 기본
                    '남성','여성','시뮬레이터','스토리','어시스턴트','관계',
                    # 관계
                    '남자친구','여자친구','연인','플러팅','친구','첫사랑','짝사랑','동거','연상','연하','애증','소꿉친구','가족','육성','순애','구원','후회','복수','소유욕','참교육','중년',
                    # 장르
                    '로맨스','판타지','현대판타지','이세계','느와르','코미디','힐링','액션','공포','모험','조난','재난','방탈출','던전','역사','신화','SF','무협','동양풍','서양풍','TS물','BL','백합','정치물','일상','현대','변신','고스','미스터리',
                    # 설정
                    '다수 인물','아카데미','학원물','일진','기사','황제','마법사','귀족','탐정','괴물','오피스','메이드','집사','밀리터리','버튜버','근육','빙의','비밀','스포츠','수영복','LGBTQ+','톰보이','마피아','헌터','베어','제복','경영','배틀','속박',
                    # 성향/성격
                    '성향','츤데레','쿨데레','얀데레','다정','순정','능글','히어로/히로인','빌런','음침','소심','햇살','까칠','무뚝뚝',
                    # 메타/출처
                    '메타','자캐','게임','애니메이션','영화 & 티비','책','유명인','코스프레','동화',
                    # 종족
                    '종족','천사','악마','요정','귀신','엘프','오크','몬무스','뱀파이어','외계인','로봇','동물',
                ]

                for name in seed_tags:
                    try:
                        # slug는 한국어 그대로 사용 (Unique)
                        await conn.exec_driver_sql(
                            "INSERT INTO tags (name, slug) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM tags WHERE slug = ?)",
                            (name, name, name)
                        )
                    except Exception as e:
                        logger.debug(f"태그 시드 중복/오류 무시: {name} ({e})")
                logger.info("🏷️ 전역 태그 시드 완료")
            except Exception as e:
                logger.warning(f"태그 시드 중 경고: {e}")
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
# app.include_router(generation_router, prefix="/generate", tags=["✨ 생성 (신규)"])  # 임시 비활성화
app.include_router(story_importer_router, prefix="/story-importer", tags=["✨ 스토리 임포터 (신규)"])
app.include_router(memory_notes_router, prefix="/memory-notes", tags=["✨ 기억노트 (신규)"])
app.include_router(user_personas_router, prefix="/user-personas", tags=["👤 유저 페르소나 (신규)"])
app.include_router(files_router, prefix="/files", tags=["🗂️ 파일"])
app.include_router(tags_router, prefix="/tags", tags=["🏷️ 태그"])


# ⏳ Phase 3: 콘텐츠 확장 API (향후 개발)
app.include_router(stories_router, prefix="/stories", tags=["📚 스토리"])
app.include_router(story_chapters_router, prefix="/chapters", tags=["📚 회차"])
app.include_router(rankings_router, prefix="/rankings", tags=["🏆 랭킹"])

# ---- Scheduler: 00:00 KST daily snapshot ----
SCHED_ENABLED = os.getenv('RANKING_SCHEDULER_ENABLED', '0') == '1'
scheduler = AsyncIOScheduler() if (SCHED_ENABLED and _aps_available) else None

@app.on_event("startup")
async def _start_scheduler():
    if scheduler and not scheduler.running:
        scheduler.start()
        scheduler.add_job(_snapshot_daily_ranking_job, 'cron', hour=0, minute=0, timezone='Asia/Seoul')
        logger.info("⏰ 일일 랭킹 스냅샷 스케줄러 활성화 (00:00 KST)")

async def _snapshot_daily_ranking_job():
    async with AsyncSessionLocal() as db:
        data = await build_daily_ranking(db)
        await persist_daily_ranking(db, today_kst(), data)
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

