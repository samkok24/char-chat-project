"""
Render PostgreSQL의 story_cards 타입 확인
"""
import asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

RENDER_DB_URL = "postgresql+asyncpg://char:7Ty0OqHIKkKMDMU36ie4y58ogdGDzDsv@dpg-d39a2b8dl3ps73anim7g-a.oregon-postgres.render.com/char_chat"

async def check():
    engine = create_async_engine(RENDER_DB_URL)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    async with async_session() as session:
        result = await session.execute(text("""
            SELECT 
                id, 
                title, 
                pg_typeof(story_cards) as type,
                story_cards::text as raw_value
            FROM novels
            LIMIT 1
        """))
        row = result.fetchone()
        if row:
            print(f"📊 Novel: {row[1]}")
            print(f"📌 PostgreSQL Type: {row[2]}")
            print(f"📄 Raw Value (first 200 chars): {row[3][:200]}")
            print(f"📝 Value Type: {type(row[3])}")

if __name__ == "__main__":
    asyncio.run(check())

