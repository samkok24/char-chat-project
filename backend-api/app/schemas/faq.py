"""
FAQ 관련 Pydantic 스키마
"""

from pydantic import BaseModel, Field, ConfigDict, field_validator
from typing import Optional
from datetime import datetime
import re
import uuid


def _sanitize_faq_text(value: Optional[str], max_length: Optional[int] = None) -> Optional[str]:
    """FAQ 텍스트 입력을 방어적으로 정리한다."""
    if value is None:
        return None
    text = re.sub(r"<[^>]*>", "", str(value)).strip()
    if max_length is not None and len(text) > max_length:
        raise ValueError(f"최대 {max_length}자까지 입력할 수 있습니다.")
    return text or None


class FAQItemCreate(BaseModel):
    """FAQ 생성 요청(관리자)"""

    category: str = Field(..., min_length=1, max_length=50)
    question: str = Field(..., min_length=1, max_length=300)
    answer: str = Field(..., min_length=1, max_length=20000)
    order_index: int = Field(0, ge=0, le=9999)
    is_published: bool = True

    @field_validator("category", "question", "answer", mode="before")
    @classmethod
    def sanitize_fields(cls, v, info):
        max_map = {"category": 50, "question": 300, "answer": 20000}
        return _sanitize_faq_text(v, max_map.get(info.field_name))


class FAQItemUpdate(BaseModel):
    """FAQ 수정 요청(관리자)"""

    category: Optional[str] = Field(None, min_length=1, max_length=50)
    question: Optional[str] = Field(None, min_length=1, max_length=300)
    answer: Optional[str] = Field(None, min_length=1, max_length=20000)
    order_index: Optional[int] = Field(None, ge=0, le=9999)
    is_published: Optional[bool] = None

    @field_validator("category", "question", "answer", mode="before")
    @classmethod
    def sanitize_update_fields(cls, v, info):
        if v is None:
            return None
        max_map = {"category": 50, "question": 300, "answer": 20000}
        return _sanitize_faq_text(v, max_map.get(info.field_name))


class FAQItemResponse(BaseModel):
    """FAQ 응답"""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    category: str
    question: str
    answer: str
    order_index: int = 0
    is_published: bool = True
    created_at: datetime
    updated_at: datetime



