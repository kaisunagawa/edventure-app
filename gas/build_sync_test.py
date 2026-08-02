#!/usr/bin/env python3
"""端末間の同期を検証する。

★確かめたいこと★
- スマホで設定した重要度・期限・想定時間がPCへ届く
- この端末で設定済みの値を上書きしない
  （上書きすると「さっき変えたのに戻った」になる）
- 付随情報が無い旧データでも壊れない
"""
import subprocess, sys, os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
s = open(os.path.join(root, "index.html")).read()
i = s.index("function normalizeTaskList(raw)")
j = s.index("// \u2500\u2500 \u30bf\u30b9\u30af\u306e\u91cd\u8981\u5ea6\u00d7\u7dca\u6025\u5ea6\uff08Checkpoint 3\uff09\u2500\u2500")
a = s.index("  const toStored = function(titles){")
b = s.index("\n  };", a) + 4
head = (s[i:j] + "\nlet customActions=null;\n"
        + "let taskImportance={},taskDue={},taskEstimates={},taskNotes={},taskStatus={};\n"
        + s[a:b].replace("const toStored", "var toStored") + "\n")
open("/tmp/_sync.js", "w").write(head + open(os.path.join(root, "gas/sync_cases.js")).read())
node = os.path.expanduser("~/.local/node-v22.17.0-darwin-arm64/bin/node")
if not os.path.exists(node): node = "node"
try:
    sys.exit(subprocess.call([node, "/tmp/_sync.js"]))
except FileNotFoundError:
    print("  node が見つからないため検査できません（合格にしない）"); sys.exit(2)
