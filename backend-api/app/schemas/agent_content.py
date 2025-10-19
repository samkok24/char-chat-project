"""
에이전트 콘텐츠 스키마
"""

from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from uuid import UUID


class AgentContentCreate(BaseModel):
    """에이전트 콘텐츠 생성 요청"""
    session_id: Optional[str] = None
    message_id: Optional[str] = None
    story_mode: str  # 'snap' | 'genre'
    user_text: Optional[str] = None
    user_image_url: Optional[str] = None
    generated_text: str
    generated_image_urls: Optional[List[str]] = None


class AgentContentResponse(BaseModel):
    """에이전트 콘텐츠 응답"""
    id: UUID
    user_id: UUID
    session_id: Optional[str]
    message_id: Optional[str]
    story_mode: str
    user_text: Optional[str]
    user_image_url: Optional[str]
    generated_text: str
    generated_image_urls: Optional[List[str]]
    is_published: bool = False
    published_at: Optional[datetime] = None
    created_at: datetime
    
    class Config:
        from_attributes = True


class AgentContentListResponse(BaseModel):
    """에이전트 콘텐츠 목록 응답"""
    items: List[AgentContentResponse]
    total: int
    page: int
    limit: int


class AgentContentPublish(BaseModel):
    """에이전트 콘텐츠 발행 요청"""
    is_public: bool = True

