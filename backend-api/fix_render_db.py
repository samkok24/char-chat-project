"""
Render PostgreSQL에 누락된 컬럼 추가 (로컬에서 실행)
"""
import asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

RENDER_DB_URL = "postgresql+asyncpg://char:7Ty0OqHIKkKMDMU36ie4y58ogdGDzDsv@dpg-d39a2b8dl3ps73anim7g-a.oregon-postgres.render.com/char_chat"

async def fix():
    engine = create_async_engine(RENDER_DB_URL)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    async with async_session() as session:
        print('🔄 컬럼 추가 시작...')
        
        # users 테이블
        await session.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS gender VARCHAR(10) DEFAULT 'male'"))
        await session.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE"))
        await session.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(500)"))
        await session.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS bio VARCHAR(1000)"))
        await session.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_model VARCHAR(50) DEFAULT 'gemini'"))
        await session.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_sub_model VARCHAR(50) DEFAULT 'gemini-2.5-pro'"))
        await session.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS response_length_pref VARCHAR(10) DEFAULT 'medium'"))
        print('✅ users 완료')
        
        # stories 테이블
        await session.execute(text("ALTER TABLE stories ADD COLUMN IF NOT EXISTS is_origchat BOOLEAN DEFAULT FALSE"))
        await session.execute(text("ALTER TABLE stories ADD COLUMN IF NOT EXISTS cover_url VARCHAR(500)"))
        print('✅ stories 완료')
        
        # characters 테이블 ⚠️ greeting 추가!
        await session.execute(text("ALTER TABLE characters ADD COLUMN IF NOT EXISTS comment_count INTEGER DEFAULT 0"))
        await session.execute(text("ALTER TABLE characters ADD COLUMN IF NOT EXISTS source_type VARCHAR(20) DEFAULT 'ORIGINAL'"))
        await session.execute(text("ALTER TABLE characters ADD COLUMN IF NOT EXISTS speech_style TEXT"))
        await session.execute(text("ALTER TABLE characters ADD COLUMN IF NOT EXISTS greeting TEXT"))
        await session.execute(text("ALTER TABLE characters ADD COLUMN IF NOT EXISTS greetings JSONB"))
        await session.execute(text("ALTER TABLE characters ADD COLUMN IF NOT EXISTS world_setting TEXT"))
        await session.execute(text("ALTER TABLE characters ADD COLUMN IF NOT EXISTS user_display_description TEXT"))
        await session.execute(text("ALTER TABLE characters ADD COLUMN IF NOT EXISTS use_custom_description BOOLEAN DEFAULT FALSE"))
        await session.execute(text("ALTER TABLE characters ADD COLUMN IF NOT EXISTS introduction_scenes JSONB"))
        await session.execute(text("ALTER TABLE characters ADD COLUMN IF NOT EXISTS character_type VARCHAR(50) DEFAULT 'roleplay'"))
        await session.execute(text("ALTER TABLE characters ADD COLUMN IF NOT EXISTS base_language VARCHAR(10) DEFAULT 'ko'"))
        await session.execute(text("ALTER TABLE characters ADD COLUMN IF NOT EXISTS image_descriptions JSONB"))
        await session.execute(text("ALTER TABLE characters ADD COLUMN IF NOT EXISTS voice_settings JSONB"))
        await session.execute(text("ALTER TABLE characters ADD COLUMN IF NOT EXISTS has_affinity_system BOOLEAN DEFAULT FALSE"))
        await session.execute(text("ALTER TABLE characters ADD COLUMN IF NOT EXISTS affinity_rules TEXT"))
        await session.execute(text("ALTER TABLE characters ADD COLUMN IF NOT EXISTS affinity_stages JSONB"))
        await session.execute(text("ALTER TABLE characters ADD COLUMN IF NOT EXISTS custom_module_id UUID"))
        await session.execute(text("ALTER TABLE characters ADD COLUMN IF NOT EXISTS use_translation BOOLEAN DEFAULT TRUE"))
        await session.execute(text("ALTER TABLE characters ADD COLUMN IF NOT EXISTS origin_story_id UUID"))
        print('✅ characters 완료')
        
        # character_settings 테이블
        await session.execute(text("ALTER TABLE character_settings ADD COLUMN IF NOT EXISTS custom_prompt_template TEXT"))
        await session.execute(text("ALTER TABLE character_settings ADD COLUMN IF NOT EXISTS use_memory BOOLEAN DEFAULT TRUE"))
        await session.execute(text("ALTER TABLE character_settings ADD COLUMN IF NOT EXISTS memory_length INTEGER DEFAULT 20"))
        await session.execute(text("ALTER TABLE character_settings ADD COLUMN IF NOT EXISTS response_style VARCHAR(50) DEFAULT 'natural'"))
        print('✅ character_settings 완료')
        
        # story_chapters 테이블
        await session.execute(text("ALTER TABLE story_chapters ADD COLUMN IF NOT EXISTS view_count INTEGER DEFAULT 0"))
        print('✅ story_chapters 완료')
        
        # chat_rooms 테이블
        await session.execute(text("ALTER TABLE chat_rooms ADD COLUMN IF NOT EXISTS session_id VARCHAR(100)"))
        print('✅ chat_rooms 완료')
        
        # agent_contents 테이블
        await session.execute(text("ALTER TABLE agent_contents ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT FALSE"))
        await session.execute(text("ALTER TABLE agent_contents ADD COLUMN IF NOT EXISTS published_at TIMESTAMP WITH TIME ZONE"))
        print('✅ agent_contents 완료')
        
        await session.commit()
        print('🎉 모든 컬럼 추가 완료!')

if __name__ == "__main__":
    asyncio.run(fix())