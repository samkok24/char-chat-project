"""
Lightweight vision helpers (Stage-1):
- Use HuggingFace Inference API (BLIP caption base) to get a short caption
- Turn caption into 2~3 snap keywords for grounding

Environment:
  HF_TOKEN (optional): HuggingFace access token; if absent, public rate limits apply

This module avoids heavy local models and provides a simple, low-latency heuristic.
"""
from __future__ import annotations

import os
import re
import json
from typing import List, Tuple

import requests

HF_MODEL_URL = os.getenv(
    "HF_VISION_MODEL_URL",
    "https://api-inference.huggingface.co/models/Salesforce/blip-image-captioning-base",
)
HF_TOKEN = os.getenv("HF_TOKEN", "")

STOPWORDS = {
    "a","an","the","and","or","of","with","without","on","in","at","for","to","from","by","over","under",
    "is","are","be","being","been","this","that","these","those","its","it's","his","her","their","our","your",
}

def _http_get_bytes(url: str, timeout: int = 10) -> bytes:
    r = requests.get(url, timeout=timeout)
    r.raise_for_status()
    return r.content

def _hf_caption(image_bytes: bytes) -> str:
    headers = {"Accept": "application/json"}
    if HF_TOKEN:
        headers["Authorization"] = f"Bearer {HF_TOKEN}"
    r = requests.post(HF_MODEL_URL, headers=headers, data=image_bytes, timeout=25)
    if r.status_code >= 400:
        return ""
    try:
        data = r.json()
        if isinstance(data, list) and data and isinstance(data[0], dict):
            return str(data[0].get("generated_text") or "").strip()
        if isinstance(data, dict):
            # some deployments return { 'generated_text': '...' }
            return str(data.get("generated_text") or "").strip()
    except Exception:
        pass
    return ""

def _snap_keywords_from_caption(caption: str, max_k: int = 3) -> List[str]:
    cap = caption.lower()
    words = re.findall(r"[a-zA-Z]+", cap)
    words = [w for w in words if w not in STOPWORDS and len(w) >= 3]
    # simple ranking by order, remove near-duplicates
    seen = set()
    out: List[str] = []
    for w in words:
        base = w.rstrip("s")  # plural -> singular heuristic
        if base in seen:
            continue
        seen.add(base)
        out.append(base)
        if len(out) >= max_k:
            break
    return out

def stage1_keywords_from_image_url(image_url: str) -> Tuple[List[str], str]:
    """Return (keywords, caption). On failure returns ([], "")."""
    try:
        img = _http_get_bytes(image_url)
        cap = _hf_caption(img)
        if not cap:
            return [], ""
        return _snap_keywords_from_caption(cap), cap
    except Exception:
        return [], ""



