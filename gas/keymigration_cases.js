let ng=0; const t=(n,c)=>{ if(!c) ng++; console.log(`  ${c?"✓":"✗"} ${n}`); };

console.log("=== 保存済みの「名前キー」を id キーへ付け替える ===");
const list = normalizeTaskList(["提案書を作る","電話をする"]);
const old = {"提案書を作る":"HIGH","電話をする":"LOW"};
const mig = migrateMapKeysToId(old, list);
t("2件とも移る", Object.keys(mig).length===2);
t("値が保たれる", mig[list[0].id]==="HIGH" && mig[list[1].id]==="LOW");
t("名前キーは消える", mig["提案書を作る"]===undefined);

console.log("\n=== 既に id キーならそのまま ===");
const already = {}; already[list[0].id]="MEDIUM";
const m2 = migrateMapKeysToId(already, list);
t("値が保たれる", m2[list[0].id]==="MEDIUM");
t("増えない", Object.keys(m2).length===1);

console.log("\n=== ★判断がつかないものは消さない★ ===");
const m3 = migrateMapKeysToId({"今日のリストに無いタスク":"HIGH"}, list);
t("残る", m3["今日のリストに無いタスク"]==="HIGH");
console.log("     （消すと「昨日つけた重要度が無くなった」になる）");

console.log("\n=== ★改名しても重要度が残る（Phase 2 の目的）★ ===");
// idキーで保存 → タイトルだけ変わる → 同じidなので引ける
const imp = {}; imp[list[0].id]="HIGH";
const renamedList = [{id:list[0].id, title:"提案書を作る（第2版）"}, list[1]];
const idOfTitle = (title)=>{ const h=renamedList.find(x=>x.title===title); return h?h.id:""; };
t("改名後も HIGH を引ける", imp[idOfTitle("提案書を作る（第2版）")]==="HIGH");
console.log("     （名前キーだった従来は、ここで消えていた）");

console.log("\n=== 同名2件で重要度が混ざらない ===");
const dup = normalizeTaskList(["買い物","買い物"]);
const dimp = {}; dimp[dup[0].id]="HIGH";
t("1件目だけHIGH", dimp[dup[0].id]==="HIGH" && dimp[dup[1].id]===undefined);

console.log("\n=== 壊れた入力 ===");
t("nullは空", Object.keys(migrateMapKeysToId(null, list)).length===0);
t("配列でも落ちない", typeof migrateMapKeysToId([], list)==="object");

console.log(ng===0?"\n✓ 全て期待どおり":`\n✗ ${ng}件`);
process.exit(ng===0?0:1);
