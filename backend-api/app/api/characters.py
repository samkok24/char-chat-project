"""
캐릭터 관련 API 라우터 - CAVEDUCK 스타일 고급 캐릭터 생성
"""

from fastapi import APIRouter, Depends, HTTPException, status, Query, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional
import uuid
from datetime import datetime, timezone
from app.core.config import settings
import json
import logging

logger = logging.getLogger(__name__)

from app.core.database import get_db
from app.core.security import get_current_user, get_current_active_user
from app.core.security import get_current_user_optional  # 진짜 optional 의존성 사용
from app.models.user import User
from app.models.character import Character  # Character 모델 import 추가
from app.schemas.character import (
    # 🔥 CAVEDUCK 스타일 고급 스키마
    CharacterCreateRequest,
    CharacterUpdateRequest,
    CharacterDetailResponse,
    CharacterExampleDialogueResponse,
    WorldSettingCreate,
    WorldSettingResponse,
    CustomModuleCreate,
    CustomModuleResponse,
    
    # 레거시 호환성 스키마
    CharacterCreate, 
    CharacterUpdate, 
    CharacterResponse, 
    CharacterListResponse,
    CharacterWithCreator,
    CharacterSettingResponse,
    CharacterSettingCreate,  # 추가
    CharacterSettingUpdate   # 추가
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
    is_character_liked_by_user,
    sync_character_chat_count,
    # 🔥 CAVEDUCK 스타일 고급 서비스
    create_advanced_character,
    update_advanced_character,
    get_advanced_character_by_id,
    get_character_example_dialogues,
    update_character_public_status, # 서비스 함수 임포트 추가
    increment_character_chat_count,
)
from app.schemas.tag import CharacterTagsUpdate, TagResponse
from app.models.tag import Tag, CharacterTag
from app.models.story_extracted_character import StoryExtractedCharacter
from sqlalchemy import update as sql_update
from sqlalchemy import select, delete, insert
from app.services.comment_service import (
    create_character_comment,
    get_character_comments,
    get_comment_by_id,
    update_character_comment,
    delete_character_comment
)

router = APIRouter()

# 🔥 CAVEDUCK 스타일 고급 캐릭터 생성 API

@router.post("/advanced", response_model=CharacterDetailResponse, status_code=status.HTTP_201_CREATED)
async def create_advanced_character_endpoint(
    character_data: CharacterCreateRequest,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """CAVEDUCK 스타일 고급 캐릭터 생성 (5단계)"""
    try:
        # 🔥 실제 고급 캐릭터 생성 서비스 호출
        character = await create_advanced_character(
            db=db,
            creator_id=current_user.id,
            character_data=character_data
        )
        
        # 완전한 상세 정보 반환
        return await convert_character_to_detail_response(character, db)
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"캐릭터 생성 중 오류가 발생했습니다: {str(e)}"
        )


@router.put("/advanced/{character_id}", response_model=CharacterDetailResponse)
async def update_advanced_character_endpoint(
    character_id: uuid.UUID,
    character_data: CharacterUpdateRequest,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """CAVEDUCK 스타일 고급 캐릭터 수정"""
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
    
    try:
        # 🔥 실제 고급 캐릭터 수정 서비스 호출
        updated_character = await update_advanced_character(
            db=db,
            character_id=character_id,
            character_data=character_data
        )
        
        if not updated_character:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="캐릭터를 찾을 수 없습니다."
            )
        
        return await convert_character_to_detail_response(updated_character, db)
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"캐릭터 수정 중 오류가 발생했습니다: {str(e)}"
        )


@router.get("/advanced/{character_id}", response_model=CharacterDetailResponse)
async def get_advanced_character_detail(
    character_id: uuid.UUID,
    current_user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """CAVEDUCK 스타일 고급 캐릭터 상세 조회"""
    character = await get_advanced_character_by_id(db, character_id)
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
    
    return await convert_character_to_detail_response(character, db)


async def convert_character_to_detail_response(character: Character, db: AsyncSession) -> CharacterDetailResponse:
    """캐릭터 모델을 상세 응답으로 변환"""
    # 예시 대화 조회
    example_dialogues = await get_character_example_dialogues(db, character.id)

    if settings.ENVIRONMENT == "production":
        # JSON/기본값 보정 (마이그레이션 데이터 대비)
        def _parse_json(v):
            if isinstance(v, str):
                try:
                    return json.loads(v)
                except Exception:
                    return None
            return v

        imgs = _parse_json(getattr(character, 'image_descriptions', None)) or []
        if isinstance(imgs, list):
            imgs = [img for img in imgs if not (isinstance(img, dict) and str(img.get('url','')).startswith('cover:'))]
        intro = _parse_json(getattr(character, 'introduction_scenes', None)) or []
        voice = _parse_json(getattr(character, 'voice_settings', None)) or None

        return CharacterDetailResponse(
            id=character.id,
            creator_id=character.creator_id,
            name=character.name,
            description=getattr(character, 'description', None),
            personality=getattr(character, 'personality', None),
            speech_style=getattr(character, 'speech_style', None),
            greeting=getattr(character, 'greeting', None),
            origin_story_id=getattr(character, 'origin_story_id', None),
            world_setting=getattr(character, 'world_setting', None),
            user_display_description=getattr(character, 'user_display_description', None),
            use_custom_description=bool(getattr(character, 'use_custom_description', False)),
            introduction_scenes=intro,
            character_type=getattr(character, 'character_type', 'roleplay'),
            base_language=getattr(character, 'base_language', 'ko'),
            avatar_url=getattr(character, 'avatar_url', None),
            image_descriptions=imgs if isinstance(imgs, list) else None,
            voice_settings=voice,
            example_dialogues=[
                CharacterExampleDialogueResponse(
                    id=d.id,
                    user_message=d.user_message,
                    character_response=d.character_response,
                    order_index=d.order_index,
                    created_at=(getattr(d, 'created_at', None) or datetime.now(timezone.utc))
                ) for d in example_dialogues
            ],
            has_affinity_system=bool(getattr(character, 'has_affinity_system', False)),
            affinity_rules=getattr(character, 'affinity_rules', None),
            affinity_stages=_parse_json(getattr(character, 'affinity_stages', None)) or [],
            is_public=bool(getattr(character, 'is_public', True)),
            is_active=bool(getattr(character, 'is_active', True)),
            custom_module_id=getattr(character, 'custom_module_id', None),
            use_translation=bool(getattr(character, 'use_translation', True)),
            chat_count=int(getattr(character, 'chat_count', 0) or 0),
            like_count=int(getattr(character, 'like_count', 0) or 0),
            created_at=(getattr(character, 'created_at', None) or datetime.now(timezone.utc)),
            updated_at=(getattr(character, 'updated_at', None) or datetime.now(timezone.utc)),
            creator_username=character.creator.username if character.creator else None,
            creator_avatar_url=character.creator.avatar_url if character.creator else None,
        )

    # 개발환경: 기존 로직 유지
    return CharacterDetailResponse(
        id=character.id,
        creator_id=character.creator_id,
        name=character.name,
        description=character.description,
        personality=character.personality,
        speech_style=character.speech_style,
        greeting=character.greeting,
        origin_story_id=getattr(character, 'origin_story_id', None),
        world_setting=getattr(character, 'world_setting', None),
        user_display_description=getattr(character, 'user_display_description', None),
        use_custom_description=getattr(character, 'use_custom_description', False),
        introduction_scenes=getattr(character, 'introduction_scenes', []),
        character_type=getattr(character, 'character_type', 'roleplay'),
        base_language=getattr(character, 'base_language', 'ko'),
        avatar_url=character.avatar_url,
        image_descriptions=getattr(character, 'image_descriptions', []),
        voice_settings=getattr(character, 'voice_settings', None),
        example_dialogues=[
            CharacterExampleDialogueResponse(
                id=dialogue.id,
                user_message=dialogue.user_message,
                character_response=dialogue.character_response,
                order_index=dialogue.order_index,
                created_at=(getattr(dialogue, 'created_at', None) or datetime.now(timezone.utc))
            ) for dialogue in example_dialogues
        ],
        has_affinity_system=getattr(character, 'has_affinity_system', False),
        affinity_rules=getattr(character, 'affinity_rules', None),
        affinity_stages=getattr(character, 'affinity_stages', []),
        is_public=character.is_public,
        is_active=character.is_active,
        custom_module_id=getattr(character, 'custom_module_id', None),
        use_translation=getattr(character, 'use_translation', True),
        chat_count=character.chat_count,
        like_count=character.like_count,
        created_at=character.created_at,
        updated_at=character.updated_at,
        creator_username=character.creator.username if character.creator else None,
        creator_avatar_url=character.creator.avatar_url if character.creator else None
    )


# 🏷️ 캐릭터-태그 관리 API
@router.get("/{character_id}/tags", response_model=List[TagResponse])
async def get_character_tags(
    character_id: uuid.UUID,
    db: AsyncSession = Depends(get_db)
):
    character = await get_character_by_id(db, character_id)
    if not character:
        raise HTTPException(status_code=404, detail="캐릭터를 찾을 수 없습니다.")
    # 관계 프리로드 후 단순 반환 (정렬은 이름순)
    await db.refresh(character)
    result = await db.execute(
        select(Tag).join(CharacterTag, CharacterTag.tag_id == Tag.id)
        .where(CharacterTag.character_id == character_id)
        .order_by(Tag.name)
    )
    return result.scalars().all()


@router.put("/{character_id}/tags", response_model=List[TagResponse])
async def set_character_tags(
    character_id: uuid.UUID,
    payload: CharacterTagsUpdate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    character = await get_character_by_id(db, character_id)
    if not character:
        raise HTTPException(status_code=404, detail="캐릭터를 찾을 수 없습니다.")
    if character.creator_id != current_user.id:
        raise HTTPException(status_code=403, detail="권한이 없습니다.")

    # 기존 연결 삭제
    await db.execute(delete(CharacterTag).where(CharacterTag.character_id == character_id))

    # slugs → Tag 조회
    if payload.tags:
        # 1) 기존 태그 조회
        tag_rows = (await db.execute(select(Tag).where(Tag.slug.in_(payload.tags)))).scalars().all()
        existing_slugs = {t.slug for t in tag_rows}
        # 2) 누락된 슬러그는 자동 생성해 전역 태그 테이블에 등록
        missing_slugs = [s for s in payload.tags if s not in existing_slugs]
        for slug in missing_slugs:
            try:
                new_tag = Tag(name=slug, slug=slug)
                db.add(new_tag)
                await db.flush()
                tag_rows.append(new_tag)
            except Exception:
                # 유니크 충돌 등은 무시하고 넘어감 (동시 생성 방지)
                pass
        # 3) 연결 재생성
        for t in tag_rows:
            await db.execute(insert(CharacterTag).values(character_id=character_id, tag_id=t.id))
    await db.commit()

    result = await db.execute(select(Tag).join(Tag.characters).where(Tag.characters.any(id=character_id)))
    return result.scalars().all()


# 🌍 세계관 관리 API

@router.post("/world-settings", response_model=WorldSettingResponse, status_code=status.HTTP_201_CREATED)
async def create_world_setting(
    world_data: WorldSettingCreate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """세계관 설정 생성"""
    # TODO: 세계관 생성 서비스 구현
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="세계관 생성 기능은 곧 구현됩니다."
    )


@router.get("/world-settings", response_model=List[WorldSettingResponse])
async def get_world_settings(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """내 세계관 설정 목록 조회"""
    # TODO: 세계관 목록 조회 서비스 구현
    return []


# 🔧 커스텀 모듈 API

@router.post("/custom-modules", response_model=CustomModuleResponse, status_code=status.HTTP_201_CREATED)
async def create_custom_module(
    module_data: CustomModuleCreate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """커스텀 모듈 생성 (고급 사용자용)"""
    # TODO: 커스텀 모듈 생성 서비스 구현
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="커스텀 모듈 기능은 곧 구현됩니다."
    )


@router.get("/custom-modules", response_model=List[CustomModuleResponse])
async def get_custom_modules(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """내 커스텀 모듈 목록 조회"""
    # TODO: 커스텀 모듈 목록 조회 서비스 구현
    return []


# 📊 캐릭터 통계 API

@router.get("/{character_id}/stats")
async def get_character_stats(
    character_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """캐릭터 통계 조회 (생성자만)"""
    character = await get_character_by_id(db, character_id)
    if not character:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="캐릭터를 찾을 수 없습니다."
        )
    
    # 생성자만 통계 조회 가능
    if character.creator_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="이 캐릭터의 통계를 조회할 권한이 없습니다."
        )
    
    # TODO: 상세 통계 구현
    return {
        "character_id": character_id,
        "total_chats": character.chat_count,
        "total_likes": character.like_count,
        "created_at": character.created_at,
        "last_chat_at": None,  # TODO: 마지막 채팅 시간
        "daily_stats": [],  # TODO: 일별 통계
        "popular_phrases": []  # TODO: 인기 문구
    }


# 🔄 레거시 호환성 API (기존 API 유지)

@router.post("/", response_model=CharacterResponse, status_code=status.HTTP_201_CREATED)
async def create_new_character(
    character_data: CharacterCreate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """새 캐릭터 생성 (레거시)"""
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
    sort: Optional[str] = Query(None, description="정렬: views|likes|recent"),
    source_type: Optional[str] = Query(None, description="생성 출처: ORIGINAL|IMPORTED"),
    tags: Optional[str] = Query(None, description="필터 태그 목록(콤마 구분 slug)"),
    only: Optional[str] = Query(None, description="origchat|regular"),
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
        # only 파라미터가 없으면 전체(원작챗 포함) 조회
        characters = await get_public_characters(
            db=db,
            skip=skip,
            limit=limit,
            search=search,
            sort=sort,
            source_type=source_type,
            tags=[s for s in (tags.split(',') if tags else []) if s],
            only=only,
        )

    # 일관된 응답: creator_username 포함하여 매핑
    if settings.ENVIRONMENT == "production":
        items: List[CharacterListResponse] = []
        for char in characters:
            try:
                imgs = getattr(char, 'image_descriptions', None)
                # normalize image_descriptions to list[dict]
                if isinstance(imgs, str):
                    try:
                        imgs = json.loads(imgs)
                    except Exception:
                        imgs = None
                if imgs and isinstance(imgs, list):
                    # filter out cover: URLs
                    imgs = [img for img in imgs if not (isinstance(img, dict) and str(img.get('url','')).startswith('cover:'))]
                item = CharacterListResponse(
                    id=char.id,
                    creator_id=char.creator_id,
                    name=char.name,
                    description=getattr(char, 'description', None),
                    greeting=getattr(char, 'greeting', None),
                    avatar_url=getattr(char, 'avatar_url', None),
                    source_type=getattr(char, 'source_type', 'ORIGINAL'),
                    image_descriptions=imgs if isinstance(imgs, list) else None,
                    origin_story_id=getattr(char, 'origin_story_id', None),
                    is_origchat=bool(getattr(char, 'origin_story_id', None)),
                    chat_count=int(getattr(char, 'chat_count', 0) or 0),
                    like_count=int(getattr(char, 'like_count', 0) or 0),
                    is_public=bool(getattr(char, 'is_public', True)),
                    created_at=(getattr(char, 'created_at', None) or datetime.now(timezone.utc)),
                    creator_username=char.creator.username if getattr(char, 'creator', None) else None,
                    creator_avatar_url=char.creator.avatar_url if getattr(char, 'creator', None) else None,
                )
                items.append(item)
            except Exception as e:
                try:
                    logger.warning(f"characters list serialization skipped id={getattr(char,'id',None)}: {e}")
                except Exception:
                    pass
                continue
        return items
    else:
        return [
            CharacterListResponse(
                id=char.id,
                creator_id=char.creator_id,
                name=char.name,
                description=char.description,
                greeting=char.greeting,
                avatar_url=char.avatar_url,
                source_type=getattr(char, 'source_type', 'ORIGINAL'),
                image_descriptions=[
                    img for img in (getattr(char, 'image_descriptions', []) or [])
                    if not (isinstance(img, dict) and str(img.get('url','')).startswith('cover:'))
                ],
                origin_story_id=getattr(char, 'origin_story_id', None),
                is_origchat=bool(getattr(char, 'origin_story_id', None)),
                chat_count=char.chat_count,
                like_count=char.like_count,
                is_public=char.is_public,
                created_at=char.created_at,
                creator_username=char.creator.username if getattr(char, 'creator', None) else None,
                creator_avatar_url=char.creator.avatar_url if getattr(char, 'creator', None) else None,
            ) for char in characters
        ]


@router.get("/my", response_model=List[CharacterListResponse])
async def get_my_characters(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    only: Optional[str] = Query(None, description="origchat|regular"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """내 캐릭터 목록 조회
    - 공개/비공개 모두 포함
    - 응답 스키마로 일관 매핑(creator_username 포함)
    """
    characters = await get_characters_by_creator(
        db=db,
        creator_id=current_user.id,
        skip=skip,
        limit=limit,
        include_private=True,
        only=only,
    )
    return [
        CharacterListResponse(
            id=char.id,
            creator_id=char.creator_id,
            name=char.name,
            description=char.description,
            greeting=char.greeting,
            avatar_url=char.avatar_url,
            source_type=getattr(char, 'source_type', 'ORIGINAL'),
            image_descriptions=getattr(char, 'image_descriptions', []),
            origin_story_id=getattr(char, 'origin_story_id', None),
            is_origchat=bool(getattr(char, 'origin_story_id', None)),
            chat_count=char.chat_count,
            like_count=char.like_count,
            is_public=char.is_public,
            created_at=char.created_at,
            creator_username=char.creator.username if getattr(char, 'creator', None) else None,
            creator_avatar_url=char.creator.avatar_url if getattr(char, 'creator', None) else None,
        ) for char in characters
    ]


# @router.get("/{character_id}", response_model=CharacterWithCreator)
# async def get_character(
#     character_id: uuid.UUID,
#     current_user: Optional[User] = Depends(get_current_user),
#     db: AsyncSession = Depends(get_db)
# ):
#     """캐릭터 상세 조회 (레거시)"""
#     character = await get_character_by_id(db, character_id)
#     if not character:
#         raise HTTPException(
#             status_code=status.HTTP_404_NOT_FOUND,
#             detail="캐릭터를 찾을 수 없습니다."
#         )
    
#     # 비공개 캐릭터는 생성자만 조회 가능
#     if not character.is_public and (not current_user or character.creator_id != current_user.id):
#         raise HTTPException(
#             status_code=status.HTTP_403_FORBIDDEN,
#             detail="이 캐릭터에 접근할 권한이 없습니다."
#         )
    
#     # 🔧 새로운 모델 구조와 호환되도록 수동으로 응답 구성
#     character_dict = {
#         "id": character.id,
#         "creator_id": character.creator_id, # 이 줄 추가
#         "name": character.name,
#         "description": character.description,
#         "personality": character.personality,
#         "speech_style": character.speech_style,
#         "greeting": character.greeting,
#         "background_story": getattr(character, 'world_setting', None),  # 세계관을 배경 스토리로 매핑
#         "avatar_url": character.avatar_url,
#         "is_public": character.is_public,
#         "is_active": character.is_active,
#         "chat_count": character.chat_count,
#         "like_count": character.like_count,
#         "created_at": character.created_at,
#         "updated_at": character.updated_at,
#         "creator_username": character.creator.username if character.creator else None
#     }
    
#     # 좋아요 상태 추가 (로그인한 사용자인 경우만)
#     if current_user:
#         character_dict["is_liked"] = await is_character_liked_by_user(db, character_id, current_user.id)
#     else:
#         character_dict["is_liked"] = False
    
#     return CharacterWithCreator(**character_dict)
@router.get("/{character_id}", response_model=CharacterDetailResponse) # 1. 응답 모델을 고급 버전으로 변경
async def get_character(
    character_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    current_user: Optional[User] = Depends(get_current_user_optional),
    db: AsyncSession = Depends(get_db),
):
    """캐릭터 상세 조회 (고급 응답 모델 사용)"""
    # 2. 데이터를 가져오는 서비스도 고급 버전으로 변경
    character = await get_advanced_character_by_id(db, character_id) 
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
    
    # 3. 🔥 고급 응답 모델로 변환하는 헬퍼 함수를 재사용
    response_data = await convert_character_to_detail_response(character, db)

    # 추가: 실시간 메시지 수로 동기화
    from app.services.character_service import get_real_message_count
    # real_count = await get_real_message_count(db, character_id)
    # response_data.chat_count = real_count
    real_count = await sync_character_chat_count(db, character_id)
    response_data.chat_count = await get_real_message_count(db, character_id)


    # 원작 스토리 카드용 보강 필드
    try:
        if response_data.origin_story_id:
            from sqlalchemy import select
            from app.models.story import Story
            from sqlalchemy.orm import joinedload
            s = (await db.execute(
                select(Story).where(Story.id == response_data.origin_story_id).options(joinedload(Story.creator))
            )).scalars().first()
            if s:
                response_data_dict = response_data.model_dump()
                response_data_dict["origin_story_title"] = s.title
                response_data_dict["origin_story_cover"] = getattr(s, "cover_url", None)
                response_data_dict["origin_story_creator"] = getattr(s.creator, "username", None) if getattr(s, "creator", None) else None
                response_data_dict["origin_story_views"] = int(s.view_count or 0)
                response_data_dict["origin_story_likes"] = int(s.like_count or 0)
                try:
                    text = (s.content or "").strip()
                    excerpt = " ".join(text.split())[:140] if text else None
                except Exception:
                    excerpt = None
                response_data_dict["origin_story_excerpt"] = excerpt
                response_data = CharacterDetailResponse(**response_data_dict)
    except Exception:
        pass
    
    # is_liked 상태 추가 (로그인한 사용자인 경우만)
    if current_user:
        response_data.is_liked = await is_character_liked_by_user(db, character_id, current_user.id)
    else:
        response_data.is_liked = False
    
    return response_data

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


@router.patch("/{character_id}/toggle-public", response_model=CharacterResponse)
async def toggle_character_public_status(
    character_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """캐릭터의 공개/비공개 상태를 토글합니다."""
    character = await get_character_by_id(db, character_id)
    if not character:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="캐릭터를 찾을 수 없습니다."
        )
    
    # 생성자만 상태 변경 가능
    if character.creator_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="이 캐릭터의 공개 상태를 변경할 권한이 없습니다."
        )
        
    updated_character = await update_character_public_status(db, character_id, not character.is_public)
    
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
    
    # 원작챗 연결이 있는 경우 그리드가 변형되지 않도록 character_id만 NULL 처리 후 삭제
    try:
        await db.execute(
            sql_update(StoryExtractedCharacter)
            .where(StoryExtractedCharacter.character_id == character_id)
            .values(character_id=None)
        )
        await db.commit()
    except Exception:
        try:
            await db.rollback()
        except Exception:
            pass
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


@router.get("/{character_id}/like-status")
async def get_character_like_status(
    character_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """캐릭터 좋아요 상태 확인"""
    character = await get_character_by_id(db, character_id)
    if not character:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="캐릭터를 찾을 수 없습니다."
        )
    
    is_liked = await is_character_liked_by_user(db, character_id, current_user.id)
    
    return {
        "character_id": character_id,
        "is_liked": is_liked,
        "like_count": character.like_count
    }


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

