from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional
import uuid


class TagCreate(BaseModel):
    name: str = Field(..., max_length=50)
    slug: str = Field(..., max_length=50)
    emoji: Optional[str] = Field(None, max_length=10)


class TagResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    slug: str
    emoji: Optional[str]


class TagList(BaseModel):
    tags: List[TagResponse]


class CharacterTagsUpdate(BaseModel):
    tags: List[str] = Field(default_factory=list)


