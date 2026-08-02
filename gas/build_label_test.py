#!/usr/bin/env python3
"""タスクの表示ラベルを検証する。

★確かめたいこと★
- 高・中・低で別の言葉が出る（中と低が同じだと、中を選ぶ意味がない）
- 6通りが重複しない
- 高の表示は従来どおり
"""
import subprocess, sys, os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
s = open(os.path.join(root, "index.html")).read()
i = s.index("const QUADRANT_LABEL = {")
j = s.index("const IMPORTANCE_LABEL")
open("/tmp/_lb.js", "w").write(s[i:j] + open(os.path.join(root, "gas/label_cases.js")).read())
node = os.path.expanduser("~/.local/node-v22.17.0-darwin-arm64/bin/node")
if not os.path.exists(node): node = "node"
try:
    sys.exit(subprocess.call([node, "/tmp/_lb.js"]))
except FileNotFoundError:
    print("  node が見つからないため検査できません（合格にしない）"); sys.exit(2)
