"""
댓글 모델
"""

from sqlalchemy import Column, String, Text, DateTime, ForeignKey, func
from sqlalchemy.orm import relationship
import uuid

from app.core.database import Base, UUID


class CharacterComment(Base):
    """캐릭터 댓글 모델"""
    __tablename__ = "character_comments"

    id = Column(UUID(), primary_key=True, default=uuid.uuid4, index=True)
    character_id = Column(UUID(), ForeignKey("characters.id"), nullable=False, index=True)
    user_id = Column(UUID(), ForeignKey("users.id"), nullable=False, index=True)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # 관계 설정
    character = relationship("Character", back_populates="comments")
    user = relationship("User", back_populates="character_comments")

    def __repr__(self):
        return f"<CharacterComment(id={self.id}, character_id={self.character_id}, user_id={self.user_id})>" 