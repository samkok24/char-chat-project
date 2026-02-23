"""
FAQ 카테고리(큰 항목) 모델

- FAQ 항목(문답)은 `faq_items` 테이블에 저장된다.
- 큰 항목명(카테고리 제목)은 서버에서 관리/수정 가능해야 하므로 별도 테이블로 분리한다.
  (FAQ 항목의 `category` 값은 문자열 id를 유지하여, 기존 데이터/로직을 깨지 않도록 한다.)
"""

from sqlalchemy import Column, String, Integer, DateTime, func

from app.core.database import Base


class FAQCategory(Base):
    """FAQ 카테고리(큰 항목)"""

    __tablename__ = "faq_categories"

    # 카테고리 id는 기존 프론트/FAQ 아이템이 사용하는 문자열을 그대로 사용한다.
    # 예: account / character / chat / story / payment / technical
    id = Column(String(50), primary_key=True)
    title = Column(String(100), nullable=False)
    order_index = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    def __repr__(self) -> str:
        return f"<FAQCategory(id={self.id}, title={self.title})>"


