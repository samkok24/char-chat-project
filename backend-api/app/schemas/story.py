"""
스토리 관련 Pydantic 스키마
"""

from pydantic import BaseModel, Field, ConfigDict, field_serializer, field_validator
from typing import Optional, List
from datetime import datetime
import uuid
import json
import re


def _sanitize_story_text(value: Optional[str], max_length: Optional[int] = None) -> Optional[str]:
    if value is None:
        return None
    text = re.sub(r'<[^>]*>', '', str(value)).strip()
    if max_length is not None and len(text) > max_length:
        raise ValueError(f'최대 {max_length}자까지 입력할 수 있습니다.')
    return text or None


class StoryBase(BaseModel):
    """스토리 기본 스키마 (응답용은 최소 길이 제약 완화)"""
    title: str = Field(..., min_length=1, max_length=200)
    content: str = Field(..., min_length=1, max_length=50000)
    keywords: Optional[List[str]] = Field(None, max_items=10)
    genre: Optional[str] = Field(None, max_length=50)
    is_public: bool = True
    is_webtoon: bool = False
    cover_url: Optional[str] = None

    @field_validator('title', 'content', 'genre', mode='before')
    @classmethod
    def sanitize_story_fields(cls, v, info):
        max_map = {'title': 200, 'content': 50000, 'genre': 50}
        return _sanitize_story_text(v, max_map.get(info.field_name))

    @field_validator('keywords', mode='before')
    @classmethod
    def sanitize_keywords(cls, v):
        if v is None:
            return None
        if not isinstance(v, list):
            raise ValueError('keywords는 배열이어야 합니다.')
        cleaned = []
        for kw in v[:10]:
            text = _sanitize_story_text(kw, 50)
            if text:
                cleaned.append(text)
        return cleaned


class StoryCreate(StoryBase):
    """스토리 생성 스키마 (요청용: 본문 최소 20자)"""
    content: str = Field(..., min_length=20, max_length=50000)
    character_id: Optional[uuid.UUID] = None


class StoryUpdate(BaseModel):
    """스토리 업데이트 스키마"""
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    content: Optional[str] = Field(None, min_length=20, max_length=50000)
    keywords: Optional[List[str]] = Field(None, max_items=10)
    genre: Optional[str] = Field(None, max_length=50)
    is_public: Optional[bool] = None
    is_webtoon: Optional[bool] = None
    cover_url: Optional[str] = None

    @field_validator('title', 'content', 'genre', mode='before')
    @classmethod
    def sanitize_story_update(cls, v, info):
        max_map = {'title': 200, 'content': 50000, 'genre': 50}
        return _sanitize_story_text(v, max_map.get(info.field_name))

    @field_validator('keywords', mode='before')
    @classmethod
    def sanitize_update_keywords(cls, v):
        if v is None:
            return None
        if not isinstance(v, list):
            raise ValueError('keywords는 배열이어야 합니다.')
        cleaned = []
        for kw in v[:10]:
            text = _sanitize_story_text(kw, 50)
            if text:
                cleaned.append(text)
        return cleaned


class StoryResponse(StoryBase):
    """스토리 응답 스키마"""
    model_config = ConfigDict(from_attributes=True)
    
    id: uuid.UUID
    creator_id: uuid.UUID
    character_id: Optional[uuid.UUID]
    is_origchat: bool
    like_count: int
    view_count: int
    comment_count: int
    created_at: datetime
    updated_at: datetime
    # 태그 슬러그 목록
    tags: list[str] = Field(default_factory=list)
    # ✅ 작품공지(작가 공지) - 텍스트만
    announcements: List[dict] = Field(default_factory=list)


class StoryListItem(BaseModel):
    """스토리 목록용 항목 스키마 (가벼운 필드만)"""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    genre: Optional[str]
    is_public: bool = True
    is_origchat: bool = False
    is_webtoon: bool = False
    like_count: int
    view_count: int
    comment_count: int
    created_at: datetime
    creator_username: Optional[str] = None
    creator_avatar_url: Optional[str] = None
    character_name: Optional[str] = None
    cover_url: Optional[str] = None
    # 목록 카드에서 사용할 간단 소개(요약)
    excerpt: Optional[str] = None
    # 태그 슬러그 목록
    tags: list[str] = Field(default_factory=list)
    episode_count: int = 0
    extracted_characters: list = Field(default_factory=list)
    latest_chapter_created_at: Optional[datetime] = None


class StoryListResponse(BaseModel):
    """스토리 목록 컨테이너 응답"""
    stories: List[StoryListItem]
    total: int
    skip: int
    limit: int


class StoryWithDetails(StoryResponse):
    """상세 정보를 포함한 스토리 응답 스키마"""
    creator_username: str
    creator_avatar_url: Optional[str] = None
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


class StoryStreamRequest(BaseModel):
    """스토리 스트림 요청 스키마"""
    prompt: str = Field(..., min_length=100, max_length=5000)
    keywords: List[str] = Field(..., min_items=1, max_items=10)
    model_name: str = Field(..., max_length=100)
    max_tokens: int = Field(..., ge=10, le=10000)
    temperature: float = Field(..., ge=0.0, le=1.0)
    top_p: float = Field(..., ge=0.0, le=1.0)
    n: int = Field(..., ge=1, le=10)
    stream: bool = True


# ---- 회차(Chapters) 스키마 ----
class ChapterBase(BaseModel):
    story_id: uuid.UUID
    no: int = Field(..., ge=0)
    title: Optional[str] = Field(None, max_length=200)
    content: str = Field(..., min_length=1, max_length=50000)
    image_url: Optional[List[str]] = None  # 여러 이미지 URL 배열


class ChapterCreate(ChapterBase):
    pass


class ChapterUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    content: Optional[str] = Field(None, min_length=1, max_length=50000)
    image_url: Optional[List[str]] = None  # 여러 이미지 URL 배열

    @field_validator('title', 'content', mode='before')
    @classmethod
    def sanitize_chapter_text(cls, v, info):
        max_map = {'title': 200, 'content': 50000}
        return _sanitize_story_text(v, max_map.get(info.field_name))


class ChapterResponse(ChapterBase):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    view_count: int = 0
    created_at: datetime
    
    @field_validator('image_url', mode='before')
    @classmethod
    def parse_image_url(cls, v):
        """DB에서 가져온 image_url을 배열로 변환 (하위 호환)"""
        if v is None:
            return None
        if isinstance(v, list):
            return v
        if isinstance(v, str):
            # JSON 배열인지 확인
            try:
                parsed = json.loads(v)
                if isinstance(parsed, list):
                    return parsed
                # 단일 문자열인 경우 (하위 호환)
                return [parsed] if parsed else None
            except (json.JSONDecodeError, TypeError):
                # JSON이 아닌 단일 URL 문자열인 경우 (하위 호환)
                return [v] if v else None
        return None
    
    @field_serializer('image_url')
    def serialize_image_url(self, value):
        """응답 시 배열 그대로 반환"""
        return value


class StoryExtractedCharacterUpdate(BaseModel):
    """스토리 추출 캐릭터 업데이트 스키마 (이미지, 이름 등)"""
    avatar_url: Optional[str] = Field(None, max_length=1000)
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = None
