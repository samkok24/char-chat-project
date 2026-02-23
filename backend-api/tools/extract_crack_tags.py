"""
Crack(뤼튼 크랙) 공개 API에서 태그를 추가 수집하는 유틸.

목적:
- ROLEPLAY / SIMULATOR 프로필 소재 SSOT(`app/schemas/profile_themes.py`)를 보강하기 위해,
  상위 N개만이 아니라 추가 구간(예: skip=30)에서도 태그를 더 뽑아온다.

원칙(운영/보안/요구사항):
- 중복 제거
- 메타/플랫폼 워딩(트랙/대회/Top 등) 제거
- 이 파일은 개발 보조용이며, 런타임 코드 경로에는 포함되지 않는다.
"""

from __future__ import annotations

import json
import os
import re
import runpy
import sys
import urllib.parse
import urllib.request
import urllib.error
from typing import Any, Dict, Iterable, List, Tuple


BASE = "https://crack-api.wrtn.ai/crack-api"


def _http_json(url: str, timeout: int = 30) -> Any:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
    return json.loads(raw.decode("utf-8", "replace"))


def _pick_list(obj: Any) -> List[dict]:
    if isinstance(obj, list):
        return [x for x in obj if isinstance(x, dict)]
    if isinstance(obj, dict):
        for k in ("data", "items", "results"):
            v = obj.get(k)
            if isinstance(v, list):
                return [x for x in v if isinstance(x, dict)]
    return []


_META_RE = re.compile(
    r"(crack|wrtn|top\d*|top\s*\d+|트랙|대회|랭킹|인기|조회|베스트)",
    re.IGNORECASE,
)


def _is_meta_tag(tag: str) -> bool:
    s = str(tag or "").strip()
    if not s:
        return True
    if len(s) > 40:
        return True
    if s.isdigit():
        return True
    if _META_RE.search(s):
        return True
    return False


def _uniq(seq: Iterable[str]) -> List[str]:
    out: List[str] = []
    seen: set[str] = set()
    for x in seq:
        s = str(x or "").strip()
        if not s:
            continue
        key = s.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(s)
    return out


def _load_existing_chips() -> Tuple[List[str], List[str]]:
    here = os.path.dirname(os.path.abspath(__file__))
    path = os.path.normpath(os.path.join(here, "..", "app", "schemas", "profile_themes.py"))
    d = runpy.run_path(path)
    rp = [str(x).strip() for x in (d.get("ROLEPLAY_PROFILE_THEME_CHIPS") or []) if str(x).strip()]
    sim = [str(x).strip() for x in (d.get("SIMULATOR_PROFILE_THEME_CHIPS") or []) if str(x).strip()]
    return rp, sim


def fetch_more_tags(*, skip: int, limit: int, per_gender_take: int) -> Dict[str, List[str]]:
    """
    캐릭터(=RP) / 스토리(=SIM)에서 추가 태그를 수집한다.

    정책:
    - male/female 각각 limit/skip으로 페이지를 가져온 뒤, per_gender_take개만 사용(총 2*per_gender_take 아이템)
    - story는 list 응답에 tags가 있어 그대로 수집
    - character는 detail(`/characters/<id>`)에서 tags를 수집
    """
    common = {"sort": "totalMessageCount.desc", "limit": str(limit), "skip": str(skip)}

    story_tags: List[str] = []
    for target in ("male", "female"):
        q = dict(common)
        q["target"] = target
        url = f"{BASE}/stories?{urllib.parse.urlencode(q)}"
        items = _pick_list(_http_json(url))[:per_gender_take]
        for it in items:
            tags = it.get("tags")
            if isinstance(tags, list):
                story_tags.extend([str(x) for x in tags])

    char_tags: List[str] = []
    for target in ("male", "female"):
        q = dict(common)
        q["target"] = target
        url = f"{BASE}/characters?{urllib.parse.urlencode(q)}"
        items = _pick_list(_http_json(url))[:per_gender_take]
        ids = _uniq([str(it.get("_id") or it.get("id") or "") for it in items])
        for cid in ids:
            if not cid:
                continue
            try:
                d = _http_json(f"{BASE}/characters/{cid}")
                tags = d.get("tags") if isinstance(d, dict) else None
                if isinstance(tags, list):
                    char_tags.extend([str(x) for x in tags])
            except Exception:
                # 일부 항목 실패는 스킵(추가 수집용이라 전체 실패 방지)
                continue

    story_tags = _uniq([t for t in story_tags if not _is_meta_tag(t)])
    char_tags = _uniq([t for t in char_tags if not _is_meta_tag(t)])
    return {"sim_tags": story_tags, "rp_tags": char_tags}


def fetch_until_new_tags(
    *,
    want_rp_new: int,
    want_sim_new: int,
    sorts: List[str],
    skips: List[int],
    limit: int,
    per_gender_take: int,
    existing_rp: List[str],
    existing_sim: List[str],
) -> Dict[str, List[str]]:
    """
    SSOT에 없는 "신규 태그"가 목표 개수(want_*)를 채울 때까지 fetch를 반복한다.

    전략:
    - sort/skip 조합을 바꿔가며 가져온다(상위 30이 이미 SSOT에 다 들어간 경우 대비).
    - story(sim)는 list tags를 사용
    - character(rp)는 detail tags를 사용
    """
    existing_rp_l = {x.lower() for x in (existing_rp or [])}
    existing_sim_l = {x.lower() for x in (existing_sim or [])}

    rp_new: List[str] = []
    sim_new: List[str] = []

    for sort in (sorts or []):
        for skip in (skips or []):
            if len(rp_new) < want_rp_new or len(sim_new) < want_sim_new:
                try:
                    # fetch_more_tags는 totalMessageCount.desc를 고정으로 쓰지 않으므로, 여기서 URL을 직접 구성
                    common = {"sort": str(sort), "limit": str(limit), "skip": str(skip)}

                    # ----- stories (sim) -----
                    story_tags: List[str] = []
                    for target in ("male", "female"):
                        q = dict(common)
                        q["target"] = target
                        url = f"{BASE}/stories?{urllib.parse.urlencode(q)}"
                        items = _pick_list(_http_json(url))[:per_gender_take]
                        for it in items:
                            tags = it.get("tags")
                            if isinstance(tags, list):
                                story_tags.extend([str(x) for x in tags])
                    story_tags = _uniq([t for t in story_tags if not _is_meta_tag(t)])

                    for t in story_tags:
                        if len(sim_new) >= want_sim_new:
                            break
                        if t.lower() in existing_sim_l:
                            continue
                        if t.lower() in {x.lower() for x in sim_new}:
                            continue
                        sim_new.append(t)

                    # ----- characters (rp) -----
                    char_tags: List[str] = []
                    for target in ("male", "female"):
                        q = dict(common)
                        q["target"] = target
                        url = f"{BASE}/characters?{urllib.parse.urlencode(q)}"
                        items = _pick_list(_http_json(url))[:per_gender_take]
                        ids = _uniq([str(it.get("_id") or it.get("id") or "") for it in items])
                        for cid in ids:
                            if not cid:
                                continue
                            try:
                                d = _http_json(f"{BASE}/characters/{cid}")
                                tags = d.get("tags") if isinstance(d, dict) else None
                                if isinstance(tags, list):
                                    char_tags.extend([str(x) for x in tags])
                            except Exception:
                                continue
                    char_tags = _uniq([t for t in char_tags if not _is_meta_tag(t)])

                    for t in char_tags:
                        if len(rp_new) >= want_rp_new:
                            break
                        if t.lower() in existing_rp_l:
                            continue
                        if t.lower() in {x.lower() for x in rp_new}:
                            continue
                        rp_new.append(t)

                except Exception:
                    # 한 조합 실패는 스킵(추가 수집용)
                    continue

            if len(rp_new) >= want_rp_new and len(sim_new) >= want_sim_new:
                break
        if len(rp_new) >= want_rp_new and len(sim_new) >= want_sim_new:
            break

    return {"rp_new": rp_new[:want_rp_new], "sim_new": sim_new[:want_sim_new]}


def main() -> int:
    # 기본값: "상위 30개"는 이미 반영되었을 가능성이 높으므로,
    # 다양한 sort/skip 조합으로 "신규 태그 30개"가 채워질 때까지 탐색한다.
    limit = int(os.environ.get("CRACK_LIMIT", "30") or "30")
    per_gender_take = int(os.environ.get("CRACK_TAKE", "20") or "20")
    want = int(os.environ.get("CRACK_WANT", "30") or "30")

    # sort 후보(쉼표 구분). API가 400을 주면 해당 조합은 자동 스킵된다.
    sorts_raw = str(os.environ.get("CRACK_SORTS", "") or "").strip()
    sorts = [s.strip() for s in (sorts_raw.split(",") if sorts_raw else []) if s.strip()]
    if not sorts:
        sorts = ["totalMessageCount.desc", "likeCount.desc", "createdAt.desc"]

    skips_raw = str(os.environ.get("CRACK_SKIPS", "") or "").strip()
    if skips_raw:
        skips = []
        for p in skips_raw.split(","):
            p = p.strip()
            if not p:
                continue
            try:
                skips.append(int(p))
            except Exception:
                continue
    else:
        skips = [0, 30, 60, 90]

    existing_rp, existing_sim = _load_existing_chips()
    out = fetch_until_new_tags(
        want_rp_new=want,
        want_sim_new=want,
        sorts=sorts,
        skips=skips,
        limit=limit,
        per_gender_take=per_gender_take,
        existing_rp=existing_rp,
        existing_sim=existing_sim,
    )

    rp_new = out.get("rp_new") or []
    sim_new = out.get("sim_new") or []

    # ✅ OOM 방지: 콘솔에는 카운트만 출력하고, 상세 JSON은 파일로 저장한다.
    out_path = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "crack_new_tags.json"))
    try:
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump({"rp_new": rp_new, "sim_new": sim_new}, f, ensure_ascii=False, indent=2)
    except Exception:
        pass

    print("CONFIG", {"limit": limit, "per_gender_take": per_gender_take, "want": want, "sorts": sorts, "skips": skips})
    print("RP_NEW_COUNT", len(rp_new))
    print("SIM_NEW_COUNT", len(sim_new))
    print("OUTPUT_FILE", out_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

