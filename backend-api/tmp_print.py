import os
import sys
from pathlib import Path
os.environ['PYTHONUTF8'] = '1'
os.environ['PYTHONIOENCODING'] = 'utf-8'
if len(sys.argv) < 4:
    raise SystemExit('Usage: tmp_print.py <path> <start> <end>')
fpath = Path(sys.argv[1])
start = int(sys.argv[2])
end = int(sys.argv[3])
lines = fpath.read_text(encoding='utf-8', errors='ignore').splitlines()
for i in range(start-1, min(end, len(lines))):
    print(f"{i+1}: {lines[i]}")
