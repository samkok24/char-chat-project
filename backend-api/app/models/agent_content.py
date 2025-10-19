"""
에이전트 콘텐츠 모델 - 내 서랍 기능
"""

from sqlalchemy import Column, String, Text, DateTime, ForeignKey, JSON, Index, Boolean
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
import uuid

from app.core.database import Base


class AgentContent(Base):
    """에이전트에서 생성한 콘텐츠 (일상/장르)"""
    __tablename__ = "agent_contents"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    session_id = Column(String(100), nullable=True, index=True)  # 에이전트 세션 ID
    message_id = Column(String(100), nullable=True, index=True)  # assistant 메시지 ID (스크롤 위치)
    
    # 분류
    story_mode = Column(String(20), nullable=False, index=True)  # 'snap' | 'genre'
    
    # 입력 데이터
    user_text = Column(Text)
    user_image_url = Column(String(500))
    
    # 생성 결과
    generated_text = Column(Text, nullable=False)
    generated_image_urls = Column(JSON)  # 하이라이트 이미지 URL 배열
    
    # 피드 발행 정보
    is_published = Column(Boolean, default=False, nullable=False, index=True)
    published_at = Column(DateTime(timezone=True), nullable=True)
    
    # 타임스탬프
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # 관계
    user = relationship("User", back_populates="agent_contents")
    
    # 인덱스
    __table_args__ = (
        Index('idx_agent_contents_user_mode_created', 'user_id', 'story_mode', 'created_at'),
    )

