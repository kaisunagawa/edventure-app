let ng=0; const t=(n,c)=>{ if(!c) ng++; console.log(`  ${c?"✓":"✗"} ${n}`); };

console.log("=== 今回の実際の状況 ===");
const pc     = normalizeTaskList(["朝食"]);
const mobile = normalizeTaskList(["AI研究","読書"]);
const m1 = mergeTaskLists(pc, mobile);
console.log("  PC:", pc.map(x=>x.title).join("・"));
console.log("  携帯:", mobile.map(x=>x.title).join("・"));
console.log("  → まとめた結果:", m1.map(x=>x.title).join("・"));
t("3件になる", m1.length===3);
t("PCのタスクが残る", m1.some(x=>x.title==="朝食"));
t("携帯のタスクが入る", m1.some(x=>x.title==="AI研究") && m1.some(x=>x.title==="読書"));
t("PCの並びが先", m1[0].title==="朝食");

console.log("\n=== 逆から見ても同じ顔ぶれ ===");
const m2 = mergeTaskLists(mobile, pc);
t("3件", m2.length===3);
t("同じ顔ぶれ", new Set(m1.map(x=>x.title)).size===3 &&
   m2.every(x=>m1.some(y=>y.title===x.title)));

console.log("\n=== 同じタスクを二重に出さない ===");
const same = normalizeTaskList(["朝食","読書"]);
const m3 = mergeTaskLists(same, normalizeTaskList(["朝食","AI研究"]));
t("朝食は1件だけ", m3.filter(x=>x.title==="朝食").length===1);
t("3件になる", m3.length===3);

console.log("\n=== 同じidなら重複しない ===");
const a = normalizeTaskList([{id:"t1",title:"共通"}]);
const b = normalizeTaskList([{id:"t1",title:"共通"}]);
t("1件", mergeTaskLists(a,b).length===1);

console.log("\n=== 片方が空 ===");
t("サーバーが空ならローカルのまま", mergeTaskLists(pc,[]).length===1);
t("ローカルが空ならサーバーを取る", mergeTaskLists([],mobile).length===2);
t("両方空", mergeTaskLists([],[]).length===0);
t("nullでも落ちない", mergeTaskLists(null,null).length===0);

console.log(ng===0?"\n✓ 全て期待どおり":`\n✗ ${ng}件`);
process.exit(ng===0?0:1);
