"""
기억노트(로어북) 모델 - 캐릭터별 사용자 정의 기억
"""

from sqlalchemy import Column, String, Text, Boolean, DateTime, ForeignKey, func
from sqlalchemy.orm import relationship
import uuid

from app.core.database import Base, UUID


class MemoryNote(Base):
    """기억노트 모델 - 캐릭터별 사용자 정의 기억"""
    __tablename__ = "memory_notes"

    id = Column(UUID(), primary_key=True, default=uuid.uuid4, index=True)
    user_id = Column(UUID(), ForeignKey("users.id"), nullable=False, index=True)
    character_id = Column(UUID(), ForeignKey("characters.id"), nullable=False, index=True)
    
    # 기억노트 내용
    title = Column(String(200), nullable=False)
    content = Column(Text, nullable=False)  # 최대 1000자
    
    # 상태
    is_active = Column(Boolean, default=True)  # 활성화/비활성화
    
    # 메타데이터
    char_count = Column(String, default="0")  # 글자 수 (프론트엔드에서 관리)
    order_index = Column(String, default="0")  # 정렬 순서
    
    # 타임스탬프
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # 관계 설정
    user = relationship("User", back_populates="memory_notes")
    character = relationship("Character")

    def __repr__(self):
        return f"<MemoryNote(id={self.id}, title={self.title}, active={self.is_active})>"