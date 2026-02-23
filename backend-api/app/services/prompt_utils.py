"""
Lightweight utilities for parsing chat-like text into structured turns
and building a shared Claude system prompt.

This module is intentionally side‑effect free and does not modify
existing runtime flow. It can be imported and used by the API layer
when integration is desired.
"""

from __future__ import annotations

import re
from typing import List, Dict, Any, Tuple


# -----------------------------
# Emoji extraction (broad range)
# -----------------------------
_EMOJI_RE = re.compile(
    r"[\U0001F300-\U0001FAFF\U00002700-\U000027BF\U00002600-\U000026FF]"
)


def extract_emojis(text: str) -> List[str]:
    try:
        return _EMOJI_RE.findall(text or "")
    except Exception:
        return []


# -----------------------------
# Platform detection (heuristic)
# -----------------------------
_TIME_KR = re.compile(r"(?:오전|오후)\s?\d{1,2}:\d{2}")
_KAKAO_BRACKET = re.compile(r"^\[[^\]]{1,32}\]\s?.+")
_NAME_COLON = re.compile(r"^.{1,24}\s?:\s?.+")


def detect_platform(raw: str) -> str:
    text = (raw or "").strip()
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if not lines:
        return "unknown"
    score_kakao = sum(1 for ln in lines if _TIME_KR.search(ln) or _KAKAO_BRACKET.match(ln))
    score_name_colon = sum(1 for ln in lines if _NAME_COLON.match(ln))

    # Very rough heuristic
    if score_kakao >= max(2, len(lines) // 4):
        return "kakao"
    if score_name_colon >= max(2, len(lines) // 3):
        return "dm"
    return "community"


# ----------------------------------
# Conversation turns parsing (simple)
# ----------------------------------
_PATTERNS: List[Tuple[str, re.Pattern]] = [
    ("kakao_bracket", re.compile(r"^\[(?P<name>[^\]]{1,32})\]\s*(?:(?P<time>(?:오전|오후)?\s?\d{1,2}:\d{2}))?\s*(?P<text>.+)$")),
    ("time_name_colon", re.compile(r"^(?P<time>\d{1,2}:\d{2})\s+(?P<name>.{1,24}?)\s?:\s*(?P<text>.+)$")),
    ("name_colon", re.compile(r"^(?P<name>.{1,24}?)\s?:\s*(?P<text>.+)$")),
]


def parse_chat_like_text(raw: str) -> Dict[str, Any]:
    """
    Parse chat/DM/community-like pasted text into structured turns.
    Returns: { turns: [{speaker, text, time?}], meta: {...}, emojis: [...] }
    """
    text = (raw or "").strip()
    lines = [ln.rstrip() for ln in text.splitlines() if ln.strip()]

    turns: List[Dict[str, Any]] = []
    for ln in lines:
        matched = False
        for _tag, rp in _PATTERNS:
            m = rp.match(ln)
            if m:
                d = m.groupdict()
                turns.append({
                    "speaker": (d.get("name") or "").strip() or "?",
                    "text": (d.get("text") or "").strip(),
                    **({"time": (d.get("time") or "").strip()} if d.get("time") else {}),
                })
                matched = True
                break
        if not matched:
            # Fallback: treat as narrator/comment
            turns.append({"speaker": "-", "text": ln})

    # Meta
    platform = detect_platform(text)
    emojis = extract_emojis(text)

    # Very rough thread depth estimation for community: count leading markers
    thread_depth = max((len(ln) - len(ln.lstrip(" >└ㄴ·•-"))) for ln in lines) if lines else 0

    # Simple attachments detection
    url_re = re.compile(r"https?://\S+")
    attachments = url_re.findall(text)

    return {
        "turns": turns,
        "meta": {
            "platform": platform,
            "thread_depth": thread_depth,
            "attachments": attachments,
        },
        "emojis": list(dict.fromkeys(emojis)),  # unique, keep order
    }


# ---------------------------------------
# Claude common system prompt (shared)
# ---------------------------------------
def build_claude_system_prompt(username: str | None = None, pov: str | None = None) -> str:
    pov_line = "시점: 자동" if not pov else f"시점: {pov}"
    name_line = f"1인칭 시점 시, 화자 이름: {username}" if username else "1인칭 시점 시, 화자 이름: 사용자 닉네임"
    return (
        "당신은 20년차 웹소설/에세이 작가다.\n"
        "- 분량: 800~1000자\n"
        "- 분석 금지, 결과 텍스트(소설 장면/일상 스냅)만 출력\n"
        f"- {pov_line}\n"
        f"- {name_line}\n"
        "- 원문 문장 재현 금지, 스타일만 차용\n"
        "\n[안전]\n"
        "- 개인정보/실명/연락처/주소 생성 금지\n"
        "- 모욕/혐오/차별 발화는 중립/은유로 리라이트\n"
        "- 민감 사건/실존 인물 언급 지양, 허구화할 것\n"
        "\n[출력 형식]\n"
        "- 한국어, 단일 블록 텍스트로만 출력 (메타 코멘트/분석 금지)\n"
    )



