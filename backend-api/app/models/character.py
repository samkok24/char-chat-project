"""
캐릭터 모델
"""

from sqlalchemy import Column, String, Text, Boolean, Integer, DateTime, ForeignKey, Numeric, func
from sqlalchemy.orm import relationship
import uuid

from app.core.database import Base, UUID


class Character(Base):
    """캐릭터 모델"""
    __tablename__ = "characters"

    id = Column(UUID(), primary_key=True, default=uuid.uuid4, index=True)
    creator_id = Column(UUID(), ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    description = Column(Text)
    personality = Column(Text)
    background_story = Column(Text)
    avatar_url = Column(String(500))
    is_public = Column(Boolean, default=True, index=True)
    is_active = Column(Boolean, default=True)
    chat_count = Column(Integer, default=0)
    like_count = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # 관계 설정
    creator = relationship("User", back_populates="characters")
    settings = relationship("CharacterSetting", back_populates="character", uselist=False, cascade="all, delete-orphan")
    chat_rooms = relationship("ChatRoom", back_populates="character", cascade="all, delete-orphan")
    stories = relationship("Story", back_populates="character")
    likes = relationship("CharacterLike", back_populates="character", cascade="all, delete-orphan")
    comments = relationship("CharacterComment", back_populates="character", cascade="all, delete-orphan")

    def __repr__(self):
        """문자열 표현"""
        # 세션 분리 상태에서도 안전하게 작동하도록 수정
        try:
            return f"<Character(id={self.id}, name={self.name})>"
        except:
            return f"<Character(detached)>"


class CharacterSetting(Base):
    """캐릭터 설정 모델 (AI 프롬프트 등)"""
    __tablename__ = "character_settings"

    id = Column(UUID(), primary_key=True, default=uuid.uuid4, index=True)
    character_id = Column(UUID(), ForeignKey("characters.id"), nullable=False, unique=True)
    system_prompt = Column(Text)
    temperature = Column(Numeric(3, 2), default=0.7)
    max_tokens = Column(Integer, default=1000)
    ai_model = Column(String(50), default="gemini-pro")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # 관계 설정
    character = relationship("Character", back_populates="settings")

    def __repr__(self):
        return f"<CharacterSetting(id={self.id}, character_id={self.character_id}, ai_model={self.ai_model})>"

