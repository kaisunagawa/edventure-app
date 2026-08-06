"""画面(index.html)とサーバー(gas/Code.gs)で、同じでなければならない定義がズレていないか調べる。

なぜ要るか:
  レベルのしきい値は両方に同じものを持っている。片方だけ配信すると、
  サーバーは古い区切りでレベルを返し、画面は新しい区切りで階級を出すので、
  「コンシステントのはずがチャレンジャーになる」ような食い違いが起きる（実際に起きた）。
  ファイルが一致していても、配信し忘れれば同じことになる点に注意。
"""
import re, sys

def grab(path, name):
    s = open(path).read()
    m = re.search(r'const ' + name + r'\s*=\s*(\[.*?\]|\{.*?\});', s, re.S)
    return None if not m else re.sub(r'\s+|//.*', '', m.group(1))

ok = True
for name in ["XP_THRESHOLDS"]:
    a = grab("index.html", name)
    b = grab("gas/Code.gs", name)
    if a is None or b is None:
        print(f"✗ {name} が見つかりません"); ok = False
    elif a != b:
        print(f"✗ {name} が画面とサーバーで違います"); ok = False
    else:
        print(f"✓ {name} は画面とサーバーで一致")

# 階級（minLv/maxLv/name）が画面とサーバーで一致しているか
import itertools
def bands_of(path):
    t = open(path).read()
    return re.findall(r'minLv:(\d+),\s*maxLv:(\d+),\s*name:"([^"]+)"', t)
ba, bb = bands_of("index.html"), bands_of("gas/Code.gs")
if not bb:
    print("✗ サーバーに RANKS がありません"); ok = False
elif ba != bb:
    print("✗ 階級（RANKS）が画面とサーバーで違います"); ok = False
else:
    print("✓ 階級（RANKS）は画面とサーバーで一致")

# 階級が 1〜100 を隙間なく覆っているか
s = open("index.html").read()
bands = [(int(a), int(b)) for a, b in re.findall(r'minLv:(\d+),\s*maxLv:(\d+)', s)]
cov = [x for a, b in bands for x in range(a, b+1)]
th = grab("index.html", "XP_THRESHOLDS")
top = len(th.strip("[]").split(","))
if sorted(cov) != list(range(1, top+1)):
    print(f"✗ 階級がレベル1〜{top}を隙間なく覆っていません: {bands}"); ok = False
else:
    print(f"✓ 階級がレベル1〜{top}を隙間なく覆っている")
# ── 隠しジローの条件が、画面とサーバーで一致しているか ──
#   条件の文（cond）は index.html、判定の数字（need）は Code.gs にあり、
#   片方だけ直すと「画面には10件と書いてあるのに20件必要」になる。
import re as _re
_pat = _re.compile(r'id:"(\w+)"[^}]*?cond:"([^"]+)"', _re.S)
_cli = dict(_pat.findall(open("index.html", encoding="utf-8").read()))
_srv = dict(_pat.findall(open("gas/Code.gs", encoding="utf-8").read()))
if not _cli or not _srv:
    print("✗ 隠しジローの条件が読み取れない（書き方が変わった可能性）"); ok = False
_bad = [k for k in _cli if k in _srv and _cli[k] != _srv[k]]
_miss = [k for k in _cli if k not in _srv] + [k for k in _srv if k not in _cli]
if _bad or _miss:
    print("✗ 隠しジローの条件が画面とサーバーで違う")
    for k in _bad:
        print(f"    {k}: 画面「{_cli[k]}」/ サーバー「{_srv[k]}」")
    for k in _miss:
        print(f"    {k}: 片方にしかない")
    ok = False
else:
    print(f"✓ 隠しジローの条件が画面とサーバーで一致（{len(_cli)}体）")

sys.exit(0 if ok else 1)


# ── 隠しジローのしきい値（画面とサーバー）──────────────────
# 食い違うと「絵は出るのに一生もらえない」「条件の表示が嘘になる」。
import re as _re
_cli = open("index.html", encoding="utf-8").read()
_srv = open("gas/Code.gs", encoding="utf-8").read()

def _client_jiro():
    b = _cli[_cli.index("const HIDDEN_JIRO = ["):_cli.index("const RARITY_COLOR")]
    return {m.group(1): m.group(2)
            for m in _re.finditer(r'id:"(\w+)".*?cond:"([^"]+)"', b, _re.S)}

def _server_jiro():
    b = _srv[_srv.index("const HIDDEN_JIRO = ["):_srv.index("\n// 記録の時刻が「夜ふかし」")]
    return {m.group(1): m.group(3)
            for m in _re.finditer(r'id:"(\w+)".*?need:(\d+),\s*cond:"([^"]+)"', b, _re.S)}

try:
    _c, _s = _client_jiro(), _server_jiro()
except ValueError:
    print("－ 隠しジローの定義が見つからないので飛ばしました")
else:
    if _c != _s:
        print("✗ 隠しジローの条件が画面とサーバーで違う")
        for k in sorted(set(_c) | set(_s)):
            if _c.get(k) != _s.get(k):
                print(f"    {k}: 画面「{_c.get(k)}」 / サーバー「{_s.get(k)}」")
        sys.exit(1)
    print(f"✓ 隠しジローの条件が画面とサーバーで一致（{len(_c)}体）")
