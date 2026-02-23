#!/usr/bin/env python3
"""
전체 모델 벤치마크 스크립트
- 각 모델 10회 채팅 테스트
- 메트릭: TTFB, 총시간, 글자수, 지문/말풍선 수, 한국어비율, cut_repaired, 가격
- 결과: MODEL_BENCHMARK_RESULTS.md
"""
import asyncio, aiohttp, json, time, re, os, sys, statistics
from datetime import datetime

BASE = "http://localhost:8000"
EMAIL = "samkok24@gmail.com"
PASSWORD = "aaaaaaaaa"
CHARACTER_ID = "255833e3-35d2-4058-a128-8fac7ac39c6b"
OPENING_ID = "set_1"
RUNS_PER_MODEL = 10

# 테스트할 모델 목록: (provider, sub_model, display_name)
MODELS = [
    ("claude", "claude-haiku-4-5-20251001", "Claude Haiku 4.5"),
    ("claude", "claude-sonnet-4-20250514", "Claude Sonnet 4"),
    ("claude", "claude-sonnet-4-5-20250929", "Claude Sonnet 4.5"),
    ("claude", "claude-opus-4-1-20250805", "Claude Opus 4.1"),
    ("claude", "claude-opus-4-5-20251101", "Claude Opus 4.5"),
    ("gemini", "gemini-2.5-pro", "Gemini 2.5 Pro"),
    ("gemini", "gemini-2.5-flash", "Gemini 2.5 Flash"),
    ("gemini", "gemini-3-pro-preview", "Gemini 3 Pro Preview"),
]

# API 가격 (per 1M tokens, USD) — 2025-2026 기준
PRICING = {
    "Claude Haiku 4.5":       {"input": 0.80,  "output": 4.00},
    "Claude Sonnet 4":        {"input": 3.00,  "output": 15.00},
    "Claude Sonnet 4.5":      {"input": 3.00,  "output": 15.00},
    "Claude Opus 4.1":        {"input": 15.00, "output": 75.00},
    "Claude Opus 4.5":        {"input": 15.00, "output": 75.00},
    "Gemini 2.5 Pro":         {"input": 1.25,  "output": 10.00},
    "Gemini 2.5 Flash":       {"input": 0.15,  "output": 0.60},
    "Gemini 3 Pro Preview":   {"input": 1.25,  "output": 10.00},
}

# 테스트 메시지들 (10개)
MESSAGES = [
    "루나, 나야. 지금 통화 가능해?",
    "지금 당장 갈게. 무슨 거래인데?",
    "그 녹음 파일은 어디서 구한 거야?",
    "위험하지 않아? 혼자 가면 안 될 것 같은데.",
    "좋아, 같이 가자. 근데 준비물이 필요하지 않아?",
    "솔직히 말해봐. 나한테 숨기는 거 있지?",
    "그 남자를 믿어도 되는 건가?",
    "여기서 기다릴게. 조심해.",
    "계획이 바뀌었어. 다른 방법을 찾아보자.",
    "이제 돌아갈 시간이야. 마무리하자.",
]


def count_narration_blocks(text: str) -> int:
    """지문(나레이션) 블록 수 카운트 — 대사가 아닌 텍스트 블록"""
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    count = 0
    for line in lines:
        # 대사가 아닌 줄 = 지문
        if not re.match(r'^["\'「\"]', line) and not re.match(r'^["""]', line):
            # 선택지/시스템 태그 제외
            if not re.match(r'^[\[【\(]?(선택지|선택|choice|option)', line, re.I):
                count += 1
    return count


def count_dialogue_bubbles(text: str) -> int:
    """말풍선(대사) 수 카운트 — 따옴표/인용 형태"""
    patterns = [
        r'["""]([^"""]+)["""]',   # "대사"
        r'「([^」]+)」',            # 「대사」
        r"'([^']+)'",             # '대사'
    ]
    total = 0
    for p in patterns:
        total += len(re.findall(p, text))
    return total


def count_choices(text: str) -> int:
    """선택지 수 카운트"""
    patterns = [
        r'(?:^|\n)\s*\d+[\.\)]\s',
        r'(?:^|\n)\s*[①②③④⑤]',
        r'(?:^|\n)\s*[-•]\s',
    ]
    total = 0
    for p in patterns:
        total += len(re.findall(p, text))
    return total


def korean_ratio(text: str) -> float:
    """한국어 비율"""
    if not text:
        return 0.0
    korean = len(re.findall(r'[가-힣]', text))
    alpha = len(re.findall(r'[a-zA-Z]', text))
    if korean + alpha == 0:
        return 1.0
    return korean / (korean + alpha)


async def login(session: aiohttp.ClientSession) -> str:
    """로그인해서 access_token 반환"""
    async with session.post(f"{BASE}/auth/login", json={
        "email": EMAIL, "password": PASSWORD
    }) as r:
        if r.status != 200:
            text = await r.text()
            raise RuntimeError(f"Login failed: {r.status} {text}")
        data = await r.json()
        return data["access_token"]


async def set_model(session: aiohttp.ClientSession, token: str, model: str, sub_model: str):
    """유저 모델 설정 변경"""
    async with session.put(
        f"{BASE}/me/model-settings",
        params={"model": model, "sub_model": sub_model, "response_length": "medium"},
        headers={"Authorization": f"Bearer {token}"}
    ) as r:
        if r.status != 200:
            text = await r.text()
            raise RuntimeError(f"Set model failed: {r.status} {text}")


async def create_room(session: aiohttp.ClientSession, token: str) -> str:
    """새 채팅방 생성, room_id 반환"""
    async with session.post(
        f"{BASE}/chat/start-new",
        json={"character_id": CHARACTER_ID, "opening_id": OPENING_ID},
        headers={"Authorization": f"Bearer {token}"}
    ) as r:
        if r.status not in (200, 201):
            text = await r.text()
            raise RuntimeError(f"Create room failed: {r.status} {text}")
        data = await r.json()
        return str(data["id"])


async def send_message_sse(session: aiohttp.ClientSession, token: str, room_id: str, message: str) -> dict:
    """SSE 스트리밍으로 메시지 전송, 결과 메트릭 반환"""
    t_start = time.monotonic()
    ttfb = None
    chunks = []
    final_data = None
    error_data = None

    try:
        async with session.post(
            f"{BASE}/chat/messages/stream",
            json={
                "character_id": CHARACTER_ID,
                "content": message,
                "room_id": room_id,
            },
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "text/event-stream",
            },
            timeout=aiohttp.ClientTimeout(total=180)
        ) as r:
            if r.status != 200:
                text = await r.text()
                return {"error": f"HTTP {r.status}: {text[:200]}"}

            event_name = None
            async for raw_line in r.content:
                line = raw_line.decode("utf-8", errors="replace").rstrip("\n\r")

                if line.startswith("event: "):
                    event_name = line[7:].strip()
                    continue

                if line.startswith("data: "):
                    data_str = line[6:]
                    try:
                        data = json.loads(data_str)
                    except json.JSONDecodeError:
                        continue

                    if event_name == "delta":
                        if ttfb is None:
                            ttfb = time.monotonic() - t_start
                        delta = data.get("delta", "")
                        if delta:
                            chunks.append(delta)

                    elif event_name == "final":
                        final_data = data

                    elif event_name == "error":
                        error_data = data

                    event_name = None

    except asyncio.TimeoutError:
        return {"error": "Timeout (180s)"}
    except Exception as e:
        return {"error": str(e)[:200]}

    t_total = time.monotonic() - t_start
    full_text = "".join(chunks)

    if error_data:
        return {"error": f"SSE error: {error_data.get('detail', 'unknown')}"}

    # final 이벤트에서 ai_debug 추출
    ai_debug = {}
    if final_data:
        ai_msg = final_data.get("ai_message") or {}
        meta = ai_msg.get("message_metadata") or {}
        ai_debug = meta.get("ai_debug") or {}

    cut_repaired = ai_debug.get("cut_repaired", False)
    no_dialogue = ai_debug.get("no_dialogue_line", False)

    return {
        "ttfb": round(ttfb or 0, 2),
        "total_time": round(t_total, 2),
        "chunk_count": len(chunks),
        "char_count": len(full_text),
        "narration_blocks": count_narration_blocks(full_text),
        "dialogue_bubbles": count_dialogue_bubbles(full_text),
        "choices": count_choices(full_text),
        "korean_ratio": round(korean_ratio(full_text), 3),
        "cut_repaired": cut_repaired,
        "no_dialogue": no_dialogue,
        "text_preview": full_text[:150],
    }


async def benchmark_model(session: aiohttp.ClientSession, token: str, provider: str, sub_model: str, display_name: str) -> dict:
    """단일 모델 10회 벤치마크"""
    print(f"\n{'='*60}")
    print(f"  {display_name} ({provider}/{sub_model})")
    print(f"{'='*60}")

    # 모델 설정 변경
    try:
        await set_model(session, token, provider, sub_model)
        print(f"  Model set OK")
    except Exception as e:
        print(f"  Model set FAILED: {e}")
        return {"model": display_name, "error": str(e), "runs": []}

    runs = []
    for i in range(RUNS_PER_MODEL):
        msg = MESSAGES[i % len(MESSAGES)]
        print(f"  Run {i+1}/{RUNS_PER_MODEL}: \"{msg[:20]}...\"", end="", flush=True)

        try:
            room_id = await create_room(session, token)
        except Exception as e:
            print(f" ROOM_FAIL: {e}")
            runs.append({"error": f"room creation failed: {e}"})
            continue

        result = await send_message_sse(session, token, room_id, msg)

        if "error" in result:
            print(f" ERROR: {result['error'][:60]}")
        else:
            print(f" OK ttfb={result['ttfb']}s total={result['total_time']}s chars={result['char_count']} "
                  f"narr={result['narration_blocks']} dial={result['dialogue_bubbles']} "
                  f"cut={result['cut_repaired']} kr={result['korean_ratio']}")

        runs.append(result)

        # 짧은 대기 (rate limit 방지)
        await asyncio.sleep(1)

    return {"model": display_name, "provider": provider, "sub_model": sub_model, "runs": runs}


def summarize_model(result: dict) -> dict:
    """모델 결과 요약 통계"""
    runs = [r for r in result["runs"] if "error" not in r]
    errors = [r for r in result["runs"] if "error" in r]

    if not runs:
        return {
            "model": result["model"],
            "success": 0, "errors": len(errors),
            "error_details": [r["error"][:80] for r in errors[:3]],
        }

    ttfbs = [r["ttfb"] for r in runs]
    totals = [r["total_time"] for r in runs]
    chars = [r["char_count"] for r in runs]
    narrs = [r["narration_blocks"] for r in runs]
    dials = [r["dialogue_bubbles"] for r in runs]
    choices = [r["choices"] for r in runs]
    krs = [r["korean_ratio"] for r in runs]
    cuts = sum(1 for r in runs if r["cut_repaired"])
    no_dials = sum(1 for r in runs if r["no_dialogue"])

    def stats(arr):
        if not arr:
            return {"avg": 0, "min": 0, "max": 0, "std": 0}
        return {
            "avg": round(statistics.mean(arr), 2),
            "min": round(min(arr), 2),
            "max": round(max(arr), 2),
            "std": round(statistics.stdev(arr), 2) if len(arr) > 1 else 0,
        }

    return {
        "model": result["model"],
        "provider": result.get("provider", ""),
        "sub_model": result.get("sub_model", ""),
        "success": len(runs),
        "errors": len(errors),
        "ttfb": stats(ttfbs),
        "total_time": stats(totals),
        "char_count": stats(chars),
        "narration_blocks": stats(narrs),
        "dialogue_bubbles": stats(dials),
        "choices": stats(choices),
        "korean_ratio": stats(krs),
        "cut_repaired": cuts,
        "no_dialogue": no_dials,
    }


def estimate_cost(summary: dict) -> dict:
    """모델별 예상 비용 (1회 호출 기준)"""
    name = summary["model"]
    pricing = PRICING.get(name, {"input": 0, "output": 0})

    # 추정: 평균 프롬프트 ~4000 토큰(한국어 캐릭터 프롬프트), 출력 ~avg chars/2 토큰
    avg_chars = summary.get("char_count", {}).get("avg", 0)
    est_input_tokens = 4000  # 고정 추정
    est_output_tokens = max(int(avg_chars / 2), 100)  # 한국어 1글자 ≈ 2토큰 기준으로 역산

    cost_input = (est_input_tokens / 1_000_000) * pricing["input"]
    cost_output = (est_output_tokens / 1_000_000) * pricing["output"]
    cost_total = cost_input + cost_output

    return {
        "input_price_per_1m": pricing["input"],
        "output_price_per_1m": pricing["output"],
        "est_input_tokens": est_input_tokens,
        "est_output_tokens": est_output_tokens,
        "est_cost_per_call_usd": round(cost_total, 6),
        "est_cost_per_1000_calls_usd": round(cost_total * 1000, 3),
    }


def generate_report(all_results: list, all_summaries: list) -> str:
    """마크다운 보고서 생성"""
    lines = []
    lines.append("# AI 모델 벤치마크 결과\n")
    lines.append(f"**테스트 일시**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    lines.append(f"**캐릭터**: {CHARACTER_ID}")
    lines.append(f"**오프닝**: {OPENING_ID}")
    lines.append(f"**모델당 실행 횟수**: {RUNS_PER_MODEL}")
    lines.append(f"**응답 길이 설정**: medium\n")

    # 종합 비교 테이블
    lines.append("## 종합 비교\n")
    lines.append("| 모델 | 성공 | TTFB(s) | 총시간(s) | 글자수 | 지문 | 말풍선 | 선택지 | 한국어% | 잘림 | 대사없음 |")
    lines.append("|------|------|---------|----------|--------|------|--------|--------|---------|------|---------|")

    for s in all_summaries:
        if "error_details" in s:
            lines.append(f"| {s['model']} | {s['success']}/{s['success']+s['errors']} | - | - | - | - | - | - | - | - | - |")
            continue
        lines.append(
            f"| {s['model']} "
            f"| {s['success']}/{s['success']+s['errors']} "
            f"| {s['ttfb']['avg']}±{s['ttfb']['std']} "
            f"| {s['total_time']['avg']}±{s['total_time']['std']} "
            f"| {s['char_count']['avg']}±{s['char_count']['std']} "
            f"| {s['narration_blocks']['avg']} "
            f"| {s['dialogue_bubbles']['avg']} "
            f"| {s['choices']['avg']} "
            f"| {s['korean_ratio']['avg']*100:.1f}% "
            f"| {s['cut_repaired']}/{s['success']} "
            f"| {s['no_dialogue']}/{s['success']} |"
        )

    # 가격 비교 테이블
    lines.append("\n## 가격 비교 (추정)\n")
    lines.append("| 모델 | Input $/1M | Output $/1M | 예상 출력토큰 | 1회 비용($) | 1,000회 비용($) |")
    lines.append("|------|-----------|-------------|-------------|------------|----------------|")

    for s in all_summaries:
        if "error_details" in s:
            continue
        cost = estimate_cost(s)
        lines.append(
            f"| {s['model']} "
            f"| ${cost['input_price_per_1m']:.2f} "
            f"| ${cost['output_price_per_1m']:.2f} "
            f"| ~{cost['est_output_tokens']} "
            f"| ${cost['est_cost_per_call_usd']:.5f} "
            f"| ${cost['est_cost_per_1000_calls_usd']:.2f} |"
        )

    # 속도 순위
    lines.append("\n## 속도 순위 (TTFB 기준)\n")
    ranked = sorted([s for s in all_summaries if "ttfb" in s], key=lambda x: x["ttfb"]["avg"])
    for i, s in enumerate(ranked, 1):
        lines.append(f"{i}. **{s['model']}** — TTFB {s['ttfb']['avg']}s (총 {s['total_time']['avg']}s)")

    # 품질 순위 (글자수 * 한국어비율 / 잘림비율)
    lines.append("\n## 품질 순위 (글자수 x 한국어비율, 잘림 페널티)\n")

    def quality_score(s):
        if "char_count" not in s:
            return 0
        chars = s["char_count"]["avg"]
        kr = s["korean_ratio"]["avg"]
        cut_rate = s["cut_repaired"] / max(s["success"], 1)
        no_dial_rate = s["no_dialogue"] / max(s["success"], 1)
        return chars * kr * (1 - cut_rate * 0.5) * (1 - no_dial_rate * 0.3)

    ranked_q = sorted([s for s in all_summaries if "char_count" in s], key=quality_score, reverse=True)
    for i, s in enumerate(ranked_q, 1):
        qs = quality_score(s)
        lines.append(f"{i}. **{s['model']}** — 점수 {qs:.0f} (평균 {s['char_count']['avg']}자, "
                      f"한국어 {s['korean_ratio']['avg']*100:.0f}%, "
                      f"잘림 {s['cut_repaired']}/{s['success']}, "
                      f"대사없음 {s['no_dialogue']}/{s['success']})")

    # 가성비 순위
    lines.append("\n## 가성비 순위 (품질/비용)\n")

    def value_score(s):
        qs = quality_score(s)
        cost = estimate_cost(s)
        c = cost["est_cost_per_call_usd"]
        if c <= 0:
            return 0
        return qs / (c * 100000)  # normalize

    ranked_v = sorted([s for s in all_summaries if "char_count" in s], key=value_score, reverse=True)
    for i, s in enumerate(ranked_v, 1):
        vs = value_score(s)
        cost = estimate_cost(s)
        lines.append(f"{i}. **{s['model']}** — 가성비 {vs:.1f} "
                      f"(품질 {quality_score(s):.0f}, 1회 ${cost['est_cost_per_call_usd']:.5f})")

    # 모델별 상세
    lines.append("\n---\n## 모델별 상세 결과\n")

    for result, summary in zip(all_results, all_summaries):
        lines.append(f"### {summary['model']}\n")

        if "error_details" in summary:
            lines.append(f"**에러**: {', '.join(summary['error_details'])}\n")
            continue

        lines.append(f"- 성공: {summary['success']}/{summary['success']+summary['errors']}")
        lines.append(f"- TTFB: {summary['ttfb']['avg']}s (min {summary['ttfb']['min']}, max {summary['ttfb']['max']})")
        lines.append(f"- 총시간: {summary['total_time']['avg']}s (min {summary['total_time']['min']}, max {summary['total_time']['max']})")
        lines.append(f"- 글자수: {summary['char_count']['avg']} (min {summary['char_count']['min']}, max {summary['char_count']['max']})")
        lines.append(f"- 지문: {summary['narration_blocks']['avg']}개 / 말풍선: {summary['dialogue_bubbles']['avg']}개 / 선택지: {summary['choices']['avg']}개")
        lines.append(f"- 한국어비율: {summary['korean_ratio']['avg']*100:.1f}%")
        lines.append(f"- 잘림(cut_repaired): {summary['cut_repaired']}/{summary['success']}")
        lines.append(f"- 대사없음(no_dialogue): {summary['no_dialogue']}/{summary['success']}")

        cost = estimate_cost(summary)
        lines.append(f"- 예상 비용: 1회 ${cost['est_cost_per_call_usd']:.5f}, 1000회 ${cost['est_cost_per_1000_calls_usd']:.2f}")
        lines.append("")

        # 개별 run 결과
        lines.append("| Run | TTFB | 총시간 | 글자 | 지문 | 말풍선 | 한국어% | 잘림 | 미리보기 |")
        lines.append("|-----|------|--------|------|------|--------|---------|------|---------|")
        for i, r in enumerate(result["runs"], 1):
            if "error" in r:
                lines.append(f"| {i} | - | - | - | - | - | - | - | ERROR: {r['error'][:40]} |")
            else:
                preview = r.get("text_preview", "")[:50].replace("|", "\\|").replace("\n", " ")
                lines.append(
                    f"| {i} "
                    f"| {r['ttfb']}s "
                    f"| {r['total_time']}s "
                    f"| {r['char_count']} "
                    f"| {r['narration_blocks']} "
                    f"| {r['dialogue_bubbles']} "
                    f"| {r['korean_ratio']*100:.0f}% "
                    f"| {'Y' if r['cut_repaired'] else 'N'} "
                    f"| {preview} |"
                )
        lines.append("")

    # 결론 / 추천
    lines.append("---\n## 추천 (자동 분석)\n")

    if ranked_v:
        lines.append(f"- **무료 모델 추천 (가성비 최고)**: {ranked_v[0]['model']}")
    if len(ranked_v) > 1:
        lines.append(f"- **유료 모델 추천 (품질 최고)**: {ranked_q[0]['model']}")
    if ranked:
        lines.append(f"- **최고 속도**: {ranked[0]['model']} (TTFB {ranked[0]['ttfb']['avg']}s)")

    return "\n".join(lines)


async def main():
    print(f"[{datetime.now().strftime('%H:%M:%S')}] 벤치마크 시작")
    print(f"모델 {len(MODELS)}개 x {RUNS_PER_MODEL}회 = 총 {len(MODELS)*RUNS_PER_MODEL}회 테스트\n")

    connector = aiohttp.TCPConnector(limit=5)
    async with aiohttp.ClientSession(connector=connector) as session:
        # 로그인
        print("로그인 중...")
        token = await login(session)
        print(f"토큰 획득 완료: {token[:20]}...\n")

        all_results = []
        all_summaries = []

        for provider, sub_model, display_name in MODELS:
            result = await benchmark_model(session, token, provider, sub_model, display_name)
            summary = summarize_model(result)
            all_results.append(result)
            all_summaries.append(summary)

            # 중간 결과 저장 (크래시 방지)
            try:
                report = generate_report(all_results, all_summaries)
                with open("/app/MODEL_BENCHMARK_RESULTS.md", "w", encoding="utf-8") as f:
                    f.write(report)
                print(f"\n  [중간 저장 완료: {len(all_results)}/{len(MODELS)} 모델]")
            except Exception as e:
                print(f"\n  [중간 저장 실패: {e}]")

            # 토큰 갱신 (만료 대비)
            try:
                token = await login(session)
            except Exception:
                pass  # 기존 토큰 계속 사용

        # 최종 보고서 저장
        report = generate_report(all_results, all_summaries)
        with open("/app/MODEL_BENCHMARK_RESULTS.md", "w", encoding="utf-8") as f:
            f.write(report)

        print(f"\n\n{'='*60}")
        print(f"  벤치마크 완료! 결과: /app/MODEL_BENCHMARK_RESULTS.md")
        print(f"{'='*60}")


if __name__ == "__main__":
    asyncio.run(main())
