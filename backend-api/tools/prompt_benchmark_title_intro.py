"""
프롬프트 벤치마크: 작품명(제목) + 한줄소개 생성 비교

목적:
- "남성향/애니풍/기사/순애" 고정 시드로,
  프롬프트 버전(5개) × 모델(gemini/gpt/claude) × 반복(기본 5회)
  결과를 뽑아 비교한다.

원칙:
- 새 패키지 설치 없이(표준 라이브러리만), 각 벤더의 공식 REST API를 직접 호출한다.
- 결과는 사람이 보기 좋은 markdown + 추적 가능한 jsonl로 저장한다.
"""

from __future__ import annotations

import argparse
import asyncio
import datetime as _dt
import json
import os
import re
import sys
import uuid
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple


# NOTE:
# - 로컬 Python에 google-generativeai / openai / anthropic SDK가 없을 수 있어,
#   이 스크립트는 SDK import 없이 REST로만 호출한다.
_HERE = os.path.abspath(os.path.dirname(__file__))


def _load_dotenv_like_backend() -> None:
    """
    backend-api/app/core/config.py의 env 로딩 우선순위를 최대한 따라간다.

    우선순위:
    1) OS 환경변수(이미 설정된 값은 유지)
    2) repo/.env
    3) backend-api/.env

    제약:
    - python-dotenv를 설치하지 않고(요구사항), 최소한의 .env 파서로 구현한다.
    """
    repo_root = os.path.abspath(os.path.join(_HERE, "..", ".."))
    candidates = [
        os.path.join(repo_root, ".env"),
        os.path.abspath(os.path.join(_HERE, "..", ".env")),
    ]

    def parse_line(line: str) -> Tuple[str, str]:
        if "=" not in line:
            return "", ""
        k, v = line.split("=", 1)
        k = k.strip()
        v = v.strip()
        # strip quotes
        if (len(v) >= 2) and ((v[0] == v[-1]) and v[0] in ("'", '"')):
            v = v[1:-1]
        return k, v

    for p in candidates:
        try:
            if not os.path.exists(p):
                continue
            with open(p, "r", encoding="utf-8") as f:
                for raw in f:
                    line = (raw or "").strip()
                    if not line or line.startswith("#"):
                        continue
                    k, v = parse_line(line)
                    if not k:
                        continue
                    # OS 환경변수가 우선(override=False)
                    if os.getenv(k) is None:
                        os.environ[k] = v
        except Exception:
            # .env 파싱 실패가 전체 벤치를 막으면 안 됨
            continue


@dataclass(frozen=True)
class ModelSpec:
    """
    모델 호출 스펙.

    의도:
    - UI/설정과 상관없이, 벤치마크는 특정 sub_model을 명시해 비교를 고정한다.
    """

    provider: str  # "gemini" | "gpt" | "claude"
    sub_model: Optional[str] = None


@dataclass(frozen=True)
class PromptCase:
    """
    프롬프트 케이스(버전) 정의.
    """

    id: str
    title: str


def _now_stamp() -> str:
    return _dt.datetime.now().strftime("%Y%m%d_%H%M%S")


def _safe_str(x: Any) -> str:
    try:
        return "" if x is None else str(x)
    except Exception:
        return ""


def _strip_code_fences(s: str) -> str:
    t = (s or "").strip()
    if not t:
        return ""
    # ```json ... ``` / ``` ... ```
    if "```" in t:
        try:
            t2 = t
            if "```json" in t2:
                t2 = t2.split("```json", 1)[1]
            else:
                t2 = t2.split("```", 1)[1]
            t2 = t2.split("```", 1)[0]
            return t2.strip()
        except Exception:
            return t
    return t


def _extract_json_object(s: str) -> str:
    """
    문자열에서 가장 바깥의 { ... } 구간만 추출한다.
    """
    t = _strip_code_fences(s)
    if not t:
        return ""
    try:
        start = t.find("{")
        end = t.rfind("}")
        if start >= 0 and end > start:
            return t[start : end + 1].strip()
    except Exception:
        pass
    return ""


def _try_parse_title_intro(raw: str) -> Tuple[str, str, str]:
    """
    모델 출력에서 (title, intro, parse_mode)를 최대한 복구한다.
    """
    cleaned = (raw or "").strip()
    if not cleaned:
        return "", "", "empty"

    # 1) JSON 우선
    obj_s = _extract_json_object(cleaned)
    if obj_s:
        try:
            d = json.loads(obj_s)
            if isinstance(d, dict):
                title = _safe_str(d.get("name")).strip()
                intro = _safe_str(d.get("description")).strip()
                if title or intro:
                    return title, intro, "json"
        except Exception:
            pass

    # 2) 라벨 기반 (제목/한줄소개)
    #    - 공앱 스타일 비교를 위해 JSON이 아니어도 최대한 회수
    t = _strip_code_fences(cleaned)
    # 제목: ... \n 한줄소개: ...
    m = re.search(r"(?:^|\n)\s*제목\s*[:：]\s*(.+)", t)
    n = re.search(r"(?:^|\n)\s*한줄소개\s*[:：]\s*(.+)", t)
    if m and n:
        title = m.group(1).strip()
        intro = n.group(1).strip()
        return title, intro, "labeled"

    # 3) 2줄 구성(첫 줄=제목, 나머지=소개)
    lines = [ln.strip() for ln in t.splitlines() if ln.strip()]
    if len(lines) >= 2:
        title = lines[0]
        intro = " ".join(lines[1:]).strip()
        return title, intro, "lines"

    return "", t.strip(), "raw_only"


def _build_seed_inputs() -> Dict[str, Any]:
    """
    고정 벤치 입력(요청사항).
    """
    return {
        "name_input": "캐릭터",
        "seed_text": "남성향 / 애니풍 / 기사 / 순애. 롤플레잉 캐릭터챗 작품명과 한줄소개를 만들어줘.",
        "tags": ["남성향", "애니풍", "기사", "순애", "롤플레잉"],
        "image_grounding": "",  # 이번 벤치는 이미지 없이
        "vision_block": "",
    }


def _prompt_common_rules(*, title_len: str = "8~35자", intro_sentences: str = "4~5문장") -> str:
    """
    공통 규칙 블록.

    의도:
    - 프론트 요구사항: 제목 8~35자, 한줄소개 4~5문장.
    """
    return f"""
[출력 규칙]
- 작품명(제목)은 반드시 {title_len} 범위여야 한다. (공백 가능, 따옴표/마침표/이모지 금지)
- 한줄소개는 20~300자, {intro_sentences}, 줄바꿈 금지.
- 대명사 금지: '그/그녀/그는/그가/그녀가/그녀는/그의/그녀의' 금지 → 반드시 캐릭터명을 직접 인용.
- 2인칭 반말 금지: '너/너는/너를/너의/너와' 금지 → 유저 1인칭(나/내/내가/나를/나와/나에게)으로.
- 말투: 너무 딱딱한 존댓말(~합니다/~됩니다) 금지. 커뮤니티식 구어체로 자연스럽게(비속어/초성/과한 유행어/이모지 금지).
- 메타 금지: '이미지/사진/그림' 언급, '분위기/디테일에 맞춰 전개' 같은 설명 금지.
""".strip()


def build_prompt_v1_exact_json(seed: Dict[str, Any], nonce: str) -> str:
    """
    V1: 현재 서버 스타일(엄격 JSON)과 최대한 유사하게 구성.
    - name/description만 JSON으로 요구.
    """
    tags = seed.get("tags") or []
    tags_block = ", ".join([_safe_str(x).strip() for x in tags if _safe_str(x).strip()]) or "없음"
    seed_text = _safe_str(seed.get("seed_text"))
    name_input = _safe_str(seed.get("name_input") or "캐릭터")

    system = (
        "너는 캐릭터 챗 서비스의 캐릭터 설정을 작성하는 전문가다.\n"
        "반드시 JSON 객체만 출력하고, 다른 텍스트/마크다운/코드블록을 출력하지 마라.\n"
    )

    # NOTE: 서버 프롬프트에서 'mode_rules/audience_rules/market_style_block' 등이 추가되지만,
    # 벤치 목적상 "우리 프롬프트 톤(엄격 JSON + 방어 규칙)"을 재현하는 것이 핵심이다.
    user = f"""
[입력]
- 입력 이름(참고): {name_input}
- 랜덤 시드: {nonce}
- 원하는 캐릭터 느낌/설정: {seed_text}
- 선택 태그: {tags_block}

{_prompt_common_rules()}

[추가 규칙]
- '계약/약속/서약/비밀' 같은 단어를 쓰는 경우, 반드시 무엇인지/조건/대가/기간 중 1개 이상을 구체 명사로 같이 적어라.
- 제목/한줄소개에는 '장소/소속/직업/관계/규칙/사건' 중 최소 2개를 구체 명사로 포함하라.

[JSON 스키마]
{{
  "name": "작품명(8~35자)",
  "description": "한줄소개(20~300자, 4~5문장, 줄바꿈 금지)"
}}
""".strip()
    return f"{system}\n\n{user}"


def build_prompt_v2_relaxed_text(seed: Dict[str, Any], nonce: str) -> str:
    """
    V2: 출력 포맷만 '두 줄'로 완화(창작력 우선).
    """
    tags = seed.get("tags") or []
    tags_block = ", ".join([_safe_str(x).strip() for x in tags if _safe_str(x).strip()]) or "없음"
    seed_text = _safe_str(seed.get("seed_text"))
    return f"""
너는 한국 캐릭터챗 플랫폼에서 잘 팔리는 작품명/한줄소개를 쓰는 크리에이터다.

[입력]
- 랜덤 시드: {nonce}
- 시드: {seed_text}
- 태그: {tags_block}

{_prompt_common_rules()}

[출력 형식]
제목: <작품명>
한줄소개: <4~5문장>
""".strip()


def build_prompt_v3_scene_first(seed: Dict[str, Any], nonce: str) -> str:
    """
    V3: '사건 요약' 대신 '관계 장면(거리/시선/손끝)'을 1~2문장 포함하도록 유도.
    (노골적 19금 표현은 금지 유지)
    """
    tags = seed.get("tags") or []
    tags_block = ", ".join([_safe_str(x).strip() for x in tags if _safe_str(x).strip()]) or "없음"
    seed_text = _safe_str(seed.get("seed_text"))
    return f"""
너는 남성향 롤플레잉 캐릭터챗 작품을 잘 만드는 작가다.

[입력]
- 랜덤 시드: {nonce}
- 시드: {seed_text}
- 태그: {tags_block}

{_prompt_common_rules()}

[핵심]
- 한줄소개 4~5문장 중 최소 1~2문장은 '관계 장면'으로 써라: 시선/거리/숨결/손끝/옷깃/온도 같은 감각 디테일 포함.
- 노골적 성행위 묘사/19금 단어는 금지. 대신 '가까운 거리, 유혹, 금단, 통제' 같은 긴장감으로 표현.
- 사건/정치/임무 요약만 길게 쓰지 말고, 관계의 순간이 먼저 보이게 해라.

[출력 형식]
제목: <작품명>
한줄소개: <4~5문장>
""".strip()


def build_prompt_v4_no_contract_words(seed: Dict[str, Any], nonce: str) -> str:
    """
    V4: (비교용) '계약/약속/서약/비밀' 금지 버전.
    - 완전 금지는 운영 적용용이 아니라, 단순 비교 실험용이다.
    """
    tags = seed.get("tags") or []
    tags_block = ", ".join([_safe_str(x).strip() for x in tags if _safe_str(x).strip()]) or "없음"
    seed_text = _safe_str(seed.get("seed_text"))
    return f"""
너는 남성향 애니풍 롤플레잉 캐릭터챗 작품을 잘 만드는 작가다.

[입력]
- 랜덤 시드: {nonce}
- 시드: {seed_text}
- 태그: {tags_block}

{_prompt_common_rules()}

[금지어(실험용)]
- '계약', '약속', '서약', '비밀' 단어를 절대 쓰지 마라. 같은 의미는 다른 구체 상황으로 풀어 써라.

[출력 형식]
제목: <작품명>
한줄소개: <4~5문장>
""".strip()


def build_prompt_v5_ultra_free(seed: Dict[str, Any], nonce: str) -> str:
    """
    V5: 최대 자유도(공앱에 가깝게) + 최소한의 형식만 유지.
    """
    tags = seed.get("tags") or []
    tags_block = ", ".join([_safe_str(x).strip() for x in tags if _safe_str(x).strip()]) or "없음"
    seed_text = _safe_str(seed.get("seed_text"))
    return f"""
[요청]
남성향/애니풍/기사/순애 롤플레잉 캐릭터챗 작품의 제목과 한줄소개를 만들어줘.
딱 보면 클릭하고 싶게 후킹 강하게.

[조건]
- 제목: 8~35자
- 한줄소개: 4~5문장(20~300자), 줄바꿈 없이
- 너무 딱딱한 존댓말 금지(커뮤니티식 구어체)
- '그/그녀' 같은 3인칭 대명사 금지(캐릭터명을 직접 언급)

[소재]
- 태그: {tags_block}
- 시드: {seed_text}
- 랜덤 시드: {nonce}

[출력 형식]
제목: <작품명>
한줄소개: <4~5문장>
""".strip()


PROMPT_CASES: List[PromptCase] = [
    PromptCase(id="v1_exact_json", title="V1(현재 방식 최대 유사, JSON)"),
    PromptCase(id="v2_relaxed_text", title="V2(출력 포맷 완화: 제목/한줄소개 라벨)"),
    PromptCase(id="v3_scene_first", title="V3(관계 장면 1~2문장 강제)"),
    PromptCase(id="v4_no_contract_words", title="V4(비교 실험: 계약/약속/서약/비밀 금지)"),
    PromptCase(id="v5_ultra_free", title="V5(최소 제약, 공앱에 가깝게)"),
]


def _build_prompt(case_id: str, seed: Dict[str, Any], nonce: str) -> str:
    if case_id == "v1_exact_json":
        return build_prompt_v1_exact_json(seed, nonce)
    if case_id == "v2_relaxed_text":
        return build_prompt_v2_relaxed_text(seed, nonce)
    if case_id == "v3_scene_first":
        return build_prompt_v3_scene_first(seed, nonce)
    if case_id == "v4_no_contract_words":
        return build_prompt_v4_no_contract_words(seed, nonce)
    if case_id == "v5_ultra_free":
        return build_prompt_v5_ultra_free(seed, nonce)
    raise ValueError(f"unknown case_id: {case_id}")


async def _call_once(
    *,
    model: ModelSpec,
    prompt: str,
    temperature: float,
    max_tokens: int,
) -> str:
    want_json = ("JSON 스키마" in prompt) or ("JSON 객체" in prompt)
    response_mime_type = "application/json" if want_json else None

    if model.provider == "gpt":
        api_key = _env("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY가 설정되어 있지 않습니다.")
        base = (_env("OPENAI_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
        return await asyncio.to_thread(
            _call_openai_chat,
            api_key=api_key,
            base_url=base,
            model=model.sub_model or "gpt-4o",
            prompt=prompt,
            temperature=temperature,
            max_tokens=max_tokens,
        )

    if model.provider == "claude":
        api_key = _env("CLAUDE_API_KEY")
        if not api_key:
            raise RuntimeError("CLAUDE_API_KEY가 설정되어 있지 않습니다.")
        return await asyncio.to_thread(
            _call_anthropic_messages,
            api_key=api_key,
            model=model.sub_model or "claude-haiku-4-5-20251001",
            prompt=prompt,
            temperature=temperature,
            max_tokens=max_tokens,
        )

    if model.provider == "gemini":
        api_key = _env("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY가 설정되어 있지 않습니다.")
        return await asyncio.to_thread(
            _call_gemini_generate_content,
            api_key=api_key,
            model=model.sub_model or "gemini-3-pro-preview",
            prompt=prompt,
            temperature=temperature,
            max_tokens=max_tokens,
            response_mime_type=response_mime_type,
        )

    raise RuntimeError(f"지원하지 않는 provider: {model.provider}")


def _ensure_out_dir(path: str) -> None:
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)


def _write_text(path: str, text: str) -> None:
    _ensure_out_dir(path)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def _append_jsonl(path: str, obj: Dict[str, Any]) -> None:
    _ensure_out_dir(path)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(obj, ensure_ascii=False) + "\n")


def _md_escape(s: str) -> str:
    return (s or "").replace("|", "\\|").replace("\n", " ").strip()


def _env(name: str) -> str:
    """
    환경변수 가져오기(방어적).
    - 이 스크립트는 독립 실행이므로 OS 환경변수에 키가 있어야 한다.
    """
    try:
        return (os.getenv(name) or "").strip()
    except Exception:
        return ""


def _http_post_json(url: str, payload: Dict[str, Any], headers: Dict[str, str], timeout_s: int = 90) -> Dict[str, Any]:
    """
    표준 라이브러리(urllib)로 JSON POST.
    """
    import urllib.error
    import urllib.request

    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json; charset=utf-8")
    for k, v in (headers or {}).items():
        if v is None:
            continue
        req.add_header(k, v)

    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = ""
        try:
            raw = e.read().decode("utf-8", errors="replace")
        except Exception:
            raw = ""
        raise RuntimeError(f"HTTPError {e.code}: {raw[:800]}") from e
    except Exception as e:
        raise RuntimeError(f"HTTP request failed: {type(e).__name__}:{str(e)[:200]}") from e


def _call_openai_chat(*, api_key: str, base_url: str, model: str, prompt: str, temperature: float, max_tokens: int) -> str:
    url = (base_url.rstrip("/") + "/chat/completions")
    payload: Dict[str, Any] = {"model": model, "messages": [{"role": "user", "content": prompt}]}

    # ✅ OpenAI 모델별 파라미터 호환(방어적)
    # - 일부 최신 모델은 temperature/max_tokens 등의 파라미터 조합을 제한하거나,
    #   max_tokens 대신 max_completion_tokens 를 요구할 수 있다.
    # - 여기서는 최소 호환 세트를 우선 사용한다.
    try:
        if model.startswith("gpt-5"):
            # GPT-5 계열: max_completion_tokens 사용, temperature는 서버 설정에 따라 비허용일 수 있어 생략
            payload["max_completion_tokens"] = int(max_tokens)
        else:
            payload["temperature"] = float(temperature)
            payload["max_tokens"] = int(max_tokens)
    except Exception:
        # 파라미터 오류가 나도 요청 자체는 보내야 한다(로그로 확인)
        pass
    headers = {"Authorization": f"Bearer {api_key}"}
    data = _http_post_json(url, payload, headers=headers)
    try:
        return _safe_str(data["choices"][0]["message"]["content"])
    except Exception:
        return _safe_str(data)


def _call_anthropic_messages(*, api_key: str, model: str, prompt: str, temperature: float, max_tokens: int) -> str:
    url = "https://api.anthropic.com/v1/messages"
    payload: Dict[str, Any] = {
        "model": model,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "messages": [{"role": "user", "content": prompt}],
    }
    headers = {"x-api-key": api_key, "anthropic-version": "2023-06-01"}
    data = _http_post_json(url, payload, headers=headers)
    try:
        parts = data.get("content") if isinstance(data, dict) else None
        if isinstance(parts, list) and parts:
            return _safe_str(parts[0].get("text"))
    except Exception:
        pass
    return _safe_str(data)


def _call_gemini_generate_content(
    *,
    api_key: str,
    model: str,
    prompt: str,
    temperature: float,
    max_tokens: int,
    response_mime_type: Optional[str],
) -> str:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    payload: Dict[str, Any] = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": temperature, "maxOutputTokens": max_tokens},
    }
    if response_mime_type:
        payload["generationConfig"]["responseMimeType"] = response_mime_type
    data = _http_post_json(url, payload, headers={})
    try:
        cands = data.get("candidates") if isinstance(data, dict) else None
        if isinstance(cands, list) and cands:
            content = cands[0].get("content") or {}
            parts = content.get("parts") or []
            if isinstance(parts, list) and parts:
                return _safe_str(parts[0].get("text"))
    except Exception:
        pass
    return _safe_str(data)


async def main_async(args: argparse.Namespace) -> int:
    seed = _build_seed_inputs()

    # 모델 스펙(필요 시 여기만 바꿔도 됨)
    all_models: List[ModelSpec] = [
        ModelSpec(provider="gemini", sub_model=args.gemini_sub_model),
        ModelSpec(provider="gpt", sub_model=args.gpt_sub_model),
        ModelSpec(provider="claude", sub_model=args.claude_sub_model),
    ]
    enabled = {m.strip().lower() for m in (args.models.split(",") if args.models else []) if m.strip()}
    models = [m for m in all_models if (not enabled) or (m.provider in enabled)]

    if not models:
        raise RuntimeError("선택된 모델이 없습니다. --models 옵션을 확인하세요.")

    out_base = args.out or os.path.join(_HERE, "outputs", f"prompt_bench_{_now_stamp()}")
    md_path = out_base + ".md"
    jsonl_path = out_base + ".jsonl"

    # markdown header
    header = []
    header.append("# Prompt Benchmark (title+intro)\n")
    header.append(f"- Generated at: `{_now_stamp()}`\n")
    header.append(f"- Runs per (prompt, model): `{args.runs}`\n")
    header.append(f"- Seed tags: `{', '.join(seed.get('tags') or [])}`\n")
    header.append(f"- Seed text: `{_md_escape(seed.get('seed_text') or '')}`\n")
    header.append("\n---\n")
    _write_text(md_path, "\n".join(header))

    # 실행
    for case in PROMPT_CASES:
        _write_text(md_path, open(md_path, "r", encoding="utf-8").read() + f"\n\n## {case.title}\n")
        for model in models:
            _write_text(
                md_path,
                open(md_path, "r", encoding="utf-8").read()
                + f"\n### model: `{model.provider}` / sub_model: `{model.sub_model or 'default'}`\n",
            )
            table = []
            table.append("| run | title | intro | parse |")
            table.append("|---:|---|---|---|")

            for i in range(args.runs):
                # nonce는 매 호출마다 바꿔 다양성 확보
                nonce = uuid.uuid4().hex[:8]
                prompt = _build_prompt(case.id, seed, nonce)

                raw = ""
                err = ""
                try:
                    raw = await _call_once(
                        model=model,
                        prompt=prompt,
                        temperature=args.temperature,
                        max_tokens=args.max_tokens,
                    )
                except Exception as e:
                    err = f"{type(e).__name__}:{str(e)}"

                title, intro, mode = _try_parse_title_intro(raw)
                if err:
                    mode = f"error:{err[:80]}"

                # 기록(jsonl)
                _append_jsonl(
                    jsonl_path,
                    {
                        "prompt_case": case.id,
                        "prompt_case_title": case.title,
                        "model": model.provider,
                        "sub_model": model.sub_model,
                        "run": i + 1,
                        "nonce": nonce,
                        "title": title,
                        "intro": intro,
                        "parse_mode": mode,
                        "raw": (raw or "")[:5000],
                    },
                )

                table.append(
                    f"| {i+1} | {_md_escape(title) or '(empty)'} | {_md_escape(intro) or '(empty)'} | {_md_escape(mode)} |"
                )

                # 과도한 속도/레이트리밋 방지(방어적)
                if args.sleep_ms > 0:
                    await asyncio.sleep(args.sleep_ms / 1000.0)

            _write_text(md_path, open(md_path, "r", encoding="utf-8").read() + "\n" + "\n".join(table) + "\n")

    # 끝
    _write_text(
        md_path,
        open(md_path, "r", encoding="utf-8").read()
        + "\n\n---\n"
        + f"\nOutputs:\n- markdown: `{md_path}`\n- jsonl: `{jsonl_path}`\n",
    )
    return 0


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Benchmark prompt variants across gemini/gpt/claude")
    p.add_argument("--runs", type=int, default=5, help="runs per (prompt_case, model)")
    p.add_argument("--models", type=str, default="gemini,gpt,claude", help="comma separated: gemini,gpt,claude")
    p.add_argument("--temperature", type=float, default=0.7)
    # ✅ Gemini(Pro 계열)에서 max_tokens가 너무 낮으면 "빈 응답(content.parts 없음)"이 발생할 수 있어 기본값을 높인다.
    p.add_argument("--max_tokens", type=int, default=1800)
    p.add_argument("--sleep_ms", type=int, default=0, help="sleep between calls (ms)")
    p.add_argument("--out", type=str, default="", help="output base path without extension")
    # sub_model override(SSOT: ai_service 기본값을 그대로 쓰되, 비교 고정이 필요하면 명시)
    p.add_argument("--gemini_sub_model", type=str, default="gemini-3-pro-preview")
    p.add_argument("--gpt_sub_model", type=str, default="gpt-4o")
    p.add_argument("--claude_sub_model", type=str, default="claude-haiku-4-5-20251001")
    return p


def main() -> int:
    args = build_arg_parser().parse_args()
    try:
        # ✅ backend와 동일 우선순위로 .env 로드(없어도 진행은 가능)
        _load_dotenv_like_backend()
        return asyncio.run(main_async(args))
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())

