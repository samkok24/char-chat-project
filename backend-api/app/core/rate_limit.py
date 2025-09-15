"""
간단한 Redis 기반 레이트 리밋/동시성 제한 유틸리티
"""

from __future__ import annotations

from typing import Tuple
import time
from app.core.database import redis_client


async def check_rate_limit(bucket: str, max_requests: int, window_seconds: int = 60) -> tuple[bool, int]:
    """
    고정 윈도우 방식 레이트리밋.
    반환: (허용 여부, 남은 횟수)
    """
    now = int(time.time())
    window = now // window_seconds
    key = f"rl:{bucket}:{window}"
    # INCR 및 만료 설정
    try:
        count = await redis_client.incr(key)
        if count == 1:
            await redis_client.expire(key, window_seconds)
        remaining = max(0, max_requests - count)
        return (count <= max_requests, remaining)
    except Exception:
        # Redis 장애 시 리밋을 우회(가용성 우선)
        return (True, max_requests)


async def increment_active(bucket: str, max_active: int) -> bool:
    """동시성 카운터 증가. 초과 시 false 반환하고 롤백."""
    key = f"act:{bucket}"
    try:
        val = await redis_client.incr(key)
        # 보호용 만료(유실 방지)
        await redis_client.expire(key, 3600)
        if val > max_active:
            # 롤백
            await redis_client.decr(key)
            return False
        return True
    except Exception:
        # 장애 시 제한 미적용(가용성 우선)
        return True


async def decrement_active(bucket: str) -> None:
    key = f"act:{bucket}"
    try:
        await redis_client.decr(key)
    except Exception:
        pass


