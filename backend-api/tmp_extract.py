import os
import sys
from pathlib import Path
os.environ['PYTHONUTF8'] = '1'
os.environ['PYTHONIOENCODING'] = 'utf-8'
lines = Path('app/api/chat.py').read_text(encoding='utf-8').splitlines()
start = int(sys.argv[1]) if len(sys.argv) > 1 else 4000
end = int(sys.argv[2]) if len(sys.argv) > 2 else start + 200
for i in range(start, min(end, len(lines))):
    print(f"{i+1}: {lines[i]}")
