"""
SEO utilities

- robots.txt: allow crawling for public pages, block private/admin areas
- sitemap.xml: best-effort dynamic sitemap for public resources (characters/stories/notices)

Note:
- This project is an SPA, so server-side meta is mostly shared. Still, sitemap/robots help discovery/indexing.
"""

from __future__ import annotations

from fastapi import APIRouter, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional
import os
from datetime import datetime, timezone

from app.core.config import settings
from app.core.database import get_db
from app.models.character import Character
from app.models.story import Story
from app.models.notice import Notice
from fastapi import Depends, Request


router = APIRouter(tags=["🔎 SEO"])


def _base_url(request: Optional[Request] = None) -> str:
    """
    Prefer explicit FRONTEND_BASE_URL (stable), fallback to request origin.
    """
    raw = (os.getenv("FRONTEND_BASE_URL") or settings.FRONTEND_BASE_URL or "").strip()
    if raw:
        return raw.rstrip("/")
    try:
        if request is not None:
            # request.base_url ends with '/'
            return str(request.base_url).rstrip("/")
    except Exception:
        pass
    return "http://localhost:5173"


@router.get("/robots.txt")
async def robots_txt(request: Request):
    """
    robots.txt (best-effort)
    - Allow crawling generally
    - Disallow private/auth-required pages
    """
    base = _base_url(request)
    lines = [
        "User-agent: *",
        "Allow: /",
        "",
        "# Private/Admin/Authenticated areas",
        "Disallow: /cms",
        "Disallow: /metrics",
        "Disallow: /ws/",
        "Disallow: /login",
        "Disallow: /verify",
        "Disallow: /forgot-password",
        "Disallow: /reset-password",
        "Disallow: /profile",
        "Disallow: /favorites",
        "Disallow: /history",
        "Disallow: /ruby",
        "Disallow: /characters/create",
        "Disallow: /characters/*/edit",
        "Disallow: /maintenance",
        "",
        f"Sitemap: {base}/sitemap.xml",
        "",
    ]
    return Response(content="\n".join(lines), media_type="text/plain; charset=utf-8")


def _xml_escape(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def _fmt_lastmod(dt: Optional[datetime]) -> Optional[str]:
    if not dt:
        return None
    try:
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except Exception:
        return None


def _url_xml(loc: str, lastmod: Optional[str] = None) -> str:
    loc_esc = _xml_escape(loc)
    if lastmod:
        return f"<url><loc>{loc_esc}</loc><lastmod>{_xml_escape(lastmod)}</lastmod></url>"
    return f"<url><loc>{loc_esc}</loc></url>"


@router.get("/sitemap.xml")
async def sitemap_xml(request: Request, db: AsyncSession = Depends(get_db)):
    """
    sitemap.xml (dynamic, best-effort)

    Includes:
    - Public static routes: /dashboard, /faq, /notices, /contact
    - Public character detail pages (limited)
    - Public story detail pages (limited)
    - Published notices (limited)
    """
    base = _base_url(request)

    urls: List[str] = []
    urls.append(_url_xml(f"{base}/dashboard"))
    urls.append(_url_xml(f"{base}/faq"))
    urls.append(_url_xml(f"{base}/notices"))
    urls.append(_url_xml(f"{base}/contact"))

    # Limits to keep sitemap reasonably sized in early stage.
    # (If you need full coverage, implement sitemap index + multiple sitemaps.)
    CHAR_LIMIT = 500
    STORY_LIMIT = 500
    NOTICE_LIMIT = 500

    try:
        q = (
            select(Character.id, Character.updated_at)
            .where(Character.is_public.is_(True))
            .where(Character.is_active.is_(True))
            .order_by(Character.updated_at.desc())
            .limit(CHAR_LIMIT)
        )
        rows = (await db.execute(q)).all()
        for cid, updated_at in rows:
            lastmod = _fmt_lastmod(updated_at)
            urls.append(_url_xml(f"{base}/characters/{cid}", lastmod))
    except Exception:
        pass

    try:
        q = (
            select(Story.id, Story.updated_at)
            .where(Story.is_public.is_(True))
            .order_by(Story.updated_at.desc())
            .limit(STORY_LIMIT)
        )
        rows = (await db.execute(q)).all()
        for sid, updated_at in rows:
            lastmod = _fmt_lastmod(updated_at)
            urls.append(_url_xml(f"{base}/stories/{sid}", lastmod))
    except Exception:
        pass

    try:
        q = (
            select(Notice.id, Notice.updated_at)
            .where(Notice.is_published.is_(True))
            .order_by(Notice.updated_at.desc())
            .limit(NOTICE_LIMIT)
        )
        rows = (await db.execute(q)).all()
        for nid, updated_at in rows:
            lastmod = _fmt_lastmod(updated_at)
            urls.append(_url_xml(f"{base}/notices/{nid}", lastmod))
    except Exception:
        pass

    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
        + "".join(urls)
        + "</urlset>"
    )
    return Response(content=xml, media_type="application/xml; charset=utf-8")

