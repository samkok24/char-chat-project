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

from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text
from sqlalchemy.orm import selectinload
from typing import List
import logging
from datetime import datetime, timezone
import uuid
import json

from app.core.database import get_db
from app.core.config import settings
from app.core.security import get_current_user
from app.models.user import User
from app.models.site_config import SiteConfig
from app.models.character import Character
from app.models.story import Story
from app.schemas.cms import HomeBanner, HomeSlot, TagDisplayConfig, HomePopup, HomePopupItem, HomePopupConfig

logger = logging.getLogger(__name__)

router = APIRouter()

# SSOT keys
CONFIG_KEY_HOME_BANNERS = "homeBanners"
CONFIG_KEY_HOME_SLOTS = "homeSlots"
CONFIG_KEY_CHARACTER_TAG_DISPLAY = "characterTagDisplay"
CONFIG_KEY_HOME_POPUPS = "homePopups"


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


def _safe_exc(e: Exception) -> str:
    """예외 메시지를 방어적으로 문자열로 변환(민감정보 노출 최소화)."""
    try:
        s = str(e or "")
    except Exception:
        return ""
    try:
        s = s.replace("\n", " ").replace("\r", " ").strip()
    except Exception:
        pass
    try:
        if len(s) > 300:
            s = s[:300] + "..."
    except Exception:
        pass
    return s


def _is_sqlite() -> bool:
    try:
        return bool(getattr(settings, "DATABASE_URL", "") or "").startswith("sqlite")
    except Exception:
        return False


async def _ensure_site_configs_table_raw(db: AsyncSession) -> None:
    """site_configs 테이블이 없거나 일부 컬럼이 달라도 저장/조회가 가능하도록 최소 스키마를 보장한다."""
    try:
        if _is_sqlite():
            # SQLite: id(TEXT PK) + key(UNIQUE) + value(TEXT/JSON) + timestamps
            await db.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS site_configs (
                      id TEXT PRIMARY KEY,
                      key TEXT NOT NULL UNIQUE,
                      value TEXT NOT NULL,
                      created_at TEXT DEFAULT (datetime('now')),
                      updated_at TEXT DEFAULT (datetime('now'))
                    )
                    """
                )
            )
        else:
            # Postgres: 모델(SiteConfig) 스키마에 맞춘다.
            # - id: UUID PK (앱에서 값 넣음)
            # - key: UNIQUE (upsert 타겟)
            await db.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS site_configs (
                      id UUID PRIMARY KEY,
                      key VARCHAR(100) NOT NULL UNIQUE,
                      value JSONB NOT NULL,
                      created_at TIMESTAMPTZ DEFAULT now(),
                      updated_at TIMESTAMPTZ DEFAULT now()
                    )
                    """
                )
            )
            # 기존 테이블이 다른 스키마로 생성된 경우(컬럼 누락 등) 최소한의 컬럼을 추가한다.
            # - 이 ALTER들은 "이미 있으면" 무시된다.
            try:
                await db.execute(text("ALTER TABLE site_configs ADD COLUMN IF NOT EXISTS id UUID"))
            except Exception:
                pass
            try:
                await db.execute(text("ALTER TABLE site_configs ADD COLUMN IF NOT EXISTS key VARCHAR(100)"))
            except Exception:
                pass
            try:
                await db.execute(text("ALTER TABLE site_configs ADD COLUMN IF NOT EXISTS value JSONB"))
            except Exception:
                pass
            try:
                await db.execute(text("ALTER TABLE site_configs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now()"))
            except Exception:
                pass
            try:
                await db.execute(text("ALTER TABLE site_configs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now()"))
            except Exception:
                pass
            # key upsert를 위해 key에 유니크 인덱스를 보장(이미 있으면 생성 안 함)
            try:
                await db.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ux_site_configs_key ON site_configs (key)"))
            except Exception:
                pass
        await db.commit()
    except Exception:
        try:
            await db.rollback()
        except Exception:
            pass


async def _get_site_configs_column_types_pg(db: AsyncSession) -> dict:
    """Postgres에서 site_configs 컬럼 타입을 조회한다."""
    try:
        res = await db.execute(
            text(
                """
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'site_configs'
                """
            )
        )
        rows = res.fetchall() if res else []
        return {str(r[0]): str(r[1]) for r in (rows or []) if r and len(r) >= 2}
    except Exception:
        return {}


async def _get_site_configs_columns_sqlite(db: AsyncSession) -> set:
    """SQLite에서 site_configs 컬럼 목록을 조회한다."""
    try:
        res = await db.execute(text("PRAGMA table_info(site_configs)"))
        rows = res.fetchall() if res else []
        return {str(r[1]) for r in (rows or []) if r and len(r) >= 2}
    except Exception:
        return set()


async def _get_site_configs_schema_info(db: AsyncSession) -> dict:
    """DB별로 site_configs 컬럼 존재/타입 정보를 반환한다."""
    if _is_sqlite():
        cols = await _get_site_configs_columns_sqlite(db)
        return {"cols": cols, "types": {}}
    types = await _get_site_configs_column_types_pg(db)
    return {"cols": set(types.keys()), "types": types}


async def _get_config_value_raw(db: AsyncSession, key: str):
    """ORM이 실패해도 동작하도록 raw SQL로 value를 읽는다."""
    try:
        if _is_sqlite():
            res = await db.execute(text("SELECT value FROM site_configs WHERE key = :k LIMIT 1"), {"k": key})
            row = res.first() if res else None
            if not row:
                return None
            v = row[0]
            if isinstance(v, (dict, list)):
                return v
            if isinstance(v, str) and v.strip():
                try:
                    return json.loads(v)
                except Exception:
                    return None
            return None

        # Postgres: value::text로 받아 JSON 파싱(스키마/ORM 불일치 대비)
        res = await db.execute(text("SELECT value::text AS v FROM site_configs WHERE key = :k LIMIT 1"), {"k": key})
        row = res.first() if res else None
        if not row:
            return None
        v = row[0]
        if isinstance(v, str) and v.strip():
            try:
                return json.loads(v)
            except Exception:
                return None
        return None
    except Exception:
        return None


async def _upsert_config_raw(db: AsyncSession, key: str, value_obj) -> None:
    """ORM이 깨지는 배포 DB 스키마 차이에도 저장이 되도록 raw SQL로 upsert 한다."""
    await _ensure_site_configs_table_raw(db)
    info = await _get_site_configs_schema_info(db)
    cols = info.get("cols") or set()
    types = info.get("types") or {}

    has_id = ("id" in cols)
    id_type = str(types.get("id") or "").lower()

    try:
        val_json = json.dumps(value_obj, ensure_ascii=False)
    except Exception:
        val_json = "[]"

    if _is_sqlite():
        if has_id:
            stmt = text(
                """
                INSERT INTO site_configs (id, key, value)
                VALUES (:id, :k, :v)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
                """
            )
            params = {"id": str(uuid.uuid4()), "k": key, "v": val_json}
        else:
            stmt = text(
                """
                INSERT INTO site_configs (key, value)
                VALUES (:k, :v)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
                """
            )
            params = {"k": key, "v": val_json}
        await db.execute(stmt, params)
        await db.commit()
        return

    # Postgres
    value_type = str(types.get("value") or "").lower()
    if not value_type:
        value_type = "jsonb"
    if value_type == "json":
        value_expr = "CAST(:v AS JSON)"
    elif value_type == "jsonb":
        value_expr = "CAST(:v AS JSONB)"
    else:
        value_expr = ":v"

    if has_id:
        # id가 uuid면 캐스팅해서 삽입(기존 테이블 스키마 호환)
        if id_type == "uuid":
            id_expr = "CAST(:id AS UUID)"
        else:
            id_expr = ":id"
        stmt = text(
            f"""
            INSERT INTO site_configs (id, key, value)
            VALUES ({id_expr}, :k, {value_expr})
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
            """
        )
        params = {"id": str(uuid.uuid4()), "k": key, "v": val_json}
    else:
        stmt = text(
            f"""
            INSERT INTO site_configs (key, value)
            VALUES (:k, {value_expr})
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
            """
        )
        params = {"k": key, "v": val_json}

    await db.execute(stmt, params)
    await db.commit()


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
            "displayOn": "all",
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


def _default_character_tag_display() -> dict:
    """캐릭터 탭/태그 선택 모달의 태그 노출/순서 설정 기본값."""
    return {
        "prioritySlugs": [],
        "hiddenSlugs": [],
        "updatedAt": None,
    }


def _default_home_popups() -> dict:
    """홈 팝업 기본값(운영 안전용): 비활성 0개 + 최대 1개 노출."""
    return {"maxDisplayCount": 1, "items": []}


def _normalize_home_popups(cfg: HomePopupConfig) -> dict:
    """
    홈 팝업 저장값을 서버에서 멱등/안전하게 정리한다.

    의도:
    - items 내부 id/타임스탬프(updatedAt/createdAt)를 보정한다.
    - maxDisplayCount는 0~10으로 제한한다(과도한 팝업 방지).
    """
    now = _now_iso()
    try:
        max_cnt = int(getattr(cfg, "maxDisplayCount", 1) or 0)
    except Exception:
        max_cnt = 1
    if max_cnt < 0:
        max_cnt = 0
    if max_cnt > 10:
        max_cnt = 10

    out_items = []
    for p in (cfg.items or []):
        d = p.model_dump()
        pid = str(d.get("id") or "").strip()
        if not pid:
            pid = f"pop_{uuid.uuid4().hex[:12]}"
        d["id"] = pid
        if not d.get("createdAt"):
            d["createdAt"] = now
        d["updatedAt"] = now

        # 방어: dismissDays 보정(0~365)
        try:
            dd = int(d.get("dismissDays", 1) or 0)
        except Exception:
            dd = 1
        if dd < 0:
            dd = 0
        if dd > 365:
            dd = 365
        d["dismissDays"] = dd

        out_items.append(d)

    return {"maxDisplayCount": max_cnt, "items": out_items}


def _normalize_character_tag_display(item: TagDisplayConfig) -> dict:
    """저장값을 서버에서 멱등/안전하게 정리한다(타임스탬프 포함)."""
    now = _now_iso()
    d = item.model_dump()
    d["updatedAt"] = now
    return d


async def _get_config(db: AsyncSession, key: str) -> SiteConfig | None:
    """key로 SiteConfig를 조회한다(없으면 None)."""
    stmt = select(SiteConfig).where(SiteConfig.key == key)
    res = await db.execute(stmt)
    return res.scalar_one_or_none()


def _normalize_banners(items: List[HomeBanner], *, touch_updated: bool = True) -> List[dict]:
    """
    배너 저장값을 서버에서 멱등/안전하게 정리한다.

    의도:
    - 프론트의 로컬스토리지 구현은 '빈 배열'을 저장하면 기본값으로 되돌리는 동작이 있어,
      서버도 동일하게 최소 1개(기본 배너)를 유지해 일관성을 맞춘다.
    - touch_updated=True 인 경우에만 updatedAt을 현재 시각으로 갱신한다.
      (PUT 저장 경로에서만 사용)
    - 조회(GET) 경로에서는 기존 updatedAt을 보존해, 불필요한 캐시 무효화를 막는다.
    """
    now = _now_iso()
    out: List[dict] = []
    for b in (items or []):
        d = b.model_dump()
        if not d.get("id"):
            d["id"] = f"bn_{uuid.uuid4().hex[:12]}"
        if not d.get("createdAt"):
            d["createdAt"] = now
        if touch_updated:
            d["updatedAt"] = now
        elif not d.get("updatedAt"):
            d["updatedAt"] = d.get("createdAt") or now
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
    seen_ids: set[str] = set()

    # 1) 입력 payload 정규화(중복 id 방어 포함)
    for s in (items or []):
        d = s.model_dump()
        if not d.get("id"):
            d["id"] = f"slot_{uuid.uuid4().hex[:12]}"
        sid = str(d.get("id") or "").strip()
        if not sid or sid in seen_ids:
            continue
        seen_ids.add(sid)
        if not d.get("createdAt"):
            d["createdAt"] = now
        d["updatedAt"] = now
        out.append(d)

    # 2) 시스템 기본 구좌 누락 보강(부분 저장/레이스 상황 방어)
    # - 기존 항목은 그대로 유지하고, "없는 기본 구좌"만 뒤에 추가한다.
    # - 운영 중 구좌 payload가 부분 목록으로 저장되어 홈이 텅 비는 리스크를 줄인다.
    defaults = _default_home_slots()
    for d in defaults:
        sid = str(d.get("id") or "").strip()
        if not sid or sid in seen_ids:
            continue
        nd = dict(d)
        if not nd.get("createdAt"):
            nd["createdAt"] = now
        nd["updatedAt"] = now
        out.append(nd)
        seen_ids.add(sid)

    if len(out) == 0:
        return defaults

    return out


async def _enrich_slot_character_picks(db: AsyncSession, slots: List[dict]) -> List[dict]:
    """
    커스텀 구좌 contentPicks.character.item에 최신 캐릭터 메타를 보강한다.

    목적:
    - 과거 스냅샷(태그/모드 누락)이라도 홈 첫 렌더에서 즉시 태그칩이 노출되게 한다.
    - 프론트가 상세 API 하이드레이션을 기다리며 태그가 늦게 뜨는 현상을 줄인다.
    """
    try:
        raw_slots = slots if isinstance(slots, list) else []
        if not raw_slots:
            return raw_slots

        id_map = {}
        for s in raw_slots:
            if not isinstance(s, dict):
                continue
            picks = s.get("contentPicks")
            if not isinstance(picks, list):
                continue
            for p in picks:
                if not isinstance(p, dict):
                    continue
                if str(p.get("type") or "").strip().lower() != "character":
                    continue
                item = p.get("item")
                if not isinstance(item, dict):
                    continue
                sid = str(item.get("id") or "").strip()
                if not sid or sid in id_map:
                    continue
                try:
                    id_map[sid] = uuid.UUID(sid)
                except Exception:
                    continue

        if not id_map:
            return raw_slots

        rows = await db.execute(
            select(Character)
            .options(selectinload(Character.tags))
            .where(Character.id.in_(list(id_map.values())))
        )
        characters = rows.scalars().all() if rows else []

        meta_by_id = {}
        for c in (characters or []):
            try:
                cid = str(getattr(c, "id"))
                tags_out = []
                for t in (getattr(c, "tags", None) or []):
                    v = str(getattr(t, "name", None) or getattr(t, "slug", None) or "").strip()
                    if not v or v in tags_out:
                        continue
                    tags_out.append(v)
                meta_by_id[cid] = {
                    "character_type": str(getattr(c, "character_type", "") or "").strip() or None,
                    "tags": tags_out,
                    "chat_count": int(getattr(c, "chat_count", 0) or 0),
                    "like_count": int(getattr(c, "like_count", 0) or 0),
                    "created_at": getattr(c, "created_at", None),
                    "updated_at": getattr(c, "updated_at", None),
                }
            except Exception:
                continue

        out = []
        for s in raw_slots:
            if not isinstance(s, dict):
                out.append(s)
                continue
            slot = dict(s)
            picks = slot.get("contentPicks")
            if not isinstance(picks, list):
                out.append(slot)
                continue

            next_picks = []
            for p in picks:
                if not isinstance(p, dict):
                    next_picks.append(p)
                    continue
                if str(p.get("type") or "").strip().lower() != "character":
                    next_picks.append(p)
                    continue
                item = p.get("item")
                if not isinstance(item, dict):
                    next_picks.append(p)
                    continue
                sid = str(item.get("id") or "").strip()
                meta = meta_by_id.get(sid)
                if not meta:
                    next_picks.append(p)
                    continue

                next_item = dict(item)
                ctype = str(meta.get("character_type") or "").strip()
                tags = meta.get("tags") or []
                if ctype:
                    next_item["character_type"] = ctype
                if isinstance(tags, list) and len(tags) > 0:
                    next_item["tags"] = tags
                next_item["chat_count"] = int(meta.get("chat_count", 0) or 0)
                next_item["like_count"] = int(meta.get("like_count", 0) or 0)

                created_at = meta.get("created_at")
                updated_at = meta.get("updated_at")
                if created_at:
                    try:
                        next_item["created_at"] = created_at.isoformat() if hasattr(created_at, "isoformat") else str(created_at)
                    except Exception:
                        pass
                if updated_at:
                    try:
                        next_item["updated_at"] = updated_at.isoformat() if hasattr(updated_at, "isoformat") else str(updated_at)
                    except Exception:
                        pass

                next_pick = dict(p)
                next_pick["item"] = next_item
                next_picks.append(next_pick)

            slot["contentPicks"] = next_picks
            out.append(slot)

        return out
    except Exception as e:
        try:
            logger.warning(f"[cms] slot character picks enrich skipped: {_safe_exc(e)}")
        except Exception:
            pass
        return slots


@router.get("/home/banners", response_model=List[HomeBanner], summary="홈 배너 설정(공개)")
async def get_home_banners(db: AsyncSession = Depends(get_db)):
    """홈 배너 설정 조회(유저/비로그인 공개)."""
    try:
        cfg = await _get_config(db, CONFIG_KEY_HOME_BANNERS)
        value = cfg.value if cfg else None
        if isinstance(value, list):
            # 스키마로 한번 더 방어적으로 검증/정리
            normalized = _normalize_banners([HomeBanner.model_validate(x) for x in value], touch_updated=False)
            return normalized
        return _default_home_banners()
    except Exception as e:
        # ✅ 배포 DB 스키마 불일치 등으로 ORM이 깨지는 경우 raw SQL로 폴백
        try:
            raw = await _get_config_value_raw(db, CONFIG_KEY_HOME_BANNERS)
            if isinstance(raw, list):
                normalized = _normalize_banners([HomeBanner.model_validate(x) for x in raw], touch_updated=False)
                return normalized
        except Exception:
            pass
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
            enriched = await _enrich_slot_character_picks(db, normalized)
            return enriched
        return _default_home_slots()
    except Exception as e:
        # ✅ 배포 DB 스키마 불일치 등으로 ORM이 깨지는 경우 raw SQL로 폴백
        try:
            raw = await _get_config_value_raw(db, CONFIG_KEY_HOME_SLOTS)
            if isinstance(raw, list):
                normalized = _normalize_slots([HomeSlot.model_validate(x) for x in raw])
                enriched = await _enrich_slot_character_picks(db, normalized)
                return enriched
        except Exception:
            pass
        try:
            logger.exception(f"[cms] get_home_slots failed: {e}")
        except Exception:
            print(f"[cms] get_home_slots failed: {e}")
        return _default_home_slots()


@router.get("/tags/character", response_model=TagDisplayConfig, summary="캐릭터 탭 태그 노출/순서 설정(공개)")
async def get_character_tag_display(db: AsyncSession = Depends(get_db)):
    """캐릭터 탭/태그 선택 모달에서 사용하는 태그 노출/순서 설정을 조회한다(유저/비로그인 공개)."""
    try:
        cfg = await _get_config(db, CONFIG_KEY_CHARACTER_TAG_DISPLAY)
        value = cfg.value if cfg else None
        if isinstance(value, dict):
            return TagDisplayConfig.model_validate(value)
        return TagDisplayConfig.model_validate(_default_character_tag_display())
    except Exception as e:
        # ✅ 배포 DB 스키마 불일치 등으로 ORM이 깨지는 경우 raw SQL로 폴백
        try:
            raw = await _get_config_value_raw(db, CONFIG_KEY_CHARACTER_TAG_DISPLAY)
            if isinstance(raw, dict):
                return TagDisplayConfig.model_validate(raw)
        except Exception:
            pass
        try:
            logger.exception(f"[cms] get_character_tag_display failed: {e}")
        except Exception:
            print(f"[cms] get_character_tag_display failed: {e}")
        return TagDisplayConfig.model_validate(_default_character_tag_display())


@router.get("/home/popups", response_model=HomePopupConfig, summary="홈 팝업 설정(공개)")
async def get_home_popups(db: AsyncSession = Depends(get_db)):
    """홈 팝업 설정 조회(유저/비로그인 공개)."""
    try:
        cfg = await _get_config(db, CONFIG_KEY_HOME_POPUPS)
        value = cfg.value if cfg else None
        if isinstance(value, dict):
            return HomePopupConfig.model_validate(value)
        return HomePopupConfig.model_validate(_default_home_popups())
    except Exception as e:
        # ✅ 배포 DB 스키마 불일치 등으로 ORM이 깨지는 경우 raw SQL로 폴백
        try:
            raw = await _get_config_value_raw(db, CONFIG_KEY_HOME_POPUPS)
            if isinstance(raw, dict):
                return HomePopupConfig.model_validate(raw)
        except Exception:
            pass
        try:
            logger.exception(f"[cms] get_home_popups failed: {e}")
        except Exception:
            print(f"[cms] get_home_popups failed: {e}")
        return HomePopupConfig.model_validate(_default_home_popups())


@router.put("/home/popups", response_model=HomePopupConfig, summary="홈 팝업 설정 저장(관리자)")
async def put_home_popups(
    payload: HomePopupConfig,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """홈 팝업 설정 저장(관리자 전용)."""
    _ensure_admin(current_user)
    try:
        normalized = _normalize_home_popups(payload)
        cfg = await _get_config(db, CONFIG_KEY_HOME_POPUPS)
        if cfg:
            cfg.value = normalized
        else:
            cfg = SiteConfig(key=CONFIG_KEY_HOME_POPUPS, value=normalized)
            db.add(cfg)
        await db.commit()
        return HomePopupConfig.model_validate(normalized)
    except Exception as e:
        try:
            await db.rollback()
        except Exception:
            pass
        try:
            logger.exception(f"[cms] put_home_popups failed: {e}")
        except Exception:
            print(f"[cms] put_home_popups failed: {e}")
        # ✅ 배포 DB 스키마/권한/컬럼 불일치로 ORM 저장이 실패할 수 있어 raw SQL 폴백을 1회 시도한다.
        try:
            normalized = _normalize_home_popups(payload)
            await _upsert_config_raw(db, CONFIG_KEY_HOME_POPUPS, normalized)
            return HomePopupConfig.model_validate(normalized)
        except Exception as e2:
            try:
                logger.exception(f"[cms] put_home_popups raw fallback failed: {e2}")
            except Exception:
                print(f"[cms] put_home_popups raw fallback failed: {e2}")
            raise HTTPException(
                status_code=500,
                detail=f"홈 팝업 저장에 실패했습니다. ({_safe_exc(e2) or _safe_exc(e)})",
            )


# ===== 하위 호환(단일 팝업 엔드포인트 유지) =====
@router.get("/home/popup", response_model=HomePopup, summary="홈 팝업 설정(공개) - legacy")
async def get_home_popup(db: AsyncSession = Depends(get_db)):
    """레거시 단일 팝업 조회. 신규 구현은 /home/popups 사용."""
    try:
        cfg = await _get_config(db, CONFIG_KEY_HOME_POPUPS)
        value = cfg.value if cfg else None
        if isinstance(value, dict):
            items = value.get("items") if isinstance(value.get("items"), list) else []
            if items and isinstance(items[0], dict):
                return HomePopup.model_validate(items[0])
        return HomePopup.model_validate({"enabled": False})
    except Exception:
        return HomePopup.model_validate({"enabled": False})


@router.put("/home/popup", response_model=HomePopup, summary="홈 팝업 설정 저장(관리자) - legacy")
async def put_home_popup(
    payload: HomePopup,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """레거시 단일 팝업 저장. 신규 구현은 /home/popups 사용."""
    _ensure_admin(current_user)
    cfg = HomePopupConfig(maxDisplayCount=1, items=[HomePopupItem.model_validate(payload.model_dump())])
    normalized = _normalize_home_popups(cfg)
    try:
        row = await _get_config(db, CONFIG_KEY_HOME_POPUPS)
        if row:
            row.value = normalized
        else:
            row = SiteConfig(key=CONFIG_KEY_HOME_POPUPS, value=normalized)
            db.add(row)
        await db.commit()
        try:
            items = normalized.get("items") if isinstance(normalized, dict) else []
            if items and isinstance(items[0], dict):
                return HomePopup.model_validate(items[0])
        except Exception:
            pass
        return HomePopup.model_validate({"enabled": False})
    except Exception as e:
        try:
            await db.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"홈 팝업 저장에 실패했습니다. ({_safe_exc(e)})")


@router.put("/tags/character", response_model=TagDisplayConfig, summary="캐릭터 탭 태그 노출/순서 설정 저장(관리자)")
async def put_character_tag_display(
    payload: TagDisplayConfig,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """캐릭터 탭/태그 선택 모달에서 사용하는 태그 노출/순서 설정을 저장한다(관리자 전용)."""
    _ensure_admin(current_user)
    try:
        normalized = _normalize_character_tag_display(payload)
        cfg = await _get_config(db, CONFIG_KEY_CHARACTER_TAG_DISPLAY)
        if cfg:
            cfg.value = normalized
        else:
            cfg = SiteConfig(key=CONFIG_KEY_CHARACTER_TAG_DISPLAY, value=normalized)
            db.add(cfg)
        await db.commit()
        return TagDisplayConfig.model_validate(normalized)
    except Exception as e:
        try:
            await db.rollback()
        except Exception:
            pass
        try:
            logger.exception(f"[cms] put_character_tag_display failed: {e}")
        except Exception:
            print(f"[cms] put_character_tag_display failed: {e}")
        # ✅ 배포 DB 스키마/권한/컬럼 불일치로 ORM 저장이 실패할 수 있어 raw SQL 폴백을 1회 시도한다.
        try:
            normalized = _normalize_character_tag_display(payload)
            await _upsert_config_raw(db, CONFIG_KEY_CHARACTER_TAG_DISPLAY, normalized)
            return TagDisplayConfig.model_validate(normalized)
        except Exception as e2:
            try:
                logger.exception(f"[cms] put_character_tag_display raw fallback failed: {e2}")
            except Exception:
                print(f"[cms] put_character_tag_display raw fallback failed: {e2}")
            raise HTTPException(
                status_code=500,
                detail=f"태그 설정 저장에 실패했습니다. ({_safe_exc(e2) or _safe_exc(e)})",
            )


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
        try:
            await db.rollback()
        except Exception:
            pass
        try:
            logger.exception(f"[cms] put_home_banners failed: {e}")
        except Exception:
            print(f"[cms] put_home_banners failed: {e}")
        # ✅ 배포 DB 스키마/권한/컬럼 불일치로 ORM 저장이 실패할 수 있어 raw SQL 폴백을 1회 시도한다.
        try:
            normalized = _normalize_banners(payload)
            await _upsert_config_raw(db, CONFIG_KEY_HOME_BANNERS, normalized)
            return normalized
        except Exception as e2:
            try:
                logger.exception(f"[cms] put_home_banners raw fallback failed: {e2}")
            except Exception:
                print(f"[cms] put_home_banners raw fallback failed: {e2}")
            raise HTTPException(
                status_code=500,
                detail=f"홈 배너 저장에 실패했습니다. ({_safe_exc(e2) or _safe_exc(e)})",
            )


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
        normalized = await _enrich_slot_character_picks(db, normalized)
        cfg = await _get_config(db, CONFIG_KEY_HOME_SLOTS)
        if cfg:
            cfg.value = normalized
        else:
            cfg = SiteConfig(key=CONFIG_KEY_HOME_SLOTS, value=normalized)
            db.add(cfg)
        await db.commit()
        return normalized
    except Exception as e:
        try:
            await db.rollback()
        except Exception:
            pass
        try:
            logger.exception(f"[cms] put_home_slots failed: {e}")
        except Exception:
            print(f"[cms] put_home_slots failed: {e}")
        # ✅ 배포 DB 스키마/권한/컬럼 불일치로 ORM 저장이 실패할 수 있어 raw SQL 폴백을 1회 시도한다.
        try:
            normalized = _normalize_slots(payload)
            normalized = await _enrich_slot_character_picks(db, normalized)
            await _upsert_config_raw(db, CONFIG_KEY_HOME_SLOTS, normalized)
            return normalized
        except Exception as e2:
            try:
                logger.exception(f"[cms] put_home_slots raw fallback failed: {e2}")
            except Exception:
                print(f"[cms] put_home_slots raw fallback failed: {e2}")
            raise HTTPException(
                status_code=500,
                detail=f"홈 구좌 저장에 실패했습니다. ({_safe_exc(e2) or _safe_exc(e)})",
            )


# ============================================================
# 콘텐츠 관리 (캐릭터/웹소설/원작챗 공개·비공개 일괄 관리)
# ============================================================

CONTENT_PAGE_SIZE_DEFAULT = 20
CONTENT_PAGE_SIZE_MAX = 100


@router.get("/contents")
async def get_cms_contents(
    type: str = "all",
    search: str = "",
    page: int = 1,
    page_size: int = CONTENT_PAGE_SIZE_DEFAULT,
    is_public: str = "all",
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """관리자용: 캐릭터/웹소설/원작챗 목록 조회 (검색·필터·페이지네이션)"""
    _ensure_admin(current_user)

    page = max(1, page)
    page_size = min(max(1, page_size), CONTENT_PAGE_SIZE_MAX)
    offset = (page - 1) * page_size
    search_term = str(search or "").strip()
    type_filter = str(type or "all").strip().lower()

    items = []
    total = 0

    try:
        if type_filter == "all":
            items, total = await _query_contents_all_unified(db, search_term, is_public, offset, page_size)
        elif type_filter == "character":
            items, total = await _query_characters(db, search_term, is_public, offset, page_size)
        elif type_filter == "webnovel":
            items, total = await _query_stories(db, search_term, is_public, False, offset, page_size)
        elif type_filter == "origchat":
            items, total = await _query_stories(db, search_term, is_public, True, offset, page_size)
        else:
            raise HTTPException(status_code=400, detail="type은 all|character|webnovel|origchat 중 하나여야 합니다.")

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[cms] get_cms_contents ORM failed: {e}")
        # raw SQL 폴백
        try:
            items, total = await _query_contents_raw(db, type_filter, search_term, is_public, offset, page_size)
        except Exception as e2:
            logger.exception(f"[cms] get_cms_contents raw fallback failed: {e2}")
            raise HTTPException(status_code=500, detail=f"콘텐츠 목록 조회 실패 ({_safe_exc(e2) or _safe_exc(e)})")

    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.patch("/contents/{content_type}/{content_id}/toggle-public")
async def toggle_content_public(
    content_type: str,
    content_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """관리자용: 캐릭터/스토리 공개·비공개 토글"""
    _ensure_admin(current_user)

    content_type = str(content_type or "").strip().lower()
    if content_type not in ("character", "story"):
        raise HTTPException(status_code=400, detail="content_type은 character 또는 story만 가능합니다.")

    try:
        uid = uuid.UUID(str(content_id))
    except (ValueError, AttributeError):
        raise HTTPException(status_code=400, detail="유효하지 않은 ID입니다.")

    try:
        if content_type == "character":
            row = (await db.execute(select(Character).where(Character.id == uid))).scalar_one_or_none()
            if not row:
                raise HTTPException(status_code=404, detail="캐릭터를 찾을 수 없습니다.")
            new_val = not bool(row.is_public)
            row.is_public = new_val
            await db.commit()
            return {"id": str(row.id), "type": "character", "name": row.name, "is_public": new_val}
        else:
            row = (await db.execute(select(Story).where(Story.id == uid))).scalar_one_or_none()
            if not row:
                raise HTTPException(status_code=404, detail="스토리를 찾을 수 없습니다.")
            new_val = not bool(row.is_public)
            row.is_public = new_val
            await db.commit()
            stype = "origchat" if getattr(row, "is_origchat", False) else "webnovel"
            return {"id": str(row.id), "type": stype, "name": row.title, "is_public": new_val}
    except HTTPException:
        raise
    except Exception as e:
        try:
            await db.rollback()
        except Exception:
            pass
        logger.exception(f"[cms] toggle_content_public failed: {e}")
        raise HTTPException(status_code=500, detail=f"공개 상태 변경 실패 ({_safe_exc(e)})")


@router.patch("/contents/{content_type}/{content_id}/public")
async def set_content_public(
    content_type: str,
    content_id: str,
    payload: dict = Body(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """관리자용: 캐릭터/스토리 공개 상태를 명시값으로 설정한다(결정적)."""
    _ensure_admin(current_user)

    content_type = str(content_type or "").strip().lower()
    if content_type not in ("character", "story"):
        raise HTTPException(status_code=400, detail="content_type은 character 또는 story만 가능합니다.")

    try:
        uid = uuid.UUID(str(content_id))
    except (ValueError, AttributeError):
        raise HTTPException(status_code=400, detail="유효하지 않은 ID입니다.")

    is_public_raw = None
    if isinstance(payload, dict):
        is_public_raw = payload.get("is_public", None)

    if isinstance(is_public_raw, bool):
        target_public = is_public_raw
    elif isinstance(is_public_raw, str):
        lv = is_public_raw.strip().lower()
        if lv in ("true", "1", "yes", "y", "on"):
            target_public = True
        elif lv in ("false", "0", "no", "n", "off"):
            target_public = False
        else:
            raise HTTPException(status_code=400, detail="is_public은 boolean 이어야 합니다.")
    else:
        raise HTTPException(status_code=400, detail="is_public은 boolean 이어야 합니다.")

    try:
        if content_type == "character":
            row = (await db.execute(select(Character).where(Character.id == uid))).scalar_one_or_none()
            if not row:
                raise HTTPException(status_code=404, detail="캐릭터를 찾을 수 없습니다.")
            row.is_public = bool(target_public)
            await db.commit()
            return {"id": str(row.id), "type": "character", "name": row.name, "is_public": bool(row.is_public)}
        else:
            row = (await db.execute(select(Story).where(Story.id == uid))).scalar_one_or_none()
            if not row:
                raise HTTPException(status_code=404, detail="스토리를 찾을 수 없습니다.")
            row.is_public = bool(target_public)
            await db.commit()
            stype = "origchat" if getattr(row, "is_origchat", False) else "webnovel"
            return {"id": str(row.id), "type": stype, "name": row.title, "is_public": bool(row.is_public)}
    except HTTPException:
        raise
    except Exception as e:
        try:
            await db.rollback()
        except Exception:
            pass
        logger.exception(f"[cms] set_content_public failed: {e}")
        raise HTTPException(status_code=500, detail=f"공개 상태 변경 실패 ({_safe_exc(e)})")


# --- 콘텐츠 조회 헬퍼 ---

def _public_filter_clause(column, is_public_str: str):
    """is_public 필터 조건 반환 (None이면 조건 없음)"""
    val = str(is_public_str or "all").strip().lower()
    if val == "true":
        return column == True  # noqa: E712
    elif val == "false":
        return column == False  # noqa: E712
    return None


async def _query_characters(db, search_term, is_public, offset, limit):
    """캐릭터 목록 조회 (원작챗 파생 제외)"""
    from sqlalchemy import func as sqlfunc

    base = select(Character).where(Character.origin_story_id == None)  # noqa: E711
    count_q = select(sqlfunc.count()).select_from(Character).where(Character.origin_story_id == None)  # noqa: E711

    if search_term:
        base = base.where(Character.name.ilike(f"%{search_term}%"))
        count_q = count_q.where(Character.name.ilike(f"%{search_term}%"))

    pub_clause = _public_filter_clause(Character.is_public, is_public)
    if pub_clause is not None:
        base = base.where(pub_clause)
        count_q = count_q.where(pub_clause)

    total = (await db.execute(count_q)).scalar() or 0

    rows = (await db.execute(base.order_by(Character.created_at.desc()).offset(offset).limit(limit))).scalars().all()

    items = []
    for r in rows:
        creator_name = ""
        try:
            if r.creator:
                creator_name = r.creator.username or r.creator.email or ""
        except Exception:
            pass
        items.append({
            "id": str(r.id),
            "type": "character",
            "name": r.name or "",
            "creator_name": creator_name,
            "is_public": bool(r.is_public),
            "created_at": r.created_at.isoformat() if r.created_at else "",
        })
    return items, total


async def _query_stories(db, search_term, is_public, is_origchat: bool, offset, limit):
    """스토리(웹소설/원작챗) 목록 조회"""
    from sqlalchemy import func as sqlfunc

    base = select(Story).where(Story.is_origchat == is_origchat)
    count_q = select(sqlfunc.count()).select_from(Story).where(Story.is_origchat == is_origchat)

    if search_term:
        base = base.where(Story.title.ilike(f"%{search_term}%"))
        count_q = count_q.where(Story.title.ilike(f"%{search_term}%"))

    pub_clause = _public_filter_clause(Story.is_public, is_public)
    if pub_clause is not None:
        base = base.where(pub_clause)
        count_q = count_q.where(pub_clause)

    total = (await db.execute(count_q)).scalar() or 0

    rows = (await db.execute(base.order_by(Story.created_at.desc()).offset(offset).limit(limit))).scalars().all()

    stype = "origchat" if is_origchat else "webnovel"
    items = []
    for r in rows:
        creator_name = ""
        try:
            if r.creator:
                creator_name = r.creator.username or r.creator.email or ""
        except Exception:
            pass
        items.append({
            "id": str(r.id),
            "type": stype,
            "name": r.title or "",
            "creator_name": creator_name,
            "is_public": bool(r.is_public),
            "created_at": r.created_at.isoformat() if r.created_at else "",
        })
    return items, total


async def _query_contents_raw(db, type_filter, search_term, is_public, offset, limit):
    """ORM 실패 시 raw SQL 폴백"""
    is_sqlite = _is_sqlite()
    items = []
    total = 0

    queries = []
    if type_filter in ("all", "character"):
        queries.append(("character", "characters", "name", "origin_story_id IS NULL", None))
    if type_filter in ("all", "webnovel"):
        queries.append(("webnovel", "stories", "title", "1=1", False))
    if type_filter in ("all", "origchat"):
        queries.append(("origchat", "stories", "title", "1=1", True))

    for content_type, table, name_col, extra_where, origchat_val in queries:
        where_parts = [extra_where]
        params = {}

        if origchat_val is not None:
            where_parts.append(f"is_origchat = :origchat_{content_type}")
            params[f"origchat_{content_type}"] = origchat_val

        if search_term:
            op = "LIKE" if is_sqlite else "ILIKE"
            where_parts.append(f"{name_col} {op} :search_{content_type}")
            params[f"search_{content_type}"] = f"%{search_term}%"

        pub_val = str(is_public or "all").strip().lower()
        if pub_val == "true":
            where_parts.append("is_public = true")
        elif pub_val == "false":
            where_parts.append("is_public = false")

        where_clause = " AND ".join(where_parts)

        count_sql = f"SELECT COUNT(*) FROM {table} WHERE {where_clause}"
        cnt = (await db.execute(text(count_sql), params)).scalar() or 0
        total += cnt

        if type_filter != "all":
            data_sql = f"SELECT id, {name_col} AS name, is_public, created_at FROM {table} WHERE {where_clause} ORDER BY created_at DESC LIMIT :lim OFFSET :off"
            params["lim"] = limit
            params["off"] = offset
        else:
            data_sql = f"SELECT id, {name_col} AS name, is_public, created_at FROM {table} WHERE {where_clause} ORDER BY created_at DESC LIMIT 500"

        rows = (await db.execute(text(data_sql), params)).fetchall()
        for r in rows:
            items.append({
                "id": str(r[0]),
                "type": content_type,
                "name": str(r[1] or ""),
                "creator_name": "",
                "is_public": bool(r[2]),
                "created_at": str(r[3] or ""),
            })

    if type_filter == "all":
        items.sort(key=lambda x: x.get("created_at") or "", reverse=True)
        items = items[offset:offset + limit]

    return items, total


async def _query_contents_all_unified(db: AsyncSession, search_term: str, is_public: str, offset: int, limit: int):
    """type=all 전용 통합 조회: DB 레벨에서 total/정렬/페이지네이션을 일치시킨다."""
    where_char = ["c.origin_story_id IS NULL"]
    where_story = ["1=1"]
    params = {"lim": int(limit), "off": int(offset)}

    if search_term:
        params["search"] = f"%{search_term}%"
        where_char.append("c.name ILIKE :search")
        where_story.append("s.title ILIKE :search")

    pub_val = str(is_public or "all").strip().lower()
    if pub_val in ("true", "false"):
        params["is_public_filter"] = (pub_val == "true")
        where_char.append("c.is_public = :is_public_filter")
        where_story.append("s.is_public = :is_public_filter")

    where_char_sql = " AND ".join(where_char)
    where_story_sql = " AND ".join(where_story)

    cte_sql = f"""
    WITH all_contents AS (
      SELECT
        c.id AS id,
        'character' AS type,
        c.name AS name,
        COALESCE(u.username, u.email, '') AS creator_name,
        c.is_public AS is_public,
        c.created_at AS created_at
      FROM characters c
      LEFT JOIN users u ON u.id = c.creator_id
      WHERE {where_char_sql}
      UNION ALL
      SELECT
        s.id AS id,
        CASE WHEN s.is_origchat THEN 'origchat' ELSE 'webnovel' END AS type,
        s.title AS name,
        COALESCE(u.username, u.email, '') AS creator_name,
        s.is_public AS is_public,
        s.created_at AS created_at
      FROM stories s
      LEFT JOIN users u ON u.id = s.creator_id
      WHERE {where_story_sql}
    )
    """

    count_sql = f"{cte_sql} SELECT COUNT(*) FROM all_contents"
    total = int((await db.execute(text(count_sql), params)).scalar() or 0)

    data_sql = f"""
    {cte_sql}
    SELECT id, type, name, creator_name, is_public, created_at
    FROM all_contents
    ORDER BY created_at DESC
    LIMIT :lim OFFSET :off
    """
    rows = (await db.execute(text(data_sql), params)).mappings().all()
    items = []
    for r in rows:
        created = r.get("created_at")
        try:
            created_str = created.isoformat() if created else ""
        except Exception:
            created_str = str(created or "")
        items.append({
            "id": str(r.get("id") or ""),
            "type": str(r.get("type") or ""),
            "name": str(r.get("name") or ""),
            "creator_name": str(r.get("creator_name") or ""),
            "is_public": bool(r.get("is_public")),
            "created_at": created_str,
        })
    return items, total
