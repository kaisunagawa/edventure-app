"""別の関数の中でしか定義されていない「定数」を、外から参照していないかを調べる。

2026-08-05に本番で2回やった:
  ・App に無い game を設定画面へ渡した → アプリ全体が開かなくなった
  ・設定画面のローカル RANK_RULES を攻略本から参照 → 攻略本を開くと落ちた
どちらも構文は正しく、node --check も依存配列の検査も通ってしまう。

対象は大文字始まりの定数名（RANK_RULES / HIDDEN_JIRO のような形）だけにする。
小文字の一時変数まで見ると、入れ子の関数スコープを追えず誤検出だらけになる。
事故はどちらも「共有のつもりの定数が、実は関数の中にあった」形だった。
"""
import re, sys

src = open("index.html", encoding="utf-8").read()
lines = src.split("\n")

def strip_noise(t):
    t = re.sub(r'/\*.*?\*/', ' ', t, flags=re.S)
    t = re.sub(r'^\s*//[^\n]*', ' ', t, flags=re.M)
    t = re.sub(r'"(?:[^"\\]|\\.)*"', '""', t)
    t = re.sub(r"'(?:[^'\\]|\\.)*'", "''", t)
    # ★テンプレート文字列は消さない★
    #   この画面のコードはほとんどが html`...` の中にあるため、丸ごと消すと
    #   中の参照が全く見えなくなる（実際、それで RANK_RULES を見逃した）。
    t = re.sub(r'\.\s*[A-Za-z_$][\w$]*', '.', t)     # プロパティ参照
    t = re.sub(r'[A-Za-z_$][\w$]*\s*:', ':', t)      # オブジェクトのキー
    return t

CONST = re.compile(r'^[A-Z][A-Z0-9_]{2,}$')

fn_starts = [(i, m.group(1)) for i, ln in enumerate(lines)
             for m in [re.match(r'^function ([A-Za-z_$][\w$]*)\s*\(', ln)] if m]

GLOBAL = set(re.findall(r'^(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)', src, re.M))

bodies, locals_ = {}, {}
for idx, (start, fname) in enumerate(fn_starts):
    end = fn_starts[idx + 1][0] if idx + 1 < len(fn_starts) else len(lines)
    raw = "\n".join(lines[start:end])
    bodies[fname] = (start + 1, strip_noise(raw))
    # const A=1, B=2 のような多重宣言も拾う
    names = set()
    for decl in re.findall(r'^\s+(?:const|let|var)\s+([^;\n]*)', raw, re.M):
        for part in decl.split(','):
            m2 = re.match(r'\s*([A-Za-z_$][\w$]*)\s*=', part)
            if m2: names.add(m2.group(1))
    locals_[fname] = {n for n in names if CONST.match(n) and n not in GLOBAL}

owner = {}
for fname, ns in locals_.items():
    for n in ns:
        owner.setdefault(n, set()).add(fname)

bad = []
for fname, (lineno, body) in bodies.items():
    for n in set(re.findall(r'\b([A-Z][A-Z0-9_]{2,})\b', body)):
        if n in GLOBAL or n in locals_[fname]:
            continue
        homes = owner.get(n)
        if homes and fname not in homes:
            bad.append((lineno, fname, n, sorted(homes)[0]))

if bad:
    print("✗ 別の関数の中の定数を参照しています（開いた瞬間に落ちます）")
    for lineno, fname, n, home in sorted(set(bad)):
        print(f"    index.html:{lineno}  {fname} が {n} を参照 … {n} は {home} の中にしかありません")
    sys.exit(1)
print("✓ 参照している定数が全て見える場所にある")
