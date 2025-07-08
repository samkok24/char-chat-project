"""
댓글 관련 Pydantic 스키마
"""

from pydantic import BaseModel, Field, ConfigDict
from datetime import datetime
import uuid


class CommentBase(BaseModel):
    """댓글 기본 스키마"""
    content: str = Field(..., min_length=1, max_length=1000)


class CommentCreate(CommentBase):
    """댓글 생성 스키마"""
    pass


class CommentUpdate(BaseModel):
    """댓글 수정 스키마"""
    content: str = Field(..., min_length=1, max_length=1000)


class CommentResponse(CommentBase):
    """댓글 응답 스키마"""
    model_config = ConfigDict(from_attributes=True)
    
    id: uuid.UUID
    character_id: uuid.UUID
    user_id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class CommentWithUser(CommentResponse):
    """사용자 정보를 포함한 댓글 응답 스키마"""
    username: str
    user_avatar_url: str | None = None 