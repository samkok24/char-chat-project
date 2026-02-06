from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import joinedload
from typing import Optional, List, Dict, Any

from app.core.database import get_db
from app.services.ranking_service import build_daily_ranking, persist_daily_ranking, today_kst
from app.models.story import Story
from app.models.character import Character
from app.services.start_sets_utils import extract_max_turns_from_start_sets

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
            # ✅ 방어적 2차 필터(중요):
            # - 원작 스토리가 비공개면, 메인(랭킹)에서 원작챗 캐릭터가 노출되면 안 된다.
            # - build_daily_ranking에서 1차로 Story.is_public 필터를 걸었더라도,
            #   운영/마이그레이션/캐시 이슈로 누락될 수 있어 응답 단계에서 한 번 더 차단한다.
            try:
                if getattr(c, "origin_story_id", None):
                    os = getattr(c, "origin_story", None)
                    if os is not None:
                        if getattr(os, "is_public", True) is not True:
                            continue
                    else:
                        # origin_story가 로드되지 않았을 때는 DB에서 안전 확인(최대 10개 수준이라 부담 적음)
                        try:
                            row = (await db.execute(
                                select(Story.is_public).where(Story.id == c.origin_story_id)
                            )).first()
                            is_pub = (row or [None])[0]
                            if is_pub is not True:
                                continue
                        except Exception:
                            # 확인 실패 시에도 노출을 막는 것이 안전(보수적)
                            continue
            except Exception:
                continue
            # ✅ 썸네일 폴백(홈/랭킹 UX):
            # - 랭킹 응답은 기존에 avatar_url만 내려주고 있어, avatar_url이 비어있는(갤러리만 있는) 캐릭터는
            #   프론트에서 기본이미지로 보이는 문제가 있었다.
            # - 목록 API(`/characters/`)처럼 "avatar가 없으면 image_descriptions[0].url"을 썸네일로 사용한다.
            thumb = getattr(c, "avatar_url", None)
            if not thumb:
                try:
                    imgs = getattr(c, "image_descriptions", None) or []
                    if isinstance(imgs, list) and len(imgs) > 0:
                        first = imgs[0]
                        if isinstance(first, dict):
                            u = first.get("url")
                            if u:
                                thumb = u
                except Exception:
                    pass
            result.append({
                "id": c.id,
                "name": c.name,
                "description": c.description,
                "greeting": c.greeting,
                "avatar_url": c.avatar_url,
                "thumbnail_url": thumb,
                "origin_story_id": c.origin_story_id,
                # ✅ 원작챗 카드에서 "원작 웹소설(파란 배지)"를 보여주기 위한 표시 필드
                "origin_story_title": getattr(getattr(c, "origin_story", None), "title", None),
                "origin_story_is_webtoon": getattr(getattr(c, "origin_story", None), "is_webtoon", None),
                # ✅ 격자 카드 UX: 턴수 배지 표기용(SSOT: character.start_sets.sim_options.max_turns)
                "max_turns": extract_max_turns_from_start_sets(getattr(c, "start_sets", None)),
                # ✅ 격자 카드 UX: 배지(롤플/시뮬/커스텀) 표기용
                "character_type": getattr(c, "character_type", None),
                "chat_count": c.chat_count,
                "like_count": c.like_count,
                # ✅ NEW 배지(48h) / 캐시 버스터(avatar v=) 용 메타
                # - 홈/랭킹 카드에서 N 배지가 "탐색만" 뜨는 문제는 랭킹 응답에 created_at이 없어서였다.
                "created_at": c.created_at,
                "updated_at": c.updated_at,
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


