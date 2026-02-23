"""
기억노트 API 엔드포인트
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List
import uuid

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.services import memory_note_service
from app.schemas.memory_note import (
    MemoryNoteCreate,
    MemoryNoteUpdate, 
    MemoryNoteResponse,
    MemoryNotesListResponse
)

router = APIRouter()


@router.get("/character/{character_id}", response_model=MemoryNotesListResponse)
async def get_memory_notes_for_character(
    character_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """특정 캐릭터의 기억노트 목록 조회"""
    memory_notes = await memory_note_service.get_memory_notes_by_character(
        db, current_user.id, character_id
    )
    
    return MemoryNotesListResponse(
        memory_notes=memory_notes,
        total_count=len(memory_notes)
    )


@router.post("", response_model=MemoryNoteResponse, status_code=status.HTTP_201_CREATED)
async def create_memory_note(
    memory_data: MemoryNoteCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """기억노트 생성"""
    # 내용 길이 검증 (1000자 제한)
    if len(memory_data.content) > 1000:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="기억노트 내용은 1000자를 초과할 수 없습니다."
        )
    
    memory_note = await memory_note_service.create_memory_note(
        db, current_user.id, memory_data
    )
    return memory_note


@router.put("/{memory_id}", response_model=MemoryNoteResponse)
async def update_memory_note(
    memory_id: uuid.UUID,
    memory_data: MemoryNoteUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """기억노트 수정"""
    # 내용 길이 검증 (1000자 제한)
    if memory_data.content and len(memory_data.content) > 1000:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="기억노트 내용은 1000자를 초과할 수 없습니다."
        )
    
    memory_note = await memory_note_service.update_memory_note(
        db, memory_id, current_user.id, memory_data
    )
    
    if not memory_note:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="기억노트를 찾을 수 없습니다."
        )
    
    return memory_note


@router.delete("/{memory_id}")
async def delete_memory_note(
    memory_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """기억노트 삭제"""
    success = await memory_note_service.delete_memory_note(
        db, memory_id, current_user.id
    )
    
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="기억노트를 찾을 수 없습니다."
        )
    
    return {"message": "기억노트가 삭제되었습니다."}


@router.get("/{memory_id}", response_model=MemoryNoteResponse)
async def get_memory_note(
    memory_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """기억노트 단일 조회"""
    memory_note = await memory_note_service.get_memory_note_by_id(
        db, memory_id, current_user.id
    )
    
    if not memory_note:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="기억노트를 찾을 수 없습니다."
        )
    
    return memory_note