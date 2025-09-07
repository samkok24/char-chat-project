from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional

from app.core.database import get_db
from app.schemas import TagCreate, TagResponse, TagList
from app.models.tag import Tag, CharacterTag
from app.models.character import Character
from sqlalchemy import select, func, desc

router = APIRouter()


@router.get("/", response_model=List[TagResponse])
async def list_tags(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Tag))
    return result.scalars().all()


@router.get("/used", response_model=List[TagResponse])
async def list_used_tags(
    limit: int = Query(200, ge=1, le=500),
    db: AsyncSession = Depends(get_db)
):
    """실제로 캐릭터에 연결되어 사용 중인 태그만 반환 (공개/활성 캐릭터 기준)."""
    stmt = (
        select(Tag)
        .join(CharacterTag, CharacterTag.tag_id == Tag.id)
        .join(Character, Character.id == CharacterTag.character_id)
        .where(Character.is_public == True, Character.is_active == True)
        .group_by(Tag.id)
        .order_by(desc(func.count(CharacterTag.character_id)))
        .limit(limit)
    )
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("/", response_model=TagResponse, status_code=status.HTTP_201_CREATED)
async def create_tag(tag: TagCreate, db: AsyncSession = Depends(get_db)):
    # slug 중복 체크
    exists = await db.execute(select(Tag).where(Tag.slug == tag.slug))
    if exists.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="이미 존재하는 태그입니다")
    t = Tag(name=tag.name, slug=tag.slug, emoji=tag.emoji)
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return t



