"""
유저 활동 로그 모델 — CMS 유저 추적용 (로그인 유저만 DB 저장)
"""
import uuid
from sqlalchemy import Column, String, Integer, DateTime, Index
from sqlalchemy.sql import func

from app.core.database import Base, UUID


class UserActivityLog(Base):
    __tablename__ = "user_activity_logs"

    id = Column(UUID(), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(), nullable=False)
    path = Column(String(500), nullable=False)
    path_raw = Column(String(1000), nullable=True)
    page_group = Column(String(50), nullable=False)
    event = Column(String(20), nullable=False)
    duration_ms = Column(Integer, nullable=True)
    session_id = Column(String(100), nullable=True)
    client_id = Column(String(100), nullable=True)
    meta = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("ix_ual_user_created", "user_id", "created_at"),
        Index("ix_ual_created", "created_at"),
    )
