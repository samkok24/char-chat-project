"""
SEO utilities

- robots.txt: allow crawling for public pages, block private/admin areas
- sitemap.xml: best-effort dynamic sitemap for public resources (characters/stories/notices)

Note:
- This project is an SPA, so server-side meta is mostly shared. Still, sitemap/robots help discovery/indexing.
"""

from __future__ import annotations

from fastapi import APIRouter, Response, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional
import os
from datetime import datetime, timezone
import re
import html
import json
from uuid import UUID

from app.core.config import settings
from app.core.database import get_db
from app.models.character import Character
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
        "Disallow: /",
        "",
        "# Index target pages",
        "Allow: /dashboard",
        "Allow: /characters",
        "Allow: /webnovels",
        "Allow: /agent",
        "",
        "# Exclude detail/list pages not targeted for indexing",
        "Disallow: /characters/",
        "Disallow: /stories/",
        "Disallow: /notices",
        "Disallow: /faq",
        "Disallow: /contact",
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


def _abs_url(base: str, raw: Optional[str]) -> Optional[str]:
    s = str(raw or "").strip()
    if not s:
        return None
    if s.startswith("http://") or s.startswith("https://"):
        return s
    if s.startswith("//"):
        try:
            scheme = base.split("://", 1)[0]
            return f"{scheme}:{s}"
        except Exception:
            return f"https:{s}"
    if s.startswith("/"):
        return f"{base}{s}"
    return f"{base}/{s}"


def _clean_text(raw: Optional[str], max_len: int = 180) -> str:
    s = str(raw or "")
    s = re.sub(r"<[^>]*>", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    if len(s) > max_len:
        s = s[: max_len - 1].rstrip() + "…"
    return s


def _pick_character_image(base: str, character: Character) -> str:
    avatar = _abs_url(base, getattr(character, "avatar_url", None))
    if avatar and not str(avatar).startswith("cover:"):
        return avatar
    imgs = getattr(character, "image_descriptions", None)
    if isinstance(imgs, list):
        for it in imgs:
            if not isinstance(it, dict):
                continue
            u = _abs_url(base, it.get("url"))
            if u and not str(u).startswith("cover:"):
                return u
    return f"{base}/brand-logo.png"


@router.get("/sitemap.xml")
async def sitemap_xml(request: Request):
    """
    sitemap.xml (dynamic, best-effort)

    Includes:
    - Recommended tab
    - Character tab
    - Webnovel tab
    - Story agent
    """
    base = _base_url(request)

    urls: List[str] = []
    urls.append(_url_xml(f"{base}/dashboard"))
    urls.append(_url_xml(f"{base}/characters"))
    urls.append(_url_xml(f"{base}/webnovels"))
    urls.append(_url_xml(f"{base}/agent"))

    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
        + "".join(urls)
        + "</urlset>"
    )
    return Response(content=xml, media_type="application/xml; charset=utf-8")


@router.get("/seo/share/characters/{character_id}")
async def character_share_meta_html(
    character_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    공유봇(카톡/트위터/디스코드 등) 전용 캐릭터 OG 메타 HTML.

    - 실제 사용자 브라우저는 SPA(`/characters/{id}`)를 사용한다.
    - 공유봇 요청일 때만 Nginx가 이 엔드포인트로 프록시해 동적 OG를 제공한다.
    """
    base = _base_url(request)
    canonical = f"{base}/characters/{character_id}"

    row = (
        await db.execute(
            select(Character).where(Character.id == character_id)
        )
    ).scalars().first()

    if not row or not bool(getattr(row, "is_public", False)) or not bool(getattr(row, "is_active", False)):
        # 비공개/비활성/미존재 캐릭터는 정보 노출하지 않음
        raise HTTPException(status_code=404, detail="Character not found")

    title = f"{_clean_text(getattr(row, 'name', ''), 80) or '캐릭터'} | 챕터8"
    desc_src = (
        getattr(row, "user_display_description", None)
        or getattr(row, "description", None)
        or "캐릭터와 몰입형 대화를 시작하세요. 엔딩이 있는 캐릭터 채팅, 챕터8."
    )
    description = _clean_text(desc_src, 180) or "캐릭터와 몰입형 대화를 시작하세요. 엔딩이 있는 캐릭터 채팅, 챕터8."
    image_url = _pick_character_image(base, row)

    e_title = html.escape(title, quote=True)
    e_desc = html.escape(description, quote=True)
    e_canonical = html.escape(canonical, quote=True)
    e_img = html.escape(image_url, quote=True)
    js_redirect = json.dumps(canonical, ensure_ascii=False)

    doc = (
        "<!doctype html>"
        "<html lang=\"ko\">"
        "<head>"
        "<meta charset=\"utf-8\" />"
        f"<title>{e_title}</title>"
        f"<meta name=\"description\" content=\"{e_desc}\" />"
        f"<link rel=\"canonical\" href=\"{e_canonical}\" />"
        "<meta property=\"og:type\" content=\"website\" />"
        "<meta property=\"og:site_name\" content=\"챕터8\" />"
        f"<meta property=\"og:title\" content=\"{e_title}\" />"
        f"<meta property=\"og:description\" content=\"{e_desc}\" />"
        f"<meta property=\"og:url\" content=\"{e_canonical}\" />"
        f"<meta property=\"og:image\" content=\"{e_img}\" />"
        "<meta name=\"twitter:card\" content=\"summary_large_image\" />"
        f"<meta name=\"twitter:title\" content=\"{e_title}\" />"
        f"<meta name=\"twitter:description\" content=\"{e_desc}\" />"
        f"<meta name=\"twitter:image\" content=\"{e_img}\" />"
        "<meta name=\"robots\" content=\"noindex, nofollow\" />"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />"
        "</head>"
        "<body>"
        f"<script>window.location.replace({js_redirect});</script>"
        f"<noscript><meta http-equiv=\"refresh\" content=\"0;url={e_canonical}\" /></noscript>"
        "</body>"
        "</html>"
    )
    return Response(
        content=doc,
        media_type="text/html; charset=utf-8",
        headers={"Cache-Control": "public, max-age=300"},
    )

