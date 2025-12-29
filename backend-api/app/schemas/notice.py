"""
공지사항 관련 Pydantic 스키마
"""

from pydantic import BaseModel, Field, ConfigDict, field_validator
from typing import Optional
from datetime import datetime
import re
import uuid


def _sanitize_notice_text(value: Optional[str], max_length: Optional[int] = None) -> Optional[str]:
    """공지 텍스트 입력을 방어적으로 정리한다."""
    if value is None:
        return None
    text = re.sub(r"<[^>]*>", "", str(value)).strip()
    if max_length is not None and len(text) > max_length:
        raise ValueError(f"최대 {max_length}자까지 입력할 수 있습니다.")
    return text or None


class NoticeCreate(BaseModel):
    """공지 생성 요청"""

    title: str = Field(..., min_length=1, max_length=200)
    content: str = Field(..., min_length=1, max_length=20000)
    is_pinned: bool = False
    is_published: bool = True

    @field_validator("title", "content", mode="before")
    @classmethod
    def sanitize_fields(cls, v, info):
        max_map = {"title": 200, "content": 20000}
        return _sanitize_notice_text(v, max_map.get(info.field_name))


class NoticeUpdate(BaseModel):
    """공지 수정 요청"""

    title: Optional[str] = Field(None, min_length=1, max_length=200)
    content: Optional[str] = Field(None, min_length=1, max_length=20000)
    is_pinned: Optional[bool] = None
    is_published: Optional[bool] = None

    @field_validator("title", "content", mode="before")
    @classmethod
    def sanitize_update_fields(cls, v, info):
        if v is None:
            return None
        max_map = {"title": 200, "content": 20000}
        return _sanitize_notice_text(v, max_map.get(info.field_name))


class NoticeResponse(BaseModel):
    """공지 응답"""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    content: str
    is_pinned: bool = False
    is_published: bool = True
    created_at: datetime
    updated_at: datetime


class NoticeLatestResponse(BaseModel):
    """최신 공지 메타(점 표시 용도)"""

    latest_at: Optional[datetime] = None