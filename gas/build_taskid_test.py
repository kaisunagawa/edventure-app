#!/usr/bin/env python3
"""task_id への変換を検証する。index.html から実物を切り出して実行する。

同名タスクの区別・改名時の情報保持・旧形式の読み込みを確認する。
★貼り付けの二重管理にしない★ 検査が古くなると意味を失う。
"""
import subprocess, sys, os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
s = open(os.path.join(root, "index.html")).read()
i = s.index("function normalizeTaskList(raw)")
j = s.index("// \u2500\u2500 \u30bf\u30b9\u30af\u306e\u91cd\u8981\u5ea6\u00d7\u7dca\u6025\u5ea6\uff08Checkpoint 3\uff09\u2500\u2500")
body = s[i:j]
cases = open(os.path.join(root, "gas/taskid_cases.js")).read()
open("/tmp/_taskid.js", "w").write(body + cases)
node = os.path.expanduser("~/.local/node-v22.17.0-darwin-arm64/bin/node")
if not os.path.exists(node): node = "node"
try:
    sys.exit(subprocess.call([node, "/tmp/_taskid.js"]))
except FileNotFoundError:
    print("  node が見つからないため検査できません（合格にしない）"); sys.exit(2)
