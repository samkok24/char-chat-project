from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import joinedload
from typing import Optional, List, Dict, Any

from app.core.database import get_db
from app.services.ranking_service import build_daily_ranking, persist_daily_ranking, today_kst
from app.models.story import Story
from app.models.character import Character

router = APIRouter()


@router.get("/daily")
async def get_daily_rankings(
    kind: Optional[str] = Query(None, description="story|origchat|character"),
    date: Optional[str] = Query(None, description="YYYY-MM-DD, default: today KST"),
    db: AsyncSession = Depends(get_db),
):
    """Return daily rankings enriched with display fields.
    If kind is omitted, returns all kinds with minimal fields.
    """
    data = await build_daily_ranking(db)

    async def enrich_story(items: List[Dict[str, Any]]):
        ids = [i["id"] for i in items]
        if not ids:
            return []
        rows = (await db.execute(
            select(Story)
            .options(joinedload(Story.creator))
            .where(Story.id.in_(ids))
        )).scalars().all()
        by_id = {str(r.id): r for r in rows}
        result = []
        for i in items:
            s = by_id.get(str(i["id"]))
            if not s:
                continue
            result.append({
                "id": s.id,
                "title": s.title,
                "content": s.content,
                "excerpt": getattr(s, "excerpt", None),
                "cover_url": getattr(s, "cover_url", None),
                "is_public": s.is_public,
                "is_webtoon": getattr(s, "is_webtoon", False),
                "view_count": s.view_count,
                "like_count": s.like_count,
                "created_at": s.created_at,
                "creator_username": getattr(s.creator, "username", None),
                "creator_avatar_url": getattr(s.creator, "avatar_url", None),
            })
        return result

    async def enrich_character(items: List[Dict[str, Any]]):
        ids = [i["id"] for i in items]
        if not ids:
            return []
        rows = (await db.execute(
            select(Character)
            .options(
                joinedload(Character.creator),
                joinedload(Character.origin_story),
            )
            .where(Character.id.in_(ids))
        )).scalars().all()
        by_id = {str(r.id): r for r in rows}
        result = []
        for i in items:
            c = by_id.get(str(i["id"]))
            if not c:
                continue
            result.append({
                "id": c.id,
                "name": c.name,
                "description": c.description,
                "greeting": c.greeting,
                "avatar_url": c.avatar_url,
                "origin_story_id": c.origin_story_id,
                # ✅ 원작챗 카드에서 "원작 웹소설(파란 배지)"를 보여주기 위한 표시 필드
                "origin_story_title": getattr(getattr(c, "origin_story", None), "title", None),
                "origin_story_is_webtoon": getattr(getattr(c, "origin_story", None), "is_webtoon", None),
                "chat_count": c.chat_count,
                "like_count": c.like_count,
                "creator_id": c.creator_id,
                "creator_username": getattr(c.creator, "username", None),
                "creator_avatar_url": getattr(c.creator, "avatar_url", None),
                "source_type": c.source_type,
            })
        return result

    if kind:
        k = (kind or "").lower()
        if k == "story":
            return {"items": await enrich_story(data.get("story", []))}
        elif k == "origchat":
            return {"items": await enrich_character(data.get("origchat", []))}
        elif k == "character":
            return {"items": await enrich_character(data.get("character", []))}
        return {"items": []}

    # all kinds minimal
    return data


@router.post("/daily/snapshot")
async def create_daily_snapshot(
    db: AsyncSession = Depends(get_db),
):
    date_str = today_kst()
    data = await build_daily_ranking(db)
    await persist_daily_ranking(db, date_str, data)
    return {"date": date_str, "ok": True}


