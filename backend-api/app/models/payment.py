"""
결제 및 포인트 관련 모델
"""

from sqlalchemy import Column, String, Integer, Boolean, DateTime, ForeignKey, Text, CheckConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
from app.core.database import Base
from app.core.database import UUID


class PaymentProduct(Base):
    """결제 상품 모델"""
    __tablename__ = "payment_products"
    
    id = Column(UUID(), primary_key=True, default=uuid.uuid4)
    name = Column(String(100), nullable=False)
    description = Column(Text)
    price = Column(Integer, nullable=False)  # 원화 기준
    point_amount = Column(Integer, nullable=False)  # 지급 포인트
    bonus_point = Column(Integer, default=0)  # 보너스 포인트
    is_active = Column(Boolean, default=True)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Relationships
    payments = relationship("Payment", back_populates="product")


class Payment(Base):
    """결제 내역 모델"""
    __tablename__ = "payments"
    
    id = Column(UUID(), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(), ForeignKey("users.id"), nullable=False)
    product_id = Column(UUID(), ForeignKey("payment_products.id"))
    amount = Column(Integer, nullable=False)
    point_amount = Column(Integer, nullable=False)
    status = Column(String(20), nullable=False, default="pending")  # pending, success, failed, cancelled
    payment_method = Column(String(50))  # card, kakao_pay, naver_pay, toss
    payment_key = Column(String(200), unique=True)  # PG사 고유 키
    order_id = Column(String(200), unique=True, nullable=False)
    transaction_data = Column(Text)  # JSON 형태로 저장
    failed_reason = Column(Text)
    paid_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Relationships
    user = relationship("User", back_populates="payments")
    product = relationship("PaymentProduct", back_populates="payments")


class PointTransaction(Base):
    """포인트 거래 내역 모델"""
    __tablename__ = "point_transactions"
    
    id = Column(UUID(), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(), ForeignKey("users.id"), nullable=False)
    type = Column(String(20), nullable=False)  # charge, use, refund, bonus
    amount = Column(Integer, nullable=False)  # 양수: 충전, 음수: 사용
    balance_after = Column(Integer, nullable=False)  # 거래 후 잔액
    description = Column(String(200))
    reference_type = Column(String(50))  # payment, chat, story, etc
    reference_id = Column(UUID())  # 관련 레코드 ID
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    user = relationship("User", back_populates="point_transactions")


class UserPoint(Base):
    """사용자 포인트 잔액 모델"""
    __tablename__ = "user_points"
    
    user_id = Column(UUID(), ForeignKey("users.id"), primary_key=True)
    balance = Column(Integer, nullable=False, default=0)
    total_charged = Column(Integer, default=0)
    total_used = Column(Integer, default=0)
    last_charged_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Constraints
    __table_args__ = (
        CheckConstraint('balance >= 0', name='check_balance_positive'),
    )
    
    # Relationships
    user = relationship("User", back_populates="user_point", uselist=False) 


class UserRefillState(Base):
    """사용자 무료 리필 버킷 상태"""
    __tablename__ = "user_refill_states"

    user_id = Column(UUID(), ForeignKey("users.id"), primary_key=True)
    timer_bucket = Column(Integer, nullable=False, default=0)
    # 마지막으로 "정수 스텝(2시간 단위)"까지 반영한 시각
    timer_last_refill_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        CheckConstraint("timer_bucket >= 0", name="check_timer_bucket_non_negative"),
        CheckConstraint("timer_bucket <= 15", name="check_timer_bucket_max_15"),
    )
