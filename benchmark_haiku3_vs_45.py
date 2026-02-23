#!/usr/bin/env python3
"""Claude 3 Haiku vs Haiku 4.5 비교 벤치마크"""
import asyncio, aiohttp, json, time, re, statistics
from datetime import datetime

BASE = "http://localhost:18000"
EMAIL = "samkok24@gmail.com"
PASSWORD = "aaaaaaaaa"
CHARACTER_ID = "255833e3-35d2-4058-a128-8fac7ac39c6b"
OPENING_ID = "set_1"

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

MODELS = [
    ("claude", "claude-3-haiku-20240307", "Claude 3 Haiku (old)"),
    ("claude", "claude-haiku-4-5-20251001", "Claude Haiku 4.5 (current)"),
]


async def run_single(session, token, msg, room_id):
    t0 = time.monotonic()
    ttfb = None
    chunks = []
    final_data = None

    async with session.post(f"{BASE}/chat/messages/stream",
                            json={"character_id": CHARACTER_ID, "content": msg, "room_id": room_id},
                            headers={"Authorization": f"Bearer {token}", "Accept": "text/event-stream"},
                            timeout=aiohttp.ClientTimeout(total=180)) as r:
        ev = None
        async for raw in r.content:
            line = raw.decode("utf-8", errors="replace").rstrip("\n\r")
            if line.startswith("event: "):
                ev = line[7:].strip()
                continue
            if line.startswith("data: "):
                try:
                    d = json.loads(line[6:])
                except:
                    continue
                if ev == "delta":
                    if ttfb is None:
                        ttfb = time.monotonic() - t0
                    delta = d.get("delta", "")
                    if delta:
                        chunks.append(delta)
                elif ev == "final":
                    final_data = d
                ev = None

    total = time.monotonic() - t0
    text = "".join(chunks)

    ai_debug = {}
    if final_data:
        ai_msg = final_data.get("ai_message") or {}
        meta = ai_msg.get("message_metadata") or {}
        ai_debug = meta.get("ai_debug") or {}

    cut = ai_debug.get("cut_repaired", False)
    no_dial = ai_debug.get("no_dialogue_line", False)
    kr = len(re.findall(r'[가-힣]', text))
    en = len(re.findall(r'[a-zA-Z]', text))
    kr_ratio = kr / (kr + en) if (kr + en) > 0 else 1.0
    dial = len(re.findall(r'["\u201c\u201d]([^"\u201c\u201d]+)["\u201c\u201d]', text)) + len(re.findall(r'\u300c([^\u300d]+)\u300d', text))

    return {
        "ttfb": round(ttfb or 0, 2),
        "total": round(total, 2),
        "chars": len(text),
        "dial": dial,
        "cut": cut,
        "no_dial": no_dial,
        "kr": round(kr_ratio, 3),
        "preview": text[:80],
    }


async def run_10(session, token, model, sub_model, label):
    print(f"\n{'='*60}")
    print(f"  {label} ({sub_model})")
    print(f"{'='*60}")

    async with session.put(f"{BASE}/me/model-settings",
                           params={"model": model, "sub_model": sub_model, "response_length": "medium"},
                           headers={"Authorization": f"Bearer {token}"}) as r:
        if r.status != 200:
            body = await r.text()
            print(f"  Model set FAILED: {r.status} {body[:200]}")
            return []

    results = []
    for i in range(10):
        msg = MESSAGES[i]
        print(f"  Run {i+1}/10: \"{msg[:20]}...\"", end="", flush=True)
        async with session.post(f"{BASE}/chat/start-new",
                                json={"character_id": CHARACTER_ID, "opening_id": OPENING_ID},
                                headers={"Authorization": f"Bearer {token}"}) as r:
            data = await r.json()
            room_id = data["id"]

        try:
            result = await run_single(session, token, msg, room_id)
            print(f" TTFB={result['ttfb']}s total={result['total']}s chars={result['chars']} dial={result['dial']} cut={result['cut']}")
            if result['chars'] == 0:
                print(f"    EMPTY RESPONSE")
            results.append(result)
        except Exception as e:
            print(f" ERROR: {e}")
            results.append({"ttfb": 0, "total": 0, "chars": 0, "dial": 0, "cut": False, "no_dial": True, "kr": 0, "preview": f"ERROR: {e}"})
        await asyncio.sleep(1.5)

    return results


def print_summary(label, results):
    ok = [r for r in results if r["chars"] > 0]
    if not ok:
        print(f"  {label}: ALL FAILED (0/10)")
        return
    ttfbs = [r["ttfb"] for r in ok]
    totals = [r["total"] for r in ok]
    charss = [r["chars"] for r in ok]
    dials = [r["dial"] for r in ok]
    cuts = sum(1 for r in ok if r["cut"])
    no_dials = sum(1 for r in ok if r["no_dial"])
    krs = [r["kr"] for r in ok]
    std_t = statistics.stdev(ttfbs) if len(ttfbs) > 1 else 0
    std_total = statistics.stdev(totals) if len(totals) > 1 else 0
    std_chars = statistics.stdev(charss) if len(charss) > 1 else 0
    print(f"  {label} ({len(ok)}/10):")
    print(f"    TTFB:  {statistics.mean(ttfbs):.2f}s +/- {std_t:.2f}")
    print(f"    Total: {statistics.mean(totals):.2f}s +/- {std_total:.2f}")
    print(f"    Chars: {statistics.mean(charss):.0f} +/- {std_chars:.0f}")
    print(f"    Dial:  {statistics.mean(dials):.1f}")
    print(f"    Cut:   {cuts}/10  NoDial: {no_dials}/10")
    print(f"    KR:    {statistics.mean(krs)*100:.1f}%")


async def main():
    print(f"[{datetime.now().strftime('%H:%M:%S')}] Claude 3 Haiku vs Haiku 4.5 benchmark")

    async with aiohttp.ClientSession() as session:
        async with session.post(f"{BASE}/auth/login", json={"email": EMAIL, "password": PASSWORD}) as r:
            token = (await r.json())["access_token"]
        print(f"token OK")

        all_results = {}
        for model, sub_model, label in MODELS:
            results = await run_10(session, token, model, sub_model, label)
            all_results[sub_model] = (label, results)

        print(f"\n\n{'='*70}")
        print("Claude 3 Haiku vs Haiku 4.5 comparison")
        print(f"{'='*70}")
        for _, sub_model, label in MODELS:
            if sub_model in all_results:
                print_summary(all_results[sub_model][0], all_results[sub_model][1])

        # Cost comparison
        print(f"\n{'='*70}")
        print("Cost comparison (API cost per turn)")
        print(f"{'='*70}")
        print(f"  Claude 3 Haiku:  $0.25/$1.25 per 1M -> ~$0.0012/turn -> 1.7 won/turn")
        print(f"  Claude Haiku 4.5: $0.80/$4.00 per 1M -> ~$0.0039/turn -> 5.6 won/turn")
        print(f"  Ratio: Haiku 4.5 is 3.3x more expensive")


asyncio.run(main())
