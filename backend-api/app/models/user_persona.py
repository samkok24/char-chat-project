"""
유저 페르소나 모델 - 사용자의 다양한 페르소나 관리
"""

from sqlalchemy import Column, String, Text, Boolean, DateTime, ForeignKey, func
from sqlalchemy.orm import relationship
import uuid

from app.core.database import Base, UUID


class UserPersona(Base):
    """유저 페르소나 모델 - 사용자의 멀티프로필"""
    __tablename__ = "user_personas"

    id = Column(UUID(), primary_key=True, default=uuid.uuid4, index=True)
    user_id = Column(UUID(), ForeignKey("users.id"), nullable=False, index=True)
    
    # 페르소나 정보
    name = Column(String(100), nullable=False)  # 페르소나 이름 (예: "차서현", "레온하르트")
    description = Column(Text, nullable=False)  # 페르소나 설명 (예: "키 180에 호감형 외모의 남자아이돌지망생")
    
    # 상태
    is_active = Column(Boolean, default=False)  # 현재 활성 페르소나인지
    is_default = Column(Boolean, default=False)  # 기본 페르소나인지
    
    # 적용 범위: 'all' (모두), 'character' (일반 캐릭터챗만), 'origchat' (원작챗만)
    apply_scope = Column(String(20), default='all', nullable=False)
    
    # 타임스탬프
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # 관계 설정
    user = relationship("User", back_populates="user_personas")

    def __repr__(self):
        return f"<UserPersona(id={self.id}, name={self.name}, active={self.is_active})>"