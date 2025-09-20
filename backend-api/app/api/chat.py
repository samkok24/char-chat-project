"""
채팅 관련 API 라우터
CAVEDUCK 스타일: 채팅 중심 최적화
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from typing import List, Optional
import uuid

from app.core.database import get_db
from app.core.security import get_current_user, get_current_user_optional
from app.models.user import User
from app.models.character import CharacterSetting, CharacterExampleDialogue, Character
from app.models.story import Story

from app.services import chat_service
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

# --- Agent simulator (no character, optional auth) ---
@router.post("/agent/simulate")
async def agent_simulate(
    payload: dict,
    current_user = Depends(get_current_user_optional),
):
    """간단한 에이전트 시뮬레이터: 프론트의 모델 선택을 매핑하여 AI 응답을 생성합니다.
    요청 예시: { content, history?, model?, sub_model? }
    응답: { assistant: string }
    """
    try:
        content = (payload.get("content") or "").strip()
        history = payload.get("history") or []
        ui_model = (payload.get("model") or "").lower()
        ui_sub = (payload.get("sub_model") or ui_model or "").lower()

        # UI 모델명을 ai_service 기대 형식으로 매핑
        if "claude" in ui_model or "claude" in ui_sub:
            preferred_model = "claude"
            preferred_sub_model = "claude-3-5-sonnet-20241022"
        elif "gpt-4.1" in ui_model or "gpt-4.1" in ui_sub:
            preferred_model = "gpt"
            preferred_sub_model = "gpt-4.1"
        elif "gpt-4o" in ui_model or "gpt-4o" in ui_sub or "gpt" in ui_model:
            preferred_model = "gpt"
            preferred_sub_model = "gpt-4o"
        elif "gemini-2.5-flash" in ui_model or "flash" in ui_sub:
            preferred_model = "gemini"
            preferred_sub_model = "gemini-2.5-flash"
        else:
            preferred_model = "gemini"
            preferred_sub_model = "gemini-2.5-pro"

        text = await ai_service.get_ai_chat_response(
            character_prompt="",
            user_message=content,
            history=history,
            preferred_model=preferred_model,
            preferred_sub_model=preferred_sub_model,
            response_length_pref="medium",
        )
        return {"assistant": text}
    except Exception as e:
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail=f"agent simulate failed: {e}")

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
    """원작챗 세션 시작: 스토리/캐릭터/앵커 정보는 현재 저장하지 않고 룸만 생성/재사용.
    요청 예시: { story_id, character_id, chapter_anchor, timeline_mode, range_from, range_to }
    """
    try:
        character_id = payload.get("character_id")
        if not character_id:
            raise HTTPException(status_code=400, detail="character_id가 필요합니다")
        room = await chat_service.get_or_create_chat_room(db, current_user.id, character_id)
        # 스토리 플래그 자동 세팅: payload의 story_id 우선, 없으면 캐릭터의 origin_story_id로 유도
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
        # choice_id는 현재 별도 해석 없이 continue 동작으로 처리 (빈 문자열)
        req = SendMessageRequest(character_id=room.character_id, content=user_text)
        return await send_message(req, current_user, db)
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

 