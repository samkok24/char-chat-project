#!/usr/bin/env python3
"""GPT-5.2 벤치마크 (10회)"""
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
    dial = len(re.findall(r'["\u201c\u201d]([^"\u201c\u201d]+)["\u201c\u201d]', text))

    return {
        "ttfb": round(ttfb or 0, 2),
        "total": round(total, 2),
        "chars": len(text),
        "dial": dial,
        "cut": cut,
        "no_dial": no_dial,
        "kr": round(kr_ratio, 3),
    }


async def main():
    print(f"[{datetime.now().strftime('%H:%M:%S')}] GPT-5.2 benchmark (10 runs)")

    async with aiohttp.ClientSession() as session:
        async with session.post(f"{BASE}/auth/login", json={"email": EMAIL, "password": PASSWORD}) as r:
            token = (await r.json())["access_token"]
        print(f"token OK")

        # Set model
        async with session.put(f"{BASE}/me/model-settings",
                               params={"model": "gpt", "sub_model": "gpt-5.2", "response_length": "medium"},
                               headers={"Authorization": f"Bearer {token}"}) as r:
            if r.status != 200:
                body = await r.text()
                print(f"Model set FAILED: {r.status} {body[:200]}")
                return
        print("Model set: gpt-5.2")

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
                results.append({"ttfb": 0, "total": 0, "chars": 0, "dial": 0, "cut": False, "no_dial": True, "kr": 0})
            await asyncio.sleep(1.5)

        # Summary
        ok = [r for r in results if r["chars"] > 0]
        if not ok:
            print("\nALL FAILED (0/10)")
            return

        ttfbs = [r["ttfb"] for r in ok]
        totals = [r["total"] for r in ok]
        charss = [r["chars"] for r in ok]
        dials = [r["dial"] for r in ok]
        cuts = sum(1 for r in ok if r["cut"])
        no_dials = sum(1 for r in ok if r["no_dial"])
        krs = [r["kr"] for r in ok]

        print(f"\n{'='*60}")
        print(f"  GPT-5.2 ({len(ok)}/10)")
        print(f"{'='*60}")
        print(f"  TTFB:    {statistics.mean(ttfbs):.2f}s ± {statistics.stdev(ttfbs):.2f}" if len(ttfbs) > 1 else f"  TTFB:    {ttfbs[0]:.2f}s")
        print(f"  Total:   {statistics.mean(totals):.2f}s ± {statistics.stdev(totals):.2f}" if len(totals) > 1 else f"  Total:   {totals[0]:.2f}s")
        print(f"  Chars:   {statistics.mean(charss):.0f} ± {statistics.stdev(charss):.0f}" if len(charss) > 1 else f"  Chars:   {charss[0]}")
        print(f"  Dial:    {statistics.mean(dials):.1f}")
        print(f"  Cut:     {cuts}/10  NoDial: {no_dials}/10")
        print(f"  KR:      {statistics.mean(krs)*100:.1f}%")

        # Cost estimate
        avg_chars = statistics.mean(charss)
        avg_out_tokens = avg_chars * 1.5
        reasoning_tokens = 300
        input_cost = 2000 * 1.75 / 1_000_000
        output_cost = avg_out_tokens * 14.00 / 1_000_000
        reasoning_cost = reasoning_tokens * 14.00 / 1_000_000
        total_cost = input_cost + output_cost + reasoning_cost
        won_per_turn = total_cost * 1430
        print(f"\n  Cost:    ${total_cost:.4f}/turn = {won_per_turn:.1f}원/turn")


asyncio.run(main())
