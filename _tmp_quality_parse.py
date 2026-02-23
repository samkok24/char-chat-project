import re
from collections import defaultdict

path = "_speedtest_logs_v3.txt"

param_re = re.compile(r"\('(?P<id>[0-9a-f\-]{36})',\s*'(?P<room>[0-9a-f\-]{36})',\s*'(?P<sender>[^']+)',\s*'(?P<content>.*)'\s*,\s*'\{\}'\s*,\s*\d+\s*,\s*\d+\)" )
http_call_re = re.compile(r"\[ai\] http_call .*?provider=(?P<prov>\w+).*?model=(?P<model>[^\s]+)")

with open(path, 'r', encoding='utf-16', errors='ignore') as f:
    lines = list(f)

msgs = []
for ln in lines:
    m = param_re.search(ln)
    if m:
        msgs.append({
            'room': m.group('room'),
            'sender': m.group('sender'),
            'content': m.group('content'),
        })

calls = []
for ln in lines:
    m = http_call_re.search(ln)
    if m:
        prov = m.group('prov')
        model = m.group('model')
        prov_norm = 'gpt' if prov == 'openai' else prov
        calls.append(f"{prov_norm}/{model}")

room_counts = defaultdict(int)
for m in msgs:
    if m['sender'] == 'user' and '[SPDTEST-V3]' in m['content']:
        room_counts[m['room']] += 1

if not room_counts:
    print('NO_SPDTEST_USER_MESSAGES_FOUND')
    raise SystemExit(0)

room = max(room_counts.items(), key=lambda x: x[1])[0]
room_msgs = [m for m in msgs if m['room'] == room]
spd_users = [m for m in room_msgs if m['sender'] == 'user' and '[SPDTEST-V3]' in m['content']]
non_users = [m for m in room_msgs if m['sender'] != 'user']

print(f"test_room={room} spd_user_msgs={len(spd_users)} non_user_msgs={len(non_users)} http_calls={len(calls)}")

senders = defaultdict(int)
for m in non_users:
    senders[m['sender']] += 1
print('non_user_sender_types=' + ','.join([f"{k}:{v}" for k,v in sorted(senders.items())]))

for i, m in enumerate(non_users[:5]):
    c = m['content'].replace('\\n', '\n')
    print('--- AI_SAMPLE', i+1)
    print(c[:400])
