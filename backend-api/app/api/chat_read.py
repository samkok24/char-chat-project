"""
채팅방 읽음 상태 관리 API (chat.py와 분리)
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, and_, String
from sqlalchemy.sql import func
import uuid

from app.core.security import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.models.chat_read_status import ChatRoomReadStatus
from app.models.chat import ChatRoom

router = APIRouter(prefix="/chat/read", tags=["chat-read"])


@router.post("/rooms/{room_id}/mark")
async def mark_room_as_read(
    room_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """채팅방을 읽음 처리 (unread_count를 0으로 리셋)"""
    # 읽음 상태 레코드 조회 또는 생성
    result = await db.execute(
        select(ChatRoomReadStatus)
        .where(
            ChatRoomReadStatus.room_id == room_id,
            ChatRoomReadStatus.user_id == current_user.id
        )
    )
    status = result.scalar_one_or_none()
    
    if status:
        # 기존 레코드 업데이트
        await db.execute(
            update(ChatRoomReadStatus)
            .where(
                ChatRoomReadStatus.room_id == room_id,
                ChatRoomReadStatus.user_id == current_user.id
            )
            .values(unread_count=0, last_read_at=func.now())
        )
    else:
        # 새 레코드 생성
        new_status = ChatRoomReadStatus(
            room_id=room_id,
            user_id=current_user.id,
            unread_count=0,
            last_read_at=func.now()
        )
        db.add(new_status)
    
    await db.commit()
    return {"success": True}


@router.post("/rooms/{room_id}/increment-unread")
async def increment_unread(
    room_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """채팅방의 unread_count를 1 증가 (피드 발행 시 강제 알림용)"""
    # 읽음 상태 레코드 조회 또는 생성
    result = await db.execute(
        select(ChatRoomReadStatus)
        .where(
            ChatRoomReadStatus.room_id == room_id,
            ChatRoomReadStatus.user_id == current_user.id
        )
    )
    status = result.scalar_one_or_none()
    
    if status:
        # 기존 레코드 업데이트
        status.unread_count += 1
    else:
        # 새 레코드 생성
        new_status = ChatRoomReadStatus(
            room_id=room_id,
            user_id=current_user.id,
            unread_count=1,
            last_read_at=func.now()
        )
        db.add(new_status)
    
    await db.commit()
    return {"success": True, "unread_count": status.unread_count if status else 1}


@router.get("/rooms/{room_id}/status")
async def get_read_status(
    room_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """특정 채팅방의 읽음 상태 조회"""
    result = await db.execute(
        select(ChatRoomReadStatus)
        .where(
            ChatRoomReadStatus.room_id == room_id,
            ChatRoomReadStatus.user_id == current_user.id
        )
    )
    status = result.scalar_one_or_none()
    
    if not status:
        return {"unread_count": 0}
    
    return {
        "unread_count": status.unread_count,
        "last_read_at": status.last_read_at
    }


@router.get("/rooms/with-unread")
async def get_rooms_with_unread(
    limit: int = 50,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """채팅방 목록을 unread_count와 함께 조회"""
    from sqlalchemy.orm import selectinload
    from app.schemas.chat import ChatRoomResponse
    
    # 🔥 하이픈 제거하여 UUID 포맷 맞춰서 JOIN
    from sqlalchemy import func as sql_func
    
    stmt = (
        select(ChatRoom, ChatRoomReadStatus.unread_count)
        .outerjoin(ChatRoomReadStatus, 
            and_(
                # 🔥 ChatRoom.id의 하이픈 제거하여 비교
                sql_func.replace(sql_func.cast(ChatRoom.id, String), '-', '') == sql_func.cast(ChatRoomReadStatus.room_id, String),
                ChatRoomReadStatus.user_id == current_user.id
            )
        )
        .where(ChatRoom.user_id == current_user.id)
        .options(selectinload(ChatRoom.character))
        .order_by(ChatRoom.updated_at.desc())
        .limit(limit)
    )
    
    result = await db.execute(stmt)
    rows = result.all()
    
    print(f"🔍 [GET_ROOMS] 조회된 방: {len(rows)}개")
    
    # 결과를 딕셔너리 리스트로 변환
    rooms_with_unread = []
    for idx, (room, unread_count) in enumerate(rows):
        if idx < 5:  # 상위 5개만 로그
            print(f"  🔍 방 {idx+1}: {room.character.name if room.character else 'Unknown'}, "
                  f"room_id={str(room.id)[:8]}...{str(room.id)[-4:]}, unread_count={unread_count}")
        
        room_dict = {
            "id": str(room.id),
            "user_id": str(room.user_id),
            "character_id": str(room.character_id),
            "character": {
                "id": str(room.character.id),
                "name": room.character.name,
                "avatar_url": room.character.avatar_url,
                "thumbnail_url": getattr(room.character, 'thumbnail_url', None),
            } if room.character else None,
            "title": room.title,
            "message_count": room.message_count,
            "created_at": room.created_at,
            "updated_at": room.updated_at,
            "unread_count": unread_count or 0
        }
        rooms_with_unread.append(room_dict)
    
    return {"data": rooms_with_unread}

