#!/usr/bin/env python3
"""マップのキーを id へ付け替える処理を検証する（Phase 2）。

★確かめたいこと★
- 保存済みの名前キーが id キーへ移る
- 判断がつかないものを消さない（消すと「昨日の設定が無くなった」になる）
- 改名しても値が残る（Phase 2 の目的そのもの）
"""
import subprocess, sys, os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
s = open(os.path.join(root, "index.html")).read()
i = s.index("function normalizeTaskList(raw)")
j = s.index("// \u2500\u2500 \u30bf\u30b9\u30af\u306e\u91cd\u8981\u5ea6\u00d7\u7dca\u6025\u5ea6\uff08Checkpoint 3\uff09\u2500\u2500")
cases = open(os.path.join(root, "gas/keymigration_cases.js")).read()
open("/tmp/_km.js", "w").write(s[i:j] + cases)
node = os.path.expanduser("~/.local/node-v22.17.0-darwin-arm64/bin/node")
if not os.path.exists(node): node = "node"
try:
    sys.exit(subprocess.call([node, "/tmp/_km.js"]))
except FileNotFoundError:
    print("  node が見つからないため検査できません（合格にしない）"); sys.exit(2)
