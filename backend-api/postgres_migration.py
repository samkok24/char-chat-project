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


async def run_migrations():
    """마이그레이션 실행"""
    try:
        async with AsyncSessionLocal() as db:
            print("=" * 60)
            print("🔄 PostgreSQL 마이그레이션 시작...")
            print("=" * 60)
            logger.info("🔄 PostgreSQL 마이그레이션 시작...")
            
            for table, columns in COLUMNS_TO_ADD.items():
                print(f"\n📋 '{table}' 테이블 처리 중...")
                for col_name, col_def in columns:
                    try:
                        sql = f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {col_name} {col_def}"
                        await db.execute(text(sql))
                        print(f"  ✅ {col_name}")
                        logger.info(f"✅ {table}.{col_name} 추가 완료")
                    except Exception as e:
                        print(f"  ⚠️  {col_name}: {e}")
                        logger.warning(f"⚠️  {table}.{col_name}: {e}")
            
            await db.commit()
            print("\n" + "=" * 60)
            print("🎉 모든 마이그레이션 완료!")
            print("=" * 60)
            logger.info("🎉 모든 마이그레이션 완료!")
            
    except Exception as e:
        print(f"\n❌ 마이그레이션 실패: {e}")
        logger.error(f"❌ 마이그레이션 실패: {e}")
        # 에러가 나도 앱은 계속 실행되도록


if __name__ == "__main__":
    asyncio.run(run_migrations())