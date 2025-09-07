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
    # 1. 대상 캐릭터를 먼저 조회합니다.
    character = await db.get(Character, character_id)
    if not character:
        # 이 경우는 보통 API 레벨에서 처리되지만, 안전을 위해 추가합니다.
        raise ValueError("Character not found to update comment count.")

    # 2. 댓글 객체를 생성합니다.
    comment = CharacterComment(
        character_id=character_id,
        user_id=user_id,
        content=comment_data.content
    )
    db.add(comment)

    # 3. 조회된 캐릭터 객체의 댓글 수를 1 증가시킵니다.
    character.comment_count += 1
    
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
    """댓글 삭제 (안정성 강화 버전)"""
    # 1. 삭제할 댓글을 조회하여, 어떤 캐릭터에 속해있는지 character_id를 확보합니다.
    #    .with_for_update()를 사용하여 이 레코드를 비관적 잠금(pessimistic lock) 처리할 수 있으나,
    #    현재 시스템에서는 동시 삭제 가능성이 낮으므로 간단하게 구현합니다.
    comment_to_delete = await db.get(CharacterComment, comment_id)
    if not comment_to_delete:
        return False
        
    character_id_to_update = comment_to_delete.character_id

    # 2. 댓글을 삭제 대기열에 추가합니다.
    await db.delete(comment_to_delete)
    
    # 3. 별도의 UPDATE 구문을 사용하여 'comment_count'를 1 감소시킵니다.
    #    이렇게 하면 세션 상태에 의존하지 않아 훨씬 안정적입니다.
    await db.execute(
        update(Character)
        .where(Character.id == character_id_to_update)
        .values(comment_count=Character.comment_count - 1)
    )

    # 4. 모든 변경사항(DELETE와 UPDATE)을 하나의 트랜잭션으로 커밋합니다.
    await db.commit()
    return True


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


# === 사용자 기준 댓글 조회 ===
async def get_character_comments_by_user(
    db: AsyncSession,
    user_id: uuid.UUID,
    skip: int = 0,
    limit: int = 20
) -> List[CharacterComment]:
    """특정 사용자가 작성한 캐릭터 댓글 목록 조회 (최신순)"""
    result = await db.execute(
        select(CharacterComment)
        .options(selectinload(CharacterComment.user))
        .where(CharacterComment.user_id == user_id)
        .order_by(CharacterComment.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    return result.scalars().all()


async def get_story_comments_by_user(
    db: AsyncSession,
    user_id: uuid.UUID,
    skip: int = 0,
    limit: int = 20
) -> List[StoryComment]:
    """특정 사용자가 작성한 스토리 댓글 목록 조회 (최신순)"""
    result = await db.execute(
        select(StoryComment)
        .options(selectinload(StoryComment.user))
        .where(StoryComment.user_id == user_id)
        .order_by(StoryComment.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    return result.scalars().all()

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