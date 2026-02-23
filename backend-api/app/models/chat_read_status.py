"""
채팅방 읽음 상태 모델
"""

from sqlalchemy import Column, Integer, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.sql import func
import uuid

from app.core.database import Base

# SQLite와 PostgreSQL 모두 지원하기 위한 UUID 타입
try:
    UUID = PG_UUID
except:
    from sqlalchemy import String as UUID


class ChatRoomReadStatus(Base):
    """채팅방 읽음 상태 추적"""
    __tablename__ = "chat_room_read_status"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    room_id = Column(UUID(as_uuid=True), ForeignKey("chat_rooms.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    last_read_at = Column(DateTime(timezone=True), server_default=func.now())
    unread_count = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    __table_args__ = (
        UniqueConstraint('room_id', 'user_id', name='uq_room_user'),
    )
    
    def __repr__(self):
        return f"<ChatRoomReadStatus(room_id={self.room_id}, user_id={self.user_id}, unread={self.unread_count})>"


