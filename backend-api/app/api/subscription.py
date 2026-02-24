"""
구독 플랜 API — PG 심사용 구독 상품 조회/구독/내 구독 확인
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.sql import func
from pydantic import BaseModel
from typing import Optional
import logging

from redis.asyncio import Redis
from app.core.database import get_db, get_redis
from app.core.security import get_current_user
from app.models.subscription import SubscriptionPlan, UserSubscription
from app.models.user import User
from app.services.point_service import PointService

logger = logging.getLogger(__name__)

router = APIRouter()


# ── Schemas ──────────────────────────────────────────

class PlanResponse(BaseModel):
    id: str
    name: str
    price: int
    monthly_ruby: int
    refill_speed_multiplier: int
    free_chapters: bool
    model_discount_pct: int

class MySubscriptionResponse(BaseModel):
    plan_id: str
    plan_name: str
    price: int
    status: str
    monthly_ruby: int
    refill_speed_multiplier: int
    free_chapters: bool
    model_discount_pct: int
    started_at: Optional[str] = None
    expires_at: Optional[str] = None

class SubscribeRequest(BaseModel):
    plan_id: str

class SubscribeResponse(BaseModel):
    success: bool
    plan: PlanResponse
    ruby_granted: int


# ── Endpoints ────────────────────────────────────────

@router.get("/plans", response_model=list[PlanResponse])
async def get_plans(db: AsyncSession = Depends(get_db)):
    """구독 플랜 목록 조회 (인증 불필요)"""
    result = await db.execute(
        select(SubscriptionPlan)
        .where(SubscriptionPlan.is_active == True)
        .order_by(SubscriptionPlan.sort_order)
    )
    plans = result.scalars().all()
    return [
        PlanResponse(
            id=p.id, name=p.name, price=p.price,
            monthly_ruby=p.monthly_ruby,
            refill_speed_multiplier=p.refill_speed_multiplier,
            free_chapters=p.free_chapters,
            model_discount_pct=p.model_discount_pct,
        )
        for p in plans
    ]


@router.get("/me", response_model=MySubscriptionResponse)
async def get_my_subscription(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """내 구독 정보 조회"""
    result = await db.execute(
        select(UserSubscription).where(
            UserSubscription.user_id == current_user.id,
            UserSubscription.status == "active",
        )
    )
    sub = result.scalar_one_or_none()

    if not sub:
        # 구독 없으면 무료 플랜 기본값 반환
        return MySubscriptionResponse(
            plan_id="free", plan_name="무료", price=0, status="active",
            monthly_ruby=0, refill_speed_multiplier=1,
            free_chapters=False, model_discount_pct=0,
        )

    plan = await db.get(SubscriptionPlan, sub.plan_id)
    if not plan:
        return MySubscriptionResponse(
            plan_id="free", plan_name="무료", price=0, status="active",
            monthly_ruby=0, refill_speed_multiplier=1,
            free_chapters=False, model_discount_pct=0,
        )

    return MySubscriptionResponse(
        plan_id=plan.id, plan_name=plan.name, price=plan.price,
        status=sub.status,
        monthly_ruby=plan.monthly_ruby,
        refill_speed_multiplier=plan.refill_speed_multiplier,
        free_chapters=plan.free_chapters,
        model_discount_pct=plan.model_discount_pct,
        started_at=sub.started_at.isoformat() if sub.started_at else None,
        expires_at=sub.expires_at.isoformat() if sub.expires_at else None,
    )


@router.post("/subscribe", response_model=SubscribeResponse)
async def subscribe(
    body: SubscribeRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
):
    """구독 신청 (PG 연동 전 stub — 결제 없이 바로 활성화)"""
    plan = await db.get(SubscriptionPlan, body.plan_id)
    if not plan or not plan.is_active:
        raise HTTPException(status_code=404, detail="존재하지 않는 플랜입니다")

    uid = str(current_user.id)

    # 기존 구독 조회
    result = await db.execute(
        select(UserSubscription).where(UserSubscription.user_id == current_user.id)
    )
    existing = result.scalar_one_or_none()

    now = func.now()

    if existing:
        existing.plan_id = body.plan_id
        existing.status = "active"
        existing.started_at = now
        existing.expires_at = None  # PG 연동 후 실제 만료일 설정
    else:
        sub = UserSubscription(
            user_id=current_user.id,
            plan_id=body.plan_id,
            status="active",
        )
        db.add(sub)

    await db.commit()

    # 월 루비 지급
    ruby_granted = plan.monthly_ruby
    if ruby_granted > 0:
        point_service = PointService(redis, db)
        await point_service.charge_points(
            user_id=uid,
            amount=ruby_granted,
            description=f"구독 월 루비 ({plan.name})",
            reference_type="subscription_ruby",
        )

    return SubscribeResponse(
        success=True,
        plan=PlanResponse(
            id=plan.id, name=plan.name, price=plan.price,
            monthly_ruby=plan.monthly_ruby,
            refill_speed_multiplier=plan.refill_speed_multiplier,
            free_chapters=plan.free_chapters,
            model_discount_pct=plan.model_discount_pct,
        ),
        ruby_granted=ruby_granted,
    )
