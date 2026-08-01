let ng=0; const t=(name,cond)=>{ if(!cond) ng++; console.log(`  ${cond?"✓":"✗"} ${name}`); };

console.log("=== 旧形式（文字列配列）を読める ===");
const a = normalizeTaskList(["資料づくり","メール返信"]);
t("2件に変換される", a.length===2);
t("titleが保たれる", a[0].title==="資料づくり" && a[1].title==="メール返信");
t("idが振られる", !!a[0].id && !!a[1].id);

console.log("\n=== 同じ入力からは同じidになる（端末間でずれない）===");
const b = normalizeTaskList(["資料づくり","メール返信"]);
t("1件目のidが一致", a[0].id===b[0].id);
t("2件目のidが一致", a[1].id===b[1].id);

console.log("\n=== ★同名タスク2件を区別できる★（いまの実装では区別できない）===");
const c = normalizeTaskList(["買い物","買い物"]);
t("2件とも残る", c.length===2);
t("idが別になる", c[0].id!==c[1].id);

console.log("\n=== 新形式（オブジェクト）をそのまま読める ===");
const d = normalizeTaskList([{id:"lt_abc",title:"既存"},{task_id:"lt_xyz",title:"既存2"}]);
t("idを維持する", d[0].id==="lt_abc" && d[1].id==="lt_xyz");

console.log("\n=== 空・壊れた入力 ===");
t("nullは空配列", normalizeTaskList(null).length===0);
t("空文字は落とす", normalizeTaskList(["","有効"]).length===1);
t("空白だけも落とす", normalizeTaskList(["   "]).length===0);

console.log("\n=== 名前キーのマップをidキーへ付け替える ===");
const list = normalizeTaskList(["資料づくり","メール返信"]);
const oldEst = {"資料づくり":30,"メール返信":10,"もう無いタスク":99};
const newEst = remapByTaskId(oldEst, list);
t("2件が移る", Object.keys(newEst).length===2);
t("値が保たれる", newEst[list[0].id]===30 && newEst[list[1].id]===10);
t("消えたタスクは持ち込まない", !Object.values(newEst).includes(99));

console.log("\n=== 同名2件のとき、推測で複製しない ===");
const list2 = normalizeTaskList(["買い物","買い物"]);
const m2 = remapByTaskId({"買い物":"HIGH"}, list2);
t("1件だけに引き継ぐ", Object.keys(m2).length===1);

console.log("\n=== ★改名しても情報が残る（idが変わらないため）===");
const before = normalizeTaskList([{id:"lt_keep",title:"古い名前"}]);
const impBefore = {"lt_keep":"HIGH"};
const after  = normalizeTaskList([{id:"lt_keep",title:"新しい名前"}]);
t("idは同じ", before[0].id===after[0].id);
t("重要度が残る", impBefore[after[0].id]==="HIGH");

console.log(ng===0?"\n✓ 全て期待どおり":`\n✗ ${ng}件 不一致`);
process.exit(ng===0?0:1);
