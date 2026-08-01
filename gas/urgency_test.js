// 緊急度と4分類の検証（純粋な計算なのでNodeだけで確かめられる）
//
// なぜ切り出すか:
//   保存や表示を通すとセッションが要るが、この計算はデータに触らない。
//   デプロイのたびに1秒で確かめられるようにしておく。
//
// 使い方: node gas/urgency_test.js
//   （gas/Code.gs から該当部分を切り出して実行する。定義は下に貼り付けてある）
//
// ★ここを直したら Code.gs も直すこと★ 二重管理になっている。
//   将来 Code.gs 側を読み込む形にできると良いが、GAS向けのファイルは
//   module.exports を持たないため、今は貼り付けで運用する。

const IMPORTANCE_LEVELS = ["HIGH", "MEDIUM", "LOW"];
const URGENCY_LEVELS = ["HIGH", "MEDIUM", "LOW", "NONE"];

// 期限から緊急度を出す。
//   期限超過        → HIGH
//   24時間以内      → HIGH
//   3日以内         → MEDIUM
//   それより先      → LOW
//   期限なし        → NONE
// 日付だけの期限は「その日の終わり(23:59)」を期限として扱う。
// 朝9時を期限にしてしまうと、その日中に終わらせるつもりの人が
// 朝から超過扱いになる。
function computeUrgency(dueAt, overrideLevel, nowMs) {
  const ov = String(overrideLevel || "").trim().toUpperCase();
  if (URGENCY_LEVELS.indexOf(ov) !== -1) return { level: ov, overridden: true };

  const raw = String(dueAt || "").trim();
  if (!raw) return { level: "NONE", overridden: false };

  const now = nowMs || Date.now();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);

  if (dateOnly) {
    // ★日付だけの期限は「日数」で見る。時間で見てはいけない★
    //   その日の終わり(23:59)を期限として時間差で測ると、
    //   「3日後」と入れた人が 82時間 → LOW に落ちる。
    //   利用者の感覚は「3日以内なら気にしはじめる」なので食い違う。
    //   何日後かで数える。
    //     今日まで（超過含む） … HIGH
    //     明日                … HIGH（今日から手を付けないと間に合わない）
    //     2〜3日後            … MEDIUM
    //     それより先          … LOW
    const startOfDay = function (ms) {
      const d = new Date(ms + 9 * 3600000);       // 日本時間の日付に直す
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    };
    const p = raw.split("-");
    const dueDay = Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    if (isNaN(dueDay)) return { level: "NONE", overridden: false, invalidDue: true };
    const days = Math.round((dueDay - startOfDay(now)) / 86400000);
    if (days < 0) return { level: "HIGH", overridden: false, overdue: true };
    if (days <= 1) return { level: "HIGH", overridden: false };
    if (days <= 3) return { level: "MEDIUM", overridden: false };
    return { level: "LOW", overridden: false };
  }

  // 時刻まで指定されている場合は時間で見る（その時刻に間に合わせる必要があるため）
  const due = new Date(raw.indexOf("T") === -1 ? raw.replace(" ", "T") + "+09:00" : raw);
  if (isNaN(due.getTime())) return { level: "NONE", overridden: false, invalidDue: true };
  const hours = (due.getTime() - now) / 3600000;
  if (hours < 0) return { level: "HIGH", overridden: false, overdue: true };
  if (hours <= 24) return { level: "HIGH", overridden: false };
  if (hours <= 72) return { level: "MEDIUM", overridden: false };
  return { level: "LOW", overridden: false };
}

// 重要度×緊急度の4分類。★保存しない★
// 保存すると importance_level や due_at を変えたときに食い違う。
// 表示のたびに出す。
function classifyTask(importance, urgency) {
  const imp = String(importance || "MEDIUM").toUpperCase();
  const urg = String(urgency || "NONE").toUpperCase();
  const important = (imp === "HIGH");
  const urgent = (urg === "HIGH");
  if (important && urgent) return "DO_NOW";
  if (important && !urgent) return "SCHEDULE";
  if (!important && urgent) return "DELEGATE_OR_LIMIT";
  return "DEFER_OR_DELETE";
}

// 既存の priority(1〜5) から重要度を提案する。
// ★上書きはしない★ importance_level が既に入っていればそちらを使う。
// priority は当面そのまま残す（既存互換）。
function importanceFromPriority(p) {
  const n = Number(p);
  if (isNaN(n)) return "MEDIUM";
  if (n <= 2) return "HIGH";
  if (n >= 4) return "LOW";
  return "MEDIUM";
}

// 3か月目標・週間目標・今日のフォーカスに紐づくタスクは重要度を高めに提案する。
// ★提案であって確定ではない★ 本人が決める。
const NOW = new Date("2026-08-01T14:00:00+09:00").getTime();
const cases = [
  ["期限なし",              "",           "", "NONE"],
  ["昨日（超過）",           "2026-07-31", "", "HIGH"],
  ["今日",                  "2026-08-01", "", "HIGH"],
  ["明日",                  "2026-08-02", "", "HIGH"],
  ["2日後",                 "2026-08-03", "", "MEDIUM"],
  ["3日後",                 "2026-08-04", "", "MEDIUM"],
  ["4日後",                 "2026-08-05", "", "LOW"],
  ["1週間後",               "2026-08-08", "", "LOW"],
  ["2時間後(時刻)",          "2026-08-01T16:00:00+09:00", "", "HIGH"],
  ["30時間後(時刻)",         "2026-08-02T20:00:00+09:00", "", "MEDIUM"],
  ["4日後(時刻)",            "2026-08-05T10:00:00+09:00", "", "LOW"],
  ["1時間前(時刻・超過)",     "2026-08-01T13:00:00+09:00", "", "HIGH"],
  ["上書きLOW(超過でも)",     "2026-07-31", "LOW", "LOW"],
  ["上書きNONE→無効",        "2026-07-31", "NONE", "NONE"],
  ["壊れた期限",             "not-a-date", "", "NONE"],
];
let ng=0;
console.log("=== 緊急度（日付だけは日数、時刻ありは時間）===");
for (const [n,d,o,w] of cases) {
  const r = computeUrgency(d,o,NOW);
  const ok = r.level===w; if(!ok) ng++;
  console.log(`  ${ok?"✓":"✗"} ${n.padEnd(20)} → ${String(r.level).padEnd(7)}${r.overdue?"超過":"  "}  期待:${w}`);
}
console.log(ng===0 ? "\n✓ 全て期待どおり" : `\n✗ ${ng}件 不一致`);
process.exit(ng===0?0:1);
