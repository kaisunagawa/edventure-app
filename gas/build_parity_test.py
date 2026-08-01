#!/usr/bin/env python3
"""画面側とサーバー側で、緊急度・4分類の判定が一致するかを検査する。

★同じ規則を2箇所に書いている★
サーバーは集計に、画面は表示に使う。どちらか片方だけ直すと、
画面には「今すぐ」と出ているのに集計は別扱い、という食い違いが起きる。
それは利用者からは絶対に見えない。だから機械で突き合わせる。

このスクリプトは毎回 Code.gs と index.html から実物を切り出して比べる。
貼り付けて二重管理にすると、検査自体が古くなって意味を失う。
"""
import subprocess, sys, os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
s = open(os.path.join(root, "gas/Code.gs")).read()
i = s.index("// タスクの状態。既存データと"); j = s.index("function suggestImportance")
server = s[i:j]
h = open(os.path.join(root, "index.html")).read()
a = h.index("  const quadrantOf = (task) => {"); b = h.index("\n  };", a) + 4
client = h[a:b]
harness = """
function ymd(off){ const d=new Date(); d.setDate(d.getDate()+off);
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
let ng=0, n=0;
[["HIGH"],["MEDIUM"],["LOW"],[null]].forEach(([imp])=>{
  [-3,-1,0,1,2,3,4,10,null].forEach(off=>{
    const due = off===null ? "" : ymd(off);
    for(const k in taskImportance) delete taskImportance[k];
    for(const k in taskDue) delete taskDue[k];
    if(imp) taskImportance["t"]=imp;
    if(due) taskDue["t"]=due;
    const c = quadrantOf("t");
    const u = computeUrgency(due, "", Date.now());
    const q = classifyTask(imp||"MEDIUM", u.level);
    n++;
    if(!((c.urgency===u.level)&&(c.quadrant===q)&&(!!c.overdue===!!u.overdue))){
      ng++; console.log("  NG 重要="+(imp||"未設定")+" 期限="+(due||"なし")+
        "  画面:"+c.urgency+"/"+c.quadrant+" サーバー:"+u.level+"/"+q);
    }
  });
});
if(ng>0){ console.log("  "+ng+"/"+n+" 不一致"); process.exit(1); }
process.exit(0);
"""
code = server + "\nconst taskImportance={}, taskDue={};\n" + client.replace("const quadrantOf", "var quadrantOf") + harness
tmp = "/tmp/_parity.js"
open(tmp, "w").write(code)
# node は PATH に無いことがある（このMacはbrew未導入で自前配置）
node = "node"
cand = os.path.expanduser("~/.local/node-v22.17.0-darwin-arm64/bin/node")
if os.path.exists(cand):
    node = cand
try:
    sys.exit(subprocess.call([node, tmp]))
except FileNotFoundError:
    print("  node が見つからないため検査できません（合格にしない）")
    sys.exit(2)
