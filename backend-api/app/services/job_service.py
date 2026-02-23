import json
from typing import Any, Dict
from redis.asyncio import Redis
from app.core.config import settings
from fastapi import Depends
from app.dependencies import get_redis_client
import redis.exceptions

class JobService:
    def __init__(self, redis_client: Redis):
        self.redis = redis_client

    def _get_job_key(self, job_id: str) -> str:
        return f"story:job:{job_id}"

    async def create_job(self, job_id: str, initial_data: Dict[str, Any]) -> None:
        job_key = self._get_job_key(job_id)
        await self.redis.set(job_key, json.dumps(initial_data), ex=settings.JOB_EXPIRATION_SECONDS)

    async def get_job(self, job_id: str) -> Dict[str, Any] | None:
        job_key = self._get_job_key(job_id)
        data = await self.redis.get(job_key)
        return json.loads(data) if data else None

    async def update_job(self, job_id: str, updates: Dict[str, Any]) -> Dict[str, Any] | None:
        job_key = self._get_job_key(job_id)
        async with self.redis.pipeline() as pipe:
            try:
                await pipe.watch(job_key)
                current_data_raw = await pipe.get(job_key)
                if not current_data_raw:
                    return None
                
                current_data = json.loads(current_data_raw)
                current_data.update(updates)
                
                pipe.multi()
                await pipe.set(job_key, json.dumps(current_data), ex=settings.JOB_EXPIRATION_SECONDS)
                await pipe.execute()
                return current_data
            except redis.exceptions.WatchError:
                # Concurrency issue, could retry
                return None

    async def delete_job(self, job_id: str) -> None:
        job_key = self._get_job_key(job_id)
        await self.redis.delete(job_key)

    async def cancel_job(self, job_id: str) -> Dict[str, Any] | None:
        """Mark job as cancelled. Worker should stop promptly."""
        return await self.update_job(job_id, {"status": "cancelled", "cancelled": True})

job_service: JobService | None = None

async def get_job_service(redis_client: Redis = Depends(get_redis_client)) -> JobService:
    global job_service
    if job_service is None:
        job_service = JobService(redis_client)
    return job_service
