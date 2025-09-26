"""
채팅 관련 API 라우터
CAVEDUCK 스타일: 채팅 중심 최적화
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from typing import List, Optional, Dict, Any
import uuid
import json
import time

from app.core.database import get_db, AsyncSessionLocal
from app.core.config import settings
from app.core.security import get_current_user, get_current_user_optional
from app.models.user import User
from app.models.character import CharacterSetting, CharacterExampleDialogue, Character
from app.models.story import Story
from app.models.story_chapter import StoryChapter
from app.models.story_summary import StoryEpisodeSummary

from app.services import chat_service
from app.services import origchat_service
from app.services import ai_service
from app.services.memory_note_service import get_active_memory_notes_by_character
from app.services.user_persona_service import get_active_persona_by_user
from app.schemas.chat import (
    ChatRoomResponse, 
    ChatMessageResponse, 
    CreateChatRoomRequest, 
    SendMessageRequest,
    SendMessageResponse,
    ChatMessageUpdate,
    RegenerateRequest,
    MessageFeedback,
)

router = APIRouter()

async def _get_room_meta(room_id: uuid.UUID | str) -> Dict[str, Any]:
    try:
        from app.core.database import redis_client
        raw = await redis_client.get(f"chat:room:{room_id}:meta")
        if raw:
            try:
                raw_str = raw.decode("utf-8") if isinstance(raw, (bytes, bytearray)) else raw
            except Exception:
                raw_str = raw
            return json.loads(raw_str)
    except Exception:
        pass
    return {}


async def _set_room_meta(room_id: uuid.UUID | str, data: Dict[str, Any], ttl: int = 2592000) -> None:
    try:
        from app.core.database import redis_client
        meta = await _get_room_meta(room_id)
        meta.update(data)
        meta["updated_at"] = int(time.time())
        await redis_client.setex(f"chat:room:{room_id}:meta", ttl, json.dumps(meta))
    except Exception:
        pass


async def _build_light_context(db: AsyncSession, story_id, player_max: Optional[int]) -> Optional[str]:
    if not story_id:
        return None
    anchor = int(player_max or 1)
    summary = None
    excerpt = None
    try:
        res = await db.execute(
            select(StoryEpisodeSummary.cumulative_summary)
            .where(StoryEpisodeSummary.story_id == story_id, StoryEpisodeSummary.no == anchor)
        )
        summary = (res.first() or [None])[0]
    except Exception:
        summary = None
    try:
        row = await db.execute(
            select(StoryChapter.content)
            .where(StoryChapter.story_id == story_id, StoryChapter.no == anchor)
        )
        excerpt = (row.first() or [None])[0]
    except Exception:
        excerpt = None
    parts = []
    if summary:
        parts.append(f"[요약] {summary[-800:]}")
    if excerpt:
        parts.append(f"[장면] {(excerpt or '')[:600]}")
    text = "\n\n".join(parts).strip()
    return text or None

# --- Agent simulator (no character, optional auth) ---
@router.post("/agent/simulate")
async def agent_simulate(
    payload: dict,
    current_user = Depends(get_current_user_optional),
):
    """간단한 에이전트 시뮬레이터: 프론트의 모델 선택을 매핑하여 AI 응답을 생성합니다.
    요청 예시: { content, history?, model?, sub_model?, staged?, mode? }
    응답: { assistant: string }
    """
    try:
        # 새로운 staged 형식 처리
        if "staged" in payload:
            # 새로운 Composer UI에서 온 요청
            staged = payload.get("staged") or []
            mode = payload.get("mode", "micro")
            story_mode = payload.get("storyMode", "auto")  # 'snap' | 'genre' | 'auto'
            
            # staged 아이템에서 텍스트와 이미지 추출
            content = ""
            image_url = None
            image_style = None
            emojis = []
            
            for item in staged:
                if item.get("type") == "image":
                    image_url = item.get("url")
                    image_style = item.get("style") or image_style
                    if item.get("caption"):
                        content += (" " if content else "") + item["caption"]
                elif item.get("type") == "text":
                    content += (" " if content else "") + item.get("body", "")
                elif item.get("type") == "emoji":
                    emojis.extend(item.get("items", []))
            
            # 스토리 모드 자동 감지 (auto인 경우)
            if story_mode == "auto":
                # 일상 이모지와 장르 이모지 분류
                snap_emojis = {"😊", "☕", "🌸", "💼", "🌧️", "😢", "💤", "🎉"}
                genre_emojis = {"🔥", "⚔️", "💀", "😱", "🔪", "🌙", "✨", "😎"}
                
                snap_score = sum(1 for e in emojis if e in snap_emojis)
                genre_score = sum(1 for e in emojis if e in genre_emojis)
                
                # 이미지 분석 추가 (나중에 태그 기반으로 보강 가능)
                if image_url:
                    # 간단한 휴리스틱 (실제로는 이미지 태그 분석 필요)
                    if "cafe" in (content or "").lower() or "coffee" in (content or "").lower():
                        snap_score += 2
                    if "dark" in (content or "").lower() or "fantasy" in (content or "").lower():
                        genre_score += 2
                
                # 최종 모드 결정
                story_mode = "snap" if snap_score > genre_score else "genre" if genre_score > 0 else "snap"
                # logger.info(f"Auto-detected story mode: {story_mode} (snap:{snap_score}, genre:{genre_score})")
            
            # 이모지를 텍스트에 추가 (감정 힌트로 활용)
            emoji_hint = ""
            if emojis:
                # 이모지를 감정/분위기 힌트로 변환
                emoji_map = {
                    "😊": "밝고 긍정적인",
                    "😠": "화나고 분노한", 
                    "😢": "슬프고 우울한",
                    "😎": "쿨하고 자신감 있는",
                    "✨": "반짝이고 특별한",
                    "💼": "비즈니스적이고 진지한",
                    "☕": "여유롭고 편안한",
                    "🌧️": "우울하고 침체된",
                    "🫠": "녹아내리는 듯한",
                    "🔥": "열정적이고 뜨거운",
                    "💤": "피곤하고 나른한",
                    "🎉": "축하하고 즐거운",
                    "🌸": "봄날같고 화사한",
                    "⚔️": "전투적이고 용맹한",
                    "💀": "어둡고 위험한",
                    "😱": "충격적이고 놀라운",
                    "🔪": "날카롭고 위협적인",
                    "🌙": "신비롭고 몽환적인"
                }
                
                moods = []
                for emoji in emojis:
                    if emoji in emoji_map:
                        moods.append(emoji_map[emoji])
                
                if moods:
                    emoji_hint = f"[감정/분위기: {', '.join(moods)}] "
                    content = emoji_hint + content
                else:
                    content += (" " if content else "") + " ".join(emojis)
            
            # 기본 프롬프트
            if not content and image_url:
                content = "첨부된 이미지를 바탕으로 몰입감 있는 이야기를 만들어주세요."
                
            history = []  # staged 형식은 보통 새로운 대화
        else:
            # 기존 형식 처리
            content = (payload.get("content") or "").strip()
            history = payload.get("history") or []
            image_url = None
            image_style = None
            story_mode = None  # 기존 형식에서는 story_mode가 없음
            
            # 히스토리에서 이미지 URL 추출 (기존 로직)
            for h in reversed(history or []):
                if h.get("type") == "image" and h.get("content"):
                    image_url = h.get("content")
                    break
        
        ui_model = (payload.get("model") or "").lower()
        ui_sub = (payload.get("sub_model") or ui_model or "").lower()

        # UI 모델명을 ai_service 기대 형식으로 매핑
        # [임시] GPT와 Gemini 비활성화 - 모든 요청을 Claude로 강제 전환
        preferred_model = "claude"
        preferred_sub_model = "claude-sonnet-4-20250514"
        
        # 원래 로직 (임시 비활성화)
        # if "claude" in ui_model or "claude" in ui_sub:
        #     preferred_model = "claude"
        #     preferred_sub_model = "claude-3-5-sonnet-20241022"
        # elif "gpt-4.1" in ui_model or "gpt-4.1" in ui_sub:
        #     preferred_model = "gpt"
        #     preferred_sub_model = "gpt-4.1"
        # elif "gpt-4o" in ui_model or "gpt-4o" in ui_sub or "gpt" in ui_model:
        #     preferred_model = "gpt"
        #     preferred_sub_model = "gpt-4o"
        # elif "gemini-2.5-flash" in ui_model or "flash" in ui_sub:
        #     preferred_model = "gemini"
        #     preferred_sub_model = "gemini-2.5-flash"
        # else:
        #     preferred_model = "gemini"
        #     preferred_sub_model = "gemini-2.5-pro"

        # 이미지가 있으면 이미지 그라운딩 집필 사용
        generated_image_url = None
        if image_url:
            # 스타일 숏컷 매핑(이미지 생성/삽입에만 적용)
            style_map = {
                "anime": "애니메이션풍(만화/셀셰이딩/선명한 콘트라스트)",
                "photo": "실사풍(현실적 묘사/사진적 질감)",
                "semi": "반실사풍(현실+일러스트 절충)"
            }
            style_prompt = style_map.get((image_style or "").strip().lower()) if image_style else None
            
            # 1. 스토리 생성 (모드별 분기)
            # 사용자 닉네임 가져오기 (1인칭 시점용)
            username = None
            if current_user:
                username = current_user.username or current_user.email.split('@')[0]
            
            text = await ai_service.write_story_from_image_grounded(
                image_url=image_url,
                user_hint=content,
                model=preferred_model,
                sub_model=preferred_sub_model,
                style_prompt=style_prompt,
                story_mode=story_mode,  # 'snap' | 'genre' | 'auto'
                username=username,  # 1인칭 시점에서 사용
            )
            
            # 2. 생성된 스토리를 바탕으로 새 이미지 프롬프트 생성 (일시적으로 비활성화)
            # TODO: 이미지 생성 기능 안정화 필요
            """
            try:
                # 원본 이미지 태그 가져오기 (스타일 참고용)
                original_tags = await ai_service.tag_image_keywords(image_url, model='claude')
                
                # 스토리 기반 이미지 프롬프트 생성
                image_prompt = await ai_service.generate_image_prompt_from_story(
                    story_text=text,
                    original_tags=original_tags
                )
                
                # 3. 새 이미지 생성 (Gemini 이미지 생성 API 사용)
                from app.services.media_service import generate_image_gemini
                generated_images = await generate_image_gemini(
                    prompt=image_prompt,
                    count=1,
                    ratio="3:4"
                )
                
                if generated_images and len(generated_images) > 0:
                    generated_image_url = generated_images[0]
                    logger.info(f"Generated new image based on story: {generated_image_url}")
                    
            except Exception as e:
                logger.error(f"Failed to generate new image: {e}")
                # 이미지 생성 실패해도 스토리는 반환
            """
        else:
            # 스토리 모드가 있으면 프롬프트 조정
            if story_mode:
                # 모드별 시스템 프롬프트 생성
                if story_mode == "snap":
                    character_prompt = """당신은 일상의 순간을 포착하는 작가입니다.
- 200-300자 분량의 짧고 공감가는 일상 스토리
- SNS 피드에 올릴 법한 친근한 문체
- 따뜻하거나 위트있는 톤
- 오글거리지 않고 자연스럽게"""
                elif story_mode == "genre":
                    character_prompt = """당신은 장르소설 전문 작가입니다.
- 500-800자 분량의 몰입감 있는 장르 스토리
- 긴장감 있는 전개와 생생한 묘사
- 장르 관습을 따르되 신선하게
- 다음이 궁금해지는 마무리"""
                else:
                    character_prompt = ""
            else:
                character_prompt = ""

            text = await ai_service.get_ai_chat_response(
                character_prompt=character_prompt,
                user_message=content,
                history=history,
                preferred_model=preferred_model,
                preferred_sub_model=preferred_sub_model,
                response_length_pref="short" if story_mode == "snap" else "medium",
            )
        
        response = {"assistant": text}
        
        # 생성된 이미지가 있으면 응답에 포함
        if image_url and generated_image_url:
            response["generated_image"] = generated_image_url
            
        return response
    except Exception as e:
        # 안전 가드: 에러를 로깅하고, 원인 문자열을 함께 전달(임시 진단 목적)
        try:
            from app.core.logger import logger
            logger.exception(f"/chat/agent/simulate failed: {e}")
        except Exception:
            print(f"/chat/agent/simulate failed: {e}")
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail=f"agent_simulate_error: {e}")

# 🔥 CAVEDUCK 스타일 핵심 채팅 API (4개)

@router.post("/start", response_model=ChatRoomResponse, status_code=status.HTTP_201_CREATED)
async def start_chat(
    request: CreateChatRoomRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """채팅 시작 - CAVEDUCK 스타일 간단한 채팅 시작"""
    # 채팅방 가져오기 또는 생성
    chat_room = await chat_service.get_or_create_chat_room(
        db, user_id=current_user.id, character_id=request.character_id
    )
    
    # 새로 생성된 채팅방인 경우 (메시지가 없는 경우)
    existing_messages = await chat_service.get_messages_by_room_id(db, chat_room.id, limit=1)
    if not existing_messages and chat_room.character.greeting:
        # 캐릭터의 인사말을 첫 메시지로 저장
        await chat_service.save_message(
            db, chat_room.id, "assistant", chat_room.character.greeting
        )
        await db.commit()
    
    return chat_room

@router.post("/message", response_model=SendMessageResponse)
async def send_message(
    request: SendMessageRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """메시지 전송 - 핵심 채팅 기능"""
    # 1. 채팅방 및 캐릭터 정보 조회
    room = await chat_service.get_or_create_chat_room(db, current_user.id, request.character_id)
    if not room:
        raise HTTPException(status_code=404, detail="채팅방을 찾을 수 없습니다.")

    character = room.character
    
    # settings를 별도로 로드
    settings_result = await db.execute(
        select(CharacterSetting).where(CharacterSetting.character_id == character.id)
    )
    settings = settings_result.scalar_one_or_none()
    
    if not settings:
        # 기본 설정 생성
        settings = CharacterSetting(
            character_id=character.id,
            ai_model='gemini-pro',
            temperature=0.7,
            max_tokens=300
        )
        db.add(settings)
        await db.commit()

    # 2. 사용자 메시지 저장 (continue 모드면 저장하지 않음)
    save_user_message = True
    clean_content = (request.content or "").strip()
    is_continue = (clean_content == "" or clean_content.lower() in {"continue", "계속", "continue please"})
    if is_continue:
        save_user_message = False
    if save_user_message:
        user_message = await chat_service.save_message(
            db, room.id, "user", request.content
        )
    else:
        user_message = None

    # 3. AI 응답 생성 (CAVEDUCK 스타일 최적화)
    history = await chat_service.get_messages_by_room_id(db, room.id, limit=20)
    
    # 예시 대화 가져오기
    example_dialogues_result = await db.execute(
        select(CharacterExampleDialogue)
        .where(CharacterExampleDialogue.character_id == character.id)
        .order_by(CharacterExampleDialogue.order_index)
    )
    example_dialogues = example_dialogues_result.scalars().all()
    
    # 활성화된 기억노트 가져오기
    active_memories = await get_active_memory_notes_by_character(
        db, current_user.id, character.id
    )
    
    # 현재 활성 유저 페르소나 가져오기
    active_persona = await get_active_persona_by_user(db, current_user.id)
    
    # 캐릭터 프롬프트 구성 (모든 정보 포함)
    character_prompt = f"""당신은 '{character.name}'입니다.

[기본 정보]
설명: {character.description or '설정 없음'}
성격: {character.personality or '설정 없음'}
말투: {character.speech_style or '설정 없음'}
배경 스토리: {character.background_story or '설정 없음'}

[세계관]
{character.world_setting or '설정 없음'}
"""

    # 유저 페르소나 정보 추가
    if active_persona:
        character_prompt += f"""

[대화 상대 정보]
이름: {active_persona.name}
특징: {active_persona.description}
위의 정보는 당신이 대화하고 있는 상대방에 대한 정보입니다. 이를 바탕으로 자연스럽게 대화하세요."""

    # 호감도 시스템이 있는 경우
    if character.has_affinity_system and character.affinity_rules:
        character_prompt += f"\n\n[호감도 시스템]\n{character.affinity_rules}"
        if character.affinity_stages:
            character_prompt += f"\n호감도 단계: {character.affinity_stages}"
    
    # 도입부 장면이 있는 경우
    if character.introduction_scenes:
        character_prompt += f"\n\n[도입부 설정]\n{character.introduction_scenes}"
    
    # 예시 대화가 있는 경우
    if example_dialogues:
        character_prompt += "\n\n[예시 대화]"
        for dialogue in example_dialogues:
            character_prompt += f"\nUser: {dialogue.user_message}"
            character_prompt += f"\n{character.name}: {dialogue.character_response}"
    
    # 기억노트가 있는 경우
    if active_memories:
        character_prompt += "\n\n[사용자와의 중요한 기억]"
        for memory in active_memories:
            character_prompt += f"\n• {memory.title}: {memory.content}"
    
    # 커스텀 프롬프트가 있는 경우
    if settings and settings.system_prompt:
        character_prompt += f"\n\n[추가 지시사항]\n{settings.system_prompt}"
    
    # 인사 반복 방지 가이드
    character_prompt += "\n\n위의 모든 설정에 맞게 캐릭터를 완벽하게 연기해주세요."
    character_prompt += "\n새로운 인사말이나 자기소개는 금지합니다. 기존 맥락을 이어서 답변하세요."

    # 대화 히스토리 구성 (요약 + 최근 50개)
    history_for_ai = []
    # 1) 요약 존재 시 프롬프트 앞부분에 포함
    if getattr(room, 'summary', None):
        history_for_ai.append({"role": "system", "parts": [f"(요약) {room.summary}"]})
    
    # 2) 최근 50개 사용
    recent_limit = 50
    for msg in history[-recent_limit:]:
        if msg.sender_type == "user":
            history_for_ai.append({"role": "user", "parts": [msg.content]})
        else:
            history_for_ai.append({"role": "model", "parts": [msg.content]})

    # 첫 인사 섹션은 메시지 생성 단계에서는 항상 제외 (초기 입장 시 /chat/start에서만 사용)
    # (안전망) 혹시 포함되어 있다면 제거
    character_prompt = character_prompt.replace("\n\n[첫 인사]\n" + (character.greeting or '안녕하세요.'), "")
    
    # AI 응답 생성 (사용자가 선택한 모델 사용)
    # continue 모드면 사용자 메시지를 이어쓰기 지시문으로 대체
    effective_user_message = (
        "바로 직전의 당신 답변을 이어서 자연스럽게 계속 작성해줘. 새로운 인사말이나 도입부 없이 본문만 이어쓰기."
        if is_continue else request.content
    )

    ai_response_text = await ai_service.get_ai_chat_response(
        character_prompt=character_prompt,
        user_message=effective_user_message,
        history=history_for_ai,
        preferred_model=current_user.preferred_model,
        preferred_sub_model=current_user.preferred_sub_model,
        response_length_pref=getattr(current_user, 'response_length_pref', 'medium')
    )

    # 4. AI 응답 메시지 저장
    ai_message = await chat_service.save_message(
        db, room.id, "assistant", ai_response_text
    )
    
    # 5. 캐릭터 채팅 수 증가 (사용자 메시지 기준으로 1회만 증가)
    from app.services import character_service
    await character_service.increment_character_chat_count(db, room.character_id)

    # 6. 필요 시 요약 생성/갱신: 메시지 총 수가 51 이상이 되는 최초 시점에 요약 저장
    try:
        new_count = (room.message_count or 0) + 1  # 이번 사용자 메시지 카운트 반영 가정
        if new_count >= 51 and not getattr(room, 'summary', None):
            # 최근 50개 이전의 히스토리를 요약(간단 요약)
            past_texts = []
            for msg in history[:-recent_limit]:
                role = '사용자' if msg.sender_type == 'user' else character.name
                past_texts.append(f"{role}: {msg.content}")
            past_chunk = "\n".join(past_texts[-500:])  # 안전 길이 제한
            if past_chunk:
                summary_prompt = "다음 대화의 핵심 사건과 관계, 맥락을 5줄 이내로 한국어 요약:\n" + past_chunk
                summary_text = await ai_service.get_ai_chat_response(
                    character_prompt="",
                    user_message=summary_prompt,
                    history=[],
                    preferred_model=current_user.preferred_model,
                    preferred_sub_model=current_user.preferred_sub_model
                )
                # DB 저장
                from sqlalchemy import update
                from app.models.chat import ChatRoom as _ChatRoom
                await db.execute(
                    update(_ChatRoom).where(_ChatRoom.id == room.id).set({"summary": summary_text[:4000]})
                )
                await db.commit()
    except Exception:
        # 요약 실패는 치명적이지 않으므로 무시
        pass
    
    return SendMessageResponse(
        user_message=user_message,
        ai_message=ai_message
    )

@router.get("/history/{session_id}", response_model=List[ChatMessageResponse])
async def get_chat_history(
    session_id: uuid.UUID,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """채팅 기록 조회 - 무한 스크롤 지원"""
    # TODO: 채팅방 소유권 확인 로직 추가
    messages = await chat_service.get_messages_by_room_id(db, session_id, skip, limit)
    return messages

@router.get("/sessions", response_model=List[ChatRoomResponse])
async def get_chat_sessions(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """내 채팅 목록 - 사용자의 모든 채팅 세션"""
    chat_rooms = await chat_service.get_chat_rooms_for_user(db, user_id=current_user.id)
    return chat_rooms

# 🔧 기존 호환성을 위한 엔드포인트 (점진적 마이그레이션)

@router.post("/rooms", response_model=ChatRoomResponse, status_code=status.HTTP_201_CREATED)
async def get_or_create_room_legacy(
    request: CreateChatRoomRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """채팅방 가져오기 또는 생성 (레거시 호환성)"""
    return await start_chat(request, current_user, db)

@router.get("/rooms", response_model=List[ChatRoomResponse])
async def get_user_chat_rooms_legacy(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """사용자의 채팅방 목록 조회 (레거시 호환성)"""
    return await get_chat_sessions(current_user, db)

@router.get("/rooms/{room_id}", response_model=ChatRoomResponse)
async def get_chat_room(
    room_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """특정 채팅방 정보 조회"""
    room = await chat_service.get_chat_room_by_id(db, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="채팅방을 찾을 수 없습니다.")
    
    # 권한 확인
    if room.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="이 채팅방에 접근할 권한이 없습니다.")
    
    return room


@router.get("/rooms/{room_id}/meta")
async def get_chat_room_meta(
    room_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """원작챗 전용: 룸 메타(진행도/설정) 조회(베스트-에포트)."""
    room = await chat_service.get_chat_room_by_id(db, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="채팅방을 찾을 수 없습니다.")
    if room.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="이 채팅방에 접근할 권한이 없습니다.")
    meta = await _get_room_meta(room_id)
    # 필요한 키만 노출(안전)
    allowed = {
        "mode": meta.get("mode"),
        "start": meta.get("start"),
        "focus_character_id": meta.get("focus_character_id"),
        "range_from": meta.get("range_from"),
        "range_to": meta.get("range_to"),
        "player_max": meta.get("player_max"),
        "max_turns": meta.get("max_turns"),
        "turn_count": meta.get("turn_count"),
        "completed": meta.get("completed"),
        "seed_label": meta.get("seed_label"),
        "narrator_mode": bool(meta.get("narrator_mode") or False),
        "init_stage": meta.get("init_stage"),
        "intro_ready": meta.get("intro_ready"),
        "updated_at": meta.get("updated_at"),
    }
    return allowed

@router.get("/rooms/{room_id}/messages", response_model=List[ChatMessageResponse])
async def get_messages_in_room_legacy(
    room_id: uuid.UUID,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """채팅방의 메시지 목록 조회 (레거시 호환성)"""
    return await get_chat_history(room_id, skip, limit, current_user, db)

@router.post("/messages", response_model=SendMessageResponse)
async def send_message_and_get_response_legacy(
    request: SendMessageRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """메시지 전송 및 AI 응답 생성 (레거시 호환성)"""
    return await send_message(request, current_user, db)


# ----- 원작챗 전용 엔드포인트 (경량 래퍼) -----
@router.post("/origchat/start", response_model=ChatRoomResponse, status_code=status.HTTP_201_CREATED)
async def origchat_start(
    payload: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """원작챗 세션 시작: 스토리/캐릭터/앵커 정보는 현재 저장하지 않고 룸만 생성/재사용."""
    try:
        if not settings.ORIGCHAT_V2:
            raise HTTPException(status_code=404, detail="origchat v2 비활성화")
        character_id = payload.get("character_id")
        if not character_id:
            raise HTTPException(status_code=400, detail="character_id가 필요합니다")
        # 원작챗은 모드별로 별도의 방을 생성하여 기존 일대일 기록과 분리
        room = await chat_service.create_chat_room(db, current_user.id, character_id)

        # 원작 스토리 플래그 지정(베스트 에포트)
        try:
            story_id = payload.get("story_id")
            if not story_id:
                row = await db.execute(select(Character.origin_story_id).where(Character.id == character_id))
                story_id = (row.first() or [None])[0]
            if story_id:
                await db.execute(update(Story).where(Story.id == story_id).values(is_origchat=True))
                await db.commit()
        except Exception:
            await db.rollback()

        # 경량 컨텍스트(앵커±소량) + v2 메타 저장
        # 시작점/범위 파라미터 정리
        _start = payload.get("start") or {}
        _start_chapter = None
        try:
            _start_chapter = int(_start.get("chapter")) if _start.get("chapter") is not None else None
        except Exception:
            _start_chapter = None

        meta_payload: Dict[str, Any] = {
            "mode": (payload.get("mode") or "canon").lower(),
            "start": payload.get("start") or {},
            "focus_character_id": str(payload.get("focus_character_id")) if payload.get("focus_character_id") else None,
            "range_from": payload.get("range_from"),
            "range_to": payload.get("range_to"),
            "pov": (payload.get("pov") or "possess"),
            "max_turns": 500,
            "turn_count": 0,
            "completed": False,
            # P0 설정 기본값
            "postprocess_mode": "first2",   # always | first2 | off
            "next_event_len": 1,            # 1 | 2 (장면 수)
            "prewarm_on_start": True,
        }
        # narrator_mode: 평행세계에서만 의미, canon일 경우 parallel로 강제 전환
        try:
            _narr = bool(payload.get("narrator_mode") or False)
        except Exception:
            _narr = False
        if _narr and meta_payload.get("mode") == "canon":
            meta_payload["mode"] = "parallel"
        meta_payload["narrator_mode"] = _narr
        if _start_chapter:
            meta_payload["anchor"] = _start_chapter
        # parallel 모드 seed 설정(라벨만 저장)
        seed_label = None
        try:
            st = payload.get("start") or {}
            seed_label = st.get("seed_label") or payload.get("seed_label")
        except Exception:
            seed_label = None
        if seed_label:
            meta_payload["seed_label"] = str(seed_label)
        player_max = meta_payload.get("range_to")
        if isinstance(player_max, int):
            meta_payload["player_max"] = player_max
        elif _start_chapter:
            meta_payload["player_max"] = _start_chapter
        light = await _build_light_context(db, story_id, meta_payload.get("player_max")) if story_id else None
        if light:
            meta_payload["light_context"] = light[:2000]
        # 초기 선택지 제안(메타에 탑재하여 프론트가 바로 표시)
        try:
            if story_id and _start_chapter:
                pack = await origchat_service.build_context_pack(db, story_id, _start_chapter, character_id=str(payload.get("focus_character_id") or payload.get("character_id")))
                if isinstance(pack, dict) and isinstance(pack.get("initial_choices"), list):
                    meta_payload["initial_choices"] = pack["initial_choices"][:3]
        except Exception:
            pass
        # 초기 단계 표식(프론트 로딩 표시용)
        meta_payload["init_stage"] = "preparing"
        meta_payload["intro_ready"] = False
        await _set_room_meta(room.id, meta_payload)

        # 컨텍스트 워밍(비동기)
        try:
            if story_id and isinstance(meta_payload.get("player_max"), int) and bool(meta_payload.get("prewarm_on_start", True)):
                import asyncio
                from app.services.origchat_service import build_context_pack, warm_context_basics, detect_style_profile, generate_backward_weighted_recap, get_scene_anchor_text

                async def _warm_ctx_async(sid, anchor, room_id, scene_id):
                    async with AsyncSessionLocal() as _db:
                        try:
                            await build_context_pack(_db, sid, int(anchor or 1), None)
                        except Exception:
                            pass
                        try:
                            await warm_context_basics(_db, sid, int(anchor or 1))
                        except Exception:
                            pass
                        try:
                            await detect_style_profile(_db, sid, upto_anchor=int(anchor or 1))
                        except Exception:
                            pass
                        try:
                            recap = await generate_backward_weighted_recap(_db, sid, anchor=int(anchor or 1), tau=1.2)
                            if recap:
                                from app.core.database import redis_client as _r
                                await _r.setex(f"ctx:warm:{sid}:recap", 600, recap)
                        except Exception:
                            pass
                        # LLM 기반 회차 요약 보장(최근 N회) — 초기 진입 품질 개선
                        try:
                            from app.services.origchat_service import ensure_episode_summaries
                            await ensure_episode_summaries(_db, sid, upto_anchor=int(anchor or 1), max_episodes=12)
                        except Exception:
                            pass
                        # 선택 장면 앵커 텍스트 캐시
                        try:
                            a = int(anchor or 1)
                            excerpt = await get_scene_anchor_text(_db, sid, chapter_no=a, scene_id=scene_id)
                            if excerpt:
                                from app.core.database import redis_client as _r
                                await _r.setex(f"ctx:warm:{sid}:scene_anchor", 600, excerpt)
                        except Exception:
                            pass
                        # 인사말 생성 및 저장 → 완료 플래그 세팅
                        try:
                            intro_lines: list[str] = []
                            try:
                                srow = await _db.execute(select(Story.title, Story.summary, Story.content).where(Story.id == sid))
                                sdata = srow.first()
                                if sdata:
                                    story_summary = (sdata[1] or "").strip() or (sdata[2] or "").strip()
                                    if story_summary:
                                        intro_lines.append((" ".join(story_summary.split()))[:50])
                            except Exception:
                                pass
                            recap_text = ""
                            try:
                                if int(anchor or 1) > 1:
                                    recap_text = await generate_backward_weighted_recap(_db, sid, anchor=int(anchor or 1), max_chars=300)
                            except Exception:
                                recap_text = ""
                            if recap_text:
                                intro_lines.append(recap_text)
                            quote = ""
                            try:
                                quote = await get_scene_anchor_text(_db, sid, chapter_no=int(anchor or 1), scene_id=scene_id, max_len=100)
                            except Exception:
                                quote = ""
                            if quote:
                                intro_lines.append(f"“{quote.strip()}”")
                            greeting = "\n\n".join([ln for ln in intro_lines if ln])
                            if greeting:
                                await chat_service.save_message(_db, room_id, sender_type="character", content=greeting, message_metadata={"kind":"intro"})
                            await _set_room_meta(room_id, {"intro_ready": True, "init_stage": "ready"})
                        except Exception:
                            try:
                                await _set_room_meta(room_id, {"intro_ready": True, "init_stage": "ready"})
                            except Exception:
                                pass
                _anchor_for_warm = meta_payload.get("player_max") or meta_payload.get("anchor") or 1
                _scene_id = (meta_payload.get("start") or {}).get("scene_id") if isinstance(meta_payload.get("start"), dict) else None
                asyncio.create_task(_warm_ctx_async(story_id, _anchor_for_warm, room.id, _scene_id))
        except Exception:
            pass

        # 인사말 말풍선: 사전 준비 결과가 있으면 즉시 사용(없으면 생략)
        try:
            from app.core.database import redis_client as _r
            _scene_id = None
            try:
                _scene_id = (payload.get("start") or {}).get("scene_id")
            except Exception:
                _scene_id = None
            prep_key = f"ctx:warm:{story_id}:prepared_intro:{character_id}:{int(_start_chapter or 1)}:{_scene_id or 'none'}"
            txt = await _r.get(prep_key) if story_id else None
            if txt:
                try:
                    txt_str = txt.decode("utf-8") if isinstance(txt, (bytes, bytearray)) else str(txt)
                except Exception:
                    txt_str = str(txt)
                await chat_service.save_message(db, room.id, sender_type="character", content=txt_str, message_metadata={"kind":"intro"})
        except Exception:
            pass

        return room
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"origchat start failed: {e}")


@router.post("/origchat/turn", response_model=SendMessageResponse)
async def origchat_turn(
    payload: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """원작챗 턴 진행: room_id 기준으로 캐릭터를 찾아 일반 send_message 흐름을 재사용.
    요청 예시: { room_id, user_text?, choice_id? }
    """
    try:
        if not settings.ORIGCHAT_V2:
            raise HTTPException(status_code=404, detail="origchat v2 비활성화")
        room_id = payload.get("room_id")
        if not room_id:
            raise HTTPException(status_code=400, detail="room_id가 필요합니다")
        room = await chat_service.get_chat_room_by_id(db, room_id)
        if not room:
            raise HTTPException(status_code=404, detail="채팅방을 찾을 수 없습니다")
        if room.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="권한이 없습니다")
        # 안전망: 캐릭터에 연결된 원작 스토리가 있으면 플래그 지정
        try:
            crow = await db.execute(select(Character.origin_story_id).where(Character.id == room.character_id))
            sid = (crow.first() or [None])[0]
            if sid:
                await db.execute(update(Story).where(Story.id == sid).values(is_origchat=True))
                await db.commit()
        except Exception:
            await db.rollback()
        user_text = (payload.get("user_text") or "").strip()
        choice_id = (payload.get("choice_id") or "").strip()
        situation_text = (payload.get("situation_text") or "").strip()
        trigger = (payload.get("trigger") or "").strip()
        settings_patch = payload.get("settings_patch") or {}
        idempotency_key = (payload.get("idempotency_key") or "").strip()

        # 룸 메타 로드
        meta_state = await _get_room_meta(room_id)
        player_max = meta_state.get("player_max") if isinstance(meta_state, dict) else None

        # idempotency: if the same key is observed, short-circuit with last AI message
        if idempotency_key:
            try:
                if str(meta_state.get("last_idem_key")) == str(idempotency_key):
                    # Return last AI message best-effort
                    msgs = await chat_service.get_messages_by_room_id(db, room.id, limit=5)
                    last_ai = None
                    for m in reversed(msgs or []):
                        if getattr(m, "sender_type", "") in {"assistant", "character"}:
                            last_ai = m
                            break
                    if last_ai is None and msgs:
                        last_ai = msgs[-1]
                    from app.schemas.chat import ChatMessageResponse as CMR, SendMessageResponse as SMR
                    if last_ai:
                        return SMR(user_message=None, ai_message=CMR.model_validate(last_ai), meta={"skipped": True, "reason": "idempotent"})
            except Exception:
                pass

        # settings_patch 반영(검증된 키만 허용)
        try:
            allowed_keys = {"postprocess_mode", "next_event_len", "response_length_pref", "prewarm_on_start"}
            patch_data = {k: v for k, v in (settings_patch or {}).items() if k in allowed_keys}
            if patch_data:
                ppm = patch_data.get("postprocess_mode")
                if ppm and str(ppm).lower() not in {"always", "first2", "off"}:
                    patch_data.pop("postprocess_mode", None)
                nel = patch_data.get("next_event_len")
                if nel not in (None, 1, 2):
                    patch_data.pop("next_event_len", None)
                await _set_room_meta(room.id, patch_data)
                meta_state.update(patch_data)
        except Exception:
            pass

        # 트리거 감지
        want_choices = False
        want_next_event = False
        if user_text.startswith("/선택지") or trigger == "choices":
            want_choices = True
            user_text = user_text.replace("/선택지", "").strip()
        if trigger == "next_event":
            want_next_event = True

        # 선택지 대기 중 next_event 서버 가드: 최신 AI 메시지 복귀(멱등) + 경고
        if want_next_event and bool(meta_state.get("pending_choices_active")):
            try:
                msgs = await chat_service.get_messages_by_room_id(db, room.id, limit=5)
                last_ai = None
                for m in reversed(msgs or []):
                    if getattr(m, "sender_type", "") in {"assistant", "character"}:
                        last_ai = m
                        break
                if last_ai is None and msgs:
                    last_ai = msgs[-1]
                from app.schemas.chat import ChatMessageResponse as CMR, SendMessageResponse as SMR
                if last_ai:
                    return SMR(user_message=None, ai_message=CMR.model_validate(last_ai), meta={"warning": "선택지가 표시 중입니다. 선택 처리 후 진행하세요.", "turn_count": int(meta_state.get("turn_count") or 0), "max_turns": int(meta_state.get("max_turns") or 500), "completed": bool(meta_state.get("completed") or False)})
            except Exception:
                pass

        # 진행도/턴 카운트
        max_turns = int(meta_state.get("max_turns") or 500)
        turn_count = int(meta_state.get("turn_count") or 0)
        completed = bool(meta_state.get("completed") or False)
        # next_event는 입력 없이도 턴 카운트 증가
        if want_next_event:
            turn_count += 1
        elif not want_choices and (user_text or choice_id):
            turn_count += 1
        just_completed = False
        if not completed and turn_count >= max_turns:
            completed = True
            just_completed = True
        meta_state["turn_count"] = turn_count
        meta_state["max_turns"] = max_turns
        meta_state["completed"] = completed
        await _set_room_meta(room.id, {
            "turn_count": turn_count,
            "max_turns": max_turns,
            "completed": completed,
        })

        # 레이트리밋/쿨다운 체크(간단 버전)
        now = int(time.time())
        last_choice_ts = meta_state.get("last_choice_ts", 0)
        cooldown_met = now - last_choice_ts >= 8  # 최소 8초 간격

        # 간단 스포일러/완결 가드 + 세계관/반복 방지 규칙 + 경량 컨텍스트 주입
        guarded_text = user_text
        if isinstance(player_max, int) and player_max >= 1:
            hint = f"[스포일러 금지 규칙] {player_max}화 이후의 사건/정보는 언급/암시 금지. 범위 내에서만 대답."
            if guarded_text:
                guarded_text = f"{hint}\n{guarded_text}"
            else:
                guarded_text = hint
        # 500턴 완결 진행 가이드(역산 전개)
        progress_hint = f"[진행] {turn_count}/{max_turns}턴. 남은 턴 내에 기승전결을 완성하도록 다음 사건을 전개하라. 반복 금지, 캐릭터/세계관 일관성 유지."
        if completed:
            progress_hint = "[완결 이후 자유 모드] 이전 사건을 재탕하지 말고, 소소한 일상/번외 에피소드로 반복 패턴을 변주하라."
        mode = (meta_state.get("mode") or "canon").lower()
        # 작가 페르소나 + 막(Act) 진행 가이드
        ratio = 0.0
        try:
            ratio = (turn_count / max_turns) if max_turns else 0.0
        except Exception:
            ratio = 0.0
        if ratio <= 0.2:
            stage_name = "도입"
            stage_guide = "주인공의 욕구/결핍 제시, 세계관 톤 확립, 시발 사건 제시, 후반을 위한 복선 씨앗 심기."
        elif ratio <= 0.8:
            stage_name = "대립/심화"
            stage_guide = "불가역 사건으로 갈등 증폭, 선택에는 대가가 따른다. 서브플롯을 주제와 연결하며 긴장/완급 조절."
        else:
            stage_name = "절정/해결"
            stage_guide = "클라이맥스에서 핵심 갈등을 정면 돌파, 주제 명료화, 감정적 수확과 여운 제공. 느슨한 매듭 정리."
        author_block = (
            "[작가 페르소나] 당신은 20년차 베스트셀러 장르/웹소설 작가(히트작 10권). 리듬/복선/서스펜스/클리프행어 운용에 탁월.\n"
            "각 턴은 '한 장면·한 사건·한 감정' 원칙. 중복/공회전 금지. show-don't-tell. 감각/행동/대사가 중심.\n"
            f"[현재 막] {stage_name} — {stage_guide}"
        )
        rule_lines = [
            "[일관성 규칙] 세계관/인물/설정의 내적 일관성을 유지하라. 원작과 모순되는 사실/타작품 요소 도입 금지.",
            "[반복 금지] 이전 대사/서술을 재탕하거나 공회전하는 전개 금지. 매 턴 새로운 상황/감정/행동/갈등을 진행.",
        ]
        if mode == "parallel":
            rule_lines.append("[평행세계] 원작과 다른 전개 허용. 다만 세계관/인물 심리의 개연성을 유지하고 스포일러 금지.")
        else:
            rule_lines.append("[정사] 원작 설정을 존중하되 창의적으로 변주. 스포일러 금지.")
        # 관전가(서술자) 모드 규칙(평행세계에서만 의미)
        if bool(meta_state.get("narrator_mode") or False):
            rule_lines.append("[관전가] 사용자의 입력은 서술/묘사/해설이며 직접 대사를 생성하지 않는다. 인물의 대사/행동은 AI가 주도한다.")
            rule_lines.append("[관전가] 사용자 서술을 장면 맥락에 자연스럽게 접합하고, 필요한 대사/행동을 AI가 창의적으로 이어간다.")
        rules_block = "\n".join(rule_lines)
        ctx = (meta_state.get("light_context") or "").strip()
        ctx_block = f"[컨텍스트]\n{ctx}" if ctx else ""
        # 원작 문체 스타일 프롬프트 주입(있다면)
        style_prompt = None
        try:
            from app.core.database import redis_client
            # sid는 위에서 캐릭터의 원작 스토리 id로 설정됨
            _sid = locals().get('sid', None)
            if _sid:
                raw_sp = await redis_client.get(f"ctx:warm:{_sid}:style_prompt")
                if raw_sp:
                    try:
                        style_prompt = raw_sp.decode("utf-8") if isinstance(raw_sp, (bytes, bytearray)) else str(raw_sp)
                    except Exception:
                        style_prompt = str(raw_sp)
        except Exception:
            style_prompt = None
        style_block = f"[문체 지침]\n{style_prompt}" if style_prompt else ""
        # 역진가중 리캡/장면 앵커 주입(있다면)
        recap_block = ""
        try:
            if locals().get('sid', None):
                raw_rec = await redis_client.get(f"ctx:warm:{locals().get('sid')}:recap")
                if raw_rec:
                    try:
                        recap_text = raw_rec.decode("utf-8") if isinstance(raw_rec, (bytes, bytearray)) else str(raw_rec)
                    except Exception:
                        recap_text = str(raw_rec)
                    recap_block = f"[리캡(역진가중)]\n{recap_text}"
                raw_scene = await redis_client.get(f"ctx:warm:{locals().get('sid')}:scene_anchor")
                if raw_scene:
                    try:
                        scene_text = raw_scene.decode("utf-8") if isinstance(raw_scene, (bytes, bytearray)) else str(raw_scene)
                    except Exception:
                        scene_text = str(raw_scene)
                    recap_block = (recap_block + "\n\n[장면 앵커]\n" + scene_text) if recap_block else ("[장면 앵커]\n" + scene_text)
        except Exception:
            recap_block = ""
        parts = [progress_hint, rules_block, author_block]
        if ctx_block:
            parts.append(ctx_block)
        if style_block:
            parts.append(style_block)
        if recap_block:
            parts.append(recap_block)
        # 허용 스피커 힌트
        try:
            if 'sid' in locals() and sid:
                from app.services.origchat_service import get_story_character_names
                allowed = await get_story_character_names(db, sid)
                if allowed:
                    parts.append("[허용 스피커]\n" + ", ".join(allowed[:8]))
        except Exception:
            pass
        # 시점/문체 힌트: persona(내 페르소나) or possess(선택 캐릭터 빙의)
        try:
            pov = (meta_state.get("pov") or "possess").lower()
            if pov == "persona":
                # 사용자 활성 페르소나 로드
                from app.services.user_persona_service import get_active_persona_by_user
                persona = await get_active_persona_by_user(db, current_user.id)
                if persona:
                    pn = (getattr(persona, 'name', '') or '').strip()
                    pd = (getattr(persona, 'description', '') or '').strip()
                    fb = ["[시점·문체]"]
                    if pn:
                        fb.append(f"고정 시점: 사용자 페르소나 '{pn}'의 1인칭 또는 근접 3인칭.")
                    if pd:
                        fb.append(f"성격/정서 결: {pd}")
                    fb.append("대사·지문은 페르소나 어휘/톤을 유지.")
                    parts.append("\n".join(fb))
            else:
                fcid = meta_state.get("focus_character_id")
                if fcid:
                    row_fc = await db.execute(
                        select(Character.name, Character.speech_style, Character.personality)
                        .where(Character.id == fcid)
                    )
                    fc = row_fc.first()
                    if fc:
                        fc_name = (fc[0] or '').strip()
                        fc_speech = (fc[1] or '').strip()
                        fc_persona = (fc[2] or '').strip()
                        fb_lines = ["[시점·문체]"]
                        if fc_name:
                            fb_lines.append(f"고정 시점: '{fc_name}'의 내적 시점(1인칭/근접 3인칭 중 자연스러운 방식).")
                        if fc_persona:
                            fb_lines.append(f"성격/정서 결: {fc_persona}")
                        if fc_speech:
                            fb_lines.append(f"대사 말투: {fc_speech}")
                        fb_lines.append("묘사는 시점 인물의 지각/어휘 결을 따르고, 과잉 해설 금지.")
                        parts.append("\n".join(fb_lines))
        except Exception:
            pass
        # parallel seed가 있으면 주입
        seed_label = meta_state.get("seed_label")
        if mode == "parallel" and seed_label:
            parts.append(f"[평행세계 씨앗] {seed_label}")
        # 상황 텍스트
        if situation_text:
            parts.append(f"[상황]\n{situation_text}")
        # 자동 진행 지시
        if 'want_next_event' in locals() and want_next_event:
            parts.append("[자동 진행] 사용자의 입력 없이 장면을 1~2개 전개하라. 지문과 대사가 자연스럽게 섞이도록. 새 고유명 인물 도입 금지.")
        if guarded_text:
            parts.append(guarded_text)
        guarded_text = "\n".join([p for p in parts if p])
        # 단계 정보를 메타로 전달(선택적)
        meta_stage = locals().get("stage_name", None)

        # 스테이지 메트릭: 생성/보정 단계 표시용
        t0 = time.time()  # 생성 시작
        req = SendMessageRequest(character_id=room.character_id, content=guarded_text)
        resp = await send_message(req, current_user, db)
        tti_ms = int((time.time() - t0) * 1000)

        # 일관성 강화: 응답을 경량 재작성(최소 수정) (postprocess_mode에 따라)
        try:
            from app.services.origchat_service import enforce_character_consistency as _enforce, get_story_character_names, normalize_dialogue_speakers
            focus_name = None
            focus_persona = None
            focus_speech = None
            if meta_state.get("focus_character_id"):
                row_fc = await db.execute(
                    select(Character.name, Character.personality, Character.speech_style)
                    .where(Character.id == meta_state.get("focus_character_id"))
                )
                fc2 = row_fc.first()
                if fc2:
                    focus_name = (fc2[0] or '').strip()
                    focus_persona = (fc2[1] or '').strip()
                    focus_speech = (fc2[2] or '').strip()
            world_bible = None
            try:
                from app.core.database import redis_client
                _sid = locals().get('sid', None)
                if _sid:
                    raw_wb = await redis_client.get(f"ctx:warm:{_sid}:world_bible")
                    if raw_wb:
                        world_bible = raw_wb.decode("utf-8") if isinstance(raw_wb, (bytes, bytearray)) else str(raw_wb)
            except Exception:
                world_bible = None
            ai_text0 = getattr(resp.ai_message, 'content', '') or ''
            # postprocess_mode: always | first2 | off
            pp_mode = str(meta_state.get("postprocess_mode") or "first2").lower()
            need_pp = (pp_mode == "always") or (pp_mode == "first2" and int(meta_state.get("turn_count") or 0) <= 2)
            refined = ai_text0
            if need_pp:
                refined = await _enforce(
                    ai_text0,
                    focus_name=focus_name,
                    persona=focus_persona,
                    speech_style=focus_speech,
                    style_prompt=style_prompt,
                    world_bible=world_bible,
                )
            # 스피커 정합 보정(다인 장면 최소 보정)
            refined2 = refined
            if need_pp:
                try:
                    allowed_names = await get_story_character_names(db, sid) if 'sid' in locals() else []
                    refined2 = await normalize_dialogue_speakers(
                        refined,
                        allowed_names=allowed_names,
                        focus_name=focus_name,
                        npc_limit=int(meta_state.get("next_event_len") or 1),
                    )
                except Exception:
                    refined2 = refined
            if refined2 and refined2 != ai_text0:
                try:
                    resp.ai_message.content = refined2  # type: ignore[attr-defined]
                except Exception:
                    pass
        except Exception:
            pass

        meta_resp: Dict[str, Any] = {"turn_count": turn_count, "max_turns": max_turns, "completed": completed}
        if want_choices and cooldown_met:
            from app.services.origchat_service import propose_choices_from_anchor as _pc
            choices = _pc(getattr(resp.ai_message, 'content', ''), None)
            meta_resp["choices"] = choices
            # 선택지 제공 시점 기록
            meta_state["last_choice_ts"] = now
            meta_state["pending_choices_active"] = True
            await _set_room_meta(room.id, {"last_choice_ts": now, "pending_choices_active": True})

        # 분기 가치가 높을 때 자동 제안(과잉 방지: 쿨다운 준수, 온디맨드가 아닌 경우만)
        if not want_choices and cooldown_met:
            try:
                from app.services.origchat_service import compute_branch_score_from_text, propose_choices_from_anchor as _pc
                ai_text = getattr(resp.ai_message, 'content', '') or ''
                score = compute_branch_score_from_text(ai_text)
                if score >= 2.0:
                    meta_resp["choices"] = _pc(ai_text, None)
                    meta_state["last_choice_ts"] = now
                    meta_state["pending_choices_active"] = True
                    await _set_room_meta(room.id, {"last_choice_ts": now, "pending_choices_active": True})
            except Exception:
                pass

        # 완결 직후 안내 내레이션
        if just_completed:
            meta_resp["final_narration"] = "이 평행세계 이야기는 여기서 막을 내립니다. 계속하고 싶다면 자유 모드로 이어집니다."

        # 메트릭 전송(베스트-에포트)
        try:
            from app.services.metrics_service import record_timing, increment_counter
            labels = {
                "story_id": str(sid) if 'sid' in locals() and sid else None,
                "room_id": str(room_id),
                "user_id": str(current_user.id),
                "character_id": str(room.character_id),
                "mode": mode,
                "trigger": (trigger or "user_text") if (trigger or user_text) else "other",
                "completed": str(bool(completed)),
            }
            await record_timing("origchat_tti_ms", tti_ms, labels=labels)
            if want_choices:
                await increment_counter("origchat_choices_requested", labels=labels)
            if 'want_next_event' in locals() and want_next_event:
                await increment_counter("origchat_next_event", labels=labels)
            if just_completed:
                await increment_counter("origchat_completed", labels=labels)
        except Exception:
            pass

        # after successful send, persist latest idempotency key (if provided)
        try:
            if idempotency_key:
                await _set_room_meta(room.id, {"last_idem_key": str(idempotency_key)})
        except Exception:
            pass

        # 선택/사용자 입력/자동 진행 성공 시 선택지 대기 해제
        try:
            if choice_id or user_text or want_next_event:
                if meta_state.get("pending_choices_active"):
                    meta_state["pending_choices_active"] = False
                    await _set_room_meta(room.id, {"pending_choices_active": False})
        except Exception:
            pass

        from app.schemas.chat import SendMessageResponse as SMR
        return SMR(user_message=resp.user_message, ai_message=resp.ai_message, meta=meta_resp or None)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"origchat turn failed: {e}")

@router.delete("/rooms/{room_id}/messages")
async def clear_chat_messages(
    room_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """채팅방의 모든 메시지 삭제 (대화 초기화)"""
    # 채팅방 권한 확인
    room = await chat_service.get_chat_room_by_id(db, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="채팅방을 찾을 수 없습니다.")
    
    if room.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="이 채팅방에 접근할 권한이 없습니다.")
    
    # 메시지 삭제
    await chat_service.delete_all_messages_in_room(db, room_id)
    return {"message": "채팅 내용이 초기화되었습니다."}

@router.delete("/rooms/{room_id}")
async def delete_chat_room(
    room_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """채팅방 완전 삭제"""
    # 채팅방 권한 확인
    room = await chat_service.get_chat_room_by_id(db, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="채팅방을 찾을 수 없습니다.")
    
    if room.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="이 채팅방에 접근할 권한이 없습니다.")
    
    # 채팅방 삭제 (연관된 메시지도 함께 삭제됨)
    await chat_service.delete_chat_room(db, room_id)
    return {"message": "채팅방이 삭제되었습니다."}


# ----- 메시지 수정/재생성 -----
@router.patch("/messages/{message_id}", response_model=ChatMessageResponse)
async def update_message_content(
    message_id: uuid.UUID,
    payload: ChatMessageUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    msg = await chat_service.get_message_by_id(db, message_id)
    if not msg:
        raise HTTPException(status_code=404, detail="메시지를 찾을 수 없습니다.")
    room = await chat_service.get_chat_room_by_id(db, msg.chat_room_id)
    if not room or room.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="권한이 없습니다.")
    if msg.sender_type != 'assistant' and msg.sender_type != 'character':
        raise HTTPException(status_code=400, detail="AI 메시지만 수정할 수 있습니다.")
    updated = await chat_service.update_message_content(db, message_id, payload.content)
    return ChatMessageResponse.model_validate(updated)


@router.post("/messages/{message_id}/regenerate", response_model=SendMessageResponse)
async def regenerate_message(
    message_id: uuid.UUID,
    payload: RegenerateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # 대상 메시지와 룸 확인
    msg = await chat_service.get_message_by_id(db, message_id)
    if not msg:
        raise HTTPException(status_code=404, detail="메시지를 찾을 수 없습니다.")
    room = await chat_service.get_chat_room_by_id(db, msg.chat_room_id)
    if not room or room.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="권한이 없습니다.")

    # 재생성 지시사항을 사용자 메시지로 전송 → 기존 send_message 흐름 재사용
    instruction = payload.instruction or "방금 응답을 같은 맥락으로 다시 생성해줘."
    req = SendMessageRequest(character_id=room.character_id, content=instruction)
    return await send_message(req, current_user, db)


@router.post("/messages/{message_id}/feedback", response_model=ChatMessageResponse)
async def message_feedback(
    message_id: uuid.UUID,
    payload: MessageFeedback,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    msg = await chat_service.get_message_by_id(db, message_id)
    if not msg:
        raise HTTPException(status_code=404, detail="메시지를 찾을 수 없습니다.")
    room = await chat_service.get_chat_room_by_id(db, msg.chat_room_id)
    if not room or room.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="권한이 없습니다.")
    updated = await chat_service.apply_feedback(db, message_id, upvote=(payload.action=='upvote'))
    return ChatMessageResponse.model_validate(updated)

 