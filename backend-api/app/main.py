"""
AI 캐릭터 챗 플랫폼 - FastAPI 메인 애플리케이션
CAVEDUCK 스타일: "Chat First, Story Later"
"""

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import ResponseValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from urllib.parse import urlparse
from contextlib import asynccontextmanager
import logging
import os
from app.core.config import settings
from app.core.database import engine, Base
from app.core.paths import get_upload_dir
from sqlalchemy import text

# API 라우터 임포트 (우선순위 순서)
from app.api.chat import router as chat_router          # 🔥 최우선: 채팅 API
from app.api.chat_read import router as chat_read_router  # 📖 채팅 읽음 상태 (분리)
from app.api.auth import router as auth_router          # ✅ 필수: 인증 API  
from app.api.characters import router as characters_router  # ✅ 필수: 캐릭터 API
# from app.api.generation import router as generation_router # ✨ 신규: 생성 API (임시 비활성화)
from app.api.users import router as users_router
from app.api.story_importer import router as story_importer_router # ✨ 신규: 스토리 임포터 API
from app.api.rankings import router as rankings_router
from app.api.media import router as media_router
from app.api.storydive import router as storydive_router  # 🏊 스토리 다이브
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
from app.api.metrics import router as metrics_router
from app.api.agent_contents import router as agent_contents_router  # 내 서랍 API
from app.api.notices import router as notices_router  # 📢 공지사항
from app.api.faqs import router as faqs_router  # ❓ FAQ
from app.api.faq_categories import router as faq_categories_router  # ❓ FAQ 카테고리
from app.api.cms import router as cms_router  # 🧩 CMS(홈 배너/구좌 설정)
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

        # ✅ 공지사항 테이블은 운영에서도 필요(신규 기능)하므로, 테이블만 멱등 생성한다.
        # - 기존 create_all을 운영에서 전부 돌리지는 않되, notices 테이블이 없으면 기능이 즉시 깨지므로 방어적으로 보강.
        try:
            from app.models.notice import Notice  # 로컬 import(순환 방지)
            await conn.run_sync(lambda c: Notice.__table__.create(c, checkfirst=True))
            logger.info("📢 notices 테이블 확인/생성 완료")
        except Exception as e:
            logger.warning(f"[warn] notices 테이블 생성 실패(계속 진행): {e}")

        # ✅ FAQ 테이블도 운영에서 필요(신규 기능)하므로, 테이블만 멱등 생성한다.
        try:
            from app.models.faq import FAQItem  # 로컬 import(순환 방지)
            await conn.run_sync(lambda c: FAQItem.__table__.create(c, checkfirst=True))
            logger.info("❓ faq_items 테이블 확인/생성 완료")
        except Exception as e:
            logger.warning(f"[warn] faq_items 테이블 생성 실패(계속 진행): {e}")

        # ✅ FAQ 카테고리 테이블도 운영에서 필요(신규 기능)하므로, 테이블만 멱등 생성한다.
        try:
            from app.models.faq_category import FAQCategory  # 로컬 import(순환 방지)
            await conn.run_sync(lambda c: FAQCategory.__table__.create(c, checkfirst=True))
            logger.info("❓ faq_categories 테이블 확인/생성 완료")
        except Exception as e:
            logger.warning(f"[warn] faq_categories 테이블 생성 실패(계속 진행): {e}")

        # ✅ CMS 설정 테이블(홈 배너/구좌)은 운영에서 전 유저 공통 노출에 필요하므로 멱등 생성한다.
        try:
            from app.models.site_config import SiteConfig  # 로컬 import(순환 방지)
            await conn.run_sync(lambda c: SiteConfig.__table__.create(c, checkfirst=True))
            logger.info("🧩 site_configs 테이블 확인/생성 완료")
        except Exception as e:
            logger.warning(f"[warn] site_configs 테이블 생성 실패(계속 진행): {e}")

        # ✅ 선호작(스토리 좋아요) 기능은 운영에서도 필요하므로, story_likes 테이블을 멱등 생성한다.
        # - 운영에선 Base.metadata.create_all을 전체로 돌리지 않기 때문에, 테이블 누락 시 500(UndefinedTableError)이 날 수 있다.
        # - checkfirst=True로 이미 존재하면 아무 작업도 하지 않는다.
        try:
            from app.models.like import StoryLike  # 로컬 import(순환 방지)
            await conn.run_sync(lambda c: StoryLike.__table__.create(c, checkfirst=True))
            logger.info("💗 story_likes 테이블 확인/생성 완료")
        except Exception as e:
            logger.warning(f"[warn] story_likes 테이블 생성 실패(계속 진행): {e}")

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
    
    # ✅ FAQ 기본 데이터 시드(테이블이 비어 있을 때만 1회)
    # - FAQ는 운영에서도 노출되는 페이지이므로, 초기 데이터가 없으면 UX가 급격히 나빠진다.
    # - 실패해도 서비스는 계속 진행(방어적).
    try:
        from app.api.faq_categories import seed_default_faq_categories_if_empty
        async with AsyncSessionLocal() as _db:
            inserted = await seed_default_faq_categories_if_empty(_db)
        if inserted:
            logger.info(f"❓ FAQ 카테고리 기본 데이터 시드 완료: {inserted}건")
    except Exception as e:
        logger.warning(f"[warn] FAQ 카테고리 시드 실패(계속 진행): {e}")

    try:
        from app.api.faqs import seed_default_faqs_if_empty
        async with AsyncSessionLocal() as _db:
            inserted = await seed_default_faqs_if_empty(_db)
        if inserted:
            logger.info(f"❓ FAQ 기본 데이터 시드 완료: {inserted}건")
    except Exception as e:
        logger.warning(f"[warn] FAQ 시드 실패(계속 진행): {e}")

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
# 프로덕션 배포 시 프론트엔드 공개 도메인을 명시적으로 허용 (환경변수 또는 설정)
FRONTEND_BASE_URL = os.getenv("FRONTEND_BASE_URL") or settings.FRONTEND_BASE_URL
if settings.ENVIRONMENT != "development" and FRONTEND_BASE_URL:
    try:
        # 중복 추가 방지
        if FRONTEND_BASE_URL not in ALLOWED_ORIGINS:
            ALLOWED_ORIGINS.append(FRONTEND_BASE_URL)
    except Exception:
        pass
# 환경변수로 CORS 정규식을 오버라이드할 수 있도록 허용 (예: ".*" 또는 특정 도메인 패턴)
_env_cors_regex = os.getenv("ALLOW_ORIGIN_REGEX")
if _env_cors_regex:
    ALLOWED_ORIGIN_REGEX = _env_cors_regex
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=ALLOWED_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 신뢰할 수 있는 호스트 설정 (선택사항)
# - Render 전용 하드코딩(*.onrender.com)만 허용하면 VPS/Lightsail 배포에서 도메인 Host 헤더가 400으로 막힐 수 있음
# - 기본적으로 FRONTEND_BASE_URL의 hostname을 허용하고, 필요 시 TRUSTED_HOSTS env로 추가 가능
if settings.ENVIRONMENT == "production":
    allowed_hosts = ["localhost", "127.0.0.1"]
    try:
        _u = urlparse(FRONTEND_BASE_URL)
        if _u.hostname:
            allowed_hosts.append(_u.hostname)
            # www 도메인도 자동 허용
            if not _u.hostname.startswith("www."):
                allowed_hosts.append(f"www.{_u.hostname}")
    except Exception:
        pass
    # ✅ 운영(Docker) 내부 통신 호스트도 허용 (채팅서버→백엔드 /auth/me 등)
    # - chat-server는 docker 네트워크에서 BACKEND_API_URL=http://backend:8000 으로 호출하므로 Host=backend 로 들어온다.
    # - TrustedHostMiddleware가 이를 막으면 소켓 인증이 실패하며, 모바일/신규 세션에서 "사용자 정보를 확인할 수 없습니다"로 무한 로딩이 발생할 수 있다.
    # - 외부에 8000 포트를 공개하지 않는 구성(권장)에서는 보안 리스크가 크지 않다.
    try:
        internal_hosts = [
            # docker compose service names
            "backend",
            "chat-server",
            "frontend",
            "nginx",
            "redis",
            # docker container_name aliases(설정에 따라 DNS로 잡히는 경우 대비)
            "chapter8_backend",
            "chapter8_socket",
            "chapter8_frontend",
            "chapter8_nginx",
            "chapter8_redis",
        ]
        for h in internal_hosts:
            if h and h not in allowed_hosts:
                allowed_hosts.append(h)
    except Exception:
        pass
    _extra_hosts = os.getenv("TRUSTED_HOSTS")  # comma-separated
    if _extra_hosts:
        allowed_hosts.extend([h.strip() for h in _extra_hosts.split(",") if h.strip()])

    app.add_middleware(TrustedHostMiddleware, allowed_hosts=allowed_hosts)


# 라우터 등록 (CAVEDUCK 스타일 우선순위)
# 🔥 Phase 4: 채팅 중심 API (최우선 완성)
app.include_router(chat_router, prefix="/chat", tags=["🔥 채팅 (최우선)"])
app.include_router(chat_read_router, tags=["📖 채팅 읽음 상태"])
app.include_router(auth_router, prefix="/auth", tags=["✅ 인증 (필수)"])
app.include_router(characters_router, prefix="/characters", tags=["✅ 캐릭터 (필수)"])
app.include_router(users_router, prefix="", tags=["✅ 유저 (필수)"])  # prefix 없음 - /users/{id} 형태
# app.include_router(generation_router, prefix="/generate", tags=["✨ 생성 (신규)"])  # 임시 비활성화
app.include_router(story_importer_router, prefix="/story-importer", tags=["✨ 스토리 임포터 (신규)"])
app.include_router(memory_notes_router, prefix="/memory-notes", tags=["✨ 기억노트 (신규)"])
app.include_router(user_personas_router, prefix="/user-personas", tags=["👤 유저 페르소나 (신규)"])
app.include_router(agent_contents_router, prefix="/agent/contents", tags=["📦 에이전트 콘텐츠 (내 서랍)"])
app.include_router(storydive_router, prefix="/storydive", tags=["🏊 스토리 다이브"])
app.include_router(files_router, prefix="/files", tags=["🗂️ 파일"])
app.include_router(tags_router, prefix="/tags", tags=["🏷️ 태그"])
app.include_router(media_router, prefix="/media", tags=["🖼️ 미디어"])
app.include_router(metrics_router, prefix="/metrics", tags=["📈 메트릭 (임시)"])
app.include_router(notices_router, prefix="/notices", tags=["📢 공지사항"])
app.include_router(faqs_router, prefix="/faqs", tags=["❓ FAQ"])
app.include_router(faq_categories_router, prefix="/faq-categories", tags=["❓ FAQ 카테고리"])
app.include_router(cms_router, prefix="/cms", tags=["🧩 CMS 설정"])


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


@app.exception_handler(ResponseValidationError)
async def response_validation_error_handler(request, exc: ResponseValidationError):
    """
    응답 스키마 검증 실패(ResponseValidationError) 로깅 강화.

    배경/의도:
    - FastAPI가 응답을 `response_model`로 직렬화하는 과정에서 ORM lazy-load/타입 불일치 등이 있으면
      ResponseValidationError가 발생한다.
    - 운영/개발에서 `str(exc)`가 깨지면서(`<exception str() failed>`) 로그가 손실되는 케이스가 있어,
      반드시 `exc.errors()`를 남겨 원인 파악이 가능하도록 한다.
    """
    try:
        path = getattr(request.url, "path", None) or str(getattr(request, "url", ""))
        method = getattr(request, "method", "")
        # errors() 자체가 예외일 수도 있으므로 방어
        try:
            errs = exc.errors()
        except Exception as e:
            errs = [{"type": "errors_failed", "msg": str(e)}]
        logger.exception(f"[ResponseValidationError] {method} {path} errors={errs}")
    except Exception:
        # 최후 방어: 로깅 실패가 서버를 더 망가뜨리지 않도록
        pass
    return JSONResponse(status_code=500, content={"detail": "response_validation_error"})


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