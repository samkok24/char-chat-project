"""
구독 플랜 모델 — PG 심사용 구독 상품 + 사용자 구독 상태
"""

from sqlalchemy import Column, String, Integer, Boolean, DateTime, ForeignKey
from sqlalchemy.sql import func
import uuid

from app.core.database import Base, UUID


class SubscriptionPlan(Base):
    """구독 플랜 정의 (free / basic / premium)"""
    __tablename__ = "subscription_plans"

    id = Column(String(20), primary_key=True)  # "free", "basic", "premium"
    name = Column(String(50), nullable=False)
    price = Column(Integer, nullable=False, default=0)  # 원화
    monthly_ruby = Column(Integer, default=0)
    refill_speed_multiplier = Column(Integer, default=1)  # 1, 2, 4
    free_chapters = Column(Boolean, default=False)
    model_discount_pct = Column(Integer, default=0)  # 0, 10, 30
    sort_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class UserSubscription(Base):
    """사용자 구독 상태"""
    __tablename__ = "user_subscriptions"

    id = Column(UUID(), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True)
    plan_id = Column(String(20), ForeignKey("subscription_plans.id"), nullable=False)
    status = Column(String(20), default="active")  # active, cancelled, expired
    started_at = Column(DateTime(timezone=True), server_default=func.now())
    expires_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
