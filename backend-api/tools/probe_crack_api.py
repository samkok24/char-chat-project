"""
Crack API 응답 구조를 빠르게 확인하는 프로브 스크립트.

목적:
- `extract_crack_samples.py`가 0개로 떨어지는 원인을 파악하기 위해
  list/detail 엔드포인트의 실제 응답 형태(키/배열/페이징 파라미터 지원)를 최소 출력으로 확인한다.

출력:
- 각 URL의 status/타입/상위 키/첫 아이템 키(있을 때)만 출력한다. (OOM 방지)
"""

from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
import urllib.error


BASE = "https://crack-api.wrtn.ai/crack-api"


def fetch(url: str, timeout: int = 20):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
        status = getattr(r, "status", 200)
    try:
        obj = json.loads(raw.decode("utf-8", "replace"))
    except Exception:
        obj = None
    return status, obj


def summarize(label: str, url: str):
    try:
        status, obj = fetch(url)
        top_type = type(obj).__name__
        keys = []
        first_keys = None
        first = None
        if isinstance(obj, dict):
            keys = list(obj.keys())[:30]
            # 흔한 리스트 후보 키를 찾아 첫 아이템 키도 보여줌
            for k in ("data", "items", "results", "characters", "stories"):
                v = obj.get(k)
                if isinstance(v, list) and v:
                    first = v[0]
                    break
            if first is None:
                # data가 dict인 케이스
                dv = obj.get("data")
                if isinstance(dv, dict):
                    for k2 in ("items", "results", "characters", "stories"):
                        v2 = dv.get(k2)
                        if isinstance(v2, list) and v2:
                            first = v2[0]
                            break
        elif isinstance(obj, list):
            if obj:
                first = obj[0]
        if isinstance(first, dict):
            first_keys = list(first.keys())[:30]
        print("----", label)
        print("URL", url)
        print("STATUS", status, "TYPE", top_type)
        if keys:
            print("TOP_KEYS", keys)
        if first_keys:
            print("FIRST_KEYS", first_keys)
    except urllib.error.HTTPError as e:
        print("----", label)
        print("URL", url)
        print("HTTP_ERROR", getattr(e, "code", None))
    except Exception as e:
        print("----", label)
        print("URL", url)
        print("ERROR", type(e).__name__, str(e)[:120])


def main():
    base_q = {"sort": "totalMessageCount.desc", "target": "male"}

    # 최소 파라미터
    summarize("characters_min", f"{BASE}/characters?{urllib.parse.urlencode(base_q)}")
    summarize("stories_min", f"{BASE}/stories?{urllib.parse.urlencode(base_q)}")

    # skip/limit
    q1 = dict(base_q)
    q1.update({"skip": "0", "limit": "10"})
    summarize("characters_skip_limit", f"{BASE}/characters?{urllib.parse.urlencode(q1)}")
    summarize("stories_skip_limit", f"{BASE}/stories?{urllib.parse.urlencode(q1)}")

    # page/pageSize
    q2 = dict(base_q)
    q2.update({"page": "1", "pageSize": "10"})
    summarize("characters_page_pagesize", f"{BASE}/characters?{urllib.parse.urlencode(q2)}")
    summarize("stories_page_pagesize", f"{BASE}/stories?{urllib.parse.urlencode(q2)}")

    # offset/limit
    q3 = dict(base_q)
    q3.update({"offset": "0", "limit": "10"})
    summarize("characters_offset_limit", f"{BASE}/characters?{urllib.parse.urlencode(q3)}")
    summarize("stories_offset_limit", f"{BASE}/stories?{urllib.parse.urlencode(q3)}")

    # detail shape probe (first item id) - 실패 원인을 파일에 남긴다.
    probe_out = {"characters_list": None, "character_detail": None, "stories_list": None, "story_detail": None, "errors": []}
    try:
        status, obj = fetch(f"{BASE}/characters?{urllib.parse.urlencode(dict(base_q, limit='1', skip='0'))}")
        probe_out["characters_list"] = obj
        first = None
        if isinstance(obj, dict) and isinstance(obj.get("data"), list) and obj["data"]:
            first = obj["data"][0]
        elif isinstance(obj, list) and obj:
            first = obj[0]
        cid = ""
        if isinstance(first, dict):
            cid = str(first.get("_id") or first.get("id") or "").strip()
        if cid:
            u = f"{BASE}/characters/{urllib.parse.quote(cid)}"
            summarize("character_detail", u)
            try:
                st2, d2 = fetch(u)
                probe_out["character_detail"] = d2
            except Exception as e:
                probe_out["errors"].append({"where": "character_detail", "err": str(e)[:200]})
        else:
            probe_out["errors"].append({"where": "character_detail", "err": "no_id_from_characters_list"})
    except Exception:
        probe_out["errors"].append({"where": "characters_list", "err": "characters_list_fetch_failed"})

    try:
        status, obj = fetch(f"{BASE}/stories?{urllib.parse.urlencode(dict(base_q, limit='1', skip='0'))}")
        probe_out["stories_list"] = obj
        first = None
        if isinstance(obj, dict) and isinstance(obj.get("data"), list) and obj["data"]:
            first = obj["data"][0]
        elif isinstance(obj, list) and obj:
            first = obj[0]
        sid = ""
        if isinstance(first, dict):
            sid = str(first.get("_id") or first.get("id") or "").strip()
        if sid:
            u = f"{BASE}/stories/{urllib.parse.quote(sid)}"
            summarize("story_detail", u)
            try:
                st2, d2 = fetch(u)
                probe_out["story_detail"] = d2
            except Exception as e:
                probe_out["errors"].append({"where": "story_detail", "err": str(e)[:200]})
        else:
            probe_out["errors"].append({"where": "story_detail", "err": "no_id_from_stories_list"})
    except Exception:
        probe_out["errors"].append({"where": "stories_list", "err": "stories_list_fetch_failed"})

    # 저장(출력 OOM 방지)
    try:
        out_path = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "crack_probe_sample.json"))
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(probe_out, f, ensure_ascii=False, indent=2)
        print("PROBE_FILE", out_path)
    except Exception:
        pass


if __name__ == "__main__":
    main()

