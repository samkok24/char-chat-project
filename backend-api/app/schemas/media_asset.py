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


class MediaAssetCropRequest(BaseModel):
    """미디어 자산(이미지) 크롭 요청 스키마"""
    sx: int = Field(..., ge=0, description="crop start x (px)")
    sy: int = Field(..., ge=0, description="crop start y (px)")
    sw: int = Field(..., ge=1, description="crop width (px)")
    sh: int = Field(..., ge=1, description="crop height (px)")

