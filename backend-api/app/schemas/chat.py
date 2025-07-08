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


class ChatMessageResponse(ChatMessageBase):
    """채팅 메시지 응답 스키마"""
    id: uuid.UUID
    chat_room_id: uuid.UUID
    sender_type: str
    created_at: datetime

    class Config:
        orm_mode = True


class CharacterForChatResponse(BaseModel):
    """채팅에 사용되는 캐릭터 응답 스키마"""
    id: uuid.UUID
    name: str
    avatar_url: Optional[str] = None

    class Config:
        orm_mode = True


class ChatRoomResponse(BaseModel):
    """채팅방 응답 스키마"""
    id: uuid.UUID
    user_id: uuid.UUID
    character_id: uuid.UUID
    title: Optional[str] = None
    message_count: int = 0
    character: CharacterForChatResponse
    created_at: datetime
    updated_at: datetime

    class Config:
        orm_mode = True


class SendMessageResponse(BaseModel):
    """메시지 전송 응답 스키마"""
    user_message: ChatMessageResponse
    ai_message: ChatMessageResponse

