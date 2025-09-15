"""
원작챗: 스토리에서 추출된 캐릭터 영속화
"""

from sqlalchemy import Column, String, Text, DateTime, ForeignKey, Integer, func
from sqlalchemy.orm import relationship
import uuid

from app.core.database import Base, UUID


class StoryExtractedCharacter(Base):
    __tablename__ = "story_extracted_characters"

    id = Column(UUID(), primary_key=True, default=uuid.uuid4, index=True)
    story_id = Column(UUID(), ForeignKey("stories.id"), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    description = Column(Text)
    initial = Column(String(4))
    avatar_url = Column(Text)
    character_id = Column(UUID(), ForeignKey("characters.id"), index=True, nullable=True)
    order_index = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    story = relationship("Story")

    def __repr__(self):
        return f"<StoryExtractedCharacter(id={self.id}, story_id={self.story_id}, name={self.name})>"


