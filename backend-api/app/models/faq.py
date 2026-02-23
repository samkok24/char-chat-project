"""
FAQ 모델
"""

from sqlalchemy import Column, String, Text, Boolean, Integer, DateTime, func
import uuid

from app.core.database import Base, UUID


class FAQItem(Base):
    """FAQ 항목(카테고리별 문답)"""

    __tablename__ = "faq_items"

    id = Column(UUID(), primary_key=True, default=uuid.uuid4, index=True)
    category = Column(String(50), nullable=False, index=True)  # 예: account/character/chat/...
    question = Column(String(300), nullable=False)
    answer = Column(Text, nullable=False)
    order_index = Column(Integer, default=0)
    is_published = Column(Boolean, default=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    def __repr__(self) -> str:
        return f"<FAQItem(id={self.id}, category={self.category}, question={self.question[:30]})>"



