"""
Render PostgreSQL의 novels 테이블 데이터 확인
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
        result = await session.execute(text('SELECT COUNT(*) FROM novels'))
        count = result.scalar()
        print(f'📊 Render DB - novels 테이블: {count}건')
        
        result = await session.execute(text('SELECT id, title FROM novels'))
        novels = result.fetchall()
        for novel in novels:
            print(f'  - {novel[1]} (ID: {novel[0]})')

if __name__ == "__main__":
    asyncio.run(check())

