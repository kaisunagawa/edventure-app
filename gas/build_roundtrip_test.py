#!/usr/bin/env python3
"""タスクの保存形式（[{id,title}]）の往復を検証する。

★いちばん困る壊れ方は「タスクが消えること」★
読み書きを往復させて、件数・順番・idが保たれるかを確かめる。
index.html から実物を切り出すので、貼り付けの二重管理にならない。
"""
import subprocess, sys, os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
s = open(os.path.join(root, "index.html")).read()
i = s.index("function normalizeTaskList(raw)")
j = s.index("// \u2500\u2500 \u30bf\u30b9\u30af\u306e\u91cd\u8981\u5ea6\u00d7\u7dca\u6025\u5ea6\uff08Checkpoint 3\uff09\u2500\u2500")
body = s[i:j]
# 画面側の toStored を切り出す
a = s.index("  const toStored = function(titles){")
b = s.index("\n  };", a) + 4
stored = s[a:b].replace("const toStored", "var toStored")
cases = open(os.path.join(root, "gas/roundtrip_cases.js")).read()
code = body + "\nlet customActions = null;\n" + stored + "\n" + cases
open("/tmp/_rt.js", "w").write(code)
node = os.path.expanduser("~/.local/node-v22.17.0-darwin-arm64/bin/node")
if not os.path.exists(node): node = "node"
try:
    sys.exit(subprocess.call([node, "/tmp/_rt.js"]))
except FileNotFoundError:
    print("  node が見つからないため検査できません（合格にしない）"); sys.exit(2)
