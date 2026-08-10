// ★採点の「ありえない点」を止める検査★（2026-08-10）
//   きっかけ：1件しか記録していない日に71点が出ていた。
//   内訳は 記録3.0／メモ8.0／集中20.0／目標20.0／継続20.0。
//   割合で出している3項目が、件数1件でも満点になっていたため。
//   同じ種類の緩みが入り込んだら、ここで落とす。

function L(o) {   // 記録1件を作る
  return { memo: o.memo || "", focus_level: o.focus === undefined ? 5 : o.focus,
           goal_related: o.goal === false ? "false" : "true", time_block: o.tb || "10:00-11:00" };
}
function many(k, o) { const a = []; for (let i = 0; i < k; i++) a.push(L(o || {})); return a; }

const USER = { streak: 36, rest_days: "" };
const run = (logs, user) =>
  computeReportBreakdownCore_("t@example.com", logs, user || USER, [], {}, null, "2026-08-08");

let ng = 0;
function check(name, cond, detail) {
  if (cond) { console.log("  ok  " + name); }
  else { console.log("  NG  " + name + "  " + detail); ng++; }
}

// ① いちばん甘くなる1件（メモ長文・自己評価5・目標関連・連続36日）
const one = run([L({ memo: "あ".repeat(600), focus: 5, goal: true })]);
check("記録1件は50点未満", one.score < 50, "実際=" + one.score + " " + JSON.stringify(one.breakdown));

// ② 記録が0件なら0点
const zero = run([]);
check("記録0件は0点", zero.score === 0, "実際=" + zero.score);

// ③ しっかり記録した日は、ちゃんと高く出る
const full = run(many(10, { memo: "しっかり書いたメモ。".repeat(6), focus: 5, goal: true }));
check("10件しっかりは70点以上", full.score >= 70, "実際=" + full.score + " " + JSON.stringify(full.breakdown));

// ④ 件数が増えるほど点も増える（逆転しない）
const s = [1, 2, 3, 6, 10].map(k => run(many(k, { memo: "メモです。".repeat(10), focus: 5, goal: true })).score);
check("件数が増えれば点も増える", s.every((v, i) => i === 0 || v >= s[i - 1]), "実際=" + s.join(" → "));

// ⑤ 1件と10件の差が、はっきり付く
check("1件と10件で25点以上の差", (s[4] - s[0]) >= 25, "実際=" + s[0] + " vs " + s[4]);

// ⑥ どの項目も20点を超えない／合計が100を超えない
const ov = Object.keys(full.breakdown).filter(k => full.breakdown[k] > 20);
check("各項目は20点以内", ov.length === 0, "超過=" + ov.join(","));
check("合計は100点以内", full.score <= 100, "実際=" + full.score);

// ⑦ 連続日数0の人が、1件で高得点にならない
const newbie = run([L({ memo: "あ".repeat(600), focus: 5, goal: true })], { streak: 0, rest_days: "" });
check("連続0日・1件は30点未満", newbie.score < 30, "実際=" + newbie.score);

if (ng) { console.log("採点の検査: " + ng + "件 失敗"); process.exit(1); }
console.log("採点の検査: 全て合格");
