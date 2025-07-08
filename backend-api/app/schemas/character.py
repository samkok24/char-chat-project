"""
캐릭터 관련 Pydantic 스키마
"""

from pydantic import BaseModel, Field, ConfigDict, computed_field
from typing import Optional
from datetime import datetime
from decimal import Decimal
import uuid


class CharacterBase(BaseModel):
    """캐릭터 기본 스키마"""
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=1000)
    personality: Optional[str] = Field(None, max_length=2000)
    background_story: Optional[str] = Field(None, max_length=5000)
    avatar_url: Optional[str] = Field(None, max_length=500)
    is_public: bool = True


class CharacterCreate(CharacterBase):
    """캐릭터 생성 스키마"""
    pass


class CharacterUpdate(BaseModel):
    """캐릭터 업데이트 스키마"""
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=1000)
    personality: Optional[str] = Field(None, max_length=2000)
    background_story: Optional[str] = Field(None, max_length=5000)
    avatar_url: Optional[str] = Field(None, max_length=500)
    is_public: Optional[bool] = None


class CharacterSettingBase(BaseModel):
    """캐릭터 설정 기본 스키마"""
    system_prompt: Optional[str] = Field(None, max_length=5000)
    temperature: Optional[Decimal] = Field(0.7, ge=0.0, le=2.0)
    max_tokens: Optional[int] = Field(1000, ge=1, le=4000)
    ai_model: Optional[str] = Field("gemini-pro", max_length=50)


class CharacterSettingCreate(CharacterSettingBase):
    """캐릭터 설정 생성 스키마"""
    pass


class CharacterSettingUpdate(CharacterSettingBase):
    """캐릭터 설정 업데이트 스키마"""
    pass


class CharacterSettingResponse(CharacterSettingBase):
    """캐릭터 설정 응답 스키마"""
    model_config = ConfigDict(from_attributes=True)
    
    id: uuid.UUID
    character_id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class CharacterResponse(CharacterBase):
    """캐릭터 응답 스키마"""
    model_config = ConfigDict(from_attributes=True)
    
    id: uuid.UUID
    creator_id: uuid.UUID
    is_active: bool
    chat_count: int
    like_count: int
    created_at: datetime
    updated_at: datetime
    # settings: Optional[CharacterSettingResponse] = None # 이 필드를 제거하여 문제 해결


class CharacterListResponse(BaseModel):
    """캐릭터 목록 응답 스키마"""
    model_config = ConfigDict(from_attributes=True)
    
    id: uuid.UUID
    name: str
    description: Optional[str]
    avatar_url: Optional[str]
    chat_count: int
    like_count: int
    is_public: bool
    created_at: datetime


class CharacterWithCreator(CharacterResponse):
    """캐릭터 정보 + 생성자 정보"""
    creator_username: Optional[str] = None

