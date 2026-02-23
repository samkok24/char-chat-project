"""
FAQ 카테고리(큰 항목) Pydantic 스키마
"""

from pydantic import BaseModel, Field, ConfigDict, field_validator
from typing import Optional
from datetime import datetime
import re


def _sanitize_category_text(value: Optional[str], max_length: int) -> Optional[str]:
    """카테고리 텍스트 입력을 방어적으로 정리한다."""
    if value is None:
        return None
    text = re.sub(r"<[^>]*>", "", str(value)).strip()
    if len(text) > max_length:
        raise ValueError(f"최대 {max_length}자까지 입력할 수 있습니다.")
    return text or None


class FAQCategoryUpdate(BaseModel):
    """FAQ 카테고리 수정 요청(관리자)"""

    title: str = Field(..., min_length=1, max_length=100)
    order_index: Optional[int] = Field(None, ge=0, le=9999)

    @field_validator("title", mode="before")
    @classmethod
    def sanitize_title(cls, v):
        text = _sanitize_category_text(v, 100)
        if not text:
            raise ValueError("카테고리명을 입력해주세요.")
        return text


class FAQCategoryResponse(BaseModel):
    """FAQ 카테고리 응답"""

    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    order_index: int = 0
    created_at: datetime
    updated_at: datetime


