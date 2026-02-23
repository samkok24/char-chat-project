from sqlalchemy import Column, String, Integer, Boolean, DateTime, Index
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import relationship
import uuid
from datetime import datetime

from app.core.database import Base


class MediaAsset(Base):
    __tablename__ = "media_assets"
    __table_args__ = (
        Index("ix_media_entity", "entity_type", "entity_id", "order_index"),
    )

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    # 소유자 및 대상 엔티티
    user_id = Column(String(36), nullable=True, index=True)
    entity_type = Column(String(16), nullable=True)  # character | story | origchat
    entity_id = Column(String(36), nullable=True, index=True)

    # 파일 정보
    url = Column(String(500), nullable=False)
    width = Column(Integer, nullable=True)
    height = Column(Integer, nullable=True)

    # 갤러리 제어
    is_primary = Column(Boolean, default=False, nullable=False)
    order_index = Column(Integer, default=0, nullable=False)

    # 생성/검사 메타
    status = Column(String(16), default="ready", nullable=False)  # pending|ready|failed
    provider = Column(String(32), nullable=True)
    model = Column(String(64), nullable=True)
    seed = Column(String(64), nullable=True)
    ratio = Column(String(16), nullable=True)  # 1:1,3:4,16:9
    phash = Column(String(64), nullable=True, index=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


