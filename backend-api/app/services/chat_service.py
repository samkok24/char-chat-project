"""
채팅 관련 서비스
"""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete, func
from sqlalchemy.orm import selectinload, joinedload
from typing import Optional, List
import uuid
try:
    from app.core.logger import logger
except Exception:
    import logging as _logging
    logger = _logging.getLogger(__name__)

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

async def get_chat_room_by_character_and_session(db, user_id: uuid.UUID, character_id: uuid.UUID, session_id: str) -> Optional[ChatRoom]:
    stmt = select(ChatRoom).where(
        ChatRoom.user_id == user_id,
        ChatRoom.character_id == character_id,
        ChatRoom.session_id == session_id  # ✅ session_id 조건 추가 (ChatRoom 모델에 session_id 필드가 있어야 함)
    ).options(selectinload(ChatRoom.character))  # ✅ character relationship 로드
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def create_chat_room(
    db: AsyncSession, user_id: uuid.UUID, character_id: uuid.UUID
) -> ChatRoom:
    """
    채팅방을 무조건 새로 생성한다.

    중요(방어/안전):
    - AsyncSession은 기본적으로 commit 시 ORM 인스턴스를 expire 시킨다(expire_on_commit=True).
    - 여기서 Character를 commit 이전에 로드한 뒤 그대로 반환 객체에 붙이면,
      FastAPI 응답 직렬화(Pydantic from_attributes) 과정에서 `character.name` 같은 속성 접근이
      "지연 로드"를 유발하면서 ResponseValidationError/500으로 터질 수 있다.
    - 따라서 commit 이후 Character를 refresh(또는 재조회)하여, 응답 직렬화 단계에서
      추가 DB 접근이 발생하지 않도록 한다.
    """
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
    # ✅ commit 이후 expire 방지: 응답 직렬화 단계에서 lazy load가 발생하지 않도록 캐릭터를 refresh
    try:
        await db.refresh(character)
    except Exception as e:
        # refresh 실패 시에도 안전하게 재조회 폴백
        try:
            logger.warning(f"[chat_service] refresh(character) failed, fallback to re-select: {e}")
        except Exception:
            pass
        try:
            character_result2 = await db.execute(select(Character).where(Character.id == character_id))
            character = character_result2.scalar_one()
        except Exception as e2:
            try:
                logger.exception(f"[chat_service] re-select(Character) failed: {e2}")
            except Exception:
                pass
            raise

    # character 관계 보장
    try:
        chat_room.character = character
    except Exception as e:
        try:
            logger.exception(f"[chat_service] inject chat_room.character failed: {e}")
        except Exception:
            pass
        raise

    # 최종 방어: 응답 스키마(ChatRoomResponse)에서 character는 필수
    if getattr(chat_room, "character", None) is None:
        try:
            logger.error("[chat_service] create_chat_room succeeded but character relationship is None (unexpected)")
        except Exception:
            pass
        raise RuntimeError("create_chat_room: character relationship missing")
    return chat_room

async def save_message(
    db: AsyncSession,
    chat_room_id: uuid.UUID,
    sender_type: str,
    content: str,
    message_metadata: Optional[dict] = None,
    *,
    auto_commit: bool = True,
) -> ChatMessage:
    """
    채팅 메시지를 데이터베이스에 저장.

    auto_commit:
    - True(기본): 기존 동작 유지(함수 내부 commit/refresh)
    - False: 호출자가 트랜잭션 경계를 관리(함수 내부 flush만 수행)
    """
    chat_message = ChatMessage(
        chat_room_id=chat_room_id,
        sender_type=sender_type,
        content=content,
        message_metadata=message_metadata or {}
    )
    db.add(chat_message)
    await db.execute(
        update(ChatRoom)
        .where(ChatRoom.id == chat_room_id)
        .values(updated_at=func.now())
    )
    if auto_commit:
        await db.commit()
    else:
        await db.flush()
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

async def get_message_count_by_room_id(
    db: AsyncSession, chat_room_id: uuid.UUID
) -> int:
    """
    채팅방의 총 메시지 개수를 조회한다.

    의도/배경(최소 수정·최대 안전):
    - 일반 캐릭터챗에서 "최근 N개 히스토리"를 모델 프롬프트로 전달하려면,
      order_by(created_at.asc()) + offset/limit 조합으로 "마지막 N개"를 가져와야 한다.
    - 따라서 먼저 전체 개수를 조회하고(skip = max(0, count - N)) 방식으로 슬라이싱한다.
    """
    result = await db.execute(
        select(func.count(ChatMessage.id)).where(ChatMessage.chat_room_id == chat_room_id)
    )
    try:
        return int(result.scalar_one() or 0)
    except Exception:
        return 0


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
    db: AsyncSession, user_id: uuid.UUID, limit: int = None
) -> List[ChatRoom]:
    """사용자의 채팅방 목록 조회 (최근 순)"""
    query = (
        select(ChatRoom)
        .where(ChatRoom.user_id == user_id)
        .options(
            selectinload(ChatRoom.character).selectinload(Character.creator)
        )
        .order_by(ChatRoom.updated_at.desc())
    )
    
    if limit is not None and limit > 0:
        query = query.limit(limit)
    
    result = await db.execute(query)
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
