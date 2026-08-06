"""useEffect の依存配列が、宣言より前の変数を見ていないか調べる。

依存配列は描画のたびにその場で評価されるので、宣言より前に書くと
"Cannot access 'x' before initialization" で画面が真っ赤になる（2026-08-05に発生）。
関数の中での参照は後から動くので問題ない。ここでは依存配列だけを見る。
"""
import re, sys
s = open("index.html").read()
bad = []
for m in re.finditer(r'^function ([A-Z]\w+)\(', s, re.M):
    name = m.group(1); start = m.end()
    nxt = re.search(r'^(function |const [A-Z]\w+ =)', s[start:], re.M)
    body = s[start: start + (nxt.start() if nxt else len(s)-start)]
    lines = body.split("\n")
    decl = {}
    for d in re.finditer(r'^\s*const (?:\[([\w, ]+)\]|(\w+))\s*=', body, re.M):
        ln = body[:d.start()].count("\n")
        for nm in ((d.group(1) or "").split(",") if d.group(1) else [d.group(2)]):
            nm = nm.strip()
            if nm and nm not in decl: decl[nm] = ln
    for dep in re.finditer(r'\}\s*,\s*\[([^\]]*)\]\s*\)', body):
        ln = body[:dep.start()].count("\n")
        for nm in re.findall(r'[A-Za-z_]\w*', dep.group(1)):
            if nm in decl and decl[nm] > ln:
                bad.append(f"{name}: 依存配列の {nm} が宣言({decl[nm]+1}行目)より前({ln+1}行目)にあります")
if bad:
    print("✗ 依存配列の順番がおかしい箇所:")
    for b in bad: print("   ", b)
    sys.exit(1)
print("✓ 依存配列の順番")
