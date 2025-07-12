"""
포인트 관련 API 엔드포인트
"""

from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from redis.asyncio import Redis
from app.core.database import get_db, get_redis
from app.core.security import get_current_user
from app.models import User, UserPoint, PointTransaction
from app.schemas.payment import (
    UserPointResponse, PointUseRequest, PointUseResponse,
    PointTransactionResponse
)
from app.services.point_service import PointService


router = APIRouter()


@router.get("/balance", response_model=UserPointResponse)
async def get_point_balance(
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    current_user: User = Depends(get_current_user)
):
    """
    포인트 잔액 조회
    """
    point_service = PointService(redis, db)
    balance = await point_service.get_balance(str(current_user.id))
    
    # UserPoint 정보 조회
    result = await db.execute(
        select(UserPoint).where(UserPoint.user_id == str(current_user.id))
    )
    user_point = result.scalar_one_or_none()
    
    if not user_point:
        # 없으면 기본값 반환
        return UserPointResponse(
            user_id=str(current_user.id),
            balance=0,
            total_charged=0,
            total_used=0,
            last_charged_at=None
        )
    
    return UserPointResponse(
        user_id=str(user_point.user_id),
        balance=user_point.balance,
        total_charged=user_point.total_charged,
        total_used=user_point.total_used,
        last_charged_at=user_point.last_charged_at
    )


@router.post("/use", response_model=PointUseResponse)
async def use_points(
    request: PointUseRequest,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    current_user: User = Depends(get_current_user)
):
    """
    포인트 사용 (원자적 차감)
    
    Redis Lua 스크립트를 사용하여 동시성 문제를 방지합니다.
    """
    point_service = PointService(redis, db)
    
    try:
        success, balance, transaction_id = await point_service.use_points_atomic(
            user_id=str(current_user.id),
            amount=request.amount,
            reason=request.reason,
            reference_type=request.reference_type,
            reference_id=request.reference_id
        )
        
        if not success:
            return PointUseResponse(
                success=False,
                balance_after=balance,
                transaction_id="",
                message=transaction_id  # 에러 메시지
            )
        
        return PointUseResponse(
            success=True,
            balance_after=balance,
            transaction_id=transaction_id,
            message="포인트 사용이 완료되었습니다"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail="포인트 사용 중 오류가 발생했습니다")


@router.get("/transactions", response_model=List[PointTransactionResponse])
async def get_point_transactions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    limit: int = 20,
    offset: int = 0,
    transaction_type: str = None
):
    """
    포인트 거래 내역 조회
    
    Args:
        transaction_type: 거래 유형 필터 (charge, use, refund, bonus)
    """
    query = select(PointTransaction).where(
        PointTransaction.user_id == str(current_user.id)
    )
    
    if transaction_type:
        query = query.where(PointTransaction.type == transaction_type)
    
    query = query.order_by(PointTransaction.created_at.desc())
    query = query.limit(limit).offset(offset)
    
    result = await db.execute(query)
    transactions = result.scalars().all()
    
    return [
        PointTransactionResponse(
            id=str(t.id),
            user_id=str(t.user_id),
            type=t.type,
            amount=t.amount,
            balance_after=t.balance_after,
            description=t.description,
            reference_type=t.reference_type,
            reference_id=str(t.reference_id) if t.reference_id else None,
            created_at=t.created_at
        )
        for t in transactions
    ]


@router.get("/transactions/summary")
async def get_transactions_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    포인트 거래 요약 정보
    """
    # 각 거래 유형별 합계 계산
    result = await db.execute(
        select(
            PointTransaction.type,
            func.count(PointTransaction.id).label('count'),
            func.sum(func.abs(PointTransaction.amount)).label('total_amount')
        )
        .where(PointTransaction.user_id == str(current_user.id))
        .group_by(PointTransaction.type)
    )
    
    summary = result.all()
    
    summary_dict = {
        row.type: {
            'count': row.count,
            'total_amount': row.total_amount or 0
        }
        for row in summary
    }
    
    # 현재 잔액
    user_point_result = await db.execute(
        select(UserPoint).where(UserPoint.user_id == str(current_user.id))
    )
    user_point = user_point_result.scalar_one_or_none()
    
    return {
        'current_balance': user_point.balance if user_point else 0,
        'total_charged': summary_dict.get('charge', {}).get('total_amount', 0),
        'total_used': summary_dict.get('use', {}).get('total_amount', 0),
        'total_refunded': summary_dict.get('refund', {}).get('total_amount', 0),
        'total_bonus': summary_dict.get('bonus', {}).get('total_amount', 0),
        'transaction_counts': {
            'charge': summary_dict.get('charge', {}).get('count', 0),
            'use': summary_dict.get('use', {}).get('count', 0),
            'refund': summary_dict.get('refund', {}).get('count', 0),
            'bonus': summary_dict.get('bonus', {}).get('count', 0)
        }
    } 