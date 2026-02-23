"""
Crack(뤼튼 크랙) 공개 API에서 샘플(제목/한줄소개/태그)을 수집하는 유틸.

요구사항(사용자):
- "제목/한줄소개 유형"이 매우 중요하므로, 태그뿐 아니라 제목/설명까지 함께 수집한다.
- 중복 없이, 메타 워딩 없이 수집한다.

수집 범위(운영 판단):
- 캐릭터(=RP) 50개 + 스토리(=SIM) 50개를 각각 수집해 저장한다.
  (바베챗 category=0처럼 시뮬/롤플이 섞일 수 있지만, 크랙은 네비로 분리되어 있어 분리 저장이 더 안전)

안전/운영:
- OOM 방지: 콘솔에는 카운트/경로만 출력. 상세는 파일로 저장.
- 실패해도 전체가 죽지 않도록 조합 단위로 스킵(추가 수집용).
"""

from __future__ import annotations

import json
import os
import re
import time
import urllib.parse
import urllib.request
import urllib.error
from typing import Any, Dict, List, Optional, Tuple


BASE = "https://crack-api.wrtn.ai/crack-api"
_DEBUG = os.environ.get("CRACK_DEBUG", "").strip() in ("1", "true", "TRUE", "yes", "YES")
_DEBUG_LOG_PATH = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "crack_samples_debug.log"))


def _debug_log(line: str) -> None:
    """디버그 로그를 파일로 남긴다(터미널 OOM 방지)."""
    if not _DEBUG:
        return
    try:
        with open(_DEBUG_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(line.rstrip() + "\n")
    except Exception:
        # 디버그 로그 실패는 본 작업을 막지 않음
        pass


def _http_json_safe(url: str, timeout: int = 30) -> Tuple[Optional[Any], int, str]:
    """
    JSON GET(방어적).

    - 실패를 조용히 삼키면 '0개'처럼 보여 디버깅이 어렵다.
    - 따라서 (obj/status/error) 형태로 반환해 호출부에서 통계를 낼 수 있게 한다.
    """
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0",
            "Accept": "application/json",
            # 크랙 API가 헤더에 민감한 경우가 있어 브라우저 요청처럼 보강(방어적).
            "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
            "Referer": "https://crack.wrtn.ai/",
            "Origin": "https://crack.wrtn.ai",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            st = int(getattr(r, "status", 200) or 200)
        try:
            return json.loads(raw.decode("utf-8", "replace")), st, ""
        except Exception as e:
            _debug_log(f"[json_decode_failed] url={url} err={type(e).__name__}")
            return None, st, f"json_decode_failed:{type(e).__name__}"
    except urllib.error.HTTPError as e:
        code = int(getattr(e, "code", 0) or 0)
        try:
            body = e.read().decode("utf-8", "replace")
        except Exception:
            body = ""
        _debug_log(f"[HTTPError] code={code} url={url} body_head={body[:200]!r}")
        return None, code, f"HTTPError:{getattr(e, 'code', '')}"
    except Exception as e:
        _debug_log(f"[Error] url={url} err={type(e).__name__}:{str(e)[:120]}")
        return None, 0, f"{type(e).__name__}:{str(e)[:120]}"


def _pick_list(obj: Any) -> List[dict]:
    if isinstance(obj, list):
        return [x for x in obj if isinstance(x, dict)]
    if isinstance(obj, dict):
        # 크랙: {"result":"SUCCESS","data":[...]} 형태도 존재(중요)
        data = obj.get("data")
        if isinstance(data, list):
            return [x for x in data if isinstance(x, dict)]
        # 크랙: {"result":"SUCCESS","data":{"characters":[...],"nextCursor":"..."}} 형태도 흔함
        if isinstance(data, dict):
            for k in ("characters", "stories", "items", "results", "docs"):
                v = data.get(k)
                if isinstance(v, list):
                    return [x for x in v if isinstance(x, dict)]
        # 다른 변형(방어)
        for k in ("items", "results", "characters", "stories", "docs"):
            v = obj.get(k)
            if isinstance(v, list):
                return [x for x in v if isinstance(x, dict)]
    return []


def _pick_next_cursor(obj: Any) -> str:
    """크랙 cursor 기반 페이징용 nextCursor 추출."""
    if not isinstance(obj, dict):
        return ""
    # top-level cursor가 오는 변형 방어
    top = obj.get("nextCursor") or obj.get("next") or obj.get("cursor") or ""
    if top:
        return _pick_str(top, 400)
    data = obj.get("data")
    if isinstance(data, dict):
        c = data.get("nextCursor") or data.get("next") or data.get("cursor") or ""
        return _pick_str(c, 400)
    return ""


def _pick_str(v: Any, n: int) -> str:
    try:
        s = str(v or "").strip()
        s = re.sub(r"\s+", " ", s)
        return s[:n]
    except Exception:
        return ""


_META_RE = re.compile(
    r"(crack|wrtn|top\d*|top\s*\d+|트랙|대회|랭킹|인기|조회|베스트|공유|이벤트)",
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


def _uniq_by_key(items: List[dict], key_fn) -> List[dict]:
    out: List[dict] = []
    seen: set[str] = set()
    for it in items:
        try:
            key = str(key_fn(it) or "").strip().lower()
        except Exception:
            key = ""
        if not key:
            continue
        if key in seen:
            continue
        seen.add(key)
        out.append(it)
    return out


def _collect_ids_from_list(items: List[dict]) -> List[str]:
    ids: List[str] = []
    for it in items:
        # list item 변형이 다양해서 nested도 함께 본다(방어적).
        nested = None
        try:
            if isinstance(it.get("character"), dict):
                nested = it.get("character")
            elif isinstance(it.get("story"), dict):
                nested = it.get("story")
            elif isinstance(it.get("data"), dict):
                nested = it.get("data")
        except Exception:
            nested = None

        cid = _pick_str(
            it.get("_id")
            or it.get("id")
            or it.get("characterId")
            or it.get("storyId")
            or (nested.get("_id") if isinstance(nested, dict) else None)
            or (nested.get("id") if isinstance(nested, dict) else None)
            or "",
            80,
        )
        if cid:
            ids.append(cid)
    # unique
    out: List[str] = []
    seen: set[str] = set()
    for x in ids:
        k = x.lower()
        if k in seen:
            continue
        seen.add(k)
        out.append(x)
    return out


def _extract_title_and_desc(obj: dict) -> Tuple[str, str]:
    """
    Crack 응답에서 제목/한줄소개를 뽑는다(방어적).
    """
    # 크랙 list item: name + simpleDescription
    # list/detail, story/character 등 응답 형태가 다양하므로 최대한 넓게 본다.
    title = _pick_str(
        obj.get("title")
        or obj.get("name")
        or obj.get("displayName")
        or (obj.get("character") or {}).get("name")
        or (obj.get("story") or {}).get("title")
        or (obj.get("story") or {}).get("name")
        or "",
        100,
    )
    desc = _pick_str(
        obj.get("description")
        or obj.get("simpleDescription")
        or obj.get("detailDescription")
        or obj.get("summary")
        or obj.get("oneLine")
        or obj.get("intro")
        or obj.get("short_description")
        or (obj.get("character") or {}).get("simpleDescription")
        or (obj.get("story") or {}).get("simpleDescription")
        or (obj.get("story") or {}).get("description")
        or "",
        2000,
    )
    return title, desc


def _extract_tags(obj: dict) -> List[str]:
    # 크랙 story list item: tags 있음
    # 크랙 character list item: tags가 없을 수 있어 detail을 보거나 nested를 본다
    tags = obj.get("tags")
    if not isinstance(tags, list):
        tags = (obj.get("character") or {}).get("tags")
    if not isinstance(tags, list):
        tags = (obj.get("story") or {}).get("tags")
    if not isinstance(tags, list):
        data = obj.get("data")
        if isinstance(data, dict):
            tags = data.get("tags")
    if isinstance(tags, list):
        out = []
        seen = set()
        for t in tags:
            s = str(t or "").strip()
            if not s:
                continue
            if _is_meta_tag(s):
                continue
            k = s.lower()
            if k in seen:
                continue
            seen.add(k)
            out.append(s)
        return out[:30]
    return []


def fetch_character_samples(*, want: int = 50, limit: int = 30, targets: Optional[List[str]] = None) -> List[dict]:
    """
    크랙 캐릭터(=RP) 샘플 수집.
    - list → detail(/characters/<id>)로 제목/설명/태그를 확보한다.
    """
    sorts = ["totalMessageCount.desc", "likeCount.desc", "createdAt.desc"]
    skips = [0, 30, 60, 90]
    targets = targets if isinstance(targets, list) and targets else ["male", "female"]

    acc: List[dict] = []
    err_stat: Dict[str, int] = {}

    def _note_err(key: str) -> None:
        err_stat[key] = int(err_stat.get(key) or 0) + 1

    def _fetch_list(endpoint: str, params: dict) -> List[dict]:
        q = urllib.parse.urlencode({k: str(v) for k, v in params.items() if v is not None})
        obj, st, err = _http_json_safe(f"{BASE}/{endpoint}?{q}")
        if err:
            _note_err(f"{endpoint}_list_{st}")
            return []
        return _pick_list(obj)

    def _fetch_list_with_cursor(endpoint: str, params: dict) -> Tuple[List[dict], str]:
        q = urllib.parse.urlencode({k: str(v) for k, v in params.items() if v is not None})
        obj, st, err = _http_json_safe(f"{BASE}/{endpoint}?{q}")
        if err:
            _note_err(f"{endpoint}_list_{st}")
            return [], ""
        return _pick_list(obj), _pick_next_cursor(obj)

    for sort in sorts:
        for target in targets:
            if len(acc) >= want:
                break
            # 크랙은 nextCursor 기반이라, 같은 (sort,target)에서 1~2페이지면 50개 충당 가능
            cursor = ""
            page_guard = 0
            while len(acc) < want and page_guard < 10:
                page_guard += 1
                params = {"sort": sort, "target": target, "limit": str(limit)}
                # ✅ nextCursor가 없고 skip/limit 페이징만 되는 응답도 존재
                if cursor:
                    params["cursor"] = cursor
                else:
                    params["skip"] = str((page_guard - 1) * int(limit))
                lst, next_cursor = _fetch_list_with_cursor("characters", params)
                if not lst:
                    break
                ids = _collect_ids_from_list(lst)
                for cid in ids:
                    if len(acc) >= want:
                        break
                    # 기본은 list 항목으로(제목/한줄은 list에 있음)
                    it0 = next((x for x in lst if str(x.get("_id") or x.get("id") or "").strip() == cid), {})
                    if not isinstance(it0, dict):
                        continue
                    title, desc = _extract_title_and_desc(it0)
                    tags = _extract_tags(it0)

                    # detail 시도(태그/제목/한줄소개 중 하나라도 부족하면 보강).
                    # 캐릭터는 list에 `simpleDescription`이 없을 때가 있어, desc가 비면 detail을 꼭 봐야 한다.
                    if (not title) or (not desc) or (not tags):
                        try:
                            d, st, err = _http_json_safe(f"{BASE}/characters/{urllib.parse.quote(str(cid))}")
                            if err:
                                _note_err(f"characters_detail_{st}")
                                d = None
                            if isinstance(d, dict):
                                dd = d.get("data") if isinstance(d.get("data"), dict) else d
                                if isinstance(dd, dict):
                                    t2, d2 = _extract_title_and_desc(dd)
                                    title = title or t2
                                    desc = desc or d2
                                    tags = tags or _extract_tags(dd)
                        except Exception:
                            pass

                    if not title or not desc:
                        continue
                    acc.append(
                        {
                            "id": cid,
                            "title": title,
                            "oneLine": desc,
                            "tags": tags,
                            "target": target,
                            "sort": sort,
                            "cursor": cursor or "",
                        }
                    )
                    time.sleep(0.03)
                cursor = next_cursor or ""
                # cursor가 없으면 skip 페이징으로 루프 지속(빈 리스트면 위에서 break)
                if cursor:
                    continue
                # skip 모드에서 같은 페이지를 다시 돌지 않도록 next_cursor가 없으면 계속 진행
                # (page_guard 증가로 다음 skip로 이동)
                continue
        if len(acc) >= want:
            break

    acc = _uniq_by_key(acc, lambda x: x.get("id") or f"{x.get('title')}|{x.get('oneLine')}")
    # 최소 로그(너무 길게 찍지 않음)
    try:
        if err_stat and not acc:
            top = sorted(err_stat.items(), key=lambda kv: kv[1], reverse=True)[:6]
            print("CHAR_ERRORS_TOP", top)
    except Exception:
        pass
    return acc[:want]


def fetch_story_samples(*, want: int = 50, limit: int = 30, targets: Optional[List[str]] = None) -> List[dict]:
    """
    크랙 스토리(=SIM) 샘플 수집.
    - list 응답에 tags가 존재하는 경우가 많아 우선 list 기반으로 수집하고,
      가능하면 detail(/stories/<id>)도 시도한다(엔드포인트가 없으면 자동 스킵).
    """
    sorts = ["totalMessageCount.desc", "likeCount.desc", "createdAt.desc"]
    skips = [0, 30, 60, 90]
    targets = targets if isinstance(targets, list) and targets else ["male", "female"]

    acc: List[dict] = []
    err_stat: Dict[str, int] = {}

    def _note_err(key: str) -> None:
        err_stat[key] = int(err_stat.get(key) or 0) + 1

    def _fetch_list(endpoint: str, params: dict) -> List[dict]:
        q = urllib.parse.urlencode({k: str(v) for k, v in params.items() if v is not None})
        obj, st, err = _http_json_safe(f"{BASE}/{endpoint}?{q}")
        if err:
            _note_err(f"{endpoint}_list_{st}")
            return []
        return _pick_list(obj)

    def _fetch_list_with_cursor(endpoint: str, params: dict) -> Tuple[List[dict], str]:
        q = urllib.parse.urlencode({k: str(v) for k, v in params.items() if v is not None})
        obj, st, err = _http_json_safe(f"{BASE}/{endpoint}?{q}")
        if err:
            _note_err(f"{endpoint}_list_{st}")
            return [], ""
        return _pick_list(obj), _pick_next_cursor(obj)

    for sort in sorts:
        for target in targets:
            if len(acc) >= want:
                break
            cursor = ""
            page_guard = 0
            while len(acc) < want and page_guard < 10:
                page_guard += 1
                params = {"sort": sort, "target": target, "limit": str(limit)}
                # ✅ nextCursor가 없고 skip/limit 페이징만 되는 응답도 존재
                if cursor:
                    params["cursor"] = cursor
                else:
                    params["skip"] = str((page_guard - 1) * int(limit))
                lst, next_cursor = _fetch_list_with_cursor("stories", params)
                if not lst:
                    break
                ids = _collect_ids_from_list(lst)
                for sid in ids:
                    if len(acc) >= want:
                        break
                    # 기본은 list 항목으로 (스토리는 list에 tags/description이 잘 있음)
                    it0 = next((x for x in lst if str(x.get("_id") or x.get("id") or "").strip() == sid), {})
                    if not isinstance(it0, dict):
                        continue
                    title, desc = _extract_title_and_desc(it0)
                    tags = _extract_tags(it0)

                    # detail 시도(없거나 실패해도 스킵). 크랙은 detail이 없을 수도 있음.
                    try:
                        d, st, err = _http_json_safe(f"{BASE}/stories/{urllib.parse.quote(str(sid))}")
                        if err:
                            _note_err(f"stories_detail_{st}")
                            d = None
                        if isinstance(d, dict):
                            dd = d.get("data") if isinstance(d.get("data"), dict) else d
                            if isinstance(dd, dict):
                                t2, d2 = _extract_title_and_desc(dd)
                                title = title or t2
                                desc = desc or d2
                                tags = tags or _extract_tags(dd)
                    except Exception:
                        pass

                    if not title or not desc:
                        continue
                    acc.append(
                        {
                            "id": sid,
                            "title": title,
                            "oneLine": desc,
                            "tags": tags,
                            "target": target,
                            "sort": sort,
                            "cursor": cursor or "",
                        }
                    )
                    time.sleep(0.02)
                cursor = next_cursor or ""
                if cursor:
                    continue
                continue
        if len(acc) >= want:
            break

    acc = _uniq_by_key(acc, lambda x: x.get("id") or f"{x.get('title')}|{x.get('oneLine')}")
    try:
        if err_stat and not acc:
            top = sorted(err_stat.items(), key=lambda kv: kv[1], reverse=True)[:6]
            print("STORY_ERRORS_TOP", top)
    except Exception:
        pass
    return acc[:want]


def main() -> int:
    want = int(os.environ.get("CRACK_WANT", "50") or "50")
    want_per_target = int(os.environ.get("CRACK_WANT_PER_TARGET", "30") or "30")
    limit = int(os.environ.get("CRACK_LIMIT", "30") or "30")
    split = str(os.environ.get("CRACK_SPLIT_BY_TARGET", "") or "").strip().lower() in ("1", "true", "yes")

    if split:
        # ✅ 요구사항: 남/여 각각 N개를 안정적으로 확보하기 위해, target별로 별도 수집한다.
        rp_male = fetch_character_samples(want=want_per_target, limit=limit, targets=["male"])
        rp_female = fetch_character_samples(want=want_per_target, limit=limit, targets=["female"])
        sim_male = fetch_story_samples(want=want_per_target, limit=limit, targets=["male"])
        sim_female = fetch_story_samples(want=want_per_target, limit=limit, targets=["female"])
        out = {
            "meta": {"want_per_target": want_per_target, "limit": limit},
            "roleplay": {"male": rp_male, "female": rp_female},
            "simulator": {"male": sim_male, "female": sim_female},
        }
    else:
        rp = fetch_character_samples(want=want, limit=limit)
        sim = fetch_story_samples(want=want, limit=limit)
        out = {"meta": {"want": want, "limit": limit}, "roleplay": rp, "simulator": sim}

    out_path = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "crack_samples_50.json"))
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print("OK")
    try:
        if split:
            print("ROLEPLAY_MALE_COUNT", len(out["roleplay"]["male"]))
            print("ROLEPLAY_FEMALE_COUNT", len(out["roleplay"]["female"]))
            print("SIMULATOR_MALE_COUNT", len(out["simulator"]["male"]))
            print("SIMULATOR_FEMALE_COUNT", len(out["simulator"]["female"]))
        else:
            print("ROLEPLAY_COUNT", len(out["roleplay"]))
            print("SIMULATOR_COUNT", len(out["simulator"]))
    except Exception:
        pass
    print("OUTPUT_FILE", out_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

