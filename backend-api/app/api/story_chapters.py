"""
스토리 회차 API
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, update
from typing import List, Optional
import uuid
import json

from app.core.database import get_db
from app.core.security import get_current_user, get_current_user_optional
from app.models.story import Story
from sqlalchemy import update as sql_update
from app.services.origchat_service import upsert_episode_summary_for_chapter, refresh_extracted_characters_for_story
from app.models.story_chapter import StoryChapter
from app.models.user import User
from app.schemas.story import ChapterCreate, ChapterUpdate, ChapterResponse

router = APIRouter()


def _serialize_image_url(image_url: Optional[List[str]]) -> Optional[str]:
    """이미지 URL 배열을 JSON 문자열로 변환"""
    if image_url is None:
        return None
    if isinstance(image_url, list):
        return json.dumps(image_url) if image_url else None
    return image_url  # 이미 문자열인 경우 (하위 호환)


@router.post("/", response_model=ChapterResponse, status_code=status.HTTP_201_CREATED)
async def create_chapter(
    chapter: ChapterCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # 권한: 스토리 작성자만 가능
    story = await db.get(Story, chapter.story_id)
    if not story:
        raise HTTPException(status_code=404, detail="스토리를 찾을 수 없습니다")
    if story.creator_id != current_user.id:
        raise HTTPException(status_code=403, detail="권한이 없습니다")

    ch = StoryChapter(
        story_id=chapter.story_id, 
        no=chapter.no, 
        title=chapter.title, 
        content=chapter.content,
        image_url=_serialize_image_url(chapter.image_url)
    )
    db.add(ch)
    try:
        await db.commit()
    except Exception as e:
        await db.rollback()
        # 고유 제약 위반 등
        raise HTTPException(status_code=400, detail=f"회차 생성 실패: {str(e)}")
    await db.refresh(ch)
    # 증분 요약 업서트(베스트 에포트)
    try:
        await upsert_episode_summary_for_chapter(db, ch.story_id, ch.no, ch.content)
        # 회차 생성은 요약에 영향 → 스토리 summary_version 증가
        await db.execute(sql_update(Story).where(Story.id == ch.story_id).values(summary_version=Story.summary_version + 1))
        await db.commit()
        # 등장인물 추출 정보도 최신 회차 등록 시 보강 갱신(비차단식)
        try:
            await refresh_extracted_characters_for_story(db, ch.story_id)
        except Exception:
            pass
    except Exception:
        pass
    return ch


@router.get("/by-story/{story_id}", response_model=List[ChapterResponse])
async def list_chapters(
    story_id: uuid.UUID,
    order: str = Query("asc", pattern="^(asc|desc)$"),
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    # 스토리 존재 및 공개 여부 확인
    story = await db.get(Story, story_id)
    if not story:
        raise HTTPException(status_code=404, detail="스토리를 찾을 수 없습니다")
    
    # 비공개 스토리는 작성자만 조회 가능
    if not story.is_public and (not current_user or story.creator_id != current_user.id):
        raise HTTPException(status_code=403, detail="접근 권한이 없습니다")
    
    stmt = select(StoryChapter).where(StoryChapter.story_id == story_id)
    if order == "asc":
        stmt = stmt.order_by(StoryChapter.no.asc())
    else:
        stmt = stmt.order_by(StoryChapter.no.desc())
    rows = (await db.execute(stmt)).scalars().all()
    return rows


@router.get("/{chapter_id}", response_model=ChapterResponse)
async def get_chapter(
    chapter_id: uuid.UUID, 
    background_tasks: BackgroundTasks, 
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    ch = await db.get(StoryChapter, chapter_id)
    if not ch:
        raise HTTPException(status_code=404, detail="회차를 찾을 수 없습니다")
    
    # 스토리 존재 및 공개 여부 확인
    story = await db.get(Story, ch.story_id)
    if not story:
        raise HTTPException(status_code=404, detail="스토리를 찾을 수 없습니다")
    
    # 비공개 스토리는 작성자만 조회 가능
    if not story.is_public and (not current_user or story.creator_id != current_user.id):
        raise HTTPException(status_code=403, detail="접근 권한이 없습니다")
    
    # 조회수 증가(비차단)
    try:
        async def _inc():
            await db.execute(update(StoryChapter).where(StoryChapter.id == chapter_id).values(view_count=StoryChapter.view_count + 1))
            await db.commit()
        background_tasks.add_task(_inc)
    except Exception:
        pass
    return ch


@router.put("/{chapter_id}", response_model=ChapterResponse)
async def update_chapter(
    chapter_id: uuid.UUID,
    patch: ChapterUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    ch = await db.get(StoryChapter, chapter_id)
    if not ch:
        raise HTTPException(status_code=404, detail="회차를 찾을 수 없습니다")
    story = await db.get(Story, ch.story_id)
    if not story or story.creator_id != current_user.id:
        raise HTTPException(status_code=403, detail="권한이 없습니다")
    data = patch.model_dump(exclude_unset=True)
    # image_url을 JSON 문자열로 변환
    if 'image_url' in data:
        data['image_url'] = _serialize_image_url(data['image_url'])
    if data:
        await db.execute(update(StoryChapter).where(StoryChapter.id == chapter_id).values(**data))
        await db.commit()
    ch = await db.get(StoryChapter, chapter_id)
    # 업데이트 후 증분 요약 재계산(해당 회차만, 누적은 upsert에서 전 단계 요약 이용)
    try:
        await upsert_episode_summary_for_chapter(db, ch.story_id, ch.no, ch.content)
        # 회차 수정도 요약 영향 → 버전 증가
        await db.execute(sql_update(Story).where(Story.id == ch.story_id).values(summary_version=Story.summary_version + 1))
        await db.commit()
        # 등장인물 추출 설명 보강(회차 변경 반영)
        try:
            await refresh_extracted_characters_for_story(db, ch.story_id)
        except Exception:
            pass
    except Exception:
        pass
    return ch


@router.delete("/{chapter_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_chapter(
    chapter_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    ch = await db.get(StoryChapter, chapter_id)
    if not ch:
        raise HTTPException(status_code=404, detail="회차를 찾을 수 없습니다")
    story = await db.get(Story, ch.story_id)
    if not story or story.creator_id != current_user.id:
        raise HTTPException(status_code=403, detail="권한이 없습니다")
    await db.execute(delete(StoryChapter).where(StoryChapter.id == chapter_id))
    await db.commit()
    return None



