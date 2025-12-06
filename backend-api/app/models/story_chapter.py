"""
스토리 회차 모델
"""

from sqlalchemy import Column, String, Text, Integer, DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import relationship
import uuid

from app.core.database import Base, UUID


class StoryChapter(Base):
    __tablename__ = "story_chapters"

    id = Column(UUID(), primary_key=True, default=uuid.uuid4, index=True)
    story_id = Column(UUID(), ForeignKey("stories.id", ondelete="CASCADE"), nullable=False, index=True)
    no = Column(Integer, nullable=False)  # 1부터 시작하는 회차 번호
    title = Column(String(200), nullable=True)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    # 조회수
    view_count = Column(Integer, default=0)
    # 웹툰 이미지 URL (선택사항)
    # NULL이면 텍스트 표시, 값이 있으면 이미지만 표시 (텍스트는 AI 프롬프팅용)
    # JSON 배열 문자열로 저장 (예: '["url1", "url2"]') 또는 단일 URL 문자열 (하위 호환)
    image_url = Column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint('story_id', 'no', name='uq_story_chapter_no'),
    )

    # 관계
    story = relationship("Story", back_populates="chapters")

    def __repr__(self):
        return f"<StoryChapter(story_id={self.story_id}, no={self.no})>"



