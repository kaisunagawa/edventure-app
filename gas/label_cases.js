let ng=0; const t=(n,c)=>{ if(!c) ng++; console.log(`  ${c?"✓":"✗"} ${n}`); };
// ★2026-08-03 仕様変更（Kaiの指摘）★
//   全部の行に札が付くと、どれが大事なのか分からない。
//   「今すぐ／重要／早めに／手短に」だけ出し、ふつうのタスクは無印にする。
//   ＝ taskLabel は null を返すことがある。
console.log("=== 表示 ===");
const seen={};
[["HIGH","HIGH"],["HIGH","MEDIUM"],["HIGH","LOW"],["HIGH","NONE"],
 ["MEDIUM","HIGH"],["MEDIUM","MEDIUM"],["MEDIUM","NONE"],
 ["LOW","HIGH"],["LOW","LOW"],["LOW","NONE"]].forEach(([i,u])=>{
  const L=taskLabel(i,u);
  console.log(`  重要=${i.padEnd(6)} 緊急=${u.padEnd(6)} → ${L?L.icon+" "+L.label:"（無印）"}`);
  seen[i+"|"+(u==="HIGH"?"urgent":"other")]=L?L.label:null;
});
console.log("\n=== 大事なものだけに札が付く ===");
t("高（急ぎ）は今すぐ", seen["HIGH|urgent"]==="今すぐ");
t("高（急がない）にも札が付く", !!seen["HIGH|other"]);
t("中（急ぎ）には札が付く", !!seen["MEDIUM|urgent"]);
t("★中でふつうは無印★", seen["MEDIUM|other"]===null);
t("★低でふつうも無印★", seen["LOW|other"]===null);
t("低（急ぎ）は手短に", seen["LOW|urgent"]==="手短に");
console.log("\n=== 付く札どうしは重複しない ===");
const labels=Object.values(seen).filter(Boolean);
t(`${labels.length}件すべて別の言葉`, new Set(labels).size===labels.length);
t("未知の値でも落ちない", (()=>{ try { taskLabel("なにか","なにか"); return true; } catch(e){ return false; } })());
console.log(ng===0?"\n✓ 全て期待どおり":`\n✗ ${ng}件`);
process.exit(ng===0?0:1);
