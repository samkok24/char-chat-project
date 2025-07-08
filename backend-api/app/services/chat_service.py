"""
채팅 관련 서비스
"""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from sqlalchemy.orm import selectinload, joinedload
from typing import Optional, List
import uuid

from app.models.chat import ChatRoom, ChatMessage
from app.models.user import User
from app.models.character import Character
from app.schemas.chat import ChatMessageResponse

async def get_or_create_chat_room(
    db: AsyncSession, user_id: uuid.UUID, character_id: uuid.UUID
) -> ChatRoom:
    """사용자와 캐릭터 간의 채팅방을 가져오거나 새로 생성"""
    result = await db.execute(
        select(ChatRoom)
        .where(ChatRoom.user_id == user_id, ChatRoom.character_id == character_id)
    )
    chat_room = result.scalar_one_or_none()

    if not chat_room:
        character_result = await db.execute(select(Character).where(Character.id == character_id))
        character = character_result.scalar_one()

        chat_room = ChatRoom(
            user_id=user_id,
            character_id=character_id,
            title=f"{character.name}와의 대화"
        )
        db.add(chat_room)
        await db.commit()
        await db.refresh(chat_room)
    
    # character 관계를 별도로 로드
    if not hasattr(chat_room, 'character') or chat_room.character is None:
        character_result = await db.execute(
            select(Character).where(Character.id == chat_room.character_id)
        )
        chat_room.character = character_result.scalar_one()
        
    return chat_room

async def save_message(
    db: AsyncSession,
    chat_room_id: uuid.UUID,
    sender_type: str,
    content: str,
    message_metadata: Optional[dict] = None
) -> ChatMessage:
    """채팅 메시지를 데이터베이스에 저장"""
    chat_message = ChatMessage(
        chat_room_id=chat_room_id,
        sender_type=sender_type,
        content=content,
        message_metadata=message_metadata or {}
    )
    db.add(chat_message)
    await db.commit()
    await db.refresh(chat_message)
    return chat_message

async def get_messages_by_room_id(
    db: AsyncSession, chat_room_id: uuid.UUID, skip: int = 0, limit: int = 100
) -> List[ChatMessage]:
    """채팅방의 메시지 목록 조회"""
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.chat_room_id == chat_room_id)
        .order_by(ChatMessage.created_at.asc())
        .offset(skip)
        .limit(limit)
    )
    return result.scalars().all()

async def get_chat_rooms_for_user(
    db: AsyncSession, user_id: uuid.UUID
) -> List[ChatRoom]:
    """사용자의 모든 채팅방 목록 조회"""
    result = await db.execute(
        select(ChatRoom)
        .where(ChatRoom.user_id == user_id)
        .options(selectinload(ChatRoom.character))
        .order_by(ChatRoom.updated_at.desc())
    )
    return result.scalars().all() 