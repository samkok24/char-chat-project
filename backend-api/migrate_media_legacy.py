import asyncio
import os
import sys
import uuid
from typing import List

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

# --- ensure import path: add backend-api root (folder that contains 'app') ---
ROOT_DIR = os.path.abspath(os.path.dirname(__file__))
PARENT_DIR = os.path.dirname(ROOT_DIR)
for p in [ROOT_DIR, PARENT_DIR]:
    if p not in sys.path:
        sys.path.insert(0, p)

from app.core.database import async_sessionmaker, engine
from app.models.character import Character
from app.models.story import Story
from app.models.media_asset import MediaAsset
from app.services.storage import get_storage
from app.core.paths import get_upload_dir


async def ensure_session() -> AsyncSession:
    return async_sessionmaker(bind=engine, expire_on_commit=False)()


async def migrate_character(session: AsyncSession, character_id: str) -> int:
    ch = (await session.execute(select(Character).where(Character.id == character_id))).scalars().first()
    if not ch:
        print(f"[skip] character not found: {character_id}")
        return 0

    # 이미 자산이 있으면, 같은 URL은 건너뜀
    exist_assets = (await session.execute(
        select(MediaAsset).where(MediaAsset.entity_type == 'character', MediaAsset.entity_id == character_id)
    )).scalars().all()
    exist_urls = {a.url for a in exist_assets}
    exist_by_url = {a.url: a for a in exist_assets}

    urls: List[str] = []
    if ch.avatar_url:
        urls.append(ch.avatar_url)
    try:
        # image_descriptions: Optional[List[{url:str}]]
        if isinstance(ch.image_descriptions, list):
            for it in ch.image_descriptions:
                u = None
                try:
                    u = it.get('url')
                except Exception:
                    pass
                if u:
                    urls.append(u)
    except Exception:
        pass

    created = 0
    order = 0
    primary_set = any(a.is_primary for a in exist_assets)
    storage = get_storage() if os.getenv('MIGRATE_UPLOAD_TO_R2') == '1' else None
    upload_dir = get_upload_dir()

    def _maybe_upload(url: str) -> str:
        try:
            if not storage:
                return url
            # 로컬 정적 경로만 업로드 대상
            if not url.startswith('/static/'):
                return url
            name = url.split('/static/')[-1]
            src = os.path.join(upload_dir, name)
            if not os.path.isfile(src):
                return url
            with open(src, 'rb') as f:
                data = f.read()
            ext = os.path.splitext(src)[1] or '.png'
            ct = 'image/png'
            if ext.lower() in ('.jpg', '.jpeg'):
                ct = 'image/jpeg'
            elif ext.lower() == '.webp':
                ct = 'image/webp'
            new_url = storage.save_bytes(data, content_type=ct, key_hint=os.path.basename(src))
            return new_url or url
        except Exception:
            return url

    seen_local: set[str] = set()
    for u in urls:
        if not u or u in exist_urls:
            # 중복 URL(avatar_url과 image_descriptions 간) 방지
            continue
        # 같은 로컬 파일을 한 번만 처리
        if u.startswith('/static/'):
            fname = u.split('/static/')[-1]
            if fname in seen_local:
                continue
            seen_local.add(fname)

        if storage and u.startswith('/static/') and u in exist_by_url:
            # 기존 자산이 같은 /static URL로 이미 존재 → 신규 생성 대신 URL만 R2로 업데이트
            new_u = _maybe_upload(u)
            try:
                exist_by_url[u].url = new_u
                await session.commit()
            except Exception:
                pass
            continue

        new_u = _maybe_upload(u)
        try:
            asset = MediaAsset(
                id=str(uuid.uuid4()),
                user_id=str(ch.creator_id) if ch.creator_id else None,
                entity_type='character',
                entity_id=str(character_id),
                url=new_u,
                is_primary=(not primary_set and order == 0),
                order_index=order,
                status='ready',
            )
            session.add(asset)
            created += 1
            order += 1
        except Exception:
            pass

    await session.commit()

    # 대표 동기화: 업로드 모드에서는 R2 URL을 대표로 덮어쓰기, 아니면 비어 있을 때만
    if os.getenv('MIGRATE_UPLOAD_TO_R2') == '1' or not ch.avatar_url:
        first = (await session.execute(
            select(MediaAsset).where(MediaAsset.entity_type == 'character', MediaAsset.entity_id == character_id)
            .order_by(MediaAsset.is_primary.desc(), MediaAsset.order_index.asc(), MediaAsset.created_at.desc())
        )).scalars().first()
        if first and first.url:
            await session.execute(update(Character).where(Character.id == character_id).values(avatar_url=first.url))
            await session.commit()

    return created


async def migrate_story(session: AsyncSession, story_id: str) -> int:
    st = (await session.execute(select(Story).where(Story.id == story_id))).scalars().first()
    if not st:
        print(f"[skip] story not found: {story_id}")
        return 0

    exist_assets = (await session.execute(
        select(MediaAsset).where(MediaAsset.entity_type == 'story', MediaAsset.entity_id == story_id)
    )).scalars().all()
    exist_urls = {a.url for a in exist_assets}
    exist_by_url = {a.url: a for a in exist_assets}

    urls: List[str] = []
    if st.cover_url:
        urls.append(st.cover_url)

    created = 0
    order = 0
    primary_set = any(a.is_primary for a in exist_assets)
    storage = get_storage() if os.getenv('MIGRATE_UPLOAD_TO_R2') == '1' else None
    upload_dir = get_upload_dir()

    def _maybe_upload(url: str) -> str:
        try:
            if not storage:
                return url
            if not url.startswith('/static/'):
                return url
            name = url.split('/static/')[-1]
            src = os.path.join(upload_dir, name)
            if not os.path.isfile(src):
                return url
            with open(src, 'rb') as f:
                data = f.read()
            ext = os.path.splitext(src)[1] or '.png'
            ct = 'image/png'
            if ext.lower() in ('.jpg', '.jpeg'):
                ct = 'image/jpeg'
            elif ext.lower() == '.webp':
                ct = 'image/webp'
            new_url = storage.save_bytes(data, content_type=ct, key_hint=os.path.basename(src))
            return new_url or url
        except Exception:
            return url

    seen_local: set[str] = set()
    for u in urls:
        if not u or u in exist_urls:
            continue
        if u.startswith('/static/'):
            fname = u.split('/static/')[-1]
            if fname in seen_local:
                continue
            seen_local.add(fname)

        if storage and u.startswith('/static/') and u in exist_by_url:
            new_u = _maybe_upload(u)
            try:
                exist_by_url[u].url = new_u
                await session.commit()
            except Exception:
                pass
            continue

        new_u = _maybe_upload(u)
        try:
            asset = MediaAsset(
                id=str(uuid.uuid4()),
                user_id=str(st.creator_id) if st.creator_id else None,
                entity_type='story',
                entity_id=str(story_id),
                url=new_u,
                is_primary=(not primary_set and order == 0),
                order_index=order,
                status='ready',
            )
            session.add(asset)
            created += 1
            order += 1
        except Exception:
            pass

    await session.commit()

    # 대표 동기화: 업로드 모드에서는 R2 URL로 덮어쓰기
    if os.getenv('MIGRATE_UPLOAD_TO_R2') == '1' or not st.cover_url:
        first = (await session.execute(
            select(MediaAsset).where(MediaAsset.entity_type == 'story', MediaAsset.entity_id == story_id)
            .order_by(MediaAsset.is_primary.desc(), MediaAsset.order_index.asc(), MediaAsset.created_at.desc())
        )).scalars().first()
        if first and first.url:
            await session.execute(update(Story).where(Story.id == story_id).values(cover_url=first.url))
            await session.commit()

    return created


async def main():
    # 대상 ID를 환경변수로 받거나 전체 마이그레이션
    entity_type = os.getenv('MIGRATE_ENTITY_TYPE')  # character|story|all
    entity_id = os.getenv('MIGRATE_ENTITY_ID')
    async with await ensure_session() as session:
        total = 0
        if entity_type == 'character' and entity_id:
            total += await migrate_character(session, entity_id)
        elif entity_type == 'story' and entity_id:
            total += await migrate_story(session, entity_id)
        else:
            # 전체 스캔 (규모 작을 때만 사용)
            if entity_type in (None, '', 'all', 'character'):
                rows = (await session.execute(select(Character.id))).scalars().all()
                for cid in rows:
                    total += await migrate_character(session, cid)
            if entity_type in (None, '', 'all', 'story'):
                rows = (await session.execute(select(Story.id))).scalars().all()
                for sid in rows:
                    total += await migrate_story(session, sid)
        print(f"migrated assets: {total}")


if __name__ == "__main__":
    asyncio.run(main())


