"""
벤치 결과 비교(직관 지표)

대상:
- bench_gemini_pro_25.jsonl (Gemini 3 Pro preview)
- bench_gpt_5_1_25.jsonl (GPT-5.1)

필터:
- prompt_case == "v3_scene_first" (관계 장면 1~2문장 강제)

출력:
- 콘솔에 요약 표를 출력한다.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List


BASE = Path(__file__).resolve().parent / "outputs"

FILES = {
    "gemini_3_pro_preview": BASE / "bench_gemini_pro_25.jsonl",
    "gpt_5_1": BASE / "bench_gpt_5_1_25.jsonl",
}

CONTRACT = ["계약", "서약", "약속", "비밀"]
SCENE = ["숨결", "손끝", "옷깃", "거리", "목덜미", "입술", "무릎", "갑옷", "투구", "체온", "떨림", "장갑", "망토"]
META = ["유저", "플레이어", "튜토리얼", "롤플", "롤플레잉", "캐릭터챗", "선택", "루트", "세팅", "모델"]


def _load_jsonl(path: Path) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            s = (line or "").strip()
            if not s:
                continue
            items.append(json.loads(s))
    return items


def _count(text: str, toks: List[str]) -> int:
    return sum(text.count(t) for t in toks)


def _pct(n: int, d: int) -> float:
    if d <= 0:
        return 0.0
    return round(n * 100.0 / d, 1)


def main() -> None:
    def summarize(items: List[Dict[str, Any]]) -> Dict[str, Any]:
        total = len(items)
        ok = 0
        c_hit = s_hit = m_hit = 0
        c_cnt = s_cnt = m_cnt = 0
        for d in items:
            title = str(d.get("title") or "").strip()
            intro = str(d.get("intro") or "").strip()
            parse_mode = str(d.get("parse_mode") or "")
            if title and intro and (not parse_mode.startswith("error")):
                ok += 1
            joined = (title + " " + intro).strip()
            cc = _count(joined, CONTRACT)
            ss = _count(joined, SCENE)
            mm = _count(joined, META)
            c_cnt += cc
            s_cnt += ss
            m_cnt += mm
            if cc > 0:
                c_hit += 1
            if ss > 0:
                s_hit += 1
            if mm > 0:
                m_hit += 1
        return {
            "samples": total,
            "ok": ok,
            "fail": total - ok,
            "contract_hit": f"{c_hit}/{total} ({_pct(c_hit, total)}%)",
            "contract_cnt": c_cnt,
            "scene_hit": f"{s_hit}/{total} ({_pct(s_hit, total)}%)",
            "scene_cnt": s_cnt,
            "meta_hit": f"{m_hit}/{total} ({_pct(m_hit, total)}%)",
            "meta_cnt": m_cnt,
        }

    print("== V3(v3_scene_first) 비교 ==")
    print("(주의) jsonl이 누적 append된 경우가 있어, 전체/마지막5개를 함께 출력합니다.")
    print("")

    for name, path in FILES.items():
        data = _load_jsonl(path)
        v3 = [d for d in data if d.get("prompt_case") == "v3_scene_first"]
        last5 = v3[-5:] if len(v3) >= 5 else v3

        all_sum = summarize(v3)
        last_sum = summarize(last5)

        print(f"[{name}]")
        print(f"  ALL   : samples={all_sum['samples']} ok={all_sum['ok']} fail={all_sum['fail']}")
        print(f"          contract_hit={all_sum['contract_hit']} contract_cnt={all_sum['contract_cnt']}")
        print(f"          scene_hit={all_sum['scene_hit']} scene_cnt={all_sum['scene_cnt']}")
        print(f"          meta_hit={all_sum['meta_hit']} meta_cnt={all_sum['meta_cnt']}")
        print(f"  LAST5 : samples={last_sum['samples']} ok={last_sum['ok']} fail={last_sum['fail']}")
        print(f"          contract_hit={last_sum['contract_hit']} contract_cnt={last_sum['contract_cnt']}")
        print(f"          scene_hit={last_sum['scene_hit']} scene_cnt={last_sum['scene_cnt']}")
        print(f"          meta_hit={last_sum['meta_hit']} meta_cnt={last_sum['meta_cnt']}")
        print("")


if __name__ == "__main__":
    main()

