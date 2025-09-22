"""
태그 모델 및 캐릭터-태그 연결 테이블
"""

from sqlalchemy import Column, String, DateTime, ForeignKey, func, UniqueConstraint, Table
from sqlalchemy.orm import relationship
import uuid

from app.core.database import Base, UUID


class Tag(Base):
    __tablename__ = "tags"

    id = Column(UUID(), primary_key=True, default=uuid.uuid4, index=True)
    name = Column(String(50), nullable=False)
    slug = Column(String(50), nullable=False, unique=True, index=True)
    emoji = Column(String(10))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # 관계
    characters = relationship("Character", secondary="character_tags", back_populates="tags")
    stories = relationship("Story", secondary="story_tags", back_populates="tags")

    def __repr__(self):
        return f"<Tag(id={self.id}, slug={self.slug})>"


class CharacterTag(Base):
    __tablename__ = "character_tags"

    character_id = Column(UUID(), ForeignKey("characters.id"), primary_key=True)
    tag_id = Column(UUID(), ForeignKey("tags.id"), primary_key=True)

    __table_args__ = (
        UniqueConstraint('character_id', 'tag_id', name='uq_character_tag'),
    )


class StoryTag(Base):
    __tablename__ = "story_tags"

    story_id = Column(UUID(), ForeignKey("stories.id"), primary_key=True)
    tag_id = Column(UUID(), ForeignKey("tags.id"), primary_key=True)

    __table_args__ = (
        UniqueConstraint('story_id', 'tag_id', name='uq_story_tag'),
    )

