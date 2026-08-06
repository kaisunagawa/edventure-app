"""コンポーネントに渡している値が、その場所に存在するかを調べる。

2026-08-05、App には無い `game` を SettingsScreen に渡してしまい、
本番で「Can't find variable: game」が出てアプリ全体が開かなくなった。
依存配列の検査（check_deps.py）は宣言順しか見ないため、これは通ってしまう。

やり方: `<${Comp} ... prop=${x} ... />` の中の裸の変数 x を集め、
その変数が「その関数の中」で定義されているかを見る。
"""
import re, sys

src = open("index.html", encoding="utf-8").read()
lines = src.split("\n")

# 関数（コンポーネント）の開始行を集める
fn_starts = []
for i, ln in enumerate(lines):
    m = re.match(r'^function ([A-Za-z_$][\w$]*)\s*\(', ln)
    if m:
        fn_starts.append((i, m.group(1)))

def owner(idx):
    cur = None
    for i, name in fn_starts:
        if i <= idx:
            cur = (i, name)
        else:
            break
    return cur

# グローバルに定義されているもの（関数の外）
GLOBAL = set(re.findall(r'^(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)', src, re.M))
BUILTIN = {"true","false","null","undefined","window","document","location",
           "localStorage","Math","JSON","Date","String","Number","Object","Array",
           "html","React","ReactDOM","console","navigator","setTimeout","e"}

bad = []
for idx, ln in enumerate(lines):
    if "<${" not in ln:
        continue
    o = owner(idx)
    if not o:
        continue
    start, fname = o
    # 関数の終わりを次の関数の開始とみなす（1ファイル・トップレベル関数のみ）
    end = len(lines)
    for i, _ in fn_starts:
        if i > start:
            end = i
            break
    body = "\n".join(lines[start:end])
    local = set(re.findall(r'(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)', body))
    # 分割代入 const {a,b}= / const [a,b]=
    for grp in re.findall(r'(?:const|let|var)\s*[\{\[]([^\}\]]*)[\}\]]\s*=', body):
        local |= set(re.findall(r'[A-Za-z_$][\w$]*', grp))
    # アロー関数の引数  (a,i)=> / x=>
    for grp in re.findall(r'\(([^()]*)\)\s*=>', body):
        local |= set(re.findall(r'[A-Za-z_$][\w$]*', grp))
    local |= set(re.findall(r'([A-Za-z_$][\w$]*)\s*=>', body))
    # function(...) の引数
    for grp in re.findall(r'function\s*[\w$]*\s*\(([^()]*)\)', body):
        local |= set(re.findall(r'[A-Za-z_$][\w$]*', grp))
    # 引数（分割代入も含む）
    sig = lines[start]
    local |= set(re.findall(r'[\w$]+', sig[sig.find("("):sig.find(")")+1] if "(" in sig else ""))
    # prop=${裸の変数} だけを見る（式や呼び出しは対象外）
    for pm in re.finditer(r'\b([A-Za-z_$][\w$]*)=\$\{\s*([A-Za-z_$][\w$]*)\s*\}', ln):
        var = pm.group(2)
        if var in local or var in GLOBAL or var in BUILTIN:
            continue
        bad.append((idx + 1, fname, pm.group(1), var))

if bad:
    print("✗ 渡している値が、その場所に存在しない（本番で画面全体が落ちる）")
    for lineno, fname, prop, var in bad:
        print(f"    index.html:{lineno}  {fname} の中で {prop}=${{{var}}} … {var} が無い")
    sys.exit(1)
print("✓ 受け渡している値が全て存在する")
