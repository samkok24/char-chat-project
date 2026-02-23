import json
import sys


def _uniq_preserve(arr):
    out = []
    seen = set()
    for x in arr:
        s = str(x or "").strip()
        if not s:
            continue
        k = s.lower()
        if k in seen:
            continue
        seen.add(k)
        out.append(s)
    return out


def main():
    # Usage:
    #   python _tmp_market_hook_tokens_report.py [mode] [gender]
    # Example:
    #   python _tmp_market_hook_tokens_report.py roleplay male
    mode = (sys.argv[1] if len(sys.argv) > 1 else "roleplay").strip()
    gender = (sys.argv[2] if len(sys.argv) > 2 else "male").strip()

    p = r"backend-api\app\services\market_style_tokens.json"
    with open(p, "r", encoding="utf-8") as f:
        data = json.load(f)

    block = data.get(mode) if isinstance(data, dict) else {}
    block = block if isinstance(block, dict) else {}
    g = block.get(gender) if isinstance(block, dict) else {}
    g = g if isinstance(g, dict) else {}

    toks = g.get("hook_tokens")
    toks = toks if isinstance(toks, list) else []
    uniq = _uniq_preserve(toks)

    needles = ["계약", "약속", "거래"]
    any_hit = []
    for s in uniq:
        if any(k in s for k in needles):
            any_hit.append(s)

    print(f"mode={mode} gender={gender}")
    print(f"hook_tokens_total={len(toks)}")
    print(f"hook_tokens_unique={len(uniq)}")
    print("---")
    for k in needles:
        ks = [s for s in uniq if k in s]
        print(f"contains[{k}]={len(ks)}")
    print(f"contains_any(계약/약속/거래)={len(any_hit)}")

    print("\n## matched_tokens (unique)")
    for s in any_hit:
        print("-", s)

    # 너무 길면 파일로 저장
    if len(uniq) > 250:
        out_path = "_tmp_market_hook_tokens_roleplay_male.txt" if (mode == "roleplay" and gender == "male") else f"_tmp_market_hook_tokens_{mode}_{gender}.txt"
        with open(out_path, "w", encoding="utf-8") as wf:
            for s in uniq:
                wf.write(s + "\n")
        print(f"\n## full_list_written_to\n{out_path}")
        print("head10:", uniq[:10])
        print("tail10:", uniq[-10:])
    else:
        print("\n## full_list (unique, ordered)")
        for s in uniq:
            print("-", s)


if __name__ == "__main__":
    main()

