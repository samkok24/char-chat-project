"""
공지사항 모델
"""

from sqlalchemy import Column, String, Text, Boolean, DateTime, func
import uuid

from app.core.database import Base, UUID


class Notice(Base):
    """공지사항 모델"""

    __tablename__ = "notices"

    id = Column(UUID(), primary_key=True, default=uuid.uuid4, index=True)
    title = Column(String(200), nullable=False)
    content = Column(Text, nullable=False)
    is_pinned = Column(Boolean, default=False, index=True)
    is_published = Column(Boolean, default=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    def __repr__(self) -> str:
        return f"<Notice(id={self.id}, title={self.title})>"