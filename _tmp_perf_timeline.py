import re
from collections import defaultdict

path = "_speedtest_logs_v3.txt"

# Example:
# 2026-01-12 09:42:20,270 INFO:app.api.chat:[send_message] perf ... model=gemini/gemini-2.5-flash ... dtAiMs=...
perf_re = re.compile(r"(?P<ts>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3}).*?\[send_message\] perf .*?model=(?P<prov>[^/\s]+)/(?P<sub>[^\s]+).*?dtAiMs=(?P<ai>\d+).*?dtTotalMs=(?P<total>\d+)")
chat_done_re = re.compile(r"\[(?P<ts>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\].*?\[chat\] send_message <- backend done .*?dtMs=(?P<dt>\d+)")

with open(path, 'r', encoding='utf-16', errors='ignore') as f:
    lines = list(f)

perfs = []
for ln in lines:
    m = perf_re.search(ln)
    if m:
        perfs.append({
            'ts': m.group('ts'),
            'model': f"{m.group('prov')}/{m.group('sub')}",
            'dtAiMs': int(m.group('ai')),
            'dtTotalMs': int(m.group('total')),
        })

chat_dones = []
for ln in lines:
    m = chat_done_re.search(ln)
    if m:
        chat_dones.append({
            'ts': m.group('ts'),
            'dtMs': int(m.group('dt')),
        })

print('perf_lines', len(perfs), 'chat_done', len(chat_dones))

# assume sequential alignment as before
n = min(len(perfs), len(chat_dones))
perfs = perfs[:n]
chat_dones = chat_dones[:n]

for i in range(n):
    perfs[i]['chat_dtMs'] = chat_dones[i]['dtMs']

# print in chronological order
for i, p in enumerate(perfs, 1):
    print(f"{i:02d}\t{p['ts']}\t{p['model']}\tdtAiMs={p['dtAiMs']}\tdtTotalMs={p['dtTotalMs']}\tchat_dtMs={p['chat_dtMs']}")

# group-by-3 summary (test batches)
print('\nBATCHES(3 turns each):')
for b in range(0, n, 3):
    chunk = perfs[b:b+3]
    if len(chunk) < 3:
        break
    m = chunk[0]['model']
    ok = all(x['model']==m for x in chunk)
    t0, t2 = chunk[0]['ts'], chunk[-1]['ts']
    print(f"{b//3+1:02d}\t{m}\tconsistent={ok}\t{t0} ~ {t2}\tdtAiMs={[x['dtAiMs'] for x in chunk]}")
