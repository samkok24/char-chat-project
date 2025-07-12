"""
댓글 관련 서비스
"""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete, and_, func
from sqlalchemy.orm import selectinload
from typing import List, Optional
import uuid

from app.models.comment import CharacterComment, StoryComment
from app.models.character import Character
from app.schemas.comment import CommentCreate, CommentUpdate


async def create_character_comment(
    db: AsyncSession,
    character_id: uuid.UUID,
    user_id: uuid.UUID,
    comment_data: CommentCreate
) -> CharacterComment:
    """캐릭터 댓글 생성"""
    comment = CharacterComment(
        character_id=character_id,
        user_id=user_id,
        content=comment_data.content
    )
    db.add(comment)
    await db.commit()
    await db.refresh(comment)
    return comment


async def get_character_comments(
    db: AsyncSession,
    character_id: uuid.UUID,
    skip: int = 0,
    limit: int = 20
) -> List[CharacterComment]:
    """캐릭터 댓글 목록 조회"""
    result = await db.execute(
        select(CharacterComment)
        .options(selectinload(CharacterComment.user))
        .where(CharacterComment.character_id == character_id)
        .order_by(CharacterComment.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    return result.scalars().all()


async def get_comment_by_id(
    db: AsyncSession,
    comment_id: uuid.UUID
) -> Optional[CharacterComment]:
    """댓글 ID로 조회"""
    result = await db.execute(
        select(CharacterComment)
        .options(selectinload(CharacterComment.user))
        .where(CharacterComment.id == comment_id)
    )
    return result.scalar_one_or_none()


async def update_character_comment(
    db: AsyncSession,
    comment_id: uuid.UUID,
    comment_data: CommentUpdate
) -> Optional[CharacterComment]:
    """댓글 수정"""
    await db.execute(
        update(CharacterComment)
        .where(CharacterComment.id == comment_id)
        .values(content=comment_data.content)
    )
    await db.commit()
    return await get_comment_by_id(db, comment_id)


async def delete_character_comment(
    db: AsyncSession,
    comment_id: uuid.UUID
) -> bool:
    """댓글 삭제"""
    result = await db.execute(
        delete(CharacterComment)
        .where(CharacterComment.id == comment_id)
    )
    await db.commit()
    return result.rowcount > 0


async def count_character_comments(
    db: AsyncSession,
    character_id: uuid.UUID
) -> int:
    """캐릭터 댓글 수 조회"""
    result = await db.execute(
        select(func.count(CharacterComment.id))
        .where(CharacterComment.character_id == character_id)
    )
    return result.scalar() or 0


# 스토리 댓글 관련 함수들
async def create_story_comment(
    db: AsyncSession,
    story_id: uuid.UUID,
    user_id: uuid.UUID,
    comment_data: CommentCreate
) -> StoryComment:
    """스토리 댓글 생성"""
    comment = StoryComment(
        story_id=story_id,
        user_id=user_id,
        content=comment_data.content
    )
    db.add(comment)
    
    # 스토리 댓글 수 증가
    from app.models.story import Story
    await db.execute(
        update(Story)
        .where(Story.id == story_id)
        .values(comment_count=Story.comment_count + 1)
    )
    
    await db.commit()
    await db.refresh(comment)
    return comment


async def get_story_comments(
    db: AsyncSession,
    story_id: uuid.UUID,
    skip: int = 0,
    limit: int = 20
) -> List[StoryComment]:
    """스토리 댓글 목록 조회"""
    result = await db.execute(
        select(StoryComment)
        .options(selectinload(StoryComment.user))
        .where(StoryComment.story_id == story_id)
        .order_by(StoryComment.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    return result.scalars().all()


async def get_story_comment_by_id(
    db: AsyncSession,
    comment_id: uuid.UUID
) -> Optional[StoryComment]:
    """스토리 댓글 ID로 조회"""
    result = await db.execute(
        select(StoryComment)
        .options(selectinload(StoryComment.user))
        .where(StoryComment.id == comment_id)
    )
    return result.scalar_one_or_none()


async def update_story_comment(
    db: AsyncSession,
    comment_id: uuid.UUID,
    comment_data: CommentUpdate
) -> Optional[StoryComment]:
    """스토리 댓글 수정"""
    await db.execute(
        update(StoryComment)
        .where(StoryComment.id == comment_id)
        .values(content=comment_data.content)
    )
    await db.commit()
    return await get_story_comment_by_id(db, comment_id)


async def delete_story_comment(
    db: AsyncSession,
    comment_id: uuid.UUID
) -> bool:
    """스토리 댓글 삭제"""
    # 댓글 조회하여 story_id 얻기
    comment = await get_story_comment_by_id(db, comment_id)
    if not comment:
        return False
    
    result = await db.execute(
        delete(StoryComment)
        .where(StoryComment.id == comment_id)
    )
    
    if result.rowcount > 0:
        # 스토리 댓글 수 감소
        from app.models.story import Story
        await db.execute(
            update(Story)
            .where(Story.id == comment.story_id)
            .values(comment_count=Story.comment_count - 1)
        )
    
    await db.commit()
    return result.rowcount > 0


async def count_story_comments(
    db: AsyncSession,
    story_id: uuid.UUID
) -> int:
    """스토리 댓글 수 조회"""
    result = await db.execute(
        select(func.count(StoryComment.id))
        .where(StoryComment.story_id == story_id)
    )
    return result.scalar() or 0 