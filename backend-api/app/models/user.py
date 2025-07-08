"""
사용자 모델
"""

from sqlalchemy import Column, String, Boolean, DateTime, func
from sqlalchemy.orm import relationship
import uuid

from app.core.database import Base, UUID


class User(Base):
    """사용자 모델"""
    __tablename__ = "users"

    id = Column(UUID(), primary_key=True, default=uuid.uuid4, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    username = Column(String(50), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True)
    is_verified = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # 관계 설정
    characters = relationship("Character", back_populates="creator", cascade="all, delete-orphan")
    stories = relationship("Story", back_populates="creator", cascade="all, delete-orphan")
    character_likes = relationship("CharacterLike", back_populates="user", cascade="all, delete-orphan")
    story_likes = relationship("StoryLike", back_populates="user", cascade="all, delete-orphan")
    character_comments = relationship("CharacterComment", back_populates="user", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<User(id={self.id}, email={self.email}, username={self.username})>"

