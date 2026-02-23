"""
BabeChat 카테고리(0)에서 샘플을 수집하는 유틸.

목표(요구사항):
- https://babechat.ai/ko?tab=categories&category=0 에서 노출되는 컨텐츠는
  시뮬 태그가 없더라도 시뮬 성격이 섞여있을 수 있다.
- 따라서 "태그"뿐 아니라 "제목/한줄소개(설명)"의 형태가 중요하므로,
  50개 정도의 샘플을 수집해 패턴/키워드 보강에 사용한다.

안전/운영:
- OOM 방지: 콘솔에 큰 JSON을 출력하지 않는다.
- 메타/플랫폼/홍보성 단어는 필터링한다.
- 네트워크 호출 실패 시 일부는 스킵하되, 전체 실패는 피한다(추가 수집용).
"""

from __future__ import annotations

import json
import os
import re
import time
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Tuple


API_BASE = "https://api.babechatapi.com/ko/api"


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


def _pick_str(v: Any, n: int) -> str:
    try:
        s = str(v or "").strip()
        s = re.sub(r"\s+", " ", s)
        return s[:n]
    except Exception:
        return ""


def _detect_desc_flags(desc: str) -> Dict[str, bool]:
    s = str(desc or "")
    return {
        "has_commands": bool(re.search(r"(^|\s)[!#][^\s]{1,20}", s)) or ("명령어" in s),
        "has_brackets_meta": bool(re.search(r"\[[^\]]{1,80}\]", s)),
        "has_url": bool(re.search(r"https?://", s, re.IGNORECASE)),
        "has_update": any(k in s for k in ("업데이트", "추가 업데이트", "패치", "완료")),
        "has_disclaimer": any(k in s for k in ("2차 창작", "공식", "가이드라인", "문의", "허용")),
        "has_role_choice": any(k in s for k in ("역할을 선택", "선택할 수", "선택하세요", "선택 가능", "역할로 시작")),
    }


_META_TAG_RE = re.compile(r"(어디서나베이비챗|베이비챗|B\s*ONLY|prochat)", re.IGNORECASE)
_IP_RE = re.compile(
    r"(호요버스|원신|붕괴|스타레일|젠레스|블루\s*아카이브|blue\s*archive|mihoyo|hoyoverse)",
    re.IGNORECASE,
)


def _filter_tag(tag: str) -> bool:
    """
    True면 유지, False면 제거.
    """
    s = str(tag or "").strip()
    if not s:
        return False
    if len(s) > 24:
        return False
    if _META_TAG_RE.search(s):
        return False
    if _IP_RE.search(s):
        return False
    # 숫자/영문이 섞인 태그는 대체로 IP/고유명사 비중이 높아 제외(보수적)
    if re.search(r"[0-9A-Za-z]", s):
        return False
    return True


def fetch_category0_samples(*, total: int = 50, limit: int = 10, sort: str = "popular", target_gender: str = "all") -> List[dict]:
    out: List[dict] = []
    seen: set[str] = set()

    for offset in range(0, max(total, limit), limit):
        if len(out) >= total:
            break
        qs = urllib.parse.urlencode(
            {
                "category": "0",
                "targetGender": str(target_gender or "all").strip() or "all",
                "sort": sort,
                "limit": str(limit),
                "offset": str(offset),
                "isSafetyEnabled": "true",
            }
        )
        url = f"{API_BASE}/characters?{qs}"
        try:
            arr = _http_json(url)
        except Exception:
            continue
        if not isinstance(arr, list):
            continue
        for it in arr:
            if not isinstance(it, dict):
                continue
            cid = _pick_str(it.get("id") or it.get("characterId"), 64)
            name = _pick_str(it.get("name"), 80)
            desc = _pick_str(it.get("description"), 2000)
            tags = it.get("tags")
            tags_list = []
            if isinstance(tags, list):
                tags_list = [str(x).strip() for x in tags if _filter_tag(str(x))]
            flags = _detect_desc_flags(desc)
            key = cid or f"{name}|{_pick_str(it.get('creatorNickname'), 40)}"
            if not key or key.lower() in seen:
                continue
            seen.add(key.lower())
            out.append(
                {
                    "id": cid,
                    "name": name,
                    "description": desc,
                    "tags": tags_list,
                    "chatCount": int(it.get("chatCount") or 0),
                    "likeCount": int(it.get("likeCount") or 0),
                    "babechatOnly": bool(it.get("babechatOnly")),
                    "isAdult": bool(it.get("isAdult")),
                    "targetGender": _pick_str(it.get("targetGender"), 12),
                    "creatorNickname": _pick_str(it.get("creatorNickname"), 40),
                    "flags": flags,
                }
            )
            if len(out) >= total:
                break
        time.sleep(0.15)
    return out[:total]


def main() -> int:
    total = int(os.environ.get("BABE_TOTAL", "50") or "50")
    limit = int(os.environ.get("BABE_LIMIT", "10") or "10")
    sort = str(os.environ.get("BABE_SORT", "popular") or "popular").strip() or "popular"
    target_gender = str(os.environ.get("BABE_TARGET_GENDER", "all") or "all").strip() or "all"

    samples = fetch_category0_samples(total=total, limit=limit, sort=sort, target_gender=target_gender)

    stat = {
        "total": len(samples),
        "has_commands": 0,
        "has_brackets_meta": 0,
        "has_url": 0,
        "has_update": 0,
        "has_disclaimer": 0,
        "has_role_choice": 0,
        "unique_tags": 0,
    }
    tag_set = set()
    for s in samples:
        f = s.get("flags") or {}
        for k in ("has_commands", "has_brackets_meta", "has_url", "has_update", "has_disclaimer", "has_role_choice"):
            if f.get(k):
                stat[k] += 1
        for t in (s.get("tags") or []):
            tag_set.add(str(t).strip().lower())
    stat["unique_tags"] = len(tag_set)

    out_path = os.path.normpath(
        os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            f"babechat_samples_category0_{target_gender}_{total}.json",
        )
    )
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({"stat": stat, "items": samples}, f, ensure_ascii=False, indent=2)

    print("OK")
    print("STAT", stat)
    print("OUTPUT_FILE", out_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

# IP/브랜드성 태그는 "소재 SSOT"로는 효용이 낮아 제외(요구사항: 메타 워딩 제외)
_IP_TAG_HINT_RE = re.compile(
    r"(호요버스|원신|붕괴|스타레일|젠레스|블루\s*아카이브|blue\s*archive|3rd|rd|mihoyo|hoyoverse)",
    re.IGNORECASE,
)


def _is_bad_tag(tag: str) -> bool:
    s = str(tag or "").strip()
    if not s:
        return True
    if len(s) > 40:
        return True
    if s.isdigit():
        return True
    if _META_TAG_RE.search(s):
        return True
    if _IP_TAG_HINT_RE.search(s):
        return True
    # 너무 특이한 혼합(알파벳+숫자)도 IP/브랜드 가능성이 높아 제외
    if re.search(r"[A-Za-z]", s) and re.search(r"\d", s):
        return True
    return False


def _uniq(seq: List[str]) -> List[str]:
    out: List[str] = []
    seen = set()
    for x in seq or []:
        s = str(x or "").strip()
        if not s:
            continue
        key = s.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(s)
    return out


def _classify_tag_to_mode(tag: str) -> str:
    """
    태그를 roleplay/simulator 중 어디에 붙일지 아주 단순 분류(방어적).
    - 훅/룰/진행/게임성 표현이면 simulator로 보낸다.
    - 그 외는 roleplay로 둔다(관계/장르 포함).
    """
    s = str(tag or "").strip()
    if not s:
        return "roleplay"
    hookish = (
        "시뮬" in s
        or "시뮬레" in s
        or "RPG" in s.upper()
        or "공략" in s
        or "미션" in s
        or "퀘스트" in s
        or "운영" in s
        or "로그" in s
        or "난이도" in s
        or "시스템" in s
        or "분기" in s
        or "선택" in s
        or "생존" in s
        or "탈출" in s
        or "수집" in s
        or "잠입" in s
        or "조사" in s
    )
    return "simulator" if hookish else "roleplay"


def _extract_title_patterns(title: str) -> List[str]:
    """
    바베챗 타이틀에서 자주 보이는 패턴을 태그화해 수집한다(SSOT로 넣지는 않고 분석용).
    """
    t = str(title or "").strip()
    if not t:
        return []
    out: List[str] = []
    if ":" in t or "：" in t:
        out.append("콜론 구조(X: Y)")
    if "!" in t or "🔥" in t or "🆕" in t:
        out.append("강조/이벤트형(!/이모지)")
    if "…" in t or "..." in t:
        out.append("여운/말줄임")
    if "속으로" in t:
        out.append("빙의/진입형(X 속으로)")
    if "시뮬" in t:
        out.append("시뮬 키워드 포함")
    if re.search(r"\([^)]{1,20}\)", t):
        out.append("괄호 보조설명")
    if re.search(r"[A-Za-z]", t):
        out.append("영문 포함")
    return out


def fetch_category0_samples(*, want: int = 50, limit: int = 10) -> Dict[str, Any]:
    items: List[dict] = []
    seen_ids = set()
    offset = 0

    # 0,10,20,... 방식으로 충분히 모을 때까지 반복
    while len(items) < want and offset < 400:
        q = {
            "category": "0",
            "targetGender": "all",
            "sort": "popular",
            "limit": str(limit),
            "offset": str(offset),
            "isSafetyEnabled": "true",
        }
        url = f"{LIST_ENDPOINT}?{urllib.parse.urlencode(q)}"
        data = _http_json(url)
        rows = data if isinstance(data, list) else []
        if not rows:
            break

        for it in rows:
            if not isinstance(it, dict):
                continue
            cid = str(it.get("id") or it.get("characterId") or "").strip()
            if not cid or cid in seen_ids:
                continue
            seen_ids.add(cid)

            name = str(it.get("name") or "").strip()
            desc = str(it.get("description") or "").strip()
            tags = it.get("tags")
            tags_list = tags if isinstance(tags, list) else []
            tags_list = _uniq([str(x) for x in tags_list if isinstance(x, (str, int, float))])
            tags_list = [t for t in tags_list if not _is_bad_tag(t)]

            # 텍스트량 폭주 방지(저장 용량/가독성)
            desc = re.sub(r"\s+", " ", desc).strip()
            if len(desc) > 520:
                desc = desc[:520].rstrip() + "…"

            if not name or not desc:
                continue

            items.append(
                {
                    "id": cid,
                    "title": name,
                    "one_line": desc,
                    "tags": tags_list,
                    "creator": str(it.get("creatorNickname") or "").strip(),
                    "chatCount": int(it.get("chatCount") or 0),
                    "likeCount": int(it.get("likeCount") or 0),
                    "targetGender": str(it.get("targetGender") or "").strip(),
                    "createdAt": str(it.get("createdAt") or "").strip(),
                    "publishedAt": str(it.get("publishedAt") or "").strip(),
                }
            )
            if len(items) >= want:
                break

        offset += limit

    # title pattern stats
    patt: List[str] = []
    for it in items:
        patt.extend(_extract_title_patterns(it.get("title") or ""))
    patt = _uniq(patt)

    # tag pool (for SSOT update)
    tag_pool: List[str] = []
    for it in items:
        tag_pool.extend(it.get("tags") or [])
    tag_pool = _uniq([t for t in tag_pool if not _is_bad_tag(t)])

    return {
        "count": len(items),
        "items": items,
        "unique_tags": tag_pool,
        "title_patterns": patt,
    }


def main() -> int:
    want = int(os.environ.get("BABECHAT_WANT", "50") or "50")
    limit = int(os.environ.get("BABECHAT_LIMIT", "10") or "10")

    rp_ssot, sim_ssot = _load_ssot_chips()
    rp_l = {x.lower() for x in rp_ssot}
    sim_l = {x.lower() for x in sim_ssot}

    data = fetch_category0_samples(want=want, limit=limit)
    tags = data.get("unique_tags") or []

    new_rp: List[str] = []
    new_sim: List[str] = []
    for t in tags:
        tl = str(t).lower()
        if tl in rp_l or tl in sim_l:
            continue
        mode = _classify_tag_to_mode(t)
        if mode == "simulator":
            new_sim.append(t)
        else:
            new_rp.append(t)

    out_path = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "babechat_category0_samples_50.json"))
    try:
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "source": "babechat",
                    "category": 0,
                    "assumption": "바베챗은 남성향 비중이 높으므로 targetGender=all로 수집(요구사항).",
                    "sample_count": int(data.get("count") or 0),
                    "title_patterns": data.get("title_patterns") or [],
                    "unique_tags": tags,
                    "new_tags_roleplay": new_rp,
                    "new_tags_simulator": new_sim,
                    "samples": data.get("items") or [],
                },
                f,
                ensure_ascii=False,
                indent=2,
            )
    except Exception:
        pass

    print("OK")
    print("SAMPLES", int(data.get("count") or 0))
    print("UNIQUE_TAGS", len(tags))
    print("NEW_ROLEPLAY_TAGS", len(new_rp))
    print("NEW_SIMULATOR_TAGS", len(new_sim))
    print("OUTPUT_FILE", out_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

