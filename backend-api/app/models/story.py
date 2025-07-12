"""
스토리 모델
"""

from sqlalchemy import Column, String, Text, Boolean, Integer, DateTime, ForeignKey, func
from sqlalchemy.orm import relationship
import uuid

from app.core.database import Base, UUID


class Story(Base):
    """스토리 모델"""
    __tablename__ = "stories"

    id = Column(UUID(), primary_key=True, default=uuid.uuid4, index=True)
    creator_id = Column(UUID(), ForeignKey("users.id"), nullable=False, index=True)
    character_id = Column(UUID(), ForeignKey("characters.id"), nullable=True, index=True)
    title = Column(String(200), nullable=False)
    content = Column(Text, nullable=False)
    summary = Column(Text)
    genre = Column(String(50))
    is_public = Column(Boolean, default=True, index=True)
    is_featured = Column(Boolean, default=False)
    view_count = Column(Integer, default=0)
    like_count = Column(Integer, default=0)
    comment_count = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # 관계 설정
    creator = relationship("User", back_populates="stories")
    character = relationship("Character", back_populates="stories")
    likes = relationship("StoryLike", back_populates="story", cascade="all, delete-orphan")
    comments = relationship("StoryComment", back_populates="story", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Story(id={self.id}, title={self.title}, creator_id={self.creator_id})>"

