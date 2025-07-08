"""
사용자 관련 Pydantic 스키마
"""

from pydantic import BaseModel, EmailStr, Field, ConfigDict
from typing import Optional
from datetime import datetime
import uuid


class UserBase(BaseModel):
    """사용자 기본 스키마"""
    email: EmailStr
    username: str = Field(..., min_length=2, max_length=100)


class UserCreate(UserBase):
    """사용자 생성 스키마"""
    password: str = Field(..., min_length=8, max_length=100)


class UserUpdate(BaseModel):
    """사용자 업데이트 스키마"""
    username: Optional[str] = Field(None, min_length=2, max_length=100)
    password: Optional[str] = Field(None, min_length=8, max_length=100)


class UserLogin(BaseModel):
    """사용자 로그인 스키마"""
    email: EmailStr
    password: str


class UserResponse(UserBase):
    """사용자 응답 스키마"""
    model_config = ConfigDict(from_attributes=True)
    
    id: uuid.UUID
    is_active: bool
    is_verified: bool
    created_at: datetime
    updated_at: datetime


class UserProfile(UserResponse):
    """사용자 프로필 스키마 (추가 정보 포함)"""
    character_count: Optional[int] = 0
    story_count: Optional[int] = 0

