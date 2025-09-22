from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime


class MediaAssetResponse(BaseModel):
    id: str
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    url: str
    width: Optional[int] = None
    height: Optional[int] = None
    is_primary: bool = False
    order_index: int = 0
    status: str = "ready"
    provider: Optional[str] = None
    model: Optional[str] = None
    seed: Optional[str] = None
    ratio: Optional[str] = None
    phash: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class MediaAssetListResponse(BaseModel):
    items: List[MediaAssetResponse] = Field(default_factory=list)


