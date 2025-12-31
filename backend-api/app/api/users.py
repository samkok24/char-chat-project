"""
사용자 프로필 관련 API 엔드포인트
"""
from fastapi import APIRouter, Depends, HTTPException, status, Query, Body
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, List
import uuid
import json

from app.core.database import get_db
from app.models.user import User
from app.schemas.user import UserProfileResponse
from app.schemas import StatsOverview, TimeSeriesResponse, TimeSeriesPoint, TopCharacterItem
from app.schemas.character import RecentCharacterResponse, CharacterListResponse
from app.schemas.comment import CommentResponse, CommentWithUser, StoryCommentResponse, StoryCommentWithUser
from app.services import user_service
from app.core.security import get_current_user
from app.services.comment_service import (
    get_character_comments_by_user,
    get_story_comments_by_user,
)


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
    limit: int = 10,
    page: int = 1
):
    """
    최근 대화한 캐릭터 목록을 조회합니다.
    - **limit**: 가져올 캐릭터의 최대 수 (기본값: 10)
    - **page**: 페이지 번호 (기본값: 1)
    """
    skip = (page - 1) * limit
    characters = await user_service.get_recent_characters_for_user(
        db, user_id=current_user.id, limit=limit, skip=skip
    )
    
    # Character 모델 객체를 CharacterListResponse 스키마에 맞게 변환
    # 서비스 단에서 creator 정보를 미리 join하거나, 여기서 추가 쿼리 없이 간단하게 처리
    out: List[RecentCharacterResponse] = []
    for char in characters:
        imgs = getattr(char, 'image_descriptions', [])
        if isinstance(imgs, str):
            try:
                imgs = json.loads(imgs)
            except Exception:
                imgs = []
        if isinstance(imgs, list):
            imgs = [img for img in imgs if not (isinstance(img, dict) and str(img.get('url','')).startswith('cover:'))]
        out.append(
            RecentCharacterResponse(
                creator_id=char.creator_id,
                id=char.id,
                name=char.name,
                description=getattr(char, 'description', None),
                greeting=getattr(char, 'greeting', None),
                avatar_url=getattr(char, 'avatar_url', None),
                source_type=getattr(char, 'source_type', 'ORIGINAL'),
                image_descriptions=imgs if isinstance(imgs, list) else None,
                chat_count=int(getattr(char, 'chat_count', 0) or 0),
                like_count=int(getattr(char, 'like_count', 0) or 0),
                origin_story_id=getattr(char, 'origin_story_id', None),
                is_origchat=bool(getattr(char, 'origin_story_id', None)),
                is_public=bool(getattr(char, 'is_public', True)),
                created_at=getattr(char, 'created_at', None),
                creator_username=char.creator.username if char.creator else None,
                # ✅ 최근대화/대화내역 UI에서 크리에이터 프로필 이미지를 표시하기 위한 필드
                # - 프론트는 creator_avatar_url을 사용한다.
                creator_avatar_url=getattr(char.creator, 'avatar_url', None) if getattr(char, 'creator', None) else None,
                chat_room_id=getattr(char, 'chat_room_id', None),
                last_chat_time=getattr(char, 'last_chat_time', None),
                last_message_snippet=getattr(char, 'last_message_snippet', None),
                origin_story_title=getattr(char, 'origin_story_title', None)
            )
        )
    return out


@router.get(
    "/me/characters/liked",
    response_model=List[CharacterListResponse],
    summary="내가 좋아요(관심)한 캐릭터 목록",
    description="현재 로그인한 사용자가 좋아요 또는 기존 북마크로 표시한 캐릭터 목록을 최신순으로 반환합니다."
)
async def get_my_liked_characters(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    limit: int = 20,
    page: int = 1
):
    skip = (page - 1) * limit
    characters = await user_service.get_liked_characters_for_user(
        db, user_id=current_user.id, limit=limit, skip=skip
    )
    out2: List[CharacterListResponse] = []
    for char in characters:
        imgs = getattr(char, 'image_descriptions', [])
        if isinstance(imgs, str):
            try:
                imgs = json.loads(imgs)
            except Exception:
                imgs = []
        if isinstance(imgs, list):
            imgs = [img for img in imgs if not (isinstance(img, dict) and str(img.get('url','')).startswith('cover:'))]
        out2.append(
            CharacterListResponse(
                creator_id=char.creator_id,
                id=char.id,
                name=char.name,
                description=getattr(char, 'description', None),
                greeting=getattr(char, 'greeting', None),
                avatar_url=getattr(char, 'avatar_url', None),
                source_type=getattr(char, 'source_type', 'ORIGINAL'),
                image_descriptions=imgs if isinstance(imgs, list) else None,
                chat_count=int(getattr(char, 'chat_count', 0) or 0),
                like_count=int(getattr(char, 'like_count', 0) or 0),
                origin_story_id=getattr(char, 'origin_story_id', None),
                is_origchat=bool(getattr(char, 'origin_story_id', None)),
                is_public=bool(getattr(char, 'is_public', True)),
                created_at=getattr(char, 'created_at', None),
                creator_username=char.creator.username if char.creator else None,
                creator_avatar_url=char.creator.avatar_url if char.creator else None,
            )
        )
    return out2

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


@router.put(
    "/users/{user_id}",
    response_model=UserProfileResponse,
    summary="사용자 프로필 수정",
    description="닉네임, 아바타 URL, 소개를 수정합니다 (본인만 가능)."
)
async def update_user_profile_endpoint(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    username: str | None = Body(None),
    avatar_url: str | None = Body(None),
    bio: str | None = Body(None),
):
    if current_user.id != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="본인만 수정할 수 있습니다.")
    await user_service.update_user_profile(
        db,
        user_id,
        username=username,
        avatar_url=avatar_url,
        bio=bio,
    )
    # 수정된 프로필 반환
    profile_data = await user_service.get_user_profile(db, str(user_id))
    if not profile_data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="해당 사용자를 찾을 수 없습니다.")
    return profile_data


@router.get(
    "/users/{user_id}/comments/characters",
    response_model=List[CommentWithUser],
    summary="사용자가 작성한 캐릭터 댓글 목록",
    description="지정된 사용자가 작성한 캐릭터 댓글을 최신순으로 반환합니다."
)
async def get_user_character_comments(
    user_id: uuid.UUID,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db)
):
    comments = await get_character_comments_by_user(db, user_id, skip, limit)
    results: list[CommentWithUser] = []
    for c in comments:
        c_dict = CommentResponse.from_orm(c).model_dump()
        c_dict["username"] = c.user.username
        c_dict["user_avatar_url"] = getattr(c.user, "avatar_url", None)
        results.append(CommentWithUser(**c_dict))
    return results


@router.get(
    "/users/{user_id}/comments/stories",
    response_model=List[StoryCommentWithUser],
    summary="사용자가 작성한 스토리 댓글 목록",
    description="지정된 사용자가 작성한 스토리 댓글을 최신순으로 반환합니다."
)
async def get_user_story_comments(
    user_id: uuid.UUID,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db)
):
    comments = await get_story_comments_by_user(db, user_id, skip, limit)
    results: list[StoryCommentWithUser] = []
    for c in comments:
        c_dict = StoryCommentResponse.from_orm(c).model_dump()
        c_dict["username"] = c.user.username
        c_dict["user_avatar_url"] = getattr(c.user, "avatar_url", None)
        results.append(StoryCommentWithUser(**c_dict))
    return results


# ----- 통계 API (경량 버전) -----
@router.get("/users/{user_id}/stats/overview", response_model=StatsOverview)
async def get_user_stats_overview(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db)
):
    return await user_service.get_stats_overview(db, user_id)


@router.get("/users/{user_id}/stats/timeseries", response_model=TimeSeriesResponse)
async def get_user_stats_timeseries(
    user_id: uuid.UUID,
    metric: str = Query("chats"),
    range: str = Query("7d"),
    db: AsyncSession = Depends(get_db)
):
    return await user_service.get_stats_timeseries(db, user_id, metric=metric, range_str=range)


@router.get("/users/{user_id}/stats/top-characters", response_model=list[TopCharacterItem])
async def get_user_top_characters(
    user_id: uuid.UUID,
    metric: str = Query("chats"),
    range: str = Query("7d"),
    limit: int = Query(5, ge=1, le=20),
    db: AsyncSession = Depends(get_db)
):
    return await user_service.get_stats_top_characters(db, user_id, metric=metric, range_str=range, limit=limit)

@router.get("/me/model-settings")
async def get_user_model_settings(
    current_user: User = Depends(get_current_user)
):
    """현재 사용자의 AI 모델 설정 조회"""
    return {
        "preferred_model": current_user.preferred_model,
        "preferred_sub_model": current_user.preferred_sub_model,
        "response_length_pref": getattr(current_user, 'response_length_pref', 'medium')
    }

@router.put("/me/model-settings")
async def update_user_model_settings(
    model: str,
    sub_model: str,
    response_length: str | None = Query(None, pattern="^(short|medium|long)$"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """사용자의 AI 모델/길이 설정 업데이트"""
    await user_service.update_user_model_settings(
        db, current_user.id, model, sub_model
    )
    if response_length in {"short", "medium", "long"}:
        await user_service.update_user_response_length_pref(db, current_user.id, response_length)
    return {"message": "설정이 업데이트되었습니다."}