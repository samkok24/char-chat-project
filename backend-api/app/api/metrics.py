"""
간단 메트릭 조회 API (베스트-에포트)
- 목적: 실시간 관측 필요 전 임시 지표 확인
"""
from fastapi import APIRouter, Query, Depends
from typing import Optional, Dict, Any, Tuple
import time
import json
import logging

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_

from app.core.database import get_db

router = APIRouter()
logger = logging.getLogger(__name__)


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


@router.get("/content-counts")
async def get_content_counts(
    db: AsyncSession = Depends(get_db),
    day: Optional[str] = Query(None, description="YYYYMMDD, 기본: 오늘"),
    use_cache: bool = Query(True, description="Redis 캐시 사용 여부"),
):
    """스토리 에이전트 상단 카피용 '총 콘텐츠 수'를 반환한다.

    의도/동작:
    - 프론트의 "오늘, N개의 스토리가 업로드되었습니다" 문구에서 N을 실제 수치로 치환하기 위함.
    - N = (일반 캐릭터챗 캐릭터 수 + 원작챗 캐릭터 수 + 웹소설 수)
      - 일반 캐릭터챗: Character.origin_story_id IS NULL
      - 원작챗: Character.origin_story_id IS NOT NULL
      - 웹소설: Story.is_webtoon != true AND Story.is_origchat != true
    - 운영 부하를 줄이기 위해 Redis에 날짜 단위로 캐시한다(베스트-에포트).
    """
    # 날짜 키(베스트-에포트)
    try:
        d = (day or "").strip() or time.strftime("%Y%m%d")
    except Exception:
        d = time.strftime("%Y%m%d")

    cache_key = f"metrics:content_counts:{d}"
    if use_cache:
        try:
            from app.core.database import redis_client
            cached = await redis_client.get(cache_key)
            if cached:
                try:
                    data = json.loads(cached) if isinstance(cached, str) else cached
                except Exception:
                    data = None
                if isinstance(data, dict) and "total" in data and "counts" in data:
                    # total=0 캐시는 초기/오류 상황에서 잘못 고정될 수 있으므로 신뢰하지 않는다(베스트-에포트).
                    try:
                        cached_total = int(data.get("total") or 0)
                    except Exception:
                        cached_total = 0
                    if cached_total > 0:
                        # 캐시 응답에도 일관되게 day를 보강
                        data.setdefault("day", d)
                        data["cached"] = True
                        return data
        except Exception as e:
            try:
                logger.warning(f"[metrics.content-counts] cache read failed: {e}")
            except Exception:
                pass

    # DB 집계 (실패해도 0으로 폴백)
    had_error = False
    regular_characters = 0
    origchat_characters = 0
    webnovels = 0
    try:
        from app.models.character import Character
        q = select(func.count(Character.id)).where(
            Character.is_public == True,
            Character.is_active == True,
            Character.origin_story_id.is_(None),
        )
        regular_characters = int((await db.execute(q)).scalar() or 0)
    except Exception as e:
        had_error = True
        try:
            logger.warning(f"[metrics.content-counts] regular characters count failed: {e}")
        except Exception:
            pass

    try:
        from app.models.character import Character
        q = select(func.count(Character.id)).where(
            Character.is_public == True,
            Character.is_active == True,
            Character.origin_story_id.isnot(None),
        )
        origchat_characters = int((await db.execute(q)).scalar() or 0)
    except Exception as e:
        had_error = True
        try:
            logger.warning(f"[metrics.content-counts] origchat characters count failed: {e}")
        except Exception:
            pass

    try:
        from app.models.story import Story
        q = select(func.count(Story.id)).where(
            Story.is_public == True,
            or_(Story.is_webtoon == False, Story.is_webtoon.is_(None)),
            or_(Story.is_origchat == False, Story.is_origchat.is_(None)),
        )
        webnovels = int((await db.execute(q)).scalar() or 0)
    except Exception as e:
        had_error = True
        try:
            logger.warning(f"[metrics.content-counts] webnovels count failed: {e}")
        except Exception:
            pass

    counts = {
        "regular_characters": int(regular_characters),
        "origchat_characters": int(origchat_characters),
        "webnovels": int(webnovels),
    }
    total = int(counts["regular_characters"] + counts["origchat_characters"] + counts["webnovels"])

    payload = {"day": d, "counts": counts, "total": total, "cached": False}

    # 0(또는 부분 실패) 결과는 캐시하지 않아 다음 호출에서 재시도할 수 있게 한다(베스트-에포트).
    if use_cache and (not had_error) and total > 0:
        try:
            from app.core.database import redis_client
            # 날짜 단위 캐시: 운영에서 트래픽이 있어도 DB를 반복 조회하지 않게 함(베스트-에포트)
            await redis_client.setex(cache_key, 60 * 60 * 24, json.dumps(payload, ensure_ascii=False))
        except Exception as e:
            try:
                logger.warning(f"[metrics.content-counts] cache write failed: {e}")
            except Exception:
                pass

    return payload




