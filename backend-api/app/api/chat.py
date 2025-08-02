"""
채팅 관련 API 라우터
CAVEDUCK 스타일: 채팅 중심 최적화
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List
import uuid

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.character import CharacterSetting

from app.services import chat_service
from app.services import ai_service
from app.schemas.chat import (
    ChatRoomResponse, 
    ChatMessageResponse, 
    CreateChatRoomRequest, 
    SendMessageRequest,
    SendMessageResponse
)

router = APIRouter()

# 🔥 CAVEDUCK 스타일 핵심 채팅 API (4개)

@router.post("/start", response_model=ChatRoomResponse, status_code=status.HTTP_201_CREATED)
async def start_chat(
    request: CreateChatRoomRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """채팅 시작 - CAVEDUCK 스타일 간단한 채팅 시작"""
    chat_room = await chat_service.get_or_create_chat_room(
        db, user_id=current_user.id, character_id=request.character_id
    )
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
            max_tokens=500
        )
        db.add(settings)
        await db.commit()

    # 2. 사용자 메시지 저장
    user_message = await chat_service.save_message(
        db, room.id, "user", request.content
    )

    # 3. AI 응답 생성 (CAVEDUCK 스타일 최적화)
    history = await chat_service.get_messages_by_room_id(db, room.id, limit=20)
    
    # 캐릭터 프롬프트 구성
    character_prompt = f"""당신은 '{character.name}'입니다.
설명: {character.description}
성격: {character.personality}
말투: {character.speech_style}
인사말: {character.greeting}

위 설정에 맞게 대답해주세요."""

    # 대화 히스토리 구성
    history_for_ai = []
    for msg in history[-10:]:  # 최근 10개 메시지만 사용
        if msg.sender_type == "user":
            history_for_ai.append({"role": "user", "parts": [msg.content]})
        else:
            history_for_ai.append({"role": "model", "parts": [msg.content]})
    
    # AI 응답 생성
    ai_response_text = await ai_service.get_ai_chat_response(
        character_prompt=character_prompt,
        user_message=request.content,
        history=history_for_ai
    )

    # 4. AI 응답 메시지 저장
    ai_message = await chat_service.save_message(
        db, room.id, "assistant", ai_response_text
    )
    
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

