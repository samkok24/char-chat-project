"""
샘플(크랙/바베챗)에서 '시장성 힌트'만 추출해 SSOT 파일로 저장한다.

⚠️ 의도/원리(운영/법적 리스크 최소화):
- 외부 플랫폼의 제목/설명을 "그대로" 프롬프트에 넣으면 저작권/정책 이슈 가능성이 있다.
- 따라서 본 스크립트는 원문을 저장/주입하지 않고,
  (1) 자주 등장하는 제목 '패턴 라벨'
  (2) 자주 등장하는 소재/훅 '키워드 토큰'
  만 추출하여 quick-generate 프롬프트에 참고 힌트로 넣는다.

입력(레포 내 파일):
- backend-api/tools/crack_samples_50.json (남/여 분리된 roleplay/simulator 샘플)
- backend-api/tools/babechat_samples_category0_male_30.json
- backend-api/tools/babechat_samples_category0_female_30.json

출력:
- backend-api/app/services/market_style_tokens.json
"""

from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple


TOOLS_DIR = Path(__file__).resolve().parent
OUT_PATH = (TOOLS_DIR.parent / "app" / "services" / "market_style_tokens.json").resolve()

_KOR_WORD_RE = re.compile(r"[가-힣]{2,8}")

# 너무 일반적인 기능어/대명사/접속어는 제거(구체성 강화)
_STOP_WORDS = {
    "당신", "그녀", "그는", "우리", "너", "나", "오늘", "어느", "어떤",
    "이곳", "이건", "그것", "그리고", "하지만", "그래서", "또한",
    "정말", "너무", "조금", "바로", "이제", "처음", "마지막",
    "가능", "필수", "추천", "참고", "확인", "공지", "댓글",
    "이야기", "스토리", "세계", "세상", "운명", "비밀", "마음",
}


def _safe_list(v: Any) -> List[dict]:
    if isinstance(v, list):
        return [x for x in v if isinstance(x, dict)]
    return []


def _read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def _extract_words(text: str) -> List[str]:
    t = str(text or "")
    words = _KOR_WORD_RE.findall(t)
    out: List[str] = []
    for w in words:
        ww = w.strip()
        if not ww:
            continue
        if ww in _STOP_WORDS:
            continue
        out.append(ww)
    return out


def _detect_title_patterns(title: str) -> List[str]:
    """
    제목에서 자주 먹히는 패턴 라벨을 감지한다(원문 보존 X).
    """
    t = str(title or "").strip()
    if not t:
        return []
    out: List[str] = []
    if ("나만" in t) and ("싫어" in t or "미워" in t):
        out.append("나만 싫어하는 X")
    if "속마음" in t:
        out.append("X의 속마음/이중성")
    if "되었다" in t or "되어" in t or "되어버" in t:
        out.append("X가 되었다/빙의/전직")
    if "살아남" in t or "생존" in t:
        out.append("X에서 살아남기/생존")
    if "계약" in t or "조건" in t or "위약금" in t:
        out.append("계약/조건/대가")
    if "납치" in t or "감금" in t:
        out.append("납치/감금/구출")
    if "복수" in t or "후회" in t:
        out.append("복수/후회/재회")
    if "아카데미" in t:
        out.append("아카데미/학교")
    if any(k in t for k in ("학생회장", "일진", "선배", "후배", "동거", "여사친", "누나", "선생님")):
        out.append("관계/학교 일상 훅")
    if (":" in t) or ("｜" in t) or ("|" in t) or ("：" in t):
        out.append("구분자 구조(X: Y / X｜Y)")
    if ("?" in t) or ("…" in t) or ("..." in t):
        out.append("여운/질문형/말줄임")
    return out


def _iter_samples() -> Iterable[Tuple[str, str, str, str, List[str]]]:
    """
    yield (mode_slug, gender_key, title, one_line, tags)
    - mode_slug: roleplay | simulator
    - gender_key: male | female
    """
    crack_path = TOOLS_DIR / "crack_samples_50.json"
    if crack_path.exists():
        crack = _read_json(crack_path)
        for mode in ("roleplay", "simulator"):
            block = crack.get(mode) if isinstance(crack, dict) else None
            if not isinstance(block, dict):
                continue
            for gender in ("male", "female"):
                for it in _safe_list(block.get(gender)):
                    title = str(it.get("title") or "").strip()
                    one_line = str(it.get("oneLine") or "").strip()
                    tags = it.get("tags") if isinstance(it.get("tags"), list) else []
                    tags_s = [str(x).strip() for x in tags if str(x).strip()]
                    if title and one_line:
                        yield mode, gender, title, one_line, tags_s

    # BabeChat: category0는 섞여 있으므로 '시뮬' 키워드로 간이 분류
    for gender in ("male", "female"):
        babe_path = TOOLS_DIR / f"babechat_samples_category0_{gender}_30.json"
        if not babe_path.exists():
            continue
        obj = _read_json(babe_path)
        items = obj.get("items") if isinstance(obj, dict) else None
        for it in _safe_list(items):
            title = str(it.get("name") or "").strip()
            one_line = str(it.get("description") or "").strip()
            tags = it.get("tags") if isinstance(it.get("tags"), list) else []
            tags_s = [str(x).strip() for x in tags if str(x).strip()]
            blob = f"{title} {one_line} " + " ".join(tags_s)
            mode = "simulator" if ("시뮬" in blob or "simulation" in blob.lower()) else "roleplay"
            if title and one_line:
                yield mode, gender, title, one_line, tags_s


def build() -> Dict[str, Any]:
    """
    모드/성별별로:
    - title_patterns: 상위 패턴 라벨
    - hook_tokens: 태그 + 텍스트에서 뽑은 구체 토큰(상위)
    """
    # ✅ 다양성(운영 품질) 정책:
    # - 예전에는 hook_tokens를 상위 24개만 저장해서, 실제 생성에서 "학교/일진" 같은 초빈출로 과수렴했다.
    # - 이제는 "저장(SSOT)은 넓게" 하고, 실제 프롬프트 주입은 서버에서 일부만 샘플링한다.
    #   (seed_text 2000자 제한 때문에 프롬프트에 전체를 넣을 수는 없다)
    TOP_TITLE_PATTERNS = 40
    TOP_HOOK_TOKENS = 300

    out: Dict[str, Any] = {"roleplay": {"male": {}, "female": {}}, "simulator": {"male": {}, "female": {}}}

    # 누적 카운터
    pattern_cnt: Dict[Tuple[str, str], Counter] = {}
    token_cnt: Dict[Tuple[str, str], Counter] = {}

    for mode, gender, title, one_line, tags in _iter_samples():
        key = (mode, gender)
        if key not in pattern_cnt:
            pattern_cnt[key] = Counter()
        if key not in token_cnt:
            token_cnt[key] = Counter()

        # 패턴 라벨
        for p in _detect_title_patterns(title):
            pattern_cnt[key][p] += 1

        # 키워드 토큰(태그 + 텍스트 단어)
        for t in tags:
            tt = str(t).strip()
            if not tt:
                continue
            if len(tt) > 24:
                continue
            if tt in _STOP_WORDS:
                continue
            token_cnt[key][tt] += 2  # 태그는 가중치↑

        for w in _extract_words(title):
            token_cnt[key][w] += 1
        for w in _extract_words(one_line):
            token_cnt[key][w] += 1

    for mode in ("roleplay", "simulator"):
        for gender in ("male", "female"):
            key = (mode, gender)
            pc = pattern_cnt.get(key) or Counter()
            tc = token_cnt.get(key) or Counter()
            out[mode][gender] = {
                "title_patterns": [k for k, _ in pc.most_common(TOP_TITLE_PATTERNS)],
                "hook_tokens": [k for k, _ in tc.most_common(TOP_HOOK_TOKENS)],
                "stat": {"patterns": int(sum(pc.values())), "tokens": int(sum(tc.values()))},
            }
    return out


def main() -> int:
    data = build()
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUT_PATH.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print("OK")
    print("OUTPUT_FILE", str(OUT_PATH))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

