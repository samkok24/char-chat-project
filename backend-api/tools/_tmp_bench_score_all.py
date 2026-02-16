"""
벤치 결과(작품명+한줄소개) 자동 점수화 & 1등 조합 추천

목표(직관):
- V1~V5 프롬프트 케이스별로, 모델별 결과를 같은 룰로 비교한다.
- "성공률" + "규칙 위반(길이/문장/대명사/메타)" + "계약/약속/서약/비밀 과다"를 점수로 환산한다.

입력:
- backend-api/tools/outputs/bench_*_25.jsonl
  (주의) jsonl이 append 누적될 수 있어, 각 (file, prompt_case) 마지막 N개만 기준으로 본다.

출력:
- 콘솔에 표 형태로 요약 출력
- 최종 추천 1개 (model + prompt_case)
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Tuple


OUT_DIR = Path(__file__).resolve().parent / "outputs"

# 비교 대상: "벤더별 25개(5케이스*5회)" 파일들만
BENCH_FILES = sorted(OUT_DIR.glob("bench_*_25.jsonl"))

# 스펙(프론트/서버 요구사항과 동일)
TITLE_MIN = 8
TITLE_MAX = 35
INTRO_MIN = 20
INTRO_MAX = 300
INTRO_SENT_MIN = 4
INTRO_SENT_MAX = 5

# 직관 규칙(검출용 키워드)
CONTRACT_WORDS = ["계약", "약속", "서약", "비밀"]
META_WORDS = [
    "유저",
    "플레이어",
    "튜토리얼",
    "롤플",
    "롤플레잉",
    "캐릭터챗",
    "설정",
    "세팅",
    "모델",
    "프롬프트",
    "이미지",
    "사진",
    "그림",
]
PRONOUN_FORBIDDEN = [
    # "그"는 너무 광범위해서 제외하고, 다중 글자 대명사만 잡는다.
    "그녀",
    "그는",
    "그가",
    "그의",
    "그녀가",
    "그녀는",
    "그녀의",
    "너",
    "너는",
    "너를",
    "너의",
    "너와",
    "너에게",
]

# V3(관계 장면 강제) 검사에 쓰는 단어(느슨하게)
SCENE_MARKERS = [
    "숨결",
    "손끝",
    "옷깃",
    "거리",
    "시선",
    "숨",
    "체온",
    "온기",
    "장갑",
    "망토",
    "갑옷",
]


def _load_jsonl(path: Path) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            s = (line or "").strip()
            if not s:
                continue
            out.append(json.loads(s))
    return out


def _count_any(text: str, toks: List[str]) -> Tuple[int, int]:
    """
    (hit, cnt)
    - hit: 1 이상이면 hit
    - cnt: 총 등장 횟수
    """
    c = 0
    for t in toks:
        c += text.count(t)
    return (1 if c > 0 else 0), c


def _rough_sentence_count_ko(s: str) -> int:
    """
    대충 문장 수 세기(방어적).
    - '.', '!', '?', '…' 기준 + 줄바꿈은 1개로 취급
    - 너무 정교하게 안 하고, 비교용 지표로만 사용한다.
    """
    t = (s or "").strip()
    if not t:
        return 0
    # 줄바꿈이 있으면 문장으로 취급(규칙 위반이므로 어차피 감점 대상)
    t = t.replace("\r\n", "\n").replace("\r", "\n")
    # 마침표류 기준 split
    parts = re.split(r"[.!?…]+", t)
    parts = [p.strip() for p in parts if p.strip()]
    return len(parts)


def _clip_len_ok(x: str, lo: int, hi: int) -> bool:
    n = len((x or "").strip())
    return (n >= lo) and (n <= hi)


@dataclass(frozen=True)
class SampleEval:
    ok: bool
    title_len_ok: bool
    intro_len_ok: bool
    intro_sent_ok: bool
    pronoun_bad: bool
    meta_bad: bool
    contract_cnt: int
    has_scene: bool


def _eval_one(*, prompt_case: str, title: str, intro: str, parse_mode: str) -> SampleEval:
    t = (title or "").strip()
    d = (intro or "").strip()
    joined = (t + " " + d).strip()

    ok = bool(t and d and (not (parse_mode or "").startswith("error")))
    title_len_ok = _clip_len_ok(t, TITLE_MIN, TITLE_MAX)
    intro_len_ok = _clip_len_ok(d, INTRO_MIN, INTRO_MAX)
    sent_cnt = _rough_sentence_count_ko(d)
    intro_sent_ok = (sent_cnt >= INTRO_SENT_MIN) and (sent_cnt <= INTRO_SENT_MAX)

    pronoun_bad = any(w in joined for w in PRONOUN_FORBIDDEN)
    meta_bad = any(w in joined for w in META_WORDS)
    _, contract_cnt = _count_any(joined, CONTRACT_WORDS)

    has_scene = any(w in joined for w in SCENE_MARKERS)
    if prompt_case != "v3_scene_first":
        # V3만 강제 체크
        has_scene = True

    return SampleEval(
        ok=ok,
        title_len_ok=title_len_ok,
        intro_len_ok=intro_len_ok,
        intro_sent_ok=intro_sent_ok,
        pronoun_bad=pronoun_bad,
        meta_bad=meta_bad,
        contract_cnt=contract_cnt,
        has_scene=has_scene,
    )


def _score(samples: List[SampleEval]) -> Dict[str, Any]:
    """
    0~100 점수(직관).
    - 샘플 단위로 감점 후 평균.
    """
    if not samples:
        return {"score": 0, "ok": 0, "n": 0}

    total_score = 0.0
    ok = 0
    title_ok = intro_ok = sent_ok = 0
    pronoun_bad = meta_bad = 0
    contract_hit = 0
    contract_cnt_sum = 0
    scene_ok = 0

    for s in samples:
        sc = 100.0
        if not s.ok:
            sc -= 35.0
        else:
            ok += 1

        if not s.title_len_ok:
            sc -= 10.0
        else:
            title_ok += 1

        if not s.intro_len_ok:
            sc -= 10.0
        else:
            intro_ok += 1

        if not s.intro_sent_ok:
            sc -= 10.0
        else:
            sent_ok += 1

        if s.pronoun_bad:
            sc -= 10.0
            pronoun_bad += 1

        if s.meta_bad:
            sc -= 10.0
            meta_bad += 1

        if s.contract_cnt > 0:
            contract_hit += 1
            # 과다 억제: 등장 횟수만큼 추가 감점(최대 10)
            sc -= min(10.0, 2.0 * float(s.contract_cnt))
            contract_cnt_sum += s.contract_cnt

        if not s.has_scene:
            sc -= 10.0
        else:
            scene_ok += 1

        if sc < 0:
            sc = 0.0
        total_score += sc

    n = len(samples)
    return {
        "score": round(total_score / n, 1),
        "n": n,
        "ok": ok,
        "title_ok": title_ok,
        "intro_ok": intro_ok,
        "sent_ok": sent_ok,
        "scene_ok": scene_ok,
        "pronoun_bad": pronoun_bad,
        "meta_bad": meta_bad,
        "contract_hit": contract_hit,
        "contract_cnt": contract_cnt_sum,
    }


def _label_from_file(path: Path, data: List[Dict[str, Any]]) -> str:
    """
    파일/데이터에서 모델 라벨을 최대한 뽑는다.
    """
    # jsonl에 provider/sub_model 필드가 있으므로 우선 사용
    prov = ""
    sub = ""
    try:
        if data:
            prov = str(data[-1].get("model") or "")
            sub = str(data[-1].get("sub_model") or "")
    except Exception:
        prov = ""
        sub = ""
    base = path.stem.replace("_25", "")
    if prov and sub:
        return f"{prov}:{sub} ({base})"
    if prov:
        return f"{prov} ({base})"
    return base


def main() -> None:
    if not BENCH_FILES:
        raise SystemExit("bench_*_25.jsonl 파일이 없습니다.")

    print("== 벤치 점수표(마지막 5개 샘플 기준) ==")
    print("- 점수: 0~100(높을수록 좋음)")
    print("- 감점: 실패/길이/문장수/대명사/메타/계약·비밀류/장면(V3)")
    print("")

    best = None  # (score, model_label, case_id)
    rows: List[Tuple[str, str, Dict[str, Any]]] = []

    for fp in BENCH_FILES:
        data = _load_jsonl(fp)
        model_label = _label_from_file(fp, data)
        # prompt_case 단위로 last5만
        by_case: Dict[str, List[Dict[str, Any]]] = {}
        for d in data:
            cid = str(d.get("prompt_case") or "").strip()
            if not cid:
                continue
            by_case.setdefault(cid, []).append(d)

        for cid, items in by_case.items():
            last5 = items[-5:] if len(items) >= 5 else items
            evals = [
                _eval_one(
                    prompt_case=cid,
                    title=str(x.get("title") or ""),
                    intro=str(x.get("intro") or ""),
                    parse_mode=str(x.get("parse_mode") or ""),
                )
                for x in last5
            ]
            s = _score(evals)
            rows.append((model_label, cid, s))
            key = (s["score"], s["ok"], -s["meta_bad"], -s["contract_hit"])
            if best is None or key > best[0]:
                best = (key, model_label, cid, s)

    # 출력(정렬: score desc)
    rows.sort(key=lambda x: (x[2]["score"], x[2]["ok"], -x[2]["meta_bad"], -x[2]["contract_hit"]), reverse=True)

    print("| rank | model | case | score | ok/5 | title_ok | intro_ok | sent_ok | pronoun_bad | meta_bad | contract_hit |")
    print("|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|")
    for i, (m, cid, s) in enumerate(rows, start=1):
        print(
            f"| {i} | {m} | {cid} | {s['score']} | {s['ok']}/{s['n']} | {s['title_ok']}/{s['n']} | {s['intro_ok']}/{s['n']} | {s['sent_ok']}/{s['n']} | {s['pronoun_bad']}/{s['n']} | {s['meta_bad']}/{s['n']} | {s['contract_hit']}/{s['n']} |"
        )

    if best:
        _, bm, bcid, bs = best
        print("")
        print("== 추천 1등 ==")
        print(f"- model: {bm}")
        print(f"- case : {bcid}")
        print(f"- score: {bs['score']} (ok {bs['ok']}/{bs['n']}, meta_bad {bs['meta_bad']}/{bs['n']}, contract_hit {bs['contract_hit']}/{bs['n']})")


if __name__ == "__main__":
    main()

