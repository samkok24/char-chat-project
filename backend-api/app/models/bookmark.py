"""
북마크 모델
"""
import uuid
from sqlalchemy import Column, ForeignKey, DateTime, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base, UUID

class CharacterBookmark(Base):
    """캐릭터 북마크 모델"""
    __tablename__ = "character_bookmarks"

    id = Column(UUID(), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    character_id = Column(UUID(), ForeignKey("characters.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User")
    character = relationship("Character")

    # 한 유저가 같은 캐릭터를 중복으로 북마크할 수 없도록 제약조건 설정
    __table_args__ = (UniqueConstraint('user_id', 'character_id', name='_user_character_bookmark_uc'),)

    def __repr__(self):
        return f"<CharacterBookmark(user_id={self.user_id}, character_id={self.character_id})>" 