"""
포인트 서비스 - Redis를 활용한 원자적 처리
"""

import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.exc import IntegrityError
from redis.asyncio import Redis
from app.models import UserPoint, PointTransaction, User, UserRefillState


TIMER_REFILL_INTERVAL_SECONDS = 2 * 60 * 60  # 2시간
TIMER_REFILL_BUCKET_MAX = 15
KST = timezone(timedelta(hours=9))
CHECKIN_REWARD = 10

# 모델별 루비 비용 (SSOT — PRICING_AND_PAYMENT_PLAN.md 기준)
MODEL_RUBY_COST: dict[str, int] = {
    "gemini-2.5-flash": 0,
    "claude-haiku-4-5-20251001": 3,
    "gemini-3-flash-preview": 5,
    "claude-sonnet-4-20250514": 5,
    "gemini-2.5-pro": 5,
    "gpt-5.1": 5,
    "claude-sonnet-4-5-20250929": 7,
    "gemini-3-pro-preview": 7,
    "gpt-5.2": 7,
}


class PointService:
    def __init__(self, redis: Redis, db: AsyncSession):
        self.redis = redis
        self.db = db

    def _utcnow(self) -> datetime:
        return datetime.now(timezone.utc)

    async def _get_or_create_refill_state(self, user_id: str) -> UserRefillState:
        result = await self.db.execute(
            select(UserRefillState).where(UserRefillState.user_id == user_id)
        )
        state = result.scalar_one_or_none()
        if state:
            return state
        now = self._utcnow()
        state = UserRefillState(
            user_id=user_id,
            timer_bucket=0,
            timer_last_refill_at=now,
        )
        self.db.add(state)
        try:
            await self.db.commit()
            await self.db.refresh(state)
            return state
        except IntegrityError:
            # 동시 요청으로 같은 user_id가 먼저 생성된 경우 재조회한다.
            await self.db.rollback()
            retry = await self.db.execute(
                select(UserRefillState).where(UserRefillState.user_id == user_id)
            )
            existing = retry.scalar_one_or_none()
            if existing:
                return existing
            raise

    async def get_timer_status(self, user_id: str) -> dict:
        """
        지연 계산 방식의 타이머 리필 상태를 반환한다.
        - 2시간마다 1개 적립
        - 버킷 최대 15
        - 서버 다운/재시작과 무관하게 elapsed 기준으로 복원
        """
        lock_key = f"points:timer:lock:{user_id}"
        lock_token = str(uuid.uuid4())
        has_lock = False
        try:
            try:
                has_lock = bool(await self.redis.set(lock_key, lock_token, ex=5, nx=True))
            except Exception:
                has_lock = False

            # 락 획득 실패 시에도 읽기 자체는 진행하되, 쓰기 경합만 피한다.
            state = await self._get_or_create_refill_state(user_id)
            now = self._utcnow()

            current = int(state.timer_bucket or 0)
            last_at = state.timer_last_refill_at or now
            if last_at.tzinfo is None:
                last_at = last_at.replace(tzinfo=timezone.utc)

            elapsed_seconds = max(0, int((now - last_at).total_seconds()))
            steps = elapsed_seconds // TIMER_REFILL_INTERVAL_SECONDS
            capacity = max(0, TIMER_REFILL_BUCKET_MAX - current)
            earned = min(steps, capacity)

            if earned > 0 and has_lock:
                state.timer_bucket = current + int(earned)
                state.timer_last_refill_at = last_at + timedelta(seconds=int(earned) * TIMER_REFILL_INTERVAL_SECONDS)

                # 실제 잔액에 반영
                result = await self.db.execute(
                    select(UserPoint).where(UserPoint.user_id == user_id)
                )
                user_point = result.scalar_one_or_none()
                if not user_point:
                    user_point = UserPoint(user_id=user_id, balance=0, total_charged=0, total_used=0)
                    self.db.add(user_point)
                user_point.balance += int(earned)
                user_point.total_charged += int(earned)

                self.db.add(PointTransaction(
                    user_id=user_id,
                    type="bonus",
                    amount=int(earned),
                    balance_after=user_point.balance,
                    description=f"타이머 리필 +{earned}",
                    reference_type="timer_refill",
                ))

                await self.db.commit()

                # Redis 잔액 캐시 갱신
                await self.redis.setex(f"points:{user_id}", 300, user_point.balance)

                current = int(state.timer_bucket or 0)
                last_at = state.timer_last_refill_at or now
                if last_at.tzinfo is None:
                    last_at = last_at.replace(tzinfo=timezone.utc)

            # 다음 충전까지 남은 시간 계산
            if current >= TIMER_REFILL_BUCKET_MAX:
                next_refill_seconds = 0
            else:
                since_last = max(0, int((now - last_at).total_seconds()))
                remain = TIMER_REFILL_INTERVAL_SECONDS - (since_last % TIMER_REFILL_INTERVAL_SECONDS)
                next_refill_seconds = int(remain if remain != TIMER_REFILL_INTERVAL_SECONDS else TIMER_REFILL_INTERVAL_SECONDS)

            return {
                "current": int(current),
                "max": int(TIMER_REFILL_BUCKET_MAX),
                "earned": int(earned if has_lock else 0),
                "next_refill_seconds": int(next_refill_seconds),
            }
        except Exception:
            await self.db.rollback()
            raise
        finally:
            if has_lock:
                try:
                    lua = """
                    if redis.call('GET', KEYS[1]) == ARGV[1] then
                      return redis.call('DEL', KEYS[1])
                    end
                    return 0
                    """
                    await self.redis.eval(lua, 1, lock_key, lock_token)
                except Exception:
                    pass
        
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
    
    async def daily_check_in(self, user_id: str) -> dict:
        """일일 출석체크 (KST 기준 00:00~23:59, 하루 1회)"""
        now_kst = datetime.now(KST)
        today_str = now_kst.strftime('%Y-%m-%d')
        redis_key = f"checkin:{user_id}:{today_str}"

        # SET NX로 동시 요청까지 방어
        end_of_day = now_kst.replace(hour=23, minute=59, second=59)
        ttl = max(1, int((end_of_day - now_kst).total_seconds()) + 1)
        if not await self.redis.set(redis_key, "1", ex=ttl, nx=True):
            return {"success": False, "already_checked_in": True, "message": "오늘 이미 출석했습니다."}

        # 보너스 포인트 지급
        result = await self.db.execute(
            select(UserPoint).where(UserPoint.user_id == user_id)
        )
        user_point = result.scalar_one_or_none()
        if not user_point:
            user_point = UserPoint(user_id=user_id, balance=0, total_charged=0, total_used=0)
            self.db.add(user_point)

        user_point.balance += CHECKIN_REWARD
        user_point.total_charged += CHECKIN_REWARD
        user_point.last_charged_at = func.now()

        transaction = PointTransaction(
            user_id=user_id,
            type="bonus",
            amount=CHECKIN_REWARD,
            balance_after=user_point.balance,
            description="출석체크 보상",
            reference_type="checkin",
        )
        self.db.add(transaction)
        await self.db.commit()

        # Redis 잔액 캐시 갱신
        await self.redis.setex(f"points:{user_id}", 300, user_point.balance)

        return {
            "success": True,
            "already_checked_in": False,
            "balance": user_point.balance,
            "reward": CHECKIN_REWARD,
            "message": f"출석체크 완료! +{CHECKIN_REWARD} 루비",
        }

    async def get_check_in_status(self, user_id: str) -> dict:
        """오늘(KST) 출석 여부 확인"""
        today_str = datetime.now(KST).strftime('%Y-%m-%d')
        checked = await self.redis.get(f"checkin:{user_id}:{today_str}")
        return {"checked_in": bool(checked), "date": today_str}

    async def deduct_chat_turn(
        self,
        user_id: str,
        sub_model: str,
    ) -> Tuple[bool, int, Optional[str]]:
        """채팅 턴 루비 차감. 무료 모델이면 즉시 성공 반환."""
        cost = MODEL_RUBY_COST.get(sub_model, 0)
        if cost <= 0:
            return True, 0, None
        return await self.use_points_atomic(
            user_id=user_id,
            amount=cost,
            reason=f"채팅 턴 ({sub_model}) 💎{cost}",
            reference_type="chat_turn",
        )

    async def refund_chat_turn(
        self,
        user_id: str,
        sub_model: str,
        tx_id: str,
    ) -> Tuple[bool, int]:
        """AI 호출 실패 시 채팅 턴 루비 환불."""
        cost = MODEL_RUBY_COST.get(sub_model, 0)
        if cost <= 0:
            return True, 0
        return await self.refund_points(
            user_id=user_id,
            amount=cost,
            description=f"AI 오류 환불 ({sub_model}) 💎{cost}",
            reference_type="chat_turn_refund",
            reference_id=tx_id,
        )

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
