from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Literal, List, Dict, Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, insert, delete, text
from sqlalchemy.orm import joinedload

from app.models.story import Story
from app.models.character import Character

KST = timezone(timedelta(hours=9))

RankingKind = Literal["story", "origchat", "character"]


def today_kst() -> str:
    now = datetime.now(KST)
    return now.strftime("%Y-%m-%d")


async def build_daily_ranking(
    db: AsyncSession,
    when: Optional[datetime] = None,
) -> Dict[str, List[Dict[str, Any]]]:
    """Create in-memory daily rankings (top10 for each kind)."""
    # stories (webnovel): view_count desc
    stories = (await db.execute(
        select(Story)
        .options(joinedload(Story.creator))
        .where(Story.is_public == True)
        .order_by(Story.view_count.desc(), Story.like_count.desc(), Story.created_at.desc())
        .limit(10)
    )).scalars().all()
    story_rank = [
        {"id": s.id, "metric": s.view_count or 0, "title": s.title}
        for s in stories
    ]

    # origchat characters: origin_story_id not null, chat_count desc
    orig_chars = (await db.execute(
        select(Character)
        .options(joinedload(Character.creator))
        .where(Character.is_public == True, Character.is_active == True, Character.origin_story_id.isnot(None))
        .order_by(Character.chat_count.desc(), Character.like_count.desc(), Character.created_at.desc())
        .limit(10)
    )).scalars().all()
    orig_rank = [
        {"id": c.id, "metric": c.chat_count or 0, "name": c.name}
        for c in orig_chars
    ]

    # normal characters: source_type ORIGINAL and no origin_story
    norm_chars = (await db.execute(
        select(Character)
        .options(joinedload(Character.creator))
        .where(Character.is_public == True, Character.is_active == True, Character.source_type == 'ORIGINAL', Character.origin_story_id.is_(None))
        .order_by(Character.chat_count.desc(), Character.like_count.desc(), Character.created_at.desc())
        .limit(10)
    )).scalars().all()
    char_rank = [
        {"id": c.id, "metric": c.chat_count or 0, "name": c.name}
        for c in norm_chars
    ]

    return {"story": story_rank, "origchat": orig_rank, "character": char_rank}


async def persist_daily_ranking(db: AsyncSession, date_str: str, data: Dict[str, List[Dict[str, Any]]]) -> None:
    """Persist snapshot to a simple key-value table (SQLite-friendly).
    Table: daily_rankings (date TEXT, kind TEXT, item_id TEXT, rank INTEGER, metric INTEGER)
    """
    # Ensure table exists (idempotent)
    await db.execute(text(
        """
        CREATE TABLE IF NOT EXISTS daily_rankings (
          date TEXT,
          kind TEXT,
          item_id TEXT,
          rank INTEGER,
          metric INTEGER
        )
        """
    ))
    await db.execute(
        delete_from_daily_rankings_sql(date_str)
    )
    # bulk insert via executemany
    rows = []
    for kind, items in data.items():
        for idx, item in enumerate(items):
            rows.append({
                "date": date_str,
                "kind": kind,
                "item_id": str(item["id"]),
                "rank": idx + 1,
                "metric": int(item.get("metric") or 0),
            })
    if rows:
        await db.execute(insert_daily_rankings_sql(), rows)
    await db.commit()


def insert_daily_rankings_sql():
    from sqlalchemy import Table, Column, String, Integer, MetaData
    md = MetaData()
    t = Table(
        "daily_rankings", md,
        Column("date", String(10)),
        Column("kind", String(20)),
        Column("item_id", String(64)),
        Column("rank", Integer),
        Column("metric", Integer),
    )
    return t.insert()


def delete_from_daily_rankings_sql(date_str: str):
    from sqlalchemy import Table, Column, String, Integer, MetaData
    md = MetaData()
    t = Table(
        "daily_rankings", md,
        Column("date", String(10)),
        Column("kind", String(20)),
        Column("item_id", String(64)),
        Column("rank", Integer),
        Column("metric", Integer),
    )
    return t.delete().where(t.c.date == date_str)


