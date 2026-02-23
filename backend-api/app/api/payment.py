"""
결제 관련 API 엔드포인트
"""

from typing import List
from datetime import datetime
import uuid
import json
import hashlib
import hmac
import logging
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, func
from app.core.database import get_db, get_redis
from app.core.security import get_current_user
from redis.asyncio import Redis
from app.models import User, PaymentProduct, Payment, PointTransaction, UserPoint
from app.schemas.payment import (
    PaymentProductResponse, PaymentProductCreate, PaymentProductUpdate,
    PaymentCheckoutRequest, PaymentCheckoutResponse,
    PaymentWebhookRequest, PaymentResponse, PaymentHistoryResponse
)
from app.services.point_service import PointService
from app.core.config import settings

logger = logging.getLogger(__name__)

router = APIRouter()


def _is_production_env() -> bool:
    try:
        return str(getattr(settings, "ENVIRONMENT", "") or "").strip().lower() == "production"
    except Exception:
        return False


def _normalize_signature(raw: str) -> str:
    s = str(raw or "").strip()
    if not s:
        return ""
    # Allow "sha256=<hex>" and plain "<hex>"
    if "=" in s:
        k, v = s.split("=", 1)
        if k.strip().lower() in {"sha256", "h1"}:
            return v.strip()
    return s


async def _verify_webhook_signature_or_raise(request: Request) -> None:
    """
    Generic webhook signature verification (HMAC-SHA256).
    - Signature header: X-Webhook-Signature (or X-Signature)
    - Body: raw request bytes
    - Format: "sha256=<hex>" or "<hex>"
    """
    secret = str(getattr(settings, "PAYMENT_WEBHOOK_SECRET", "") or "").strip()
    if not secret:
        if _is_production_env():
            raise HTTPException(status_code=500, detail="PAYMENT_WEBHOOK_SECRET is not configured")
        # dev/local: allow for manual testing
        logger.warning("[payment_webhook] PAYMENT_WEBHOOK_SECRET not set; signature check skipped in non-production")
        return

    sig_header = (
        request.headers.get("X-Webhook-Signature")
        or request.headers.get("X-Signature")
        or ""
    )
    signature = _normalize_signature(sig_header)
    if not signature:
        raise HTTPException(status_code=401, detail="Missing webhook signature")

    raw_body = await request.body()
    expected = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")


@router.get("/products", response_model=List[PaymentProductResponse])
async def get_payment_products(
    db: AsyncSession = Depends(get_db),
    is_active: bool = True
):
    """
    결제 상품 목록 조회
    """
    query = select(PaymentProduct).where(PaymentProduct.is_active == is_active)
    query = query.order_by(PaymentProduct.sort_order)
    
    result = await db.execute(query)
    products = result.scalars().all()
    
    return products


@router.post("/products", response_model=PaymentProductResponse)
async def create_payment_product(
    product: PaymentProductCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    결제 상품 생성 (관리자 전용)
    
    TODO: 관리자 권한 체크 미들웨어 추가
    """
    if not bool(getattr(current_user, "is_admin", False)):
        raise HTTPException(status_code=403, detail="관리자 권한이 필요합니다")

    db_product = PaymentProduct(**product.dict())
    db.add(db_product)
    await db.commit()
    await db.refresh(db_product)
    
    return db_product


@router.post("/checkout", response_model=PaymentCheckoutResponse)
async def create_checkout(
    request: PaymentCheckoutRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    결제 요청 생성
    
    실제 환경에서는 토스페이먼츠 SDK를 사용해야 합니다.
    현재는 데모용으로 간단히 구현되어 있습니다.
    """
    # 상품 조회
    result = await db.execute(
        select(PaymentProduct).where(
            PaymentProduct.id == request.product_id,
            PaymentProduct.is_active == True
        )
    )
    product = result.scalar_one_or_none()
    
    if not product:
        raise HTTPException(status_code=404, detail="상품을 찾을 수 없습니다")
    
    # 주문 ID 생성
    order_id = f"ORDER_{current_user.id}_{int(datetime.now().timestamp())}"
    
    # 결제 요청 기록
    payment = Payment(
        user_id=str(current_user.id),
        product_id=str(product.id),
        amount=product.price,
        point_amount=product.point_amount + product.bonus_point,
        status="pending",
        order_id=order_id
    )
    db.add(payment)
    await db.commit()
    
    # TODO: 실제 토스페이먼츠 API 호출
    # 현재는 데모용 URL 반환
    checkout_url = f"{settings.FRONTEND_URL}/payment/demo?order_id={order_id}&amount={product.price}"
    
    return PaymentCheckoutResponse(
        checkout_url=checkout_url,
        order_id=order_id,
        amount=product.price
    )


@router.post("/webhook")
async def payment_webhook(
    webhook_data: PaymentWebhookRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis)
):
    """
    결제 완료 웹훅 처리
    
    PG사에서 결제 완료 시 호출하는 웹훅 엔드포인트입니다.
    """
    # 서명 검증 (운영 필수)
    await _verify_webhook_signature_or_raise(request)

    # 멱등성 키 선점 (중복 웹훅 처리 방지)
    idem_key = f"payment:webhook:{webhook_data.payment_key}:{webhook_data.status}"
    try:
        claimed = await redis.set(idem_key, "1", ex=86400, nx=True)
    except Exception:
        claimed = True
    if not claimed:
        return {"message": "Already processed"}
    
    # 결제 정보 조회
    result = await db.execute(
        select(Payment).where(Payment.order_id == webhook_data.order_id)
    )
    payment = result.scalar_one_or_none()
    
    if not payment:
        raise HTTPException(status_code=404, detail="결제 정보를 찾을 수 없습니다")
    
    # 이미 처리된 결제인지 확인
    if payment.status != "pending":
        return {"message": "Already processed"}
    
    # 결제 상태 업데이트
    payment.status = webhook_data.status
    payment.payment_key = webhook_data.payment_key
    payment.transaction_data = json.dumps(webhook_data.transaction_data)
    
    try:
        if webhook_data.status == "success":
            payment.paid_at = datetime.utcnow()

            # 포인트 충전
            point_service = PointService(redis, db)
            success, balance = await point_service.charge_points(
                user_id=payment.user_id,
                amount=payment.point_amount,
                description=f"결제 충전 - 주문번호: {payment.order_id}",
                reference_type="payment",
                reference_id=str(payment.id)
            )

            # TODO: 결제 완료 알림 발송

        else:
            payment.failed_reason = webhook_data.transaction_data.get("message", "Unknown error")

        await db.commit()
        return {"message": "OK"}
    except Exception:
        # 처리 실패 시 멱등 키 제거(재시도 허용)
        try:
            await redis.delete(idem_key)
        except Exception:
            pass
        raise


@router.get("/history", response_model=PaymentHistoryResponse)
async def get_payment_history(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    limit: int = 20,
    offset: int = 0
):
    """
    결제 내역 조회
    """
    # 전체 개수 조회
    count_query = select(func.count()).select_from(Payment).where(
        Payment.user_id == str(current_user.id)
    )
    total_count = await db.execute(count_query)
    total_count = total_count.scalar()
    
    # 결제 내역 조회
    query = select(Payment).where(
        Payment.user_id == str(current_user.id)
    ).order_by(desc(Payment.created_at)).limit(limit).offset(offset)
    
    result = await db.execute(query)
    payments = result.scalars().all()
    
    # 총 결제 금액 계산
    total_amount = sum(p.amount for p in payments if p.status == "success")
    
    return PaymentHistoryResponse(
        payments=payments,
        total_count=total_count,
        total_amount=total_amount
    )


@router.get("/payment/{payment_id}", response_model=PaymentResponse)
async def get_payment_detail(
    payment_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    결제 상세 정보 조회
    """
    result = await db.execute(
        select(Payment).where(
            Payment.id == payment_id,
            Payment.user_id == str(current_user.id)
        )
    )
    payment = result.scalar_one_or_none()
    
    if not payment:
        raise HTTPException(status_code=404, detail="결제 정보를 찾을 수 없습니다")
    
    return payment 
