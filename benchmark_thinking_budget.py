#!/usr/bin/env python3
"""thinkingBudget 0 vs 128 비교 벤치마크 — Gemini 3 Pro Preview"""
import asyncio, aiohttp, json, time, re, statistics
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

# 테스트할 모델 목록: (provider, sub_model)
MODELS = [
    ("gemini", "gemini-2.5-pro"),
    ("gemini", "gemini-2.5-flash"),
    ("gemini", "gemini-3-pro-preview"),
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
    dial = len(re.findall(r'["""]([^"""]+)["""]', text)) + len(re.findall(r'「([^」]+)」', text))

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
    print(f"  {sub_model} — {label}")
    print(f"{'='*60}")

    # 모델 설정
    async with session.put(f"{BASE}/me/model-settings",
                           params={"model": model, "sub_model": sub_model, "response_length": "medium"},
                           headers={"Authorization": f"Bearer {token}"}) as r:
        if r.status != 200:
            print(f"  Model set FAILED: {r.status}")
            return []

    results = []
    for i in range(10):
        msg = MESSAGES[i]
        print(f"  Run {i+1}/10: \"{msg[:20]}...\"", end="", flush=True)
        async with session.post(f"{BASE}/chat/start-new",
                                json={"character_id": CHARACTER_ID, "opening_id": OPENING_ID},
                                headers={"Authorization": f"Bearer {token}"}) as r:
            room_id = (await r.json())["id"]

        result = await run_single(session, token, msg, room_id)
        print(f" TTFB={result['ttfb']}s total={result['total']}s chars={result['chars']} dial={result['dial']} cut={result['cut']}")
        results.append(result)
        await asyncio.sleep(1)

    return results


def print_summary(label, results):
    ok = [r for r in results if r["chars"] > 0]
    if not ok:
        print(f"  {label}: ALL FAILED")
        return
    ttfbs = [r["ttfb"] for r in ok]
    totals = [r["total"] for r in ok]
    charss = [r["chars"] for r in ok]
    dials = [r["dial"] for r in ok]
    cuts = sum(1 for r in ok if r["cut"])
    no_dials = sum(1 for r in ok if r["no_dial"])
    krs = [r["kr"] for r in ok]
    print(f"  {label}:")
    print(f"    TTFB:  {statistics.mean(ttfbs):.1f}s ± {statistics.stdev(ttfbs):.1f}")
    print(f"    Total: {statistics.mean(totals):.1f}s ± {statistics.stdev(totals):.1f}")
    print(f"    Chars: {statistics.mean(charss):.0f} ± {statistics.stdev(charss):.0f}")
    print(f"    Dial:  {statistics.mean(dials):.1f}")
    print(f"    Cut:   {cuts}/10  NoDial: {no_dials}/10")
    print(f"    KR:    {statistics.mean(krs)*100:.1f}%")


async def main():
    print(f"[{datetime.now().strftime('%H:%M:%S')}] thinkingBudget 비교 벤치마크 시작")

    async with aiohttp.ClientSession() as session:
        async with session.post(f"{BASE}/auth/login", json={"email": EMAIL, "password": PASSWORD}) as r:
            token = (await r.json())["access_token"]
        print(f"토큰 획득")

        all_results = {}

        for budget in [0, 128]:
            # ai_service.py 내 _make_thinking_config 호출값을 직접 바꿀 수 없으므로
            # 서버 코드를 런타임에 패치한다 (monkey-patch via endpoint는 불가)
            # 대신 파일 수정 + reload 방식 사용
            print(f"\n>>> thinkingBudget={budget} 로 설정 중...")

            # 파일 내 budget 값 교체
            import subprocess
            if budget == 0:
                subprocess.run(["sed", "-i", "s/_make_thinking_config(128)/_make_thinking_config(0)/g", "/app/app/services/ai_service.py"], check=True)
            else:
                subprocess.run(["sed", "-i", "s/_make_thinking_config(0)/_make_thinking_config(128)/g", "/app/app/services/ai_service.py"], check=True)

            # uvicorn --reload 이 자동 감지하도록 잠시 대기
            await asyncio.sleep(5)

            # 토큰 갱신
            async with session.post(f"{BASE}/auth/login", json={"email": EMAIL, "password": PASSWORD}) as r:
                token = (await r.json())["access_token"]

            for model, sub_model in MODELS:
                key = f"{sub_model}_budget{budget}"
                results = await run_10(session, token, model, sub_model, f"budget={budget}")
                all_results[key] = results

        # 최종 복원: 128로
        import subprocess
        subprocess.run(["sed", "-i", "s/_make_thinking_config(0)/_make_thinking_config(128)/g", "/app/app/services/ai_service.py"], check=True)

        # 종합 비교
        print(f"\n\n{'='*70}")
        print("종합 비교: thinkingBudget 0 vs 128")
        print(f"{'='*70}")

        for model, sub_model in MODELS:
            print(f"\n--- {sub_model} ---")
            k0 = f"{sub_model}_budget0"
            k128 = f"{sub_model}_budget128"
            if k0 in all_results:
                print_summary("budget=0", all_results[k0])
            if k128 in all_results:
                print_summary("budget=128", all_results[k128])


asyncio.run(main())
