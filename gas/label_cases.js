let ng=0; const t=(n,c)=>{ if(!c) ng++; console.log(`  ${c?"✓":"✗"} ${n}`); };
console.log("=== 6通りの表示 ===");
const seen={};
[["HIGH","HIGH"],["HIGH","MEDIUM"],["HIGH","LOW"],["HIGH","NONE"],
 ["MEDIUM","HIGH"],["MEDIUM","MEDIUM"],["MEDIUM","NONE"],
 ["LOW","HIGH"],["LOW","LOW"],["LOW","NONE"]].forEach(([i,u])=>{
  const L=taskLabel(i,u);
  console.log(`  重要=${i.padEnd(6)} 緊急=${u.padEnd(6)} → ${L.icon} ${L.label}`);
  seen[i+"|"+(u==="HIGH"?"urgent":"other")]=L.label;
});
console.log("\n=== 高・中・低が別の言葉になるか ===");
t("緊急のとき3つとも別",
  new Set([seen["HIGH|urgent"],seen["MEDIUM|urgent"],seen["LOW|urgent"]]).size===3);
t("急ぎでないとき3つとも別",
  new Set([seen["HIGH|other"],seen["MEDIUM|other"],seen["LOW|other"]]).size===3);
t("★中と低が違う（今回の指摘）★", seen["MEDIUM|other"]!==seen["LOW|other"] && seen["MEDIUM|urgent"]!==seen["LOW|urgent"]);
t("高の表示は従来どおり", seen["HIGH|urgent"]==="今すぐ");
console.log("\n=== 全6通りが重複しない ===");
const all=Object.values(seen);
t(`${all.length}通りすべて別の言葉`, new Set(all).size===all.length);
t("未知の値でも落ちない", !!taskLabel("なにか","なにか").label);
console.log(ng===0?"\n✓ 全て期待どおり":`\n✗ ${ng}件`);
process.exit(ng===0?0:1);
