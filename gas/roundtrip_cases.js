let ng=0; const t=(n,c)=>{ if(!c) ng++; console.log(`  ${c?"✓":"✗"} ${n}`); };

console.log("=== 旧データ（文字列配列）を読んで保存し直す ===");
const legacy = ["提案書を作る","電話をする","買い物"];
customActions = normalizeTaskList(legacy);
t("件数が保たれる", customActions.length===3);
t("順番が保たれる", customActions.map(x=>x.title).join()===legacy.join());
const saved = toStored(customActions.map(x=>x.title));
t("保存形式は{id,title}", saved.every(x=>x.id&&x.title));
t("idが変わらない", saved.map(x=>x.id).join()===customActions.map(x=>x.id).join());

console.log("\n=== 保存 → 読み直し（往復）===");
const reread = normalizeTaskList(JSON.parse(JSON.stringify(saved)));
t("件数が保たれる", reread.length===3);
t("idが保たれる", reread.map(x=>x.id).join()===saved.map(x=>x.id).join());
t("titleが保たれる", reread.map(x=>x.title).join()===legacy.join());

console.log("\n=== ★タスクを1件足しても既存のidが変わらない★ ===");
customActions = reread;
const added = toStored([...reread.map(x=>x.title), "新しいタスク"]);
t("4件になる", added.length===4);
t("既存3件のidが不変", added.slice(0,3).map(x=>x.id).join()===reread.map(x=>x.id).join());
t("新規にidが付く", !!added[3].id);

console.log("\n=== ★1件消しても残りのidが変わらない★ ===");
customActions = added;
const removed = toStored(added.filter(x=>x.title!=="電話をする").map(x=>x.title));
t("3件になる", removed.length===3);
t("残りのidが不変", removed.map(x=>x.id).join()===added.filter(x=>x.title!=="電話をする").map(x=>x.id).join());

console.log("\n=== ★改名しても同じidを保つ（Phase2の土台）★ ===");
customActions = reread;
const renamedTitles = ["提案書を作る（改）","電話をする","買い物"];
const renamed = toStored(renamedTitles);
t("2件目3件目のidは不変", renamed[1].id===reread[1].id && renamed[2].id===reread[2].id);
console.log("     （1件目は名前が変わったので新idになる。Phase2でid基準の編集にすれば保たれる）");

console.log("\n=== 同名2件でもidが衝突しない ===");
customActions = null;
const dupe = toStored(["買い物","買い物"]);
t("2件とも残る", dupe.length===2);
t("idが別", dupe[0].id!==dupe[1].id);

console.log("\n=== 壊れた入力でタスクが消えない ===");
t("nullは空", normalizeTaskList(null).length===0);
t("混在も読める", normalizeTaskList(["文字列",{id:"x",title:"オブジェクト"}]).length===2);

console.log(ng===0?"\n✓ 全て期待どおり":`\n✗ ${ng}件`);
process.exit(ng===0?0:1);
