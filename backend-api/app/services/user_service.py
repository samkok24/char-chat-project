"""
사용자 관련 서비스
"""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from typing import Optional, Union, Dict
import uuid
from sqlalchemy import func
from sqlalchemy.orm import selectinload

from app.models.character import Character
from app.schemas.user import UserProfileResponse

from app.models.user import User
from app.models.chat import ChatRoom, ChatMessage


async def get_user_by_id(db: AsyncSession, user_id: Union[str, uuid.UUID]) -> Optional[User]:
    """ID로 사용자 조회"""
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def get_user_by_email(db: AsyncSession, email: str) -> Optional[User]:
    """이메일로 사용자 조회"""
    result = await db.execute(select(User).where(User.email == email))
    return result.scalar_one_or_none()


async def create_user(
    db: AsyncSession, 
    email: str, 
    username: str, 
    password_hash: str
) -> User:
    """사용자 생성"""
    user = User(
        email=email,
        username=username,
        hashed_password=password_hash
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def update_user_verification_status(
    db: AsyncSession, 
    user_id: Union[str, uuid.UUID], 
    is_verified: bool
) -> Optional[User]:
    """사용자 인증 상태 업데이트"""
    await db.execute(
        update(User)
        .where(User.id == user_id)
        .values(is_verified=is_verified)
    )
    await db.commit()
    return await get_user_by_id(db, user_id)


async def update_user_profile(
    db: AsyncSession,
    user_id: Union[str, uuid.UUID],
    username: Optional[str] = None,
    password_hash: Optional[str] = None
) -> Optional[User]:
    """사용자 프로필 업데이트"""
    update_data = {}
    if username is not None:
        update_data["username"] = username
    if password_hash is not None:
        update_data["hashed_password"] = password_hash
    
    if update_data:
        await db.execute(
            update(User)
            .where(User.id == user_id)
            .values(**update_data)
        )
        await db.commit()
    
    return await get_user_by_id(db, user_id)


async def deactivate_user(db: AsyncSession, user_id: Union[str, uuid.UUID]) -> Optional[User]:
    """사용자 비활성화"""
    await db.execute(
        update(User)
        .where(User.id == user_id)
        .values(is_active=False)
    )
    await db.commit()
    return await get_user_by_id(db, user_id)

async def get_user_profile(db: AsyncSession, user_id: str) -> UserProfileResponse | None:
    """
    사용자의 기본 정보와 통계 정보를 함께 조회하여 프로필 페이지용으로 반환합니다.
    """
    try:
        user_uuid = uuid.UUID(user_id)
    except ValueError:
        return None # 유효하지 않은 UUID 형식
    
    # 1. 사용자의 기본 정보를 조회합니다.
    user_result = await db.execute(select(User).where(User.id == user_uuid))
    user = user_result.scalar_one_or_none()
    
    if not user:
        return None
        
    # 2. 사용자가 생성한 캐릭터들의 통계 정보를 집계합니다.
    stats_result = await db.execute(
        select(
            func.count(Character.id).label("character_count"),
            func.sum(Character.chat_count).label("total_chat_count"),
            func.sum(Character.like_count).label("total_like_count")
        )
        .where(Character.creator_id == user_uuid)
    )
    stats = stats_result.one()

    # 3. 조회된 기본 정보와 통계 정보를 UserProfileResponse 스키마에 맞춰 조합합니다.
    return UserProfileResponse(
        id=user.id,
        email=user.email,
        username=user.username,
        is_active=user.is_active,
        is_verified=user.is_verified,
        created_at=user.created_at,
        updated_at=user.updated_at,
        character_count=stats.character_count or 0,
        total_chat_count=stats.total_chat_count or 0,
        total_like_count=stats.total_like_count or 0
    )


async def get_recent_characters_for_user(db: AsyncSession, user_id: uuid.UUID, limit: int = 10, skip: int = 0) -> list[Character]:
    """
    사용자가 최근에 대화한 캐릭터 목록을 반환합니다.
    creator 정보를 함께 로드하고, last_message_snippet을 포함합니다.
    """
    if limit > 50:  # 최대 limit 제한으로 보안 강화
        limit = 50
    
    # Subquery for last message per chat room
    last_message_subquery = (
        select(
            ChatMessage.chat_room_id,
            func.max(ChatMessage.created_at).label('last_chat_time'),
            func.substring(ChatMessage.content, 1, 100).label('last_message_snippet')
        )
        .group_by(ChatMessage.chat_room_id)
        .subquery()
    )
    
    result = await db.execute(
        select(
            Character,
            ChatRoom.id.label('chat_room_id'),
            last_message_subquery.c.last_chat_time,
            last_message_subquery.c.last_message_snippet
        )
        .join(ChatRoom, Character.id == ChatRoom.character_id)
        .outerjoin(last_message_subquery, ChatRoom.id == last_message_subquery.c.chat_room_id)
        .where(ChatRoom.user_id == user_id)
        .options(selectinload(Character.creator))
        .order_by(last_message_subquery.c.last_chat_time.desc().nullslast())
        .limit(limit)
        .offset(skip)
    )
    rows = result.all()
    characters = []
    for char, chat_room_id, last_chat_time, last_message_snippet in rows:
        # 연관된 정보를 Character 모델 객체의 임시 속성으로 추가
        char.chat_room_id = chat_room_id
        char.last_chat_time = last_chat_time
        char.last_message_snippet = last_message_snippet
        characters.append(char)
        
    return characters