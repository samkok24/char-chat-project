"""
댓글 관련 Pydantic 스키마
"""

from pydantic import BaseModel, Field, ConfigDict, field_validator
from datetime import datetime
import uuid
import re


def _sanitize_comment(value: str) -> str:
    text = re.sub(r'<[^>]*>', '', str(value)).strip()
    if not text:
        raise ValueError('댓글 내용을 입력해주세요.')
    if len(text) > 1000:
        raise ValueError('댓글은 최대 1000자까지 입력할 수 있습니다.')
    return text


class CommentBase(BaseModel):
    """댓글 기본 스키마"""
    content: str = Field(..., min_length=1, max_length=1000)

    @field_validator('content', mode='before')
    @classmethod
    def sanitize_content(cls, v):
        return _sanitize_comment(v)


class CommentCreate(CommentBase):
    """댓글 생성 스키마"""
    pass


class CommentUpdate(CommentBase):
    """댓글 수정 스키마"""
    pass


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


class StoryCommentResponse(CommentBase):
    """스토리 댓글 응답 스키마"""
    model_config = ConfigDict(from_attributes=True)
    
    id: uuid.UUID
    story_id: uuid.UUID
    user_id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class StoryCommentWithUser(StoryCommentResponse):
    """사용자 정보를 포함한 스토리 댓글 응답 스키마"""
    username: str
    user_avatar_url: str | None = None 