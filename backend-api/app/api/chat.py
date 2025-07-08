"""
채팅 관련 API 라우터
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
from app.services.ai_service import AIService
from app.services import chat_service
from app.schemas.chat import (
    ChatRoomResponse, 
    ChatMessageResponse, 
    CreateChatRoomRequest, 
    SendMessageRequest,
    SendMessageResponse
)

router = APIRouter()

@router.post("/rooms", response_model=ChatRoomResponse, status_code=status.HTTP_201_CREATED)
async def get_or_create_room(
    request: CreateChatRoomRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """채팅방 가져오기 또는 생성"""
    chat_room = await chat_service.get_or_create_chat_room(
        db, user_id=current_user.id, character_id=request.character_id
    )
    return chat_room

@router.get("/rooms", response_model=List[ChatRoomResponse])
async def get_user_chat_rooms(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """사용자의 채팅방 목록 조회"""
    chat_rooms = await chat_service.get_chat_rooms_for_user(db, user_id=current_user.id)
    return chat_rooms

@router.get("/rooms/{room_id}/messages", response_model=List[ChatMessageResponse])
async def get_messages_in_room(
    room_id: uuid.UUID,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """채팅방의 메시지 목록 조회"""
    # TODO: 채팅방 소유권 확인 로직 추가
    messages = await chat_service.get_messages_by_room_id(db, room_id, skip, limit)
    return messages

@router.post("/messages", response_model=SendMessageResponse)
async def send_message_and_get_response(
    request: SendMessageRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """메시지 전송 및 AI 응답 생성"""
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

    # 3. AI 응답 생성
    history = await chat_service.get_messages_by_room_id(db, room.id, limit=20)
    
    ai_service = AIService()
    ai_response_text = await ai_service.generate_character_response(
        character_name=character.name,
        character_description=character.description,
        character_personality=character.personality,
        conversation_history=[
            {"role": msg.sender_type, "content": msg.content} for msg in history
        ],
        user_message=request.content,
        model=settings.ai_model if settings else 'gemini-pro'
    )

    # 4. AI 응답 메시지 저장
    ai_message = await chat_service.save_message(
        db, room.id, "assistant", ai_response_text
    )
    
    return SendMessageResponse(
        user_message=user_message,
        ai_message=ai_message
    )

