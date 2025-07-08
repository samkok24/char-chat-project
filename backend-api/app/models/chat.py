"""
채팅 모델
"""

from sqlalchemy import Column, String, Text, DateTime, ForeignKey, Integer, func
from sqlalchemy.orm import relationship
import uuid

from app.core.database import Base, UUID, JSON


class ChatRoom(Base):
    """채팅방 모델"""
    __tablename__ = "chat_rooms"

    id = Column(UUID(), primary_key=True, default=uuid.uuid4, index=True)
    user_id = Column(UUID(), ForeignKey("users.id"), nullable=False, index=True)
    character_id = Column(UUID(), ForeignKey("characters.id"), nullable=False, index=True)
    title = Column(String(200))
    message_count = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # 관계 설정
    user = relationship("User")
    character = relationship("Character", back_populates="chat_rooms")
    messages = relationship("ChatMessage", back_populates="chat_room", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<ChatRoom(id={self.id}, user_id={self.user_id}, character_id={self.character_id})>"


class ChatMessage(Base):
    """채팅 메시지 모델"""
    __tablename__ = "chat_messages"

    id = Column(UUID(), primary_key=True, default=uuid.uuid4, index=True)
    chat_room_id = Column(UUID(), ForeignKey("chat_rooms.id"), nullable=False, index=True)
    sender_type = Column(String(20), nullable=False)  # 'user' or 'character'
    content = Column(Text, nullable=False)
    message_metadata = Column(JSON)  # 추가 정보 (모델, 토큰 수 등)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # 관계 설정
    chat_room = relationship("ChatRoom", back_populates="messages")

    def __repr__(self):
        return f"<ChatMessage(id={self.id}, chat_room_id={self.chat_room_id}, sender_type={self.sender_type})>"

