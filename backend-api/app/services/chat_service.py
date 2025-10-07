"""
채팅 관련 서비스
"""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete, func
from sqlalchemy.orm import selectinload, joinedload
from typing import Optional, List
import uuid

from app.models.chat import ChatRoom, ChatMessage, ChatMessageEdit
from app.models.user import User
from app.models.character import Character
from app.schemas.chat import ChatMessageResponse

async def get_or_create_chat_room(
    db: AsyncSession, user_id: uuid.UUID, character_id: uuid.UUID
) -> ChatRoom:
    """사용자와 캐릭터 간의 채팅방을 가져오거나 새로 생성"""
    # 기존 방이 여러 개일 수 있어도 최신 1개만 사용하도록 안전하게 조회
    result = await db.execute(
        select(ChatRoom)
        .options(selectinload(ChatRoom.character))
        .where(ChatRoom.user_id == user_id, ChatRoom.character_id == character_id)
        .order_by(ChatRoom.updated_at.desc())
        .limit(1)
    )
    chat_room = result.scalars().first()

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

async def create_chat_room(
    db: AsyncSession, user_id: uuid.UUID, character_id: uuid.UUID
) -> ChatRoom:
    """채팅방을 무조건 새로 생성한다."""
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
    # character 관계 보장
    chat_room.character = character
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


async def get_message_by_id(db: AsyncSession, message_id: uuid.UUID) -> Optional[ChatMessage]:
    result = await db.execute(select(ChatMessage).where(ChatMessage.id == message_id))
    return result.scalar_one_or_none()


async def update_message_content(db: AsyncSession, message_id: uuid.UUID, content: str) -> ChatMessage:
    # 기존 내용 조회
    res0 = await db.execute(select(ChatMessage).where(ChatMessage.id == message_id))
    msg = res0.scalar_one()
    old = msg.content
    # 수정 이력 기록
    edit = ChatMessageEdit(message_id=message_id, user_id=msg.chat_room.user_id if hasattr(msg, 'chat_room') else None, old_content=old, new_content=content)
    db.add(edit)
    # 본문 업데이트
    await db.execute(update(ChatMessage).where(ChatMessage.id == message_id).values(content=content))
    await db.commit()
    res = await db.execute(select(ChatMessage).where(ChatMessage.id == message_id))
    return res.scalar_one()


async def apply_feedback(db: AsyncSession, message_id: uuid.UUID, upvote: bool) -> ChatMessage:
    field = ChatMessage.upvotes if upvote else ChatMessage.downvotes
    await db.execute(update(ChatMessage).where(ChatMessage.id == message_id).values({field.key: field + 1}))
    await db.commit()
    res = await db.execute(select(ChatMessage).where(ChatMessage.id == message_id))
    return res.scalar_one()

async def get_chat_rooms_for_user(
    db: AsyncSession, user_id: uuid.UUID
) -> List[ChatRoom]:
    """사용자의 모든 채팅방 목록 조회"""
    result = await db.execute(
        select(ChatRoom)
        .where(ChatRoom.user_id == user_id)
        .options(
            selectinload(ChatRoom.character).selectinload(Character.creator)
        )
        .order_by(ChatRoom.updated_at.desc())
    )
    return result.scalars().all()

async def get_chat_room_by_id(
    db: AsyncSession, room_id: uuid.UUID
) -> Optional[ChatRoom]:
    """ID로 채팅방 조회"""
    result = await db.execute(
        select(ChatRoom)
        .where(ChatRoom.id == room_id)
        .options(selectinload(ChatRoom.character))
    )
    return result.scalar_one_or_none()

async def delete_all_messages_in_room(
    db: AsyncSession, room_id: uuid.UUID
) -> None:
    """채팅방의 모든 메시지 삭제"""
    await db.execute(
        delete(ChatMessage).where(ChatMessage.chat_room_id == room_id)
    )
    await db.commit()


# (핀 고정 기능 제거됨 - 로컬 저장소 기반 UI 고정 사용)

async def delete_chat_room(
    db: AsyncSession, room_id: uuid.UUID
) -> None:
    """채팅방 삭제 (연관된 메시지도 함께 삭제)"""
    # 먼저 메시지 삭제
    await db.execute(
        delete(ChatMessage).where(ChatMessage.chat_room_id == room_id)
    )
    # 그 다음 채팅방 삭제
    await db.execute(
        delete(ChatRoom).where(ChatRoom.id == room_id)
    )
    await db.commit() 