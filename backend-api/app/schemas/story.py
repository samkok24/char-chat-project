"""
스토리 관련 Pydantic 스키마
"""

from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List
from datetime import datetime
import uuid


class StoryBase(BaseModel):
    """스토리 기본 스키마"""
    title: str = Field(..., min_length=1, max_length=200)
    content: str = Field(..., min_length=100, max_length=50000)
    keywords: Optional[List[str]] = Field(None, max_items=10)
    genre: Optional[str] = Field(None, max_length=50)
    is_public: bool = True


class StoryCreate(StoryBase):
    """스토리 생성 스키마"""
    character_id: Optional[uuid.UUID] = None


class StoryUpdate(BaseModel):
    """스토리 업데이트 스키마"""
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    content: Optional[str] = Field(None, min_length=100, max_length=50000)
    keywords: Optional[List[str]] = Field(None, max_items=10)
    genre: Optional[str] = Field(None, max_length=50)
    is_public: Optional[bool] = None


class StoryResponse(StoryBase):
    """스토리 응답 스키마"""
    model_config = ConfigDict(from_attributes=True)
    
    id: uuid.UUID
    creator_id: uuid.UUID
    character_id: Optional[uuid.UUID]
    like_count: int
    view_count: int
    created_at: datetime
    updated_at: datetime


class StoryListResponse(BaseModel):
    """스토리 목록 응답 스키마"""
    model_config = ConfigDict(from_attributes=True)
    
    id: uuid.UUID
    title: str
    genre: Optional[str]
    keywords: Optional[List[str]]
    like_count: int
    view_count: int
    created_at: datetime
    creator_username: str
    character_name: Optional[str]


class StoryWithDetails(StoryResponse):
    """상세 정보를 포함한 스토리 응답 스키마"""
    creator_username: str
    character_name: Optional[str]
    is_liked: Optional[bool] = False  # 현재 사용자가 좋아요를 눌렀는지


class StoryGenerationRequest(BaseModel):
    """스토리 생성 요청 스키마"""
    keywords: List[str] = Field(..., min_items=1, max_items=10)
    character_id: Optional[uuid.UUID] = None
    genre: Optional[str] = Field(None, max_length=50)
    length: Optional[str] = Field("medium", pattern="^(short|medium|long)$")
    tone: Optional[str] = Field("neutral", max_length=50)


class StoryGenerationResponse(BaseModel):
    """스토리 생성 응답 스키마"""
    title: str
    content: str
    keywords: List[str]
    genre: Optional[str]
    estimated_reading_time: int  # 예상 읽기 시간 (분)

