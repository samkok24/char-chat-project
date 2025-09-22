import asyncio
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
import sys

sys.path.append('/app')

from app.core.database import AsyncSessionLocal
from app.models.tag import Tag, CharacterTag


async def main():
    async with AsyncSessionLocal() as db:  # type: AsyncSession
        # 1) cover: 로 시작하는 Tag 전부 조회
        rows = await db.execute(select(Tag).where(Tag.slug.like('cover:%')))
        bad_tags = rows.scalars().all()
        if not bad_tags:
            print('No cover: tags found')
            return
        bad_ids = [t.id for t in bad_tags]
        # 2) 캐릭터 연결 제거
        await db.execute(delete(CharacterTag).where(CharacterTag.tag_id.in_(bad_ids)))
        # 3) 태그 삭제
        await db.execute(delete(Tag).where(Tag.id.in_(bad_ids)))
        await db.commit()
        print(f'Removed {len(bad_ids)} cover: tags')


if __name__ == '__main__':
    asyncio.run(main())


