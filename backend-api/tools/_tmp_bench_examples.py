"""
벤치 jsonl에서 예시 몇 개를 뽑아 출력한다(직관 확인용).

기준:
- 각 (file, prompt_case) 마지막 N개만 출력(append 누적 방지)
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List


OUT_DIR = Path(__file__).resolve().parent / "outputs"


def load_jsonl(path: Path) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            s = (line or "").strip()
            if not s:
                continue
            items.append(json.loads(s))
    return items


def pick_last(path: Path, prompt_case: str, n: int) -> List[Dict[str, Any]]:
    data = load_jsonl(path)
    items = [d for d in data if str(d.get("prompt_case") or "") == prompt_case]
    return items[-n:] if len(items) >= n else items


def print_block(label: str, items: List[Dict[str, Any]]) -> None:
    print("")
    print("== " + label + " ==")
    for i, d in enumerate(items, start=1):
        title = str(d.get("title") or "").strip()
        intro = str(d.get("intro") or "").strip()
        parse_mode = str(d.get("parse_mode") or "")
        print(f"[{i}] parse={parse_mode}")
        print("제목:", title)
        print("한줄:", intro)
        print("")


def main() -> None:
    targets = [
        ("Gemini Pro / V1(JSON)", OUT_DIR / "bench_gemini_pro_25.jsonl", "v1_exact_json", 5),
        ("GPT-5.1 / V1(JSON)", OUT_DIR / "bench_gpt_5_1_25.jsonl", "v1_exact_json", 5),
        ("Gemini Pro / V3(장면)", OUT_DIR / "bench_gemini_pro_25.jsonl", "v3_scene_first", 3),
        ("GPT-5.1 / V3(장면)", OUT_DIR / "bench_gpt_5_1_25.jsonl", "v3_scene_first", 3),
    ]
    for label, path, case_id, n in targets:
        items = pick_last(path, case_id, n)
        print_block(label, items)


if __name__ == "__main__":
    main()

