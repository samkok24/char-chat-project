"""
회차 구매 모델 — 유료 회차(6화~) 영구 소유 기록
"""

from sqlalchemy import Column, Integer, DateTime, ForeignKey, UniqueConstraint, func
import uuid

from app.core.database import Base, UUID


class ChapterPurchase(Base):
    __tablename__ = "chapter_purchases"

    id = Column(UUID(), primary_key=True, default=uuid.uuid4, index=True)
    user_id = Column(UUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    story_id = Column(UUID(), ForeignKey("stories.id", ondelete="CASCADE"), nullable=False, index=True)
    chapter_no = Column(Integer, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("user_id", "story_id", "chapter_no", name="uq_user_story_chapter"),
    )

    def __repr__(self):
        return f"<ChapterPurchase(user={self.user_id}, story={self.story_id}, ch={self.chapter_no})>"
