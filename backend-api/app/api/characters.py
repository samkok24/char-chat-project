"""
캐릭터 관련 API 라우터 - CAVEDUCK 스타일 고급 캐릭터 생성
"""

from fastapi import APIRouter, Depends, HTTPException, status, Query, BackgroundTasks, Request
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
from app.schemas.quick_character import (
    QuickCharacterGenerateRequest,
    QuickPromptGenerateRequest,
    QuickPromptGenerateResponse,
    QuickFirstStartGenerateRequest,
    QuickFirstStartGenerateResponse,
    QuickDetailGenerateRequest,
    QuickDetailGenerateResponse,
    QuickSecretGenerateRequest,
    QuickSecretGenerateResponse,
    QuickTurnEventsGenerateRequest,
    QuickTurnEventsGenerateResponse,
    QuickEndingDraftGenerateRequest,
    QuickEndingDraftGenerateResponse,
    QuickEndingEpilogueGenerateRequest,
    QuickEndingEpilogueGenerateResponse,
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
from app.services.quick_character_service import (
    generate_quick_character_draft,
    generate_quick_simulator_prompt,
    generate_quick_roleplay_prompt,
    generate_quick_first_start,
    generate_quick_detail,
    generate_quick_secret_info,
    generate_quick_stat_draft,
    generate_quick_turn_events,
    generate_quick_ending_draft,
    generate_quick_ending_epilogue,
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

@router.post("/quick-generate", response_model=CharacterCreateRequest)
async def quick_generate_character_draft(
    payload: QuickCharacterGenerateRequest,
    current_user: User = Depends(get_current_active_user),
    request: Request = None,
):
    """
    온보딩(30초만에 캐릭터 만나기)용: 이미지+느낌+태그로 고급 캐릭터 생성 초안을 생성합니다.

    주의:
    - 이 엔드포인트는 DB에 저장하지 않습니다(SSOT: 실제 저장은 /characters/advanced).
    - 실패 시 조용히 무시하지 않고 500 + 상세 메시지로 반환합니다(로그 포함).
    """
    try:
        # ✅ 방어: 업로드 API는 `/static/...` 상대경로를 반환한다.
        # Vision(서버 내부 requests.get)은 절대 URL이 필요하므로, 분석용으로만 절대 URL로 변환한다.
        raw_url = getattr(payload, "image_url", None)
        abs_url = raw_url
        try:
            if raw_url and isinstance(raw_url, str) and raw_url.startswith("/") and request is not None:
                base = str(getattr(request, "base_url", "") or "").rstrip("/")
                abs_url = f"{base}{raw_url}"
        except Exception:
            abs_url = raw_url

        if abs_url != raw_url:
            try:
                payload = QuickCharacterGenerateRequest(**{**payload.model_dump(), "image_url": abs_url})
            except Exception:
                # 변환 실패 시 원본 유지
                pass

        draft = await generate_quick_character_draft(payload)

        # 응답은 저장/표시를 위해 원본 상대경로를 유지하는 것이 안전하다.
        try:
            if raw_url and abs_url != raw_url and getattr(draft, "media_settings", None):
                if getattr(draft.media_settings, "avatar_url", None) == abs_url:
                    draft.media_settings.avatar_url = raw_url
                imgs = getattr(draft.media_settings, "image_descriptions", None)
                if isinstance(imgs, list):
                    for img in imgs:
                        try:
                            if isinstance(img, dict):
                                if img.get("url") == abs_url:
                                    img["url"] = raw_url
                            else:
                                if getattr(img, "url", None) == abs_url:
                                    img.url = raw_url
                        except Exception:
                            continue
        except Exception:
            pass

        return draft
    except Exception as e:
        try:
            logger.exception(f"[characters.quick-generate] failed: {e}")
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"quick_generate_failed: {str(e)}"
        )


@router.post("/quick-generate-prompt", response_model=QuickPromptGenerateResponse)
async def quick_generate_prompt(
    payload: QuickPromptGenerateRequest,
    current_user: User = Depends(get_current_active_user),
):
    """
    위저드(일반 캐릭터) '프롬프트' 단계 자동 생성.

    현재:
    - simulator 모드만 지원(요구사항)
    - DB 저장은 하지 않는다(SSOT: 실제 저장은 /characters/advanced)
    """
    try:
        mode = getattr(payload, "mode", None) or "simulator"
        max_turns = getattr(payload, "max_turns", None) or 200
        allow_infinite_mode = bool(getattr(payload, "allow_infinite_mode", False))
        if mode == "simulator":
            prompt_text = await generate_quick_simulator_prompt(
                name=payload.name,
                description=payload.description,
                max_turns=max_turns,
                allow_infinite_mode=allow_infinite_mode,
                tags=getattr(payload, "tags", []) or [],
                ai_model=getattr(payload, "ai_model", None) or "gemini",
            )
            stats = await generate_quick_stat_draft(
                name=payload.name,
                description=payload.description,
                world_setting=prompt_text,
                tags=getattr(payload, "tags", []) or [],
                ai_model=getattr(payload, "ai_model", None) or "gemini",
            )
        elif mode == "roleplay":
            prompt_text = await generate_quick_roleplay_prompt(
                name=payload.name,
                description=payload.description,
                max_turns=max_turns,
                allow_infinite_mode=allow_infinite_mode,
                tags=getattr(payload, "tags", []) or [],
                ai_model=getattr(payload, "ai_model", None) or "gemini",
            )
            stats = []
        else:
            raise HTTPException(status_code=400, detail="mode_not_supported")

        return QuickPromptGenerateResponse(prompt=prompt_text, stats=stats or [])
    except HTTPException:
        raise
    except Exception as e:
        try:
            logger.exception(f"[characters.quick-generate-prompt] failed: {e}")
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"quick_generate_prompt_failed: {str(e)}"
        )


@router.post("/quick-generate-first-start", response_model=QuickFirstStartGenerateResponse)
async def quick_generate_first_start(
    payload: QuickFirstStartGenerateRequest,
    current_user: User = Depends(get_current_active_user),
):
    """
    위저드(일반 캐릭터) '첫시작(도입부+첫대사)' 자동 생성.

    조건:
    - 프롬프트(world_setting)가 작성되어 있어야 한다.
    - 300~1000자(도입부+첫대사 합산)로 생성한다.
    """
    try:
        intro, first_line = await generate_quick_first_start(
            name=payload.name,
            description=payload.description,
            world_setting=payload.world_setting,
            tags=getattr(payload, "tags", []) or [],
            ai_model=getattr(payload, "ai_model", None) or "gemini",
        )
        return QuickFirstStartGenerateResponse(intro=intro, first_line=first_line)
    except Exception as e:
        try:
            logger.exception(f"[characters.quick-generate-first-start] failed: {e}")
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"quick_generate_first_start_failed: {str(e)}"
        )


@router.post("/quick-generate-detail", response_model=QuickDetailGenerateResponse)
async def quick_generate_detail(
    payload: QuickDetailGenerateRequest,
    current_user: User = Depends(get_current_active_user),
):
    """
    위저드(일반 캐릭터) '디테일' 자동 생성.

    조건:
    - 프롬프트(world_setting)가 작성되어 있어야 한다(요구사항).
    - 관심사/좋아하는 것/싫어하는 것: 키워드 3개씩.
    """
    try:
        out = await generate_quick_detail(
            name=payload.name,
            description=payload.description,
            world_setting=payload.world_setting,
            tags=getattr(payload, "tags", []) or [],
            ai_model=getattr(payload, "ai_model", None) or "gemini",
        )
        return QuickDetailGenerateResponse(**out)
    except Exception as e:
        try:
            logger.exception(f"[characters.quick-generate-detail] failed: {e}")
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"quick_generate_detail_failed: {str(e)}"
        )


@router.post("/quick-generate-secret", response_model=QuickSecretGenerateResponse)
async def quick_generate_secret(
    payload: QuickSecretGenerateRequest,
    current_user: User = Depends(get_current_active_user),
):
    """
    위저드(일반 캐릭터) '비밀정보(secret)' 자동 생성.

    조건:
    - 프롬프트(world_setting)가 작성되어 있어야 한다(요구사항).
    - 유저에게 노출되면 안 되는 비밀 설정을 200~600자 수준으로 생성한다.
    """
    try:
        secret_text = await generate_quick_secret_info(
            name=payload.name,
            description=payload.description,
            world_setting=payload.world_setting,
            tags=getattr(payload, "tags", []) or [],
            ai_model=getattr(payload, "ai_model", None) or "gemini",
        )
        if not secret_text:
            raise HTTPException(status_code=500, detail="quick_generate_secret_failed: empty_secret")
        return QuickSecretGenerateResponse(secret=secret_text)
    except HTTPException:
        raise
    except Exception as e:
        try:
            logger.exception(f"[characters.quick-generate-secret] failed: {e}")
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"quick_generate_secret_failed: {str(e)}"
        )


@router.post("/quick-generate-turn-events", response_model=QuickTurnEventsGenerateResponse)
async def quick_generate_turn_events(
    payload: QuickTurnEventsGenerateRequest,
    current_user: User = Depends(get_current_active_user),
):
    """
    위저드(일반 캐릭터) '턴수별 사건' 자동 생성.

    요구사항:
    - 진행 턴수(max_turns)에 따라 생성 개수 상한을 강제한다(50/100/200/300/커스텀).
    - 초반부 사건 빈도를 높게 생성한다.
    - DB 저장은 하지 않는다(SSOT: 실제 저장은 /characters/advanced).
    """
    try:
        events = await generate_quick_turn_events(
            name=payload.name,
            description=payload.description,
            world_setting=payload.world_setting,
            opening_intro=payload.opening_intro,
            opening_first_line=payload.opening_first_line,
            max_turns=getattr(payload, "max_turns", None) or 200,
            tags=getattr(payload, "tags", []) or [],
            ai_model=getattr(payload, "ai_model", None) or "gemini",
        )
        return QuickTurnEventsGenerateResponse(turn_events=events or [])
    except Exception as e:
        try:
            logger.exception(f"[characters.quick-generate-turn-events] failed: {e}")
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"quick_generate_turn_events_failed: {str(e)}"
        )


@router.post("/quick-generate-ending-draft", response_model=QuickEndingDraftGenerateResponse)
async def quick_generate_ending_draft(
    payload: QuickEndingDraftGenerateRequest,
    current_user: User = Depends(get_current_active_user),
):
    """
    위저드(일반 캐릭터) '엔딩 제목/기본조건' 자동 생성.

    원칙:
    - DB 저장은 하지 않는다(SSOT: 실제 저장은 /characters/advanced).
    - 프론트 입력 필드(start_sets.items[].ending_settings.endings[])에 채울 "초안 데이터"만 생성한다.
    """
    try:
        d = await generate_quick_ending_draft(
            name=payload.name,
            description=payload.description,
            world_setting=payload.world_setting,
            opening_intro=getattr(payload, "opening_intro", "") or "",
            opening_first_line=getattr(payload, "opening_first_line", "") or "",
            max_turns=getattr(payload, "max_turns", None) or 200,
            min_turns=getattr(payload, "min_turns", None) or 30,
            tags=getattr(payload, "tags", []) or [],
            ai_model=getattr(payload, "ai_model", None) or "gemini",
        )
        title = str((d or {}).get("title") or "").strip()
        base_condition = str((d or {}).get("base_condition") or "").strip()
        hint = str((d or {}).get("hint") or "").strip()
        suggested_turn = int((d or {}).get("suggested_turn") or 0)
        if not title or not base_condition:
            raise HTTPException(status_code=500, detail="quick_generate_ending_draft_failed: empty_fields")
        return QuickEndingDraftGenerateResponse(
            title=title[:20],
            base_condition=base_condition[:500],
            hint=hint[:20],
            suggested_turn=max(0, suggested_turn),
        )
    except HTTPException:
        raise
    except Exception as e:
        try:
            logger.exception(f"[characters.quick-generate-ending-draft] failed: {e}")
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"quick_generate_ending_draft_failed: {str(e)}"
        )


@router.post("/quick-generate-ending-epilogue", response_model=QuickEndingEpilogueGenerateResponse)
async def quick_generate_ending_epilogue(
    payload: QuickEndingEpilogueGenerateRequest,
    current_user: User = Depends(get_current_active_user),
):
    """
    위저드(일반 캐릭터) '엔딩 내용(에필로그)' 자동 생성.

    원칙:
    - DB 저장은 하지 않는다(SSOT: 실제 저장은 /characters/advanced).
    - 프론트 입력 필드(start_sets.ending_settings.endings[].epilogue)에 채울 초안 텍스트만 생성한다.
    """
    try:
        ep = await generate_quick_ending_epilogue(
            name=payload.name,
            description=payload.description,
            world_setting=payload.world_setting,
            opening_intro=getattr(payload, "opening_intro", "") or "",
            opening_first_line=getattr(payload, "opening_first_line", "") or "",
            ending_title=payload.ending_title,
            base_condition=payload.base_condition,
            hint=getattr(payload, "hint", "") or "",
            extra_conditions=getattr(payload, "extra_conditions", None) or [],
            tags=getattr(payload, "tags", []) or [],
            ai_model=getattr(payload, "ai_model", None) or "gemini",
        )
        ep = (ep or "").strip()
        if not ep:
            raise HTTPException(status_code=500, detail="quick_generate_ending_epilogue_failed: empty_epilogue")
        return QuickEndingEpilogueGenerateResponse(epilogue=ep[:1000])
    except HTTPException:
        raise
    except Exception as e:
        try:
            logger.exception(f"[characters.quick-generate-ending-epilogue] failed: {e}")
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"quick_generate_ending_epilogue_failed: {str(e)}"
        )

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
    
    # 비공개 캐릭터는 생성자/관리자만 조회 가능
    if not character.is_public and (
        (not current_user)
        or (character.creator_id != current_user.id and not getattr(current_user, "is_admin", False))
    ):
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
        start_sets = _parse_json(getattr(character, 'start_sets', None)) or None

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
            start_sets=start_sets,
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
        start_sets=getattr(character, 'start_sets', None),
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
    gender: Optional[str] = Query(None, description="성별 필터: all|male|female|other (태그 기반)"),
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
            gender=gender,
            only=only,
        )

    # ✅ 방어적 2차 필터(중요: 비공개 누출 방지)
    # - 원작챗 캐릭터(origin_story_id가 있는 캐릭터)는 "원작 스토리"가 공개일 때만 공개 목록에 노출해야 한다.
    # - get_public_characters에서 1차로 Story.is_public 필터를 걸었더라도,
    #   운영/마이그레이션/조인/캐시 등으로 누락될 수 있어 응답 직전 한 번 더 차단한다(보수적).
    try:
        origin_story_ids = []
        for ch in (characters or []):
            oid = getattr(ch, "origin_story_id", None)
            if oid:
                origin_story_ids.append(oid)

        if origin_story_ids:
            from app.models.story import Story

            rows = await db.execute(
                select(Story.id, Story.is_public).where(Story.id.in_(origin_story_ids))
            )
            story_public_by_id = {str(r[0]): (r[1] is True) for r in (rows.all() or [])}

            filtered = []
            removed = 0
            for ch in (characters or []):
                oid = getattr(ch, "origin_story_id", None)
                if not oid:
                    filtered.append(ch)
                    continue
                if story_public_by_id.get(str(oid)) is True:
                    filtered.append(ch)
                else:
                    removed += 1

            if removed:
                try:
                    logger.warning(
                        f"[characters] defensive_filter removed {removed} origchat characters (private/missing origin story) from public listing"
                    )
                except Exception:
                    pass

            characters = filtered
    except Exception as e:
        # 확인 실패 시에도 노출을 막는 것이 안전하다(보수적).
        try:
            logger.exception(f"[characters] defensive_filter failed: {e}")
        except Exception:
            pass
        try:
            characters = [ch for ch in (characters or []) if not getattr(ch, "origin_story_id", None)]
        except Exception:
            pass

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

    # ✅ 운영 방어: legacy 데이터에서 image_descriptions가 str(JSON)로 저장된 경우가 있어
    # 응답 스키마(List[dict]) 검증에서 500이 날 수 있다.
    # - /me/characters/* 와 동일 규칙으로 안전하게 정규화한다.
    items: List[CharacterListResponse] = []
    for char in (characters or []):
        try:
            imgs = getattr(char, 'image_descriptions', None)
            if isinstance(imgs, str):
                try:
                    imgs = json.loads(imgs)
                except Exception:
                    imgs = None
            if imgs and isinstance(imgs, list):
                imgs = [
                    img
                    for img in imgs
                    if not (isinstance(img, dict) and str(img.get('url', '')).startswith('cover:'))
                ]

            items.append(
                CharacterListResponse(
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
            )
        except Exception as e:
            try:
                logger.warning(f"[characters] /my serialize skipped id={getattr(char,'id',None)}: {e}")
            except Exception:
                pass
            continue

    return items


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
    
    # 비공개 캐릭터는 생성자/관리자만 조회 가능
    if not character.is_public and (
        (not current_user)
        or (character.creator_id != current_user.id and not getattr(current_user, "is_admin", False))
    ):
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
    
    # 생성자/관리자만 상태 변경 가능
    if character.creator_id != current_user.id and not getattr(current_user, "is_admin", False):
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
    
    # ✅ 원작챗(등장인물 그리드) 동기화
    #
    # 요구사항:
    # - 크리에이터가 원작챗 캐릭터를 삭제하면, 스토리 상세의 "등장인물 그리드"에서도 다시 뜨면 안 된다.
    #
    # 구현:
    # - 해당 캐릭터를 참조하는 StoryExtractedCharacter 레코드를 삭제한다.
    # - (기존: character_id만 NULL 처리) → 고아 레코드가 남아 그리드에 "빈 캐릭터 카드"가 보이는 문제가 있었다.
    try:
        await db.execute(
            delete(StoryExtractedCharacter).where(StoryExtractedCharacter.character_id == character_id)
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
    
    # 작성자/관리자만 삭제 가능
    if comment.user_id != current_user.id and not getattr(current_user, "is_admin", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="이 댓글을 삭제할 권한이 없습니다."
        )
    
    await delete_character_comment(db, comment_id)

