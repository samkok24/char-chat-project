from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional
import uuid

from app.core.database import get_db
from app.core.security import get_current_user
from app.schemas import TagCreate, TagResponse, TagList
from app.models.tag import Tag, CharacterTag, StoryTag
from app.models.character import Character
from app.models.user import User
from sqlalchemy import select, func, desc

router = APIRouter()


def _ensure_admin(user: User) -> None:
    """관리자 권한 방어 체크"""
    if not getattr(user, "is_admin", False):
        raise HTTPException(status_code=403, detail="관리자만 사용할 수 있습니다.")


DEFAULT_TAG_NAMES = [
    # ✅ 시스템 태그(캐릭터 탭 필터용): 프롬프트 타입(롤플/시뮬/커스텀)
    # - 운영/CMS에서 "숨김/순서" 대상으로 다루기 위해 기본 태그로 시드한다(삭제 불가).
    '남성','여성','롤플','시뮬','커스텀','시뮬레이터','스토리','어시스턴트','관계',
    '남자친구','여자친구','연인','플러팅','친구','첫사랑','짝사랑','동거','연상','연하','애증','소꿉친구','가족','육성','순애','구원','후회','복수','소유욕','참교육','중년',
    '로맨스','판타지','현대판타지','이세계','느와르','코미디','힐링','액션','공포','모험','조난','재난','방탈출','던전','역사','대체역사','신화','SF','무협','동양풍','서양풍','TS물','BL','백합','정치물','일상','현대','변신','고스','미스터리',
    '다수 인물','아카데미','학교','학원물','일진','기사','황제','마법사','귀족','탐정','괴물','오피스','메이드','집사','밀리터리','버튜버','스트리머','근육','빙의','비밀','스포츠','수영복','LGBTQ+','톰보이','마피아','헌터','베어','제복','경영','배틀','속박',
    '성향','츤데레','쿨데레','얀데레','다정','순정','능글','히어로/히로인','빌런','음침','소심','햇살','까칠','무뚝뚝',
    '메타','자캐','게임','애니메이션','영화 & 티비','책','유명인','코스프레','동화',
    '종족','천사','악마','요정','귀신','엘프','오크','몬무스','뱀파이어','외계인','로봇','동물',
]

async def _ensure_seed_tags(db: AsyncSession) -> None:
    """기본 태그 시드(멱등).

    요구사항:
    - 운영 중에도 "기본 태그(하드코딩 리스트)"는 항상 선택 가능해야 한다.
    - 기존에는 tags 테이블이 완전히 비어있을 때만 시드했는데,
      유저가 태그를 일부 생성한 상태에서는 기본 태그가 추가되지 않아 UI에 안 보이는 문제가 생긴다.
    """
    try:
        rows = (await db.execute(select(Tag.slug))).scalars().all()
        existing = set([str(s) for s in rows if s is not None])
    except Exception:
        existing = set()

    to_add = []
    for name in DEFAULT_TAG_NAMES:
        slug = name
        if slug in existing:
            continue
        to_add.append(Tag(name=name, slug=slug))

    if to_add:
        db.add_all(to_add)
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


@router.delete("/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tag(
    tag_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    태그 삭제(관리자 전용).

    방어/정책:
    - 기본 시드 태그(DEFAULT_TAG_NAMES)는 삭제 불가(대신 CMS 숨김으로 처리)
    - 캐릭터/스토리에 사용 중인 태그는 삭제 불가(데이터 무결성)
    """
    _ensure_admin(current_user)

    try:
        tid = uuid.UUID(str(tag_id))
    except Exception:
        raise HTTPException(status_code=400, detail="올바르지 않은 태그 ID 입니다.")

    tag = (await db.execute(select(Tag).where(Tag.id == tid))).scalar_one_or_none()
    if not tag:
        raise HTTPException(status_code=404, detail="태그를 찾을 수 없습니다.")

    slug = str(getattr(tag, "slug", "") or "").strip()
    if slug.startswith("cover:"):
        raise HTTPException(status_code=400, detail="이 태그는 삭제할 수 없습니다.")
    if slug in DEFAULT_TAG_NAMES:
        raise HTTPException(status_code=400, detail="기본 태그는 삭제할 수 없습니다. (CMS에서 숨김 처리하세요)")

    # 사용 중 여부 체크(캐릭터/스토리)
    try:
        char_cnt = (await db.execute(select(func.count()).select_from(CharacterTag).where(CharacterTag.tag_id == tid))).scalar() or 0
    except Exception:
        char_cnt = 0
    try:
        story_cnt = (await db.execute(select(func.count()).select_from(StoryTag).where(StoryTag.tag_id == tid))).scalar() or 0
    except Exception:
        story_cnt = 0

    if (char_cnt or 0) > 0 or (story_cnt or 0) > 0:
        raise HTTPException(
            status_code=400,
            detail=f"사용 중인 태그는 삭제할 수 없습니다. (캐릭터:{int(char_cnt or 0)}, 스토리:{int(story_cnt or 0)})",
        )

    try:
        await db.delete(tag)
        await db.commit()
    except Exception as e:
        try:
            await db.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"태그 삭제에 실패했습니다. ({str(e)})")



