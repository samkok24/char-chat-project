"""
사이트 공통 설정(배너/홈 구좌 등) 모델

의도:
- 기존 CMS(배너/구좌)가 로컬스토리지 기반이라 운영에서 "브라우저/기기별로만" 적용되는 문제가 있었다.
- 운영에서는 모든 유저에게 동일하게 반영되어야 하므로, 서버/DB에 SSOT로 저장한다.

안전/방어:
- value는 JSON(JSONB)로 저장해 스키마 변경에도 유연하게 대응한다.
- key는 unique로 강제해 동일 설정이 중복 생성되지 않도록 한다.
"""

from sqlalchemy import Column, String, DateTime, func
import uuid

from app.core.database import Base, UUID, JSON


class SiteConfig(Base):
    """사이트 공통 설정(Key-Value)"""

    __tablename__ = "site_configs"

    id = Column(UUID(), primary_key=True, default=uuid.uuid4, index=True)
    key = Column(String(100), nullable=False, unique=True, index=True)
    value = Column(JSON(), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    def __repr__(self) -> str:
        return f"<SiteConfig(key={self.key})>"


