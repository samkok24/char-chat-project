"""
통계 관련 Pydantic 스키마
"""

from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional


class StatsOverview(BaseModel):
    character_total: int = 0
    character_public: int = 0
    chats_total: int = 0
    unique_users_30d: int = 0
    likes_total: int = 0


class TimeSeriesPoint(BaseModel):
    date: str
    value: int = 0


class TimeSeriesResponse(BaseModel):
    metric: str = Field(default="chats")
    range: str = Field(default="7d")
    series: List[TimeSeriesPoint]


class TopCharacterItem(BaseModel):
    id: str
    name: str
    avatar_url: Optional[str] = None
    value_7d: int = 0
    series: Optional[List[TimeSeriesPoint]] = None




