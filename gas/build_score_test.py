#!/usr/bin/env python3
"""レポートの採点が「ありえない点」を出さないか検査する。

★1件の記録で71点★（2026-08-10 Kai報告）
メモ・集中・目標は割合で出しているため、記録が1件でも
その1件を丁寧に書けば3項目とも満点になっていた。
件数の裏づけ（cov）を掛けて直したが、同じ緩みが再び入らないよう
実際の採点関数をそのまま動かして確かめる。
"""
import subprocess, sys, os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
s = open(os.path.join(root, "gas/Code.gs")).read()
i = s.index("function computeReportBreakdownCore_(")
j = s.index("\nfunction ", i + 10)
core = s[i:j]
# 採点関数が使っている外の道具だけ、同じ動きのものを用意する
stub = """
function normalizeTaskStatus(v){ return String(v||"").toUpperCase(); }
function isRestDay(){ return false; }
"""
open("/tmp/_score.js", "w").write(stub + core + open(os.path.join(root, "gas/score_cases.js")).read())
node = os.path.expanduser("~/.local/node-v22.17.0-darwin-arm64/bin/node")
if not os.path.exists(node): node = "node"
try:
    sys.exit(subprocess.call([node, "/tmp/_score.js"]))
except FileNotFoundError:
    print("  node が見つからないため検査できません（合格にしない）"); sys.exit(2)
