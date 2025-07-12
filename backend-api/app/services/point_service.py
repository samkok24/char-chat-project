"""
포인트 서비스 - Redis를 활용한 원자적 처리
"""

import json
import uuid
from datetime import datetime
from typing import Optional, Tuple
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from redis.asyncio import Redis
from app.models import UserPoint, PointTransaction, User



class PointService:
    def __init__(self, redis: Redis, db: AsyncSession):
        self.redis = redis
        self.db = db
        
    async def get_balance(self, user_id: str) -> int:
        """사용자 포인트 잔액 조회"""
        # Redis에서 먼저 확인
        redis_key = f"points:{user_id}"
        balance = await self.redis.get(redis_key)
        
        if balance is not None:
            return int(balance)
        
        # DB에서 조회
        result = await self.db.execute(
            select(UserPoint).where(UserPoint.user_id == user_id)
        )
        user_point = result.scalar_one_or_none()
        
        if user_point:
            # Redis에 캐시 (5분)
            await self.redis.setex(redis_key, 300, user_point.balance)
            return user_point.balance
        
        return 0
    
    async def charge_points(
        self, 
        user_id: str, 
        amount: int, 
        description: str,
        reference_type: Optional[str] = None,
        reference_id: Optional[str] = None
    ) -> Tuple[bool, int]:
        """포인트 충전"""
        if amount <= 0:
            raise ValueError("충전 금액은 0보다 커야 합니다")
        
        # DB에 UserPoint 레코드가 없으면 생성
        result = await self.db.execute(
            select(UserPoint).where(UserPoint.user_id == user_id)
        )
        user_point = result.scalar_one_or_none()
        
        if not user_point:
            user_point = UserPoint(
                user_id=user_id,
                balance=0,
                total_charged=0,
                total_used=0
            )
            self.db.add(user_point)
        
        # 포인트 충전
        user_point.balance += amount
        user_point.total_charged += amount
        user_point.last_charged_at = func.now()
        
        # 거래 내역 추가
        transaction = PointTransaction(
            user_id=user_id,
            type="charge",
            amount=amount,
            balance_after=user_point.balance,
            description=description,
            reference_type=reference_type,
            reference_id=reference_id
        )
        self.db.add(transaction)
        
        await self.db.commit()
        
        # Redis 캐시 업데이트
        redis_key = f"points:{user_id}"
        await self.redis.setex(redis_key, 300, user_point.balance)
        
        return True, user_point.balance
    
    async def use_points_atomic(
        self,
        user_id: str,
        amount: int,
        reason: str,
        reference_type: Optional[str] = None,
        reference_id: Optional[str] = None
    ) -> Tuple[bool, int, Optional[str]]:
        """Redis Lua를 사용한 원자적 포인트 차감"""
        
        if amount <= 0:
            raise ValueError("사용 금액은 0보다 커야 합니다")
        
        # Lua 스크립트: 원자적 포인트 차감
        lua_script = """
        local user_key = KEYS[1]
        local log_key = KEYS[2]
        local amount = tonumber(ARGV[1])
        local transaction_data = ARGV[2]
        
        -- 현재 잔액 조회
        local current = tonumber(redis.call('GET', user_key) or -1)
        
        -- 캐시가 없으면 DB 조회 필요
        if current == -1 then
            return {-1, 0}
        end
        
        -- 잔액 부족 체크
        if current < amount then
            return {0, current}
        end
        
        -- 포인트 차감
        local new_balance = redis.call('DECRBY', user_key, amount)
        
        -- 거래 로그 추가 (최근 100개만 유지)
        redis.call('LPUSH', log_key, transaction_data)
        redis.call('LTRIM', log_key, 0, 99)
        
        -- TTL 재설정 (5분)
        redis.call('EXPIRE', user_key, 300)
        
        return {1, new_balance}
        """
        
        # 거래 데이터
        transaction_id = str(uuid.uuid4())
        transaction_data = json.dumps({
            "id": transaction_id,
            "amount": amount,
            "reason": reason,
            "reference_type": reference_type,
            "reference_id": reference_id,
            "timestamp": datetime.utcnow().isoformat()
        })
        
        # Redis 키
        redis_key = f"points:{user_id}"
        log_key = f"points:{user_id}:log"
        
        # Lua 스크립트 실행
        result = await self.redis.eval(
            lua_script,
            keys=[redis_key, log_key],
            args=[amount, transaction_data]
        )
        
        status, balance = result[0], result[1]
        
        # 캐시 미스 (-1): DB에서 잔액 조회 후 재시도
        if status == -1:
            db_balance = await self.get_balance(user_id)
            await self.redis.setex(redis_key, 300, db_balance)
            
            # 재시도
            result = await self.redis.eval(
                lua_script,
                keys=[redis_key, log_key],
                args=[amount, transaction_data]
            )
            status, balance = result[0], result[1]
        
        # 결과 처리
        if status == 0:
            return False, balance, "포인트가 부족합니다"
        
        # DB에 거래 내역 저장 (비동기)
        await self._save_transaction_to_db(
            user_id=user_id,
            transaction_id=transaction_id,
            amount=-amount,  # 사용은 음수
            balance_after=balance,
            description=reason,
            reference_type=reference_type,
            reference_id=reference_id
        )
        
        return True, balance, transaction_id
    
    async def _save_transaction_to_db(
        self,
        user_id: str,
        transaction_id: str,
        amount: int,
        balance_after: int,
        description: str,
        reference_type: Optional[str] = None,
        reference_id: Optional[str] = None
    ):
        """거래 내역을 DB에 저장"""
        try:
            # UserPoint 업데이트
            result = await self.db.execute(
                select(UserPoint).where(UserPoint.user_id == user_id)
            )
            user_point = result.scalar_one_or_none()
            
            if user_point:
                user_point.balance = balance_after
                if amount < 0:
                    user_point.total_used += abs(amount)
            else:
                # UserPoint가 없으면 생성
                user_point = UserPoint(
                    user_id=user_id,
                    balance=balance_after,
                    total_charged=0,
                    total_used=abs(amount) if amount < 0 else 0
                )
                self.db.add(user_point)
            
            # 거래 내역 추가
            transaction = PointTransaction(
                id=transaction_id,
                user_id=user_id,
                type="use" if amount < 0 else "charge",
                amount=amount,
                balance_after=balance_after,
                description=description,
                reference_type=reference_type,
                reference_id=reference_id
            )
            self.db.add(transaction)
            
            await self.db.commit()
            
        except Exception as e:
            # 로깅만 하고 에러는 발생시키지 않음 (비동기 처리)
            print(f"Failed to save transaction to DB: {e}")
            await self.db.rollback()
    
    async def get_transactions(
        self,
        user_id: str,
        limit: int = 20,
        offset: int = 0
    ):
        """포인트 거래 내역 조회"""
        result = await self.db.execute(
            select(PointTransaction)
            .where(PointTransaction.user_id == user_id)
            .order_by(PointTransaction.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        return result.scalars().all()
    
    async def refund_points(
        self,
        user_id: str,
        amount: int,
        description: str,
        reference_type: Optional[str] = None,
        reference_id: Optional[str] = None
    ) -> Tuple[bool, int]:
        """포인트 환불"""
        # 충전과 동일한 로직
        return await self.charge_points(
            user_id=user_id,
            amount=amount,
            description=f"[환불] {description}",
            reference_type=reference_type,
            reference_id=reference_id
        ) 