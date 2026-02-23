"""
스토리 회차 요약/누적 요약 테이블 (증분 요약용)
"""

from sqlalchemy import Column, Text, Integer, DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import relationship
import uuid

from app.core.database import Base, UUID


class StoryEpisodeSummary(Base):
    __tablename__ = "story_episode_summaries"

    id = Column(UUID(), primary_key=True, default=uuid.uuid4, index=True)
    story_id = Column(UUID(), ForeignKey("stories.id", ondelete="CASCADE"), nullable=False, index=True)
    no = Column(Integer, nullable=False)  # 회차 번호
    short_brief = Column(Text)            # 회차 단문 요약 (~400자 목표)
    anchor_excerpt = Column(Text)         # 앵커 발췌 (~600자)
    cumulative_summary = Column(Text)     # 1~no 누적 요약 (~1~2KB 목표)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint('story_id', 'no', name='uq_story_episode_summary'),
    )


