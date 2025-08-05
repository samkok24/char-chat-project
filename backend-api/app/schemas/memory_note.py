"""
기억노트 스키마 - API 요청/응답 모델
"""

from pydantic import BaseModel, Field
from typing import Optional
import uuid
from datetime import datetime


class MemoryNoteCreate(BaseModel):
    """기억노트 생성 요청"""
    character_id: uuid.UUID
    title: str = Field(..., min_length=1, max_length=200)
    content: str = Field(..., max_length=1000)
    is_active: bool = True


class MemoryNoteUpdate(BaseModel):
    """기억노트 수정 요청"""
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    content: Optional[str] = Field(None, max_length=1000)
    is_active: Optional[bool] = None


class MemoryNoteResponse(BaseModel):
    """기억노트 응답"""
    id: uuid.UUID
    user_id: uuid.UUID
    character_id: uuid.UUID
    title: str
    content: str
    is_active: bool
    char_count: str
    order_index: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class MemoryNotesListResponse(BaseModel):
    """기억노트 목록 응답"""
    memory_notes: list[MemoryNoteResponse]
    total_count: int