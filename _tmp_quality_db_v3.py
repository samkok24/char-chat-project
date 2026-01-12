import re
import sqlite3
from collections import defaultdict

LOG_PATH = "_speedtest_logs_v3.txt"
DB_PATH = "backend-api/data/test.db"
ROOM_ID = "e31e6510-02b9-42c3-a03f-55c014a5de51"
OUT_PATH = "_quality_report_v3.md"

def read_lines(path):
    for enc in ("utf-16", "utf-8"):
        try:
            with open(path, "r", encoding=enc, errors="ignore") as f:
                lines = f.readlines()
            if any("[send_message] perf" in ln for ln in lines):
                return lines, enc
        except Exception:
            pass
    return [], None

lines, enc = read_lines(LOG_PATH)
perf_re = re.compile(r"\[send_message\] perf .*?model=(?P<prov>[^/\s]+)/(?P<sub>[^\s]+).*?dtTotalMs=(?P<total>\d+).*?dtAiMs=(?P<ai>\d+)")
perf_models = []
for ln in lines:
    m = perf_re.search(ln)
    if m:
        perf_models.append(f"{m.group('prov')}/{m.group('sub')}")

con = sqlite3.connect(DB_PATH)
con.row_factory = sqlite3.Row
cur = con.cursor()
rows = cur.execute(
    "SELECT id, chat_room_id, sender_type, content, created_at FROM chat_messages WHERE chat_room_id=? ORDER BY created_at ASC",
    (ROOM_ID,),
).fetchall()

pairs = []
for i, r in enumerate(rows):
    if r["sender_type"] != "user":
        continue
    content = r["content"] or ""
    if not content.startswith("[SPDTEST-V3]"):
        continue
    j = i + 1
    while j < len(rows) and rows[j]["sender_type"] == "user":
        j += 1
    if j >= len(rows):
        continue
    if rows[j]["sender_type"] != "assistant":
        continue
    pairs.append({
        "user": content,
        "assistant": rows[j]["content"] or "",
        "user_created_at": r["created_at"],
        "assistant_created_at": rows[j]["created_at"],
    })

N = min(len(perf_models), len(pairs))
perf_models = perf_models[-N:]
pairs = pairs[-N:]

emoji_re = re.compile(r"[\U0001F300-\U0001FAFF]")

def sentence_count(text: str) -> int:
    t = (text or "").strip()
    if not t:
        return 0
    parts = []
    for line in t.splitlines():
        line = line.strip()
        if not line:
            continue
        ends = re.split(r"(?<=[\.!\?])\s+", line)
        for e in ends:
            e = e.strip()
            if e:
                parts.append(e)
    return len(parts) if parts else 0

by_model = defaultdict(lambda: {"n":0, "ok_fail":0, "sent_out":0, "label":0, "emoji":0, "samples":[]})

for model, p in zip(perf_models, pairs):
    a = (p["assistant"] or "").strip()
    sc = sentence_count(a)
    ends_ok = a.endswith("OK.")
    has_label = ("罹먮┃??" in a) or ("Character:" in a)
    has_emoji = bool(emoji_re.search(a))
    sent_ok = (4 <= sc <= 6)

    m = by_model[model]
    m["n"] += 1
    if not ends_ok:
        m["ok_fail"] += 1
    if not sent_ok:
        m["sent_out"] += 1
    if has_label:
        m["label"] += 1
    if has_emoji:
        m["emoji"] += 1

    if (not ends_ok) or (not sent_ok) or has_label or has_emoji:
        if len(m["samples"]) < 2:
            # keep raw text but truncate
            m["samples"].append(a[:400])

items = sorted(by_model.items(), key=lambda kv: (kv[1]["ok_fail"]+kv[1]["sent_out"]+kv[1]["label"]+kv[1]["emoji"], kv[0]))

with open(OUT_PATH, "w", encoding="utf-8") as out:
    out.write(f"# SPDTEST-V3 ?덉쭏 泥댄겕 由ы룷??n\n")
    out.write(f"- room: `{ROOM_ID}`\n")
    out.write(f"- perf_lines: `{len(perf_models)}` (log enc: `{enc}`)\n")
    out.write(f"- spd_pairs: `{len(pairs)}`\n\n")

    out.write("## 紐⑤뜽蹂?洹쒖튃 ?꾨컲 移댁슫??(3??湲곗?)\n\n")
    out.write("| model | N | OK. 誘몄???| 臾몄옣??4~6) ?댄깉 | ?쇰꺼(罹먮┃??) | ?대え吏 |\n")
    out.write("|---|---:|---:|---:|---:|---:|\n")
    for model, m in items:
        out.write(f"| `{model}` | {m['n']} | {m['ok_fail']} | {m['sent_out']} | {m['label']} | {m['emoji']} |\n")

    out.write("\n## ?댁뒋 ?섑뵆(理쒕? 2媛?紐⑤뜽)\n\n")
    for model, m in items:
        if not m["samples"]:
            continue
        out.write(f"### `{model}`\n\n")
        for s in m["samples"]:
            out.write("```\n")
            out.write(s)
            out.write("\n```\n\n")

print(f"WROTE {OUT_PATH}")
