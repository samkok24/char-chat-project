"""
캐릭터 관련 API 라우터
"""

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional
import uuid

from app.core.database import get_db
from app.core.security import get_current_user, get_current_active_user
from app.models.user import User
from app.schemas.character import (
    CharacterCreate, 
    CharacterUpdate, 
    CharacterResponse, 
    CharacterListResponse,
    CharacterWithCreator,
    CharacterSettingCreate,
    CharacterSettingUpdate,
    CharacterSettingResponse
)
from app.schemas.comment import (
    CommentCreate,
    CommentUpdate, 
    CommentResponse,
    CommentWithUser
)
from app.services.character_service import (
    create_character,
    get_character_by_id,
    get_characters_by_creator,
    get_public_characters,
    update_character,
    delete_character,
    create_character_setting,
    get_character_setting,
    update_character_setting,
    like_character,
    unlike_character,
    is_character_liked_by_user
)
from app.services.comment_service import (
    create_character_comment,
    get_character_comments,
    get_comment_by_id,
    update_character_comment,
    delete_character_comment
)

router = APIRouter()


@router.post("/", response_model=CharacterResponse, status_code=status.HTTP_201_CREATED)
async def create_new_character(
    character_data: CharacterCreate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """새 캐릭터 생성"""
    character = await create_character(
        db=db,
        creator_id=current_user.id,
        character_data=character_data
    )
    return character


@router.get("/", response_model=List[CharacterListResponse])
async def get_characters(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    search: Optional[str] = Query(None, max_length=100),
    creator_id: Optional[uuid.UUID] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    """캐릭터 목록 조회"""
    if creator_id:
        # 특정 사용자의 캐릭터 조회
        characters = await get_characters_by_creator(
            db=db, 
            creator_id=creator_id, 
            skip=skip, 
            limit=limit,
            search=search
        )
    else:
        # 공개 캐릭터 조회
        characters = await get_public_characters(
            db=db, 
            skip=skip, 
            limit=limit,
            search=search
        )
    
    return characters


@router.get("/my", response_model=List[CharacterListResponse])
async def get_my_characters(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """내 캐릭터 목록 조회"""
    characters = await get_characters_by_creator(
        db=db,
        creator_id=current_user.id,
        skip=skip,
        limit=limit,
        include_private=True
    )
    return characters


@router.get("/{character_id}", response_model=CharacterWithCreator)
async def get_character(
    character_id: uuid.UUID,
    current_user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """캐릭터 상세 조회"""
    character = await get_character_by_id(db, character_id)
    if not character:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="캐릭터를 찾을 수 없습니다."
        )
    
    # 비공개 캐릭터는 생성자만 조회 가능
    if not character.is_public and (not current_user or character.creator_id != current_user.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="이 캐릭터에 접근할 권한이 없습니다."
        )
    
    # CharacterResponse 형식으로 먼저 변환
    character_dict = CharacterResponse.from_orm(character).model_dump()
    
    # creator_username 추가
    character_dict["creator_username"] = character.creator.username if character.creator else None
    
    return CharacterWithCreator(**character_dict)


@router.put("/{character_id}", response_model=CharacterResponse)
async def update_character_info(
    character_id: uuid.UUID,
    character_data: CharacterUpdate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """캐릭터 정보 수정"""
    character = await get_character_by_id(db, character_id)
    if not character:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="캐릭터를 찾을 수 없습니다."
        )
    
    # 생성자만 수정 가능
    if character.creator_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="이 캐릭터를 수정할 권한이 없습니다."
        )
    
    updated_character = await update_character(db, character_id, character_data)
    return updated_character


@router.delete("/{character_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_character_info(
    character_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """캐릭터 삭제"""
    character = await get_character_by_id(db, character_id)
    if not character:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="캐릭터를 찾을 수 없습니다."
        )
    
    # 생성자만 삭제 가능
    if character.creator_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="이 캐릭터를 삭제할 권한이 없습니다."
        )
    
    await delete_character(db, character_id)


@router.post("/{character_id}/settings", response_model=CharacterSettingResponse, status_code=status.HTTP_201_CREATED)
async def create_character_settings(
    character_id: uuid.UUID,
    setting_data: CharacterSettingCreate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """캐릭터 설정 생성"""
    character = await get_character_by_id(db, character_id)
    if not character:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="캐릭터를 찾을 수 없습니다."
        )
    
    # 생성자만 설정 가능
    if character.creator_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="이 캐릭터의 설정을 변경할 권한이 없습니다."
        )
    
    setting = await create_character_setting(db, character_id, setting_data)
    return setting


@router.get("/{character_id}/settings", response_model=CharacterSettingResponse)
async def get_character_settings(
    character_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """캐릭터 설정 조회"""
    character = await get_character_by_id(db, character_id)
    if not character:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="캐릭터를 찾을 수 없습니다."
        )
    
    # 생성자만 설정 조회 가능
    if character.creator_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="이 캐릭터의 설정을 조회할 권한이 없습니다."
        )
    
    setting = await get_character_setting(db, character_id)
    if not setting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="캐릭터 설정을 찾을 수 없습니다."
        )
    
    return setting


@router.put("/{character_id}/settings", response_model=CharacterSettingResponse)
async def update_character_settings(
    character_id: uuid.UUID,
    setting_data: CharacterSettingUpdate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """캐릭터 설정 수정"""
    character = await get_character_by_id(db, character_id)
    if not character:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="캐릭터를 찾을 수 없습니다."
        )
    
    # 생성자만 설정 수정 가능
    if character.creator_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="이 캐릭터의 설정을 수정할 권한이 없습니다."
        )
    
    setting = await update_character_setting(db, character_id, setting_data)
    if not setting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="캐릭터 설정을 찾을 수 없습니다."
        )
    
    return setting


@router.post("/{character_id}/like", status_code=status.HTTP_200_OK)
async def like_character_endpoint(
    character_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """캐릭터 좋아요"""
    character = await get_character_by_id(db, character_id)
    if not character:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="캐릭터를 찾을 수 없습니다."
        )
    
    if not character.is_public:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="비공개 캐릭터에는 좋아요를 할 수 없습니다."
        )
    
    # 이미 좋아요를 눌렀는지 확인
    is_liked = await is_character_liked_by_user(db, character_id, current_user.id)
    if is_liked:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="이미 좋아요를 누른 캐릭터입니다."
        )
    
    await like_character(db, character_id, current_user.id)
    return {"message": "좋아요가 추가되었습니다."}


@router.delete("/{character_id}/like", status_code=status.HTTP_200_OK)
async def unlike_character_endpoint(
    character_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """캐릭터 좋아요 취소"""
    character = await get_character_by_id(db, character_id)
    if not character:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="캐릭터를 찾을 수 없습니다."
        )
    
    # 좋아요를 눌렀는지 확인
    is_liked = await is_character_liked_by_user(db, character_id, current_user.id)
    if not is_liked:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="좋아요를 누르지 않은 캐릭터입니다."
        )
    
    await unlike_character(db, character_id, current_user.id)
    return {"message": "좋아요가 취소되었습니다."}


@router.post("/{character_id}/comments", response_model=CommentResponse, status_code=status.HTTP_201_CREATED)
async def create_comment(
    character_id: uuid.UUID,
    comment_data: CommentCreate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """캐릭터에 댓글 작성"""
    character = await get_character_by_id(db, character_id)
    if not character:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="캐릭터를 찾을 수 없습니다."
        )
    
    if not character.is_public:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="비공개 캐릭터에는 댓글을 작성할 수 없습니다."
        )
    
    comment = await create_character_comment(db, character_id, current_user.id, comment_data)
    return comment


@router.get("/{character_id}/comments", response_model=List[CommentWithUser])
async def get_comments(
    character_id: uuid.UUID,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db)
):
    """캐릭터 댓글 목록 조회"""
    character = await get_character_by_id(db, character_id)
    if not character:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="캐릭터를 찾을 수 없습니다."
        )
    
    comments = await get_character_comments(db, character_id, skip, limit)
    
    # CommentWithUser 형식으로 변환
    comments_with_user = []
    for comment in comments:
        comment_dict = CommentResponse.from_orm(comment).model_dump()
        comment_dict["username"] = comment.user.username
        comment_dict["user_avatar_url"] = getattr(comment.user, "avatar_url", None)
        comments_with_user.append(CommentWithUser(**comment_dict))
    
    return comments_with_user


@router.put("/comments/{comment_id}", response_model=CommentResponse)
async def update_comment(
    comment_id: uuid.UUID,
    comment_data: CommentUpdate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """댓글 수정"""
    comment = await get_comment_by_id(db, comment_id)
    if not comment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="댓글을 찾을 수 없습니다."
        )
    
    # 작성자만 수정 가능
    if comment.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="이 댓글을 수정할 권한이 없습니다."
        )
    
    updated_comment = await update_character_comment(db, comment_id, comment_data)
    return updated_comment


@router.delete("/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_comment(
    comment_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """댓글 삭제"""
    comment = await get_comment_by_id(db, comment_id)
    if not comment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="댓글을 찾을 수 없습니다."
        )
    
    # 작성자만 삭제 가능
    if comment.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="이 댓글을 삭제할 권한이 없습니다."
        )
    
    await delete_character_comment(db, comment_id)

