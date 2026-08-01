const T="2026-08-01";
let ng=0;
const show=(name,r,want)=>{
  const ok=r.status===want; if(!ok) ng++;
  console.log(`  ${ok?"✓":"✗"} ${name.padEnd(30)} ${String(r.status).padEnd(16)} 期待:${want}`);
  if(r.note) console.log(`      → ${r.note}`);
};
console.log("=== 判定 ===");
// 3か月で400万、今120万、開始7/2（31日経過）、終了9/29
show("売上400万（ペース不足）", computePace("2026-07-02","2026-09-29",120,400,"万円",T), "BEHIND");
show("現在値が未入力",           computePace("2026-07-02","2026-09-29","",400,"万円",T), "UNKNOWN");
show("現在値が0（記録あり）",     computePace("2026-07-02","2026-09-29",0,400,"万円",T), "BEHIND");
show("目標値が未入力",           computePace("2026-07-02","2026-09-29",120,"","万円",T), "UNKNOWN");
show("開始したばかり（2日）",     computePace("2026-07-31","2026-09-29",5,400,"万円",T), "UNKNOWN");
show("達成済み",                 computePace("2026-07-02","2026-09-29",450,400,"万円",T), "ACHIEVED");
show("順調",                     computePace("2026-07-02","2026-09-29",300,400,"万円",T), "ON_TRACK");
show("期間終了・未達",           computePace("2026-05-01","2026-08-01",300,400,"万円",T), "ENDED_SHORT");
show("期間が逆",                 computePace("2026-09-29","2026-07-02",120,400,"万円",T), "UNKNOWN");

console.log("\n=== 数字（売上400万の例）===");
const r=computePace("2026-07-02","2026-09-29",120,400,"万円",T);
console.log("  期間        :", r.period);
console.log("  現在/目標   :", r.current, "/", r.target, r.unit);
console.log("  残り        :", r.remaining, r.unit);
console.log("  進捗率      :", r.progressPct + "%");
console.log("  経過/残り   :", r.elapsedDays, "日 /", r.remainingDays, "日");
console.log("  実績ペース  : 週", r.actualPerWeek, r.unit);
console.log("  必要ペース  : 週", r.requiredPerWeek, r.unit);
console.log("  予測        :", r.forecast, r.unit);
console.log("  信頼度      :", r.confidence);

console.log("\n=== 未入力と0を取り違えていないか ===");
const a=computePace("2026-07-02","2026-09-29","",400,"万円",T);
const b=computePace("2026-07-02","2026-09-29",0,400,"万円",T);
const ok = a.current===null && b.current===0 && a.status==="UNKNOWN" && b.status!=="UNKNOWN";
if(!ok) ng++;
console.log(`  ${ok?"✓":"✗"} 未入力=${a.current}(${a.status}) / 0=${b.current}(${b.status})`);
console.log(ng===0?"\n✓ 全て期待どおり":`\n✗ ${ng}件`);
process.exit(ng===0?0:1);
