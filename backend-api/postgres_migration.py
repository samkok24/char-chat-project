"""
PostgreSQL 자동 마이그레이션 스크립트
앱 시작 시 자동으로 누락된 컬럼 추가
"""
import asyncio
import logging
from sqlalchemy import text
from app.core.database import AsyncSessionLocal

logger = logging.getLogger(__name__)

# 추가해야 할 컬럼들만 (테이블은 SQLAlchemy가 자동 생성)
COLUMNS_TO_ADD = {
    "users": [
        ("gender", "VARCHAR(10) DEFAULT 'male'"),
        ("is_admin", "BOOLEAN DEFAULT FALSE"),
        ("avatar_url", "VARCHAR(500)"),
        ("bio", "VARCHAR(1000)"),
        ("preferred_model", "VARCHAR(50) DEFAULT 'gemini'"),
        ("preferred_sub_model", "VARCHAR(50) DEFAULT 'gemini-2.5-pro'"),
        ("response_length_pref", "VARCHAR(10) DEFAULT 'medium'"),
    ],
    "stories": [
        ("is_origchat", "BOOLEAN DEFAULT FALSE"),
        ("cover_url", "VARCHAR(500)"),
        # ✅ 작품공지(작가 공지): JSONB 배열
        # - Postgres 11+에서는 default 추가가 메타데이터 최적화로 빠르게 적용된다.
        ("announcements", "JSONB DEFAULT '[]'::jsonb"),
    ],
    "characters": [
        ("comment_count", "INTEGER DEFAULT 0"),
        ("source_type", "VARCHAR(20) DEFAULT 'ORIGINAL'"),
        ("speech_style", "TEXT"),
        ("greeting", "TEXT"),
        ("greetings", "JSONB"),
        ("world_setting", "TEXT"),
        ("user_display_description", "TEXT"),
        ("use_custom_description", "BOOLEAN DEFAULT FALSE"),
        ("introduction_scenes", "JSONB"),
        # ✅ start_sets: 오프닝(시작 세트) JSON 저장소 — v0.9에서 추가
        ("start_sets", "JSONB"),
        ("character_type", "VARCHAR(50) DEFAULT 'roleplay'"),
        ("base_language", "VARCHAR(10) DEFAULT 'ko'"),
        ("image_descriptions", "JSONB"),
        ("voice_settings", "JSONB"),
        ("has_affinity_system", "BOOLEAN DEFAULT FALSE"),
        ("affinity_rules", "TEXT"),
        ("affinity_stages", "JSONB"),
        ("custom_module_id", "UUID"),
        ("use_translation", "BOOLEAN DEFAULT TRUE"),
        ("origin_story_id", "UUID"),
    ],
    "character_settings": [
        ("custom_prompt_template", "TEXT"),
        ("use_memory", "BOOLEAN DEFAULT TRUE"),
        ("memory_length", "INTEGER DEFAULT 20"),
        ("response_style", "VARCHAR(50) DEFAULT 'natural'"),
    ],
    "story_chapters": [
        ("view_count", "INTEGER DEFAULT 0"),
    ],
    "chat_rooms": [
        ("session_id", "VARCHAR(100)"),
    ],
    "agent_contents": [
        ("is_published", "BOOLEAN DEFAULT FALSE"),
        ("published_at", "TIMESTAMP WITH TIME ZONE"),
    ],
}



# 누락된 테이블 멱등 생성 (IF NOT EXISTS)
TABLES_TO_CREATE = [
    # 무료 리필 버킷 상태 (타이머)
    """
    CREATE TABLE IF NOT EXISTS user_refill_states (
        user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        timer_bucket INTEGER NOT NULL DEFAULT 0
            CONSTRAINT check_timer_bucket_non_negative CHECK (timer_bucket >= 0)
            CONSTRAINT check_timer_bucket_max_15 CHECK (timer_bucket <= 15),
        timer_last_refill_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
    """,
    # 회차 구매 기록
    """
    CREATE TABLE IF NOT EXISTS chapter_purchases (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
        chapter_no INTEGER NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        CONSTRAINT uq_user_story_chapter UNIQUE (user_id, story_id, chapter_no)
    )
    """,
    # 구독 플랜 정의
    """
    CREATE TABLE IF NOT EXISTS subscription_plans (
        id VARCHAR(20) PRIMARY KEY,
        name VARCHAR(50) NOT NULL,
        price INTEGER NOT NULL DEFAULT 0,
        monthly_ruby INTEGER DEFAULT 0,
        refill_speed_multiplier INTEGER DEFAULT 1,
        free_chapters BOOLEAN DEFAULT FALSE,
        model_discount_pct INTEGER DEFAULT 0,
        sort_order INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
    """,
    # 사용자 구독 상태
    """
    CREATE TABLE IF NOT EXISTS user_subscriptions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        plan_id VARCHAR(20) NOT NULL REFERENCES subscription_plans(id),
        status VARCHAR(20) DEFAULT 'active',
        started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        expires_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        CONSTRAINT uq_user_subscriptions_user_id UNIQUE (user_id)
    )
    """,
]

# 테이블 생성 후 실행할 인덱스/시드
# - index 생성 실패는 성능 이슈(비치명), seed 실패는 결제/구독 기능 영향(치명)
POST_TABLE_SQLS = [
    {
        "sql": "CREATE INDEX IF NOT EXISTS idx_chapter_purchases_user ON chapter_purchases(user_id)",
        "label": "idx_chapter_purchases_user",
        "critical": False,
    },
    {
        "sql": "CREATE INDEX IF NOT EXISTS idx_chapter_purchases_story ON chapter_purchases(story_id)",
        "label": "idx_chapter_purchases_story",
        "critical": False,
    },
    {
        "sql": "CREATE INDEX IF NOT EXISTS idx_user_subscriptions_plan ON user_subscriptions(plan_id)",
        "label": "idx_user_subscriptions_plan",
        "critical": False,
    },
    # 구독 플랜 시드 데이터
    {
        "sql": """
        INSERT INTO subscription_plans (id, name, price, monthly_ruby, refill_speed_multiplier, free_chapters, model_discount_pct, sort_order)
        VALUES
            ('free',    '무료',      0,     0,   1, FALSE, 0,  0),
            ('basic',   '베이직',    9900,  150, 2, TRUE,  10, 1),
            ('premium', '프리미엄',  29900, 500, 4, TRUE,  30, 2)
        ON CONFLICT (id) DO NOTHING
        """,
        "label": "seed.subscription_plans",
        "critical": True,
    },
]


async def _exec_safe(db, sql_text, label="", *, critical=False, failures=None):
    """개별 SQL을 실행 + 커밋. 실패 시 rollback 후 계속 진행.

    PostgreSQL은 트랜잭션 내에서 하나라도 실패하면 세션이 aborted 상태가 되어
    이후 모든 SQL이 InFailedSqlTransaction으로 실패한다.
    따라서 각 DDL을 개별 커밋 단위로 분리해야 한다.
    """
    try:
        await db.execute(text(sql_text))
        await db.commit()
        if label:
            print(f"  ✅ {label}")
        return True
    except Exception as e:
        await db.rollback()
        short = str(e).split('\n')[0][:120]
        if failures is not None:
            failures.append({
                "label": label or "(unknown)",
                "error": short,
                "critical": critical,
            })
        if label:
            print(f"  ⚠️  {label}: {short}")
        if critical:
            logger.error(f"⚠️  [critical] {label}: {short}")
        else:
            logger.warning(f"⚠️  {label}: {short}")
        return False


async def run_migrations():
    """마이그레이션 실행"""
    try:
        async with AsyncSessionLocal() as db:
            failures = []
            print("=" * 60)
            print("🔄 PostgreSQL 마이그레이션 시작...")
            print("=" * 60)
            logger.info("🔄 PostgreSQL 마이그레이션 시작...")

            # ── 테이블 멱등 생성 (각각 개별 커밋) ──
            for ddl in TABLES_TO_CREATE:
                # DDL 첫 줄에서 테이블명 추출해서 로그에 활용
                label = ddl.strip().split('\n')[0].strip()
                await _exec_safe(db, ddl, label, critical=True, failures=failures)
            print("📋 누락 테이블 확인/생성 완료")

            # ── 인덱스 + 시드 (각각 개별 커밋) ──
            for spec in POST_TABLE_SQLS:
                sql = spec["sql"]
                label = spec["label"]
                critical = spec["critical"]
                await _exec_safe(db, sql, label, critical=critical, failures=failures)
            print("📋 인덱스/시드 확인 완료")

            # ── 컬럼 추가 (각각 개별 커밋) ──
            for table, columns in COLUMNS_TO_ADD.items():
                print(f"\n📋 '{table}' 테이블 처리 중...")
                for col_name, col_def in columns:
                    sql = f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {col_name} {col_def}"
                    await _exec_safe(
                        db,
                        sql,
                        f"{table}.{col_name}",
                        critical=True,
                        failures=failures,
                    )

            critical_failures = [f for f in failures if f["critical"]]
            noncritical_failures = [f for f in failures if not f["critical"]]
            if failures:
                print("\n⚠️  마이그레이션 실패 요약")
                for f in failures:
                    level = "CRITICAL" if f["critical"] else "WARN"
                    print(f"  - [{level}] {f['label']}: {f['error']}")
                logger.warning(
                    f"⚠️  마이그레이션 경고: total={len(failures)}, "
                    f"critical={len(critical_failures)}, warn={len(noncritical_failures)}"
                )
            if critical_failures:
                raise RuntimeError(
                    f"critical migration failed: {len(critical_failures)} (see logs)"
                )

            print("\n" + "=" * 60)
            print("🎉 모든 마이그레이션 완료!")
            print("=" * 60)
            logger.info("🎉 모든 마이그레이션 완료!")

    except Exception as e:
        print(f"\n❌ 마이그레이션 실패: {e}")
        logger.error(f"❌ 마이그레이션 실패: {e}")
        raise


if __name__ == "__main__":
    asyncio.run(run_migrations())
