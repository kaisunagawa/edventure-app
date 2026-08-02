#!/usr/bin/env python3
"""タスク一覧の統合を検証する。

★端末ごとに別々のタスクを持っていた★
PCには「朝食」、スマホには「AI研究」「読書」。
一覧を受け取る条件が「端末にタスクが無いとき」だけだったため、
両方にタスクがあると一生混ざらなかった。
"""
import subprocess, sys, os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
s = open(os.path.join(root, "index.html")).read()
i = s.index("function normalizeTaskList(raw)")
j = s.index("// \u2500\u2500 \u30bf\u30b9\u30af\u306e\u91cd\u8981\u5ea6\u00d7\u7dca\u6025\u5ea6\uff08Checkpoint 3\uff09\u2500\u2500")
open("/tmp/_mg.js", "w").write(s[i:j] + open(os.path.join(root, "gas/merge_cases.js")).read())
node = os.path.expanduser("~/.local/node-v22.17.0-darwin-arm64/bin/node")
if not os.path.exists(node): node = "node"
try:
    sys.exit(subprocess.call([node, "/tmp/_mg.js"]))
except FileNotFoundError:
    print("  node が見つからないため検査できません（合格にしない）"); sys.exit(2)
