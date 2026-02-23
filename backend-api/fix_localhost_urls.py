"""
DB에 저장된 localhost:8000 URL을 상대 경로(/static/...)로 변환하는 스크립트

사용법:
  docker compose --env-file docker/.env.prod -f docker/docker-compose.yml exec backend python fix_localhost_urls.py

주의:
  - stories.cover_url
  - characters.avatar_url
  - media_assets.url
  에서 localhost:8000을 /static/...로 변환합니다.
"""
import asyncio
import os
import sys
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

# --- ensure import path: add backend-api root ---
ROOT_DIR = os.path.abspath(os.path.dirname(__file__))
PARENT_DIR = os.path.dirname(ROOT_DIR)
for p in [ROOT_DIR, PARENT_DIR]:
    if p not in sys.path:
        sys.path.insert(0, p)

from app.core.database import async_sessionmaker, engine
from app.models.story import Story
from app.models.character import Character
from app.models.media_asset import MediaAsset


def normalize_url(url: str) -> str:
    """localhost:8000 URL을 /static/...로 변환"""
    if not url:
        return url
    
    # http://localhost:8000/static/... -> /static/...
    if 'localhost:8000' in url or '127.0.0.1:8000' in url:
        # /static/... 부분만 추출
        if '/static/' in url:
            idx = url.find('/static/')
            return url[idx:]
        # http://localhost:8000/... 형태면 /...로 변환
        try:
            from urllib.parse import urlparse
            parsed = urlparse(url)
            return parsed.path + (f"?{parsed.query}" if parsed.query else "")
        except Exception:
            return url
    
    return url


async def fix_stories(session: AsyncSession) -> int:
    """stories.cover_url 수정"""
    rows = (await session.execute(select(Story.id, Story.cover_url))).all()
    fixed = 0
    for story_id, old_url in rows:
        if not old_url:
            continue
        new_url = normalize_url(old_url)
        if new_url != old_url:
            await session.execute(
                update(Story).where(Story.id == story_id).values(cover_url=new_url)
            )
            fixed += 1
            print(f"  [Story {story_id}] {old_url[:60]}... -> {new_url[:60]}...")
    await session.commit()
    return fixed


async def fix_characters(session: AsyncSession) -> int:
    """characters.avatar_url 수정"""
    rows = (await session.execute(select(Character.id, Character.avatar_url))).all()
    fixed = 0
    for char_id, old_url in rows:
        if not old_url:
            continue
        new_url = normalize_url(old_url)
        if new_url != old_url:
            await session.execute(
                update(Character).where(Character.id == char_id).values(avatar_url=new_url)
            )
            fixed += 1
            print(f"  [Character {char_id}] {old_url[:60]}... -> {new_url[:60]}...")
    await session.commit()
    return fixed


async def fix_media_assets(session: AsyncSession) -> int:
    """media_assets.url 수정"""
    rows = (await session.execute(select(MediaAsset.id, MediaAsset.url))).all()
    fixed = 0
    for asset_id, old_url in rows:
        if not old_url:
            continue
        new_url = normalize_url(old_url)
        if new_url != old_url:
            await session.execute(
                update(MediaAsset).where(MediaAsset.id == asset_id).values(url=new_url)
            )
            fixed += 1
            print(f"  [MediaAsset {asset_id}] {old_url[:60]}... -> {new_url[:60]}...")
    await session.commit()
    return fixed


async def main():
    print("=" * 60)
    print("🔄 localhost:8000 URL을 /static/...로 변환 시작...")
    print("=" * 60)
    
    async with async_sessionmaker(bind=engine, expire_on_commit=False)() as session:
        total = 0
        
        print("\n📋 stories.cover_url 처리 중...")
        fixed_stories = await fix_stories(session)
        total += fixed_stories
        print(f"  ✅ {fixed_stories}개 수정됨")
        
        print("\n📋 characters.avatar_url 처리 중...")
        fixed_chars = await fix_characters(session)
        total += fixed_chars
        print(f"  ✅ {fixed_chars}개 수정됨")
        
        print("\n📋 media_assets.url 처리 중...")
        fixed_assets = await fix_media_assets(session)
        total += fixed_assets
        print(f"  ✅ {fixed_assets}개 수정됨")
        
        print("\n" + "=" * 60)
        print(f"🎉 총 {total}개 URL 수정 완료!")
        print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())



