"""
사용자 프로필 관련 API 엔드포인트
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, List
import uuid

from app.core.database import get_db
from app.models.user import User
from app.schemas.user import UserProfileResponse
from app.schemas.character import RecentCharacterResponse
from app.services import user_service
from app.core.security import get_current_user


router = APIRouter()

@router.get(
    "/me/characters/recent",
    response_model=List[RecentCharacterResponse],
    summary="최근 대화한 캐릭터 목록 조회",
    description="현재 로그인한 사용자가 최근에 대화한 캐릭터 목록을 시간 역순으로 가져옵니다."
)
async def get_my_recent_characters(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    limit: int = 10
):
    """
    최근 대화한 캐릭터 목록을 조회합니다.
    - **limit**: 가져올 캐릭터의 최대 수 (기본값: 10)
    """
    characters = await user_service.get_recent_characters_for_user(
        db, user_id=current_user.id, limit=limit
    )
    
    # Character 모델 객체를 CharacterListResponse 스키마에 맞게 변환
    # 서비스 단에서 creator 정보를 미리 join하거나, 여기서 추가 쿼리 없이 간단하게 처리
    return [
        RecentCharacterResponse(
            id=char.id,
            name=char.name,
            description=char.description,
            greeting=char.greeting,
            avatar_url=char.avatar_url,
            chat_count=char.chat_count,
            like_count=char.like_count,
            is_public=char.is_public,
            created_at=char.created_at,
            creator_username=char.creator.username if char.creator else None,
            chat_room_id=char.chat_room_id,
            last_chat_time=char.last_chat_time,
            last_message_snippet=char.last_message_snippet
        ) for char in characters
    ]

@router.get(
    "/users/{user_id}",
    response_model=UserProfileResponse,
    summary="사용자 프로필 조회",
    description="지정된 ID를 가진 사용자의 공개 프로필 정보와 통계 데이터를 조회합니다."
)
async def read_user_profile(
    user_id: str, # 경로 파라미터는 보통 문자열로 받습니다.
    db: AsyncSession = Depends(get_db)
):
    """
    사용자 프로필 정보를 조회합니다.
    - **user_id**: 조회할 사용자의 UUID.
    """
    profile_data = await user_service.get_user_profile(db, user_id=user_id)
    if not profile_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="해당 사용자를 찾을 수 없습니다."
        )
    return profile_data