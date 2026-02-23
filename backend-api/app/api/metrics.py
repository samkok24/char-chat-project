"""
간단 메트릭 조회 API (베스트-에포트)
- 목적: 실시간 관측 필요 전 임시 지표 확인
"""
from fastapi import APIRouter, Query, Depends, HTTPException, Request
from typing import Optional, Dict, Any, Tuple, List
import os
import hashlib
import time
import json
import logging
import re
from datetime import datetime, timedelta, timezone
from pydantic import BaseModel, Field

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_

import uuid as _uuid_mod

from app.core.database import get_db, AsyncSessionLocal
from app.core.security import get_current_user, get_current_user_optional
from app.models.user import User
from app.models.chat import ChatRoom, ChatMessage
from app.models.user_activity_log import UserActivityLog

router = APIRouter()
logger = logging.getLogger(__name__)

_PAGE_EVENTS = {"page_view", "page_leave", "page_exit"}
_AUTH_MODAL_EVENTS = {"modal_login_open", "modal_register_open"}
_TRACKABLE_EVENTS = _PAGE_EVENTS | _AUTH_MODAL_EVENTS


class PageTrafficEventIn(BaseModel):
    """
    프론트 SPA 페이지 뷰/이탈(탭 닫힘/새로고침/외부 이동) 이벤트 수집.

    - 카드/상세/채팅 등 ID가 포함된 경로는 서버에서 정규화해 cardinality 폭주를 방지한다.
    """
    event: str = Field(..., description="page_view|page_leave|page_exit|modal_login_open|modal_register_open")
    path: str = Field(..., description="window.location.pathname (권장: query 제외)")
    session_id: Optional[str] = Field(None, description="프론트 세션 식별자(선택)")
    client_id: Optional[str] = Field(None, description="브라우저 고정 식별자(선택)")
    duration_ms: Optional[int] = Field(None, description="현재 path 체류시간(선택)")
    user_id: Optional[str] = Field(None, description="로그인 유저 ID(선택)")
    meta: Optional[str] = Field(None, description="AB테스트 등 추가 메타 (JSON string, 최대 500자)")

# ===== 실시간 온라인(접속) 지표: Redis 하트비트 기반(베스트-에포트) =====
# 운영 안전:
# - 조회(집계)만 관리자에게 제공한다(외부 노출 방지).
# - 하트비트는 실패해도 서비스 기능을 깨지 않도록 "best-effort"로 처리한다.
_ONLINE_PRESENCE_ENABLED = os.getenv("ONLINE_PRESENCE_ENABLED", "1").strip() not in ("0", "false", "False")
_ONLINE_PRESENCE_TTL_SEC = int(os.getenv("ONLINE_PRESENCE_TTL_SEC", "60") or 60)
_ONLINE_PRESENCE_ZKEY = os.getenv("ONLINE_PRESENCE_ZKEY", "metrics:online:zset:v1").strip() or "metrics:online:zset:v1"


def _ensure_admin(user: User) -> None:
    """관리자 권한 방어 체크"""
    if not getattr(user, "is_admin", False):
        raise HTTPException(status_code=403, detail="관리자만 사용할 수 있습니다.")


try:
    # Python 3.9+
    from zoneinfo import ZoneInfo  # type: ignore
    _KST = ZoneInfo("Asia/Seoul")
except Exception:
    _KST = timezone(timedelta(hours=9))


def _parse_day_yyyymmdd(day: str) -> str:
    s = (day or "").strip()
    if not s:
        return ""
    if not re.fullmatch(r"\d{8}", s):
        return ""
    return s


def _client_ip(request: Optional[Request]) -> str:
    """
    클라이언트 IP 추출(프록시 환경 방어)
    - Nginx/Cloudflare 환경에서는 X-Forwarded-For에 원 IP가 포함될 수 있다.
    - 없으면 request.client.host로 폴백한다.
    """
    if request is None:
        return ""
    try:
        xff = request.headers.get("x-forwarded-for") or request.headers.get("X-Forwarded-For") or ""
        if xff:
            # "client, proxy1, proxy2" 형태일 수 있으므로 첫 IP만 사용
            ip = xff.split(",")[0].strip()
            if ip:
                return ip
    except Exception:
        pass
    try:
        return str(getattr(request.client, "host", "") or "")
    except Exception:
        return ""


def _viewer_key(request: Optional[Request], user: Optional[User]) -> str:
    """
    온라인(하트비트) 용 고유 키 생성

    의도/동작:
    - 로그인 유저: user_id 기반(정확한 유니크)
    - 비로그인: ip + user-agent 해시(대략 유니크)
    """
    try:
        if user is not None and getattr(user, "id", None):
            return f"u:{user.id}"
    except Exception:
        pass

    ip = _client_ip(request)
    try:
        ua = request.headers.get("user-agent", "") if request is not None else ""
    except Exception:
        ua = ""
    raw = f"{ip}|{ua}".strip()
    if not raw:
        raw = "unknown"
    try:
        h = hashlib.sha1(raw.encode("utf-8", errors="ignore")).hexdigest()[:16]
    except Exception:
        h = str(abs(hash(raw)))[:16]
    return f"g:{h}"


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


_UUID_SEG_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_DIGITS_SEG_RE = re.compile(r"^\d+$")


def _normalize_client_path(raw_path: str) -> str:
    """
    프론트에서 들어오는 경로를 "집계 가능한" 형태로 정규화한다.

    - query/hash 제거
    - UUID/숫자 세그먼트는 :id/:n 으로 치환해 cardinality 폭주 방지
    """
    s = (raw_path or "").strip()
    if not s:
        return "/"

    # full URL이 들어오는 방어(예: https://host/path?x=1)
    try:
        if "://" in s:
            from urllib.parse import urlparse
            p = urlparse(s)
            s = p.path or "/"
    except Exception:
        pass

    # query/hash 제거
    try:
        s = s.split("?", 1)[0].split("#", 1)[0]
    except Exception:
        pass

    if not s.startswith("/"):
        s = "/" + s
    try:
        s = re.sub(r"/{2,}", "/", s)
    except Exception:
        pass

    parts: List[str] = []
    for seg in (s.split("/") or []):
        seg = (seg or "").strip()
        if not seg:
            continue
        if _UUID_SEG_RE.fullmatch(seg):
            parts.append(":id")
            continue
        if _DIGITS_SEG_RE.fullmatch(seg):
            parts.append(":n")
            continue
        parts.append(seg)

    return "/" + "/".join(parts) if parts else "/"


def _classify_page_group(path_norm: str) -> str:
    """경로 기반 큰 분류(운영/분석 편의)."""
    p = (path_norm or "").strip() or "/"
    if p.startswith("/cms"):
        return "admin"
    if p.startswith("/ws/chat/") or p.startswith("/chat/"):
        return "chat"
    if p.startswith("/characters/create") or p.startswith("/characters/:id/edit"):
        return "character_wizard"
    if p.startswith("/agent"):
        return "story_agent"
    if p.startswith("/storydive"):
        return "storydive"
    if p.startswith("/stories/") and ("/chapters/" in p):
        return "webnovel_reader"
    if p.startswith("/stories/"):
        return "webnovel_detail"
    if p.startswith("/characters/"):
        return "character_detail"
    if p == "/" or p.startswith("/dashboard"):
        return "home"
    if p.startswith("/history"):
        return "history"
    if p.startswith("/login") or p.startswith("/verify") or p.startswith("/forgot-password") or p.startswith("/reset-password"):
        return "auth"
    return "other"


def _page_group_label(group: str) -> str:
    g = (group or "").strip().lower()
    return {
        "chat": "채팅",
        "character_wizard": "캐릭터 생성/수정",
        "story_agent": "스토리 에이전트",
        "storydive": "스토리다이브",
        "webnovel_reader": "웹소설 뷰어",
        "webnovel_detail": "웹소설 상세",
        "character_detail": "캐릭터 상세",
        "history": "대화내역",
        "home": "홈",
        "auth": "인증",
        "admin": "관리자",
        "other": "기타",
    }.get(g, g or "기타")


@router.post("/online/heartbeat")
async def online_heartbeat(
    request: Request,
    current_user: Optional[User] = Depends(get_current_user_optional),  # type: ignore
):
    """
    온라인 유저 하트비트(베스트-에포트)

    의도:
    - 운영 배포 전 "지금 접속자가 있나"를 빠르게 판단할 수 있게, Redis에 짧은 TTL의 온라인 키를 갱신한다.

    주의:
    - 실패해도 서비스 UX를 깨지 않도록 200 응답으로 폴백한다(로그만 남김).
    """
    ttl = max(10, int(_ONLINE_PRESENCE_TTL_SEC or 60))
    if not _ONLINE_PRESENCE_ENABLED:
        return {"ok": True, "enabled": False, "ttl_sec": ttl}

    try:
        from app.core.database import redis_client

        now = int(time.time())
        vkey = _viewer_key(request, current_user)

        # ZSET: member=vkey, score=unix_ts
        await redis_client.zadd(_ONLINE_PRESENCE_ZKEY, {vkey: now})
        # TTL 윈도우 밖 제거
        await redis_client.zremrangebyscore(_ONLINE_PRESENCE_ZKEY, 0, now - ttl)
        # 사이트가 완전 유휴 상태일 때 메모리 누수 방지용 expire(베스트-에포트)
        try:
            await redis_client.expire(_ONLINE_PRESENCE_ZKEY, ttl * 2)
        except Exception:
            pass

        return {"ok": True, "enabled": True, "ttl_sec": ttl}
    except Exception as e:
        try:
            logger.warning(f"[metrics.online] heartbeat failed (ignored): {e}")
        except Exception:
            pass
        return {"ok": False, "enabled": True, "ttl_sec": ttl}


@router.get("/online")
async def get_online_now(
    current_user: User = Depends(get_current_user),
    window_sec: Optional[int] = Query(None, ge=10, le=600, description="온라인으로 간주할 TTL(초)"),
):
    """
    실시간 온라인 유저 수(관리자 전용)

    정의:
    - 최근 N초(기본: ONLINE_PRESENCE_TTL_SEC) 내에 하트비트를 보낸 유저를 '온라인'으로 간주한다.
    """
    _ensure_admin(current_user)

    ttl = max(10, int(window_sec or _ONLINE_PRESENCE_TTL_SEC or 60))
    if not _ONLINE_PRESENCE_ENABLED:
        return {
            "ok": True,
            "enabled": False,
            "ttl_sec": ttl,
            "online": 0,
            "as_of": datetime.now(timezone.utc).isoformat(),
            "source": "disabled",
        }

    try:
        from app.core.database import redis_client

        now = int(time.time())
        # 조회 시점에도 한번 정리(베스트-에포트)
        await redis_client.zremrangebyscore(_ONLINE_PRESENCE_ZKEY, 0, now - ttl)
        online = int(await redis_client.zcard(_ONLINE_PRESENCE_ZKEY) or 0)
        return {
            "ok": True,
            "enabled": True,
            "ttl_sec": ttl,
            "online": online,
            "as_of": datetime.now(timezone.utc).isoformat(),
            "source": "redis_zset",
        }
    except Exception as e:
        try:
            logger.warning(f"[metrics.online] read failed: {e}")
        except Exception:
            pass
        return {
            "ok": False,
            "enabled": True,
            "ttl_sec": ttl,
            "online": 0,
            "as_of": datetime.now(timezone.utc).isoformat(),
            "source": "error",
            "error": str(e),
        }


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


@router.get("/traffic")
async def traffic_summary(
    day: Optional[str] = Query(None, description="YYYYMMDD (KST 기준), 기본: 오늘"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """트래픽 지표(최소 구현) - 채팅 활동 기반

    정의(현재 구현):
    - dau_chat: 해당 일(KST) 유저 발화(sender_type='user')를 1회 이상 한 유니크 유저 수
    - wau_chat: 해당 일 포함 최근 7일(KST) 유저 발화를 1회 이상 한 유니크 유저 수
    - mau_chat: 해당 일 포함 최근 30일(KST) 유저 발화를 1회 이상 한 유니크 유저 수
    - new_users: 해당 일(KST) 가입자 수(users.created_at)
    - user_messages: 해당 일(KST) 유저 발화 총 개수

    주의:
    - "진짜 로그인 시각"을 저장하는 컬럼이 없으므로, DAU는 채팅 활동 기준이다.
    - 스토리(웹소설/웹툰) 열람 DAU는 현재 per-user 로그가 없어 계산할 수 없다(추후 이벤트 로그 필요).
    """
    _ensure_admin(current_user)

    now_kst = datetime.now(_KST)
    d = _parse_day_yyyymmdd(day or "") or now_kst.strftime("%Y%m%d")

    try:
        y = int(d[0:4]); m = int(d[4:6]); dd = int(d[6:8])
        start_kst = datetime(y, m, dd, 0, 0, 0, tzinfo=_KST)
    except Exception:
        # 방어: 파싱 실패 시 오늘
        start_kst = datetime(now_kst.year, now_kst.month, now_kst.day, 0, 0, 0, tzinfo=_KST)
        d = start_kst.strftime("%Y%m%d")

    end_kst = start_kst + timedelta(days=1)

    start_utc = start_kst.astimezone(timezone.utc)
    end_utc = end_kst.astimezone(timezone.utc)

    wau_start_utc = (start_kst - timedelta(days=6)).astimezone(timezone.utc)
    mau_start_utc = (start_kst - timedelta(days=29)).astimezone(timezone.utc)

    # DAU/WAU/MAU (chat)
    def _active_users_stmt(start_dt, end_dt):
        return (
            select(func.count(func.distinct(ChatRoom.user_id)))
            .select_from(ChatRoom)
            .join(ChatMessage, ChatMessage.chat_room_id == ChatRoom.id)
            .where(ChatMessage.sender_type == "user")
            .where(ChatMessage.created_at >= start_dt)
            .where(ChatMessage.created_at < end_dt)
        )

    dau_chat = int((await db.execute(_active_users_stmt(start_utc, end_utc))).scalar() or 0)
    wau_chat = int((await db.execute(_active_users_stmt(wau_start_utc, end_utc))).scalar() or 0)
    mau_chat = int((await db.execute(_active_users_stmt(mau_start_utc, end_utc))).scalar() or 0)

    # user messages (today)
    msg_stmt = (
        select(func.count(ChatMessage.id))
        .select_from(ChatRoom)
        .join(ChatMessage, ChatMessage.chat_room_id == ChatRoom.id)
        .where(ChatMessage.sender_type == "user")
        .where(ChatMessage.created_at >= start_utc)
        .where(ChatMessage.created_at < end_utc)
    )
    user_messages = int((await db.execute(msg_stmt)).scalar() or 0)

    # new users (today)
    new_users_stmt = (
        select(func.count(User.id))
        .where(User.created_at >= start_utc)
        .where(User.created_at < end_utc)
    )
    new_users = int((await db.execute(new_users_stmt)).scalar() or 0)

    return {
        "day": d,
        "timezone": "Asia/Seoul",
        "dau_chat": dau_chat,
        "wau_chat": wau_chat,
        "mau_chat": mau_chat,
        "new_users": new_users,
        "user_messages": user_messages,
    }


@router.post("/traffic/page-event")
async def track_page_event(
    payload: PageTrafficEventIn,
    request: Request,
    current_user: Optional[User] = Depends(get_current_user_optional),  # type: ignore
):
    """
    SPA 페이지 트래픽(page_view/page_exit) 이벤트 수집.

    - 이탈(page_exit)은 `pagehide/beforeunload` 기반이므로 "사이트 이탈"에 가깝다.
    - 관리자(운영) 트래픽은 집계에서 제외한다.
    """
    try:
        if current_user is not None and getattr(current_user, "is_admin", False):
            return {"ok": True, "ignored": True, "reason": "admin"}
    except Exception:
        pass

    ev = (payload.event or "").strip().lower()
    if ev not in _TRACKABLE_EVENTS:
        return {"ok": True, "ignored": True, "reason": "unknown_event"}

    path_norm = _normalize_client_path(payload.path or "")
    now_kst = datetime.now(_KST)
    d = now_kst.strftime("%Y%m%d")

    is_page_event = ev in _PAGE_EVENTS

    kind = ""
    counter_key = ""
    paths_set_key = ""
    dur_sum_key = ""
    if is_page_event:
        if ev == "page_view":
            kind = "view"
        elif ev == "page_leave":
            kind = "leave"
        else:
            kind = "exit"

        counter_key = f"metrics:page:{kind}:{d}:{path_norm}"
        paths_set_key = f"metrics:page:paths:{d}"
        dur_sum_key = f"metrics:page:{kind}_dur_sum:{d}:{path_norm}" if kind in ("leave", "exit") else ""

    ttl_sec = 60 * 60 * 24 * 120  # 120d

    try:
        from app.core.database import redis_client

        event_counter_key = f"metrics:event:{ev}:{d}"
        await redis_client.incr(event_counter_key)
        try:
            await redis_client.expire(event_counter_key, ttl_sec)
        except Exception:
            pass

        if is_page_event:
            await redis_client.sadd(paths_set_key, path_norm)
            await redis_client.incr(counter_key)

            if kind in ("leave", "exit"):
                try:
                    dur = int(payload.duration_ms or 0)
                except Exception:
                    dur = 0
                if dur > 0:
                    await redis_client.incrby(dur_sum_key, dur)

        # best-effort TTL(과도한 메모리 증가 방지)
        if is_page_event:
            try:
                await redis_client.expire(paths_set_key, ttl_sec)
                await redis_client.expire(counter_key, ttl_sec)
                if kind in ("leave", "exit") and dur_sum_key:
                    await redis_client.expire(dur_sum_key, ttl_sec)
            except Exception:
                pass

    except Exception as e:
        try:
            logger.warning(f"[metrics.page] track failed (ignored): {e}")
        except Exception:
            pass

    # --- HLL UV (경로별 + 글로벌) ---
    visitor_id = ""
    if payload.user_id:
        visitor_id = f"u:{payload.user_id}"
    elif payload.client_id:
        visitor_id = f"c:{payload.client_id}"

    if visitor_id and ev == "page_view":
        try:
            from app.core.database import redis_client as _rc
            hll_key = f"metrics:page:uv:{d}:{path_norm}"
            hll_global_key = f"metrics:page:uv_global:{d}"
            await _rc.pfadd(hll_key, visitor_id)
            await _rc.pfadd(hll_global_key, visitor_id)
            try:
                await _rc.expire(hll_key, ttl_sec)
                await _rc.expire(hll_global_key, ttl_sec)
            except Exception:
                pass
        except Exception:
            pass

    # --- AB 테스트 Redis 카운터 (best-effort) ---
    meta_str = (payload.meta or "")[:500].strip() or None
    if meta_str and is_page_event:
        try:
            meta_obj = json.loads(meta_str) if meta_str else {}
            if isinstance(meta_obj, dict):
                from app.core.database import redis_client as _rc2
                for mk, mv in meta_obj.items():
                    if str(mk).startswith("ab_") and mv:
                        ab_key = f"metrics:ab:{mk}:{mv}:{d}:{kind}"
                        await _rc2.incr(ab_key)
                        try:
                            await _rc2.expire(ab_key, ttl_sec)
                        except Exception:
                            pass
        except Exception:
            pass

    # --- DB 저장: 로그인 유저만 (best-effort) ---
    if payload.user_id:
        try:
            uid = _uuid_mod.UUID(payload.user_id)
            async with AsyncSessionLocal() as _db:
                _db.add(UserActivityLog(
                    user_id=uid,
                    path=path_norm,
                    path_raw=(payload.path or "")[:1000],
                    page_group=_classify_page_group(path_norm),
                    event=ev,
                    duration_ms=int(payload.duration_ms or 0) or None,
                    session_id=(payload.session_id or "")[:100] or None,
                    client_id=(payload.client_id or "")[:100] or None,
                    meta=meta_str,
                ))
                await _db.commit()
        except Exception:
            pass

    return {"ok": True, "day": d, "path": path_norm, "event": ev}


@router.get("/traffic/page-exits")
async def page_exit_summary(
    day: Optional[str] = Query(None, description="YYYYMMDD (KST), 기본: 오늘"),
    top_n: int = Query(50, ge=1, le=500, description="상위 N개 경로"),
    include_admin: bool = Query(False, description="관리자(/cms) 트래픽 포함 여부"),
    current_user: User = Depends(get_current_user),
):
    """일별 '이탈 페이지' 집계(관리자 전용)."""
    _ensure_admin(current_user)

    now_kst = datetime.now(_KST)
    d = _parse_day_yyyymmdd(day or "") or now_kst.strftime("%Y%m%d")

    try:
        from app.core.database import redis_client

        paths_set_key = f"metrics:page:paths:{d}"
        raw_paths = await redis_client.smembers(paths_set_key) or set()
        paths: List[str] = []
        for it in raw_paths:
            try:
                s = it.decode("utf-8") if isinstance(it, (bytes, bytearray)) else str(it)
                s = s.strip()
                if s:
                    paths.append(s)
            except Exception:
                continue

        # 방어: 키 폭주 시 상위 집계만 보고 싶어도 전체를 다 당기면 느리다.
        # - 다만 정규화된 경로라 개수가 크지 않다고 가정(운영 초기).
        view_keys = [f"metrics:page:view:{d}:{p}" for p in paths]
        leave_keys = [f"metrics:page:leave:{d}:{p}" for p in paths]
        exit_keys = [f"metrics:page:exit:{d}:{p}" for p in paths]
        leave_dur_keys = [f"metrics:page:leave_dur_sum:{d}:{p}" for p in paths]
        exit_dur_keys = [f"metrics:page:exit_dur_sum:{d}:{p}" for p in paths]

        views_raw = await redis_client.mget(view_keys) if view_keys else []
        leaves_raw = await redis_client.mget(leave_keys) if leave_keys else []
        exits_raw = await redis_client.mget(exit_keys) if exit_keys else []
        leave_durs_raw = await redis_client.mget(leave_dur_keys) if leave_dur_keys else []
        exit_durs_raw = await redis_client.mget(exit_dur_keys) if exit_dur_keys else []

        # --- UV: 경로별 HLL PFCOUNT ---
        uv_keys = [f"metrics:page:uv:{d}:{p}" for p in paths]
        uv_raw = []
        for uk in uv_keys:
            try:
                uv_raw.append(int(await redis_client.pfcount(uk) or 0))
            except Exception:
                uv_raw.append(0)

        total_unique_visitors = 0
        try:
            total_unique_visitors = int(await redis_client.pfcount(f"metrics:page:uv_global:{d}") or 0)
        except Exception:
            pass

        rows_all = []
        total_exits = 0
        total_leaves = 0
        total_views = 0
        total_departures = 0

        for idx, p in enumerate(paths):
            def _to_int(v) -> int:
                if v is None:
                    return 0
                try:
                    s = v.decode("utf-8") if isinstance(v, (bytes, bytearray)) else str(v)
                    return int(float(s))
                except Exception:
                    return 0

            vcnt = _to_int(views_raw[idx] if idx < len(views_raw) else None)
            lcnt = _to_int(leaves_raw[idx] if idx < len(leaves_raw) else None)
            ecnt = _to_int(exits_raw[idx] if idx < len(exits_raw) else None)
            lsum = _to_int(leave_durs_raw[idx] if idx < len(leave_durs_raw) else None)
            esum = _to_int(exit_durs_raw[idx] if idx < len(exit_durs_raw) else None)

            if vcnt <= 0 and lcnt <= 0 and ecnt <= 0:
                continue

            group = _classify_page_group(p)
            if (not include_admin) and group == "admin":
                continue

            total_exits += max(0, int(ecnt))
            total_leaves += max(0, int(lcnt))
            total_views += max(0, int(vcnt))

            departures = max(0, int(ecnt)) + max(0, int(lcnt))
            total_departures += max(0, int(departures))

            avg_exit_ms = None
            try:
                if ecnt > 0 and esum > 0:
                    avg_exit_ms = round(float(esum) / float(ecnt), 2)
            except Exception:
                avg_exit_ms = None

            avg_leave_ms = None
            try:
                if lcnt > 0 and lsum > 0:
                    avg_leave_ms = round(float(lsum) / float(lcnt), 2)
            except Exception:
                avg_leave_ms = None

            exit_rate = None
            try:
                if vcnt > 0 and ecnt >= 0:
                    exit_rate = round(float(ecnt) / float(vcnt), 6)
            except Exception:
                exit_rate = None

            leave_rate = None
            try:
                if vcnt > 0 and lcnt >= 0:
                    leave_rate = round(float(lcnt) / float(vcnt), 6)
            except Exception:
                leave_rate = None

            departure_rate = None
            try:
                if vcnt > 0 and departures >= 0:
                    departure_rate = round(float(departures) / float(vcnt), 6)
            except Exception:
                departure_rate = None

            uv = int(uv_raw[idx]) if idx < len(uv_raw) else 0

            rows_all.append(
                {
                    "path": p,
                    "group": group,
                    "group_label": _page_group_label(group),
                    "views": int(vcnt),
                    "leaves": int(lcnt),
                    "exits": int(ecnt),
                    "exit_rate": exit_rate,
                    "leave_rate": leave_rate,
                    "departures": int(departures),
                    "departure_rate": departure_rate,
                    "avg_exit_duration_ms": avg_exit_ms,
                    "avg_leave_duration_ms": avg_leave_ms,
                    "unique_visitors": uv,
                }
            )

        rows_all.sort(key=lambda r: (int(r.get("departures") or 0), int(r.get("views") or 0)), reverse=True)

        # exit share 계산(상위 N에만 넣되, 분모는 전체 exits)
        out_rows = []
        for r in rows_all[: int(top_n)]:
            exit_share = None
            departure_share = None
            try:
                if total_exits > 0:
                    exit_share = round(float(r.get("exits") or 0) / float(total_exits), 6)
            except Exception:
                exit_share = None
            try:
                if total_departures > 0:
                    departure_share = round(float(r.get("departures") or 0) / float(total_departures), 6)
            except Exception:
                departure_share = None
            rr = dict(r)
            rr["exit_share"] = exit_share
            rr["departure_share"] = departure_share
            out_rows.append(rr)

        # group summary
        gmap: Dict[str, Dict[str, Any]] = {}
        for r in rows_all:
            g = str(r.get("group") or "other")
            cur = gmap.get(g) or {"group": g, "group_label": _page_group_label(g), "views": 0, "leaves": 0, "exits": 0, "departures": 0, "unique_visitors": 0}
            cur["views"] = int(cur.get("views") or 0) + int(r.get("views") or 0)
            cur["leaves"] = int(cur.get("leaves") or 0) + int(r.get("leaves") or 0)
            cur["exits"] = int(cur.get("exits") or 0) + int(r.get("exits") or 0)
            cur["departures"] = int(cur.get("departures") or 0) + int(r.get("departures") or 0)
            cur["unique_visitors"] = int(cur.get("unique_visitors") or 0) + int(r.get("unique_visitors") or 0)
            gmap[g] = cur

        groups = list(gmap.values())
        for g in groups:
            try:
                vcnt = int(g.get("views") or 0)
                lcnt = int(g.get("leaves") or 0)
                ecnt = int(g.get("exits") or 0)
                dcnt = int(g.get("departures") or 0)
                g["exit_rate"] = round(float(ecnt) / float(vcnt), 6) if vcnt > 0 else None
                g["leave_rate"] = round(float(lcnt) / float(vcnt), 6) if vcnt > 0 else None
                g["departure_rate"] = round(float(dcnt) / float(vcnt), 6) if vcnt > 0 else None
            except Exception:
                g["exit_rate"] = None
                g["leave_rate"] = None
                g["departure_rate"] = None
            try:
                g["exit_share"] = round(float(g.get("exits") or 0) / float(total_exits), 6) if total_exits > 0 else None
            except Exception:
                g["exit_share"] = None
            try:
                g["departure_share"] = round(float(g.get("departures") or 0) / float(total_departures), 6) if total_departures > 0 else None
            except Exception:
                g["departure_share"] = None

        groups.sort(key=lambda x: int(x.get("departures") or 0), reverse=True)

        return {
            "day": d,
            "timezone": "Asia/Seoul",
            "total_views": int(total_views),
            "total_leaves": int(total_leaves),
            "total_exits": int(total_exits),
            "total_departures": int(total_departures),
            "total_unique_visitors": int(total_unique_visitors),
            "groups": groups,
            "rows": out_rows,
        }

    except Exception as e:
        try:
            logger.warning(f"[metrics.page] read failed: {e}")
        except Exception:
            pass
        return {
            "day": d,
            "timezone": "Asia/Seoul",
            "total_views": 0,
            "total_leaves": 0,
            "total_exits": 0,
            "total_departures": 0,
            "total_unique_visitors": 0,
            "groups": [],
            "rows": [],
            "error": str(e),
        }


@router.get("/traffic/auth-modals")
async def auth_modal_summary(
    day: Optional[str] = Query(None, description="YYYYMMDD (KST), 기본: 오늘"),
    current_user: User = Depends(get_current_user),
):
    """로그인/회원가입 모달 오픈 집계(관리자 전용)."""
    _ensure_admin(current_user)

    now_kst = datetime.now(_KST)
    d = _parse_day_yyyymmdd(day or "") or now_kst.strftime("%Y%m%d")

    try:
        from app.core.database import redis_client
        login_key = f"metrics:event:modal_login_open:{d}"
        register_key = f"metrics:event:modal_register_open:{d}"
        vals = await redis_client.mget([login_key, register_key])

        def _to_int(v) -> int:
            if v is None:
                return 0
            try:
                s = v.decode("utf-8") if isinstance(v, (bytes, bytearray)) else str(v)
                return int(float(s))
            except Exception:
                return 0

        login_opens = _to_int(vals[0] if vals and len(vals) > 0 else None)
        register_opens = _to_int(vals[1] if vals and len(vals) > 1 else None)
        return {
            "day": d,
            "login_modal_opens": int(login_opens),
            "register_modal_opens": int(register_opens),
            "total_modal_opens": int(login_opens + register_opens),
        }
    except Exception as e:
        try:
            logger.warning(f"[metrics.auth-modal] read failed: {e}")
        except Exception:
            pass
        return {
            "day": d,
            "login_modal_opens": 0,
            "register_modal_opens": 0,
            "total_modal_opens": 0,
            "error": str(e),
        }


@router.get("/user-activity/search")
async def search_user_activity(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    query: Optional[str] = Query(None, description="이메일/닉네임 검색"),
    user_id: Optional[str] = Query(None, description="유저 ID(UUID)"),
    page_group: Optional[str] = Query(None, description="페이지 그룹 필터"),
    start_date: Optional[str] = Query(None, description="시작일 YYYYMMDD(KST)"),
    end_date: Optional[str] = Query(None, description="종료일 YYYYMMDD(KST)"),
    page: int = Query(1, ge=1, description="페이지 번호"),
    page_size: int = Query(50, ge=1, le=200, description="페이지 크기"),
):
    """유저 활동 로그 검색(관리자 전용)."""
    _ensure_admin(current_user)

    stmt = (
        select(
            UserActivityLog.id,
            UserActivityLog.user_id,
            User.email,
            User.username,
            UserActivityLog.path,
            UserActivityLog.path_raw,
            UserActivityLog.page_group,
            UserActivityLog.event,
            UserActivityLog.duration_ms,
            UserActivityLog.created_at,
        )
        .join(User, User.id == UserActivityLog.user_id, isouter=True)
    )

    count_stmt = (
        select(func.count(UserActivityLog.id))
        .join(User, User.id == UserActivityLog.user_id, isouter=True)
    )

    # 필터
    if query:
        q = f"%{query.strip()}%"
        flt = or_(User.email.ilike(q), User.username.ilike(q))
        stmt = stmt.where(flt)
        count_stmt = count_stmt.where(flt)

    if user_id:
        try:
            uid = _uuid_mod.UUID(user_id)
            stmt = stmt.where(UserActivityLog.user_id == uid)
            count_stmt = count_stmt.where(UserActivityLog.user_id == uid)
        except Exception:
            pass

    if page_group:
        stmt = stmt.where(UserActivityLog.page_group == page_group.strip())
        count_stmt = count_stmt.where(UserActivityLog.page_group == page_group.strip())

    if start_date:
        sd = _parse_day_yyyymmdd(start_date)
        if sd:
            try:
                y, m, dd = int(sd[:4]), int(sd[4:6]), int(sd[6:8])
                start_dt = datetime(y, m, dd, 0, 0, 0, tzinfo=_KST).astimezone(timezone.utc)
                stmt = stmt.where(UserActivityLog.created_at >= start_dt)
                count_stmt = count_stmt.where(UserActivityLog.created_at >= start_dt)
            except Exception:
                pass

    if end_date:
        ed = _parse_day_yyyymmdd(end_date)
        if ed:
            try:
                y, m, dd = int(ed[:4]), int(ed[4:6]), int(ed[6:8])
                end_dt = datetime(y, m, dd + 1, 0, 0, 0, tzinfo=_KST).astimezone(timezone.utc)
                stmt = stmt.where(UserActivityLog.created_at < end_dt)
                count_stmt = count_stmt.where(UserActivityLog.created_at < end_dt)
            except Exception:
                pass

    total = int((await db.execute(count_stmt)).scalar() or 0)

    stmt = stmt.order_by(UserActivityLog.created_at.desc())
    stmt = stmt.offset((page - 1) * page_size).limit(page_size)

    rows = (await db.execute(stmt)).all()

    items = []
    for r in rows:
        items.append({
            "id": str(r.id) if r.id else None,
            "user_id": str(r.user_id) if r.user_id else None,
            "email": r.email,
            "username": r.username,
            "path": r.path,
            "path_raw": r.path_raw,
            "page_group": r.page_group,
            "event": r.event,
            "duration_ms": r.duration_ms,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        })

    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.get("/ab-summary")
async def ab_summary(
    test: str = Query(..., description="AB 테스트 키 (예: ab_home)"),
    day: Optional[str] = Query(None, description="YYYYMMDD (KST), 기본: 오늘"),
    current_user: User = Depends(get_current_user),
):
    """AB 테스트 변형별 PV/이탈 요약(관리자 전용)."""
    _ensure_admin(current_user)

    now_kst = datetime.now(_KST)
    d = _parse_day_yyyymmdd(day or "") or now_kst.strftime("%Y%m%d")
    test_key = (test or "").strip()
    if not test_key.startswith("ab_"):
        test_key = f"ab_{test_key}"

    try:
        from app.core.database import redis_client

        # ab_home:A:20260216:view, ab_home:A:20260216:exit, ...
        # 변형 목록을 scan으로 찾기
        prefix = f"metrics:ab:{test_key}:"
        variants: Dict[str, Dict[str, int]] = {}
        cursor = 0
        while True:
            cursor, keys = await redis_client.scan(cursor, match=f"{prefix}*:{d}:*", count=200)
            for k in keys:
                key_str = k.decode("utf-8") if isinstance(k, (bytes, bytearray)) else str(k)
                # metrics:ab:ab_home:A:20260216:view
                parts = key_str.split(":")
                # parts: [metrics, ab, ab_home, A, 20260216, view]
                if len(parts) < 6:
                    continue
                variant = parts[3]
                kind = parts[5]
                val = await redis_client.get(key_str)
                cnt = int(val or 0) if val else 0
                if variant not in variants:
                    variants[variant] = {"view": 0, "leave": 0, "exit": 0}
                if kind in variants[variant]:
                    variants[variant][kind] = cnt
            if cursor == 0:
                break

        rows = []
        for v, counts in sorted(variants.items()):
            pv = counts.get("view", 0)
            exits = counts.get("exit", 0)
            leaves = counts.get("leave", 0)
            departures = exits + leaves
            rows.append({
                "variant": v,
                "views": pv,
                "exits": exits,
                "leaves": leaves,
                "departures": departures,
                "exit_rate": round(exits / pv, 6) if pv > 0 else None,
                "departure_rate": round(departures / pv, 6) if pv > 0 else None,
            })

        return {"test": test_key, "day": d, "timezone": "Asia/Seoul", "variants": rows}

    except Exception as e:
        logger.warning(f"[metrics.ab] summary failed: {e}")
        return {"test": test_key, "day": d, "timezone": "Asia/Seoul", "variants": [], "error": str(e)}


@router.get("/traffic/revisit-summary")
async def revisit_summary(
    day: Optional[str] = Query(None, description="YYYYMMDD (KST), 기본: 오늘"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """로그인 유저 기준 신규/재유입 요약(관리자 전용)."""
    _ensure_admin(current_user)

    now_kst = datetime.now(_KST)
    d = _parse_day_yyyymmdd(day or "") or now_kst.strftime("%Y%m%d")

    try:
        y, m, dd = int(d[:4]), int(d[4:6]), int(d[6:8])
        day_start = datetime(y, m, dd, 0, 0, 0, tzinfo=_KST).astimezone(timezone.utc)
        day_end = day_start + timedelta(days=1)
    except Exception:
        raise HTTPException(status_code=400, detail="날짜 형식이 올바르지 않습니다.")

    try:
        # 1) 해당일 활동한 로그인 유저 (page_view 기준)
        today_stmt = (
            select(UserActivityLog.user_id)
            .where(UserActivityLog.created_at >= day_start)
            .where(UserActivityLog.created_at < day_end)
            .where(UserActivityLog.event == "page_view")
            .distinct()
        )
        today_rows = (await db.execute(today_stmt)).scalars().all()
        today_ids = list(today_rows)
        total_active = len(today_ids)

        if total_active == 0:
            return {
                "day": d, "timezone": "Asia/Seoul",
                "total_active": 0, "returning": 0, "new": 0,
                "returning_rate": None,
            }

        # 2) 그 중 해당일 이전에도 page_view 기록이 있는 유저 = 재유입
        returning_stmt = (
            select(UserActivityLog.user_id)
            .where(UserActivityLog.user_id.in_(today_ids))
            .where(UserActivityLog.created_at < day_start)
            .where(UserActivityLog.event == "page_view")
            .distinct()
        )
        returning_rows = (await db.execute(returning_stmt)).scalars().all()
        returning_count = len(returning_rows)
        new_count = total_active - returning_count

        return {
            "day": d, "timezone": "Asia/Seoul",
            "total_active": total_active,
            "returning": returning_count,
            "new": new_count,
            "returning_rate": round(returning_count / total_active, 4) if total_active > 0 else None,
        }

    except Exception as e:
        logger.warning(f"[metrics.revisit] summary failed: {e}")
        return {
            "day": d, "timezone": "Asia/Seoul",
            "total_active": 0, "returning": 0, "new": 0,
            "returning_rate": None, "error": str(e),
        }
