"""
사용자 관련 Pydantic 스키마
"""

from pydantic import BaseModel, EmailStr, Field, ConfigDict
from typing import Optional, Literal, List
from datetime import datetime
import uuid


class UserBase(BaseModel):
    """사용자 기본 스키마"""
    email: EmailStr
    username: str = Field(..., min_length=2, max_length=100)
    gender: Literal['male','female']


class UserCreate(UserBase):
    """사용자 생성 스키마"""
    password: str = Field(..., min_length=8, max_length=100)


class UserUpdate(BaseModel):
    """사용자 업데이트 스키마"""
    username: Optional[str] = Field(None, min_length=2, max_length=100)
    password: Optional[str] = Field(None, min_length=8, max_length=100)
    gender: Optional[Literal['male','female']] = None


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
    is_admin: bool = False
    avatar_url: Optional[str] = None
    bio: Optional[str] = None
    created_at: datetime
    updated_at: datetime

class UserProfileResponse(UserResponse):
    """
    사용자 프로필 페이지를 위한 스키마 (통계 정보 포함)
    """
    character_count: int = 0
    total_chat_count: int = 0
    total_like_count: int = 0   
    # 보유 루비(포인트)는 별도의 API로 조회하는 것이 더 적합할 수 있음 (향후 고려)
    # point_balance: int = 0

class UserProfile(UserResponse):
    """사용자 프로필 스키마 (추가 정보 포함)"""
    character_count: Optional[int] = 0
    story_count: Optional[int] = 0


# ===== 관리자용: 회원 목록(페이지네이션) =====
class AdminUserListItem(BaseModel):
    """관리자 페이지에서 보여줄 회원 1명 요약"""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: EmailStr
    username: str
    is_admin: bool = False
    created_at: datetime
    # ⚠️ 엄밀한 로그인 기록 컬럼이 없어, 현재는 "최근 활동(채팅 기준)" 시간을 내려준다.
    last_login_at: Optional[datetime] = None

    # 누적 지표
    created_character_count: int = 0
    used_chat_count: int = 0
    used_view_count: int = 0


class AdminUserListResponse(BaseModel):
    total: int = 0
    skip: int = 0
    limit: int = 100
    items: List[AdminUserListItem] = []

