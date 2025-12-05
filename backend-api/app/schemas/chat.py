"""
채팅 관련 Pydantic 스키마
"""

from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, Dict, Any, Literal, List
from datetime import datetime
import uuid


class ChatMessageBase(BaseModel):
    """채팅 메시지 기본 스키마"""
    content: str


class ChatRoomBase(BaseModel):
    """채팅방 기본 스키마"""
    character_id: uuid.UUID


class ChatRoomCreate(ChatRoomBase):
    """채팅방 생성 스키마"""
    pass


class ChatMessageCreate(ChatMessageBase):
    """채팅 메시지 생성 스키마"""
    chat_room_id: uuid.UUID
    sender_type: str


class CreateChatRoomRequest(ChatRoomBase):
    """채팅방 생성 요청 스키마"""
    pass


class SendMessageRequest(BaseModel):
    """메시지 전송 요청 스키마"""
    character_id: uuid.UUID
    content: str
    room_id: Optional[uuid.UUID] = None  # 추가
    response_length_override: Optional[str] = None  # 'short' | 'medium' | 'long'


class ChatMessageResponse(ChatMessageBase):
    """채팅 메시지 응답 스키마"""
    id: uuid.UUID
    chat_room_id: uuid.UUID
    sender_type: str
    message_metadata: Dict[str, Any] | None = None
    created_at: datetime
    upvotes: int | None = 0
    downvotes: int | None = 0

    class Config:
        from_attributes = True


class CharacterForChatResponse(BaseModel):
    """채팅에 사용되는 캐릭터 응답 스키마"""
    id: uuid.UUID
    name: str
    avatar_url: Optional[str] = None
    origin_story_id: Optional[uuid.UUID] = None
    creator_id: Optional[uuid.UUID] = None
    creator_username: Optional[str] = None
    creator_avatar_url: Optional[str] = None

    class Config:
        from_attributes = True


class ChatRoomResponse(BaseModel):
    """채팅방 응답 스키마"""
    id: uuid.UUID
    user_id: uuid.UUID
    character_id: uuid.UUID
    title: Optional[str] = None
    message_count: int = 0
    summary: Optional[str]
    character: CharacterForChatResponse
    created_at: datetime
    updated_at: datetime
    session_id: Optional[str] = None
    class Config:
        from_attributes = True


class SendMessageResponse(BaseModel):
    """메시지 전송 응답 스키마"""
    # continue 모드 등 일부 상황에서 사용자 메시지가 저장되지 않을 수 있어 Optional 허용
    user_message: ChatMessageResponse | None = None
    ai_message: ChatMessageResponse
    # 선택지/경고/메타데이터 전달용 (프론트는 선택적으로 사용)
    meta: Dict[str, Any] | None = None
    suggested_image_index: int = -1


class ChatMessageUpdate(BaseModel):
    content: str


class RegenerateRequest(BaseModel):
    instruction: str | None = None


class MessageFeedback(BaseModel):
    action: Literal['upvote','downvote']
