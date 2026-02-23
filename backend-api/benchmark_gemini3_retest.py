#!/usr/bin/env python3
"""Gemini 3 Pro Preview 단독 재테스트 (maxOutputTokens 4096 적용 후)"""
import asyncio, aiohttp, json, time, re, sys
from datetime import datetime

BASE = "http://localhost:8000"
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


async def main():
    print(f"[{datetime.now().strftime('%H:%M:%S')}] Gemini 3 Pro Preview 재테스트 시작")
    async with aiohttp.ClientSession() as session:
        # 로그인
        async with session.post(f"{BASE}/auth/login", json={"email": EMAIL, "password": PASSWORD}) as r:
            token = (await r.json())["access_token"]
        print(f"토큰 획득")

        # 모델 설정
        async with session.put(f"{BASE}/me/model-settings",
                               params={"model": "gemini", "sub_model": "gemini-3-pro-preview", "response_length": "medium"},
                               headers={"Authorization": f"Bearer {token}"}) as r:
            print(f"모델 설정: {r.status}")

        results = []
        for i in range(10):
            msg = MESSAGES[i]
            print(f"\nRun {i+1}/10: \"{msg[:25]}...\"", end="", flush=True)

            # 새 채팅방
            async with session.post(f"{BASE}/chat/start-new",
                                    json={"character_id": CHARACTER_ID, "opening_id": OPENING_ID},
                                    headers={"Authorization": f"Bearer {token}"}) as r:
                room_id = (await r.json())["id"]

            # SSE 메시지
            t0 = time.monotonic()
            ttfb = None
            chunks = []
            final_data = None

            async with session.post(f"{BASE}/chat/messages/stream",
                                    json={"character_id": CHARACTER_ID, "content": msg, "room_id": room_id},
                                    headers={"Authorization": f"Bearer {token}", "Accept": "text/event-stream"},
                                    timeout=aiohttp.ClientTimeout(total=180)) as r:
                event_name = None
                async for raw_line in r.content:
                    line = raw_line.decode("utf-8", errors="replace").rstrip("\n\r")
                    if line.startswith("event: "):
                        event_name = line[7:].strip()
                        continue
                    if line.startswith("data: "):
                        try:
                            data = json.loads(line[6:])
                        except:
                            continue
                        if event_name == "delta":
                            if ttfb is None:
                                ttfb = time.monotonic() - t0
                            delta = data.get("delta", "")
                            if delta:
                                chunks.append(delta)
                        elif event_name == "final":
                            final_data = data
                        event_name = None

            t_total = time.monotonic() - t0
            full = "".join(chunks)

            ai_debug = {}
            if final_data:
                ai_msg = final_data.get("ai_message") or {}
                meta = ai_msg.get("message_metadata") or {}
                ai_debug = meta.get("ai_debug") or {}

            cut = ai_debug.get("cut_repaired", False)
            no_dial = ai_debug.get("no_dialogue_line", False)

            kr = len(re.findall(r'[가-힣]', full))
            en = len(re.findall(r'[a-zA-Z]', full))
            kr_ratio = kr / (kr + en) if (kr + en) > 0 else 1.0

            # 말풍선/지문 카운트
            dial = len(re.findall(r'["""]([^"""]+)["""]', full)) + len(re.findall(r'「([^」]+)」', full))

            print(f" ttfb={ttfb:.1f}s total={t_total:.1f}s chars={len(full)} dial={dial} cut={cut} kr={kr_ratio:.2f}")
            print(f"  Preview: {full[:120]}")

            results.append({
                "ttfb": round(ttfb or 0, 2),
                "total": round(t_total, 2),
                "chars": len(full),
                "dial": dial,
                "cut": cut,
                "no_dial": no_dial,
                "kr": round(kr_ratio, 3),
            })
            await asyncio.sleep(1)

        # 요약
        print(f"\n{'='*60}")
        print("Gemini 3 Pro Preview 재테스트 요약:")
        import statistics
        ttfbs = [r["ttfb"] for r in results]
        totals = [r["total"] for r in results]
        charss = [r["chars"] for r in results]
        dials = [r["dial"] for r in results]
        cuts = sum(1 for r in results if r["cut"])
        no_dials = sum(1 for r in results if r["no_dial"])
        krs = [r["kr"] for r in results]

        print(f"  TTFB: {statistics.mean(ttfbs):.1f}s ± {statistics.stdev(ttfbs):.1f}")
        print(f"  Total: {statistics.mean(totals):.1f}s ± {statistics.stdev(totals):.1f}")
        print(f"  Chars: {statistics.mean(charss):.0f} ± {statistics.stdev(charss):.0f}")
        print(f"  Dialogue: {statistics.mean(dials):.1f}")
        print(f"  Cut: {cuts}/10, No dialogue: {no_dials}/10")
        print(f"  Korean: {statistics.mean(krs)*100:.1f}%")
        print(f"{'='*60}")

asyncio.run(main())
