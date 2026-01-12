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
        """
        공지 수정 입력 방어 정리(중요)
        
        의도:
        - 업데이트는 Optional 필드라서, validator가 빈 값을 None으로 바꾸면
          '필드 미전달'로 간주되어 DB 업데이트가 조용히 스킵될 수 있다.
        - 운영에서 "저장했는데 내용이 안 바뀜"으로 보이는 가장 흔한 원인 중 하나라,
          업데이트에서는 '실제 입력이 있었는데 결과가 빈 값'이면 명확히 422를 내려준다.
        """
        if v is None:
            return None
        max_map = {"title": 200, "content": 20000}
        sanitized = _sanitize_notice_text(v, max_map.get(info.field_name))
        if sanitized is None:
            # 사용자에게 원인을 명확히 전달(422)
            if info.field_name == "title":
                raise ValueError("제목을 입력해주세요.")
            if info.field_name == "content":
                raise ValueError("내용을 입력해주세요.")
        return sanitized


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