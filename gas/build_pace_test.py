#!/usr/bin/env python3
"""進捗とペースの計算を検証する。Code.gs から実物を切り出して実行する。

★貼り付けの二重管理にしない★ 検査が古くなると意味を失う。
"""
import subprocess, sys, os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
s = open(os.path.join(root, "gas/Code.gs")).read()
i = s.index("function paceRound(v)"); j = s.index("const PACE_STATUS_LABEL")
body = s[i:j]
harness = open(os.path.join(root, "gas/pace_cases.js")).read()
code = 'const Utilities={formatDate:function(){return "2026-08-01";}};\n' + body + harness
open("/tmp/_pace.js", "w").write(code)
node = os.path.expanduser("~/.local/node-v22.17.0-darwin-arm64/bin/node")
if not os.path.exists(node): node = "node"
try:
    sys.exit(subprocess.call([node, "/tmp/_pace.js"]))
except FileNotFoundError:
    print("  node が見つからないため検査できません（合格にしない）"); sys.exit(2)
