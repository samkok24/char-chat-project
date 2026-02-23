"""
간단 메트릭 수집 유틸(베스트-에포트): Redis 카운터/타이밍 집계 + 로그 출력
프로메테우스 등 외부 도입 전 임시 관측용
"""
from __future__ import annotations

import json
import time
from typing import Dict, Any

import logging


def _labels_to_key(labels: Dict[str, Any]) -> str:
    try:
        # 키 길이 제한을 위해 value를 str로 단순화
        items = sorted((str(k), str(v)) for k, v in (labels or {}).items())
        return ":".join([f"{k}={v}" for k, v in items])
    except Exception:
        return ""


async def increment_counter(name: str, *, labels: Dict[str, Any] | None = None, expire_seconds: int = 86400) -> None:
    try:
        from app.core.database import redis_client
        day = time.strftime("%Y%m%d")
        key_base = f"metrics:counter:{name}:{day}"
        lk = _labels_to_key(labels or {})
        key = f"{key_base}:{lk}" if lk else key_base
        await redis_client.incr(key)
        await redis_client.expire(key, expire_seconds)
    except Exception:
        pass
    try:
        logging.getLogger("metrics").info(json.dumps({"type": "counter", "name": name, "labels": labels or {}}))
    except Exception:
        pass


async def record_timing(name: str, value_ms: int | float, *, labels: Dict[str, Any] | None = None, expire_seconds: int = 86400) -> None:
    try:
        from app.core.database import redis_client
        day = time.strftime("%Y%m%d")
        key_base = f"metrics:timing:{name}:{day}"
        lk = _labels_to_key(labels or {})
        # 간단히 sum/count로 집계(평균 계산용)
        sum_key = f"{key_base}:{lk}:sum" if lk else f"{key_base}:sum"
        cnt_key = f"{key_base}:{lk}:cnt" if lk else f"{key_base}:cnt"
        await redis_client.incrbyfloat(sum_key, float(value_ms))
        await redis_client.incr(cnt_key)
        await redis_client.expire(sum_key, expire_seconds)
        await redis_client.expire(cnt_key, expire_seconds)
    except Exception:
        pass
    try:
        logging.getLogger("metrics").info(json.dumps({"type": "timing", "name": name, "value_ms": float(value_ms), "labels": labels or {}}))
    except Exception:
        pass





