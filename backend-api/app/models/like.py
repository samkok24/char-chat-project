"""
좋아요 모델
"""

from sqlalchemy import Column, DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import relationship
import uuid

from app.core.database import Base, UUID


class CharacterLike(Base):
    """캐릭터 좋아요 모델"""
    __tablename__ = "character_likes"

    id = Column(UUID(), primary_key=True, default=uuid.uuid4, index=True)
    user_id = Column(UUID(), ForeignKey("users.id"), nullable=False, index=True)
    character_id = Column(UUID(), ForeignKey("characters.id"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # 제약 조건 - 사용자는 캐릭터당 한 번만 좋아요 가능
    __table_args__ = (
        UniqueConstraint('user_id', 'character_id', name='uq_character_like_user_character'),
    )

    # 관계 설정
    user = relationship("User", back_populates="character_likes")
    character = relationship("Character", back_populates="likes")

    def __repr__(self):
        return f"<CharacterLike(user_id={self.user_id}, character_id={self.character_id})>"


class StoryLike(Base):
    """스토리 좋아요 모델"""
    __tablename__ = "story_likes"

    id = Column(UUID(), primary_key=True, default=uuid.uuid4, index=True)
    user_id = Column(UUID(), ForeignKey("users.id"), nullable=False, index=True)
    story_id = Column(UUID(), ForeignKey("stories.id"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # 제약 조건 - 사용자는 스토리당 한 번만 좋아요 가능
    __table_args__ = (
        UniqueConstraint('user_id', 'story_id', name='uq_story_like_user_story'),
    )

    # 관계 설정
    user = relationship("User", back_populates="story_likes")
    story = relationship("Story", back_populates="likes")

    def __repr__(self):
        return f"<StoryLike(user_id={self.user_id}, story_id={self.story_id})>"

