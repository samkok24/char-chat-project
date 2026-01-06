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
from sqlalchemy import select, text
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
        # ✅ 배포 DB 스키마 불일치 등으로 ORM이 깨지는 경우 raw SQL로 폴백
        try:
            raw = await _get_config_value_raw(db, CONFIG_KEY_HOME_BANNERS)
            if isinstance(raw, list):
                normalized = _normalize_banners([HomeBanner.model_validate(x) for x in raw])
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
            return normalized
        return _default_home_slots()
    except Exception as e:
        # ✅ 배포 DB 스키마 불일치 등으로 ORM이 깨지는 경우 raw SQL로 폴백
        try:
            raw = await _get_config_value_raw(db, CONFIG_KEY_HOME_SLOTS)
            if isinstance(raw, list):
                normalized = _normalize_slots([HomeSlot.model_validate(x) for x in raw])
                return normalized
        except Exception:
            pass
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


