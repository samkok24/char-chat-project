"""
간단 메트릭 조회 API (베스트-에포트)
- 목적: 실시간 관측 필요 전 임시 지표 확인
"""
from fastapi import APIRouter, Query
from typing import Optional, Dict, Any, Tuple
import time

router = APIRouter()


async def _scan_keys(pattern: str):
    from app.core.database import redis_client
    cursor = 0
    while True:
        cursor, keys = await redis_client.scan(cursor=cursor, match=pattern, count=200)
        for k in keys:
            yield k.decode("utf-8") if isinstance(k, (bytes, bytearray)) else str(k)
        if cursor == 0:
            break


def _labels_match(key: str, filters: Dict[str, Optional[str]]) -> bool:
    # filters: {"story_id": "...", "room_id": "...", "mode": "..."}
    for fk, fv in filters.items():
        if not fv:
            continue
        needle = f"{fk}={fv}"
        if needle not in key:
            return False
    return True


async def _read_float(key: str) -> float:
    from app.core.database import redis_client
    v = await redis_client.get(key)
    if v is None:
        return 0.0
    try:
        s = v.decode("utf-8") if isinstance(v, (bytes, bytearray)) else str(v)
        return float(s)
    except Exception:
        return 0.0


@router.get("/summary")
async def metrics_summary(
    day: Optional[str] = Query(None, description="YYYYMMDD, 기본: 오늘"),
    story_id: Optional[str] = None,
    room_id: Optional[str] = None,
    mode: Optional[str] = None,
    narrator: Optional[str] = Query(None, description="관전가 여부 1|0"),
):
    """origchat 주요 지표 요약(베스트-에포트)
    - tti 평균(ms), 선택지 요청수, next_event 사용수, 완결 수
    - 간단 라벨 필터(story_id/room_id/mode)
    """
    d = day or time.strftime("%Y%m%d")
    filters = {"story_id": story_id, "room_id": room_id, "mode": mode, "narrator": narrator}

    # TTI 집계
    timing_prefix = f"metrics:timing:origchat_tti_ms:{d}"
    total_sum = 0.0
    total_cnt = 0.0
    async for k in _scan_keys(timing_prefix + "*"):
        if not _labels_match(k, filters):
            continue
        if k.endswith(":sum"):
            total_sum += await _read_float(k)
        elif k.endswith(":cnt"):
            total_cnt += await _read_float(k)
    tti_avg_ms = (total_sum / total_cnt) if total_cnt > 0 else 0.0

    # 카운터 집계 함수
    async def _sum_counters(name: str) -> int:
        prefix = f"metrics:counter:{name}:{d}"
        s = 0
        async for ck in _scan_keys(prefix + "*"):
            if not _labels_match(ck, filters):
                continue
            s += int(await _read_float(ck))
        return s

    choices = await _sum_counters("origchat_choices_requested")
    next_event = await _sum_counters("origchat_next_event")
    completed = await _sum_counters("origchat_completed")

    return {
        "day": d,
        "filters": {k: v for k, v in filters.items() if v},
        "tti_avg_ms": round(tti_avg_ms, 2),
        "tti_count": int(total_cnt),
        "counters": {
            "choices_requested": choices,
            "next_event": next_event,
            "completed": completed,
        },
    }




