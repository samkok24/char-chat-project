"""
StoryDiveSession 모델 - 스토리 다이브 플레이 세션
"""

from sqlalchemy import Column, String, Text, Integer, DateTime, ForeignKey, func
import uuid

from app.core.database import Base, UUID, JSON


class StoryDiveSession(Base):
    """스토리 다이브 세션 모델"""
    __tablename__ = "storydive_sessions"

    id = Column(UUID(), primary_key=True, default=uuid.uuid4, index=True)
    user_id = Column(UUID(), ForeignKey("users.id"), nullable=False, index=True)
    novel_id = Column(UUID(), ForeignKey("novels.id"), nullable=False, index=True)
    entry_point = Column(Integer, nullable=False)  # 다이브 시작 문단 인덱스
    turns = Column(JSON, default=list)  # [{"mode": "do", "user": "...", "ai": "...", "deleted": false, "created_at": "..."}]
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    def __repr__(self):
        return f"<StoryDiveSession(id={self.id}, user_id={self.user_id}, novel_id={self.novel_id})>"

