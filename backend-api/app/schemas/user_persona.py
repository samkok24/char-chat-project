"""
유저 페르소나 스키마 - API 요청/응답 모델
"""

from pydantic import BaseModel, Field
from typing import Optional
import uuid
from datetime import datetime


class UserPersonaCreate(BaseModel):
    """유저 페르소나 생성 요청"""
    name: str = Field(..., min_length=1, max_length=100)
    description: str = Field(..., min_length=1, max_length=1000)
    is_default: bool = False
    apply_scope: str = Field(default='all', pattern='^(all|character|origchat)$')  # 적용 범위


class UserPersonaUpdate(BaseModel):
    """유저 페르소나 수정 요청"""
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = Field(None, min_length=1, max_length=1000)
    is_default: Optional[bool] = None
    apply_scope: Optional[str] = Field(None, pattern='^(all|character|origchat)$')  # 적용 범위


class UserPersonaResponse(BaseModel):
    """유저 페르소나 응답"""
    id: uuid.UUID
    user_id: uuid.UUID
    name: str
    description: str
    is_active: bool
    is_default: bool
    apply_scope: str = 'all'  # 적용 범위
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class UserPersonasListResponse(BaseModel):
    """유저 페르소나 목록 응답"""
    personas: list[UserPersonaResponse]
    total_count: int
    active_persona: Optional[UserPersonaResponse] = None


class SetActivePersonaRequest(BaseModel):
    """활성 페르소나 설정 요청"""
    persona_id: uuid.UUID