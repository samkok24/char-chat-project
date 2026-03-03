"""
캐릭터 관련 서비스 - CAVEDUCK 스타일 고급 캐릭터 생성
"""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete, func, and_, or_
from sqlalchemy.orm import selectinload, joinedload
from typing import List, Optional, Dict, Any
import uuid
import json

from app.models.character import Character, CharacterSetting, CharacterExampleDialogue
from app.models.chat import ChatRoom, ChatMessage, ChatMessageEdit
from app.models.tag import Tag, CharacterTag
from app.models.user import User
from app.models.like import CharacterLike
from app.models.comment import CharacterComment
from app.models.memory_note import MemoryNote
from app.models.bookmark import CharacterBookmark
from app.models.story import Story
from app.models.story_extracted_character import StoryExtractedCharacter
from app.schemas import (
    CharacterCreate, 
    CharacterUpdate, 
    CharacterSettingCreate,
    CharacterSettingUpdate,
    CharacterCreateRequest,
    CharacterUpdateRequest
)


# 🔥 CAVEDUCK 스타일 고급 캐릭터 생성 서비스

def _mirror_fields_from_start_sets(basic_info) -> Optional[Dict[str, Any]]:
    """
    start_sets(SSOT)로부터 선택된 세트를 추출해 greeting/introduction_scenes 미러링 값을 만든다.

    의도/원리:
    - 신규(일반 캐릭터챗) 생성 UI는 start_sets에 여러 세트(도입부+첫대사)를 저장한다.
    - 기존 채팅/프롬프트 로직은 greeting/introduction_scenes를 사용하므로,
      선택된 1개 세트를 기존 필드로 "미러링"해 호환성을 유지한다.
    - start_sets가 없거나 형태가 맞지 않으면 None을 반환하여 기존 필드를 그대로 사용한다.
    """
    try:
        ss = getattr(basic_info, "start_sets", None)
        if not isinstance(ss, dict):
            return None
        items = ss.get("items")
        if not isinstance(items, list) or not items:
            return None

        selected_id = str(ss.get("selectedId") or ss.get("selected_id") or "").strip()
        picked = None
        if selected_id:
            for it in items:
                if isinstance(it, dict) and str(it.get("id") or "").strip() == selected_id:
                    picked = it
                    break
        if picked is None:
            picked = items[0] if isinstance(items[0], dict) else None
        if not isinstance(picked, dict):
            return None

        intro = str(picked.get("intro") or picked.get("introduction") or "").strip()
        first_line = str(picked.get("firstLine") or picked.get("first_line") or "").strip()
        title = str(picked.get("title") or "도입부 1").strip() or "도입부 1"

        # secret: 기존 전역 비밀정보(도입부[0].secret)를 우선 보존
        secret = ""
        try:
            scenes = getattr(basic_info, "introduction_scenes", None)
            if isinstance(scenes, list) and scenes:
                secret = str(getattr(scenes[0], "secret", "") or "")
        except Exception:
            secret = ""
        if not secret:
            secret = str(picked.get("secret") or "").strip()

        intro_scenes = []
        if intro:
            intro_scenes = [{
                "title": title[:100],
                "content": intro[:2000],
                "secret": secret[:1000] if secret else None
            }]

        return {
            "greeting": first_line[:500] if first_line else None,
            "introduction_scenes": intro_scenes,
        }
    except Exception:
        return None


async def create_advanced_character(
    db: AsyncSession,
    creator_id: uuid.UUID,
    character_data: CharacterCreateRequest
) -> Character:
    """CAVEDUCK 스타일 고급 캐릭터 생성"""
    
    # 1단계: 기본 정보로 캐릭터 생성
    basic_info = character_data.basic_info

    mirrored = _mirror_fields_from_start_sets(basic_info)
    greeting_value = (mirrored.get("greeting") if mirrored else None) or basic_info.greeting
    intro_value = (mirrored.get("introduction_scenes") if mirrored else None) or [scene.model_dump() for scene in basic_info.introduction_scenes]
    
    character = Character(
        creator_id=creator_id,
        # 기본 정보
        name=basic_info.name,
        description=basic_info.description,
        personality=basic_info.personality,
        speech_style=basic_info.speech_style,
        greeting=greeting_value,
        
        # 세계관 설정
        world_setting=basic_info.world_setting,
        user_display_description=basic_info.user_display_description,
        use_custom_description=basic_info.use_custom_description,
        
        # 도입부 시스템 (JSON 저장)
        introduction_scenes=intro_value,
        # start_sets(SSOT)
        start_sets=getattr(basic_info, "start_sets", None),
        
        # 캐릭터 타입 및 언어
        character_type=basic_info.character_type,
        base_language=basic_info.base_language,
        
        # 2단계: 미디어 설정
        avatar_url=character_data.media_settings.avatar_url if character_data.media_settings else None,
        image_descriptions=[img.model_dump() for img in character_data.media_settings.image_descriptions] if character_data.media_settings else [],
        voice_settings=character_data.media_settings.voice_settings.model_dump() if character_data.media_settings and character_data.media_settings.voice_settings else None,
        
        # 4단계: 호감도 시스템
        has_affinity_system=character_data.affinity_system.has_affinity_system if character_data.affinity_system else False,
        affinity_rules=character_data.affinity_system.affinity_rules if character_data.affinity_system else None,
        affinity_stages=[stage.model_dump() for stage in character_data.affinity_system.affinity_stages] if character_data.affinity_system else [],
        
        # 5단계: 공개 설정
        is_public=character_data.publish_settings.is_public,
        custom_module_id=character_data.publish_settings.custom_module_id,
        use_translation=character_data.publish_settings.use_translation
    )
    
    db.add(character)
    await db.flush()  # ID 할당
    
    # 3단계: 예시 대화 저장
    if character_data.example_dialogues and character_data.example_dialogues.dialogues:
        for dialogue in character_data.example_dialogues.dialogues:
            example_dialogue = CharacterExampleDialogue(
                character_id=character.id,
                user_message=dialogue.user_message,
                character_response=dialogue.character_response,
                order_index=dialogue.order_index
            )
            db.add(example_dialogue)
    
    # 고급 캐릭터 설정 생성
    advanced_setting = CharacterSetting(
        character_id=character.id,
        system_prompt=generate_advanced_system_prompt(character, character_data),
        ai_model='gemini-pro',
        temperature=0.7,
        max_tokens=1000,
        use_memory=True,
        memory_length=20,
        response_style='natural'
    )
    db.add(advanced_setting)
    
    await db.commit()
    
    # 완전한 캐릭터 정보 반환
    return await get_advanced_character_by_id(db, character.id)


async def update_advanced_character(
    db: AsyncSession,
    character_id: uuid.UUID,
    character_data: CharacterUpdateRequest
) -> Optional[Character]:
    """CAVEDUCK 스타일 고급 캐릭터 수정"""
    
    character = await get_character_by_id(db, character_id)
    if not character:
        return None
    
    # 각 단계별 업데이트 처리
    update_data = {}
    
    # 1단계: 기본 정보 업데이트
    if character_data.basic_info:
        basic_info = character_data.basic_info
        mirrored = _mirror_fields_from_start_sets(basic_info)

        update_data.update({
            'name': basic_info.name,
            'description': basic_info.description,
            'personality': basic_info.personality,
            'speech_style': basic_info.speech_style,
            'greeting': (mirrored.get("greeting") if mirrored else None) or basic_info.greeting,
            'world_setting': basic_info.world_setting,
            'user_display_description': basic_info.user_display_description,
            'use_custom_description': basic_info.use_custom_description,
            'introduction_scenes': (mirrored.get("introduction_scenes") if mirrored else None) or [scene.model_dump() for scene in basic_info.introduction_scenes],
            'character_type': basic_info.character_type,
            'base_language': basic_info.base_language
        })
        # start_sets는 SSOT로 별도 저장 (요청에 포함된 경우에만 업데이트)
        try:
            # Pydantic v2: model_fields_set, v1: __fields_set__
            fields_set = getattr(basic_info, "model_fields_set", None)
            if fields_set is None:
                fields_set = getattr(basic_info, "__fields_set__", set())
            if isinstance(fields_set, set) and ("start_sets" in fields_set):
                update_data['start_sets'] = getattr(basic_info, "start_sets", None)
        except Exception:
            # 필드셋 확인 실패 시에는 안전하게 start_sets를 건드리지 않는다.
            pass
    
    # 2단계: 미디어 설정 업데이트
    if character_data.media_settings:
        media = character_data.media_settings
        update_data.update({
            'avatar_url': media.avatar_url,
            'image_descriptions': [img.model_dump() for img in media.image_descriptions],
            'voice_settings': media.voice_settings.model_dump() if media.voice_settings else None
        })
    
    # 4단계: 호감도 시스템 업데이트
    if character_data.affinity_system:
        affinity = character_data.affinity_system
        update_data.update({
            'has_affinity_system': affinity.has_affinity_system,
            'affinity_rules': affinity.affinity_rules,
            'affinity_stages': [stage.model_dump() for stage in affinity.affinity_stages]
        })
    
    # 5단계: 공개 설정 업데이트
    if character_data.publish_settings:
        publish = character_data.publish_settings
        update_data.update({
            'is_public': publish.is_public,
            'custom_module_id': publish.custom_module_id,
            'use_translation': publish.use_translation
        })
    
    # 캐릭터 정보 업데이트
    if update_data:
        await db.execute(
            update(Character)
            .where(Character.id == character_id)
            .values(**update_data)
        )
    
    # 3단계: 예시 대화 업데이트
    if character_data.example_dialogues is not None:
        # 기존 예시 대화 삭제
        await db.execute(
            delete(CharacterExampleDialogue)
            .where(CharacterExampleDialogue.character_id == character_id)
        )
        
        # 새로운 예시 대화 추가
        for dialogue in character_data.example_dialogues.dialogues:
            example_dialogue = CharacterExampleDialogue(
                character_id=character_id,
                user_message=dialogue.user_message,
                character_response=dialogue.character_response,
                order_index=dialogue.order_index
            )
            db.add(example_dialogue)
    
    await db.commit()
    
    return await get_advanced_character_by_id(db, character_id)


async def get_advanced_character_by_id(db: AsyncSession, character_id: uuid.UUID) -> Optional[Character]:
    """고급 캐릭터 상세 정보 조회 (예시 대화 포함)"""
    result = await db.execute(
        select(Character)
        .options(
            selectinload(Character.settings),
            selectinload(Character.example_dialogues),
            joinedload(Character.creator),
            selectinload(Character.tags)
        )
        .where(Character.id == character_id)
    )
    return result.scalar_one_or_none()


def generate_advanced_system_prompt(character: Character, character_data: CharacterCreateRequest) -> str:
    """고급 캐릭터를 위한 시스템 프롬프트 생성"""
    
    prompt_parts = []
    
    # 기본 캐릭터 정보
    prompt_parts.append(f"당신은 {character.name}입니다.")
    
    if character.personality:
        prompt_parts.append(f"성격: {character.personality}")
    
    if character.speech_style:
        prompt_parts.append(f"말투: {character.speech_style}")
    
    # 세계관 설정
    if character.world_setting:
        prompt_parts.append(f"세계관: {character.world_setting}")
    
    # 도입부 컨텍스트 (비밀 정보 포함)
    if character.introduction_scenes:
        for i, scene in enumerate(character.introduction_scenes):
            if isinstance(scene, dict) and scene.get('secret'):
                prompt_parts.append(f"비밀 정보 {i+1}: {scene['secret']}")
    
    # 호감도 시스템
    if character.has_affinity_system and character.affinity_rules:
        prompt_parts.append(f"호감도 규칙: {character.affinity_rules}")
    
    # 예시 대화 활용 (프롬프트에 포함하지 않고 별도 처리)
    prompt_parts.append("사용자와 자연스럽고 일관된 대화를 나누세요.")
    
    return "\n\n".join(prompt_parts)


async def get_character_example_dialogues(
    db: AsyncSession, 
    character_id: uuid.UUID
) -> List[CharacterExampleDialogue]:
    """캐릭터의 예시 대화 목록 조회"""
    result = await db.execute(
        select(CharacterExampleDialogue)
        .where(CharacterExampleDialogue.character_id == character_id)
        .order_by(CharacterExampleDialogue.order_index)
    )
    return result.scalars().all()


async def add_character_example_dialogue(
    db: AsyncSession,
    character_id: uuid.UUID,
    user_message: str,
    character_response: str,
    order_index: int = 0
) -> CharacterExampleDialogue:
    """캐릭터 예시 대화 추가"""
    dialogue = CharacterExampleDialogue(
        character_id=character_id,
        user_message=user_message,
        character_response=character_response,
        order_index=order_index
    )
    db.add(dialogue)
    await db.commit()
    await db.refresh(dialogue)
    return dialogue


async def delete_character_example_dialogue(
    db: AsyncSession,
    dialogue_id: uuid.UUID
) -> bool:
    """캐릭터 예시 대화 삭제"""
    result = await db.execute(
        delete(CharacterExampleDialogue)
        .where(CharacterExampleDialogue.id == dialogue_id)
    )
    await db.commit()
    return result.rowcount > 0


# 🔧 기존 서비스 함수들 (레거시 호환성)

async def create_character(
    db: AsyncSession,
    creator_id: uuid.UUID,
    character_data: CharacterCreate
) -> Character:
    """캐릭터 생성 (레거시)"""
    # 🔧 레거시 스키마를 새로운 모델 구조에 매핑
    character_dict = character_data.model_dump()
    
    # background_story를 world_setting으로 매핑
    if 'background_story' in character_dict:
        character_dict['world_setting'] = character_dict.pop('background_story')
    
    character = Character(
        creator_id=creator_id,
        **character_dict
    )
    db.add(character)
    
    # 기본 설정 생성
    default_setting = CharacterSetting(
        character=character,
        system_prompt=f"당신은 {character.name}입니다. {character.personality or '친근하고 도움이 되는 성격입니다.'}"
    )
    db.add(default_setting)

    # flush를 통해 ID를 먼저 할당받습니다.
    await db.flush()
    character_id = character.id

    await db.commit()
    
    # 커밋 후에는 인스턴스가 만료되므로, 관계가 로드된 새 인스턴스를 다시 가져옵니다.
    created_character = await get_character_by_id(db=db, character_id=character_id)
    return created_character


async def get_character_by_id(db: AsyncSession, character_id: uuid.UUID) -> Optional[Character]:
    """ID로 캐릭터 조회"""
    result = await db.execute(
        select(Character)
        .options(
            selectinload(Character.settings),
            joinedload(Character.creator),
            selectinload(Character.tags),
        )
        .where(Character.id == character_id)
    )
    return result.scalar_one_or_none()


async def get_characters_by_creator(
    db: AsyncSession,
    creator_id: uuid.UUID,
    skip: int = 0,
    limit: int = 20,
    search: Optional[str] = None,
    include_private: bool = False,
    only: Optional[str] = None,
) -> List[Character]:
    """생성자별 캐릭터 목록 조회"""
    query = (
        select(Character)
        .options(
            joinedload(Character.creator),
            selectinload(Character.tags),
            selectinload(Character.origin_story),
        )
        .where(Character.creator_id == creator_id)
    )
    
    if not include_private:
        query = query.where(Character.is_public == True)
    
    if search:
        raw = search.strip()
        if raw:
            tag_search = raw.lstrip("#").strip() or raw
            creator_search = raw.lstrip("@").strip() or raw
            name_like = f"%{raw}%"
            creator_like = f"%{creator_search}%"
            tag_like = f"%{tag_search}%"
            query = query.where(
                or_(
                    Character.name.ilike(name_like),
                    Character.description.ilike(name_like),
                    Character.creator.has(User.username.ilike(creator_like)),
                    Character.tags.any(
                        or_(
                            Tag.slug.ilike(tag_like),
                            Tag.name.ilike(tag_like)
                        )
                    )
                )
            )

    # 원작챗/일반 필터
    if only:
        only_key = (only or "").strip().lower()
        if only_key in ["origchat", "original_chat", "origin"]:
            query = query.where(Character.origin_story_id.isnot(None))
        elif only_key in ["regular", "normal", "characterchat", "characters"]:
            # ✅ "일반 캐릭터챗" = 원작챗이 아니고 + 웹소설(임포트)도 아닌 것
            # - 프론트에서 '캐릭터' 배지 대상만 보여주기 위함
            # - legacy 데이터에서 source_type이 NULL일 수 있어 OR 조건으로 포함한다.
            query = query.where(Character.origin_story_id.is_(None))
            query = query.where(or_(Character.source_type.is_(None), Character.source_type != "IMPORTED"))
    
    query = query.order_by(Character.created_at.desc()).offset(skip).limit(limit)
    
    result = await db.execute(query)
    return result.scalars().all()


async def get_public_characters(
    db: AsyncSession,
    skip: int = 0,
    limit: int = 20,
    search: Optional[str] = None,
    sort: Optional[str] = None,
    source_type: Optional[str] = None,
    tags: Optional[list[str]] = None,
    gender: Optional[str] = None,
    only: Optional[str] = None,
) -> List[Character]:
    """공개 캐릭터 목록 조회"""
    query = (
        select(Character)
        .options(
            joinedload(Character.creator),
            selectinload(Character.tags),
            selectinload(Character.origin_story),
        )
        .outerjoin(Story, Character.origin_story_id == Story.id)
        .where(and_(Character.is_public == True, Character.is_active == True))
        # ✅ 안전/의도:
        # - 원작챗 캐릭터(origin_story_id가 있는 캐릭터)는 "원작 스토리"가 공개일 때만 공개 목록에 노출한다.
        # - 스토리가 비공개인데 캐릭터만 공개로 남아있으면 홈/랭킹/탐색에서 노출되어
        #   "비공개가 안 되는 것처럼" 보일 수 있으므로, 공개 목록 단계에서 차단한다.
        .where(or_(Character.origin_story_id.is_(None), Story.is_public == True))
    )
    
    if search:
        raw = search.strip()
        if raw:
            tag_search = raw.lstrip("#").strip() or raw
            creator_search = raw.lstrip("@").strip() or raw
            name_like = f"%{raw}%"
            creator_like = f"%{creator_search}%"
            tag_like = f"%{tag_search}%"
            query = query.where(
                or_(
                    Character.name.ilike(name_like),
                    Character.description.ilike(name_like),
                    Character.creator.has(User.username.ilike(creator_like)),
                    Character.tags.any(
                        or_(
                            Tag.slug.ilike(tag_like),
                            Tag.name.ilike(tag_like)
                        )
                    )
                )
            )

    # 출처 유형 필터 (예: ORIGINAL, IMPORTED)
    if source_type:
        query = query.where(Character.source_type == source_type)
    
    # 원작챗/일반 캐릭터 필터
    if only:
        only_key = (only or "").strip().lower()
        if only_key in ["origchat", "original_chat", "origin"]:
            query = query.where(Character.origin_story_id.isnot(None))
        elif only_key in ["regular", "normal", "characterchat", "characters"]:
            # ✅ "일반 캐릭터챗" = 원작챗이 아니고 + 웹소설(임포트)도 아닌 것
            query = query.where(Character.origin_story_id.is_(None))
            query = query.where(or_(Character.source_type.is_(None), Character.source_type != "IMPORTED"))

    # 성별 필터(태그 기반)
    # - 요구사항: 전체/남성/여성/그외
    # - 남성/여성: 해당 태그를 가진 캐릭터만
    # - 그외: 남성/여성 태그가 "없는" 캐릭터
    if gender:
        try:
            g = (gender or "").strip().lower()
        except Exception:
            g = ""
        if g in ["male", "m", "남성"]:
            query = query.where(Character.tags.any(Tag.slug == "남성"))
        elif g in ["female", "f", "여성"]:
            query = query.where(Character.tags.any(Tag.slug == "여성"))
        elif g in ["other", "etc", "그외", "기타"]:
            # ✅ 남성/여성 태그가 모두 없는 경우
            query = query.where(~Character.tags.any(Tag.slug.in_(["남성", "여성"])))
    
    # 태그 필터 (AND)
    # - 기존 구현은 join + Tag.slug == A AND Tag.slug == B 형태로 다중 태그가 사실상 동작하지 않았다.
    # - `Character.tags.any(...)`를 slug별로 AND로 누적하면 의도대로 "모든 태그 포함" 필터가 된다.
    if tags:
        # ✅ 시스템 태그(필터 전용): '롤플/시뮬/커스텀'은 DB 태그 매핑이 아니라 character_type 필터로 해석한다.
        #
        # 배경/의도:
        # - 운영 데이터에서 character_type은 컬럼(SSOT)로 존재하지만, 모든 캐릭터가 동일 내용을 Tag로도 갖고 있지는 않다.
        # - 따라서 캐릭터 탭에서 '롤플/시뮬/커스텀' 태그를 선택했을 때 결과가 0개가 되는 것을 방지하기 위해,
        #   서버에서 해당 slug를 character_type 필터로 매핑한다.
        #
        # 규칙:
        # - 여러 개가 동시에 들어오면 OR(IN)로 처리한다(방어적).
        type_map = {
            "롤플": "roleplay",
            "시뮬": "simulator",
            "커스텀": "custom",
        }
        requested_types = []
        normalized_tags = []
        seen_tags = set()
        for slug in tags:
            try:
                s = str(slug or "").strip()
            except Exception:
                s = ""
            # ✅ UX 방어: '#태그' 입력 호환(프론트/운영에서 해시를 붙여 쓰는 경우가 많다)
            if s.startswith("#"):
                s = s.lstrip("#").strip()
            if not s:
                continue
            if s in seen_tags:
                continue
            seen_tags.add(s)
            normalized_tags.append(s)
            t = type_map.get(s)
            if not t:
                continue
            if t in requested_types:
                continue
            requested_types.append(t)

        if requested_types:
            # ✅ 방어: legacy 데이터에서 character_type이 NULL/빈 문자열일 수 있어,
            # '롤플(roleplay)' 필터는 NULL도 roleplay로 간주한다.
            conds = []
            if "roleplay" in requested_types:
                conds.append(
                    or_(
                        Character.character_type == "roleplay",
                        Character.character_type.is_(None),
                        Character.character_type == "",
                    )
                )
            if "simulator" in requested_types:
                conds.append(Character.character_type == "simulator")
            if "custom" in requested_types:
                conds.append(Character.character_type == "custom")
            if conds:
                query = query.where(or_(*conds))

        for s in normalized_tags:
            # ✅ system character_type tag는 Tag 조인 필터에서 제외한다.
            if s in type_map:
                continue
            query = query.where(Character.tags.any(Tag.slug == s))

    # 정렬 옵션
    order_sort = (sort or "").lower() if sort else None
    if order_sort in ["views", "view", "조회수", "chats", "chat_count"]:
        # 조회수 개념: 채팅 수 기준 내림차순, 동률 시 좋아요/최신순 보조 정렬
        query = query.order_by(
            Character.chat_count.desc(),
            Character.like_count.desc(),
            Character.created_at.desc(),
        )
    elif order_sort in ["likes", "like", "좋아요"]:
        query = query.order_by(
            Character.like_count.desc(),
            Character.created_at.desc(),
        )
    elif order_sort in ["recent", "latest", "최신", "created_at"]:
        query = query.order_by(Character.created_at.desc())
    else:
        # 기본 정렬: 좋아요 내림차순, 최신순
        query = query.order_by(Character.like_count.desc(), Character.created_at.desc())

    query = query.offset(skip).limit(limit)
    
    result = await db.execute(query)
    return result.scalars().all()


async def update_character(
    db: AsyncSession,
    character_id: uuid.UUID,
    character_data: CharacterUpdate
) -> Optional[Character]:
    """캐릭터 정보 수정"""
    update_data = character_data.model_dump(exclude_unset=True)
    
    # 🔧 레거시 스키마를 새로운 모델 구조에 매핑
    if 'background_story' in update_data:
        update_data['world_setting'] = update_data.pop('background_story')
    
    if update_data:
        await db.execute(
            update(Character)
            .where(Character.id == character_id)
            .values(**update_data)
        )
        await db.commit()
    
    return await get_character_by_id(db, character_id)


async def update_character_public_status(
    db: AsyncSession,
    character_id: uuid.UUID,
    is_public: bool
) -> Optional[Character]:
    """캐릭터의 공개 상태를 수정합니다."""
    await db.execute(
        update(Character)
        .where(Character.id == character_id)
        .values(is_public=is_public)
    )
    await db.commit()
    return await get_character_by_id(db, character_id)


async def delete_character(db: AsyncSession, character_id: uuid.UUID) -> bool:
    """
    캐릭터 삭제

    배경/의도:
    - Postgres(Supabase)에서는 FK 제약이 엄격하게 적용되어, `characters`를 먼저 DELETE 하면
      `character_settings` 등 참조 테이블 때문에 IntegrityError가 발생할 수 있다.
    - SQLite에서는 FK가 느슨해(또는 미활성) 개발 중에는 문제가 안 보일 수 있으므로,
      운영 안전을 위해 "참조 데이터 선삭제 → 캐릭터 삭제" 순서를 보장한다.

    동작:
    - 캐릭터를 참조하는 하위 테이블 레코드를 멱등하게 정리한다.
    - 마지막에 `characters`를 DELETE 한다.
    """

    # 1) 스토리 메인 연결은 스토리를 살리고, 캐릭터 연결만 끊는다(null 허용)
    await db.execute(
        update(Story)
        .where(Story.character_id == character_id)
        .values(character_id=None)
    )

    # 2) 원작챗 추출 캐릭터 매핑(등장인물 그리드) 정리
    await db.execute(
        delete(StoryExtractedCharacter).where(StoryExtractedCharacter.character_id == character_id)
    )

    # 3) 유저별 기억노트(캐릭터 참조) 제거
    await db.execute(
        delete(MemoryNote).where(MemoryNote.character_id == character_id)
    )

    # 4) 캐릭터 설정/예시대화/댓글/좋아요/태그 매핑/북마크 제거
    await db.execute(
        delete(CharacterSetting).where(CharacterSetting.character_id == character_id)
    )
    await db.execute(
        delete(CharacterExampleDialogue).where(CharacterExampleDialogue.character_id == character_id)
    )
    await db.execute(
        delete(CharacterComment).where(CharacterComment.character_id == character_id)
    )
    await db.execute(
        delete(CharacterLike).where(CharacterLike.character_id == character_id)
    )
    await db.execute(
        delete(CharacterBookmark).where(CharacterBookmark.character_id == character_id)
    )
    await db.execute(
        delete(CharacterTag).where(CharacterTag.character_id == character_id)
    )

    # 5) 채팅 로그 정리
    # - chat_message_edits → chat_messages → chat_rooms 순서로 제거해야 FK 충돌이 없다.
    room_ids_subq = select(ChatRoom.id).where(ChatRoom.character_id == character_id)
    msg_ids_subq = select(ChatMessage.id).where(ChatMessage.chat_room_id.in_(room_ids_subq))
    await db.execute(
        delete(ChatMessageEdit).where(ChatMessageEdit.message_id.in_(msg_ids_subq))
    )
    await db.execute(
        delete(ChatMessage).where(ChatMessage.chat_room_id.in_(room_ids_subq))
    )
    await db.execute(
        delete(ChatRoom).where(ChatRoom.character_id == character_id)
    )

    # 6) 최종: 캐릭터 삭제
    result = await db.execute(
        delete(Character).where(Character.id == character_id)
    )
    await db.commit()
    return (getattr(result, "rowcount", 0) or 0) > 0


async def create_character_setting(
    db: AsyncSession,
    character_id: uuid.UUID,
    setting_data: CharacterSettingCreate
) -> CharacterSetting:
    """캐릭터 설정 생성"""
    # 기존 설정이 있으면 삭제
    await db.execute(
        delete(CharacterSetting).where(CharacterSetting.character_id == character_id)
    )
    
    setting = CharacterSetting(
        character_id=character_id,
        **setting_data.model_dump()
    )
    db.add(setting)
    await db.commit()
    await db.refresh(setting)
    return setting


async def get_character_setting(db: AsyncSession, character_id: uuid.UUID) -> Optional[CharacterSetting]:
    """캐릭터 설정 조회"""
    result = await db.execute(
        select(CharacterSetting).where(CharacterSetting.character_id == character_id)
    )
    return result.scalar_one_or_none()


async def update_character_setting(
    db: AsyncSession,
    character_id: uuid.UUID,
    setting_data: CharacterSettingUpdate
) -> Optional[CharacterSetting]:
    """캐릭터 설정 수정"""
    update_data = setting_data.model_dump(exclude_unset=True)
    
    if update_data:
        await db.execute(
            update(CharacterSetting)
            .where(CharacterSetting.character_id == character_id)
            .values(**update_data)
        )
        await db.commit()
    
    return await get_character_setting(db, character_id)


async def like_character(db: AsyncSession, character_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    """캐릭터 좋아요"""
    # 좋아요 추가
    like = CharacterLike(character_id=character_id, user_id=user_id)
    db.add(like)
    
    # 캐릭터 좋아요 수 증가
    await db.execute(
        update(Character)
        .where(Character.id == character_id)
        .values(like_count=Character.like_count + 1)
    )
    
    await db.commit()
    return True


async def unlike_character(db: AsyncSession, character_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    """캐릭터 좋아요 취소"""
    # 좋아요 삭제
    result = await db.execute(
        delete(CharacterLike).where(
            and_(
                CharacterLike.character_id == character_id,
                CharacterLike.user_id == user_id
            )
        )
    )
    
    if result.rowcount > 0:
        # 캐릭터 좋아요 수 감소
        await db.execute(
            update(Character)
            .where(Character.id == character_id)
            .values(like_count=Character.like_count - 1)
        )
        await db.commit()
        return True
    
    return False


async def is_character_liked_by_user(db: AsyncSession, character_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    """사용자가 캐릭터에 좋아요를 눌렀는지 확인"""
    result = await db.execute(
        select(CharacterLike).where(
            and_(
                CharacterLike.character_id == character_id,
                CharacterLike.user_id == user_id
            )
        )
    )
    return result.scalar_one_or_none() is not None


async def increment_character_chat_count(db: AsyncSession, character_id: uuid.UUID) -> bool:
    """캐릭터 채팅 수 증가"""
    result = await db.execute(
        update(Character)
        .where(Character.id == character_id)
        .values(chat_count=Character.chat_count + 1)
    )
    await db.commit()
    return result.rowcount > 0

async def get_real_message_count(db: AsyncSession, character_id: uuid.UUID) -> int:
    """해당 캐릭터와 연결된 모든 메시지 수 실시간 계산"""
    result = await db.execute(
        select(func.count(ChatMessage.id))
        .join(ChatRoom, ChatMessage.chat_room_id == ChatRoom.id)
        .where(ChatRoom.character_id == character_id)
    )
    return result.scalar() or 0

async def sync_character_chat_count(db: AsyncSession, character_id: uuid.UUID) -> bool:
    """캐릭터 대화수를 실제 메시지 수와 동기화"""
    real_count = await get_real_message_count(db, character_id)
    result = await db.execute(
        update(Character)
        .where(Character.id == character_id)
        .values(chat_count=real_count)
    )
    await db.commit()
    return result.rowcount > 0


async def get_real_message_count(db: AsyncSession, character_id: uuid.UUID) -> int:
    """해당 캐릭터와 연결된 모든 메시지 수 실시간 계산"""
    result = await db.execute(
        select(func.count(ChatMessage.id))
        .join(ChatRoom, ChatMessage.chat_room_id == ChatRoom.id)
        .where(ChatRoom.character_id == character_id)
    )
    return result.scalar() or 0

async def sync_character_chat_count(db: AsyncSession, character_id: uuid.UUID) -> bool:
    """캐릭터 대화수를 실제 메시지 수와 동기화"""
    real_count = await get_real_message_count(db, character_id)
    result = await db.execute(
        update(Character)
        .where(Character.id == character_id)
        .values(chat_count=real_count)
    )
    await db.commit()
    return result.rowcount > 0
