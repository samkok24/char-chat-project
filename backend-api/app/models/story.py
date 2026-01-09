"""
스토리 모델
"""

from sqlalchemy import Column, String, Text, Boolean, Integer, DateTime, ForeignKey, func
from sqlalchemy.orm import relationship
import uuid

from app.core.database import Base, UUID, JSON


class Story(Base):
    """스토리 모델"""
    __tablename__ = "stories"

    id = Column(UUID(), primary_key=True, default=uuid.uuid4, index=True)
    creator_id = Column(UUID(), ForeignKey("users.id"), nullable=False, index=True)
    character_id = Column(UUID(), ForeignKey("characters.id"), nullable=True, index=True)
    title = Column(String(200), nullable=False)
    content = Column(Text, nullable=False)
    summary = Column(Text)
    cover_url = Column(String(500))
    # ✅ 작품 공지(작가 공지)
    # - 배포 안정성 우선: 별도 테이블 대신 stories 테이블에 JSONB(운영)/JSON(SQLite) 컬럼 1개로 관리한다.
    # - 구조(리스트):
    #   [{ id, title, content, pinned, created_at, updated_at }]
    announcements = Column(JSON, nullable=True, default=list)
    genre = Column(String(50))
    is_public = Column(Boolean, default=True, index=True)
    # 원작챗 여부(스토리 기반 대화용 플래그)
    is_origchat = Column(Boolean, default=False, index=True)
    # 웹툰 여부 (웹소설/웹툰 구분)
    is_webtoon = Column(Boolean, default=False, index=True)
    is_featured = Column(Boolean, default=False)
    view_count = Column(Integer, default=0)
    like_count = Column(Integer, default=0)
    comment_count = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    chapters = relationship("StoryChapter", back_populates="story", cascade="all, delete-orphan")
    extracted_characters = relationship(
        "StoryExtractedCharacter",
        back_populates="story",
        order_by="StoryExtractedCharacter.order_index",
    )
    # 관계 설정
    creator = relationship("User", back_populates="stories")
    # 모호성 제거: Character.stories와 동일한 FK(Story.character_id)로 연결
    character = relationship(
        "Character",
        back_populates="stories",
        foreign_keys=[character_id],
        primaryjoin="Story.character_id==Character.id",
    )
    likes = relationship("StoryLike", back_populates="story", cascade="all, delete-orphan")
    comments = relationship("StoryComment", back_populates="story", cascade="all, delete-orphan")
    tags = relationship("Tag", secondary="story_tags", back_populates="stories")

    def __repr__(self):
        return f"<Story(id={self.id}, title={self.title}, creator_id={self.creator_id})>"

