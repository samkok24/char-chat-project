"""
CMS 설정 API (홈 배너/홈 구좌)

문제:
- 기존 CMS는 프론트 로컬스토리지 기반이라 "관리자 PC 브라우저에서만" 반영되는 구조였다.
- 운영에서는 모든 유저에게 동일하게 반영되어야 하므로 서버/DB에 저장해야 한다.

해결(최소 수정):
- SiteConfig(key/value JSON) 테이블을 SSOT로 사용한다.
- 공개 GET: 유저(비로그인 포함)가 홈에서 설정을 읽을 수 있다.
- 관리자 PUT: 관리자만 설정을 저장할 수 있다.

방어적:
- DB 조회 실패 시에도 홈이 죽지 않도록 기본값을 반환한다(로그는 남김).
- 저장 실패 시 500을 반환하고 rollback 한다.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List
import logging
from datetime import datetime, timezone
import uuid

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.site_config import SiteConfig
from app.schemas.cms import HomeBanner, HomeSlot

logger = logging.getLogger(__name__)

router = APIRouter()

# SSOT keys
CONFIG_KEY_HOME_BANNERS = "homeBanners"
CONFIG_KEY_HOME_SLOTS = "homeSlots"


def _ensure_admin(user: User) -> None:
    """관리자 권한 방어 체크"""
    if not getattr(user, "is_admin", False):
        raise HTTPException(status_code=403, detail="관리자만 사용할 수 있습니다.")


def _now_iso() -> str:
    """프론트(new Date().toISOString())와 호환되는 UTC ISO 문자열을 만든다."""
    try:
        return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    except Exception:
        return ""


def _default_home_banners() -> List[dict]:
    """프론트 DEFAULT_HOME_BANNERS와 동일한 기본 배너(운영 안전용)"""
    now = _now_iso()
    return [
        {
            "id": "banner_notice",
            "title": "공지사항",
            "imageUrl": "",
            "mobileImageUrl": "",
            "linkUrl": "/notices",
            "openInNewTab": False,
            "enabled": True,
            "startAt": None,
            "endAt": None,
            "createdAt": now,
            "updatedAt": now,
        }
    ]


def _default_home_slots() -> List[dict]:
    """프론트 DEFAULT_HOME_SLOTS와 동일한 기본 구좌(운영 안전용)"""
    now = _now_iso()
    return [
        {
            "id": "slot_top_origchat",
            "title": "지금 대화가 활발한 원작 캐릭터",
            "enabled": True,
            "slotType": "system",
            "contentPicks": [],
            "contentSortMode": "metric",
            "startAt": None,
            "endAt": None,
            "createdAt": now,
            "updatedAt": now,
        },
        {
            "id": "slot_trending_characters",
            "title": "지금 대화가 활발한 캐릭터",
            "enabled": True,
            "slotType": "system",
            "contentPicks": [],
            "contentSortMode": "metric",
            "startAt": None,
            "endAt": None,
            "createdAt": now,
            "updatedAt": now,
        },
        {
            "id": "slot_top_stories",
            "title": "지금 인기 있는 원작 웹소설",
            "enabled": True,
            "slotType": "system",
            "contentPicks": [],
            "contentSortMode": "metric",
            "startAt": None,
            "endAt": None,
            "createdAt": now,
            "updatedAt": now,
        },
        {
            "id": "slot_recommended_characters",
            "title": "챕터8이 추천하는 캐릭터",
            "enabled": True,
            "slotType": "system",
            "contentPicks": [],
            "contentSortMode": "metric",
            "startAt": None,
            "endAt": None,
            "createdAt": now,
            "updatedAt": now,
        },
        {
            "id": "slot_daily_tag_characters",
            "title": "일상을 캐릭터와 같이 공유해보세요",
            "enabled": True,
            "slotType": "system",
            "contentPicks": [],
            "contentSortMode": "metric",
            "startAt": None,
            "endAt": None,
            "createdAt": now,
            "updatedAt": now,
        },
    ]


async def _get_config(db: AsyncSession, key: str) -> SiteConfig | None:
    """key로 SiteConfig를 조회한다(없으면 None)."""
    stmt = select(SiteConfig).where(SiteConfig.key == key)
    res = await db.execute(stmt)
    return res.scalar_one_or_none()


def _normalize_banners(items: List[HomeBanner]) -> List[dict]:
    """
    배너 저장값을 서버에서 멱등/안전하게 정리한다.

    의도:
    - 프론트의 로컬스토리지 구현은 '빈 배열'을 저장하면 기본값으로 되돌리는 동작이 있어,
      서버도 동일하게 최소 1개(기본 배너)를 유지해 일관성을 맞춘다.
    - updatedAt은 저장 시점으로 갱신하여 캐시 버스터로 사용 가능하게 한다.
    """
    now = _now_iso()
    out: List[dict] = []
    for b in (items or []):
        d = b.model_dump()
        if not d.get("id"):
            d["id"] = f"bn_{uuid.uuid4().hex[:12]}"
        if not d.get("createdAt"):
            d["createdAt"] = now
        d["updatedAt"] = now
        out.append(d)
    if len(out) == 0:
        return _default_home_banners()
    return out


def _normalize_slots(items: List[HomeSlot]) -> List[dict]:
    """
    구좌 저장값을 서버에서 멱등/안전하게 정리한다.

    포인트:
    - updatedAt을 저장 시점으로 갱신한다.
    - slotType/contentSortMode는 프론트가 추가 규칙(기본 구좌 자동 포함 등)을 가지고 있어
      서버에서는 최소한의 정리만 하고, 렌더링 규칙은 프론트에서 유지한다(최소 수정).
    """
    now = _now_iso()
    out: List[dict] = []
    for s in (items or []):
        d = s.model_dump()
        if not d.get("id"):
            d["id"] = f"slot_{uuid.uuid4().hex[:12]}"
        if not d.get("createdAt"):
            d["createdAt"] = now
        d["updatedAt"] = now
        out.append(d)
    if len(out) == 0:
        return _default_home_slots()
    return out


@router.get("/home/banners", response_model=List[HomeBanner], summary="홈 배너 설정(공개)")
async def get_home_banners(db: AsyncSession = Depends(get_db)):
    """홈 배너 설정 조회(유저/비로그인 공개)."""
    try:
        cfg = await _get_config(db, CONFIG_KEY_HOME_BANNERS)
        value = cfg.value if cfg else None
        if isinstance(value, list):
            # 스키마로 한번 더 방어적으로 검증/정리
            normalized = _normalize_banners([HomeBanner.model_validate(x) for x in value])
            return normalized
        return _default_home_banners()
    except Exception as e:
        try:
            logger.exception(f"[cms] get_home_banners failed: {e}")
        except Exception:
            print(f"[cms] get_home_banners failed: {e}")
        # 방어: 홈이 죽지 않도록 기본값 반환
        return _default_home_banners()


@router.get("/home/slots", response_model=List[HomeSlot], summary="홈 구좌 설정(공개)")
async def get_home_slots(db: AsyncSession = Depends(get_db)):
    """홈 구좌 설정 조회(유저/비로그인 공개)."""
    try:
        cfg = await _get_config(db, CONFIG_KEY_HOME_SLOTS)
        value = cfg.value if cfg else None
        if isinstance(value, list):
            normalized = _normalize_slots([HomeSlot.model_validate(x) for x in value])
            return normalized
        return _default_home_slots()
    except Exception as e:
        try:
            logger.exception(f"[cms] get_home_slots failed: {e}")
        except Exception:
            print(f"[cms] get_home_slots failed: {e}")
        return _default_home_slots()


@router.put("/home/banners", response_model=List[HomeBanner], summary="홈 배너 설정 저장(관리자)")
async def put_home_banners(
    payload: List[HomeBanner],
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """홈 배너 설정 저장(관리자 전용)."""
    _ensure_admin(current_user)
    try:
        normalized = _normalize_banners(payload)
        cfg = await _get_config(db, CONFIG_KEY_HOME_BANNERS)
        if cfg:
            cfg.value = normalized
        else:
            cfg = SiteConfig(key=CONFIG_KEY_HOME_BANNERS, value=normalized)
            db.add(cfg)
        await db.commit()
        return normalized
    except Exception as e:
        await db.rollback()
        try:
            logger.exception(f"[cms] put_home_banners failed: {e}")
        except Exception:
            print(f"[cms] put_home_banners failed: {e}")
        raise HTTPException(status_code=500, detail="홈 배너 저장에 실패했습니다.")


@router.put("/home/slots", response_model=List[HomeSlot], summary="홈 구좌 설정 저장(관리자)")
async def put_home_slots(
    payload: List[HomeSlot],
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """홈 구좌 설정 저장(관리자 전용)."""
    _ensure_admin(current_user)
    try:
        normalized = _normalize_slots(payload)
        cfg = await _get_config(db, CONFIG_KEY_HOME_SLOTS)
        if cfg:
            cfg.value = normalized
        else:
            cfg = SiteConfig(key=CONFIG_KEY_HOME_SLOTS, value=normalized)
            db.add(cfg)
        await db.commit()
        return normalized
    except Exception as e:
        await db.rollback()
        try:
            logger.exception(f"[cms] put_home_slots failed: {e}")
        except Exception:
            print(f"[cms] put_home_slots failed: {e}")
        raise HTTPException(status_code=500, detail="홈 구좌 저장에 실패했습니다.")


