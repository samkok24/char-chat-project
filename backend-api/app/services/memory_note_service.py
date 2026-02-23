"""
기억노트 서비스 - 비즈니스 로직
"""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete
from typing import List, Optional
import uuid

from app.models.memory_note import MemoryNote
from app.schemas.memory_note import MemoryNoteCreate, MemoryNoteUpdate


async def get_memory_notes_by_character(
    db: AsyncSession, 
    user_id: uuid.UUID, 
    character_id: uuid.UUID
) -> List[MemoryNote]:
    """특정 캐릭터의 기억노트 목록 조회"""
    result = await db.execute(
        select(MemoryNote)
        .where(
            MemoryNote.user_id == user_id,
            MemoryNote.character_id == character_id
        )
        .order_by(MemoryNote.created_at.desc())
    )
    return result.scalars().all()


async def get_active_memory_notes_by_character(
    db: AsyncSession, 
    user_id: uuid.UUID, 
    character_id: uuid.UUID
) -> List[MemoryNote]:
    """특정 캐릭터의 활성화된 기억노트만 조회"""
    result = await db.execute(
        select(MemoryNote)
        .where(
            MemoryNote.user_id == user_id,
            MemoryNote.character_id == character_id,
            MemoryNote.is_active == True
        )
        .order_by(MemoryNote.created_at.desc())
    )
    return result.scalars().all()


async def create_memory_note(
    db: AsyncSession, 
    user_id: uuid.UUID, 
    memory_data: MemoryNoteCreate
) -> MemoryNote:
    """기억노트 생성"""
    memory_note = MemoryNote(
        user_id=user_id,
        character_id=memory_data.character_id,
        title=memory_data.title,
        content=memory_data.content,
        is_active=memory_data.is_active,
        char_count=str(len(memory_data.content))
    )
    
    db.add(memory_note)
    await db.commit()
    await db.refresh(memory_note)
    return memory_note


async def update_memory_note(
    db: AsyncSession, 
    memory_id: uuid.UUID, 
    user_id: uuid.UUID,
    memory_data: MemoryNoteUpdate
) -> Optional[MemoryNote]:
    """기억노트 수정"""
    # 권한 확인을 위해 먼저 조회
    result = await db.execute(
        select(MemoryNote)
        .where(
            MemoryNote.id == memory_id,
            MemoryNote.user_id == user_id
        )
    )
    memory_note = result.scalar_one_or_none()
    
    if not memory_note:
        return None
    
    # 업데이트할 데이터 준비
    update_data = {}
    if memory_data.title is not None:
        update_data["title"] = memory_data.title
    if memory_data.content is not None:
        update_data["content"] = memory_data.content
        update_data["char_count"] = str(len(memory_data.content))
    if memory_data.is_active is not None:
        update_data["is_active"] = memory_data.is_active
    
    if update_data:
        await db.execute(
            update(MemoryNote)
            .where(MemoryNote.id == memory_id)
            .values(**update_data)
        )
        await db.commit()
        await db.refresh(memory_note)
    
    return memory_note


async def delete_memory_note(
    db: AsyncSession, 
    memory_id: uuid.UUID, 
    user_id: uuid.UUID
) -> bool:
    """기억노트 삭제"""
    result = await db.execute(
        delete(MemoryNote)
        .where(
            MemoryNote.id == memory_id,
            MemoryNote.user_id == user_id
        )
    )
    await db.commit()
    return result.rowcount > 0


async def get_memory_note_by_id(
    db: AsyncSession, 
    memory_id: uuid.UUID, 
    user_id: uuid.UUID
) -> Optional[MemoryNote]:
    """기억노트 단일 조회"""
    result = await db.execute(
        select(MemoryNote)
        .where(
            MemoryNote.id == memory_id,
            MemoryNote.user_id == user_id
        )
    )
    return result.scalar_one_or_none()