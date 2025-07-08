"""
댓글 관련 서비스
"""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete, and_, func
from sqlalchemy.orm import selectinload
from typing import List, Optional
import uuid

from app.models.comment import CharacterComment
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