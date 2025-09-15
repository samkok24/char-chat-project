"""
간단한 Redis 큐 유틸리티 (유저별 대기열)
"""

from __future__ import annotations

from typing import Optional
import json
from app.core.database import redis_client


def _user_queue_key(user_id: str) -> str:
    return f"q:storygen:{user_id}"


def _job_key(job_id: str) -> str:
    return f"q:job:{job_id}"


async def enqueue_user_job(user_id: str, job_id: str, payload: dict, ttl: int = 3600) -> None:
    await redis_client.rpush(_user_queue_key(user_id), job_id)
    await redis_client.set(_job_key(job_id), json.dumps(payload, ensure_ascii=False), ex=ttl)


async def remove_job(user_id: str, job_id: str) -> None:
    try:
        await redis_client.lrem(_user_queue_key(user_id), 0, job_id)
        await redis_client.delete(_job_key(job_id))
    except Exception:
        pass


async def get_position(user_id: str, job_id: str) -> Optional[int]:
    lst = await redis_client.lrange(_user_queue_key(user_id), 0, -1)
    try:
        idx = lst.index(job_id)
        return idx  # 0-based
    except ValueError:
        return None


async def is_head(user_id: str, job_id: str) -> bool:
    head = await redis_client.lindex(_user_queue_key(user_id), 0)
    return head == job_id


async def pop_if_head(user_id: str, job_id: str) -> bool:
    # 원자적 보장은 약하지만, 단일 소비자 기준으로 충분
    if await is_head(user_id, job_id):
        await redis_client.lpop(_user_queue_key(user_id))
        return True
    return False


async def get_job_payload(job_id: str) -> Optional[dict]:
    raw = await redis_client.get(_job_key(job_id))
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


async def update_job_payload(job_id: str, patch: dict) -> bool:
    data = await get_job_payload(job_id)
    if not data:
        return False
    data.update(patch or {})
    await redis_client.set(_job_key(job_id), json.dumps(data, ensure_ascii=False), ex=3600)
    return True


