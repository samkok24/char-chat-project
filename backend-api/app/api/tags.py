from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional

from app.core.database import get_db
from app.schemas import TagCreate, TagResponse, TagList
from app.models.tag import Tag, CharacterTag
from app.models.character import Character
from sqlalchemy import select, func, desc

router = APIRouter()


DEFAULT_TAG_NAMES = [
    '남성','여성','시뮬레이터','스토리','어시스턴트','관계',
    '남자친구','여자친구','연인','플러팅','친구','첫사랑','짝사랑','동거','연상','연하','애증','소꿉친구','가족','육성','순애','구원','후회','복수','소유욕','참교육','중년',
    '로맨스','판타지','현대판타지','이세계','느와르','코미디','힐링','액션','공포','모험','조난','재난','방탈출','던전','역사','신화','SF','무협','동양풍','서양풍','TS물','BL','백합','정치물','일상','현대','변신','고스','미스터리',
    '다수 인물','아카데미','학원물','일진','기사','황제','마법사','귀족','탐정','괴물','오피스','메이드','집사','밀리터리','버튜버','근육','빙의','비밀','스포츠','수영복','LGBTQ+','톰보이','마피아','헌터','베어','제복','경영','배틀','속박',
    '성향','츤데레','쿨데레','얀데레','다정','순정','능글','히어로/히로인','빌런','음침','소심','햇살','까칠','무뚝뚝',
    '메타','자캐','게임','애니메이션','영화 & 티비','책','유명인','코스프레','동화',
    '종족','천사','악마','요정','귀신','엘프','오크','몬무스','뱀파이어','외계인','로봇','동물',
]

async def _ensure_seed_tags(db: AsyncSession) -> None:
    # 태그가 하나도 없으면 기본 태그를 시드한다
    count = (await db.execute(select(func.count(Tag.id)))).scalar() or 0
    if count == 0:
        for name in DEFAULT_TAG_NAMES:
            db.add(Tag(name=name, slug=name))
        await db.commit()


@router.get("/", response_model=List[TagResponse])
async def list_tags(db: AsyncSession = Depends(get_db)):
    # 빈 DB에서도 바로 사용할 수 있도록 안전 시드
    try:
        await _ensure_seed_tags(db)
    except Exception:
        pass
    result = await db.execute(select(Tag).order_by(Tag.name))
    # cover: 메타 태그는 노출 금지
    return [t for t in result.scalars().all() if not str(getattr(t, 'slug', '')).startswith('cover:')]


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
    return [t for t in result.scalars().all() if not str(getattr(t, 'slug', '')).startswith('cover:')]


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



