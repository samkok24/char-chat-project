"""
피드 발행 시 캐릭터 반응 생성 서비스
"""
import asyncio
import uuid
from datetime import datetime, timedelta
from typing import List

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from sqlalchemy.orm import selectinload, Session

from app.models.chat import ChatRoom, ChatMessage
from app.models.agent_content import AgentContent
from app.models.chat_read_status import ChatRoomReadStatus
from app.services import chat_service
from app.services import ai_service


async def trigger_character_reactions_with_rooms(
    db_session: AsyncSession,
    user_id: uuid.UUID,
    content_id: str,
    rooms: List[ChatRoom]
):
    """
    미리 로드된 채팅방 목록을 사용하여 캐릭터 반응을 생성합니다.
    """
    try:
        # 1. 캐릭터 중복 제거 (가장 최근 채팅방만, 최대 5명)
        seen_characters = set()
        unique_rooms = []
        for room in rooms:
            if room.character_id not in seen_characters:
                seen_characters.add(room.character_id)
                unique_rooms.append(room)
                if len(unique_rooms) >= 5:
                    break
        
        # 2. 콘텐츠 조회
        content_result = await db_session.execute(
            select(AgentContent).where(AgentContent.id == uuid.UUID(content_id))
        )
        content = content_result.scalar_one_or_none()
        if not content:
            print(f"[FeedReaction] Content not found: {content_id}")
            return
        
        # 3. 각 캐릭터별 반응 메시지 순차 생성 (한 명씩)
        for room in unique_rooms:
            try:
                await generate_reaction_message(db_session, room, content)
            except Exception as e:
                print(f"[FeedReaction] Failed for room {room.id}: {e}")
                continue
        
        print(f"[FeedReaction] Completed for content {content_id}, {len(unique_rooms)} reactions generated")
        
    except Exception as e:
        print(f"[FeedReaction] Error in trigger_character_reactions: {e}")
        raise


async def generate_reaction_message(
    db_session: AsyncSession, 
    room: ChatRoom, 
    content: AgentContent
):
    """
    개별 캐릭터의 반응 메시지 생성
    
    Args:
        db_session: 데이터베이스 세션
        room: 채팅방
        content: 피드 콘텐츠
    """
    from sqlalchemy import update
    from sqlalchemy.orm import selectinload
    
    # 캐릭터 정보가 이미 로드되었으므로, 바로 사용합니다.
    character = room.character
    if not character:
        print(f"❌ [FeedReaction] Character not found for room {room.id}")
        return
    
    print(f"🔄 [FeedReaction] Processing reaction for {character.name} (room {room.id})")
    
    # 사용자의 선호 모델 가져오기
    from app.models.user import User
    user_result = await db_session.execute(
        select(User).where(User.id == room.user_id)
    )
    user = user_result.scalar_one_or_none()
    
    if not user:
        print(f"❌ [FeedReaction] User not found for room {room.id}")
        return
    
    # 3. 캐릭터가 피드에 반응하는 메시지 생성
    character_prompt = f"""[캐릭터 정보]
이름: {character.name}
설명: {character.description or ''}
성격: {character.personality or ''}
말투: {character.speech_style or ''}
배경: {character.background_story or ''}
세계관: {character.world_setting or ''}"""
    
    user_message = f"""친구가 새로운 사진과 글을 SNS에 올렸습니다:

"{content.generated_text[:200]}..."

이 게시물을 보고 댓글이나 메시지로 자연스럽게 반응해주세요. 짧고 친근하게."""
    
    # 4. 기존 채팅 히스토리 가져오기 (최근 10개)
    history_result = await db_session.execute(
        select(ChatMessage)
        .where(ChatMessage.chat_room_id == room.id)
        .order_by(ChatMessage.created_at.desc())
        .limit(10)
    )
    history_messages = history_result.scalars().all()
    
    # 히스토리 구성 (오래된 것부터)
    history = []
    for msg in reversed(history_messages):
        if msg.sender_type == "user":
            history.append({"role": "user", "parts": [msg.content]})
        else:
            history.append({"role": "model", "parts": [msg.content]})
    
    # 5. 피드 콘텐츠를 유저 메시지로 히스토리에 추가 (실제 저장은 안 함)
    feed_context = f"[사진과 함께 피드에 올림]\n{content.generated_text}" if content.user_image_url else f"[피드에 올린 내용]\n{content.generated_text}"
    history.append({"role": "user", "parts": [feed_context]})
    
    # 6. AI 반응 생성 (히스토리 포함)
    try:
        reaction_text = await ai_service.get_ai_chat_response(
            character_prompt=character_prompt,
            user_message=user_message,
            history=history,
            preferred_model=user.preferred_model or 'gemini',
            preferred_sub_model=user.preferred_sub_model or 'gemini-2.5-pro',
            response_length_pref='short'  # 짧은 반응
        )
    except Exception as e:
        print(f"[FeedReaction] AI generation failed: {e}")
        # Fallback은 사용하지 않음 - 실패 시 그냥 건너뜀
        return
    
    # 캐릭터 이름 프리픽스 제거 (예: "호윤: 안녕하세요" -> "안녕하세요")
    if reaction_text.startswith(f"{character.name}:"):
        reaction_text = reaction_text[len(character.name)+1:].strip()
    
    # 너무 길면 자르기 (최대 150자)
    if len(reaction_text) > 150:
        reaction_text = reaction_text[:147] + "..."
    
    # 7. 캐릭터 반응 메시지만 저장 (피드 콘텐츠는 메타데이터에만)
    await chat_service.save_message(
        db_session,
        room.id,
        "assistant",
        reaction_text,
        message_metadata={
            'type': 'feed_reaction',
            'feed_content_id': str(content.id),
            'feed_context': feed_context  # 맥락은 메타데이터에
        }
    )
    
    print(f"✅ [FeedReaction] Reaction saved for {character.name} (room {room.id})")
    
    # 🆕 프론트엔드에 실시간 알림 (향후 WebSocket 추가 시 사용)
    print(f"📢 [FeedReaction] Notify frontend: character_id={character.id}, room_id={room.id}")
    
    # 5. unread_count 증가 (또는 생성)
    status_result = await db_session.execute(
        select(ChatRoomReadStatus)
        .where(
            ChatRoomReadStatus.room_id == room.id,
            ChatRoomReadStatus.user_id == room.user_id
        )
    )
    status = status_result.scalar_one_or_none()
    
    if status:
        # 기존 상태 업데이트
        print(f"✅ [FeedReaction] Found existing read_status for room {room.id}. Current unread_count: {status.unread_count}, incrementing...")
        status.unread_count += 1
    else:
        # 새 상태 생성
        print(f"✅ [FeedReaction] No read_status for room {room.id}. Creating new one with unread_count=1.")
        new_status = ChatRoomReadStatus(
            room_id=room.id,
            user_id=room.user_id,
            unread_count=1
        )
        db_session.add(new_status)
    
    # 커밋 전 로그
    print(f"🔥 [FeedReaction] About to commit for room {room.id}...")
    await db_session.commit()
    print(f"✅ [FeedReaction] DB commit successful for room {room.id}.")
    
    # 🆕 커밋 후 실제 DB 값 확인
    verify_result = await db_session.execute(
        select(ChatRoomReadStatus)
        .where(
            ChatRoomReadStatus.room_id == room.id,
            ChatRoomReadStatus.user_id == room.user_id
        )
    )
    verify_status = verify_result.scalar_one_or_none()
    print(f"🔍 [FeedReaction] Verified unread_count after commit: {verify_status.unread_count if verify_status else 'NO RECORD'}")
    
    print(f"✅ [FeedReaction] Finished reaction for {character.name} in room {room.id}")


# ===== 동기 버전 (ThreadPoolExecutor용) =====


def trigger_character_reactions_sync(
    db_session: Session,
    user_id: str,
    content_id: str
):
    """
    피드 발행 시 최근 대화한 캐릭터들이 자동으로 반응 (동기 버전)
    
    Args:
        db_session: 동기 데이터베이스 세션
        user_id: 사용자 ID (문자열)
        content_id: 발행된 피드 콘텐츠 ID (문자열)
    """
    try:
        user_uuid = uuid.UUID(user_id)
        content_uuid = uuid.UUID(content_id)
        
        # 1. 24시간 내 대화한 채팅방 조회
        cutoff_time = datetime.utcnow() - timedelta(hours=24)
        
        rooms = db_session.execute(
            select(ChatRoom)
            .where(
                ChatRoom.user_id == user_uuid,
                ChatRoom.updated_at >= cutoff_time
            )
            .order_by(ChatRoom.updated_at.desc())
            .limit(20)
        ).scalars().all()
        
        # 2. 캐릭터 중복 제거
        seen_characters = set()
        unique_rooms = []
        for room in rooms:
            if room.character_id not in seen_characters:
                seen_characters.add(room.character_id)
                unique_rooms.append(room)
                if len(unique_rooms) >= 5:
                    break
        
        # 3. 콘텐츠 조회
        content = db_session.execute(
            select(AgentContent).where(AgentContent.id == content_uuid)
        ).scalar_one_or_none()
        
        if not content:
            print(f"[FeedReaction] Content not found: {content_id}")
            return
        
        # 4. 각 캐릭터별 반응 메시지 생성
        for room in unique_rooms:
            try:
                generate_reaction_message_sync(db_session, room, content)
            except Exception as e:
                print(f"[FeedReaction] Failed for room {room.id}: {e}")
                continue
        
        print(f"[FeedReaction] Completed for content {content_id}, {len(unique_rooms)} reactions generated")
        
    except Exception as e:
        print(f"[FeedReaction] Error in trigger_character_reactions_sync: {e}")
        import traceback
        traceback.print_exc()


def generate_reaction_message_sync(
    db_session: Session,
    room: ChatRoom,
    content: AgentContent
):
    """
    개별 캐릭터의 반응 메시지 생성 (동기 버전)
    
    Args:
        db_session: 동기 데이터베이스 세션
        room: 채팅방
        content: 피드 콘텐츠
    """
    # 캐릭터 정보 로드
    if not room.character:
        room = db_session.execute(
            select(ChatRoom)
            .options(selectinload(ChatRoom.character))
            .where(ChatRoom.id == room.id)
        ).scalar_one_or_none()
    
    character = room.character
    if not character:
        print(f"[FeedReaction] Character not found for room {room.id}")
        return
    
    # 1. 중복 방지 (SQLite는 JSON 필드 접근 방식이 다름)
    # 일단 모든 메시지를 가져와서 Python에서 필터링
    all_messages = db_session.execute(
        select(ChatMessage)
        .where(ChatMessage.chat_room_id == room.id)
    ).scalars().all()
    
    existing = None
    for msg in all_messages:
        if msg.message_metadata and msg.message_metadata.get('feed_content_id') == str(content.id):
            existing = msg
            break
    
    if existing:
        print(f"[FeedReaction] Already reacted for room {room.id}, content {content.id}")
        return
    
    # 2. 동기 버전에서는 간단한 반응만 (AI 호출은 async 필요)
    # 캐릭터 성격에 맞는 간단한 반응
    if "차가" in (character.personality or "") or "냉정" in (character.personality or ""):
        reaction_text = "흥미롭네."
    elif "밝" in (character.personality or "") or "활발" in (character.personality or ""):
        reaction_text = "오~ 이거 좋은데! 😊"
    elif "친근" in (character.personality or "") or "다정" in (character.personality or ""):
        reaction_text = "우와, 멋지다! 잘 봤어~"
    else:
        # 기본 반응
        reaction_text = f"{character.name}: 좋은 사진이네요!"
    
    # 3. 메시지 저장
    new_message = ChatMessage(
        chat_room_id=room.id,
        sender_type="assistant",
        content=reaction_text,
        message_metadata={
            'type': 'feed_reaction',
            'feed_content_id': str(content.id)
        }
    )
    db_session.add(new_message)
    
    # 4. ChatRoom updated_at 갱신
    room.updated_at = datetime.utcnow()
    
    # 5. unread_count 증가
    status = db_session.execute(
        select(ChatRoomReadStatus)
        .where(
            ChatRoomReadStatus.room_id == room.id,
            ChatRoomReadStatus.user_id == room.user_id
        )
    ).scalar_one_or_none()
    
    if status:
        status.unread_count += 1
    else:
        new_status = ChatRoomReadStatus(
            room_id=room.id,
            user_id=room.user_id,
            unread_count=1
        )
        db_session.add(new_status)
    
    db_session.commit()
    print(f"[FeedReaction] Generated reaction for {character.name} in room {room.id}")
