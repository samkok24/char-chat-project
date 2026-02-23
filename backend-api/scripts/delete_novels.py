"""소설 데이터 삭제 스크립트"""
import asyncio
import sys
from pathlib import Path

project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from sqlalchemy import delete
from app.core.database import AsyncSessionLocal
from app.models.novel import Novel

async def delete_all_novels():
    async with AsyncSessionLocal() as db:
        await db.execute(delete(Novel))
        await db.commit()
        print("✅ 모든 소설 데이터가 삭제되었습니다.")

if __name__ == "__main__":
    asyncio.run(delete_all_novels())

