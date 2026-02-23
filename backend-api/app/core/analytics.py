"""
간단한 분석 이벤트 기록 (Redis 리스트 기반)
"""

from __future__ import annotations

import json
import datetime as dt
from typing import Any, Dict
from app.core.database import redis_client


async def track_event(name: str, props: Dict[str, Any] | None = None) -> None:
    try:
        payload = {
            "name": name,
            "ts": dt.datetime.utcnow().isoformat(),
        }
        if props:
            payload.update(props)
        data = json.dumps(payload, ensure_ascii=False)
        await redis_client.lpush("analytics:events", data)
        # 리스트 길이 제한 (최근 N개 보관)
        await redis_client.ltrim("analytics:events", 0, 4999)
    except Exception:
        # 분석 실패는 무시
        pass


