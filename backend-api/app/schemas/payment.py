"""
결제 및 포인트 관련 스키마
"""

from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel, Field, validator


# 결제 상품 스키마
class PaymentProductBase(BaseModel):
    name: str = Field(..., max_length=100)
    description: Optional[str] = None
    price: int = Field(..., gt=0, description="가격 (원)")
    point_amount: int = Field(..., gt=0, description="지급 포인트")
    bonus_point: int = Field(0, ge=0, description="보너스 포인트")
    is_active: bool = True
    sort_order: int = 0


class PaymentProductCreate(PaymentProductBase):
    pass


class PaymentProductUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = None
    price: Optional[int] = Field(None, gt=0)
    point_amount: Optional[int] = Field(None, gt=0)
    bonus_point: Optional[int] = Field(None, ge=0)
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None


class PaymentProductResponse(PaymentProductBase):
    id: str
    created_at: datetime
    updated_at: Optional[datetime]
    
    class Config:
        from_attributes = True


# 결제 요청 스키마
class PaymentCheckoutRequest(BaseModel):
    product_id: str
    return_url: Optional[str] = None  # 결제 완료 후 리턴 URL


class PaymentCheckoutResponse(BaseModel):
    checkout_url: str  # PG사 결제 페이지 URL
    order_id: str
    amount: int


# 결제 웹훅 스키마
class PaymentWebhookRequest(BaseModel):
    payment_key: str
    order_id: str
    status: str
    amount: int
    transaction_data: dict


# 결제 내역 스키마
class PaymentResponse(BaseModel):
    id: str
    user_id: str
    product_id: Optional[str]
    amount: int
    point_amount: int
    status: str
    payment_method: Optional[str]
    order_id: str
    paid_at: Optional[datetime]
    created_at: datetime
    
    class Config:
        from_attributes = True


# 포인트 잔액 스키마
class UserPointResponse(BaseModel):
    user_id: str
    balance: int
    total_charged: int
    total_used: int
    last_charged_at: Optional[datetime]
    
    class Config:
        from_attributes = True


# 포인트 사용 스키마
class PointUseRequest(BaseModel):
    amount: int = Field(..., gt=0, description="사용할 포인트")
    reason: str = Field(..., max_length=200, description="사용 사유")
    reference_type: Optional[str] = Field(None, description="참조 타입 (chat, story 등)")
    reference_id: Optional[str] = Field(None, description="참조 ID")


class PointUseResponse(BaseModel):
    success: bool
    balance_after: int
    transaction_id: str
    message: str


# 포인트 거래 내역 스키마
class PointTransactionResponse(BaseModel):
    id: str
    user_id: str
    type: str  # charge, use, refund, bonus
    amount: int
    balance_after: int
    description: Optional[str]
    reference_type: Optional[str]
    reference_id: Optional[str]
    created_at: datetime
    
    @validator('type')
    def validate_type(cls, v):
        allowed_types = ['charge', 'use', 'refund', 'bonus']
        if v not in allowed_types:
            raise ValueError(f'Type must be one of {allowed_types}')
        return v
    
    class Config:
        from_attributes = True


# 결제 내역 리스트 응답
class PaymentHistoryResponse(BaseModel):
    payments: List[PaymentResponse]
    total_count: int
    total_amount: int 