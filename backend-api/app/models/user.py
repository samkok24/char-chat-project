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
    # 프로필 이미지 및 소개
    avatar_url = Column(String(500))
    bio = Column(String(1000))
    
    # AI 모델 설정
    preferred_model = Column(String(50), default='gemini')  # gemini, claude, gpt, argo
    preferred_sub_model = Column(String(50), default='gemini-2.5-pro')  # 세부 모델 버전
    # AI 응답 길이 선호도: short|medium|long
    response_length_pref = Column(String(10), default='medium')
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # 관계 설정
    characters = relationship("Character", back_populates="creator", cascade="all, delete-orphan")
    stories = relationship("Story", back_populates="creator", cascade="all, delete-orphan")
    character_likes = relationship("CharacterLike", back_populates="user", cascade="all, delete-orphan")
    story_likes = relationship("StoryLike", back_populates="user", cascade="all, delete-orphan")
    character_comments = relationship("CharacterComment", back_populates="user", cascade="all, delete-orphan")
    story_comments = relationship("StoryComment", back_populates="user", cascade="all, delete-orphan")
    
    # 결제 관련 관계
    payments = relationship("Payment", back_populates="user", cascade="all, delete-orphan")
    point_transactions = relationship("PointTransaction", back_populates="user", cascade="all, delete-orphan")
    user_point = relationship("UserPoint", back_populates="user", uselist=False, cascade="all, delete-orphan")
    
    # 기억노트 및 페르소나 관계
    memory_notes = relationship("MemoryNote", back_populates="user", cascade="all, delete-orphan")
    user_personas = relationship("UserPersona", back_populates="user", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<User(id={self.id}, email={self.email}, username={self.username})>"

