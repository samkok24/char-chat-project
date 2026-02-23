"""
Novel 모델 - 스토리 다이브용 원작 소설
"""

from sqlalchemy import Column, String, Text, Boolean, DateTime, func
import uuid

from app.core.database import Base, UUID, JSON


class Novel(Base):
    """원작 소설 모델"""
    __tablename__ = "novels"

    id = Column(UUID(), primary_key=True, default=uuid.uuid4, index=True)
    title = Column(String(200), nullable=False)
    author = Column(String(100))
    full_text = Column(Text, nullable=False)
    story_cards = Column(JSON)  # {"plot": "...", "characters": [...], "locations": [...], "world": "..."}
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    is_active = Column(Boolean, default=True)

    def __repr__(self):
        return f"<Novel(id={self.id}, title={self.title})>"

