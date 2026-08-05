// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// EdVenture — GAS Web App エンドポイント
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const SPREADSHEET_ID = "1EbGxrI6e-rmzgDk4jczOX1RfHIYY-6Q1jOPpr5Hybqc";
// IDトークンの aud を照合するために、サーバー側でもクライアントIDを持つ。
// これは秘密情報ではない（公開されている値）
const GOOGLE_CLIENT_ID_SERVER = "476804060858-n3afj7ipmc81vq8cq71u0u3jdpolshea.apps.googleusercontent.com";
const APP_URL = "https://kaisunagawa.github.io/edventure-app/";
const CLAUDE_API_KEY = PropertiesService.getScriptProperties().getProperty("CLAUDE_API_KEY");
const LINE_CHANNEL_TOKEN = PropertiesService.getScriptProperties().getProperty("LINE_CHANNEL_TOKEN");

// 生徒向けメッセージ共通の文末・絵文字ルール（コーチの声のトーンを統一する）。
// 「AIっぽい煽り」を抑え、自然な人間のコーチが送るLINEらしい落ち着いたトーンにする
const EMOJI_STYLE = `- テンションを上げすぎない。「〜じゃん！」「エネルギーに」「感覚を味わって」のような若者言葉・煽り表現は使わず、実際の人間が送る自然な文章にする
- 絵文字は使うとしても1メッセージ0〜1個まで。使わない文の方が多くてよい
- 2文以上ある場合は改行を入れて読みやすくする（1文1行を目安に）
- 「お前」「てめぇ」などの荒い二人称・乱暴な言葉は、親しみを込めたつもりでも威圧的に感じられるため絶対に使わない。親しい間柄でも「〇〇さん」または名前を呼ぶか、二人称を省略する
- ログのメモ等が音声入力由来で「磁力」「地録」「字録」など、このアプリ名「JIROKU」の誤変換・空耳と思われる表記になっている場合は、そのまま引用せず「JIROKU」に読み替えて書く`;

// XP閾値テーブル（非線形）: インデックス = レベル-1
// ★レベルは100まで★（2026-08-05 Kaiの判断）
//   もとは16段階だった。レジェンド＝Lv.100 を頂点にする。
//   XPの稼ぎ方は変えない。伸び方は XP(L)=13.415*(L-1)^1.9（最初は速く、後半はゆっくり）。
//   いまのレジェンド到達点(49,000XP)を新しいレジェンドの入口(Lv.76)に合わせてあるので、
//   すでに貯めた人が階級で降格することはない。
const XP_THRESHOLDS = [
  0, 13, 50, 108, 187, 286, 404, 541, 697, 872,
  1066, 1277, 1507, 1754, 2019, 2302, 2603, 2920, 3255, 3608,
  3977, 4363, 4766, 5186, 5623, 6077, 6547, 7033, 7537, 8056,
  8592, 9145, 9713, 10298, 10899, 11516, 12149, 12799, 13464, 14145,
  14842, 15555, 16284, 17028, 17789, 18565, 19356, 20163, 20986, 21825,
  22679, 23548, 24434, 25334, 26250, 27181, 28128, 29090, 30067, 31060,
  32068, 33091, 34129, 35183, 36251, 37335, 38434, 39548, 40677, 41821,
  42980, 44154, 45343, 46547, 47766, 49000, 50249, 51512, 52791, 54084,
  55392, 56715, 58053, 59406, 60773, 62155, 63552, 64963, 66389, 67830,
  69285, 70755, 72240, 73739, 75253, 76781, 78324, 79881, 81453, 83040
];

// ★階級★ 画面(index.html)の RANKS と必ず同じにすること。
//   片方だけ直すと「Lv.6 なのにチャレンジャー」のような食い違いが起きる。
//   .preview/check_shared.py が一致を見ている。
const RANKS = [
  { minLv:1,  maxLv:5,  name:"ルーキー" },
  { minLv:6,  maxLv:15, name:"チャレンジャー" },
  { minLv:16, maxLv:30, name:"コンシステント" },
  { minLv:31, maxLv:50, name:"習慣マスター" },
  { minLv:51, maxLv:75, name:"エキスパート" },
  { minLv:76, maxLv:99, name:"レジェンド" },
  { minLv:100,maxLv:100,name:"アルティメットレジェンド" }
];
function getRank(level) {
  for (var i = 0; i < RANKS.length; i++) {
    if (level >= RANKS[i].minLv && level <= RANKS[i].maxLv) return RANKS[i];
  }
  return RANKS[0];
}

function getXpLevel(xp) {
  let level = 1;
  for (let i = 1; i < XP_THRESHOLDS.length; i++) {
    if (xp >= XP_THRESHOLDS[i]) level = i + 1; else break;
  }
  return level;
}

// スプレッドシートのハンドルは openById() のたびに実測で数百ms〜1秒かかる。
// GASでは1リクエスト＝1実行で、このモジュール変数は実行ごとに初期化されるため、
// 実行の中では開いたハンドルを使い回して安全に高速化できる（読み取りは常に最新値を返す）。
var _ssHandle = null;
function getSpreadsheet() {
  if (!_ssHandle) _ssHandle = SpreadsheetApp.openById(SPREADSHEET_ID);
  return _ssHandle;
}
// シート名→Sheetオブジェクトも同じ理由で実行内キャッシュする（getSheetByNameの往復を省く）。
var _sheetHandles = {};
function getSheet(name) {
  if (_sheetHandles[name]) return _sheetHandles[name];
  var s = getSpreadsheet().getSheetByName(name);
  if (s) _sheetHandles[name] = s;
  return s;
}

function jsonResponse(data, callback) {
  const json = JSON.stringify(data);
  if (callback) {
    return ContentService.createTextOutput(callback + "(" + json + ")").setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET ハンドラー
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function doGet(e) {
  const action = e.parameter.action;
  let studentEmail = e.parameter.studentEmail;
  const callback = e.parameter.callback;
  try {
    let result;
    // ★トークンを送ってきたのに無効なら、ここで止める（従来経路へ落とさない）★
    var _st = strictTokenCheck(action, e.parameter.token);
    if (!_st.ok) return jsonResponse(_st, callback);
    // ── Auth CP2 ── 高リスクなアクションはセッションとロールを確認する。
    // ACTION_POLICIES に載っていないものは、この段階では素通り（CP3以降で広げる）
    var _az = authorizeAction(action, e.parameter.token,
                              e.parameter.targetEmail || e.parameter.target || "",
                              e.parameter.studentEmail || e.parameter.coachEmail, e.parameter.secret,
                              e.parameter);
    if (!_az.ok) return jsonResponse(_az, callback);
    // ★scope=SELF は、クライアントが送ったメールを無視して本人で上書きする★
    // これをしないと、認証を通していても他人のメールを書けばその人のデータを
    // 読み書きできてしまう（絞り込みは studentEmail を基準にしているため）
    if (_az.forceSelfEmail) { studentEmail = _az.forceSelfEmail; e.parameter.studentEmail = _az.forceSelfEmail; }
    switch (action) {
      case "getUser":      result = getUser(studentEmail); break;
      // ── Phase 1: 自己経営OS の基盤（管理者のみ実行可能なセットアップ）──
      case "adminPhase4DryRun": return jsonResponse(phase4DryRun());
      case "adminXpCorrection": {
        if (!verifyAdmin(e.parameter.coachEmail)) return jsonResponse({ ok: false, error: "not admin" });
        const em = String(e.parameter.email || "").trim();
        const delta = Number(e.parameter.delta || 0);
        const why = String(e.parameter.reason || "TEST_DATA_ROLLBACK");
        const refs = String(e.parameter.refs || "");
        if (!em) return jsonResponse({ ok: false, error: "no email" });
        const applied = xpApplyDelta_(em, delta);
        if (applied) {
          xpLedgerAdd_(em, "ADMIN", "adj_" + Date.now(), delta, why + (refs ? (" refs=" + refs) : ""));
          authAudit("XP_CORRECTION", { result: "APPLIED", action: "adminXpCorrection",
            failureReason: em + " " + applied.before + "->" + applied.after + " (" + delta + ") " + why + " refs=" + refs });
        }
        const st = recomputeStreak_(em, String(e.parameter.fixStreak || "") !== "1");
        authAudit("STREAK_RECALC", { result: st.dry_run ? "DRY_RUN" : "APPLIED", action: "adminXpCorrection",
          failureReason: em + " streak " + st.before + "->" + st.after + " last=" + st.last_log_date });
        return jsonResponse({ ok: true, xp: applied, streak: st, reason: why });
      }
      // 機能フラグの一括付与。dry=1 で件数だけ確認（既定はdry）
      case "adminGrantFeature": {
        if (!verifyAdmin(e.parameter.coachEmail)) return jsonResponse({ ok: false, error: "not admin" });
        const key = String(e.parameter.key || "").trim();
        const dryG = String(e.parameter.dry || "1") === "1";
        const onlyActive = String(e.parameter.activeOnly || "1") === "1";
        if (!/^[a-z0-9_]+$/.test(key)) return jsonResponse({ ok: false, error: "bad key" });
        const sh = getSheet("Users");
        const d = sh.getDataRange().getValues();
        const h = d[0];
        const iEm = h.indexOf("student_email");
        const iAct = h.indexOf("is_active");
        let iF = h.indexOf("features");
        if (iF === -1) { iF = h.length; if (!dryG) sh.getRange(1, iF + 1).setValue("features"); }
        let already = 0, target = 0, skipped = 0;
        const changed = [];
        for (let i = 1; i < d.length; i++) {
          const em = String(d[i][iEm] || "").trim();
          if (!em) continue;
          if (onlyActive && iAct !== -1 && String(d[i][iAct] || "").toUpperCase() !== "TRUE") { skipped++; continue; }
          const cur = String((iF < d[i].length ? d[i][iF] : "") || "");
          const list = cur.split(",").map(function (x) { return x.trim(); }).filter(Boolean);
          if (list.indexOf(key) !== -1) { already++; continue; }
          target++;
          list.push(key);
          changed.push(em);
          if (!dryG) sh.getRange(i + 1, iF + 1).setValue(list.join(","));
        }
        if (!dryG) authAudit("FEATURE_GRANT", { result: "APPLIED", action: "adminGrantFeature",
          failureReason: key + " granted=" + target + " already=" + already + " skipped=" + skipped });
        return jsonResponse({ ok: true, key: key, dry_run: dryG, granted: target,
                              already_had: already, skipped_inactive: skipped, emails: changed.slice(0, 50) });
      }
      case "adminStreakRecalc": {
        if (!verifyAdmin(e.parameter.coachEmail)) return jsonResponse({ ok: false, error: "not admin" });
        const em2 = String(e.parameter.email || "").trim();
        const dry = String(e.parameter.dry || "1") === "1";
        const r = recomputeStreak_(em2, dry);
        // 検証で減ってしまったフリーズを戻すなど、明示指定で書き戻す用（監査に残す）
        const setFreeze = String(e.parameter.setFreeze || "");
        if (!dry && setFreeze !== "" && !isNaN(Number(setFreeze))) {
          const uSheet = getSheet("Users");
          const uData = uSheet.getDataRange().getValues();
          const uH = uData[0];
          const iEm = uH.indexOf("student_email"), iFz = uH.indexOf("streak_freeze");
          for (let k = 1; k < uData.length; k++) {
            if (String(uData[k][iEm]) !== em2 || iFz === -1) continue;
            const bf = Number(uData[k][iFz] || 0);
            uSheet.getRange(k + 1, iFz + 1).setValue(Number(setFreeze));
            authAudit("STREAK_FREEZE_SET", { result: "APPLIED", action: "adminStreakRecalc",
              failureReason: em2 + " freeze " + bf + "->" + setFreeze });
            r.freeze_after = Number(setFreeze);
            break;
          }
        }
        if (!dry) authAudit("STREAK_RECALC", { result: "APPLIED", action: "adminStreakRecalc",
          failureReason: em2 + " " + r.before + "->" + r.after + " freeze " + r.freeze_before + "->" + r.freeze_after });
        return jsonResponse({ ok: true, result: r });
      }
      // 利用者1人の状態を読むだけの点検（ログイン・LINE連携・機能フラグ）
      case "adminUserDiag": {
        if (!verifyAdmin(e.parameter.coachEmail)) return jsonResponse({ ok: false, error: "not admin" });
        const q = String(e.parameter.q || "").trim().toLowerCase();
        if (!q) return jsonResponse({ ok: false, error: "no q" });
        const users = sheetToObjects(getSheet("Users")).filter(function (u) {
          return String(u.student_email || "").toLowerCase().indexOf(q) !== -1 ||
                 String(u.name || "").toLowerCase().indexOf(q) !== -1 ||
                 String(u.nickname || "").toLowerCase().indexOf(q) !== -1; });
        const sess = sheetToObjects(getAuthSheet("Sessions"));
        const now = Date.now();
        return jsonResponse({ ok: true, found: users.length, users: users.slice(0, 60).map(function (u) {
          const mine = sess.filter(function (x) { return String(x.user_id) === String(u.user_id); });
          const live = mine.filter(function (x) {
            return !String(x.revoked_at || "").trim() &&
                   new Date(String(x.expires_at)).getTime() > now &&
                   tokenVer_(x.token_version) >= tokenVer_(u.token_version); });
          return { email: u.student_email, name: u.name, nickname: u.nickname,
                   is_active: u.is_active, cohort: u.cohort || "",
                   line_linked: !!String(u.line_user_id || "").trim(),
                   features: String(u.features || ""),
                   streak: u.streak, last_log_date: String(u.last_log_date || ""),
                   sessions_total: mine.length, sessions_live: live.length,
                   last_session_at: mine.length ? String(mine[mine.length - 1].created_at || "") : "",
                   token_version: u.token_version, token_version_num: tokenVer_(u.token_version) };
        }) });
      }
      // 新しい採点方式を、実データで試算する（保存はしない）
      case "adminReportScoreDryRun": {
        if (!verifyAdmin(e.parameter.coachEmail)) return jsonResponse({ ok: false, error: "not admin" });
        const day = String(e.parameter.date || "").slice(0, 10) || formatDate(new Date());
        const users = sheetToObjects(getSheet("Users")).filter(function (u) {
          return String(u.is_active || "").toUpperCase() === "TRUE"; });
        const allLogs = sheetToObjects(getSheet("DailyLog"));
        const reports = sheetToObjects(getSheet("Reports"));
        const rows = [];
        users.forEach(function (u) {
          const logs = allLogs.filter(function (l) {
            const d = l.date instanceof Date ? Utilities.formatDate(l.date, "Asia/Tokyo", "yyyy-MM-dd") : String(l.date).slice(0, 10);
            return String(l.student_email) === u.student_email && d === day &&
                   !String(l.deleted_at || "").trim(); });
          if (!logs.length) return;
          const c = computeReportBreakdown_(u.student_email, logs, u, day);
          const old = reports.find(function (r) {
            const d = r.date instanceof Date ? Utilities.formatDate(r.date, "Asia/Tokyo", "yyyy-MM-dd") : String(r.date).slice(0, 10);
            return String(r.student_email) === u.student_email && d === day; });
          rows.push({ name: String(u.name || u.nickname || ""), old: old ? Number(old.score) : null,
                      neu: c.score, precise: c.score_precise, b: c.breakdown, f: c.facts });
        });
        rows.sort(function (a, b) { return b.precise - a.precise; });
        const scores = rows.map(function (r) { return r.neu; });
        const dupNew = scores.length - new Set(scores).size;
        const oldScores = rows.map(function (r) { return r.old; }).filter(function (x) { return x !== null; });
        const dupOld = oldScores.length - new Set(oldScores).size;
        return jsonResponse({ ok: true, date: day, users: rows.length,
          ties_old: dupOld, ties_new: dupNew,
          avg_new: scores.length ? Math.round(scores.reduce(function (a, b) { return a + b; }, 0) / scores.length) : null,
          rows: rows });
      }
      // 夜のレポート生成を、保存せずに1人分だけ試す（今夜の本番前の確認用）
      case "adminReportGenTest": {
        if (!verifyAdmin(e.parameter.coachEmail)) return jsonResponse({ ok: false, error: "not admin" });
        const em3 = String(e.parameter.email || "").trim();
        const day3 = String(e.parameter.date || "").slice(0, 10) || formatDate(new Date());
        const u3 = sheetToObjects(getSheet("Users")).find(function (x) { return x.student_email === em3; });
        if (!u3) return jsonResponse({ ok: false, error: "no user" });
        const logs3 = sheetToObjects(getSheet("DailyLog")).filter(function (l) {
          const d = l.date instanceof Date ? Utilities.formatDate(l.date, "Asia/Tokyo", "yyyy-MM-dd") : String(l.date).slice(0, 10);
          return String(l.student_email) === em3 && d === day3 && !String(l.deleted_at || "").trim(); })
          .sort(function (a, b) { return String(a.time_block) > String(b.time_block) ? 1 : -1; })
          .map(function (r) { return { time_block: r.time_block, task: r.task, focus_level: r.focus_level,
                                       memo: r.memo, goal_related: r.goal_related, date: day3 }; });
        if (!logs3.length) return jsonResponse({ ok: false, error: "no logs", date: day3 });
        const rep = generateReportWithClaude(em3, u3.name, logs3);
        if (!rep) return jsonResponse({ ok: false, error: REPORT_GEN_LAST_ERROR || "generation failed" });
        return jsonResponse({ ok: true, saved: false, date: day3, score: rep.score,
          score_precise: rep.score_precise, breakdown: rep.breakdown, facts: rep.score_facts,
          feedback: rep.feedback, highlights: rep.highlights, improvement: rep.improvement,
          action: rep.action, reasons: rep.breakdown_reasons });
      }
      // 点数が食い違っていないかを、サーバー側で突き合わせる（4か所）
      // 過去の日を締める（夜のバッチが動く前の日を、あとから確定させる）
      case "adminFinalizeOps": {
        if (!verifyAdmin(e.parameter.coachEmail)) return jsonResponse({ ok: false, error: "not admin" });
        const days = String(e.parameter.dates || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean);
        if (!days.length) return jsonResponse({ ok: false, error: "no dates" });
        const users = sheetToObjects(getSheet("Users")).filter(function (u) {
          return String(u.is_active || "").toUpperCase() === "TRUE" && hasFeature(u, OPS_FEATURE_KEY); });
        const out = [];
        users.forEach(function (u) {
          days.forEach(function (d) {
            try {
              const r = finalizeDailyOpsReport(u.student_email, d);
              out.push(u.student_email + " " + d + " " + (r.ok ? ((r.already ? "既に確定 " : "確定 ") + r.score) : "対象なし"));
            } catch (e2) { out.push(u.student_email + " " + d + " エラー"); }
          });
        });
        return jsonResponse({ ok: true, results: out });
      }
      // ★確定を取り消す★（2026-08-05）
      //   確定は「以後その日の点数を動かさない」という操作。
      //   間違って日中に確定させてしまうと、その日は記録が増えても
      //   点数が更新されず、夜のレポートも作り直されない。
      //   取り消せる手段が無いと戻せないので用意する。
      case "adminUnfinalizeOps": {
        if (!verifyAdmin(e.parameter.coachEmail)) return jsonResponse({ ok: false, error: "not admin" });
        const days2 = String(e.parameter.dates || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean);
        if (!days2.length) return jsonResponse({ ok: false, error: "no dates" });
        const sh2 = getP1Sheet("DailyOpsReport");
        const d2 = sh2.getDataRange().getValues();
        const h2 = d2[0];
        const iDate = h2.indexOf("report_date"), iFin = h2.indexOf("finalized_at"), iSnap = h2.indexOf("snapshot_json");
        if (iDate === -1 || iFin === -1) return jsonResponse({ ok: false, error: "column missing" });
        let cleared = 0, scanned = 0;
        for (let i = 1; i < d2.length; i++) {
          // ★シートは日付をDate型で返すことがある★
          //   String(Dateオブジェクト).slice(0,10) は "Wed Aug 0" になり、
          //   "2026-08-05" と一致しない。必ず書式をそろえてから比べる。
          const raw2 = d2[i][iDate];
          const dv = (raw2 instanceof Date)
            ? Utilities.formatDate(raw2, "Asia/Tokyo", "yyyy-MM-dd")
            : String(raw2).slice(0, 10);
          if (days2.indexOf(dv) === -1) continue;
          scanned++;
          if (!String(d2[i][iFin] || "").trim()) continue;
          sh2.getRange(i + 1, iFin + 1).setValue("");
          if (iSnap !== -1) sh2.getRange(i + 1, iSnap + 1).setValue("");
          cleared++;
        }
        authAudit("OPS_UNFINALIZE", { result: "APPLIED", action: "adminUnfinalizeOps",
          failureReason: days2.join(",") + " cleared=" + cleared });
        return jsonResponse({ ok: true, dates: days2, matched_rows: scanned, cleared: cleared });
      }
      // ★すでに書いたカレンダーの色を、今の分類の色に塗り直す★（2026-08-05）
      //   色の対応を変えたので、前に書いた予定は古い色のまま残る。
      //   記録（DailyLog）の分類を正として、予定の色だけを直す。
      //   予定の中身（題名・時刻）は触らない。
      //     dry=1（既定）… 塗らずに、何件どう変わるかだけ返す
      //     days=30      … 遡る日数（既定30・最大180）
      case "adminRecolorCalendar": {
        if (!verifyAdmin(e.parameter.coachEmail)) return jsonResponse({ ok: false, error: "not admin" });
        const dryR = String(e.parameter.dry || "1") !== "0";
        const daysR = Math.max(1, Math.min(180, Number(e.parameter.days) || 30));
        const emR = String(e.parameter.email || "").trim() || adminEmail();
        const uR = getFilteredRows("Users", "student_email", emR)[0];
        const calIdR = (uR && uR.google_calendar_id) ? uR.google_calendar_id : null;
        if (!calIdR) return jsonResponse({ ok: false, error: "no google_calendar_id" });
        let calR = null;
        try { calR = CalendarApp.getCalendarById(calIdR); } catch (err) { calR = null; }
        if (!calR) return jsonResponse({ ok: false, error: "calendar not accessible" });

        const fromR = new Date(); fromR.setDate(fromR.getDate() - daysR); fromR.setHours(0, 0, 0, 0);
        const toR = new Date(); toR.setDate(toR.getDate() + 1); toR.setHours(0, 0, 0, 0);
        // その期間の記録を「日付＋開始時刻」で引けるようにする
        const byStart = {};
        p1List("DailyLog", emR).forEach(function (r) {
          const dt = String(r.date instanceof Date ? formatDate(r.date) : r.date || "").slice(0, 10);
          const tb = String(r.time_block || "");
          if (!dt || !tb) return;
          byStart[dt + " " + tb.slice(0, 5)] = String(r.time_classification || "");
        });

        let scannedR = 0, changed = 0, unmatched = 0;
        const plan = {};
        let evsR = [];
        try { evsR = calR.getEvents(fromR, toR); } catch (err) { evsR = []; }
        evsR.forEach(function (ev) {
          const t = String(ev.getTitle() || "").replace(/\uFE0F/g, "").trim();
          const isJ = ev.getTag("jirokuRecord") === "1" || t.charAt(0) === "\u2714" || t.charAt(0) === "\u2705";
          if (!isJ) return;   // JIROKU以外の予定には触らない
          scannedR++;
          const st = ev.getStartTime();
          const key = Utilities.formatDate(st, "Asia/Tokyo", "yyyy-MM-dd HH:mm");
          const cls = byStart[key];
          if (cls === undefined) { unmatched++; return; }
          const want = ownerCalColorId_(cls);
          let now = "";
          try { now = String(ev.getColor() || ""); } catch (err) {}
          if (want === now) return;
          plan[(cls || "(未分類)")] = (plan[(cls || "(未分類)")] || 0) + 1;
          changed++;
          if (!dryR) { try { ev.setColor(want); } catch (err) {} }
        });
        return jsonResponse({ ok: true, dry: dryR, email: emR, days: daysR,
          scanned: scannedR, would_change: changed, unmatched: unmatched, by_class: plan });
      }
      // ★記録に入っている分類の値を数えるだけのコマンド（調査用・書き込みなし）★
      //   今の分類（TIME_CLASSES）に無い値がどれだけ残っているかを見る。
      //   まとめて書き換えるかどうかは、この結果を見てから決める。
      //     &days=90 で遡る日数を変えられる（既定90日）
      case "adminClassAudit": {
        if (!verifyAdmin(e.parameter.coachEmail)) return jsonResponse({ ok: false, error: "not admin" });
        const dAgo = Math.max(1, Math.min(400, Number(e.parameter.days) || 90));
        const cutA = formatDate(new Date(Date.now() - dAgo * 86400000));
        const rowsA = sheetToObjects(getSheet("DailyLog"));
        const known = {}, unknown = {};
        let scannedA = 0;
        rowsA.forEach(function (r) {
          const dt = String(r.date instanceof Date ? formatDate(r.date) : r.date || "").slice(0, 10);
          if (!dt || dt < cutA) return;
          scannedA++;
          const c = String(r.time_classification || "").trim();
          if (!c) return;
          if (TIME_CLASSES[c]) known[c] = (known[c] || 0) + 1;
          else {
            if (!unknown[c]) unknown[c] = { count: 0, users: {}, sample: [] };
            unknown[c].count++;
            unknown[c].users[String(r.student_email || "")] = 1;
            if (unknown[c].sample.length < 3) {
              unknown[c].sample.push(dt + " " + String(r.time_block || "") + " " + String(r.task || "").slice(0, 24));
            }
          }
        });
        return jsonResponse({ ok: true, days: dAgo, scanned: scannedA, known: known,
          unknown: Object.keys(unknown).map(function (k) {
            return { value: k, count: unknown[k].count,
                     users: Object.keys(unknown[k].users).length, sample: unknown[k].sample }; })
            .sort(function (a, b) { return b.count - a.count; }) });
      }
      // ★隠しジローの棚卸し★（2026-08-05）
      //   これまでの記録を数えて、Users の jiro_counts / jiro_found を作り直す。
      //   dry=1 なら書き込まず、誰が何体になるかだけ返す。
      //     bash gas/ops.sh adminJiroBackfill dry=1
      case "adminJiroBackfill": {
        if (!verifyAdmin(e.parameter.coachEmail)) return jsonResponse({ ok: false, error: "not admin" });
        const dryJ = String(e.parameter.dry || "") === "1";
        const logsJ = sheetToObjects(getSheet("DailyLog"));
        const perUser = {};
        logsJ.forEach(function (r) {
          if (String(r.deleted_at || "").trim()) return;
          const em = String(r.student_email || ""); if (!em) return;
          const c = perUser[em] || (perUser[em] = {});
          const cls = String(r.time_classification || "").trim();
          if (cls && TIME_CLASSES[cls]) c[cls] = (c[cls] || 0) + 1;
          if (jiroIsNight_(r.time_block)) c.night = (c.night || 0) + 1;
        });
        // 90点以上の連続日数（今日を末尾に数える）
        const repSheet = getSheet("Reports");
        const todayJ = formatDate(new Date());
        const usersJ = sheetToObjects(getSheet("Users"));
        const outJ = [];
        usersJ.forEach(function (u) {
          const em = String(u.student_email || ""); if (!em) return;
          const c = perUser[em] || {};
          try { c.hiscore7 = jiroHighScoreRun_(repSheet, em, todayJ); } catch (e2) { c.hiscore7 = 0; }
          const r = jiroApply_(c, [], {}, {});
          outJ.push({ email: em, name: String(u.nickname || u.name || ""),
                      counts: c, found: r.found, count: r.found.length });
        });
        if (!dryJ) {
          const sh = getSheet("Users");
          const dataJ = sh.getDataRange().getValues();
          const hdrJ = dataJ[0];
          const iEmJ = hdrJ.indexOf("student_email");
          let iCJ = hdrJ.indexOf("jiro_counts"), iFJ = hdrJ.indexOf("jiro_found");
          if (iCJ === -1) { iCJ = hdrJ.length; sh.getRange(1, iCJ + 1).setValue("jiro_counts"); }
          if (iFJ === -1) { iFJ = (iCJ === hdrJ.length ? hdrJ.length + 1 : hdrJ.length);
                            sh.getRange(1, iFJ + 1).setValue("jiro_found"); }
          const byEmail = {}; outJ.forEach(function (o) { byEmail[o.email] = o; });
          for (let i = 1; i < dataJ.length; i++) {
            const o = byEmail[String(dataJ[i][iEmJ])]; if (!o) continue;
            sh.getRange(i + 1, iCJ + 1).setValue(JSON.stringify(o.counts));
            sh.getRange(i + 1, iFJ + 1).setValue(o.found.join(","));
          }
        }
        return jsonResponse({ ok: true, dry: dryJ, users: outJ.length,
          total_found: outJ.reduce(function (a, o) { return a + o.count; }, 0),
          detail: outJ.sort(function (a, b) { return b.count - a.count; }) });
      }
      // ★token_version の書式崩れを直す★（2026-08-05）
      //   セルが時刻書式になっていると 0 が Date(00:00) として読まれ、
      //   セッションが毎回無効になって、何度ログインしても入れなくなる。
      //   数字として読めない行を、数字の0に直す。
      //     bash gas/ops.sh adminFixTokenVersion dry=1
      case "adminFixTokenVersion": {
        if (!verifyAdmin(e.parameter.coachEmail)) return jsonResponse({ ok: false, error: "not admin" });
        const dryT = String(e.parameter.dry || "") === "1";
        const shT = getSheet("Users");
        const dataT = shT.getDataRange().getValues();
        const hT = dataT[0];
        const iEmT = hT.indexOf("student_email"), iNmT = hT.indexOf("name");
        const iTvT = hT.indexOf("token_version");
        if (iTvT === -1) return jsonResponse({ ok: false, error: "token_version 列がありません" });
        const fixed = [];
        for (let i = 1; i < dataT.length; i++) {
          const raw = dataT[i][iTvT];
          const isNum = (typeof raw === "number") && isFinite(raw);
          if (isNum) continue;
          if (raw === "" || raw === null || raw === undefined) continue;  // 空欄はそのままで問題ない
          fixed.push({ email: String(dataT[i][iEmT] || ""), name: String(dataT[i][iNmT] || ""),
                       before: String(raw), after: 0 });
          if (!dryT) {
            const cell = shT.getRange(i + 1, iTvT + 1);
            cell.setNumberFormat("0");   // 時刻書式に戻らないようにする
            cell.setValue(0);
          }
        }
        return jsonResponse({ ok: true, dry: dryT, count: fixed.length, fixed: fixed });
      }
      // みんなの頑張りが何秒かかっているかを測る（読むだけ・書き込みなし）
      //   bash gas/ops.sh adminCommunityTiming
      case "adminCommunityTiming": {
        if (!verifyAdmin(e.parameter.coachEmail)) return jsonResponse({ ok: false, error: "not admin" });
        const t0 = Date.now();
        // 段階ごとの内訳（どこで時間を使っているかを実測する）
        const stage = {};
        let tp = Date.now();
        sheetToObjects(getSheet("Users")); stage.Users = Date.now() - tp; tp = Date.now();
        sheetToObjects(getSheet("Reports")); stage.Reports = Date.now() - tp; tp = Date.now();
        opsLatestIndex_(); stage.DailyOpsReport = Date.now() - tp; tp = Date.now();
        (function(){ const dl = getSheet("DailyLog"); const lr = dl.getLastRow();
          if (lr > 1) dl.getRange(2, 1, lr - 1, 4).getValues(); })();
        stage.DailyLog = Date.now() - tp;
        const tAll = Date.now();
        const r0 = getCommunity(adminEmail());
        const t1 = Date.now();
        return jsonResponse({ ok: true, ms: t1 - tAll, 内訳: stage, 合計: t1 - t0,
          counts: { list: (r0.data||[]).length, level: (r0.levelRanking||[]).length,
                    streak: (r0.streakRanking||[]).length, report: (r0.reportRanking||[]).length,
                    recent: (r0.recentLoggers||[]).length } });
      }
      // 古いchallengeを捨てる（ログインの遅さ対策）
      //   bash gas/ops.sh adminPurgeChallenges
      case "adminPurgeChallenges": {
        if (!verifyAdmin(e.parameter.coachEmail)) return jsonResponse({ ok: false, error: "not admin" });
        return jsonResponse(authPurgeOldChallenges());
      }
      // 自己経営力の中身を読むだけのコマンド（調査用・書き込みなし）
      // ★レベルのズレを調べる（読むだけ・書き込みなし）★（2026-08-05）
      //   「35日続けているのにルーキーのまま」のような食い違いを見つける。
      //   記録した日数に対してXPが少なすぎる人を洗い出す。
      //     bash gas/ops.sh adminLevelAudit days=60
      case "adminLevelAudit": {
        if (!verifyAdmin(e.parameter.coachEmail)) return jsonResponse({ ok: false, error: "not admin" });
        const dA = Math.max(7, Math.min(180, Number(e.parameter.days) || 60));
        const cutA = formatDate(new Date(Date.now() - dA * 86400000));
        const logsA = sheetToObjects(getSheet("DailyLog"));
        const byUser = {};
        logsA.forEach(function (l) {
          const dt = String(l.date instanceof Date ? formatDate(l.date) : l.date || "").slice(0, 10);
          if (!dt || dt < cutA) return;
          const em = String(l.student_email || "");
          if (!byUser[em]) byUser[em] = { rows: 0, days: {}, memo: 0, focus: 0, awarded: 0 };
          byUser[em].rows++;
          byUser[em].days[dt] = 1;
          if (String(l.memo || "").trim()) byUser[em].memo++;
          if (String(l.focus_level || "").trim()) byUser[em].focus++;
          if (String(l.xp_awarded || "").toUpperCase() === "TRUE") byUser[em].awarded++;
        });
        const led = {};
        try {
          sheetToObjects(getSheet("XpEvents")).forEach(function (r) {
            const em = String(r.student_email || "");
            led[em] = (led[em] || 0) + (Number(r.amount) || 0);
          });
        } catch (err) {}
        const rowsA = sheetToObjects(getSheet("Users"))
          .filter(function (u) { return String(u.is_active || "").toUpperCase() === "TRUE"; })
          .map(function (u) {
            const em = u.student_email;
            const st = byUser[em] || { rows: 0, days: {}, memo: 0, focus: 0, awarded: 0 };
            const nDays = Object.keys(st.days).length;
            const xp = Number(u.xp || 0);
            const lv = getXpLevel(xp);
            // 記録1件で10XP、メモで+5XP。連続ボーナスを除いた最低ライン
            const expect = st.rows * 10 + st.memo * 5;
            return { email: em, nickname: u.nickname || "", streak: Number(u.streak || 0),
                     xp: xp, level: lv, rank: getRank(lv).name,
                     recorded_days: nDays, records: st.rows, memos: st.memo,
                     with_focus: st.focus, xp_awarded_rows: st.awarded,
                     xp_expected_min: expect, xp_ledger: led[em] || 0,
                     gap: expect - xp,
                     suspicious: (nDays >= 7 && xp < expect * 0.5) };
          })
          .sort(function (a, b) { return b.gap - a.gap; });
        return jsonResponse({ ok: true, days: dA,
          suspicious_count: rowsA.filter(function (r) { return r.suspicious; }).length,
          users: rowsA });
      }
      // ★減点で削られたXPを戻す★（2026-08-05 Kaiの判断）
      //   減点に下限が無く、215件記録した人が28%、123件記録した人が2%まで
      //   落ちていた。記録の事実から積み上げを計算し直して戻す。
      //   台帳(XpEvents)は最近のぶんしか無いので、記録件数から再計算する。
      //     dry=1（既定）… 戻さずに、誰がいくつになるかだけ返す
      case "adminXpRestore": {
        if (!verifyAdmin(e.parameter.coachEmail)) return jsonResponse({ ok: false, error: "not admin" });
        const dryR2 = String(e.parameter.dry || "1") !== "0";
        const logsR = sheetToObjects(getSheet("DailyLog"));
        const agg = {};
        logsR.forEach(function (l) {
          if (String(l.deleted_at || "").trim()) return;
          if (!String(l.focus_level || "").trim()) return;   // 評価が入った記録だけがXPの対象
          const em = String(l.student_email || "");
          if (!agg[em]) agg[em] = { rows: 0, memo: 0 };
          agg[em].rows++;
          if (String(l.memo || "").trim()) agg[em].memo++;
        });
        const sheetR = getSheet("Users");
        const dataR = sheetR.getDataRange().getValues();
        const hR = dataR[0];
        const iEmR = hR.indexOf("student_email");
        const iXpR = hR.indexOf("xp");
        let iPkR = hR.indexOf("peak_level");
        if (iPkR === -1) { iPkR = hR.length; sheetR.getRange(1, iPkR + 1).setValue("peak_level"); }
        const outR = [];
        for (let i = 1; i < dataR.length; i++) {
          const em = String(dataR[i][iEmR] || "");
          const a = agg[em];
          if (!a) continue;
          const cur = Number(dataR[i][iXpR] || 0);
          // 記録から積み上がるXPの下限（連続ボーナスは含めない＝控えめに戻す）
          const base = a.rows * 10 + a.memo * 5;
          if (base <= cur) continue;     // すでに足りている人は触らない
          const lv = getXpLevel(base);
          outR.push({ email: em, nickname: String(dataR[i][hR.indexOf("nickname")] || ""),
                      before: cur, after: base, level_after: lv, rank_after: getRank(lv).name,
                      records: a.rows, memos: a.memo });
          if (!dryR2) {
            sheetR.getRange(i + 1, iXpR + 1).setValue(base);
            if (lv > Number(dataR[i][iPkR] || 0)) sheetR.getRange(i + 1, iPkR + 1).setValue(lv);
          }
        }
        return jsonResponse({ ok: true, dry: dryR2, changed: outR.length, users: outR });
      }
      case "adminSmpWarmAll": {
        result = adminSmpWarmAll(e.parameter.coachEmail); break;
      }
      case "adminSmpDump": {
        if (!verifyAdmin(e.parameter.coachEmail)) return jsonResponse({ ok: false, error: "not admin" });
        const em5 = String(e.parameter.email || "").trim() || adminEmail();
        const r5 = computeSelfMgmtPower(em5, null);
        return jsonResponse({ ok: true, email: em5,
          period: r5.period_start + "〜" + r5.period_end,
          overall: r5.overall_score, evaluated: r5.evaluated_count,
          metrics: (r5.metrics || []).map(function (m) {
            return { key: m.key, label: m.label, score: m.score,
                     state: m.evaluation_state, provisional: m.provisional,
                     coverage: Math.round((m.coverage || 0) * 100) / 100,
                     status_label: m.status_label,
                     parts: (m.components || []).map(function (c) {
                       return c.label + "=" + (c.state === "evaluated" ? c.value : "×(" + (c.reason_code || "") + ")"); }) };
          }) });
      }
      // ★「＋」で作られてしまった時間の記録を片づける★（2026-08-05）
      //   仕様変更前の「＋」は、実績を足すために時間の記録を1件作っていた。
      //   実際にはやっていない「アポ6件獲得」などが記録に並んでしまうため、
      //   その分だけを消す。見分け方は「量だけがあって、中身が無い」記録。
      //     ・quantity が入っている
      //     ・primary_weekly_goal_id が入っている
      //     ・自己評価もメモも空（どちらか入っていれば本物の記録として残す）
      //   dry=1（既定）では消さずに一覧を返す。
      case "adminCleanupPlusLogs": {
        if (!verifyAdmin(e.parameter.coachEmail)) return jsonResponse({ ok: false, error: "not admin" });
        const em6 = String(e.parameter.email || "").trim() || adminEmail();
        const dry6 = String(e.parameter.dry || "1") === "1";
        const sh6 = getSheet("DailyLog");
        const d6 = sh6.getDataRange().getValues();
        const h6 = d6[0];
        const iEm6 = h6.indexOf("student_email"), iDt6 = h6.indexOf("date"), iTb6 = h6.indexOf("time_block");
        const iTk6 = h6.indexOf("task"), iFc6 = h6.indexOf("focus_level"), iMm6 = h6.indexOf("memo");
        const iQt6 = h6.indexOf("quantity"), iPw6 = h6.indexOf("primary_weekly_goal_id");
        const iDl6 = h6.indexOf("deleted_at");
        if (iQt6 === -1 || iPw6 === -1 || iDl6 === -1) return jsonResponse({ ok: false, error: "column missing" });
        const hits = [];
        for (let i = 1; i < d6.length; i++) {
          if (String(d6[i][iEm6]) !== em6) continue;
          if (String(d6[i][iDl6] || "").trim()) continue;
          const q = Number(d6[i][iQt6]);
          if (isNaN(q) || q === 0) continue;
          if (!String(d6[i][iPw6] || "").trim()) continue;
          if (String(d6[i][iFc6] || "").trim()) continue;
          if (String(d6[i][iMm6] || "").trim()) continue;
          const raw6 = d6[i][iDt6];
          const dv6 = (raw6 instanceof Date) ? Utilities.formatDate(raw6, "Asia/Tokyo", "yyyy-MM-dd") : String(raw6).slice(0, 10);
          hits.push({ date: dv6, time_block: String(d6[i][iTb6]), task: String(d6[i][iTk6]), quantity: q });
          if (!dry6) sh6.getRange(i + 1, iDl6 + 1).setValue(new Date().toISOString());
        }
        if (!dry6) authAudit("PLUS_LOG_CLEANUP", { result: "APPLIED", action: "adminCleanupPlusLogs",
          failureReason: em6 + " removed=" + hits.length });
        return jsonResponse({ ok: true, email: em6, dry_run: dry6, count: hits.length, rows: hits.slice(0, 50) });
      }
      case "adminScoreConsistency": {
        if (!verifyAdmin(e.parameter.coachEmail)) return jsonResponse({ ok: false, error: "not admin" });
        const em4 = String(e.parameter.email || "").trim() || adminEmail();
        const day4 = String(e.parameter.date || "").slice(0, 10) || formatDate(new Date());
        const detail = getDailyOpsReport(em4, { date: day4 });
        const dv = (detail && detail.ok && detail.data) ? detail.data.displayed_score : null;
        const listR = getReportList(em4);
        const lrow = (listR.data || []).find(function (r) { return String(r.date).slice(0, 10) === day4; });
        const lv = lrow ? lrow.score : null;
        const rk = getRanking(em4);
        const rv = (rk && rk.data) ? rk.data.score : null;
        const comm = getCommunity(em4);
        let cv = null;
        try {
          const arr = Object.keys(comm.data || {}).filter(function (k) { return /^\d+$/.test(k); })
                        .map(function (k) { return comm.data[k]; });
          const me = arr.find(function (x) { return x.isMe; });
          cv = me ? me.reportScore : null;
        } catch (e2) {}
        const vals = { detail: dv, list: lv, ranking: rv, community: cv };
        // ランキングと「みんなの頑張り」は最新レポート日を見るので、
        // 指定日が最新日でなければ比較対象から外す
        const latest = (listR.data || [])[0];
        const isLatest = latest && String(latest.date).slice(0, 10) === day4;
        const target = isLatest ? ["detail", "list", "ranking", "community"] : ["detail", "list"];
        const seen = {};
        target.forEach(function (k) { if (vals[k] !== null && vals[k] !== undefined) seen[String(vals[k])] = 1; });
        const uniq = Object.keys(seen);
        return jsonResponse({ ok: true, date: day4, email: em4, checked: target,
          values: vals, consistent: uniq.length <= 1,
          note: isLatest ? "" : "指定日が最新のレポートではないため、ランキングと共有欄は比較していません" });
      }
      case "adminActualMinutesAudit":
        return jsonResponse(verifyAdmin(e.parameter.coachEmail)
          ? actualMinutesAudit() : { ok: false, error: "not admin" });
      case "adminOpsSelfTest":
        return jsonResponse(verifyAdmin(e.parameter.coachEmail)
          ? opsSelfTest(e.parameter.studentEmail, e.parameter.date) : { ok: false, error: "not admin" });
      case "adminLegacyBackfill":
        return jsonResponse(legacyBackfill(String(e.parameter.execute || "") === "1", e.parameter.migrationId));
      case "adminWritePathStats": {
        const p = PropertiesService.getScriptProperties();
        const out = {};
        for (let i = 0; i < 14; i++) {
          const d = Utilities.formatDate(new Date(Date.now() - i * 86400000), "Asia/Tokyo", "yyyyMMdd");
          out[d] = { bridge: Number(p.getProperty("wp_JOURNAL_BRIDGE_" + d) || 0),
                     direct: Number(p.getProperty("wp_TASKS_DIRECT_" + d) || 0) };
        }
        return jsonResponse({ ok: true, days: out });
      }
      // 検証用セッションの発行と削除（署名必須・監査ログ付き）。
      // ローカルでの画面検証に使う。device_label=localtest で必ず区別し、
      // 検証が終わったら adminDropTestSessions で行ごと消す運用。
      // 正規の issueSession を通さない理由: 上限5本の押し出しで
      // 本人の実機セッションが失効してしまうため。
      case "adminIssueTestSession": {
        const me = String(e.parameter.email || "").trim();
        const u = sheetToObjects(getSheet("Users")).find(function (x) {
          return String(x.student_email || "").trim() === me;
        });
        if (!u) return jsonResponse({ ok: false, error: "no user" });
        const token = newSessionToken(u.user_id);
        const now = new Date();
        getAuthSheet("Sessions").appendRow([
          sha256Hex(token), u.user_id, u.google_sub || "", u.auth_role || u.role || "USER", u.organization_id || "",
          new Date(now.getTime() + 86400000).toISOString(), now.toISOString(), now.toISOString(), "",
          tokenVer_(u.token_version), "localtest"
        ]);
        authAudit("TEST_SESSION", { result: "ISSUED", action: "adminIssueTestSession" });
        return jsonResponse({ ok: true, token: token });
      }
      case "adminDropTestSessions": {
        const sh = getAuthSheet("Sessions");
        const v = sh.getDataRange().getValues();
        const iDev = v[0].indexOf("device_label");
        let n = 0;
        for (let i = v.length - 1; i >= 1; i--) {
          if (String(v[i][iDev]) === "localtest") { sh.deleteRow(i + 1); n++; }
        }
        authAudit("TEST_SESSION", { result: "DROPPED", action: "adminDropTestSessions", failureReason: "n=" + n });
        return jsonResponse({ ok: true, dropped: n });
      }
      case "adminSetupPhase1": {
        // シート構造を変える操作。共有シークレットを必須にする
        var _a1 = verifyP1Admin(studentEmail, e.parameter.secret, e.parameter);
        if (!_a1.ok) { result = _a1; break; }
        result = setupPhase1();
        break;
      }
      case "getGoalTree": result = getGoalTree(studentEmail); break;
      // ── Auth CP1: 公開アクション（認証不要）──
      case "authChallenge": result = authChallenge(); break;
      case "authRevokeAll": {
        // 全端末ログアウト。token_version を1つ上げると既存セッションは
        // すべて検証に失敗する（verifySessionが版ずれを検出する）
        var _ra = verifyP1Admin(studentEmail, e.parameter.secret, e.parameter);
        if (!_ra.ok) { result = _ra; break; }
        var _sh = getSheet("Users");
        var _dt = _sh.getDataRange().getValues(), _hd = _dt[0];
        var _ie = _hd.indexOf("student_email"), _iv = _hd.indexOf("token_version");
        var _target = String(e.parameter.target || studentEmail);
        for (var _k = 1; _k < _dt.length; _k++) {
          if (String(_dt[_k][_ie]) !== _target) continue;
          var _nv = Number(_dt[_k][_iv] || 0) + 1;
          _sh.getRange(_k + 1, _iv + 1).setValue(_nv);
          authAudit("REVOKE_ALL", { result: "SUCCESS", actorUserId: studentEmail, targetUserId: _target, action: "authRevokeAll" });
          result = { ok: true, target: _target, newTokenVersion: _nv };
          break;
        }
        if (!result) result = { ok: false, error: "user not found" };
        break;
      }
      // ★全員のセッションを一度に失効させる★
      // 旧方式ではセッショントークンがURLのクエリに載っていた。
      // クエリはブラウザ履歴・中間のログ・Googleのアクセスログに残るため、
      // 発行済みのトークンは「漏れたかもしれないもの」として扱う。
      // 実際に漏れた証拠は無いが、証拠が無いことは安全の根拠にならない。
      //
      // 失効させると全員が再ログインになる。記録は消えない。
      // confirm=yes が無ければ対象を数えるだけで何もしない。
      case "authRevokeAllUsers": {
        var _rau = verifyP1Admin(studentEmail, e.parameter.secret, e.parameter);
        if (!_rau.ok) { result = _rau; break; }
        result = authRevokeAllUsers(String(e.parameter.confirm || "") === "yes",
                                    String(e.parameter.reason || "url_token_rotation"));
        break;
      }
      // 検証で作ってしまった架空ユーザーの掃除。
      // ★対象は .invalid ドメインだけ★（RFC 2606 で「絶対に実在しない」と
      // 予約されているドメイン）。実在の利用者には構造上あたらない。
      case "adminPurgeTestUsers": {
        var _ptu = verifyP1Admin(studentEmail, e.parameter.secret, e.parameter);
        if (!_ptu.ok) { result = _ptu; break; }
        result = adminPurgeTestUsers(String(e.parameter.confirm || "") === "yes");
        break;
      }
      // 調査用の adminInspectTodayActions は 2026-08-02 に削除した。
      // 同期しない原因を推測で4回追ってしまったため、サーバーの中身を
      // 直接見る口を一時的に置いた。原因が分かったので消す。
      // 読み取り専用ではあるが、他人の記録を引ける口を残さない。
      // ★移行は署名付きで実行できるようにする★
      //   本人セッションだと、こちらで検証できない。
      //   移行は「何件どうなるか」を確かめてから実行する必要があるため、
      //   運用コマンドから叩ける経路を用意する。
      //   target を省略すると管理者自身が対象。
      case "adminMigrateTasks": {
        var _amt = verifyP1Admin(studentEmail, e.parameter.secret, e.parameter);
        if (!_amt.ok) { result = _amt; break; }
        result = migrateTasksToSheet(String(e.parameter.target || adminEmail()), e.parameter);
        break;
      }
      case "authCleanupTestData": {
        var _ac = verifyP1Admin(studentEmail, e.parameter.secret, e.parameter);
        if (!_ac.ok) { result = _ac; break; }
        result = authCleanupTestData();
        break;
      }
      case "authRoleApply": {
        var _rp = verifyP1Admin(studentEmail, e.parameter.secret, e.parameter);
        if (!_rp.ok) { result = _rp; break; }
        result = authRoleApply();
        break;
      }
      case "authRoleDryRun": {
        var _ar = verifyP1Admin(studentEmail, e.parameter.secret, e.parameter);
        if (!_ar.ok) { result = _ar; break; }
        result = authRoleDryRun();
        break;
      }
      case "authBreakerReset": {
        var _br = verifyP1Admin(studentEmail, e.parameter.secret, e.parameter);
        if (!_br.ok) { result = _br; break; }
        result = breakerReset();
        break;
      }
      case "authSetEnforce": {
        // CP3/CP4の強制スイッチ。鍵必須。kind=WRITE|READ, on=1|0
        var _ae = verifyP1Admin(studentEmail, e.parameter.secret, e.parameter);
        if (!_ae.ok) { result = _ae; break; }
        var _kind = String(e.parameter.kind || "").toUpperCase();
        // STRICTTOKEN は CP3/CP4 とは別軸のスイッチ。
        // 「トークンが付いているのに無効なら拒否する」だけを制御する。
        if (["WRITE","READ","STRICTTOKEN"].indexOf(_kind) === -1) { result = { ok:false, error:"invalid kind" }; break; }
        var _key = "AUTH_ENFORCE_" + _kind + (isTestDeployment() ? "_TEST" : "_PROD");
        var _on = String(e.parameter.on || "") === "1";
        if (_on) PropertiesService.getScriptProperties().setProperty(_key, "ON");
        else PropertiesService.getScriptProperties().deleteProperty(_key);
        authAudit("ENFORCE_CHANGE", { result:"SUCCESS", actorUserId: studentEmail,
                  action:"authSetEnforce", failureReason: _kind + "=" + (_on ? "ON" : "OFF") });
        result = { ok:true, key:_key, value:_on ? "ON" : "OFF",
                   effective: { write: enforceFlag("WRITE"), read: enforceFlag("READ"),
                                strictToken: enforceFlag("STRICTTOKEN") } };
        break;
      }
      case "authSetMode": {
        var _am = verifyP1Admin(studentEmail, e.parameter.secret, e.parameter);
        if (!_am.ok) { result = _am; break; }
        var _mv = String(e.parameter.mode || "").toUpperCase();
        if (["LEGACY","SESSION_OPTIONAL","SESSION_REQUIRED"].indexOf(_mv) === -1) { result = { ok:false, error:"invalid mode" }; break; }
        PropertiesService.getScriptProperties().setProperty(isTestDeployment() ? "AUTH_MODE_TEST" : "AUTH_MODE_PROD", _mv);
        authAudit("AUTH_MODE_CHANGE", { result: "SUCCESS", actorUserId: studentEmail, action: "authSetMode", failureReason: _mv });
        result = authConfig();
        break;
      }
      case "lineLinkAudit": {
        // LINE連携の現状監査。個人情報は返さず、件数と例外だけを返す
        var _la = verifyP1Admin(studentEmail, e.parameter.secret, e.parameter);
        if (!_la.ok) { result = _la; break; }
        var _us = sheetToObjects(getSheet("Users"));
        var _linked = _us.filter(function(u){ return String(u.line_user_id||"").trim(); });
        var _byId = {};
        _linked.forEach(function(u){
          var k = String(u.line_user_id).trim();
          (_byId[k] = _byId[k] || []).push(String(u.student_email||""));
        });
        var _dupes = Object.keys(_byId).filter(function(k){ return _byId[k].length > 1; });
        // 検証で使った値が残っていないか
        var _testish = _linked.filter(function(u){
          return /^U(forged|attacker|test)/i.test(String(u.line_user_id).trim()); }).length;
        result = { ok: true,
          totalUsers: _us.length,
          linked: _linked.length,
          unlinked: _us.length - _linked.length,
          duplicateLineIds: _dupes.length,
          duplicateGroups: _dupes.map(function(k){ return _byId[k].length; }),
          testValuesRemaining: _testish,
          changeHistoryAvailable: false,
          note: "line_user_id の変更履歴を残す仕組みは存在しない。過去の書き換えは検出できない" };
        break;
      }
      // CP3/CP4の切り替え判断に使う「実際に使っている人」の集計。
      // 固定人数（8名など）では、利用者が増減したときに意味が変わってしまうので、
      // 「直近N日に記録した人」を母数にして、そのうち何人がセッションを持ったかで見る。
      // 記録していない人を待つ必要はない（次にアプリを開いたときに再ログインさせる）。
      case "authCohort": {
        var _ac = verifyP1Admin(studentEmail, e.parameter.secret, e.parameter);
        if (!_ac.ok) { result = _ac; break; }
        result = authCohort(Number(e.parameter.days || 7));
        break;
      }
      case "authInspect": {
        var _ai = verifyP1Admin(studentEmail, e.parameter.secret, e.parameter);
        if (!_ai.ok) { result = _ai; break; }
        var chs = sheetToObjects(getAuthSheet("AuthChallenges"));
        var ses = sheetToObjects(getAuthSheet("Sessions"));
        var allUsers = sheetToObjects(getSheet("Users"));
        var us  = allUsers.filter(function(u){ return String(u.google_sub||"").trim(); });
        // ★「本当に使えるセッション」を数える★
        // revoked_at が空でも、期限切れや token_version のずれで検証に失敗するものがある。
        // ロール付与などで token_version を上げた際、古い行には印が付かないため、
        // 単純に revoked_at だけで数えると実態より多く見えてしまう。
        // CP3/CP4の切り替え判断に使う数字なので、検証と同じ条件で数える。
        var _tvByUser = {};
        allUsers.forEach(function(u){ if (u.user_id) _tvByUser[String(u.user_id)] = tokenVer_(u.token_version); });
        var _now = Date.now();
        var usable = ses.filter(function(x){
          if (String(x.revoked_at || "").trim()) return false;
          if (new Date(String(x.expires_at)).getTime() <= _now) return false;
          var cur = _tvByUser[String(x.user_id)];
          if (cur === undefined) return false;
          return tokenVer_(x.token_version) === cur;
        });
        var usableUsers = {};
        usable.forEach(function(x){ usableUsers[String(x.user_id)] = 1; });
        result = { ok: true,
          challenges: { total: chs.length, recent: chs.slice(-5).map(function(c){
            return { id:String(c.challenge_id).slice(0,16), created:c.created_at, used:c.used_at||"", result:c.result, attempts:c.attempt_count }; }) },
          sessions: { total: ses.length,
            usable: usable.length,
            usableUsers: Object.keys(usableUsers).length,
            activeUsers: allUsers.filter(function(u){ return String(u.is_active).toUpperCase()==="TRUE"; }).length,
            rows: ses.map(function(x){
            return { hashHead:String(x.session_token_hash).slice(0,12), user:x.user_id, created:x.created_at,
                     lastSeen:x.last_seen_at, revoked:x.revoked_at||"", exp:x.expires_at,
                     device:x.device_label||"" }; }) },
          linkedUsers: us.map(function(u){ return { email:u.student_email, subHead:String(u.google_sub).slice(0,8)+"…",
                     userId:u.user_id, role:u.role||"", linkedAt:u.auth_linked_at||"" }; }) };
        break;
      }
      case "rotateSessionSecret": {
        var _rs = verifyP1Admin(studentEmail, e.parameter.secret, e.parameter);
        if (!_rs.ok) { result = _rs; break; }
        result = rotateSessionSecret(String(e.parameter.force || "") === "1");
        break;
      }
      case "authAuditTail": {
        var _aa = verifyP1Admin(studentEmail, e.parameter.secret, e.parameter);
        if (!_aa.ok) { result = _aa; break; }
        var _rows = sheetToObjects(getAuthSheet("AuthAudit"));
        // 旧方式（鍵をそのまま送る）がまだ使われていないかを全件で数える。
        // これがゼロになったら旧方式を廃止する、という判断に使う
        var _legacy = _rows.filter(function (r) { return String(r.failure_reason || "").indexOf("LEGACY") !== -1; });
        var _signed = _rows.filter(function (r) { return String(r.failure_reason || "") === "via_signature"; });
        result = { ok: true, total: _rows.length, recent: _rows.slice(-12),
                   legacyCount: _legacy.length,
                   legacyLast: _legacy.length ? String(_legacy[_legacy.length - 1].timestamp) : "",
                   signedCount: _signed.length };
        break;
      }
      case "healthCheck":   result = authConfig(); break;
      case "authConfig":    result = authConfig(); break;
      case "adminSetupAuth": {
        var _sa = verifyP1Admin(studentEmail, e.parameter.secret, e.parameter);
        if (!_sa.ok) { result = _sa; break; }
        result = setupAuthPhase1();
        break;
      }
      case "weeklyBackup": {
        var _wb = verifyP1Admin(studentEmail, e.parameter.secret, e.parameter);
        if (!_wb.ok) { result = _wb; break; }
        result = weeklyBackup();
        break;
      }
      case "p1Backup": {
        // バックアップ（複製）作成。鍵が必須
        var _ab = verifyP1Admin(studentEmail, e.parameter.secret, e.parameter);
        if (!_ab.ok) { result = _ab; break; }
        result = p1BackupViaSheets();
        break;
      }
      case "p1BackupInfo": {
        var _abi = verifyP1Admin(studentEmail, e.parameter.secret, e.parameter);
        if (!_abi.ok) { result = _abi; break; }
        result = p1BackupInfo(e.parameter.id);
        break;
      }
      case "lineQuota": {
        var _lq = verifyP1Admin(studentEmail, e.parameter.secret, e.parameter);
        if (!_lq.ok) { result = _lq; break; }
        result = lineQuotaStatus();
        break;
      }
      case "p1PurgeArchived": {
        // 検証データの後始末。鍵が必須。dryRun=1 なら数えるだけ
        var _ap = verifyP1Admin(studentEmail, e.parameter.secret, e.parameter);
        if (!_ap.ok) { result = _ap; break; }
        result = p1PurgeArchived(studentEmail, String(e.parameter.dryRun || "") === "1");
        break;
      }
      case "p1Status": {
        // 基盤の状態確認。件数のみを返すが、全体情報なので同様に保護する
        var _a2 = verifyP1Admin(studentEmail, e.parameter.secret, e.parameter);
        if (!_a2.ok) { result = _a2; break; }
        var _st = {};
        Object.keys(P1_SHEETS).forEach(function (n) { var s = getSheet(n); _st[n] = s ? { rows: s.getLastRow() - 1, cols: s.getLastColumn() } : null; });
        var _cols = {};
        Object.keys(P1_ADDED_COLUMNS).forEach(function (n) {
          var s = getSheet(n); if (!s) { _cols[n] = null; return; }
          if (s.getLastColumn() < 1) { _cols[n] = []; return; }   // 見出し行が無いシート
          var h = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0];
          _cols[n] = P1_ADDED_COLUMNS[n].filter(function (c) { return h.indexOf(c) !== -1; });
        });
        result = { ok: true, sheets: _st, presentColumns: _cols, userKeyCollisions: findUserKeyCollisions() };
        break;
      }
      case "getHomeData":  result = getHomeData(studentEmail); break;
      case "adminAiUsage": {
        if (studentEmail !== adminEmail()) { result = { ok: false, error: "not owner" }; break; }
        result = { ok: true, data: getAiUsageSummary() };
        break;
      }
      case "adminDedupeCalendar": {
        if (studentEmail !== adminEmail()) { result = { ok: false, error: "not owner" }; break; }
        result = dedupeOwnerJirokuEvents(Math.min(Number(e.parameter.days) || 7, 31));
        break;
      }
      case "adminBackfillCalendar": {
        // オーナー本人の過去days日分のDailyLogを、Kaiのカレンダーへ遡って書き込む
        // （サーバー方式に切替える前の取りこぼしを補完。writeRecord…側で重複防止）
        if (studentEmail !== adminEmail()) { result = { ok: false, error: "not owner" }; break; }
        var _days = Math.min(Number(e.parameter.days) || 3, 31);
        var _today = formatDate(new Date());
        var _dates = {};
        for (var _k = 0; _k <= _days; _k++) { var _dd = new Date(); _dd.setDate(_dd.getDate() - _k); _dates[formatDate(_dd)] = 1; }
        var _logs = getFilteredRows("DailyLog", "student_email", studentEmail).filter(function (l) { return _dates[l.date]; });
        var _cnt = 0;
        _logs.forEach(function (l) { if (l.time_block && String(l.task || "").trim()) { writeRecordToOwnerCalendar(studentEmail, l.date, String(l.time_block), l.task, l.time_classification); _cnt++; } });
        result = { ok: true, processed: _cnt };
        break;
      }
      case "registerUser": result = registerUser(studentEmail, e.parameter); break;
      case "getStreak":    result = getStreak(studentEmail); break;
      case "getGameStatus": result = getGameStatus(studentEmail); break;
      case "getRanking":   result = getRanking(studentEmail); break;
      case "getCommunity": result = getCommunity(studentEmail); break;
      case "getAchievements": result = getAchievements(studentEmail); break;
      case "shareAchievement": result = shareAchievement(studentEmail, e.parameter); break;
      case "getReport":    result = getReport(studentEmail, e.parameter); break;
      case "getReportList": result = getReportList(studentEmail); break;
      // 実績の履歴（3か月目標の「いまの数字」を1件ずつ足していく）
      case "addGoalEntry": result = addGoalEntry(studentEmail, e.parameter); break;
      case "listGoalEntries": result = listGoalEntries(studentEmail, e.parameter); break;
      case "updateGoalEntry": result = updateGoalEntry(studentEmail, e.parameter); break;
      case "deleteGoalEntry": result = deleteGoalEntry(studentEmail, e.parameter); break;
      // レポート画面のまとめ取得（往復の回数を減らすため）
      case "getReportHome": result = getReportHome(studentEmail); break;
      case "getRoadmap": result = getRoadmap(studentEmail); break;
      case "getReportDetail": result = getReportDetail(studentEmail, e.parameter); break;
      case "getStatusSummary": result = getStatusSummary(studentEmail); break;
      case "getSelfMgmtPower": result = getSelfMgmtPower(studentEmail, e.parameter); break;
      case "getDailyOpsReport": result = getDailyOpsReport(studentEmail, e.parameter); break;
      case "getLogs":      result = getLogs(studentEmail, e.parameter); break;
      case "getMessages":  result = getMessages(studentEmail); break;
      case "getSchedule":  result = getSchedule(studentEmail); break;
      case "getStudents":  result = getStudents(studentEmail); break;
      case "saveLog":      result = saveLog(studentEmail, e.parameter); break;
      case "deleteLog":    result = deleteLog(studentEmail, e.parameter); break;
      case "updateLogTime": result = updateLogTime(studentEmail, e.parameter); break;
      case "setLogClassification": result = setLogClassification(studentEmail, e.parameter); break;
      case "getDayPlan":   result = getDayPlan(studentEmail, e.parameter); break;
      case "saveDayPlan":  result = saveDayPlan(studentEmail, e.parameter); break;
      case "saveWeeklyAvailable": result = saveWeeklyAvailable(studentEmail, e.parameter); break;
      case "quickLog":     result = quickLog(studentEmail, e.parameter); break;
      case "saveLogMulti": result = saveLogMulti(studentEmail, e.parameter); break;
      case "coachGetStudents":      result = coachGetStudents(e.parameter.coachEmail); break;
      case "adminTagCohortByJoinDate": result = adminTagCohortByJoinDate(e.parameter.coachEmail, e.parameter.date, e.parameter.cohort); break;
      case "adminListRecentRegistrations": result = adminListRecentRegistrations(e.parameter.coachEmail, e.parameter.days); break;
      case "adminBackfillReports": result = adminBackfillReports(e.parameter.coachEmail, e.parameter.days, e.parameter.limit, e.parameter.dryRun); break;
      case "adminOpsHealthCheck": result = verifyAdmin(e.parameter.coachEmail) ? (dailyOpsHealthCheck(e.parameter.dryRun === "1") || {ok:true}) : {ok:false,error:"not admin"}; break;
      case "adminInstallTrigger": result = adminInstallTrigger(e.parameter.coachEmail, e.parameter.handler, e.parameter.replace); break;
      case "adminSendStudentCampaign": result = adminSendStudentCampaign(e.parameter.coachEmail, e.parameter); break;
      case "adminSystemHealth": result = verifyAdmin(e.parameter.coachEmail) ? systemHealthCheck(e.parameter.deep === "1") : {ok:false,error:"not admin"}; break;
      case "generateTalentReport": result = generateTalentReport(e.parameter.coachEmail, e.parameter.targetEmail); break;
      case "generateGakuchika": result = generateGakuchika(e.parameter.coachEmail, e.parameter.targetEmail); break;
      case "adminTagCohortByEmails": result = adminTagCohortByEmails(e.parameter.coachEmail, e.parameter.emails, e.parameter.cohort); break;
      case "coachSetCohort":       result = coachSetCohort(e.parameter.coachEmail, e.parameter); break;
      case "coachGetStudentDetail": result = coachGetStudentDetail(e.parameter.coachEmail, e.parameter.targetEmail); break;
      case "coachSaveNote":         result = coachSaveNote(e.parameter.coachEmail, e.parameter); break;
      case "coachGenerateStudentMessage": result = coachGenerateStudentMessage(e.parameter.coachEmail, e.parameter); break;
      case "coachGenerateNudgeMessage": result = coachGenerateNudgeMessage(e.parameter.coachEmail, e.parameter); break;
      case "coachVerifyNote":       result = coachVerifyNote(e.parameter.coachEmail, e.parameter); break;
      case "coachPrepSummary":      result = coachPrepSummary(e.parameter.coachEmail, e.parameter.targetEmail); break;
      case "coachSyncStripeOne":    result = coachSyncStripeOne(e.parameter.coachEmail, e.parameter); break;
      case "coachAddClient":       result = coachAddClient(e.parameter.coachEmail, e.parameter); break;
      case "coachListLeads":       result = coachListLeads(e.parameter.coachEmail); break;
      case "coachSaveLead":        result = coachSaveLead(e.parameter.coachEmail, e.parameter); break;
      case "coachDeleteLead":      result = coachDeleteLead(e.parameter.coachEmail, e.parameter); break;
      case "coachSetPlanStatus":   result = coachSetPlanStatus(e.parameter.coachEmail, e.parameter); break;
      case "adminFixChatworkMisassignment": result = adminFixChatworkMisassignment(e.parameter.coachEmail, e.parameter.wrongEmail, e.parameter.correctEmail, e.parameter.correctName); break;
      case "coachListChatworkContacts": result = coachListChatworkContacts(e.parameter.coachEmail); break;
      case "coachSyncChatworkOne": result = coachSyncChatworkOne(e.parameter.coachEmail, e.parameter); break;
      case "adminGetOverview":     result = adminGetOverview(e.parameter.coachEmail); break;
      case "coachSetShowInCommunity": result = coachSetShowInCommunity(e.parameter.coachEmail, e.parameter); break;
      case "adminBackfillReportReasons": result = adminBackfillReportReasons(e.parameter.coachEmail); break;
      case "adminRunNightlyReport": result = adminRunNightlyReport(e.parameter.coachEmail); break;
      case "adminSetupTriggers": result = adminSetupTriggers(e.parameter.coachEmail); break;
      case "adminRepairStreaksFreeze": result = adminRepairStreaksFreeze(e.parameter.coachEmail, e.parameter.confirm); break;
      case "adminBackfillReportsForDate": result = adminBackfillReportsForDate(e.parameter.coachEmail, e.parameter.date); break;
      case "adminRunNightlyCoachMessage": result = adminRunNightlyCoachMessage(e.parameter.coachEmail); break;
      // ★本文は base64 で受け取れるようにしてある★
      // 署名対象に日本語をそのまま入れると署名が一致しない
      // （GASの署名計算がマルチバイトを取り違える。実測で確認）。
      // base64 なら署名対象がASCIIのままなので、この問題を踏まない。
      case "adminBroadcastLine": {
        var _bmsg = e.parameter.message;
        if (e.parameter.messageB64) {
          try { _bmsg = Utilities.newBlob(Utilities.base64DecodeWebSafe(e.parameter.messageB64)).getDataAsString("UTF-8"); }
          catch (err) { result = { ok: false, error: "messageB64 を読めませんでした" }; break; }
        }
        result = adminBroadcastLine(e.parameter.coachEmail, _bmsg, e.parameter.confirm,
                                    e.parameter.imageUrl, e.parameter.previewUrl);
        break;
      }
      // まだセッションを取得していない人だけへ送る（切替日の予告用）
      case "adminBroadcastLinePending": {
        var _pmsg = e.parameter.message;
        if (e.parameter.messageB64) {
          try { _pmsg = Utilities.newBlob(Utilities.base64DecodeWebSafe(e.parameter.messageB64)).getDataAsString("UTF-8"); }
          catch (err) { result = { ok: false, error: "messageB64 を読めませんでした" }; break; }
        }
        result = adminBroadcastLinePending(e.parameter.coachEmail, _pmsg, e.parameter.confirm);
        break;
      }
      case "adminDiagnosePush": result = adminDiagnosePush(e.parameter.coachEmail, e.parameter.targetEmail); break;
      case "adminDebugStripeSearch": result = adminDebugStripeSearch(e.parameter.coachEmail, e.parameter.email); break;
      case "adminDebugCalendarColors": result = adminDebugCalendarColors(e.parameter.coachEmail); break;
      case "adminTestPush": result = adminTestPush(e.parameter.coachEmail, e.parameter.targetEmail, e.parameter.title, e.parameter.body); break;
      case "sendMessage":  result = sendMessage(studentEmail, e.parameter); break;
      case "saveSettings": result = saveSettings(studentEmail, e.parameter); break;
      case "saveOnboarding": result = saveOnboarding(studentEmail, e.parameter); break;
      case "syncCalendar": result = syncCalendar(studentEmail, e.parameter); break;
      case "getCalendar":  result = getCalendar(studentEmail, e.parameter); break;
      case "getDiary":     result = getDiary(studentEmail, e.parameter); break;
      case "saveDiary":    result = saveDiary(studentEmail, e.parameter); break;
      case "getWeeklySummary": result = getWeeklySummary(studentEmail); break;
      case "saveWeeklyReflection": result = saveWeeklyReflection(studentEmail, e.parameter); break;
      case "askMyPast":    result = askMyPast(studentEmail, e.parameter); break;
      case "getInsights":  result = getInsights(studentEmail); break;
      case "refreshInsights": result = generateInsightsForUser(studentEmail, true); break;
      case "getTimeThemes": result = getTimeThemes(studentEmail); break;
      case "refreshTimeThemes": result = generateTimeThemesForUser(studentEmail, true); break;
      case "exportMyData": result = exportMyData(studentEmail, e.parameter); break;
      case "getMonthlyReview": result = getMonthlyReview(studentEmail); break;
      case "saveIntent":   result = saveIntent(studentEmail, e.parameter); break;
      case "getIntent":    result = getIntent(studentEmail); break;
      case "saveTodayActions": result = saveTodayActions(studentEmail, e.parameter); break;
      case "getTodayActions":  result = getTodayActions(studentEmail); break;
      case "getTimeUseSummary": result = getTimeUseSummary(studentEmail); break;
      case "scheduleTimerEnd": result = scheduleTimerEnd(studentEmail, e.parameter); break;
      case "cancelTimerEnd":   result = cancelTimerEnd(studentEmail); break;
      case "registerPushToken": result = registerPushToken(studentEmail, e.parameter); break;
      case "generateSnsIdeas": result = generateSnsIdeas(studentEmail, e.parameter); break;
      case "getContentProfile": result = getContentProfile(studentEmail); break;
      case "saveContentProfile": result = saveContentProfile(studentEmail, e.parameter); break;
      case "snsListAccounts": result = snsListAccounts(studentEmail); break;
      case "snsSaveAccount":  result = snsSaveAccount(studentEmail, e.parameter); break;
      case "snsDeleteAccount": result = snsDeleteAccount(studentEmail, e.parameter); break;
      case "snsSaveMetrics":  result = snsSaveMetrics(studentEmail, e.parameter); break;
      case "snsGetMetrics":   result = snsGetMetrics(studentEmail, e.parameter); break;
      case "snsListPosts":    result = snsListPosts(studentEmail, e.parameter); break;
      case "snsSavePost":     result = snsSavePost(studentEmail, e.parameter); break;
      case "snsDeletePost":   result = snsDeletePost(studentEmail, e.parameter); break;
      default: result = { ok: false, error: "Unknown action: " + action };
    }
    return jsonResponse(result, callback);
  } catch (err) {
    return jsonResponse({ ok: false, error: err.toString() }, callback);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST ハンドラー
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    // LINEのWebhookイベント
    if (body.events) {
      body.events.forEach(event => {
        if (event.type === "follow") {
          const lineUserId = event.source.userId;
          const rows = sheetToObjects(getSheet("Users"));
          // すでに連携済みなら何もしない
          if (rows.find(r => r.line_user_id === lineUserId)) return;
          sendLineMessage(lineUserId, "🎉 追加ありがとうございます！\n\nこのLINEで受け取れるようになるもの\n✅ 記録のリマインダー\n✅ 毎晩のAIレポート\n\n【つなぐ手順（30秒）】\n① 下のリンクを開く\n" + APP_URL + "?open=linelink\n② 出てきた「連携コードを出す」を押す\n③ 「コピーする」を押して、このトークに貼り付けて送る\n\n※ 送るのは「LINK 〜」の行ごとです。まだアプリに登録していない方は、リンク先でGoogleログインをしてから同じ手順でどうぞ。");
        }

        if (event.type === "message" && event.message.type === "text") {
          const lineUserId = event.source.userId;
          const text = event.message.text.trim().toLowerCase();
          // ★連携コマンドは、連携済みかどうかより先に処理する★
          // 以前はこの下の early return が先にあったため、連携済みの人が LINK を
          // 送っても何も返らず「壊れている」ように見えた（2026-08-01に発生）
          if (/^LINK\s+\S+/i.test(event.message.text.trim())) {
            const tok0 = event.message.text.trim().replace(/^LINK\s+/i, "");
            const already0 = sheetToObjects(getSheet("Users")).find(u => u.line_user_id === lineUserId);
            if (already0) {
              sendLineMessage(lineUserId, "このLINEはすでに " + String(already0.name || "") + " さんのアカウントと連携済みです。\nあらためて連携する必要はありません。");
              return;
            }
            const r0 = consumeLineLinkToken(tok0, lineUserId);
            sendLineMessage(lineUserId, r0.message);
            return;
          }

          // 既に連携済みなら、案内メッセージの再送はしない（雑談等の通常メッセージのため）
          const alreadyLinked = sheetToObjects(getSheet("Users")).find(u => u.line_user_id === lineUserId);
          if (alreadyLinked) return;

          // ★メールアドレスによる連携は停止（2026-08-01）★
          // LINEのWebhookは署名を検証できない（GASはヘッダーを取得できない）。
          // メールアドレスは誰でも知りうる情報なので、それを本人確認の根拠にすると
          // 「他人になりすまして通知の宛先を奪う」ことができてしまう。
          // 連携はアプリ（認証済み）で発行したワンタイムトークンでのみ行う。
          if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
            // 従来どおりメールを送ってきた人への案内（連携はしない）
            sendLineMessage(lineUserId, "連携のやり方が新しくなりました🙏\nメールアドレスではつながらなくなっています（他の人がなりすませてしまうため）。\n\n【いまの手順（30秒）】\n① 下のリンクを開く\n" + APP_URL + "?open=linelink\n② 「連携コードを出す」を押す\n③ 「コピーする」を押して、このトークに貼り付けて送る\n\n※ 送るのは「LINK 〜」の行ごとです。コードだけだとつながりません。");
            try { authAudit("LINE_LINK_BLOCKED", { result: "DENY", action: "lineWebhookLink",
                        failureReason: "email_link_disabled" }); } catch (e4) {}
          } else {
            // メール以外のメッセージ（雑談等）が送られた場合、無反応にせず連携方法を再案内する
            sendLineMessage(lineUserId, "JIROKUとつなぐには🙏\n\n① 下のリンクを開く\n" + APP_URL + "?open=linelink\n② 「連携コードを出す」を押す\n③ 「コピーする」を押して、このトークに貼り付けて送る\n\n※ 送るのは「LINK 〜」の行ごとです。コードだけだとつながりません。");
          }
        }
      });
      return ContentService.createTextOutput("OK");
    }

    // アプリからのPOST
    const action = body.action;
    let studentEmail = body.studentEmail;
    // ★doGetと同じ。無効なトークンを従来経路へ落とさない★
    var _stp = strictTokenCheck(action, body.token);
    if (!_stp.ok) return jsonResponse(_stp);
    // ── Auth CP2 ──（doGetと同じ判定）
    var _azp = authorizeAction(action, body.token, body.targetEmail || body.target || "",
                               body.studentEmail || body.coachEmail, body.secret, body);
    if (!_azp.ok) return jsonResponse(_azp);
    // ★doGetと同じ。本人で上書きする★
    if (_azp.forceSelfEmail) { studentEmail = _azp.forceSelfEmail; body.studentEmail = _azp.forceSelfEmail; }
    switch (action) {
      case "saveLog":      return jsonResponse(saveLog(studentEmail, body));
      case "deleteLog":    return jsonResponse(deleteLog(studentEmail, body));
      case "updateLogTime": return jsonResponse(updateLogTime(studentEmail, body));
      case "setLogClassification": return jsonResponse(setLogClassification(studentEmail, body));
      case "clientError":  return jsonResponse(recordClientError(body));
      case "getDayPlan":   return jsonResponse(getDayPlan(studentEmail, body));
      case "saveDayPlan":  return jsonResponse(saveDayPlan(studentEmail, body));
      case "saveWeeklyAvailable": return jsonResponse(saveWeeklyAvailable(studentEmail, body));
      case "quickLog":     return jsonResponse(quickLog(studentEmail, body));
      case "saveLogMulti": return jsonResponse(saveLogMulti(studentEmail, body));
      case "sendMessage":  return jsonResponse(sendMessage(studentEmail, body));
      case "saveSettings": return jsonResponse(saveSettings(studentEmail, body));
      case "saveOnboarding": return jsonResponse(saveOnboarding(studentEmail, body));
      case "saveDiary":    return jsonResponse(saveDiary(studentEmail, body));
      case "saveIntent":   return jsonResponse(saveIntent(studentEmail, body));
      case "askMyPast":    return jsonResponse(askMyPast(studentEmail, body));
      case "saveWeeklyReflection": return jsonResponse(saveWeeklyReflection(studentEmail, body));
      case "saveContentProfile": return jsonResponse(saveContentProfile(studentEmail, body));
      case "snsSaveAccount": return jsonResponse(snsSaveAccount(studentEmail, body));
      case "snsSaveMetrics": return jsonResponse(snsSaveMetrics(studentEmail, body));
      case "snsSavePost":    return jsonResponse(snsSavePost(studentEmail, body));
      case "saveTodayActions": return jsonResponse(saveTodayActions(studentEmail, body));
      case "generateWorkReport": return jsonResponse(generateWorkReport(studentEmail, body));
      case "migrateLocalTasks": return jsonResponse(migrateLocalTasks(studentEmail, body));
      // ── Checkpoint 3: タスク（重要度・緊急度）──
      case "getSprints":  return jsonResponse(getSprints(studentEmail, body));
      case "saveSprint":  return jsonResponse(saveSprint(studentEmail, body));
      case "migrateTasksToSheet": return jsonResponse(migrateTasksToSheet(studentEmail, body));
      case "getTasks":    return jsonResponse(getTasks(studentEmail, body));
      case "saveTask":    return jsonResponse(saveTask(studentEmail, body));
      case "saveTaskMutations": return jsonResponse(saveTaskMutations(studentEmail, body));
      case "deleteTask":  return jsonResponse(deleteTask(studentEmail, body));
      case "carryOverTask": return jsonResponse(carryOverTask(studentEmail, body));
      // ── Auth CP1 ──
      case "login":  return jsonResponse(authLogin(body));
      case "loginAccess": return jsonResponse(authLoginAccess(body));
      // LINE連携用のワンタイムトークン発行（認証済みセッション必須）
      case "issueLineLinkToken": return jsonResponse(issueLineLinkToken(body.token));
      case "logout": {
        // セッション必須。トークンが無い/無効なら拒否する
        var _vs = verifySession(body.token, false);
        if (!_vs.ok) return jsonResponse({ ok: false, error: "AUTH_REQUIRED" });
        authAudit("LOGOUT", { result: "SUCCESS", actorUserId: _vs.actor.actor_user_id, action: "logout" });
        return jsonResponse(revokeSession(body.token));
      }
      // 検証用。認証済みの本人情報を返すだけ（CP1のテストで使う）
      case "authWhoAmI": {
        var _w = verifySession(body.token, true);
        if (!_w.ok) return jsonResponse({ ok: false, error: "AUTH_REQUIRED", reason: _w.reason });
        return jsonResponse({ ok: true, actor: _w.actor, cached: _w.cached });
      }
      // 目標階層（Checkpoint 2）。いずれも本人の行しか読み書きできない
      case "saveGoal":          return jsonResponse(saveGoal(studentEmail, body));
      case "saveWeeklyGoal":    return jsonResponse(saveWeeklyGoal(studentEmail, body));
      case "archiveGoalItem":   return jsonResponse(archiveGoalItem(studentEmail, body));
      case "submitSurvey": return jsonResponse(submitSurvey(studentEmail, body));
      case "syncCalendar": return jsonResponse(syncCalendar(studentEmail, body));
      case "coachSaveProfile":     return jsonResponse(coachSaveProfile(body.coachEmail, body));
      case "coachSaveLead":        return jsonResponse(coachSaveLead(body.coachEmail, body));
      case "coachGenerateSalesTalk": return jsonResponse(coachGenerateSalesTalk(body.coachEmail, body));
      case "coachSetPlanStatus":   return jsonResponse(coachSetPlanStatus(body.coachEmail, body));
      case "coachSetCohort":       return jsonResponse(coachSetCohort(body.coachEmail, body));
      case "coachUploadFile":      return jsonResponse(coachUploadFile(body.coachEmail, body));
      case "coachDeleteFile":      return jsonResponse(coachDeleteFile(body.coachEmail, body));
      case "coachDeleteNote":      return jsonResponse(coachDeleteNote(body.coachEmail, body));
      case "coachExtractContractInfo": return jsonResponse(coachExtractContractInfo(body.coachEmail, body));
      case "coachExtractFromExistingFile": return jsonResponse(coachExtractFromExistingFile(body.coachEmail, body));
      case "coachImportNotes":     return jsonResponse(coachImportNotes(body.coachEmail, body));
      case "coachSessionSuggestions": return jsonResponse(coachSessionSuggestions(body.coachEmail, body));
      case "coachSummarizeTranscript": return jsonResponse(coachSummarizeTranscript(body.coachEmail, body));
      case "coachGenerateStudentMessage": return jsonResponse(coachGenerateStudentMessage(body.coachEmail, body));
      case "coachGenerateNudgeMessage": return jsonResponse(coachGenerateNudgeMessage(body.coachEmail, body));
      case "coachSendStudentMessage": return jsonResponse(coachSendStudentMessage(body.coachEmail, body));
      // ★読み取りAPIもPOSTで受けられるようにする★
      //
      // なぜ必要か:
      //   GETで呼ぶ限り、セッショントークンはURLのクエリ文字列に載せるしかない。
      //   GASはリクエストヘッダーを読めないので、他に置き場所が無いため。
      //   クエリに載ったトークンはブラウザ履歴・中間のログ・Googleの
      //   アクセスログに残る。「URLへ入れない」と決めていたのに、
      //   コードがそれを守れていなかった原因はここにある。
      //
      // 直し方:
      //   読み取りもPOSTのJSON本文で受ける。ただし doGet の switch には
      //   100以上の分岐があり、同じものをここへ複製すると
      //   「片方だけ直して片方を忘れる」事故が必ず起きる。
      //   そこで複製せず、doGet の処理をそのまま呼ぶ。
      //   doGet は e.parameter しか見ないので、本文をそのまま渡せば動く。
      //
      //   認可はこの上で済んでいるが、doGet 側でもう一度走る。
      //   同じ入力に対して同じ判定になるので結果は変わらない。
      //   （二重に通しても緩くならない。厳しくなる方向にしか働かない）
      default:
        return doGet({ parameter: body });
    }
  } catch (err) {
    return jsonResponse({ ok: false, error: err.toString() });
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 各アクション
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function registerUser(studentEmail, body) {
  // ══════════════════════════════════════════════════════════════
  // ★新規のUsers行は作らない★（2026-08-01 招待制であることを確認して変更）
  //
  // 変更前は、curl 1本で任意のメールアドレスの有効な利用者を作れた。
  // Googleログインもセッションも招待も不要で、監査ログにも残らなかった。
  //
  // JIROKUは招待制。Kaiが先にUsers行を用意し、その人だけがログインできる。
  // つまり「登録」で行を作る必要がそもそも無い。作れる口があること自体が穴。
  //
  // この関数の役割は「招待済みの人が、自分のプロフィールを埋める」だけ。
  //   ・セッション必須（本人であることを確定してから書く）
  //   ・宛先はセッションから取る（リクエストのメールは信用しない）
  //   ・行が無ければ作らずに断る
  // ══════════════════════════════════════════════════════════════
  const v = verifySession((body && body.token) || "", false);
  if (!v.ok) {
    authAudit("REGISTER", { result: "DENY", action: "registerUser", failureReason: v.reason || "NO_SESSION" });
    return { ok: false, error: "AUTH_REQUIRED" };
  }
  // ★リクエストのstudentEmailは使わない★ 偽装できるため
  const actorEmail = String(v.actor.email || "").trim();
  if (!actorEmail) return { ok: false, error: "AUTH_REQUIRED" };
  studentEmail = actorEmail;

  const sheet = getSheet("Users");
  const rows = sheetToObjects(sheet);
  const mine = rows.find(function (r) { return r.student_email === studentEmail; });
  if (!mine) {
    // セッションが出ている＝行があるはずなので、ここへ来るのは異常。
    // それでも「作る」に倒さない。作れる経路を残さないため。
    authAudit("REGISTER", { result: "DENY", action: "registerUser", failureReason: "NOT_INVITED",
                            actorUserId: v.actor.actor_user_id });
    return { ok: false, error: "このアカウントは登録されていません。管理者へご連絡ください" };
  }

  // 招待済みの行を「更新」する。プロフィールの初期設定にあたる部分だけ。
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const data = sheet.getDataRange().getValues();
  const iEmail = headers.indexOf("student_email");
  let row = -1;
  for (let k = 1; k < data.length; k++) { if (String(data[k][iEmail]) === studentEmail) { row = k + 1; break; } }
  if (row === -1) return { ok: false, error: "このアカウントは登録されていません" };

  const setIf = function (col, val) {
    const c = headers.indexOf(col);
    if (c === -1) return;
    if (val === undefined || val === null || String(val) === "") return;
    sheet.getRange(row, c + 1).setValue(val);
  };
  setIf("name", body.name);
  setIf("nickname", body.nickname);
  setIf("avatar", body.avatar);
  setIf("goal", body.goal);            setIf("goal_deadline", body.goal_deadline);
  setIf("goal2", body.goal2);          setIf("goal_deadline2", body.goal_deadline2);
  setIf("goal3", body.goal3);          setIf("goal_deadline3", body.goal_deadline3);

  authAudit("REGISTER", { result: "SUCCESS", action: "registerUser",
                          actorUserId: v.actor.actor_user_id, failureReason: "profile_updated" });
  return { ok: true, updated: true, data: getUser(studentEmail).data };
}

// 旧実装（新規のUsers行を作る registerUser）は 2026-08-01 に削除した。
// 招待制なので行を作る経路は存在してはいけない。
// 使わないから残しておく、では済まない。残っていれば誰かが戻せるし、
// 実際この関数は「誰でも任意のメールで有効な利用者を作れる」ものだった。


function getStreak(studentEmail) {
  const user = sheetToObjects(getSheet("Users")).find(u => u.student_email === studentEmail);
  if (!user) return { ok: true, data: 0 };
  return { ok: true, data: Number(user.streak || 0) };
}

// トライアル日数（無料期間）
const TRIAL_DAYS = 7;

// ユーザーの利用状態を判定する。ソフトゲートの唯一の判断ロジック。
// 【重要】plan_statusが空欄のユーザー（＝この機能導入前からの既存ユーザー全員）は
// 必ず "full"（制限なし）として扱う。既存200人が誤ってロックされるのを防ぐため
function computeAccessState(user) {
  const plan = String(user.plan_status || "").trim().toLowerCase();
  // 既存ユーザー（空欄）・有料・無料招待は常にフルアクセス
  if (plan === "" || plan === "paid" || plan === "free") {
    return { access: "full", plan: plan || "grandfathered", trialDaysLeft: null };
  }
  if (plan === "trial") {
    const startRaw = user.trial_start;
    const start = startRaw instanceof Date ? startRaw
      : (startRaw ? new Date(String(startRaw) + "T00:00:00") : null);
    if (!start || isNaN(start)) return { access: "full", plan: "trial", trialDaysLeft: TRIAL_DAYS };
    const elapsed = Math.floor((Date.now() - start.getTime()) / 86400000);
    const daysLeft = TRIAL_DAYS - elapsed;
    return { access: daysLeft > 0 ? "full" : "limited", plan: "trial", trialDaysLeft: Math.max(0, daysLeft) };
  }
  if (plan === "expired") return { access: "limited", plan: "expired", trialDaysLeft: 0 };
  return { access: "full", plan: plan, trialDaysLeft: null };
}

function getUser(studentEmail) {
  const user = sheetToObjects(getSheet("Users")).find(u => u.student_email === studentEmail && u.is_active.toUpperCase() === "TRUE");
  if (!user) return { ok: false, error: "User not found" };
  const coach = sheetToObjects(getSheet("Coaches")).find(c => c.coach_email === user.coach_email);
  const accessState = computeAccessState(user);
  const cohort = String(user.cohort || "").trim();
  // 学生（cohort付き）には「30日で帳票＋ガクチカ素材集」の進捗を出すため、
  // 記録した日数（ユニーク日付）を返す。学生以外はシート走査を省く
  let recordDays = null;
  if (cohort) {
    try {
      recordDays = new Set(getFilteredRows("DailyLog", "student_email", studentEmail).map(l => l.date)).size;
    } catch (e) { recordDays = null; }
  }
  return { ok: true, data: {
    name: user.name,
    nickname: user.nickname || user.name,
    avatar: user.avatar || "🦊",
    coach_email: user.coach_email,
    coachName: (coach && coach.coach_name) ? coach.coach_name : "コーチ",
    lineLinked: !!user.line_user_id,
    showInCommunity: String(user.show_in_community || "").toUpperCase() !== "FALSE",
    cohort: cohort,
    recordDays: recordDays,
    access: accessState.access,          // "full" | "limited"
    plan: accessState.plan,              // grandfathered | trial | paid | free | expired
    trialDaysLeft: accessState.trialDaysLeft,
    // サーバー(Kai権限)から直接カレンダーに書ける本人（=オーナー）は、クライアント側の
    // カレンダー書き込みを止めて二重登録を防ぐ。それ以外は従来通りクライアントで書く
    serverCalendar: (studentEmail === adminEmail() && !!user.google_calendar_id),
    // Phase 1: 自己経営OS の段階公開。この人に新機能を出すかどうか
    goalsV1: hasFeature(user, P1_FEATURE_KEY),
    taskMigratedAt: String(user.task_migrated_at || "")
  } };
}

function getReportList(studentEmail) {
  const rows = getFilteredRows("Reports", "student_email", studentEmail);
  // ★一覧と詳細で点数を食い違わせない★（2026-08-03 Kai指摘）
  //   新しい5項目のレポートを使っている人には、保存済みの新しい点数を出す。
  //   まだ無い日だけ、従来の夜のレポートの点数を出す。
  const opsByDate = {};
  try {
    const u = sheetToObjects(getSheet("Users")).find(function (x) { return x.student_email === studentEmail; });
    if (hasFeature(u, OPS_FEATURE_KEY)) {
      p1List("DailyOpsReport", studentEmail).forEach(function (r) {
        const d = String(r.report_date).slice(0, 10);
        const v = String(r.operating_score || "").trim();
        if (d && v !== "") opsByDate[d] = Number(v);
      });
      // ★今日だけは計算し直す★
      //   保存した後に記録を足すと、保存済みの点数（一覧）と、開いたときに
      //   計算し直す点数（詳細）がずれる。実際に一覧64・詳細73になった。
      //   過去の日は変わらないので、今日の分だけその場で出し直す。
      const today = formatDate(new Date());
      const finalizedToday = p1List("DailyOpsReport", studentEmail).some(function (r) {
        return String(r.report_date).slice(0, 10) === today && String(r.finalized_at || "").trim(); });
      try {
        if (finalizedToday) throw new Error("finalized");   // 締めた日は触らない
        const f = computeDailyOpsFacts(studentEmail, today);
        const v = (f.operating_score !== null && f.operating_score !== undefined)
                  ? f.operating_score : f.partial_score;
        if (v !== null && v !== undefined) opsByDate[today] = v;
        else delete opsByDate[today];
      } catch (e2) {}
    }
  } catch (e) {}
  const list = rows
    .sort((a, b) => b.date > a.date ? 1 : -1)
    .map(r => {
      let breakdown = null;
      if (r.breakdown) { try { breakdown = JSON.parse(r.breakdown); } catch (e) {} }
      const d = String(r.date).slice(0, 10);
      const ops = opsByDate[d];
      return { date: r.date, score: (ops === undefined ? Number(r.score) : ops),
               legacy_score: Number(r.score), source: (ops === undefined ? "legacy" : "daily_v2"),
               breakdown };
    });
  return { ok: true, data: list };
}

// 「現在のステータス」用。AIレポートのbreakdown保存を待たず、
// 記録済みのDailyLogから直接いま時点の5軸スコアを計算する。
// student_emailで先に絞り込んでから必要な列だけ取り出す（getLogsと同じ理由）
// 全ユーザー分のDailyLogを読み、student_email別に累計ステータス
// {score, breakdown} を計算する。getStatusSummary・getCommunityの
// 両方から使う共通ロジック（基準がズレないよう一本化している）。
// preloadedLogObjects: 呼び出し元が既にDailyLogを sheetToObjects() で読み込んで
// いる場合、その配列をそのまま渡せば再読み込みしない（coachGetStudentsなど）。
// 渡されなかった場合のみ、5分間のCacheServiceキャッシュを使う（ステータスは
// 日単位で減衰するスコアなので、数分の遅延は実害がない）
// ログ保存直後にステータスキャッシュを無効化する（次回計算時に最新のDailyLogで再計算される）
function invalidateStatusCache() {
  try { CacheService.getScriptCache().remove("all_statuses_v1"); } catch (e) { /* ignore */ }
}

function computeAllStatuses(preloadedLogObjects) {
  // 全生徒分のDailyLogを日毎の減衰計算まで含めて再計算するのは重いため、
  // preloadedLogObjectsが渡された場合（coachGetStudents等、既に自前でシート読み込み
  // 済みのケース）でも必ずキャッシュを先にチェックする。以前はpreloadedLogObjectsが
  // ある時だけキャッシュを素通りしていたため、コーチCRMを開くたびに全生徒分の
  // 重い再計算が走ってしまい、読み込みが遅くなっていた
  const CACHE_KEY = "all_statuses_v1";
  const cached = CacheService.getScriptCache().get(CACHE_KEY);
  if (cached) return JSON.parse(cached);

  const allLogs = preloadedLogObjects || sheetToObjects(getSheet("DailyLog"));
  const byUser = {};
  allLogs.forEach(l => {
    const email = String(l.student_email || "");
    if (!email) return;
    (byUser[email] = byUser[email] || []).push({
      date: l.date,
      memo: String(l.memo || ""),
      focus_level: String(l.focus_level || ""),
      goal_related: String(l.goal_related || ""),
    });
  });

  // ステータスは筋肉のように「やった分だけ増え、やらない期間が続くと
  // 落ちる」設計。半減期21日の指数減衰で日々の実績を積み上げる
  // （1日サボった程度では大きく減らないが、休み続けるとじわじわ下がる）。
  const HALF_LIFE_DAYS = 21;
  const decayPerDay = Math.pow(0.5, 1 / HALF_LIFE_DAYS);
  const grow = (decayedTotal, factor) => Math.min(20, Math.floor(Math.sqrt(Math.max(0, decayedTotal)) * factor));
  const today = new Date();
  const todayKey = formatDate(today);

  const result = {};
  Object.keys(byUser).forEach(email => {
    const logs = byUser[email];
    const perDay = {};
    logs.forEach(l => {
      const d = perDay[l.date] = perDay[l.date] || { blocks: 0, memos: 0, highFocus: 0, goal: 0 };
      d.blocks++;
      if (l.memo && l.memo.trim()) d.memos++;
      if ((parseInt(l.focus_level) || 0) >= 4) d.highFocus++;
      if (l.goal_related === "true" || l.goal_related === true) d.goal++;
    });
    const dateKeys = Object.keys(perDay).sort();
    if (dateKeys.length === 0) {
      result[email] = { score: 0, breakdown: { records: 0, memo: 0, focus: 0, goal: 0, consistency: 0 } };
      return;
    }

    const decayed = { records: 0, memo: 0, focus: 0, goal: 0, consistency: 0 };
    let cursor = new Date(dateKeys[0] + "T00:00:00");
    const end = new Date(todayKey + "T00:00:00");
    let first = true;
    while (cursor <= end) {
      if (!first) {
        decayed.records *= decayPerDay;
        decayed.memo *= decayPerDay;
        decayed.focus *= decayPerDay;
        decayed.goal *= decayPerDay;
        decayed.consistency *= decayPerDay;
      }
      first = false;
      const key = formatDate(cursor);
      const day = perDay[key];
      if (day) {
        decayed.records += day.blocks;
        decayed.memo += day.memos;
        decayed.focus += day.highFocus;
        decayed.goal += day.goal;
        decayed.consistency += 1;
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    const breakdown = {
      records: grow(decayed.records, 1.47),     // 1日6ブロックを継続で20
      memo: grow(decayed.memo, 2.08),           // 1日3メモを継続で20
      focus: grow(decayed.focus, 2.08),         // 1日3回の高集中を継続で20
      goal: grow(decayed.goal, 2.08),           // 1日3ブロックの目標関連を継続で20
      consistency: grow(decayed.consistency, 3.6), // 毎日記録を継続で20
    };
    const score = breakdown.records + breakdown.memo + breakdown.focus + breakdown.goal + breakdown.consistency;
    result[email] = { score, breakdown };
  });

  try { CacheService.getScriptCache().put(CACHE_KEY, JSON.stringify(result), 300); } catch (e) { /* サイズ超過時は無視してキャッシュなしで返す */ }
  return result;
}

// ホーム画面が起動時に必要とするデータを1リクエストにまとめて返す。
// 以前は9本のAPIを並列で叩いており、GASの同時実行制限で実質順番待ちになって
// 1本3〜4秒×待ち行列＝体感がとても遅かった。1本にまとめ、さらに実行内の
// シート読取キャッシュで同じシートの読み直しを省くことで大幅に短縮する
function getHomeData(studentEmail) {
  _sheetReadCacheOn = true; _sheetReadCache = {};
  try {
    const safe = function (fn) { try { const r = fn(); return (r && r.ok) ? r.data : null; } catch (err) { Logger.log("getHomeData part: " + err); return null; } };
    const data = {
      user:         safe(function () { return getUser(studentEmail); }),
      report:       safe(function () { return getReport(studentEmail, {}); }),
      game:         safe(function () { return getGameStatus(studentEmail); }),
      schedule:     safe(function () { return getSchedule(studentEmail); }),
      logs:         safe(function () { return getLogs(studentEmail, {}); }),
      ranking:      safe(function () { return getRanking(studentEmail); }),
      status:       safe(function () { return getStatusSummary(studentEmail); }),
      weekly:       safe(function () { return getWeeklySummary(studentEmail); }),
      intent:       safe(function () { return getIntent(studentEmail); }),
      todayActions: safe(function () { return getTodayActions(studentEmail); })
    };
    // ★ロードマップと自己経営力もここに載せる★（2026-08-05 起動高速化）
    //   GASは同じ人からのリクエストを順番に処理するので、本数がそのまま待ち時間になる。
    //   ホームで必ず要る2本を相乗りさせて、起動の往復を3回→1回にする。
    //   1つ落ちても画面全体を落とさない。落ちたら client 側が個別に取りに行く。
    try {
      const rm = getRoadmap(studentEmail);
      if (rm && rm.ok) data.roadmap = { sprints: rm.sprints || null, goalTree: rm.goalTree || null };
    } catch (err) { Logger.log("getHomeData roadmap: " + err); }
    try {
      const sp = getSelfMgmtPower(studentEmail, { withPrev: "1", cacheOnly: "1" });
      if (sp) data.smp = sp;   // 未計算なら null。client があとから取りに行く
    } catch (err) { Logger.log("getHomeData smp: " + err); }
    // タスク一覧も同じ理由でここに載せる（起動直後に必ず1本呼んでいた）
    try {
      const tk = getTasks(studentEmail, { includeDone: "1" });
      if (tk && tk.ok && Array.isArray(tk.data)) data.tasks = tk.data;
    } catch (err) { Logger.log("getHomeData tasks: " + err); }
    return { ok: true, data: data };
  } finally { _sheetReadCacheOn = false; _sheetReadCache = {}; }
}

// ══════════════════════════════════════════════════════════════════
// 自己経営力（self_mgmt_power_v1）
//
// 既存の「記録・メモ・集中・目標・継続」（computeAllStatuses）とは
// 別物として作る。あちらは活動量、こちらは「決めたことを進められたか」。
// 旧ロジックは一切変更しない。XP・レベル・ランキング・夜間レポートにも繋がない。
//
// 大事にしたこと:
//   ・未入力を0点にしない（0点と「まだ測っていない」は意味が違う）
//   ・材料が無い指標は素直に null を返し、なぜ出せないかを書く
//   ・立て直しの機会が一度も無い人を満点にしない（評価対象外にする）
//   ・長く働くほど高得点にならない。休息を減点しない
//   ・同じ事実を複数の指標へ満額加算しない（見る観点を分ける）
// ══════════════════════════════════════════════════════════════════
const SMP_VERSION = "v1.0.0";
const SMP_KEYS = [
  ["result_power",          "成果力",     "目標を成果に変える力"],
  ["time_allocation_power", "時間配分力", "大事なことに時間を使う力"],
  ["execution_power",       "実行力",     "決めたことを進める力"],
  ["continuity_power",      "継続力",     "無理なく続ける力"],
  ["recovery_power",        "立て直し力", "崩れたあとに戻る力"]
];
// しきい値は後から変えられるようにここへ集約する（ハードコードして散らさない）
const SMP_BANDS = [[80, "強み"], [65, "安定"], [50, "要確認"], [0, "改善優先"]];
function smpBand(score) {
  if (score === null || score === undefined) return "データ不足";
  for (let i = 0; i < SMP_BANDS.length; i++) if (score >= SMP_BANDS[i][0]) return SMP_BANDS[i][1];
  return "改善優先";
}

// 構成要素。評価できたものだけで正規化する
function smpRoll(parts) {
  const ok = parts.filter(function (p) { return p.state === "evaluated" && p.value !== null; });
  const totalW = parts.reduce(function (a, p) { return a + (p.weight || 1); }, 0);
  if (!ok.length) return { score: null, coverage: 0, componentCoverage: 0, sample: 0 };
  let wsum = 0, vsum = 0, sample = 0;
  ok.forEach(function (p) { wsum += (p.weight || 1); vsum += p.value * (p.weight || 1); sample += (p.sample || 0); });
  return {
    score: Math.round(vsum / wsum),
    // ★重みで測る★ 件数で測ると、重い要素が欠けても割合が高く出てしまう
    coverage: totalW ? Math.round(wsum / totalW * 100) / 100 : 0,
    componentCoverage: Math.round(ok.length / parts.length * 100) / 100,
    sample: sample
  };
}

// ★週次＝日次の積み重ね★（2026-08-03 Kaiの構造に合わせて作り直し）
//   日次の5項目と週次の5つの力は1対1で対応する。
//   ならば週次は、その週の日次スコアを日ごとに平均したものにするのが素直。
//   こうすると「日次は出ているのに週次だけ空っぽ」が起きない。
//   1日ずつ計算するが、シートは1回だけ読んで日ごとに配る（重くしない）。
const SMP_FROM_DAILY = {
  progress:       ["result_power",          "成果力"],
  execution:      ["execution_power",       "実行力"],
  time_use:       ["time_allocation_power", "時間配分力"],
  sustainability: ["continuity_power",      "継続力"],
  review:         ["recovery_power",        "立て直し力"]
};
function computeSelfMgmtPowerFromDaily_(studentEmail, monday, sunday, today) {
  const inWeek = function (d) { const x = String(d || "").slice(0, 10); return x >= monday && x <= sunday; };
  const dayOf = function (v) {
    return v instanceof Date ? Utilities.formatDate(v, "Asia/Tokyo", "yyyy-MM-dd") : String(v || "").slice(0, 10); };
  // まとめて1回読む
  const allLogs = sheetToObjects(getSheet("DailyLog")).filter(function (l) {
    return String(l.student_email) === studentEmail && inWeek(dayOf(l.date)) && !String(l.deleted_at || "").trim(); });
  const allTasks = p1List("Tasks", studentEmail).filter(function (t) {
    return !String(t.deleted_at || "").trim() && inWeek(p1DateOut_(t.date)); });
  const allJournal = sheetToObjects(getJournalSheet()).filter(function (r) {
    return String(r.student_email) === studentEmail && inWeek(dayOf(r.date)); });
  const wgs = p1List("WeeklyGoals", studentEmail).filter(function (w) { return p1Status_(w.status, "ACTIVE") === "ACTIVE"; });
  // 使える時間も1回だけ読む（日ごとにシートを読むと重くなる）
  const planRows = p1List("DayPlan", studentEmail);
  const userRow = sheetToObjects(getSheet("Users")).find(function (u) { return u.student_email === studentEmail; });
  const weekly = parseWeeklyAvailable_(userRow && userRow.weekly_available_minutes);
  const availOf = function (d) {
    const pl = planRows.find(function (r) { return String(r.date).slice(0, 10) === d; }) || null;
    if (pl && String(pl.available_minutes || "").trim() !== "") {
      return { minutes: Number(pl.available_minutes), source: "DAY_PLAN",
               day_type: String(pl.day_type || "NORMAL"), state: "evaluated" };
    }
    const dow = WEEKDAY_KEYS[(new Date(d + "T00:00:00+09:00").getDay() + 6) % 7];
    if (weekly && weekly[dow] !== undefined) {
      return { minutes: weekly[dow], source: "WEEKDAY_DEFAULT",
               day_type: pl ? String(pl.day_type || "NORMAL") : "NORMAL", state: "evaluated" };
    }
    return { minutes: null, source: "NONE", day_type: pl ? String(pl.day_type || "NORMAL") : "",
             state: "insufficient_data", reason_code: "AVAILABLE_TIME_MISSING" };
  };

  // 週の初日から今日（週末を越えていれば日曜）まで
  const last = today < sunday ? today : sunday;
  const days = [];
  for (let d = monday; d <= last; ) {
    days.push(d);
    const x = new Date(d + "T00:00:00+09:00"); x.setDate(x.getDate() + 1); d = formatDate(x);
  }
  const acc = {};   // key → { sum, n, covSum, days:[] }
  Object.keys(SMP_FROM_DAILY).forEach(function (k) { acc[k] = { sum: 0, n: 0, covSum: 0, days: [] }; });
  let evaluatedDays = 0;
  days.forEach(function (d) {
    const fx = {
      logs: allLogs.filter(function (l) { return dayOf(l.date) === d; }),
      tasks: allTasks.filter(function (t) { return p1DateOut_(t.date) === d; }),
      journal: allJournal.find(function (r) { return dayOf(r.date) === d; }) || {},
      weekly_goals: wgs,
      available: availOf(d)
    };
    // その日に何も無ければ数えない（0点として平均を下げない）
    if (!fx.logs.length && !fx.tasks.length && !String(fx.journal.intent || "").trim()) return;
    evaluatedDays++;
    const f = computeDailyOpsFacts(studentEmail, d, fx);
    (f.components || []).forEach(function (c) {
      const a = acc[c.key]; if (!a) return;
      if (c.state === "evaluated" && c.score !== null) {
        a.sum += c.score; a.n++; a.covSum += (c.weighted_coverage || 0);
        a.days.push(d.slice(5) + " " + c.score);
      }
    });
  });
  const out = {};
  Object.keys(SMP_FROM_DAILY).forEach(function (k) {
    const a = acc[k];
    const key = SMP_FROM_DAILY[k][0];
    if (!a.n) {
      out[key] = { score: null, coverage: 0, component_coverage: 0, sample_count: 0, components: [],
        state: evaluatedDays ? "insufficient_data" : "insufficient_data",
        reason_code: evaluatedDays ? "NOT_MEASURED_THIS_WEEK" : "NO_RECORDS_YET",
        reason: evaluatedDays ? "今週はまだこの項目を測れていません" : "今週の記録がまだありません" };
      return;
    }
    const score = Math.round(a.sum / a.n);
    // 測れた日の割合 × その日の中で測れていた割合
    const dayRate = evaluatedDays ? a.n / evaluatedDays : 0;
    const inner = a.covSum / a.n;
    out[key] = {
      score: score,
      coverage: Math.round(dayRate * inner * 100) / 100,
      component_coverage: Math.round(dayRate * 100) / 100,
      sample_count: a.n,
      components: [
        { label: "日ごとの平均", value: score, state: "evaluated", weight: 2,
          detail: a.n + "日分（" + a.days.join(" / ") + "）" },
        { label: "測れた日", value: Math.round(dayRate * 100), state: "evaluated", weight: 1,
          detail: a.n + "日 / 記録のあった" + evaluatedDays + "日" }
      ],
      state: "evaluated", reason: ""
    };
  });
  out.__days = { elapsed: days.length, with_records: evaluatedDays };
  return out;
}

function computeSelfMgmtPower(studentEmail, weekStart) {
  const monday = weekStart || mondayOf(formatDate(new Date()));
  const sunday = (function () { const d = new Date(monday + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 6);
                                return d.toISOString().substring(0, 10); })();
  const today = formatDate(new Date());
  const inWeek = function (d) { const x = String(d || "").slice(0, 10); return x >= monday && x <= sunday; };

  const tasks = p1List("Tasks", studentEmail).filter(function (t) { return !String(t.deleted_at || "").trim(); });
  const weekTasks = tasks.filter(function (t) { return inWeek(p1DateOut_(t.date)); });
  const logs = sheetToObjects(getSheet("DailyLog")).filter(function (l) {
    // 論理削除された記録は数えない
    return String(l.student_email) === studentEmail && inWeek(l.date) &&
           !String(l.deleted_at || "").trim(); });
  const goals = p1List("Goals", studentEmail).filter(function (g) { return p1Status_(g.status, "ACTIVE") !== "ARCHIVED"; });
  const wgs = p1List("WeeklyGoals", studentEmail).filter(function (w) { return p1Status_(w.status, "ACTIVE") === "ACTIVE"; });

  const out = {};
  // 表示文だけで状態を判断させない。機械で読める理由コードを必ず添える
  const na = function (reason, code) {
    return { value: null, state: "insufficient_data", reason: reason, reason_code: code || "INSUFFICIENT_DATA", sample: 0 };
  };

  // ── 実行力: 決めたことを進められたか ────────────────────────────
  (function () {
    const parts = [];
    const done = weekTasks.filter(function (t) { return normalizeTaskStatus(t.status) === "DONE"; });
    // 重要タスクの完了率
    const imp = weekTasks.filter(function (t) { return String(t.importance_level).toUpperCase() === "HIGH"; });
    parts.push(imp.length
      ? { value: Math.round(imp.filter(function (t) { return normalizeTaskStatus(t.status) === "DONE"; }).length / imp.length * 100),
          state: "evaluated", weight: 2, sample: imp.length, label: "重要タスク完了率" }
      : Object.assign(na("重要（高）にしたタスクが今週ありません"), { weight: 2, label: "重要タスク完了率" }));
    // 期限遵守率（期限があるものだけ）
    const withDue = weekTasks.filter(function (t) { return String(p1DateOut_(t.due_at) || "").trim(); });
    parts.push(withDue.length
      ? { value: Math.round(withDue.filter(function (t) {
            const c = String(t.completed_at || "").slice(0, 10);
            return c && c <= p1DateOut_(t.due_at); }).length / withDue.length * 100),
          state: "evaluated", weight: 2, sample: withDue.length, label: "期限遵守率" }
      : Object.assign(na("期限を決めたタスクが今週ありません"), { weight: 2, label: "期限遵守率" }));
    // 着手率（一度でも動かしたか）
    parts.push(weekTasks.length
      ? { value: Math.round(weekTasks.filter(function (t) {
            return String(t.first_started_at || "").trim() || normalizeTaskStatus(t.status) === "DONE"; }).length / weekTasks.length * 100),
          state: "evaluated", weight: 1, sample: weekTasks.length, label: "着手率" }
      : Object.assign(na("今週のタスクがありません"), { weight: 1, label: "着手率" }));
    // 持ち越し率（低いほど良いので反転）
    parts.push(weekTasks.length
      ? { value: Math.round((1 - weekTasks.filter(function (t) { return Number(t.carryover_count || 0) > 0; }).length / weekTasks.length) * 100),
          state: "evaluated", weight: 1, sample: weekTasks.length, label: "持ち越しの少なさ" }
      : Object.assign(na("今週のタスクがありません"), { weight: 1, label: "持ち越しの少なさ" }));
    // 見積もり精度。実績時間の正は DailyLog（link_task_id 別に合計）。
    //   Tasks.actual_minutes は集計キャッシュなので、ここでは参照しない。
    //   測っていないタスクを0分として扱わない。
    const minutesByTask = {};
    logs.forEach(function (l) {
      const tid = String(l.link_task_id || "").trim();
      const am = Number(l.actual_minutes);
      if (!tid || !(am > 0)) return;
      minutesByTask[tid] = (minutesByTask[tid] || 0) + am;
    });
    const est = weekTasks.filter(function (t) {
      return Number(t.estimated_minutes) > 0 && Number(minutesByTask[String(t.task_id)]) > 0; });
    parts.push(est.length >= 3
      ? { value: (function () {
            let acc = 0; est.forEach(function (t) {
              const e = Number(t.estimated_minutes), a = Number(minutesByTask[String(t.task_id)]);
              acc += Math.max(0, 100 - Math.abs(a - e) / e * 100); });
            return Math.round(acc / est.length); })(),
          state: "evaluated", weight: 1, sample: est.length, label: "見積もりの精度" }
      : Object.assign(na("実績時間の記録が3件に満たないため、この要素は分母から外しています"), { weight: 1, label: "見積もりの精度" }));
    const r = smpRoll(parts);
    out.execution_power = { score: r.score, coverage: r.coverage, component_coverage: r.componentCoverage, sample_count: r.sample, components: parts,
      state: r.score === null ? "insufficient_data" : "evaluated",
      reason: r.score === null
        ? (parts.filter(function (p) { return p.state !== "evaluated" && p.reason; })
                .map(function (p) { return p.reason; }).join(" / ") || "今週のタスクがまだありません") : "" };
  })();

  // ── 成果力: 目標を成果に変えられたか（登録しただけでは加点しない）──
  (function () {
    const parts = [];
    // ★未記録と0達成を分ける★
    //   目標を作った直後は actual が 0 になるが、それは「0件しかできなかった」
    //   ではなく「まだ記録していない」。ここを0点にすると、決めた初日に
    //   いきなり改善優先と出てしまう（実際に出た）。
    let agg = {};
    try { agg = aggregateWeeklyActual(studentEmail, monday) || {}; } catch (e) { agg = {}; }
    const wgEval = wgs.filter(function (w) {
      const t = Number(w.std_line) > 0 ? Number(w.std_line) : Number(w.target_total);
      if (isNaN(t) || t <= 0) return false;
      const a = agg[String(w.weekly_goal_id)] || {};
      // 「＋ 追加する」で入れた実績も「記録あり」として数える（2026-08-05）。
      // DailyLog だけを見ていたため、追加するで進めた目標が評価から丸ごと
      // 外れていた（点はつかないのに、本人は進めている）。
      const rc = (a.recordCount !== undefined) ? a.recordCount : Number(a.logCount || 0);
      return Number(rc) > 0;   // 記録があるものだけ評価する
    });
    if (wgEval.length) {
      let acc = 0, n = 0;
      wgEval.forEach(function (w) {
        const t = Number(w.std_line) > 0 ? Number(w.std_line) : Number(w.target_total);
        const a = Number((agg[String(w.weekly_goal_id)] || {}).actual || w.actual_value || 0);
        acc += Math.min(100, Math.round(a / t * 100)); n++;
      });
      parts.push({ value: Math.round(acc / n), state: "evaluated", weight: 2, sample: n, label: "週間目標の達成率" });
    } else parts.push(Object.assign(
      na(wgs.length ? "今週の週間目標にまだ記録がありません（0件という意味ではありません）"
                    : "数値のある週間目標がありません",
         wgs.length ? "NO_RECORDS_YET" : "NO_EVALUABLE_GOAL"),
      { weight: 2, label: "週間目標の達成率" }));

    // ★status を除外条件に使わない★
    //   computePace の status=UNKNOWN は「データが無い」ではなく
    //   「経過7日未満で実績ペースがまだ出せない」ことも含む。
    //   これで弾いていたため、現在値20/目標400が入っているのに
    //   「目標の数値が入っていない」と誤って報告していた。
    //   見るのは progressPct が出せるか（＝現在値・目標値・期間が揃っているか）。
    const gWithNum = goals.map(function (g) {
      return { g: g, p: computePace(g.start_date, g.end_date, g.current_value, g.target_value, g.unit, today) };
    }).filter(function (x) { return x.p.progressPct !== null && x.p.totalDays; });
    // 期間の頭は「経過1日で進捗5%」のような値になり、比で見ると455%になる。
    // 短すぎる期間から進み具合を断じない（7日を過ぎてから評価する）
    const gEval = gWithNum.filter(function (x) { return x.p.elapsedDays >= 7; });
    if (gEval.length) {
      let acc = 0;
      gEval.forEach(function (x) {
        // 「経過した割合」に対して「進んだ割合」がどれだけ追いついているか
        const elapsedPct = x.p.elapsedDays / x.p.totalDays * 100;
        acc += Math.min(100, Math.round(x.p.progressPct / elapsedPct * 100));
      });
      parts.push({ value: Math.round(acc / gEval.length), state: "evaluated", weight: 2, sample: gEval.length,
                   label: "3か月目標の進み具合" });
    } else if (gWithNum.length) {
      parts.push(Object.assign(
        na("3か月目標を始めてから" + Math.max.apply(null, gWithNum.map(function (x) { return x.p.elapsedDays; })) +
           "日なので、進み具合はまだ評価できません（7日を過ぎると出ます）", "OBSERVATION_PERIOD_TOO_SHORT"),
        { weight: 2, label: "3か月目標の進み具合" }));
    } else {
      parts.push(Object.assign(na("3か月目標に現在値・目標値・期間のいずれかが入っていません", "CURRENT_VALUE_MISSING"),
                               { weight: 2, label: "3か月目標の進み具合" }));
    }

    const r = smpRoll(parts);
    // ★理由は内訳から組み立てる★ 決め打ちの文言だと、実際の原因と食い違う
    //   （現在値も期間も入っているのに「数値が入っていない」と出ていた）
    const why = parts.filter(function (p) { return p.state !== "evaluated" && p.reason; })
                     .map(function (p) { return p.reason; });
    out.result_power = { score: r.score, coverage: r.coverage, component_coverage: r.componentCoverage, sample_count: r.sample, components: parts,
      state: r.score === null ? "insufficient_data" : "evaluated",
      reason: r.score === null ? why.join(" / ") : "" };
  })();

  // ── 時間配分力 ──────────────────────────────
  //   5分類（GOAL_DIRECT等）はまだ全員分そろっていない。
  //   ただし「時間帯」と「目標に関連」は前からずっと記録されている。
  //   そこで、まずは今あるデータからの代理指標で出す（Kaiの判断・2026-08-03）。
  //   ★これは推定であることを画面にも必ず書く★
  //   実測（タイマー）と5分類が増えるほど、この項目は正確になる。
  (function () {
    const parts = [];
    const mins = function (l) {
      const am = Number(l.actual_minutes);
      if (am > 0) return am;                        // 実測があればそれを使う
      return timeBlockMinutes(l.time_block);        // 無ければ時間帯の長さ
    };
    const total = logs.reduce(function (a, l) { return a + mins(l); }, 0);
    if (total > 0) {
      // 分類（USER/RULEで入ったもの）があれば、そちらを正として使う
      const clsMin = {};
      let classified = 0;
      logs.forEach(function (l) {
        // 今の分類に無い値（昔の分類など）は数えない。数えると
        // 「分類できている」ことになり、実際より判断が甘くなる。
        const c = String(l.time_classification || "");
        if (!c || !TIME_CLASSES[c]) return;
        clsMin[c] = (clsMin[c] || 0) + mins(l);
        classified += mins(l);
      });
      const goalMin = (classified / total >= 0.5)
        ? (clsMin.GOAL_DIRECT || 0)
        : logs.filter(function (l) { return String(l.goal_related) === "true" || l.goal_related === true; })
              .reduce(function (a, l) { return a + mins(l); }, 0);
      const byClass = (classified / total >= 0.5);
      parts.push({ label: "目標に直結した時間の割合", weight: 2, sample: logs.length, state: "evaluated",
                   value: Math.round(goalMin / total * 100),
                   detail: Math.round(goalMin / 60 * 10) / 10 + "時間 / " + (Math.round(total / 60 * 10) / 10) + "時間"
                           + (byClass ? "（分類から）" : "（時間帯からの推定）") });
      // 集中して使えた時間（自己評価4以上）
      const focusMin = logs.filter(function (l) { return (parseInt(l.focus_level, 10) || 0) >= 4; })
                           .reduce(function (a, l) { return a + mins(l); }, 0);
      parts.push({ label: "集中して使えた時間の割合", weight: 1, sample: logs.length, state: "evaluated",
                   value: Math.round(focusMin / total * 100),
                   detail: Math.round(focusMin / 60 * 10) / 10 + "時間 / " + (Math.round(total / 60 * 10) / 10) + "時間" });
      // 5分類そのもの（回復・投資などの内訳）は、まだ全員分そろっていない
      parts.push({ label: "5分類での配分", weight: 1, value: null, state: "insufficient_data",
                   reason: "時間の使い方の分類が半分以上たまると、ここも見られます" });
    } else {
      parts.push({ label: "目標に直結した時間の割合", weight: 2, value: null, state: "insufficient_data",
                   reason: "今週の記録がまだありません" });
    }
    const r2 = smpRoll(parts);
    out.time_allocation_power = { score: r2.score, coverage: r2.coverage,
      component_coverage: r2.componentCoverage, sample_count: r2.sample, components: parts,
      state: r2.score === null ? "insufficient_data" : "evaluated",
      reason_code: r2.score === null ? "NO_RECORDS_YET" : "",
      estimated: true,
      reason: r2.score === null ? "今週の記録がまだありません"
                                : "時間帯と「目標に関連」からの推定です。タイマーでの実測と分類が増えると正確になります" };
  })();

  // ── 継続力: 無理なく続けられたか ──
  //   ★sample_count は日単位★ 同じ日に何回記録しても件数が増えるだけで、
  //   「続けられている」ことの根拠にはならない。日で数える。
  //   ★休息・回復・予定量は今は測れない★ その分 coverage を下げ、
  //   confidence も上げない（測れていないものを測れたことにしない）。
  (function () {
    const parts = [];
    const perDay = {};
    logs.forEach(function (l) { const d = String(l.date).slice(0, 10); perDay[d] = (perDay[d] || 0) + 1; });
    const dayKeys = Object.keys(perDay);
    const acted = dayKeys.length;
    const elapsed = Math.min(7, Math.max(1, Math.round((new Date(today + "T00:00:00+09:00") - new Date(monday + "T00:00:00+09:00")) / 86400000) + 1));
    parts.push({ value: Math.min(100, Math.round(acted / elapsed * 100)), state: "evaluated",
                 weight: 2, sample: acted, label: "行動した日数",
                 detail: acted + "日 / 経過" + elapsed + "日" });
    // 日ごとの偏り。1日に詰め込みすぎていないか（長く働くほど高得点にしない）
    // ★記録の件数を負荷の代わりに使わない★
    //   細かく記録する人ほど件数が増えるだけで、稼働時間でも負荷でもない。
    //   実績時間（actual_minutes）が入るまでは点数に使わず、参考として持つだけ。
    const counts = dayKeys.map(function (k) { return perDay[k]; });
    const avg = counts.length ? counts.reduce(function (a, b) { return a + b; }, 0) / counts.length : 0;
    const max = counts.length ? Math.max.apply(null, counts) : 0;
    parts.push(Object.assign(
      na("実績時間の記録がまだ足りないため、日ごとの負荷の偏りは点数に使っていません",
         "ACTUAL_MINUTES_COVERAGE_LOW"),
      { weight: 1, label: "日ごとの負荷の偏り",
        reference: counts.length ? ("記録件数 最多" + max + "件 / 平均" + (Math.round(avg * 10) / 10) + "件（参考）") : "" }));
    // ★測れていないものを明示して分母に入れる★ これを省くと coverage が
    //   1.0 になり、休息や予定量を見ていないのに「確からしさ 高」と出る
    // ★休息と回復のバランス★（2026-08-05 実装漏れを解消）
    //   「分類する機能を準備しています」のまま固定になっていたが、
    //   6分類で「回復」を選べるようになっているので、実際に数えられる。
    //   測れないままにしておくと、継続力がいつまでも暫定扱いになり
    //   ホームに点数が出ない（Kaiの「継続力が消えた」の正体）。
    //   ただし分類がほとんど入っていない週は、0%と断定せず測らない。
    (function () {
      const minsOf = function (l) {
        const am = Number(l.actual_minutes);
        return am > 0 ? am : timeBlockMinutes(l.time_block);
      };
      let total = 0, classified = 0, rest = 0;
      logs.forEach(function (l) {
        const m = minsOf(l); if (!(m > 0)) return;
        total += m;
        const k = String(l.time_classification || "");
        if (!k || !TIME_CLASSES[k]) return;
        classified += m;
        if (REST_CLASSES[k]) rest += m;
      });
      // 分類が3割に届かない週は「休めたか」を判断できない
      if (!(total > 0) || classified / total < 0.3) {
        parts.push(Object.assign(na("分類のついた記録がまだ少ないため、休息の割合を出せません",
                                    "REST_COVERAGE_LOW"),
                                 { weight: 1, label: "休息と回復のバランス" }));
        return;
      }
      const pct = rest / total * 100;
      // 1割前後を目安にする。多すぎても少なすぎても続かないので、上は頭打ちにする
      const score = Math.max(0, Math.min(100, Math.round(pct / 10 * 100)));
      parts.push({ value: score, state: "evaluated", weight: 1, sample: logs.length,
                   label: "休息と回復のバランス",
                   detail: Math.round(pct) + "%（回復・人間関係にあてた時間）" });
    })();
    parts.push(Object.assign(na("1日に使える時間の設定がないため、予定の詰めすぎを判定できません", "AVAILABLE_TIME_MISSING"),
                             { weight: 1, label: "予定量の適切さ" }));
    const r = smpRoll(parts);
    const missing = parts.filter(function (p) { return p.state !== "evaluated" && p.reason; })
                         .map(function (p) { return p.reason; });
    // ★継続力の件数は「評価対象になった日数」★ 構成要素の合算にすると
    //   同じ日を二重に数えてしまい、記録回数が多い人ほど確からしさが上がる
    out.continuity_power = { score: r.score, coverage: r.coverage, component_coverage: r.componentCoverage, sample_count: acted, components: parts,
      state: r.score === null ? "insufficient_data" : "evaluated",
      // 算出できていても、何を見ていないかは必ず伝える
      reason: missing.join(" / ") };
  })();

  // ── 立て直し力: 崩れた後に戻れたか（崩れていない人を満点にしない）──
  (function () {
    const parts = [];
    const carried = tasks.filter(function (t) { return Number(t.carryover_count || 0) > 0; });
    if (carried.length) {
      parts.push({ value: Math.round(carried.filter(function (t) { return normalizeTaskStatus(t.status) === "DONE"; }).length / carried.length * 100),
                   state: "evaluated", weight: 2, sample: carried.length, label: "持ち越したあとの完了率" });
    } else parts.push({ value: null, state: "not_evaluable", weight: 2, sample: 0,
                        label: "持ち越したあとの完了率", reason: "今週は持ち越しがありませんでした" });
    const r = smpRoll(parts);
    const anyEval = parts.some(function (p) { return p.state === "evaluated"; });
    out.recovery_power = { score: r.score, coverage: r.coverage, component_coverage: r.componentCoverage, sample_count: r.sample, components: parts,
      state: anyEval ? "evaluated" : "not_evaluable",
      reason: anyEval ? "" : "立て直しの機会が今週はなかったため、評価対象外です" };
  })();

  // ★日次の積み重ねを正とする★
  //   これまでは週次だけ別の計算をしていたため、日次では点が出ているのに
  //   週次は「データ蓄積中」だらけになっていた（Kaiの指摘）。
  let daily = null;
  try { daily = computeSelfMgmtPowerFromDaily_(studentEmail, monday, sunday, today); } catch (e) { daily = null; }
  const calculatedAt = new Date().toISOString();
  const rows = SMP_KEYS.map(function (k) {
    const fromDaily = daily && daily[k[0]];
    // 日次から出せたものはそれを使う。出せないものだけ従来の計算を残す
    const o = (fromDaily && fromDaily.score !== null) ? fromDaily : (out[k[0]] || {});
    return {
      key: k[0], label: k[1], description: k[2],
      score: (o.score === undefined ? null : o.score),
      evaluation_state: o.state || "insufficient_data",
      // ★測れている割合が半分未満なら「暫定」と明示する★
      //   1要素だけで100点が出て「強み」と表示されるのは誤解を生む
      provisional: (o.score !== null && o.score !== undefined && (o.coverage || 0) < 0.5),
      status_label: (o.state === "not_evaluable") ? "評価対象外"
                  : (o.score !== null && o.score !== undefined && (o.coverage || 0) < 0.5) ? "暫定"
                  : smpBand(o.score),
      // ★確からしさの決め方★ 件数ではなく「評価できた要素の割合(coverage)」で決める。
      //   0.8以上=高 / 0.5以上=中 / それ未満=低 / 算出できない=なし。
      //   測れていない要素を分母に入れているので、機能が未実装のうちは
      //   自動的に低〜中に落ちる（過大評価を防ぐ）
      confidence: o.score === null ? "NONE" : (o.coverage >= 0.8 ? "HIGH" : o.coverage >= 0.5 ? "MEDIUM" : "LOW"),
      coverage: o.coverage || 0, component_coverage: o.component_coverage || 0,
      sample_count: o.sample_count || 0,
      components: o.components || [], incomplete_reason: o.reason || "",
      reason_code: o.reason_code || (function () {
        const f = (o.components || []).find(function (c) { return c.reason_code; });
        return f ? f.reason_code : ""; })(),
      period_start: monday, period_end: sunday,
      calculation_version: SMP_VERSION, calculated_at: calculatedAt
    };
  });
  // ★自己経営力の総合点★（2026-08-05 Kai要望）
  //   これまで5つの力が別々に出るだけで、「全体としてどうなのか」を表す
  //   1つの数字が無かった。確かに測れている（暫定でない）力の平均を総合点にする。
  //   測れていない力を0点として混ぜると、記録が少ない人ほど不当に低く出るため、
  //   分母には入れない。何本ぶんの平均なのかを evaluated_count で添える。
  // ★暫定でも隠さない★（2026-08-05 Kaiの判断）
  //   これまでは「測れた要素が半分未満」の項目を総合から外し、画面にも点数を出さなかった。
  //   その結果、継続力のように素点があるのに何も出ない項目が生まれ、
  //   「消えた」と見えてしまった。
  //   数字を隠すより、出したうえで「何が測れていないか」を添えるほうが正しい。
  const scored = rows.filter(function (m) {
    return m.evaluation_state === "evaluated" && m.score !== null; });
  const overall = scored.length
    ? Math.round(scored.reduce(function (a, m) { return a + Number(m.score); }, 0) / scored.length)
    : null;
  return { period_start: monday, period_end: sunday, version: SMP_VERSION, metrics: rows,
           overall_score: overall, evaluated_count: scored.length, metric_count: rows.length,
           provisional_count: scored.filter(function (m) { return m.provisional; }).length };
}

// ★自己経営力のキャッシュを捨てるための世代番号★（2026-08-05）
//   使える時間を変えても「1日に使える時間を設定すると見られます」のままだった。
//   10分キャッシュが残るため。キャッシュキーの中身を1つ変えれば、
//   古いキーには二度と当たらなくなる。個別にキーを消して回るより確実。
function smpEpochKey_(studentEmail) {
  return "smp_epoch_" + sha256Hex(String(studentEmail)).slice(0, 24);
}
function smpEpoch_(studentEmail) {
  try { return String(PropertiesService.getScriptProperties().getProperty(smpEpochKey_(studentEmail)) || "0"); }
  catch (e) { return "0"; }
}
function smpBumpEpoch_(studentEmail) {
  // 認証前に呼ばれることもあるので、宛先が無いときは何もしない
  // （知らない相手のぶんまで書き込みを増やさないため）
  if (!String(studentEmail || "").trim()) return;
  try {
    // 読んで足して書き戻すと、同時に保存されたとき片方が消える。
    // 値は「変わればよい」だけなので、時刻をそのまま入れる（読み込みも不要）。
    PropertiesService.getScriptProperties().setProperty(smpEpochKey_(studentEmail), String(Date.now()));
  } catch (e) { Logger.log("smpBumpEpoch_: " + e); }
}

function getSelfMgmtPower(studentEmail, body) {
  const chk = p1RequireUser(studentEmail);
  if (!chk.ok) return chk;
  const user = sheetToObjects(getSheet("Users")).find(function (u) { return u.student_email === studentEmail; });
  if (!hasFeature(user, SMP_FEATURE_KEY)) return { ok: false, error: "feature not enabled" };
  const weekStart = String((body && body.weekStart) || "").slice(0, 10) || null;
  // ★10分だけ結果を取っておく★
  //   週次は日ごとの計算を積み上げるため10秒ほどかかる。毎回待たせると
  //   画面が「ステータス」のまま切り替わらないことがある（Kaiの端末で発生）。
  const ckey = "smp_" + sha256Hex(studentEmail + "|" + (weekStart || "cur") + "|" +
                                  String((body && body.withPrev) || "") + "|" + SMP_VERSION +
                                  "|" + OPS_CALC_VERSION + "|" + formatDate(new Date()) +
                                  "|" + smpEpoch_(studentEmail)).slice(0, 40);
  if (String((body && body.refresh) || "") !== "1") {
    try { const hit = CacheService.getScriptCache().get(ckey);
      if (hit) return JSON.parse(hit); } catch (e) {}
  }
  // ★キャッシュにある時だけ返す★（2026-08-05 起動高速化）
  //   ホームのまとめ取得（getHomeData）から呼ぶときに使う。
  //   計算は10秒以上かかるので、まだ無いときは相乗りさせず、
  //   画面が出たあとで個別に取りに行かせる。
  if (String((body && body.cacheOnly) || "") === "1") return null;
  const cur = computeSelfMgmtPower(studentEmail, weekStart);
  // 「みんなの頑張り」がこの値を読むだけで済むように残しておく
  if (!weekStart) { try { smpStoreOverall_(studentEmail, cur.overall_score); } catch (e) {} }
  let prev = null;
  if (String((body && body.withPrev) || "") === "1") {
    const d = new Date(cur.period_start + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - 7);
    prev = computeSelfMgmtPower(studentEmail, d.toISOString().substring(0, 10));
  }
  // ★同じ仲間の中で上位何%か★（2026-08-05 Kai要望）
  //   すでに計算済み（キャッシュ済み）の総合点だけを読んで比べる。
  //   ここで全員ぶんを計算し直すと画面が開かなくなるので、計算はしない。
  //   比べる相手が少ないと「上位50%」がほぼ無意味になるため、
  //   自分を含めて5人ぶん揃っているときだけ出す。
  try {
    const mine = cur.overall_score;
    if (mine !== null && mine !== undefined) {
      const myCohortP = String((user && user.cohort) || "").trim();
      const peers = sheetToObjects(getSheet("Users")).filter(function (u) {
        return String(u.is_active || "").toUpperCase() === "TRUE" &&
               String(u.cohort || "").trim() === myCohortP &&
               hasFeature(u, SMP_FEATURE_KEY); });
      const scores = [];
      peers.forEach(function (u) {
        if (u.student_email === studentEmail) { scores.push(Number(mine)); return; }
        // ★一時キャッシュだけを見ない★（2026-08-05 Kai報告「上位◯%が消えた」）
        //   一時キャッシュは数時間で消えるうえ、デプロイでも飛ぶ。
        //   消えると比べる相手が5人に届かず、表示ごと出なくなっていた。
        //   Users に残してある smp_overall（消えない）へ倒す。
        var v = smpOverallCached_(u.student_email, false);
        if (v === null || v === undefined) {
          const raw = u.smp_overall;
          if (raw !== "" && raw !== null && raw !== undefined) {
            const n = Number(raw);
            if (!isNaN(n)) v = n;
          }
        }
        if (v !== null && v !== undefined) scores.push(Number(v));
      });
      if (scores.length >= 5) {
        // 自分より上にいる人数から順位を出す（同点は同じ順位）
        const above = scores.filter(function (v) { return v > mine; }).length;
        const rank = above + 1;
        cur.rank = rank;
        cur.rank_total = scores.length;
        // 「上位◯%」。1位なら上位1%とは書かず、素直に切り上げる
        cur.top_percent = Math.max(1, Math.ceil(rank / scores.length * 100));
      }
    }
  } catch (e) { /* 出せなくても本体は返す */ }

  const out = { ok: true, data: cur, prev: prev };
  // ★取っておく時間を延ばす★（2026-08-05 起動高速化）
  //   1回10秒近くかかる計算なので、10分ごとに作り直すと
  //   その10分の最初に開いた人が毎回待たされる。
  //   キーに日付が入っているので、日をまたげば必ず作り直される。
  try { CacheService.getScriptCache().put(ckey, JSON.stringify(out), 6 * 60 * 60); } catch (e) { /* 大きすぎるときは諦める */ }
  return out;
}

// ══════════════════════════════════════════════════════════════════
// AI日次レポート（self_management_daily_v1）の評価エンジン
//
// ★点数はAIに決めさせない★
//   現行レポートは計算式が無く、AIがプロンプトを読んで点数を自己申告して
//   いる。同じ入力でも揺れるし、辛口の指示に引きずられて低く出る。
//   ここでは構造化データからルールで数値を出し、AIには文章だけを書かせる。
//
// ★自己経営力（週次）とは役割が違う★
//   こちらは「今日の事実の整理」。継続力や立て直し力のような、
//   1日では判断できないものは毎日採点しない。
// ══════════════════════════════════════════════════════════════════
const OPS_CALC_VERSION = "self_management_daily_score_v2";
const OPS_REPORT_VERSION = "self_management_daily_v1";
const OPS_FEATURE_KEY = "self_management_daily_report_v1";
// 配点。calculation_version で管理する
// 週次の自己経営力と1対1で対応させる（Kaiの整理・2026-08-03）
//   目標の前進     → 成果力
//   決めたことの実行 → 実行力
//   時間の使い方    → 時間配分力
//   無理なく続ける  → 継続力
//   振り返りと改善  → 立て直し力
const OPS_WEIGHTS = { progress: 25, execution: 25, time_use: 20, sustainability: 15, review: 15 };
const OPS_BANDS = [[85, "非常に良い流れ"], [70, "着実に前進"], [55, "調整しながら前進"],
                   [40, "立て直しどき"], [0, "まず一つに絞る"]];
function opsBand(score) {
  if (score === null || score === undefined) return "データ蓄積中";
  for (let i = 0; i < OPS_BANDS.length; i++) if (score >= OPS_BANDS[i][0]) return OPS_BANDS[i][1];
  return "まず一つに絞る";
}

// その日の経営事実を数値化する。AIは呼ばない（同じ入力なら同じ結果）
// fixture を渡すとシートを読まずに計算する（テスト用）
function computeDailyOpsFacts(studentEmail, dateStr, fixture) {
  const date = String(dateStr || formatDate(new Date())).slice(0, 10);
  const fx = fixture || null;
  const logs = fx ? (fx.logs || []) : sheetToObjects(getSheet("DailyLog")).filter(function (l) {
    // 論理削除された記録は数えない（消したのに評価へ残るのを防ぐ）
    return String(l.student_email) === studentEmail && String(l.date).slice(0, 10) === date &&
           !String(l.deleted_at || "").trim(); });
  const tasks = fx ? (fx.tasks || []) : p1List("Tasks", studentEmail).filter(function (t) {
    return !String(t.deleted_at || "").trim() && p1DateOut_(t.date) === date; });
  const journal = fx ? (fx.journal || {}) : (sheetToObjects(getJournalSheet()).find(function (r) {
    const rd = r.date instanceof Date ? Utilities.formatDate(r.date, "Asia/Tokyo", "yyyy-MM-dd") : String(r.date).slice(0, 10);
    return String(r.student_email) === studentEmail && rd === date; }) || {});
  const wgs = fx ? (fx.weekly_goals || []) : p1List("WeeklyGoals", studentEmail).filter(function (w) { return p1Status_(w.status, "ACTIVE") === "ACTIVE"; });

  // state 既定は insufficient_data（測る手段が無い＝分母に残して充足度を下げる）。
  // not_evaluable は「そもそも今日は評価する機会が無い」＝分母から外す。
  const na = function (label, weight, reason, code, state) {
    return { key: label, label: label, weight: weight, value: null,
             state: state || "insufficient_data", reason: reason, reason_code: code };
  };
  const NO_CHANCE = "not_evaluable";
  const items = [];
  // 休息日として計画した日は、前進・実行で減点しない
  const restDay = journal.rest_day === true || String(journal.rest_day || "") === "true";
  const restCat = function (key, label, weight) {
    return { key: key, label: label, weight: weight, score: null,
             state: "excluded_by_exception", evaluation_state: "excluded_by_exception",
             weighted_coverage: 0, component_coverage: 0, coverage: 0, confidence: "NONE",
             evaluated_weight: 0, total_weight: 0, sample_count: 0, components: [],
             incomplete_reason: "休息日として計画された日のため評価しません",
             reason: "休息日として計画された日のため評価しません", reason_code: "REST_DAY_EXCEPTION" };
  };

  // ── 成果への前進（30）──────────────────────────────
  //   完了だけでなく着手も前進として数える。決めただけでは加点しない。
  (function () {
    const parts = [];
    const imp = tasks.filter(function (t) { return String(t.importance_level).toUpperCase() === "HIGH"; });
    if (imp.length) {
      const done = imp.filter(function (t) { return normalizeTaskStatus(t.status) === "DONE"; }).length;
      const started = imp.filter(function (t) { return String(t.first_started_at || "").trim() &&
                                                       normalizeTaskStatus(t.status) !== "DONE"; }).length;
      // 完了=満点 / 着手=半分
      parts.push({ label: "大事なタスクが進んだか", weight: 2, sample: imp.length, state: "evaluated",
                   value: Math.round((done + started * 0.5) / imp.length * 100),
                   detail: "完了" + done + "件・着手" + started + "件 / " + imp.length + "件" });
    } else parts.push(na("大事なタスクが進んだか", 2, "今日は重要（高）のタスクがありません", "NO_IMPORTANT_TASK", NO_CHANCE));

    const focusText = String(journal.intent || "").trim();
    if (focusText) {
      const goalMin = logs.filter(function (l) { return String(l.goal_related) === "true" || l.goal_related === true; }).length * 60;
      const targetMin = (Number(journal.intent_hours) || 2) * 60;
      const doneFlag = String(journal.intent_done || "") === "true";
      parts.push({ label: "今日いちばんの達成", weight: 2, sample: 1, state: "evaluated",
                   value: doneFlag ? 100 : Math.min(100, Math.round(goalMin / Math.max(60, targetMin) * 100)),
                   detail: doneFlag ? "達成" : (Math.round(goalMin / 60 * 10) / 10) + "時間 / " + (targetMin / 60) + "時間" });
    } else parts.push(na("今日いちばんの達成", 2, "今日のフォーカスが決まっていません", "NO_DAILY_FOCUS", NO_CHANCE));

    items.push(restDay ? restCat("progress", "目標の前進", OPS_WEIGHTS.progress)
                       : rollOps("progress", "目標の前進", OPS_WEIGHTS.progress, parts));
  })();

  // ── 計画の実行（30）───────────────────────────────
  //   全部終わらないと0点、にはしない。
  (function () {
    const parts = [];
    if (tasks.length) {
      const done = tasks.filter(function (t) { return normalizeTaskStatus(t.status) === "DONE"; }).length;
      const started = tasks.filter(function (t) { return String(t.first_started_at || "").trim() &&
                                                         normalizeTaskStatus(t.status) !== "DONE"; }).length;
      parts.push({ label: "予定したタスクの実行", weight: 2, sample: tasks.length, state: "evaluated",
                   value: Math.round((done + started * 0.5) / tasks.length * 100),
                   detail: "完了" + done + "件・着手" + started + "件 / " + tasks.length + "件" });
      const withDue = tasks.filter(function (t) { return String(p1DateOut_(t.due_at) || "").trim(); });
      if (withDue.length) {
        parts.push({ label: "期限に間に合った割合", weight: 1, sample: withDue.length, state: "evaluated",
                     value: Math.round(withDue.filter(function (t) {
                       const c = String(t.completed_at || "").slice(0, 10);
                       return c && c <= p1DateOut_(t.due_at); }).length / withDue.length * 100) });
      } else parts.push(na("期限に間に合った割合", 1, "期限を決めたタスクがありません", "NO_DUE_TASK", NO_CHANCE));
      // 持ち越しは「少ないほど良い」。1件も無い日を減点しない
      parts.push({ label: "翌日に残さなかった割合", weight: 1, sample: tasks.length, state: "evaluated",
                   value: Math.round((1 - tasks.filter(function (t) {
                     return normalizeTaskStatus(t.status) === "CARRIED_OVER"; }).length / tasks.length) * 100) });
    } else {
      parts.push(na("予定したタスクの実行", 2, "今日のタスクが登録されていません", "NO_TASK_TODAY", NO_CHANCE));
      parts.push(na("期限に間に合った割合", 1, "今日のタスクが登録されていません", "NO_TASK_TODAY", NO_CHANCE));
      parts.push(na("翌日に残さなかった割合", 1, "今日のタスクが登録されていません", "NO_TASK_TODAY", NO_CHANCE));
    }
    items.push(restDay ? restCat("execution", "決めたことの実行", OPS_WEIGHTS.execution)
                       : rollOps("execution", "決めたことの実行", OPS_WEIGHTS.execution, parts,
                                 { required: ["予定したタスクの実行"] }));
  })();

  // ── 時間の使い方（20）→ 週次の「時間配分力」につながる ──────
  //   会社でいう「人・お金・設備をどこへ配ったか」。
  //   5分類がそろっていない間は、時間帯と「目標に関連」からの推定で出す。
  //   分類が半分以上たまったら、推定ではなく分類の実績に切り替わる。
  (function () {
    const mins = function (l) {
      const am = Number(l.actual_minutes);
      return am > 0 ? am : timeBlockMinutes(l.time_block);
    };
    const total = logs.reduce(function (a, l) { return a + mins(l); }, 0);
    const parts = [];
    if (total > 0) {
      const clsMin = {};
      let classified = 0;
      logs.forEach(function (l) {
        // 今の分類に無い値（昔の分類など）は数えない。数えると
        // 「分類できている」ことになり、実際より判断が甘くなる。
        const c = String(l.time_classification || "");
        if (!c || !TIME_CLASSES[c]) return;
        clsMin[c] = (clsMin[c] || 0) + mins(l);
        classified += mins(l);
      });
      const byClass = (classified / total) >= 0.5;
      const goalMin = byClass ? (clsMin.GOAL_DIRECT || 0)
        : logs.filter(function (l) { return String(l.goal_related) === "true" || l.goal_related === true; })
              .reduce(function (a, l) { return a + mins(l); }, 0);
      const h = function (m) { return (Math.round(m / 60 * 10) / 10) + "時間"; };
      parts.push({ label: "目標に向けた時間", weight: 2, sample: logs.length, state: "evaluated",
                   value: Math.round(goalMin / total * 100),
                   detail: h(goalMin) + " / " + h(total) + (byClass ? "（分類から）" : "（時間帯からの推定）") });
      const focusMin = logs.filter(function (l) { return (parseInt(l.focus_level, 10) || 0) >= 4; })
                           .reduce(function (a, l) { return a + mins(l); }, 0);
      parts.push({ label: "集中できた時間", weight: 1, sample: logs.length, state: "evaluated",
                   value: Math.round(focusMin / total * 100), detail: h(focusMin) + " / " + h(total) });
      if (byClass) {
        // 計画外に流れた時間が少ないほど良い
        const leak = clsMin.UNPLANNED_LEAKAGE || 0;
        parts.push({ label: "計画外に流れた時間の少なさ", weight: 1, sample: logs.length, state: "evaluated",
                     value: Math.max(0, Math.round((1 - leak / total) * 100)), detail: h(leak) });
      } else {
        parts.push(na("5分類での配分", 1, "記録の半分以上を分類すると、ここも見られます", "TIME_CLASSIFICATION_PARTIAL"));
      }
    } else {
      parts.push(na("目標に向けた時間", 2, "今日の記録がまだありません", "NO_RECORDS_TODAY", NO_CHANCE));
      parts.push(na("集中できた時間", 1, "今日の記録がまだありません", "NO_RECORDS_TODAY", NO_CHANCE));
    }
    items.push(rollOps("time_use", "時間の使い方", OPS_WEIGHTS.time_use, parts));
  })();

  // ── 続けられる運営（20）─────────────────────────
  //   長く働くほど高得点にしない。休息を減点しない。
  //   ★持ち越しは「計画の実行」で評価済み。ここでは点にせず参考事実に留める★
  (function () {
    const planned = tasks.reduce(function (a, t) { return a + (Number(t.estimated_minutes) || 0); }, 0);
    const carried = tasks.filter(function (t) { return normalizeTaskStatus(t.status) === "CARRIED_OVER"; }).length;
    // 会社でいう「資金繰り」。使える時間に対して、詰め込みすぎていないか。
    const avail = fx ? (fx.available || { minutes: null, state: "insufficient_data" })
                     : resolveAvailableMinutes(studentEmail, date);
    const parts = [];
    // 使える時間を0分＝休む日として設定した日は、休む日として扱う
    const zeroDay = !!(avail && avail.minutes === 0);
    if (zeroDay) {
      parts.push({ label: "予定を詰め込みすぎていないか", weight: 2, sample: tasks.length, state: "evaluated",
                   value: planned > 0 ? Math.max(0, 100 - Math.round(planned / 60) * 20) : 100,
                   detail: planned > 0 ? ("休む日に " + planned + "分の予定") : "休む日として計画" });
      parts.push(na("明日に残る量", 1, "休む日のため見ません", "REST_DAY", NO_CHANCE));
    } else if (avail && avail.minutes > 0) {
      // 使える時間の8割までを「無理のない範囲」とする。超えるほど下がる
      const ratio = planned / avail.minutes;
      const okRatio = ratio <= 0.8 ? 100 : Math.max(0, Math.round((1 - (ratio - 0.8) / 0.8) * 100));
      parts.push({ label: "予定を詰め込みすぎていないか", weight: 2, sample: tasks.length, state: "evaluated",
                   value: planned > 0 ? okRatio : 100,
                   detail: "予定" + planned + "分 / 使える" + avail.minutes + "分" });
      const carriedMin = tasks.filter(function (t) { return normalizeTaskStatus(t.status) === "CARRIED_OVER"; })
                              .reduce(function (a, t) { return a + (Number(t.estimated_minutes) || 0); }, 0);
      parts.push({ label: "明日に残る量", weight: 1, sample: tasks.length, state: "evaluated",
                   value: Math.max(0, Math.round((1 - carriedMin / avail.minutes) * 100)),
                   detail: "持ち越し" + carriedMin + "分" });
    } else {
      parts.push(na("予定を詰め込みすぎていないか", 2, "1日に使える時間を設定すると見られます", "AVAILABLE_TIME_MISSING"));
      parts.push(na("明日に残る量", 1, "1日に使える時間を設定すると見られます", "AVAILABLE_TIME_MISSING"));
    }
    // 休む時間。分類（回復・人間関係）か、休みと決めた日かで見る
    const restMin = logs.filter(function (l) { return !!REST_CLASSES[String(l.time_classification)]; })
                        .reduce(function (a, l) { const am = Number(l.actual_minutes);
                          return a + (am > 0 ? am : timeBlockMinutes(l.time_block)); }, 0);
    const isRest = (avail && avail.day_type === "REST") || restDay || zeroDay;
    if (restMin > 0 || isRest) {
      parts.push({ label: "休む時間があったか", weight: 1, sample: logs.length, state: "evaluated",
                   value: isRest ? 100 : Math.min(100, Math.round(restMin / 60 * 100)),
                   detail: isRest ? "休む日として計画" : (restMin + "分") });
    } else {
      parts.push(na("休む時間があったか", 1, "回復・人間関係に分類した記録があると見られます", "NO_RECOVERY_LOG"));
    }
    parts.push(na("日によるムラ", 1, "実績時間の記録が十分でないため判定できません", "ACTUAL_MINUTES_COVERAGE_LOW"));
    const r = rollOps("sustainability", "無理なく続ける", OPS_WEIGHTS.sustainability, parts);
    // 参考事実（点数には使わない）
    r.reference_facts = [];
    if (tasks.length) r.reference_facts.push("翌日への持ち越し " + carried + "件 / " + tasks.length + "件（参考）");
    if (planned > 0) r.reference_facts.push("今日の予定は合計 " + planned + "分（参考）");
    r.reference = r.reference_facts.join(" ・ ");
    items.push(r);
  })();

  // ── 振り返りと改善（15）→ 週次の「立て直し力」につながる ──────
  //   1日でも測れる：ふりかえりを書いたか、崩れたものを立て直したか。
  (function () {
    const parts = [];
    // ふりかえりを書いた割合（記録があるときだけ）
    if (logs.length) {
      const withMemo = logs.filter(function (l) { return String(l.memo || "").trim(); }).length;
      parts.push({ label: "ふりかえりを書いた割合", weight: 2, sample: logs.length, state: "evaluated",
                   value: Math.round(withMemo / logs.length * 100),
                   detail: withMemo + "件 / " + logs.length + "件" });
      const chars = logs.reduce(function (a, l) { return a + String(l.memo || "").trim().length; }, 0);
      parts.push({ label: "ふりかえりの中身", weight: 1, sample: logs.length, state: "evaluated",
                   value: Math.min(100, Math.round(chars / 300 * 100)),
                   detail: chars + "文字" });
    } else {
      parts.push(na("ふりかえりを書いた割合", 2, "今日の記録がまだありません", "NO_RECORDS_TODAY", NO_CHANCE));
      parts.push(na("ふりかえりの中身", 1, "今日の記録がまだありません", "NO_RECORDS_TODAY", NO_CHANCE));
    }
    // 昨日から持ち越したタスクを、今日進められたか（崩れたあとの立て直し）
    const y = new Date(date + "T00:00:00+09:00"); y.setDate(y.getDate() - 1);
    const carriedIn = tasks.filter(function (t) { return Number(t.carryover_count || 0) > 0; });
    if (carriedIn.length) {
      const back = carriedIn.filter(function (t) {
        return normalizeTaskStatus(t.status) === "DONE" || String(t.first_started_at || "").trim(); }).length;
      parts.push({ label: "持ち越したことの立て直し", weight: 2, sample: carriedIn.length, state: "evaluated",
                   value: Math.round(back / carriedIn.length * 100),
                   detail: "再開" + back + "件 / 持ち越し" + carriedIn.length + "件" });
    } else {
      parts.push(na("持ち越したことの立て直し", 2, "立て直す場面がありませんでした", "NO_CARRYOVER", NO_CHANCE));
    }
    items.push(rollOps("review", "振り返りと改善", OPS_WEIGHTS.review, parts));
  })();

  // ── 総合（中間案）──────────────────────────────
  //   条件を満たすときだけ出す。欠損を0にして下げない。
  //   ★カテゴリ内部の測定率を、総合coverageへそのまま伝播させる★
  const evaluated = items.filter(function (x) { return x.state === "evaluated" && x.score !== null; });
  // 評価する機会が無い／例外で除外したカテゴリは、分母からも外す
  const scoped = items.filter(function (x) {
    return x.state !== "not_evaluable" && x.state !== "excluded_by_exception"; });
  const totalW = scoped.reduce(function (a, x) { return a + x.weight; }, 0);
  const okW = evaluated.reduce(function (a, x) { return a + x.weight; }, 0);
  // Σ(カテゴリ配点 × カテゴリ内部weighted_coverage) ÷ 対象カテゴリ配点
  const covAcc = scoped.reduce(function (a, x) { return a + x.weight * (x.weighted_coverage || 0); }, 0);
  const weightedCoverage = totalW ? Math.round(covAcc / totalW * 100) / 100 : 0;
  const categoryCoverage = totalW ? Math.round(okW / totalW * 100) / 100 : 0;
  const conf = weightedCoverage >= 0.8 ? "HIGH" : weightedCoverage >= 0.5 ? "MEDIUM" : "LOW";
  const hasCore = evaluated.some(function (x) { return x.key === "progress" || x.key === "execution"; });
  const canScore = evaluated.length >= 3 && weightedCoverage >= 0.65 && hasCore && conf !== "LOW";
  // 評価できた分だけの加重平均（総合として出せない日でも、部分の状態は伝える）
  let partial = null;
  if (okW) { let a = 0; evaluated.forEach(function (x) { a += x.score * x.weight; }); partial = Math.round(a / okW); }
  let operating = canScore ? partial : null;
  let scoreBlockedBy = canScore ? "" :
      (!hasCore ? "CORE_CATEGORY_MISSING" :
       evaluated.length < 3 ? "EVALUATED_CATEGORY_LT_3" :
       weightedCoverage < 0.65 ? "COVERAGE_BELOW_THRESHOLD" : "CONFIDENCE_LOW");
  // 満点は根拠を厳しく。測れていない日に100は出さない
  if (operating !== null && operating >= 95 && weightedCoverage < 0.8) {
    operating = null; scoreBlockedBy = "PERFECT_SCORE_NEEDS_COVERAGE_080";
  }
  const evaluatedLabels = evaluated.map(function (x) { return x.label; });
  // 画面に必ず出す点数と、その点数が「全体」か「測れた範囲」か
  const displayed = (operating !== null && operating !== undefined) ? operating : partial;
  const scope = (operating !== null && operating !== undefined) ? "FULL" : "PARTIAL";
  return {
    report_date: date, student_email: studentEmail,
    operating_score: operating,
    displayed_score: displayed,
    score_scope: displayed === null ? "NONE" : scope,
    partial_score: partial,
    partial_label: partial === null ? "" : opsBand(partial),
    partial_scope: evaluatedLabels.join("と"),
    score_blocked_by: scoreBlockedBy,
    operating_state_label: operating === null
      ? (partial === null ? "データ蓄積中" : opsBand(partial))
      : opsBand(operating),
    label_scope: operating === null ? "partial" : "total",
    evaluation_state: operating === null ? "insufficient_data" : "evaluated",
    coverage: weightedCoverage, category_coverage: categoryCoverage,
    confidence: conf,
    evaluated_categories: evaluatedLabels,
    excluded_items: items.filter(function (x) { return x.state !== "evaluated"; })
                         .map(function (x) { return x.label; }),
    components: items,
    calculation_version: OPS_CALC_VERSION,
    report_version: OPS_REPORT_VERSION,
    // 前進として拾える事実（AIの文章の材料。捏造させないため事実だけ渡す）
    facts: {
      logged_blocks: logs.length,
      memo_count: logs.filter(function (l) { return String(l.memo || "").trim(); }).length,
      tasks_total: tasks.length,
      tasks_done: tasks.filter(function (t) { return normalizeTaskStatus(t.status) === "DONE"; }).length,
      // 着手＝始めたが終わっていないもの（内訳の「着手n件」と数を合わせる）
      tasks_started: tasks.filter(function (t) { return String(t.first_started_at || "").trim() &&
                                                        normalizeTaskStatus(t.status) !== "DONE"; }).length,
      important_done: tasks.filter(function (t) { return String(t.importance_level).toUpperCase() === "HIGH" &&
                                                          normalizeTaskStatus(t.status) === "DONE"; })
                           .map(function (t) { return String(t.title); }),
      carried_over: tasks.filter(function (t) { return normalizeTaskStatus(t.status) === "CARRIED_OVER"; })
                         .map(function (t) { return String(t.title); }),
      daily_focus: String(journal.intent || ""),
      daily_focus_done: String(journal.intent_done || "") === "true",
      weekly_goals: wgs.map(function (w) { return { title: String(w.title), actual: Number(w.actual_value || 0),
                                                    target: Number(w.std_line || w.target_total || 0), unit: String(w.unit || "") }; })
    }
  };
}

// 構成要素を丸める。
//   ★数値が出せただけで evaluated にしない★
//   内部の測定率（weighted_coverage）が半分未満、または必須要素が欠けていたら
//   insufficient_data。評価する機会そのものが無い日は not_evaluable。
function rollOps(key, label, weight, parts, opts) {
  const o = opts || {};
  const required = o.required || [];
  const ok = parts.filter(function (p) { return p.state === "evaluated" && p.value !== null; });
  // 「今日はその機会が無い」要素は分母から外す（無いことで測定率を下げない）
  const inScope = parts.filter(function (p) { return p.state !== "not_evaluable"; });
  const totalW = inScope.reduce(function (a, p) { return a + (p.weight || 1); }, 0);
  const okW = ok.reduce(function (a, p) { return a + (p.weight || 1); }, 0);
  const wc = totalW ? Math.round(okW / totalW * 100) / 100 : 0;
  const cc = inScope.length ? Math.round(ok.length / inScope.length * 100) / 100 : 0;
  let score = null, n = 0;
  if (ok.length) {
    let v = 0;
    ok.forEach(function (p) { v += p.value * (p.weight || 1); n += (p.sample || 0); });
    score = Math.round(v / okW);
  }
  const missingRequired = required.filter(function (r) {
    return !ok.some(function (p) { return p.label === r; }); });
  const allNotEvaluable = parts.length > 0 && parts.every(function (p) { return p.state === "not_evaluable"; });
  let state = "evaluated", incomplete = "";
  if (allNotEvaluable) { state = "not_evaluable"; incomplete = "今日は評価する機会がありませんでした"; }
  else if (!ok.length) { state = "insufficient_data"; incomplete = "評価できる要素がありません"; }
  else if (missingRequired.length) { state = "insufficient_data"; incomplete = "必須の要素（" + missingRequired.join("・") + "）が測れていません"; }
  else if (wc < 0.5) { state = "insufficient_data"; incomplete = "測れているのは全体の" + Math.round(wc * 100) + "%です"; }
  const conf = score === null ? "NONE" : (wc >= 0.8 ? "HIGH" : wc >= 0.5 ? "MEDIUM" : "LOW");
  const first = parts.find(function (p) { return p.reason_code; }) || {};
  return {
    key: key, label: label, weight: weight,
    score: score,
    state: state, evaluation_state: state,
    weighted_coverage: wc, component_coverage: cc,
    coverage: wc,                                  // 旧名（画面互換）
    confidence: conf,
    evaluated_weight: okW, total_weight: totalW,
    sample_count: n, components: parts,
    incomplete_reason: incomplete,
    // 同じ理由が並ぶと読みにくいので重複は畳む
    reason: parts.filter(function (p) { return p.state !== "evaluated" && p.reason; })
                 .map(function (p) { return p.reason; })
                 .filter(function (r, i, a) { return a.indexOf(r) === i; }).join(" / "),
    reason_code: state === "evaluated" ? "" : (first.reason_code || "INSUFFICIENT_DATA")
  };
}

function getDailyOpsReport(studentEmail, body) {
  const chk = p1RequireUser(studentEmail);
  if (!chk.ok) return chk;
  const user = sheetToObjects(getSheet("Users")).find(function (u) { return u.student_email === studentEmail; });
  if (!hasFeature(user, OPS_FEATURE_KEY)) return { ok: false, error: "feature not enabled" };
  const date = String((body && body.date) || "").slice(0, 10) || formatDate(new Date());
  // ★確定した日は、そのときの内容をそのまま返す★（2026-08-03 Kaiの判断）
  //   あとからタスクの日付を明日へ動かしただけで、昨日の点数が動くのはおかしい。
  //   夜のトリガーで締めたら、その日の評価はもう変えない。
  const frozen = p1List("DailyOpsReport", studentEmail).find(function (r) {
    return String(r.report_date).slice(0, 10) === date &&
           String(r.report_version) === OPS_REPORT_VERSION &&
           String(r.finalized_at || "").trim(); });
  if (frozen && String((body && body.refresh) || "") !== "1") {
    let snap = null, nar = null;
    try { snap = JSON.parse(frozen.snapshot_json || "null"); } catch (e) {}
    try { nar = JSON.parse(frozen.narrative_json || "null"); } catch (e) {}
    if (snap) {
      snap.narrative = nar || null;
      snap.finalized = true;
      snap.finalized_at = String(frozen.finalized_at);
      return { ok: true, data: snap };
    }
  }
  const cur = computeDailyOpsFacts(studentEmail, date);
  // 自分の過去とだけ比べる。legacy score とは比べない。
  // ★データ量の差を「成長」と誤読させないため、比較条件を満たす日だけ比べる★
  let prevDelta = null, avgDelta = null, cmpReason = "";
  const comparable = function (f) {
    if (!f || f.operating_score === null) return false;
    if (f.report_version !== cur.report_version) return false;
    if (f.calculation_version !== cur.calculation_version) return false;
    if (f.coverage < 0.65) return false;
    if (Math.abs(f.coverage - cur.coverage) > 0.15) return false;
    // 評価できたカテゴリの構成が一致していること
    return f.evaluated_categories.join("|") === cur.evaluated_categories.join("|");
  };
  if (cur.operating_score === null) {
    cmpReason = "総合スコアが出ていないため比較できません";
  } else {
    const hist = [];
    for (let i = 1; i <= 7; i++) {
      const d = new Date(date + "T00:00:00+09:00"); d.setDate(d.getDate() - i);
      const f = computeDailyOpsFacts(studentEmail, formatDate(d));
      if (comparable(f)) hist.push({ i: i, s: f.operating_score });
    }
    const y = hist.find(function (h) { return h.i === 1; });
    if (y) prevDelta = cur.operating_score - y.s;
    if (hist.length >= 3) {
      const avg = hist.reduce(function (a, h) { return a + h.s; }, 0) / hist.length;
      avgDelta = Math.round(cur.operating_score - avg);
    }
    if (prevDelta === null && avgDelta === null) cmpReason = "比較できるデータを蓄積中です";
    cur.comparable_days = hist.length;
  }
  cur.previous_day_delta = prevDelta;
  cur.seven_day_average_delta = avgDelta;
  cur.comparison_unavailable_reason = cmpReason;
  // Phase R2: 文章はAIが書く。数値・状態・充足度はここで確定済みで、AIは触れない
  const nar = opsNarrative(studentEmail, cur, body && String(body.refresh) === "1");
  cur.narrative = nar;
  return { ok: true, data: cur };
}

// ══════════════════════════════════════════════════════════════════
// Phase R2: AIは「文章だけ」書く
//   ・点数/状態/充足度/確からしさ/版はAIに渡すだけで、書き換えさせない
//   ・文章の材料は fact_id 付きの事実に限る。無い事実は書けない
//   ・同じ入力なら生成し直さない（input_hash）
//   ・schema検証に落ちたら機械組み立ての文章へ落とす
// ══════════════════════════════════════════════════════════════════
const OPS_PROMPT_VERSION = "self_management_daily_prompt_v1_2";
const OPS_MAX_REGENERATE = 8;   // 1日あたりの再生成の上限（編集のたびに課金しない）

// 文章の材料。ここに無い事実をAIが書いたら落とす
function opsFactList(cur) {
  const f = cur.facts || {};
  const L = [];
  (f.important_done || []).forEach(function (t, i) {
    L.push({ fact_id: "f_important_done_" + i, text: "重要タスク「" + t + "」を完了した" }); });
  if (f.daily_focus && f.daily_focus_done)
    L.push({ fact_id: "f_focus_done", text: "今日のフォーカス「" + f.daily_focus + "」を達成した" });
  if (f.daily_focus && !f.daily_focus_done)
    L.push({ fact_id: "f_focus_open", text: "今日のフォーカス「" + f.daily_focus + "」は達成に至らなかった" });
  if (f.tasks_total) L.push({ fact_id: "f_tasks", text: "今日のタスク" + f.tasks_total + "件のうち" + f.tasks_done + "件を完了し、" + f.tasks_started + "件に着手した" });
  if (f.logged_blocks) L.push({ fact_id: "f_logs", text: f.logged_blocks + "時間帯を記録し、" + f.memo_count + "件の振り返りを残した" });
  (f.carried_over || []).forEach(function (t, i) {
    L.push({ fact_id: "f_carried_" + i, text: "「" + t + "」を翌日へ回した" }); });
  (f.weekly_goals || []).forEach(function (w, i) {
    L.push({ fact_id: "f_weekly_goal_" + i, text: "今週の目標「" + w.title + "」は " + w.actual + " / " + w.target + w.unit }); });
  (cur.components || []).forEach(function (c) {
    if (c.state === "evaluated")
      L.push({ fact_id: "f_cat_" + c.key, text: c.label + "は" + c.score + "点（測定範囲" + Math.round((c.weighted_coverage || 0) * 100) + "%）" });
    else
      L.push({ fact_id: "f_cat_" + c.key + "_pending", text: c.label + "は" + (c.incomplete_reason || "評価できていない") });
  });
  return L;
}

// 同じ入力なら同じ結果。日付や乱数は混ぜない
function opsInputHash(cur, factList) {
  const src = {
    date: cur.report_date, email: cur.student_email,
    score: cur.operating_score, partial: cur.partial_score,
    state: cur.evaluation_state, coverage: cur.coverage, confidence: cur.confidence,
    blocked: cur.score_blocked_by,
    cats: (cur.components || []).map(function (c) {
      return [c.key, c.state, c.score, c.weighted_coverage].join(":"); }),
    facts: factList.map(function (x) { return x.fact_id + "=" + x.text; }),
    calc: cur.calculation_version, report: cur.report_version, prompt: OPS_PROMPT_VERSION
  };
  return sha256Hex(JSON.stringify(src));
}

// 機械組み立て（AIが使えない/信用できないときの土台）
function opsFallbackNarrative(cur, factList) {
  const byId = {};
  factList.forEach(function (x) { byId[x.fact_id] = x; });
  const pick = function (pre) {
    return factList.filter(function (x) { return x.fact_id.indexOf(pre) === 0; }); };
  const prog = pick("f_important_done_").concat(byId.f_focus_done ? [byId.f_focus_done] : [])
                 .concat(byId.f_logs ? [byId.f_logs] : []).slice(0, 3);
  const carried = pick("f_carried_");
  const catIds = (cur.components || []).map(function (c) {
    return "f_cat_" + c.key + (c.state === "evaluated" ? "" : "_pending"); })
    .filter(function (id) { return byId[id]; });
  const pending = (cur.components || []).filter(function (c) { return c.state !== "evaluated"; })
                                        .map(function (c) { return c.label; });
  const summary = cur.operating_score !== null
    ? "今日は決めたことを進められています。下の内訳で、どこが効いたかを確認できます。"
    : (cur.partial_score !== null
        ? (cur.evaluated_categories || []).join("と") + "は「" + cur.partial_label + "」です。総合スコアは、"
          + (pending.join("と") || "不足している項目") + "のデータを蓄積中です。"
        : "評価に必要なデータがまだ足りません。記録が増えると状態が出せるようになります。");
  return {
    operating_summary: { text: summary, fact_ids: catIds },
    progress_items: prog.map(function (x) { return { text: x.text, fact_ids: [x.fact_id] }; }),
    primary_management_issue: carried.length
      ? { text: "予定していた" + carried.length + "件を翌日へ回しました。積み残しが増えると、明日の予定が入らなくなります。",
          fact_ids: carried.map(function (c) { return c.fact_id; }).slice(0, 3) }
      : null,
    // 提案は事実ではないため、機械組み立てでは作らない（空にする）
    next_action: null,
    stop_action: null,
    recovery_summary: { text: carried.length ? "崩れた予定を翌日へ移して整理しました。"
                                             : "本日は立て直しが必要な場面はありませんでした。",
                        fact_ids: carried.length ? [carried[0].fact_id] : [], template: !carried.length }
  };
}

// AI出力の形を検査する。
//   ★事実を述べる文には、必ず有効な fact_id を1つ以上求める★
//   知らないIDが1つでも混ざっていたら、その文ごと捨てる（部分的に本当らしい
//   文が残るほうが危険なため）。提案（next_action / stop_action）は事実では
//   ないので生成を許すが、何を根拠にしたのかは必ず持たせる。
function opsValidateNarrative(obj, factList) {
  if (!obj || typeof obj !== "object") return { ok: false, reason: "NOT_OBJECT" };
  const ids = {};
  factList.forEach(function (x) { ids[x.fact_id] = 1; });
  const str = function (v, max) {
    return (typeof v === "string" && v.trim()) ? v.trim().slice(0, max) : ""; };
  // 事実IDの検査。1つでも知らないIDがあれば不採用
  const refs = function (v) {
    const a = Array.isArray(v) ? v : (typeof v === "string" && v ? [v] : []);
    const out = [];
    for (let i = 0; i < a.length; i++) {
      const id = str(a[i], 64);
      if (!id || !ids[id]) return null;      // 未知のIDが混ざった → この文は捨てる
      if (out.indexOf(id) === -1) out.push(id);
    }
    return out.length ? out : null;          // 根拠ゼロの断定は許さない
  };
  const factual = function (o, max) {
    if (!o || typeof o !== "object") return null;
    const t = str(o.text, max);
    const r = refs(o.fact_ids);
    return (t && r) ? { text: t, fact_ids: r } : null;
  };

  const summary = factual(obj.operating_summary, 200);
  if (!summary) return { ok: false, reason: "NO_SUMMARY" };

  const items = Array.isArray(obj.progress_items) ? obj.progress_items : [];
  const prog = [];
  for (let i = 0; i < items.length && prog.length < 3; i++) {
    const p = factual(items[i], 120);
    if (p) prog.push(p);
  }

  const issue = factual(obj.primary_management_issue, 200);

  // 提案：根拠ID＋測れる条件＋自分で決められること、が揃ったものだけ採用
  let next = null;
  const na = obj.next_action;
  if (na && typeof na === "object") {
    const t = str(na.text, 120);
    const r = refs(na.based_on_fact_ids);
    const cond = str(na.measurable_condition, 120);
    const ctrl = (na.controllable_by_user === true || String(na.controllable_by_user) === "true");
    if (t && r && cond && ctrl) next = { text: t, based_on_fact_ids: r, measurable_condition: cond, controllable_by_user: true };
  }
  let stop = null;
  const sa = obj.stop_action;
  if (sa && typeof sa === "object") {
    const t = str(sa.text, 120);
    const r = refs(sa.based_on_fact_ids);
    if (t && r) stop = { text: t, based_on_fact_ids: r };
  }

  // 立て直し：事実があれば根拠必須、無い日は定型文
  let rec = factual(obj.recovery_summary, 200);
  if (!rec) rec = { text: "本日は立て直しが必要な場面はありませんでした。", fact_ids: [], template: true };

  return { ok: true, data: {
    operating_summary: summary, progress_items: prog, primary_management_issue: issue,
    next_action: next, stop_action: stop, recovery_summary: rec
  } };
}

function opsBuildPrompt(cur, factList) {
  // ★画面に出る点数をそのまま渡す★
  //   総合が出せない日は「測れた範囲の点数」を出す運用（Kaiの判断）。
  //   ここでAIに「点数は無い」と書かせると、画面の数字と食い違う。
  const shownScore = (cur.operating_score !== null && cur.operating_score !== undefined)
                     ? cur.operating_score : cur.partial_score;
  const scope = (cur.operating_score !== null && cur.operating_score !== undefined) ? "FULL" : "PARTIAL";
  const view = {
    日付: cur.report_date,
    displayed_score: shownScore,
    score_scope: scope,
    点数の意味: scope === "FULL" ? "4項目すべてを含む点数" : "測れた項目だけで出した点数",
    partial_scope: cur.partial_scope || "",
    evaluated_categories: cur.evaluated_categories || [],
    excluded_categories: cur.excluded_items || [],
    status_label: cur.operating_state_label,
    coverage: cur.coverage, 確からしさ: cur.confidence,
    項目: (cur.components || []).map(function (c) {
      return { 名前: c.label, 配点: c.weight, 点数: c.score, 状態: c.evaluation_state,
               測定範囲: c.weighted_coverage, 不足: c.incomplete_reason || "" }; }),
    使える事実: factList
  };
  return "あなたは自己経営の記録アプリの日次レポートを書きます。\n"
    + "以下は、すでに確定した評価結果と、その日の事実です。\n\n"
    + JSON.stringify(view, null, 1) + "\n\n"
    + "【厳守】\n"
    + "・点数・状態・測定範囲・確からしさを、あなたが変えたり言い換えたりしないこと\n"
    + "・「使える事実」に無いことを書かないこと。体調・感情・原因・成果を推測しないこと\n"
    + "・事実を述べる文には、その根拠になった fact_id を必ず全て挙げること。\n"
    + "　1つでも挙げられない内容が混じるなら、その文を書かないこと\n"
    + "・「準備が整った」「意識が高まった」のような、事実から確認できない断定をしないこと\n"
    + "・displayed_score は画面に出ている数字。これと違う点数を書かないこと\n"
    + "・score_scope が PARTIAL のときは、必ず範囲を限定して書くこと。\n"
    + "　良い例:「測れた範囲では、成果への前進と計画の実行が良い状態でした」\n"
    + "　悪い例:「今日は全体として100点でした」「すべての面で完璧な一日でした」\n"
    + "・PARTIAL のとき、『総合』『全体』『満点』『完璧』という言葉を使わないこと\n"
    + "・まだ測れていない項目について、良い・悪いを決めつけないこと\n"
    + "・データが足りないことを、本人の失敗のように書かないこと\n"
    + "・点数が出ていない、算出できていない、とは書かないこと。\n"
    + "　まだ測れていない項目については「◯◯はこれから測れるようになる」と書いてよい\n"
    + "・next_action は本人が自分で決められて、達成したか測れる行動にすること\n"
    + "・stop_action は「やめる・減らすこと」。思い当たらなければ null\n"
    + "・日本語。やさしい言葉で書くこと\n\n"
    + "次のJSONだけを返してください（前後に文章を付けない）。\n"
    + '{\n  "operating_summary": { "text": "<今日の1日の要約。2文以内。むずかしい言葉を使わない>", "fact_ids": ["<根拠のid>"] },\n'
    + '  "progress_items": [ { "text": "<今日の前進。1文>", "fact_ids": ["<根拠のid>"] } ],\n'
    + '  "primary_management_issue": { "text": "<今日の経営課題。2文以内>", "fact_ids": ["<根拠のid>"] } または null,\n'
    + '  "next_action": { "text": "<明日の一手。1文>", "based_on_fact_ids": ["<根拠のid>"],\n'
    + '    "measurable_condition": "<何をもって達成とするか。例: アポ2件の打診を送る>",\n'
    + '    "controllable_by_user": true } または null,\n'
    + '  "stop_action": { "text": "<明日やめる・減らすこと。1文>", "based_on_fact_ids": ["<根拠のid>"] } または null,\n'
    + '  "recovery_summary": { "text": "<今日の立て直し。1〜2文>", "fact_ids": ["<根拠のid>"] } または null\n}';
}

// 保存済みがあれば使い、無ければ生成して保存する
function opsNarrative(studentEmail, cur, forceRefresh) {
  const factList = opsFactList(cur);
  const hash = opsInputHash(cur, factList);
  const rows = p1List("DailyOpsReport", studentEmail).filter(function (r) {
    return String(r.report_date).slice(0, 10) === cur.report_date &&
           String(r.report_version) === cur.report_version; });
  const row = rows[0] || null;
  const regen = row ? Number(row.regenerate_count || 0) : 0;
  if (row && !forceRefresh && String(row.input_hash) === hash) {
    let stored = null;
    try { stored = JSON.parse(row.narrative_json || "null"); } catch (e) { stored = null; }
    if (stored) return Object.assign(stored, { generated_by: row.generated_by || "stored",
                                               prompt_version: row.prompt_version, input_hash: hash, reused: true });
  }
  // 入力が変わりすぎる日に何度も生成しない
  if (row && regen >= OPS_MAX_REGENERATE && !forceRefresh) {
    let stored = null;
    try { stored = JSON.parse(row.narrative_json || "null"); } catch (e) { stored = null; }
    if (stored) return Object.assign(stored, { generated_by: "stored_capped", prompt_version: row.prompt_version,
                                               input_hash: row.input_hash, reused: true,
                                               note: "本日の再生成の上限に達しました" });
  }

  const fb = opsFallbackNarrative(cur, factList);
  let out = fb, by = "fallback", fbReason = "AI_NOT_CALLED";
  const apiKey = PropertiesService.getScriptProperties().getProperty("CLAUDE_API_KEY");
  if (apiKey) {
    try {
      const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        payload: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1200,
                                  messages: [{ role: "user", content: opsBuildPrompt(cur, factList) }] }),
        muteHttpExceptions: true
      });
      const result = JSON.parse(res.getContentText());
      logAiUsage(result, "自己経営 日次レポート");
      const text = result && result.content && result.content[0] ? result.content[0].text : "";
      const parsed = text ? parseAiJson(text) : null;
      const v = opsValidateNarrative(parsed, factList);
      // ★画面の点数と文章の意味を食い違わせない★
      //   測れた範囲の点数なのに「総合」「満点」と書いていたら採用しない
      const isPartial = (cur.operating_score === null || cur.operating_score === undefined);
      const badWords = /総合|全体として|全体的|満点|完璧|すべての面/;
      const allText = v.ok ? [v.data.operating_summary.text,
                              (v.data.primary_management_issue || {}).text || "",
                              (v.data.recovery_summary || {}).text || ""].join(" ") : "";
      if (v.ok && isPartial && badWords.test(allText)) { fbReason = "SCOPE_MISMATCH"; }
      else if (v.ok) { out = v.data; by = "ai"; fbReason = ""; }
      else fbReason = "SCHEMA_" + v.reason;
    } catch (e) { fbReason = "AI_ERROR"; }
  } else fbReason = "NO_API_KEY";
  // AIが前進を1つも根拠付きで書けなかったときは、機械組み立てで補う
  if (by === "ai" && !out.progress_items.length && fb.progress_items.length) {
    out.progress_items = fb.progress_items;
  }

  const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  p1Upsert("DailyOpsReport", "row_id", {
    row_id: row ? row.row_id : ("ops_" + sha256Hex(studentEmail + "|" + cur.report_date + "|" + cur.report_version).slice(0, 16)),
    student_email: studentEmail, report_date: cur.report_date, report_version: cur.report_version,
    operating_state_label: cur.operating_state_label, operating_summary: (out.operating_summary && out.operating_summary.text) || "",
    operating_score: cur.operating_score === null ? "" : cur.operating_score,
    previous_day_delta: cur.previous_day_delta === null ? "" : cur.previous_day_delta,
    seven_day_average_delta: cur.seven_day_average_delta === null ? "" : cur.seven_day_average_delta,
    progress_items: JSON.stringify(out.progress_items),
    primary_management_issue: JSON.stringify(out.primary_management_issue || null),
    next_action: JSON.stringify(out.next_action || null),
    stop_action: JSON.stringify(out.stop_action || null),
    recovery_summary: JSON.stringify(out.recovery_summary || null),
    evaluation_components: JSON.stringify((cur.components || []).map(function (c) {
      return { key: c.key, score: c.score, state: c.evaluation_state,
               weighted_coverage: c.weighted_coverage, confidence: c.confidence }; })),
    evaluation_state: cur.evaluation_state, coverage: cur.coverage, confidence: cur.confidence,
    calculation_version: cur.calculation_version, prompt_version: OPS_PROMPT_VERSION,
    input_hash: hash, generated_at: now,
    narrative_json: JSON.stringify(out), generated_by: by, fallback_reason: fbReason,
    // 確定したときにそのまま返せるよう、計算結果まるごとを残す
    snapshot_json: JSON.stringify(cur).slice(0, 45000),
    regenerate_count: row ? regen + 1 : 0
  });
  return Object.assign({}, out, { generated_by: by, fallback_reason: fbReason,
                                  prompt_version: OPS_PROMPT_VERSION, input_hash: hash, reused: false });
}

// ── Phase B1: actual_minutes の実データ調査（読むだけ・何も書かない）──
//   Tasks と DailyLog のどちらが正か決める前に、いま何が入っているかを見る。
function actualMinutesAudit() {
  const tasks = sheetToObjects(getSheet("Tasks"));
  const logs = sheetToObjects(getSheet("DailyLog"));
  const logsByTask = {};      // link_task_id → 分の合計
  let logRowsWithAm = 0, logAmTotal = 0, logRowsLinked = 0;
  logs.forEach(function (l) {
    if (String(l.deleted_at || "").trim()) return;
    const am = Number(l.actual_minutes);
    if (am > 0) { logRowsWithAm++; logAmTotal += am; }
    const tid = String(l.link_task_id || "").trim();
    if (tid) { logRowsLinked++; logsByTask[tid] = (logsByTask[tid] || 0) + (am > 0 ? am : 0); }
  });
  let tHas = 0, tNonZero = 0, matched = 0, mismatch = 0, onlyTask = 0, onlyLog = 0;
  const samples = [];
  tasks.forEach(function (t) {
    const raw = t.actual_minutes;
    const has = !(raw === "" || raw === null || raw === undefined);
    const v = Number(raw) || 0;
    if (has) tHas++;
    if (v > 0) tNonZero++;
    const lm = logsByTask[String(t.task_id)] ;
    if (v > 0 && lm > 0) { (v === lm ? matched++ : mismatch++);
      if (v !== lm && samples.length < 10)
        samples.push({ task_id: String(t.task_id), title: String(t.title).slice(0, 20), task: v, log: lm }); }
    else if (v > 0 && !lm) onlyTask++;
  });
  Object.keys(logsByTask).forEach(function (tid) {
    if (!logsByTask[tid]) return;
    const t = tasks.find(function (x) { return String(x.task_id) === tid; });
    if (!t || !(Number(t.actual_minutes) > 0)) onlyLog++;
  });
  // 由来の手がかり（タイマーはmemoへ「⏱ 集中n分」を書いていた）
  const timerMemoLogs = logs.filter(function (l) { return /⏱\s*集中\d+分/.test(String(l.memo || "")); }).length;
  const migrated = tasks.filter(function (t) { return String(t.migrated_from || "").trim(); }).length;
  const migratedWithAm = tasks.filter(function (t) {
    return String(t.migrated_from || "").trim() && Number(t.actual_minutes) > 0; }).length;
  return { ok: true,
    tasks_total: tasks.length, tasks_actual_minutes_present: tHas, tasks_actual_minutes_nonzero: tNonZero,
    logs_total: logs.length, logs_actual_minutes_nonzero: logRowsWithAm, logs_actual_minutes_sum: logAmTotal,
    logs_with_link_task_id: logRowsLinked,
    matched: matched, mismatched: mismatch, only_in_tasks: onlyTask, only_in_logs: onlyLog,
    mismatch_samples: samples,
    timer_memo_logs: timerMemoLogs, migrated_tasks: migrated, migrated_tasks_with_actual_minutes: migratedWithAm };
}

// ── Phase R1 の検証用 ───────────────────────────────
//   実データに触らず、作った入力で評価エンジンの挙動を確かめる。
function opsSelfTest(studentEmail, dateStr) {
  const date = String(dateStr || formatDate(new Date())).slice(0, 10);
  const T = function (o) {
    return { title: o.t || "タスク", status: o.s || "TODO", importance_level: o.i || "MEDIUM",
             first_started_at: o.st ? (date + "T09:00") : "", completed_at: o.s === "DONE" ? (date + "T10:00") : "",
             due_at: o.due || "", estimated_minutes: o.m || 30, date: date };
  };
  const brief = function (r) {
    const c = {};
    r.components.forEach(function (x) {
      c[x.label] = { score: x.score, state: x.evaluation_state, wc: x.weighted_coverage,
                     cc: x.component_coverage, conf: x.confidence }; });
    return { operating_score: r.operating_score, label: r.operating_state_label,
             label_scope: r.label_scope, partial_score: r.partial_score,
             coverage: r.coverage, confidence: r.confidence,
             blocked_by: r.score_blocked_by, excluded: r.excluded_items, categories: c };
  };
  const cases = {
    // A: 重要タスクを全部終えたが、時間分類がない日
    A: { tasks: [T({ t: "A1", s: "DONE", i: "HIGH" }), T({ t: "A2", s: "DONE", i: "HIGH" }), T({ t: "A3", s: "DONE" })],
         journal: { intent: "提案書を仕上げる", intent_done: "true", intent_hours: 2 }, logs: [] },
    // B: 半分を終え、最重要には着手した日
    B: { tasks: [T({ t: "B1", s: "IN_PROGRESS", i: "HIGH", st: 1 }), T({ t: "B2", s: "DONE" }),
                 T({ t: "B3", s: "DONE" }), T({ t: "B4", s: "TODO" })],
         journal: { intent: "営業リストを作る", intent_done: "", intent_hours: 3 },
         logs: [{ goal_related: "true" }, { goal_related: "false" }] },
    // C: 予定は未達。体調不良で休み、計画を組み直した日（休息日フラグあり）
    C: { tasks: [T({ t: "C1", s: "CARRIED_OVER", i: "HIGH" }), T({ t: "C2", s: "CARRIED_OVER" })],
         journal: { intent: "", rest_day: true, memo: "体調不良のため休養" }, logs: [] },
    // C_raw: 同じ日を、休息日フラグ無しで評価した場合（入力導線が未実装のため現状これ）
    C_raw: { tasks: [T({ t: "C1", s: "CARRIED_OVER", i: "HIGH" }), T({ t: "C2", s: "CARRIED_OVER" })],
             journal: { intent: "", memo: "体調不良のため休養" }, logs: [] },
    // D: 長時間働いたが、重要目標が進んでいない日
    D: { tasks: [T({ t: "D1", s: "TODO", i: "HIGH" }), T({ t: "D2", s: "DONE" }), T({ t: "D3", s: "DONE" })],
         journal: { intent: "新規事業の設計", intent_done: "", intent_hours: 4 },
         logs: [{ goal_related: "false" }, { goal_related: "false" }, { goal_related: "false" },
                { goal_related: "false" }, { goal_related: "false" }, { goal_related: "false" },
                { goal_related: "false" }, { goal_related: "false" }, { goal_related: "false" },
                { goal_related: "false" }, { goal_related: "false" }, { goal_related: "false" }] },
    // E: 休息日として決めて、そのとおり休んだ日
    E: { tasks: [], journal: { intent: "しっかり休む", intent_done: "true", intent_hours: 0, rest_day: true }, logs: [] }
  };
  const out = { ok: true, date: date, cases: {}, week: [] };
  Object.keys(cases).forEach(function (k) {
    out.cases[k] = brief(computeDailyOpsFacts(studentEmail, date, cases[k]));
  });
  // 実データでの直近7日
  for (let i = 0; i < 7; i++) {
    const d = new Date(date + "T00:00:00+09:00"); d.setDate(d.getDate() - i);
    const ds = formatDate(d);
    const f = computeDailyOpsFacts(studentEmail, ds);
    out.week.push({ date: ds, score: f.operating_score, partial: f.partial_score,
                    coverage: f.coverage, confidence: f.confidence, label: f.operating_state_label,
                    blocked_by: f.score_blocked_by });
  }
  // 文章まわりの検査（AIを呼ばずに、schema検証とフォールバックだけ確かめる）
  (function () {
    const cur = computeDailyOpsFacts(studentEmail, date);
    const fl = opsFactList(cur);
    const ids = fl.map(function (x) { return x.fact_id; });
    const good = { operating_summary: { text: "テスト", fact_ids: [ids[0]] },
                   progress_items: [{ text: "本物の事実", fact_ids: [ids[0]] }],
                   primary_management_issue: { text: "課題", fact_ids: [ids[0]] },
                   next_action: { text: "一手", based_on_fact_ids: [ids[0]],
                                  measurable_condition: "2件送る", controllable_by_user: true },
                   stop_action: null,
                   recovery_summary: { text: "立て直し", fact_ids: [ids[0]] } };
    const bad1 = { progress_items: [] };                                   // 要約なし
    const bad2 = { operating_summary: { text: "テスト", fact_ids: [ids[0]] },
                   progress_items: [{ text: "でっち上げ", fact_ids: ["f_not_exist"] },
                                    { text: "根拠なし" },
                                    { text: "半分だけ本当", fact_ids: [ids[0], "f_not_exist"] }] };
    const bad3 = { operating_summary: { text: "根拠なしの断定", fact_ids: [] } };
    const bad4 = { operating_summary: { text: "テスト", fact_ids: [ids[0]] },
                   next_action: { text: "頑張る", based_on_fact_ids: [ids[0]] } };  // 条件なし
    out.narrative_tests = {
      fact_ids: ids,
      valid_ok: opsValidateNarrative(good, fl).ok,
      missing_summary_rejected: !opsValidateNarrative(bad1, fl).ok,
      unknown_fact_dropped: (function () {
        const v = opsValidateNarrative(bad2, fl);
        return v.ok && v.data.progress_items.length === 0; })(),
      not_object_rejected: !opsValidateNarrative(null, fl).ok,
      no_fact_summary_rejected: !opsValidateNarrative(bad3, fl).ok,
      unmeasurable_next_action_dropped: (function () {
        const v = opsValidateNarrative(bad4, fl);
        return v.ok && v.data.next_action === null; })(),
      fallback: opsFallbackNarrative(cur, fl),
      input_hash_stable: opsInputHash(cur, fl) === opsInputHash(cur, fl)
    };
  })();
  const scored = out.week.filter(function (w) { return w.score !== null; }).map(function (w) { return w.score; });
  const parts = out.week.filter(function (w) { return w.partial !== null; }).map(function (w) { return w.partial; });
  const stat = function (a) {
    if (!a.length) return null;
    const s = a.slice().sort(function (x, y) { return x - y; });
    return { n: a.length, avg: Math.round(a.reduce(function (p, c) { return p + c; }, 0) / a.length),
             median: s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2) };
  };
  out.week_stats = { operating: stat(scored), partial: stat(parts) };
  out.today = brief(computeDailyOpsFacts(studentEmail, date));
  return out;
}

// その日の評価を締める（夜のトリガーから呼ぶ）。以後は計算し直さない
function finalizeDailyOpsReport(studentEmail, date) {
  const day = String(date || "").slice(0, 10) || formatDate(new Date());
  const r = getDailyOpsReport(studentEmail, { date: day });
  if (!r || !r.ok || !r.data) return { ok: false };
  if (r.data.finalized) return { ok: true, already: true, score: r.data.displayed_score };
  const row = p1List("DailyOpsReport", studentEmail).find(function (x) {
    return String(x.report_date).slice(0, 10) === day &&
           String(x.report_version) === OPS_REPORT_VERSION; });
  if (!row) return { ok: false };
  p1Upsert("DailyOpsReport", "row_id", {
    row_id: row.row_id, student_email: studentEmail,
    finalized_at: new Date().toISOString(),
    snapshot_json: JSON.stringify(Object.assign({}, r.data, { narrative: undefined })).slice(0, 45000)
  });
  return { ok: true, score: r.data.displayed_score };
}

function getStatusSummary(studentEmail) {
  const status = computeAllStatuses()[studentEmail];
  if (!status) return { ok: true, data: null };
  return { ok: true, data: status };
}

function getReport(studentEmail, body) {
  const userRows = getFilteredRows("Reports", "student_email", studentEmail).sort((a, b) => b.date > a.date ? 1 : -1);
  const targetDate = (body && body.date) ? body.date : formatDate(new Date());
  const report = userRows.find(r => r.date === targetDate) || userRows[0];
  if (!report) return { ok: true, data: null };
  let breakdown = null;
  if (report.breakdown) { try { breakdown = JSON.parse(report.breakdown); } catch (e) {} }
  let breakdownReasons = null;
  if (report.breakdown_reasons) { try { breakdownReasons = JSON.parse(report.breakdown_reasons); } catch (e) {} }
  return { ok: true, data: { score: Number(report.score), breakdown: breakdown, breakdownReasons: breakdownReasons, feedback: report.feedback, action: report.action, highlights: report.highlights, improvement: report.improvement, date: report.date } };
}

// レポート行を保存（breakdown列は後付けのため動的にヘッダーを確保する）
// 第4引数 logCount: そのレポートが「何件の記録をもとに採点したか」を残す。
// 夜22時のレポート生成後に独り言などで記録を足した場合、この件数が実際とズレるので、
// 翌晩に作り直すべきだと判断できる（[[レポート再生成]]）。
function appendReportRow(targetDate, studentEmail, report, logCount) {
  const sheet = getSheet("Reports");

  // 同じ日付・同じ人のレポートが既にあれば、その行を上書きする。
  // 以前は常にappendRowで、作り直すと同じ日のレポートが二重に並んでしまっていた
  const data = sheet.getDataRange().getValues();
  const hdr = data[0];
  const dIdx = hdr.indexOf("date"), eIdx = hdr.indexOf("student_email");
  let newRow = -1;
  for (let i = 1; i < data.length; i++) {
    const rawD = data[i][dIdx];
    const rowD = rawD instanceof Date ? Utilities.formatDate(rawD, "Asia/Tokyo", "yyyy-MM-dd") : String(rawD);
    if (rowD === String(targetDate) && String(data[i][eIdx]) === studentEmail) { newRow = i + 1; break; }
  }
  const values = [targetDate, studentEmail, report.score, report.feedback, report.action, report.highlights, report.improvement, new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })];
  if (newRow === -1) {
    newRow = sheet.getLastRow() + 1;
    sheet.appendRow(values);
  } else {
    sheet.getRange(newRow, 1, 1, values.length).setValues([values]);
  }

  if (report.breakdown) {
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    let bIdx = headers.indexOf("breakdown");
    if (bIdx === -1) { bIdx = headers.length; sheet.getRange(1, bIdx + 1).setValue("breakdown"); }
    sheet.getRange(newRow, bIdx + 1).setValue(JSON.stringify(report.breakdown));
  }
  if (report.breakdown_reasons) {
    const headers2 = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    let rIdx = headers2.indexOf("breakdown_reasons");
    if (rIdx === -1) { rIdx = headers2.length; sheet.getRange(1, rIdx + 1).setValue("breakdown_reasons"); }
    sheet.getRange(newRow, rIdx + 1).setValue(JSON.stringify(report.breakdown_reasons));
  }
  // 小数まで残す（同点が並んだときの並び順に使う。画面には整数を出す）
  if (report.score_precise != null) {
    const headersP = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    let pIdx = headersP.indexOf("score_precise");
    if (pIdx === -1) { pIdx = headersP.length; sheet.getRange(1, pIdx + 1).setValue("score_precise"); }
    sheet.getRange(newRow, pIdx + 1).setValue(Number(report.score_precise));
  }
  if (logCount != null) {
    const headers3 = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    let cIdx = headers3.indexOf("log_count");
    if (cIdx === -1) { cIdx = headers3.length; sheet.getRange(1, cIdx + 1).setValue("log_count"); }
    sheet.getRange(newRow, cIdx + 1).setValue(Number(logCount));
  }
  try {
    // ランキングキャッシュはcohortごとに分かれているため、書き込んだ本人のcohortのキーを消す
    const au = sheetToObjects(getSheet("Users")).find(u => u.student_email === studentEmail);
    const ck = "ranking_scores_v5_" + (String((au && au.cohort) || "").trim() || "main");
    CacheService.getScriptCache().remove(ck);
  } catch (e) { /* ignore */ }
  try { postHighScoreAchievement(studentEmail, report.score); } catch (e) { /* ignore */ }
  // ★爆速ジロー★ 90点以上が何日続いているかを数え直して置く（足し算ではない）。
  //   レポートは作り直されることがあるので、そのつど正しい連続数にそろえる。
  try {
    const runs = jiroHighScoreRun_(sheet, studentEmail, String(targetDate));
    jiroBumpUser_(studentEmail, {}, { hiscore7: runs });
  } catch (e) { /* 図鑑が更新できなくてもレポートは成功させる */ }
}

// Reports から、その日を末尾とする「90点以上の連続日数」を数える。
function jiroHighScoreRun_(sheet, studentEmail, endDate) {
  const data = sheet.getDataRange().getValues();
  const hdr = data[0];
  const dIdx = hdr.indexOf("date"), eIdx = hdr.indexOf("student_email"), sIdx = hdr.indexOf("score");
  if (dIdx === -1 || sIdx === -1) return 0;
  const byDate = {};
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][eIdx]) !== studentEmail) continue;
    const raw = data[i][dIdx];
    const d = raw instanceof Date ? Utilities.formatDate(raw, "Asia/Tokyo", "yyyy-MM-dd") : String(raw).slice(0, 10);
    byDate[d] = Number(data[i][sIdx] || 0);
  }
  let run = 0;
  let cur = new Date(endDate + "T00:00:00+09:00");
  for (let n = 0; n < 400; n++) {
    const key = Utilities.formatDate(cur, "Asia/Tokyo", "yyyy-MM-dd");
    if (byDate[key] === undefined || byDate[key] < 90) break;
    run++;
    cur.setDate(cur.getDate() - 1);
  }
  return run;
}

// student_email・dateで先に絞り込んでから必要な行だけをオブジェクト化する。
// sheetToObjects()でシート全体を毎回フル変換すると、記録数が増えるほど
// 遅くなるため、対象外の行の変換コストを避けている。
function getLogs(studentEmail, body) {
  const sheet = getSheet("DailyLog");
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const emailIdx = headers.indexOf("student_email");
  const dateIdx = headers.indexOf("date");
  const idx = {
    log_id: headers.indexOf("log_id"),
    time_block: headers.indexOf("time_block"),
    task: headers.indexOf("task"),
    focus_level: headers.indexOf("focus_level"),
    memo: headers.indexOf("memo"),
    goal_related: headers.indexOf("goal_related"),
    actual_minutes: headers.indexOf("actual_minutes"),
    duration_confirmed: headers.indexOf("duration_confirmed"),
    link_task_id: headers.indexOf("link_task_id"),
    time_classification: headers.indexOf("time_classification"),
    classification_method: headers.indexOf("classification_method"),
    classification_reason_code: headers.indexOf("classification_reason_code"),
  };
  const targetDate = (body && body.date) ? body.date : formatDate(new Date());

  const logs = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][emailIdx]) !== studentEmail) continue;
    const rawDate = data[i][dateIdx];
    const rowDate = rawDate instanceof Date
      ? Utilities.formatDate(rawDate, "Asia/Tokyo", "yyyy-MM-dd")
      : String(rawDate);
    if (rowDate !== targetDate) continue;
    logs.push({
      log_id: String(data[i][idx.log_id] || ""),
      time_block: String(data[i][idx.time_block] || ""),
      task: String(data[i][idx.task] || ""),
      focus_level: String(data[i][idx.focus_level] || ""),
      memo: String(data[i][idx.memo] || ""),
      goal_related: String(data[i][idx.goal_related] || "false"),
      // 時間の内訳・分類チップ用（列が無い環境では空で返る）
      actual_minutes: idx.actual_minutes === -1 ? "" : String(data[i][idx.actual_minutes] || ""),
      duration_confirmed: idx.duration_confirmed === -1 ? "" : String(data[i][idx.duration_confirmed] || ""),
      link_task_id: idx.link_task_id === -1 ? "" : String(data[i][idx.link_task_id] || ""),
      time_classification: idx.time_classification === -1 ? "" : String(data[i][idx.time_classification] || ""),
      classification_method: idx.classification_method === -1 ? "" : String(data[i][idx.classification_method] || ""),
      classification_reason_code: idx.classification_reason_code === -1 ? "" : String(data[i][idx.classification_reason_code] || ""),
    });
  }
  logs.sort((a, b) => a.time_block > b.time_block ? 1 : -1);
  return { ok: true, data: logs };
}

// 独り言（クイック記録）: 自由に話した/書いた一言をAIが構造化して、その場で記録する。
// 「通知が来たらすぐ、話すだけで終わる」体験のため、時間帯・タスク・集中度の仕分けを
// 全部AIに任せる。既存のsaveLogの保存経路（カレンダー書き戻し・XP等）にそのまま乗せる
// ── AI利用量の記録（クレジット消費の見える化）──
// Anthropic APIの応答には model と usage(入出力トークン数) が含まれるため、
// 応答オブジェクトを渡すだけで「いつ・どの機能・どのモデル・何トークン・いくら」を
// AiUsageシートに記録できる。非Anthropic応答(usage無し)は静かに無視する
var AI_PRICE_PER_MTOK = { // [入力$/100万tok, 出力$/100万tok]
  "claude-opus-4-8": [5, 25],
  "claude-sonnet-5": [3, 15],
  "claude-haiku-4-5-20251001": [1, 5]
};
function logAiUsage(result, feature) {
  try {
    if (!result || !result.usage || !result.model) return;
    var model = String(result.model);
    if (model.indexOf("claude") !== 0) return;
    var sheet = getSheet("AiUsage");
    if (!sheet) { sheet = getSpreadsheet().insertSheet("AiUsage"); sheet.appendRow(["date", "time", "feature", "model", "input_tokens", "output_tokens", "cost_usd"]); }
    var inTok = Number(result.usage.input_tokens) || 0, outTok = Number(result.usage.output_tokens) || 0;
    // モデルIDが日付付き等でも前方一致で価格を引く
    var p = null;
    for (var k in AI_PRICE_PER_MTOK) { if (model.indexOf(k) === 0) { p = AI_PRICE_PER_MTOK[k]; break; } }
    if (!p) p = [3, 15];
    var cost = inTok / 1e6 * p[0] + outTok / 1e6 * p[1];
    sheet.appendRow([formatDate(new Date()), new Date().toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo" }), feature || "", model, inTok, outTok, cost]);
  } catch (e) { /* 記録失敗で本処理を止めない */ }
}
// 今日・今月のAI費用と内訳（機能別・モデル別）を集計して返す
function getAiUsageSummary() {
  var sheet = getSheet("AiUsage");
  var empty = { today: 0, month: 0, lastMonth: 0, byFeature: {}, byModel: {}, count: 0, lastMonthCount: 0, lastMonthLabel: "" };
  if (!sheet) return empty;
  var rows = sheetToObjects(sheet);
  var today = formatDate(new Date()), month = today.slice(0, 7);
  // 先月分も集計する。月初は今月のデータがまだ無く、費用が丸ごと
  // 見えなくなっていた（一番知りたいタイミングで消えていた）
  var pd = new Date(today + "T00:00:00Z"); pd.setUTCDate(0);
  var lastMonth = pd.toISOString().slice(0, 7);

  var t = 0, m = 0, lm = 0, byF = {}, byM = {}, cnt = 0, lmCnt = 0;
  var lmF = {};
  rows.forEach(function (r) {
    var d = String(r.date), c = Number(r.cost_usd) || 0;
    var ym = d.slice(0, 7);
    var f = String(r.feature || "その他") || "その他";
    if (ym === lastMonth) { lm += c; lmCnt++; lmF[f] = (lmF[f] || 0) + c; return; }
    if (ym !== month) return;
    m += c; cnt++;
    byF[f] = (byF[f] || 0) + c;
    var mo = String(r.model || "").replace("claude-", "").replace("-20251001", "");
    byM[mo] = (byM[mo] || 0) + c;
    if (d === today) t += c;
  });
  return { today: t, month: m, lastMonth: lm, byFeature: byF, byModel: byM,
           count: cnt, lastMonthCount: lmCnt, lastMonthByFeature: lmF, lastMonthLabel: lastMonth };
}

// ユーザー起点のAI機能の回数制限（クレジットの暴走消費を防ぐ安全弁）。
// 6時間窓のカウンタで、上限到達時はtrueを返す。上限は通常利用に影響しない余裕をもたせる
function aiCapExceeded(feature, email, limitPer6h) {
  try {
    var c = CacheService.getScriptCache();
    var k = "aicap_" + feature + "_" + String(email || "");
    var n = Number(c.get(k) || 0);
    if (n >= limitPer6h) return true;
    c.put(k, String(n + 1), 21600);
    return false;
  } catch (e) { return false; }
}

function quickLog(studentEmail, body) {
  // 自己経営力は計算に時間がかかるので取っておいている。書き換えたら
  // 古い結果に当たらないよう世代を進める（2026-08-05）。
  smpBumpEpoch_(studentEmail);
  const text = String(body.text || "").trim();
  if (!text) return { ok: false, error: "何をしたか一言だけ教えてください" };
  const apiKey = PropertiesService.getScriptProperties().getProperty("CLAUDE_API_KEY");
  if (!apiKey) return { ok: false, error: "CLAUDE_API_KEY未設定" };

  const now = new Date();
  const hour = now.getHours();
  const pad2 = (n) => String(n).padStart(2, "0");
  const curBlock = pad2(hour) + ":00";
  const nowStr = pad2(hour) + ":" + pad2(now.getMinutes());
  // ★1日の区切りは深夜4時★（2026-08-05 Kai要望）
  //   午前2時55分に「3時間前から作業していた」と話すと、暦の上では前日23時台になる。
  //   そのまま前日へ書くと、20時〜23時と23時〜翌1時が別々の日に割れてしまい、
  //   ひと続きの夜の作業が2日に分断されていた。
  //   深夜0時〜4時は「前の日の続き」として、同じ日付にまとめる。
  const today = logicalToday_(now);

  const user = sheetToObjects(getSheet("Users")).find(u => u.student_email === studentEmail);
  const goalsText = user ? effectiveGoalsText(user.student_email, user) : "";

  // 今日すでに記録済みの「最後の終了時刻」を出す。「これまで/さっきから」と話した時に、
  // 直近の記録の終わり〜今 の空白を、その内容で自動で埋めるための起点にする。
  // 範囲キー("HH:MM-HH:MM")は終了側、開始のみ("HH:MM")は1時間枠として+1時間を終わりとみなす。
  const blockEnd = (tb) => {
    const s = String(tb || "");
    const mr = s.match(/-(\d{1,2}):(\d{2})$/);
    if (mr) return pad2(Number(mr[1])) + ":" + mr[2];
    const ms = s.match(/^(\d{1,2}):(\d{2})/);
    if (ms) return pad2((Number(ms[1]) + 1) % 24) + ":" + ms[2];
    return null;
  };
  let lastEnd = null;
  sheetToObjects(getSheet("DailyLog"))
    .filter(l => l.student_email === studentEmail && l.date === today)
    .forEach(l => {
      const e = blockEnd(l.time_block);
      // 「今以前で最も遅い終了」を起点にする（後ろ/未来の記録には引きずられない）
      if (e && e <= nowStr && (!lastEnd || e > lastEnd)) lastEnd = e;
    });

  const prompt = `ユーザーが「今日どう過ごしたか」を話し言葉でつぶやきました。これを時間記録に構造化してください。
1つの活動だけなら1件でOKですが、1日の出来事をまとめて話している場合は、語られた活動を漏れなく全て別々の記録にしてください（件数の上限を気にせず、話に出てきた分だけ作る）。
「誰に会ったか」「何時に何をしたか」など具体的な情報が入っていれば、それも記録に活かしてください。話に出てきたことを勝手に省略・要約して捨てないこと。

【つぶやき】
${text}

【現在時刻】${hour}時
【この人の目標】${goalsText || "未設定"}

【各記録の作り方】
- time: その活動の「開始時刻」を "HH:MM"（24時間）で。ユーザーは“記録ボタンを押した今この瞬間(${nowStr})”に話している。${lastEnd ? "今日はすでに " + lastEnd + " まで記録済み。" : "今日はまだ記録がない。"}次のルールを厳密に守る：
  ${lastEnd ? "・「これまで」「さっきから」「ずっと」など、開始時刻を言わずに“前回の記録のあとから今まで”を通しで話している場合は、time=" + lastEnd + "（直近の記録の終わり）、end=" + nowStr + "（今）の1件にして、その間ずっとその活動をしていたとみなす。ただしその間の個別の時刻を言っていれば、それぞれの時刻を優先する。" : "・時刻を言わず「これまで/さっきから」と話した場合は、time・endを現在時刻(" + nowStr + ")付近にする。"}
  ・「◯時から今まで／今の時間まで／今に至るまで」のように開始時刻を言い、今この瞬間まで続いていると話している場合は、time=その開始時刻、end=${nowStr}（今）にする。endを空にしないこと。例：「13時から今の時間まで相談していた」→ time=13:00, end=${nowStr}。
  ・分の言い方はそのまま使う。「8時半」→:30、「9時15分」→:15。
  ・午前/午後が明示（朝・午前・昼・午後・夕方・夜 など）されていれば必ずそれに従う。「朝11時」→11:00、「夜11時」→23:00、「昼の1時」→13:00、「夕方5時」→17:00。
  ・午前/午後の明示がない「◯時」（H=1〜12）は、H時 と (H+12)時 のうち“押した今の時刻(${hour}時)に近い方”を選ぶ。例：今が${hour}時なら、これを最優先で当てはめる。「今23時で『11時』」→11と23では23が近いので23:00。「今9時で『11時』」→11:00。「今14時で『2時』」→14:00。
  ・ただし、明らかに1日を順に振り返っている（朝起きて→昼→夜…と複数の出来事を時系列で話している）場合だけは、その流れに沿った自然な時刻にする。
  ・時刻を言っていない活動は、勝手に別の時間を作らない。直前に時刻が分かっている活動の"続き"として、その時刻より後ろの妥当な時刻に置く（話した順番を守る）。時刻が一切なく「今・さっき」なら現在時刻(${String(hour).padStart(2,"0")}:00)。
  ・記録は必ず開始時刻の早い順に並べる。開始時刻が完全に同じ活動だけ1件にまとめる。
- end: 終了時刻を "HH:MM"（24時間）で。ユーザーが「◯時から◯時（まで）」「◯時半まで」のように終了時刻もはっきり言った場合だけ入れる（例「9時から9時半」→ time=09:00, end=09:30）。終了を言っていなければ空文字 "" にする。timeと同じ午前/午後・「今に近い方」の判断をendにも同じように適用し、end は必ず time より後にする。
- task: その活動が何だったかを“一文”で要約する（記録一覧の「何をしましたか」に入る見出し）。例「カフェで企画書を書いて集中できた」「友達とランチして部活の話をした」。長すぎず1文で。
- focus_level: 本人の手応えから1〜5（5=完璧 / 4=よくできた / 3=まあまあ / 2=もう少し / 1=全然だめ）。読み取れなければ3
- memo: その活動についてユーザーが話した言葉を、省略・要約・言い換えをせず“そのまま全部”入れる。感情や細かい描写も落とさない。つぶやきに出てきた内容は、必ずどれかの記録のmemoに全て含める（何ひとつ捨てない）。
- goal_related: 上の目標に関連していそうなら true、そうでなければ false

以下のJSON形式のみで返してください（説明不要）。値の中で引用が必要なら「」を使い半角"は使わない。各値は改行しない:
{ "records": [ { "time": "HH:MM", "end": "HH:MM または空", "task": "...", "focus_level": 3, "memo": "...", "goal_related": false } ] }`;

  // AI呼び出し〜解析は失敗しても入力を落とさない。例外・非JSON・レート制限・
  // 解析失敗のいずれでも、後段のフォールバックでつぶやき全文を必ず保存する。
  // 回数上限(6時間で20回)超過時はAIを呼ばず、フォールバック(全文保存)に直行する
  // →記録は絶対に失わず、クレジットの暴走消費だけを防ぐ
  let records = null;
  if (aiCapExceeded("quickLog", studentEmail, 20)) {
    Logger.log("quickLog: 回数上限のためAI整形をスキップ " + studentEmail);
  } else try {
    const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      payload: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 8000, messages: [{ role: "user", content: prompt }] }),
      muteHttpExceptions: true
    });
    const result = JSON.parse(res.getContentText()); logAiUsage(result, "独り言");
    if (result && result.content && result.content[0]) {
      const parsed = parseAiJson(result.content[0].text);
      // records配列が基本だが、単一オブジェクトで返ってきた場合も受ける
      if (parsed && Array.isArray(parsed.records) && parsed.records.length > 0) records = parsed.records;
      else if (parsed && parsed.task) records = [parsed];
    } else {
      Logger.log("quickLog: AI応答にcontentなし body=" + res.getContentText().slice(0, 300));
    }
  } catch (e) {
    Logger.log("quickLog AI例外: " + e);
  }

  // ★取りこぼし防止フォールバック：AIで構造化できなくても、つぶやき全文を
  // memoに残した1件を現在時刻で必ず保存する（入力が消えることをなくす）
  let usedFallback = false;
  if (!records || records.length === 0) {
    usedFallback = true;
    const shortTask = text.length <= 18 ? text : text.slice(0, 18) + "…";
    records = [{ time: curBlock, task: shortTask, focus_level: 3, memo: text, goal_related: false }];
  }

  const FOCUS_LABELS = { 1: "1 — 全然だめだった", 2: "2 — もう少しだった", 3: "3 — まあまあだった", 4: "4 — よくできた", 5: "5 — 完璧にできた" };
  // "08:30" / "8時30分" / "8時半"(=30) / "8" などから "HH:MM" を作る。
  // 分まで言っていない場合は :00。範囲外は現在時刻/0分に丸める。
  const normTime = (t) => {
    const s = String(t || "");
    let h, min;
    const half = /時半/.test(s);
    const m = s.match(/(\d{1,2})\s*[:：時]\s*(\d{1,2})?/) || s.match(/(\d{1,2})/);
    h = m ? Number(m[1]) : hour;
    min = (m && m[2] != null && m[2] !== "") ? Number(m[2]) : (half ? 30 : 0);
    if (isNaN(h) || h < 0 || h > 23) h = hour;
    if (isNaN(min) || min < 0 || min > 59) min = 0;
    return String(h).padStart(2, "0") + ":" + String(min).padStart(2, "0");
  };

  // ★メモ全文保証：AIがmemoを要約/省略してしまった疑いがある（全memoの合計が
  // 元の発話よりかなり短い）場合は、取りこぼし防止に発話全文をいちばん早い記録へ添える。
  if (!usedFallback && records.length > 0) {
    const noSpace = (s) => String(s || "").replace(/[\s　]/g, "");
    const memoLen = records.reduce((n, r) => n + noSpace(r.memo).length, 0);
    if (memoLen < noSpace(text).length * 0.6) {
      // 開始時刻がいちばん早い記録を選び、そこに全文を添える（重複に見えないよう見出しを付ける）
      let target = records[0], best = normTime(records[0].time);
      records.forEach((r) => { const t = normTime(r.time); if (t < best) { best = t; target = r; } });
      target.memo = (target.memo ? String(target.memo) + "\n\n" : "") + "【話した内容（全文）】\n" + text;
    }
  }

  // ★時刻の「今に寄せる」確定処理（AIが従いきれないので最終的にコードで補正）。
  // 短いつぶやきで、朝/昼/夜などの午前午後マーカーが一切ない場合だけ、曖昧な「◯時」を
  // 「押した今の時刻に近い方（H時 か H+12時）」へスナップする。
  // 1日を順に振り返る話（3件以上）や、朝/夜など明示がある話は対象外（そのまま尊重）。
  const hasAmPmMarker = /朝|午前|昼|午後|夕方|夕|夜|晩|深夜|未明|正午/.test(text);
  const shouldSnap = !hasAmPmMarker && records.length <= 2;
  const snapHourToNow = (tb) => {
    if (!shouldSnap) return tb;
    const h = parseInt(tb.slice(0, 2), 10);
    const mm = tb.slice(3);
    if (isNaN(h) || h < 1 || h > 12) return tb; // 13時以降など既に24時間表記なら触らない
    const c1 = h === 12 ? 12 : h;
    const c2 = h === 12 ? 0 : h + 12;
    const near = Math.abs(hour - c1) <= Math.abs(hour - c2) ? c1 : c2;
    return String(near).padStart(2, "0") + ":" + mm;
  };

  const saved = [];
  let totalXp = 0, lastLevel = null, leveled = false;
  // 1日分をまとめて話す人にも対応するため件数の上限は事実上設けない。
  // 60件は1日24時間を分単位で分けても十分収まる安全弁（暴走・実行時間の保険）
  records.slice(0, 60).forEach(function (r) {
    const fnum = Math.max(1, Math.min(5, Number(r.focus_level) || 3));
    // 終了時刻がある＝「◯時から◯時」や「これまで通し」の範囲。言われた時刻をそのまま尊重し、
    // タイマー記録と同じ "HH:MM-HH:MM" キーで保存（スナップは掛けない）。
    // 終了が無い＝単発。曖昧な「◯時」だけは「今に近い方」へスナップする。
    const endRaw = String(r.end || "").trim();
    let tb;
    if (endRaw) {
      const startTb = normTime(r.time);
      const endTb = normTime(endRaw);
      tb = (endTb > startTb) ? startTb + "-" + endTb : startTb;
    } else {
      // 終了が無い＝単発。ただし「◯時から今まで／今の時間まで／今に至るまで」のように
      // “今この瞬間まで続いている”と話している場合は、終端を現在時刻(${nowStr})にして
      // 範囲(HH:MM-現在)で保存する。AIがend=空で返しても、コード側で必ず補正する。
      // （例：「13時から今の時間まで相談していた」→ 13:00-現在。以前は13:00の点だけになっていた）
      const startTb = snapHourToNow(normTime(r.time));
      const impliesNow = /今まで|今の時間|今現在|現在まで|今に至|今も続|今日の今|さっきから|これまで|ずっと/.test(String(r.memo || "") + " " + String(r.task || ""));
      tb = (impliesNow && startTb < nowStr) ? startTb + "-" + nowStr : startTb;
    }
    // ★深夜に話した「昨夜のこと」は、昨日の記録にする★（2026-08-05 Kaiの当初の指摘）
    //   午前2時に「20時から23時まで作業した」と話すのは、まず昨夜の話。
    //   暦の日付をそのまま使うと今日の記録になり、
    //   20時〜23時 と 23時〜翌1時 が2日に割れてしまう。
    //   ・いまが早朝（5時より前）で
    //   ・話している開始時刻が昼以降（12時以降）なら
    //   その記録だけ前の日に付ける。「1時から作業した」のような
    //   深夜そのものの話は、今日のままにする。
    const startH = parseInt(String(tb).slice(0, 2), 10);
    const recDate = (hour < 5 && startH >= 12)
      ? formatDate(new Date(new Date(today + "T00:00:00+09:00").getTime() - 86400000))
      : today;
    const sr = saveLog(studentEmail, {
      date: recDate,
      time_block: tb,
      task: String(r.task || "記録").slice(0, 60),
      focus_level: FOCUS_LABELS[fnum],
      memo: String(r.memo || "").slice(0, 3000),
      goal_related: r.goal_related === true ? "true" : "false"
    });
    if (sr.ok) {
      saved.push({ time_block: tb, date: recDate, task: r.task, focus_level: fnum, goal_related: r.goal_related === true });
      if (sr.xp_gained) totalXp += sr.xp_gained;
      if (sr.level_up) { leveled = true; lastLevel = sr.level; }
    }
  });

  if (saved.length === 0) return { ok: false, error: "記録の保存に失敗しました。もう一度お試しください" };
  // 複数件の時は先頭を代表として返しつつ、件数も返す（フロントのトースト用）
  return {
    ok: true,
    count: saved.length,
    saved: saved[0],
    savedAll: saved,
    fallback: usedFallback,   // AI解析に失敗し、全文をそのまま1件保存した場合true
    xp_gained: totalXp, level_up: leveled, level: lastLevel
  };
}

// サーバー(Kai権限)から、記録をKaiのGoogleカレンダーへ直接書き込む。
// 全ての記録経路(フォーム/タイマー/独り言)はsaveLog/saveLogMultiを通るので、ここで書けば
// 端末・OAuthトークン・タイミング・iOSの制限に一切依存せず確実に反映される。
// Web appはUSER_DEPLOYING(=Kai)で動くため、Kai自身がアクセスできるカレンダーにのみ書ける
// （他ユーザーのカレンダーはgetCalendarByIdがnullになりスキップ＝従来のクライアント書き込みに任せる）。
var _ownerCalCache = {}, _ownerCalIdByEmail = {};
// ★分類ごとのカレンダー色（サーバー書き込み側）★（2026-08-05 Kai指摘）
//   画面側(index.html)の CAL_COLOR_BY_CLASS と同じ色になるようにそろえること。
//   Kaiのようにサーバーから直接書き込む人は、画面側の書き込みを丸ごと止めている。
//   そのためサーバー側にも同じ色分けを入れないと、その人だけ全部灰色のままになる。
//   （CalendarAppのEventColorは、APIのcolorIdと同じ並び）
// 色ID（"1".."11"）で持つ対応表。CalendarEvent.getColor() はこの形で返すので、
// 「いまの色」と比べるにはこちらが要る。ownerCalColor_ と必ず同じ色にすること。
var OWNER_CAL_COLOR_ID = {
  GOAL_DIRECT:           "9",   // Blueberry 青
  ASSET_BUILD:           "3",   // Grape     紫
  RECOVERY:              "2",   // Sage      緑
  RELATIONSHIP:          "5",   // Banana    橙寄りの黄
  RECOVERY_RELATIONSHIP: "2",
  OPERATIONS:            "7",   // Peacock   水色
  UNPLANNED_LEAKAGE:     "8"    // Graphite  灰
};
function ownerCalColorId_(cls) {
  return OWNER_CAL_COLOR_ID[String(cls || "").toUpperCase()] || "1";   // 未分類は Lavender
}

function ownerCalColor_(cls) {
  var C = CalendarApp.EventColor;
  switch (String(cls || "").toUpperCase()) {
    // アプリの色に合わせる（2026-08-05 Kai要望）。index.html の CAL_COLOR_BY_CLASS と対。
    case "GOAL_DIRECT":           return C.BLUE;        // 9 Blueberry 青 ── 目標に直結
    case "ASSET_BUILD":           return C.MAUVE;       // 3 Grape     紫 ── 将来への投資
    case "RECOVERY":              return C.PALE_GREEN;  // 2 Sage      緑 ── 回復
    case "RELATIONSHIP":          return C.YELLOW;      // 5 Banana    橙寄りの黄 ── 人間関係
    case "RECOVERY_RELATIONSHIP": return C.PALE_GREEN;  // 旧分類（書き換えない昔の記録）
    case "OPERATIONS":            return C.CYAN;        // 7 Peacock   水色 ── 日常業務
    case "UNPLANNED_LEAKAGE":     return C.GRAY;        // 8 Graphite  灰 ── 計画外の時間
    default:                      return C.PALE_BLUE;   // 1 Lavender ── まだ分類していない
  }
}

// ★カレンダー書き込みを後回しにする★（2026-08-05 Kai報告）
//   保存のたびにカレンダーAPIを叩くと1〜3秒かかり、記録ボタンの待ち時間が
//   そのぶん延びていた。予定は少し遅れて入っても困らないので、
//   いったん控えておき、1分おきの処理でまとめて書く。
function queueOwnerCalendarWrite_(studentEmail, dateStr, timeBlock, task, cls) {
  if (!String(task || "").trim()) return;
  // ★鍵をかけて読み書きする★
  //   読んで→足して→書き戻す形なので、2人が同時に保存すると
  //   片方の予定が消える。鍵が取れなければ、その場で書いて取りこぼさない。
  const lock = LockService.getScriptLock();
  let locked = false;
  try { locked = lock.tryLock(5000); } catch (e) { locked = false; }
  if (!locked) {
    try { writeRecordToOwnerCalendar(studentEmail, dateStr, timeBlock, task, cls); } catch (e2) {}
    return;
  }
  try {
    const props = PropertiesService.getScriptProperties();
    const key = "calq";
    let q = [];
    try { q = JSON.parse(props.getProperty(key) || "[]"); } catch (e) { q = []; }
    // 同じ人・同じ日・同じ時間帯のものは最新だけ残す
    q = q.filter(function (x) {
      return !(x.e === studentEmail && x.d === dateStr && x.t === timeBlock);
    });
    q.push({ e: studentEmail, d: dateStr, t: timeBlock, k: String(task).slice(0, 120), c: cls || "" });
    if (q.length > 200) q = q.slice(-200);   // 溜めすぎない
    props.setProperty(key, JSON.stringify(q));
  } catch (e) {
    try { writeRecordToOwnerCalendar(studentEmail, dateStr, timeBlock, task, cls); } catch (e2) {}
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// 控えておいたカレンダー書き込みをまとめて処理する（1分おきのトリガーから呼ぶ）
function flushOwnerCalendarQueue() {
  const props = PropertiesService.getScriptProperties();
  const lock = LockService.getScriptLock();
  // 取り出しも鍵をかける（取り出し中に足された分を落とさない）
  let locked = false;
  try { locked = lock.tryLock(10000); } catch (e) { locked = false; }
  if (!locked) return { ok: true, done: 0, note: "他の処理が使用中。次の回に回す" };
  let q = [];
  try {
    try { q = JSON.parse(props.getProperty("calq") || "[]"); } catch (e) { q = []; }
    if (q.length) props.setProperty("calq", "[]");   // 先に空にする（二重に書かないため）
  } finally { try { lock.releaseLock(); } catch (e) {} }
  if (!q.length) return { ok: true, done: 0 };
  const start = Date.now();
  let done = 0;
  const rest = [];
  q.forEach(function (x) {
    if (Date.now() - start > 4 * 60 * 1000) { rest.push(x); return; }
    try { writeRecordToOwnerCalendar(x.e, x.d, x.t, x.k, x.c); done++; }
    catch (err) { Logger.log("calq: " + err); }
  });
  if (rest.length) {
    let l2 = false;
    try { l2 = lock.tryLock(5000); } catch (e) { l2 = false; }
    try {
      let cur = [];
      try { cur = JSON.parse(props.getProperty("calq") || "[]"); } catch (e) { cur = []; }
      props.setProperty("calq", JSON.stringify(rest.concat(cur).slice(-200)));
    } finally { if (l2) { try { lock.releaseLock(); } catch (e) {} } }
  }
  return { ok: true, done: done, left: rest.length };
}

function writeRecordToOwnerCalendar(studentEmail, dateStr, timeBlock, task, cls) {
  try {
    if (!timeBlock || !String(task || "").trim()) return;
    var calId = _ownerCalIdByEmail[studentEmail];
    if (calId === undefined) {
      var user = getFilteredRows("Users", "student_email", studentEmail)[0];
      calId = (user && user.google_calendar_id) ? user.google_calendar_id : null;
      _ownerCalIdByEmail[studentEmail] = calId;
    }
    if (!calId) return;
    var cal = _ownerCalCache[calId];
    if (cal === undefined) { cal = CalendarApp.getCalendarById(calId) || null; _ownerCalCache[calId] = cal; }
    if (!cal) return;
    var parts = String(timeBlock).split("-");
    var pad = function (t) { t = String(t || "").slice(0, 5); return /^\d:\d\d$/.test(t) ? "0" + t : t; };
    var sHM = pad(parts[0]);
    if (!/^\d{2}:\d{2}$/.test(sHM)) return;
    var start = new Date(dateStr + "T" + sHM + ":00+09:00");
    if (isNaN(start.getTime())) return;
    var end;
    var eHM = parts[1] ? pad(parts[1]) : null;
    if (eHM && /^\d{2}:\d{2}$/.test(eHM)) { var e2 = new Date(dateStr + "T" + eHM + ":00+09:00"); end = (e2 > start) ? e2 : new Date(start.getTime() + 3600000); }
    else end = new Date(start.getTime() + 3600000);
    var title = "✔️ " + String(task).slice(0, 120);
    // 同じ開始時刻のJIROKU記録イベントがあれば更新、無ければ新規作成（重複防止）。
    // 判定はタグだけに頼らない：クライアント(API)書き込みの目印(private extendedProperties)は
    // CalendarAppのgetTagで読めないため、タイトルが✔️/✅始まりの「JIROKU記録イベント」も
    // 同一視する。これを怠ると、旧方式で書いた記録に気づけず二重登録になる（実際に発生した）
    var isJirokuEvent = function (ev) {
      if (ev.getTag("jirokuRecord") === "1") return true;
      var t = String(ev.getTitle() || "");
      return t.indexOf("✔️") === 0 || t.indexOf("✅") === 0;
    };
    var existing = cal.getEvents(start, new Date(start.getTime() + 60000)).filter(function (ev) {
      return isJirokuEvent(ev) && Math.abs(ev.getStartTime().getTime() - start.getTime()) < 1000;
    });
    if (existing.length) {
      existing[0].setTitle(title);
      try { existing[0].setTime(start, end); } catch (e) {}
      try { existing[0].setColor(ownerCalColor_(cls)); } catch (e) {}
      // 同じ開始時刻のJIROKU記録が既に複数ある＝過去の二重登録。1件だけ残して掃除する
      for (var _di = 1; _di < existing.length; _di++) { try { existing[_di].deleteEvent(); } catch (e) {} }
    } else {
      var ev = cal.createEvent(title, start, end);
      try { ev.setTag("jirokuRecord", "1"); } catch (e) {}
      // 分類ごとの色をつける（未分類はこれまでどおり灰色）
      try { ev.setColor(ownerCalColor_(cls)); } catch (e) {}
    }
  } catch (err) { Logger.log("writeRecordToOwnerCalendar: " + err); }
}

// KaiのアクセスできるJIROKU記録イベント(✔️/✅始まり or タグ付き)の重複を、
// 「全カレンダー横断」で掃除する。旧方式(ブラウザ)はログイン中アカウントのメイン
// カレンダーへ、新方式(サーバー)はUsersシートのgoogle_calendar_idへ書いており、
// これが別カレンダーだと同じ記録が2つのカレンダーに跨って重複する。
// 同一判定＝「開始時刻(分)＋タイトル」。残す優先度は google_calendar_id 内 ＞ その他。
// 通常の予定(✔️/✅なし・タグなし)には一切触らない
function dedupeOwnerJirokuEvents(days) {
  var admin = adminEmail();
  var u = getFilteredRows("Users", "student_email", admin)[0];
  var primaryCalId = (u && u.google_calendar_id) ? u.google_calendar_id : null;
  var from = new Date(); from.setDate(from.getDate() - (days || 7)); from.setHours(0, 0, 0, 0);
  var to = new Date(); to.setDate(to.getDate() + 1); to.setHours(0, 0, 0, 0);
  // 「✔️」は ✔(U+2714)＋飾り記号(U+FE0F) の2文字。経路によって飾り記号が
  // 付いたり落ちたりして「✔️」と「✔」が別文字列になり、重複判定をすり抜けていた。
  // 飾り記号を除去してから判定・比較する
  var stripVS = function (s) { return String(s || "").replace(/\uFE0F/g, ""); };
  var isJiroku = function (ev) {
    if (ev.getTag("jirokuRecord") === "1") return true;
    var t = stripVS(ev.getTitle()).trim();
    return t.charAt(0) === "✔" || t.charAt(0) === "✅"; // ✔ or ✅
  };
  // 同一判定用にタイトルを正規化: 飾り記号除去→先頭のチェックマーク類と空白を除去
  var normTitle = function (s) {
    return stripVS(s).replace(/^[✔✅\s]+/, "").trim();
  };
  // 対象カレンダー: 登録カレンダー＋Kaiが所有する全カレンダー（重複回避のためIDで一意化）
  var cals = [], seenCal = {};
  var pushCal = function (c) { if (c && !seenCal[c.getId()]) { seenCal[c.getId()] = true; cals.push(c); } };
  if (primaryCalId) { try { pushCal(CalendarApp.getCalendarById(primaryCalId)); } catch (e) {} }
  // 所有だけでなく購読中の全カレンダーを見る（旧ブラウザ方式が別アカウントの
  // カレンダーへ書いていた場合、その片割れは所有外にあるため）。編集権限が無い
  // カレンダーのdeleteEventは例外になるだけで実害はない
  try { CalendarApp.getAllCalendars().forEach(pushCal); } catch (e) {}
  try { pushCal(CalendarApp.getDefaultCalendar()); } catch (e) {}

  var seen = {}, removed = 0, scanned = 0, perCal = [], debugList = [];
  // 残す優先度: google_calendar_id のカレンダーを先に走査（そこにある方を残す）
  cals.sort(function (a, b) { return (a.getId() === primaryCalId ? -1 : 0) - (b.getId() === primaryCalId ? -1 : 0); });
  cals.forEach(function (cal) {
    var evs;
    try { evs = cal.getEvents(from, to).filter(isJiroku); } catch (e) { return; }
    scanned += evs.length;
    var rem = 0;
    evs.forEach(function (ev) {
      var key = Math.floor(ev.getStartTime().getTime() / 60000) + "|" + normTitle(ev.getTitle());
      debugList.push(Utilities.formatDate(ev.getStartTime(), "Asia/Tokyo", "MM-dd HH:mm:ss") + " key=[" + key + "] id=" + String(ev.getId()).slice(0, 12) + " " + String(ev.getTitle() || "").slice(0, 30));
      if (seen[key]) { try { ev.deleteEvent(); removed++; rem++; } catch (err) {} }
      // ★残す予定の色は変えない★（2026-08-05）
      //   ここで灰色に塗り直していたため、毎朝この掃除が走るたびに
      //   分類ごとの色が消えていた。掃除は重複を消すだけにする。
      else { seen[key] = true; }
    });
    perCal.push(cal.getName() + ":" + evs.length + "件/削除" + rem);
  });
  // eventsは診断用（レスポンスが重くなるので通常運用のLINEレポート等では参照しない）
  return { ok: true, scanned: scanned, removed: removed, calendars: perCal, events: debugList.sort() };
}

// ★「いまはどの日として数えるか」★（2026-08-05）
//   深夜0時〜DAY_CUTOFF_HOUR_GAS時は、暦の上では新しい日だが、
//   本人の感覚では前の日の続きである。記録の日付・XP・連続記録は
//   すべてこの「1日」で数える。暦の日付をそのまま使うと、
//   夜通しの作業が2日に割れ、深夜の記録にXPが付かなくなる。
function logicalToday_(base) {
  const d = base ? new Date(base) : new Date();
  const h = Number(Utilities.formatDate(d, "Asia/Tokyo", "H"));
  return formatDate(h < DAY_CUTOFF_HOUR_GAS ? new Date(d.getTime() - 24 * 60 * 60 * 1000) : d);
}

function saveLog(studentEmail, body) {
  // 自己経営力は計算に時間がかかるので取っておいている。書き換えたら
  // 古い結果に当たらないよう世代を進める（2026-08-05）。
  smpBumpEpoch_(studentEmail);
  const sheet = getSheet("DailyLog");
  const today = logicalToday_();
  const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });

  // 対象日: 指定があれば過去日の編集も可（未来日は不可）
  let targetDate = today;
  if (body.date && /^\d{4}-\d{2}-\d{2}$/.test(String(body.date)) && String(body.date) <= today) {
    targetDate = String(body.date);
  }
  const isPast = targetDate !== today;

  // Upsert: 同じ日・同じ時間帯があれば更新
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const emailIdx = headers.indexOf("student_email");
  const dateIdx = headers.indexOf("date");
  const timeIdx = headers.indexOf("time_block");

  // 今日分のログ件数・バッジ判定用の集計をここで一度だけ行う（addXP/checkBadgesの
  // ストリークボーナス・バッジ判定用。DailyLogをこの後もう一度読み直さずに済ませる）
  const memoIdx = headers.indexOf("memo");
  let todaysLogCount = 0, totalLogs = 0, memoCount = 0;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][emailIdx]) !== studentEmail) continue;
    totalLogs++;
    if (String(data[i][memoIdx] || "").trim()) memoCount++;
    const raw = data[i][dateIdx];
    const rowDate = raw instanceof Date ? Utilities.formatDate(raw, "Asia/Tokyo", "yyyy-MM-dd") : String(raw);
    if (rowDate === today) todaysLogCount++;
  }

  // ★同じタイマーセッションを2行にしない★
  //   クライアントが開始時に決めた action_execution_id を冪等キーとして使う。
  //   再送・重複送信・一時停止後の再開（終了時刻が変わる）でも1行に収める。
  const execIdIn = String(body.action_execution_id || "").trim();
  const execIdx = headers.indexOf("action_execution_id");
  let matchRow = -1;
  if (execIdIn && execIdx !== -1) {
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][emailIdx]) !== studentEmail) continue;
      if (String(data[i][execIdx]) === execIdIn) { matchRow = i; break; }
    }
  }

  for (let i = 1; i < data.length; i++) {
    const rawDate = data[i][dateIdx];
    const rowDate = rawDate instanceof Date
      ? Utilities.formatDate(rawDate, "Asia/Tokyo", "yyyy-MM-dd")
      : String(rawDate);
    if (i === matchRow ||
        (matchRow === -1 && String(data[i][emailIdx]) === studentEmail &&
        rowDate === targetDate &&
        String(data[i][timeIdx]) === String(body.time_block))) {
      const focusIdx = headers.indexOf("focus_level");
      let awardedIdx = headers.indexOf("xp_awarded");
      if (awardedIdx === -1) { awardedIdx = headers.length; sheet.getRange(1, awardedIdx + 1).setValue("xp_awarded"); }
      const prevFocus = String(data[i][focusIdx] || "").trim();
      const newFocus = String(body.focus_level || "").trim();
      const flagRaw = String(data[i][awardedIdx] || "").toUpperCase();
      // xp_awardedフラグが未設定の古い記録は、既に評価が入っていれば「付与済み」とみなす
      // （デプロイ前からある記録が、編集で二重にXPをもらわないための移行措置）
      const prevAwarded = flagRaw === "TRUE" || (flagRaw === "" && !!prevFocus);
      // ★1セルずつ書かない★（2026-08-05 Kai報告「記録ボタンの待ち時間が長い」）
      //   setValue 1回ごとにシートへの往復が起きる。まとめて1回で書く。
      let grIdx = headers.indexOf("goal_related");
      if(grIdx === -1){ grIdx = headers.length; sheet.getRange(1, grIdx+1).setValue("goal_related"); }
      if (i === matchRow && String(data[i][timeIdx]) !== String(body.time_block)) {
        sheet.getRange(i + 1, timeIdx + 1).setNumberFormat("@");
      }
      const rowU = data[i].slice();
      rowU[timeIdx] = String(body.time_block);
      rowU[headers.indexOf("task")] = body.task;
      rowU[focusIdx] = body.focus_level;
      rowU[headers.indexOf("memo")] = body.memo || "";
      if (grIdx < rowU.length) rowU[grIdx] = body.goal_related || "false";
      sheet.getRange(i + 1, 1, 1, rowU.length).setValues([rowU]);
      // カレンダーへの書き込みは、記録の保存を待たせない（あとでまとめて処理する）
      queueOwnerCalendarWrite_(studentEmail, targetDate, String(body.time_block), body.task, body.time_classification);
      if (!isPast) { updateStreak(studentEmail); invalidateStatusCache(); }

      // 「まだXP未付与」かつ「今回きちんと評価が入っている」記録にだけ、1回だけXPを付与する。
      // 評価なしで保存→あとで評価を足した修正でも確実に付き、付与済みの記録は何度更新しても増えない
      if (!isPast && !prevAwarded && newFocus) {
        sheet.getRange(i+1, awardedIdx+1).setValue("TRUE");
        if (String(body.goal_related) === "true") incrementGoalBlocksAndNotify(studentEmail, 1);
        const xpResult = addXP(studentEmail, body.memo, todaysLogCount, {
          totalLogs, memoCount: memoCount + ((body.memo || "").trim() ? 1 : 0)
        }, String(data[i][0]));
        const jd1 = writeP1LogFields(sheet, i + 1, studentEmail, targetDate, String(body.time_block), body);
        const jr1 = jiroCollect_(studentEmail, jd1, false);
        return { ok: true, log_id: String(data[i][0]), updated: true, ...xpResult, jiro_gained: jr1.gained };
      }
      const jd2 = writeP1LogFields(sheet, i + 1, studentEmail, targetDate, String(body.time_block), body);
      const jr2 = jiroCollect_(studentEmail, jd2, false);
      return { ok: true, log_id: String(data[i][0]), updated: true, xp_gained: 0, jiro_gained: jr2.gained };
    }
  }

  const logId = "log_" + Date.now();
  const newRow = sheet.getLastRow() + 1;
  sheet.appendRow([logId, studentEmail, targetDate, "", body.task, body.focus_level, body.memo || "", now, body.goal_related || "false"]);
  sheet.getRange(newRow, 4).setNumberFormat("@").setValue(String(body.time_block));
  const jdNew = writeP1LogFields(sheet, newRow, studentEmail, targetDate, String(body.time_block), body);
  // 新しい記録なので、夜ふかしの判定もここで1回だけ行う
  if (!isPast && jiroIsNight_(body.time_block)) jdNew.night = (jdNew.night || 0) + 1;
  queueOwnerCalendarWrite_(studentEmail, targetDate, String(body.time_block), body.task, body.time_classification);
  let awardedIdxN = headers.indexOf("xp_awarded");
  if (awardedIdxN === -1) { awardedIdxN = headers.length; sheet.getRange(1, awardedIdxN + 1).setValue("xp_awarded"); }

  const newFocusN = String(body.focus_level || "").trim();
  // 過去日の後付け入力はストリーク・XPの対象外（後から稼げない）
  if (isPast) { sheet.getRange(newRow, awardedIdxN + 1).setValue("FALSE"); return { ok: true, log_id: logId, xp_gained: 0 }; }
  const jrNew = jiroCollect_(studentEmail, jdNew, false);

  updateStreak(studentEmail);
  invalidateStatusCache();
  // 評価が入っている記録だけ、その場でXPを付与して「付与済み」の印を付ける。
  // 評価なしで保存した場合は付与せず未付与のままにし、あとで評価を足した更新時に付与する
  if (!newFocusN) { sheet.getRange(newRow, awardedIdxN + 1).setValue("FALSE"); return { ok: true, log_id: logId, xp_gained: 0, jiro_gained: jrNew.gained }; }
  sheet.getRange(newRow, awardedIdxN + 1).setValue("TRUE");
  if (String(body.goal_related) === "true") incrementGoalBlocksAndNotify(studentEmail, 1);
  const xpResult = addXP(studentEmail, body.memo, todaysLogCount + 1, {
    totalLogs: totalLogs + 1,
    memoCount: memoCount + ((body.memo || "").trim() ? 1 : 0)
  }, logId);
  return { ok: true, log_id: logId, ...xpResult, jiro_gained: jrNew.gained };
}

// カレンダーから、その開始時刻のJIROKU記録イベントを消す。
// 時刻を直したときに、元の時刻の予定が置き去りになるのを防ぐ。
function removeOwnerCalendarEventAt_(studentEmail, dateStr, timeBlock) {
  try {
    var calId = _ownerCalIdByEmail[studentEmail];
    if (calId === undefined) {
      var user = getFilteredRows("Users", "student_email", studentEmail)[0];
      calId = (user && user.google_calendar_id) ? user.google_calendar_id : null;
      _ownerCalIdByEmail[studentEmail] = calId;
    }
    if (!calId) return;
    var cal = _ownerCalCache[calId];
    if (cal === undefined) { cal = CalendarApp.getCalendarById(calId) || null; _ownerCalCache[calId] = cal; }
    if (!cal) return;
    var pad = function (t) { t = String(t || "").slice(0, 5); return /^\d:\d\d$/.test(t) ? "0" + t : t; };
    var sHM = pad(String(timeBlock).split("-")[0]);
    if (!/^\d{2}:\d{2}$/.test(sHM)) return;
    var start = new Date(dateStr + "T" + sHM + ":00+09:00");
    if (isNaN(start.getTime())) return;
    cal.getEvents(start, new Date(start.getTime() + 60000)).forEach(function (ev) {
      var t = String(ev.getTitle() || "");
      var isJ = ev.getTag("jirokuRecord") === "1" || t.indexOf("\u2714") === 0 || t.indexOf("\u2705") === 0;
      if (isJ && Math.abs(ev.getStartTime().getTime() - start.getTime()) < 1000) {
        try { ev.deleteEvent(); } catch (err) {}
      }
    });
  } catch (e) { Logger.log("removeOwnerCalendarEventAt_: " + e); }
}

// ★記録の時刻を直す★（2026-08-05 Kai要望）
//   独り言やタイマーから自動で作られた記録は、時刻がずれていることがある。
//   これまでは「時間を細かく」で新しい時間を選ぶと、中身が空の別の記録が
//   増えるだけで、元の記録は残っていた（二重になる）。
//   ここでは中身をそのままに、時刻だけを動かす。
//   ・本人の記録だけ。
//   ・同じ日の他の記録と重なるときは断る（重なると集計が二重になる）。
//   ・実測（タイマーで測ったぶん）が入っていれば、新しい長さに合わせ直す。
//   ・カレンダーの予定も、元の時刻から新しい時刻へ動かす。
function updateLogTime(studentEmail, body) {
  smpBumpEpoch_(studentEmail);
  const chk = p1RequireUser(studentEmail);
  if (!chk.ok) return chk;

  const logId = String((body && body.log_id) || "").trim();
  const fromTb = String((body && body.time_block) || "").trim();
  let toTb = String((body && body.new_time_block) || "").trim().replace(/\s*-\s*/, "-");
  if (!logId && !fromTb) return { ok: false, error: "どの記録かが分かりません" };
  if (!/^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(toTb)) return { ok: false, error: "時刻の形式が正しくありません" };
  const pad2 = function (t) { const p = String(t).split(":"); return String(Number(p[0])).padStart(2, "0") + ":" + p[1]; };
  toTb = pad2(toTb.split("-")[0]) + "-" + pad2(toTb.split("-")[1]);
  const newMins = timeBlockMinutes(toTb);
  if (!(newMins > 0)) return { ok: false, error: "終わりの時刻が始まりより後になるようにしてください" };
  if (newMins > 16 * 60) return { ok: false, error: "1件の記録は16時間までにしてください" };

  const today = logicalToday_();
  let targetDate = today;
  if (body.date && /^\d{4}-\d{2}-\d{2}$/.test(String(body.date)) && String(body.date) <= today) {
    targetDate = String(body.date);
  }

  const sheet = getSheet("DailyLog");
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const iEm = headers.indexOf("student_email");
  const iDt = headers.indexOf("date");
  const iTb = headers.indexOf("time_block");
  const iId = headers.indexOf("log_id");
  const iAm = headers.indexOf("actual_minutes");
  const iTask = headers.indexOf("task");
  const iCls = headers.indexOf("time_classification");

  const rowDateOf = function (v) {
    return v instanceof Date ? Utilities.formatDate(v, "Asia/Tokyo", "yyyy-MM-dd") : String(v).slice(0, 10);
  };

  // 対象の行を探す（log_id 優先。無ければ 日付＋時間帯）
  let target = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][iEm]) !== studentEmail) continue;
    if (logId && iId !== -1 && String(data[i][iId]) === logId) { target = i; break; }
    if (!logId && rowDateOf(data[i][iDt]) === targetDate && String(data[i][iTb]) === fromTb) { target = i; break; }
  }
  if (target === -1) return { ok: false, error: "その記録が見つかりません" };

  const curDate = rowDateOf(data[target][iDt]);
  const curTb = String(data[target][iTb]);
  if (curTb === toTb) return { ok: true, unchanged: true, time_block: toTb };

  // ★重なりは断らない★（2026-08-05 Kaiの判断）
  //   もとは重なると集計が二重になるため断っていたが、
  //   実際には重ねて記録したい場面があるとのことなので通す。
  //   代わりに、重なっている相手を返して画面で知らせる。
  const span = function (tb) {
    const m = String(tb).match(/^(\d{1,2}):(\d{2})(?:-(\d{1,2}):(\d{2}))?$/);
    if (!m) return null;
    const st = Number(m[1]) * 60 + Number(m[2]);
    let en = (m[3] !== undefined) ? Number(m[3]) * 60 + Number(m[4]) : st + 60;
    if (en <= st) en += 1440;
    return { st: st, en: en };
  };
  const ns = span(toTb);
  const overlaps = [];
  for (let i = 1; i < data.length; i++) {
    if (i === target) continue;
    if (String(data[i][iEm]) !== studentEmail) continue;
    if (rowDateOf(data[i][iDt]) !== curDate) continue;
    const os = span(String(data[i][iTb]));
    if (!os) continue;
    if (ns.st < os.en && os.st < ns.en) overlaps.push(String(data[i][iTb]));
  }

  sheet.getRange(target + 1, iTb + 1).setValue(toTb);
  // 実測が入っている記録（タイマーで測ったもの）は、新しい長さに合わせ直す
  if (iAm !== -1 && Number(data[target][iAm]) > 0) {
    sheet.getRange(target + 1, iAm + 1).setValue(newMins);
  }

  // カレンダーの予定も動かす（元の時刻の予定を消してから、新しい時刻に書く）
  try {
    removeOwnerCalendarEventAt_(studentEmail, curDate, curTb);
    const task = iTask === -1 ? "" : String(data[target][iTask] || "");
    if (String(task).trim()) {
      writeRecordToOwnerCalendar(studentEmail, curDate, toTb, task,
        iCls === -1 ? "" : String(data[target][iCls] || ""));
    }
  } catch (e) { Logger.log("updateLogTime calendar: " + e); }

  try { invalidateStatusCache(); } catch (e) {}
  const linkIdx = headers.indexOf("link_task_id");
  const linkedTask = linkIdx === -1 ? "" : String(data[target][linkIdx] || "");
  if (linkedTask) { try { recomputeTaskActualMinutes_(studentEmail, linkedTask); } catch (e) {} }

  return { ok: true, date: curDate, from: curTb, time_block: toTb, minutes: newMins,
           overlaps: overlaps };
}

// 記録の削除。間違えて記録した時間帯を消せるようにする（編集画面で内容を空にして
// 更新＝この時間帯の記録を消す、という操作の受け皿）。該当行を1件だけ削除する。
function deleteLog(studentEmail, body) {
  // 自己経営力は計算に時間がかかるので取っておいている。書き換えたら
  // 古い結果に当たらないよう世代を進める（2026-08-05）。
  smpBumpEpoch_(studentEmail);
  const timeBlock = String(body.time_block || "");
  if (!timeBlock) return { ok: false, error: "no time_block" };
  const sheet = getSheet("DailyLog");
  const today = formatDate(new Date());
  let targetDate = today;
  if (body.date && /^\d{4}-\d{2}-\d{2}$/.test(String(body.date)) && String(body.date) <= today) targetDate = String(body.date);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const emailIdx = headers.indexOf("student_email");
  const dateIdx = headers.indexOf("date");
  const timeIdx = headers.indexOf("time_block");
  for (let i = data.length - 1; i >= 1; i--) {
    const rawDate = data[i][dateIdx];
    const rowDate = rawDate instanceof Date ? Utilities.formatDate(rawDate, "Asia/Tokyo", "yyyy-MM-dd") : String(rawDate);
    if (String(data[i][emailIdx]) === studentEmail && rowDate === targetDate && String(data[i][timeIdx]) === timeBlock) {
      const logId = String(data[i][headers.indexOf("log_id")] || "");
      sheet.deleteRow(i + 1);
      // ★消した記録で入ったXPだけを戻し、ストリークも実記録から計算し直す★
      //   「記録して XP をもらってから消す」で数字だけ残せてしまう問題への対処。
      //   台帳に無い（この仕組みより前の）XPには手を触れない ＝ 過剰に減らさない。
      const linkIdx = headers.indexOf("link_task_id");
      const linkedTask = linkIdx === -1 ? "" : String(data[i][linkIdx] || "");
      let xpRev = { reversed: 0, amount: 0 }, st = null;
      if (linkedTask) { try { recomputeTaskActualMinutes_(studentEmail, linkedTask); } catch (e) {} }
      try { xpRev = xpReverseForSource_(studentEmail, logId, "LOG_DELETED"); } catch (e) {}
      try { st = recomputeStreak_(studentEmail); } catch (e) {}
      try { invalidateStatusCache(); } catch (e) { /* ignore */ }
      return { ok: true, deleted: true, xp_reversed: xpRev.amount, streak: st ? st.after : null };
    }
  }
  return { ok: true, deleted: false };
}

// 複数の時間帯に同じ内容を一括保存する（2時間の会議などを1回の入力で記録）。
// DailyLogの読み込み・書き込みをこの関数内で1回にまとめ、ストリーク・XPも
// ブロック数ぶん繰り返さずリクエスト全体で1回だけ計算する
function saveLogMulti(studentEmail, body) {
  // 自己経営力は計算に時間がかかるので取っておいている。書き換えたら
  // 古い結果に当たらないよう世代を進める（2026-08-05）。
  smpBumpEpoch_(studentEmail);
  const blocks = String(body.time_blocks || "").split(",").map(s => s.trim()).filter(Boolean);
  if (blocks.length === 0) return { ok: false, error: "no blocks" };

  const sheet = getSheet("DailyLog");
  const data = sheet.getDataRange().getValues(); // 読み込みはここ1回だけ
  let headers = data[0];
  const idx = {
    email: headers.indexOf("student_email"), date: headers.indexOf("date"),
    time: headers.indexOf("time_block"), task: headers.indexOf("task"),
    focus: headers.indexOf("focus_level"), memo: headers.indexOf("memo"),
    logId: headers.indexOf("log_id"), timestamp: headers.indexOf("timestamp")
  };
  let goalIdx = headers.indexOf("goal_related");
  if (goalIdx === -1) {
    goalIdx = headers.length;
    sheet.getRange(1, goalIdx + 1).setValue("goal_related");
    headers = headers.concat(["goal_related"]);
  }
  let awardedIdx = headers.indexOf("xp_awarded");
  if (awardedIdx === -1) {
    awardedIdx = headers.length;
    sheet.getRange(1, awardedIdx + 1).setValue("xp_awarded");
    headers = headers.concat(["xp_awarded"]);
  }

  const today = logicalToday_();   // 深夜は前日の続きとして数える（saveLogと同じ区切り）
  const targetDate = (body.date && /^\d{4}-\d{2}-\d{2}$/.test(String(body.date)) && String(body.date) <= today)
    ? String(body.date) : today;
  const isPast = targetDate !== today;
  const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });

  // 「日付|時間帯」をキーにインデックス化して既存行をO(1)で検索できるようにする。
  // 同時に今日分の件数・バッジ判定用の集計もこの1パスで済ませる
  const rowIndexByKey = {};
  let todaysLogCount = 0, totalLogs = 0, memoCount = 0;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idx.email]) !== studentEmail) continue;
    totalLogs++;
    if (String(data[i][idx.memo] || "").trim()) memoCount++;
    const raw = data[i][idx.date];
    const rowDate = raw instanceof Date ? Utilities.formatDate(raw, "Asia/Tokyo", "yyyy-MM-dd") : String(raw);
    if (rowDate === today) todaysLogCount++;
    rowIndexByKey[rowDate + "|" + String(data[i][idx.time])] = i;
  }

  const newFocus = String(body.focus_level || "").trim();
  const newRows = [];
  let updatedAny = false;
  // 記録ごとに「初めて評価が入った時に1回だけ付与」する方式。今回新たにXP対象になった
  // ブロック数を数え、1つでもあればバッチ全体で1回だけXPを付与する（何度更新しても増えない）
  let awardedBlockCount = 0;
  let awardedGoalBlockCount = 0; // うち目標関連（マイルストーン判定用）
  blocks.forEach(b => {
    const dataIdx = rowIndexByKey[targetDate + "|" + b];
    if (dataIdx !== undefined) {
      const prevFocus = String(data[dataIdx][idx.focus] || "").trim();
      const flagRaw = String(data[dataIdx][awardedIdx] || "").toUpperCase();
      const prevAwarded = flagRaw === "TRUE" || (flagRaw === "" && !!prevFocus);
      // 列の並びに依存しないよう、行全体を1回のsetValuesで書き換える
      const updatedRow = data[dataIdx].slice();
      while (updatedRow.length <= awardedIdx) updatedRow.push("");
      updatedRow[idx.task] = body.task;
      updatedRow[idx.focus] = body.focus_level;
      updatedRow[idx.memo] = body.memo || "";
      updatedRow[goalIdx] = body.goal_related || "false";
      if (!isPast && !prevAwarded && newFocus) {
        updatedRow[awardedIdx] = "TRUE";
        awardedBlockCount++;
        if (String(body.goal_related) === "true") awardedGoalBlockCount++;
      }
      sheet.getRange(dataIdx + 1, 1, 1, updatedRow.length).setValues([updatedRow]);
      updatedAny = true;
    } else {
      const row = new Array(headers.length).fill("");
      row[idx.logId] = "log_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
      row[idx.email] = studentEmail;
      row[idx.date] = targetDate;
      row[idx.time] = b;
      row[idx.task] = body.task;
      row[idx.focus] = body.focus_level;
      row[idx.memo] = body.memo || "";
      row[idx.timestamp] = now;
      row[goalIdx] = body.goal_related || "false";
      if (!isPast && newFocus) {
        row[awardedIdx] = "TRUE";
        awardedBlockCount++;
        if (String(body.goal_related) === "true") awardedGoalBlockCount++;
      } else {
        row[awardedIdx] = "FALSE";
      }
      newRows.push(row);
      totalLogs++;
      if ((body.memo || "").trim()) memoCount++;
      if (!isPast) todaysLogCount++;
    }
  });

  if (newRows.length > 0) {
    // 新規行はまとめて1回のsetValuesで末尾に追加（appendRowをブロック数ぶん呼ばない）
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, newRows.length, headers.length).setValues(newRows);
    sheet.getRange(startRow, idx.time + 1, newRows.length, 1).setNumberFormat("@");
  }

  // 各ブロックをKaiのカレンダーへ直接書き込む（端末・トークンに依存しない確実な反映）
  blocks.forEach(function (b) { writeRecordToOwnerCalendar(studentEmail, targetDate, b, body.task, body.time_classification); });

  if (isPast) return { ok: true, xp_gained: 0, updated: updatedAny, count: blocks.length };

  updateStreak(studentEmail); // ブロック数ぶんではなく1回だけ
  invalidateStatusCache();
  // 今回どの記録も新たにXP対象にならなかった（評価済みの再編集だけ等）場合はXPを与えない
  if (awardedBlockCount === 0) return { ok: true, xp_gained: 0, updated: updatedAny, count: blocks.length };
  // 一括保存は「このリクエスト」を1つの出どころとして台帳に残す
  const xpResult = addXP(studentEmail, body.memo, todaysLogCount, { totalLogs, memoCount },
                         "multi_" + studentEmail.slice(0, 3) + "_" + Date.now()); // DailyLogの再読み込みなし
  if (awardedGoalBlockCount > 0) incrementGoalBlocksAndNotify(studentEmail, awardedGoalBlockCount);
  return { ok: true, xp_gained: xpResult.xp_gained, level_up: xpResult.level_up, level: xpResult.level, updated: updatedAny, count: blocks.length };
}

// todaysLogCount: 呼び出し元（saveLog/saveLogMulti）がこのリクエストで確定させた
// 「今日この生徒が記録した件数」。ここでDailyLogを再度読み込まずに済ませるための引数
// XPを足した記録を台帳へ残す。sourceId が同じものが既にあれば足さない
function xpLedgerHas_(studentEmail, sourceId) {
  if (!sourceId) return false;
  return p1List("XpEvents", studentEmail).some(function (e) {
    return String(e.source_id) === String(sourceId) && !String(e.reversed_at || "").trim(); });
}
function xpLedgerAdd_(studentEmail, sourceType, sourceId, amount, reason) {
  if (!sourceId) return;
  p1Upsert("XpEvents", "event_id", {
    event_id: "xpe_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
    student_email: studentEmail, source_type: sourceType, source_id: String(sourceId),
    amount: Number(amount) || 0, reason: reason || "",
    created_at: new Date().toISOString(), reversed_at: "", reversal_reason: ""
  });
}
// Users.xp を増減する（台帳とセットで使う）
function xpApplyDelta_(studentEmail, delta) {
  if (!delta) return null;
  const sheet = getSheet("Users");
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const emailIdx = headers.indexOf("student_email");
  const xpIdx = headers.indexOf("xp");
  if (xpIdx === -1) return null;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][emailIdx]) !== studentEmail) continue;
    const before = Number(data[i][xpIdx] || 0);
    const after = Math.max(0, before + Number(delta));
    sheet.getRange(i + 1, xpIdx + 1).setValue(after);
    return { before: before, after: after };
  }
  return null;
}
// 記録を消したときに、その記録で入ったXPだけを戻す
function xpReverseForSource_(studentEmail, sourceId, reason) {
  if (!sourceId) return { reversed: 0, amount: 0 };
  const rows = p1List("XpEvents", studentEmail).filter(function (e) {
    return String(e.source_id) === String(sourceId) && !String(e.reversed_at || "").trim(); });
  let total = 0;
  rows.forEach(function (e) {
    total += Number(e.amount) || 0;
    p1Upsert("XpEvents", "event_id", { event_id: e.event_id, student_email: studentEmail,
      reversed_at: new Date().toISOString(), reversal_reason: reason || "LOG_DELETED" });
  });
  if (total) xpApplyDelta_(studentEmail, -total);
  return { reversed: rows.length, amount: total };
}
// 実記録からストリークを計算し直す（消した記録は数えない）。
// ★フリーズ（🧊）を含めて再現する★
//   単純に「連続した日数」を数えると、フリーズで橋渡しした日が切れ目に見え、
//   本来続いているストリークを短く壊してしまう。
//   計算方法は adminRepairStreaksFreeze と同じにそろえている。
function recomputeStreak_(studentEmail, dryRun) {
  const set = {};
  sheetToObjects(getSheet("DailyLog")).forEach(function (l) {
    if (String(l.student_email) !== studentEmail) return;
    if (String(l.deleted_at || "").trim()) return;
    const d = l.date instanceof Date ? Utilities.formatDate(l.date, "Asia/Tokyo", "yyyy-MM-dd")
                                     : String(l.date).slice(0, 10);
    if (d) set[d] = 1;
  });
  const dates = Object.keys(set).sort();
  const daysBetween = function (a, b) {
    return Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000); };
  const today = formatDate(new Date());
  const yesterday = formatDate(new Date(Date.now() - 86400000));
  let streak = 0, freeze = 0, prev = null;
  dates.forEach(function (d) {
    if (prev === null) streak = 1;
    else {
      const gap = daysBetween(prev, d);
      if (gap === 1) streak += 1;
      else if (gap === 2 && freeze > 0) { freeze -= 1; streak += 1; }
      else streak = 1;
    }
    if (streak > 0 && streak % 7 === 0 && freeze < 2) freeze += 1;
    prev = d;
  });
  let finalStreak = 0, finalFreeze = freeze, finalLast = prev || "";
  if (prev) {
    const gapToToday = daysBetween(prev, today);
    if (gapToToday <= 1) { finalStreak = streak; finalLast = prev; }
    else if (gapToToday === 2 && freeze > 0) { finalStreak = streak; finalFreeze = freeze - 1; finalLast = yesterday; }
    else { finalStreak = 0; finalLast = prev; }
  }
  const sheet = getSheet("Users");
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const emailIdx = headers.indexOf("student_email");
  const sIdx = headers.indexOf("streak");
  const lIdx = headers.indexOf("last_log_date");
  const fIdx = headers.indexOf("streak_freeze");
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][emailIdx]) !== studentEmail) continue;
    const before = { streak: Number(data[i][sIdx] || 0),
                     freeze: fIdx === -1 ? 0 : Number(data[i][fIdx] || 0),
                     last_log_date: lIdx === -1 ? "" : String(data[i][lIdx] || "") };
    if (!dryRun) {
      if (sIdx !== -1) sheet.getRange(i + 1, sIdx + 1).setValue(finalStreak);
      if (lIdx !== -1) sheet.getRange(i + 1, lIdx + 1).setValue(finalLast);
      // ★フリーズ（🧊）は減らさない★
      //   本人が貯めた残数を、再計算のたびに取り上げてしまわないため。
      //   増える方向（獲得の取りこぼし）だけ反映する。
      if (fIdx !== -1 && finalFreeze > before.freeze) sheet.getRange(i + 1, fIdx + 1).setValue(finalFreeze);
    }
    return { before: before.streak, after: finalStreak, freeze_before: before.freeze,
             freeze_after: Math.max(before.freeze, finalFreeze), freeze_simulated: finalFreeze,
             last_log_date: finalLast, dry_run: !!dryRun,
             recorded_days: dates.length };
  }
  return { before: null, after: finalStreak, last_log_date: finalLast, dry_run: !!dryRun };
}

// ★XPの下限★（2026-08-05）
//   到達した最高レベル（peak_level）の1つ下のレベルの入口XPを下限にする。
//   例: Lv.26 まで行った人は Lv.25 の入口（=いまのXPの少し下）までしか落ちない。
//   peak_level が無い古い行は、いまのXPから逆算して記録しておく。
function xpDecayFloor_(sheet, headers, row, rowIdx, currentXP) {
  var iPeak = headers.indexOf("peak_level");
  if (iPeak === -1) {
    iPeak = headers.length;
    sheet.getRange(1, iPeak + 1).setValue("peak_level");
  }
  var peak = Number(row[iPeak] || 0);
  var nowLv = getXpLevel(currentXP);
  if (nowLv > peak) {   // 最高到達を更新していたら記録し直す
    peak = nowLv;
    sheet.getRange(rowIdx + 1, iPeak + 1).setValue(peak);
  }
  if (peak <= 1) return 0;
  // 1つ下のレベルの入口XP（XP_THRESHOLDS は0始まりの配列）
  var floorLv = Math.max(1, peak - 1);
  return XP_THRESHOLDS[floorLv - 1] || 0;
}

function addXP(studentEmail, memo, todaysLogCount, logSummary, sourceId) {
  // 同じ記録で二重にXPを出さない（再送・重複送信の保険）
  if (sourceId && xpLedgerHas_(studentEmail, sourceId)) {
    return { xp_gained: 0, total_xp: 0, level: 1, level_up: false, badges: "", duplicate: true };
  }
  const usersSheet = getSheet("Users");
  const data = usersSheet.getDataRange().getValues();
  const headers = data[0];
  const emailIdx = headers.indexOf("student_email");
  let xpIdx = headers.indexOf("xp");
  let badgesIdx = headers.indexOf("badges");

  if (xpIdx === -1) { xpIdx = headers.length; usersSheet.getRange(1, xpIdx+1).setValue("xp"); }
  if (badgesIdx === -1) { badgesIdx = headers.length + (xpIdx === headers.length ? 1 : 0); usersSheet.getRange(1, badgesIdx+1).setValue("badges"); }

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][emailIdx]) !== studentEmail) continue;

    const currentXP = Number(data[i][xpIdx] || 0);
    const currentBadges = String(data[i][badgesIdx] || "");
    const streak = Number(data[i][headers.indexOf("streak")] || 0);

    // ストリークボーナスは1日1回のみ
    const isFirstLogToday = (todaysLogCount || 1) <= 1;

    let gained = 10;
    if (memo && memo.trim()) gained += 5;
    if (isFirstLogToday) gained += Math.min(streak, 30) * 2;

    const newXP = currentXP + gained;
    const oldLevel = getXpLevel(currentXP);
    const newLevel = getXpLevel(newXP);
    const levelUp = newLevel > oldLevel;

    usersSheet.getRange(i+1, xpIdx+1).setValue(newXP);
    // 到達した最高レベルを控えておく（減点の下限に使う）
    try {
      var iPk = headers.indexOf("peak_level");
      if (iPk === -1) { iPk = headers.length; usersSheet.getRange(1, iPk + 1).setValue("peak_level"); }
      if (newLevel > Number(data[i][iPk] || 0)) usersSheet.getRange(i+1, iPk+1).setValue(newLevel);
    } catch (e) {}
    xpLedgerAdd_(studentEmail, "LOG", sourceId, gained, memo && memo.trim() ? "log_with_memo" : "log");

    // バッジ判定
    const newBadges = checkBadges(studentEmail, currentBadges, newXP, streak, logSummary);
    if (newBadges !== currentBadges) {
      usersSheet.getRange(i+1, badgesIdx+1).setValue(newBadges);
    }

    return { xp_gained: gained, total_xp: newXP, level: newLevel, level_up: levelUp, badges: newBadges };
  }
  return { xp_gained: 0, total_xp: 0, level: 1, level_up: false, badges: "" };
}

// logSummary: 呼び出し元が既に読み込み済みのDailyLogデータから集計した
// { totalLogs, memoCount }。渡されなければ従来通りここでDailyLogを読み込む
// （バッチ処理など、事前集計を用意していない呼び出し元との互換性のため）
function checkBadges(studentEmail, currentBadges, xp, streak, logSummary) {
  const badgeList = currentBadges ? currentBadges.split(",").filter(Boolean) : [];

  let totalLogs, memoCount;
  if (logSummary) {
    totalLogs = logSummary.totalLogs;
    memoCount = logSummary.memoCount;
  } else {
    const logs = sheetToObjects(getSheet("DailyLog")).filter(l => l.student_email === studentEmail);
    memoCount = logs.filter(l => l.memo && l.memo.trim()).length;
    totalLogs = logs.length;
  }

  const checks = [
    { id: "first",   condition: totalLogs >= 1,   label: "🌱 はじめての記録" },
    { id: "streak3", condition: streak >= 3,       label: "🔥 3日連続達成" },
    { id: "streak7", condition: streak >= 7,       label: "⚡ 7日連続達成" },
    { id: "memo10",  condition: memoCount >= 10,   label: "📝 メモ名人" },
    { id: "xp500",   condition: xp >= 500,         label: "🌟 XP500達成" },
  ];

  checks.forEach(b => {
    if (b.condition && !badgeList.includes(b.id)) badgeList.push(b.id);
  });

  return badgeList.join(",");
}

function getGameStatus(studentEmail) {
  const user = getFilteredRows("Users", "student_email", studentEmail)[0];
  if (!user) return { ok: true, data: { xp: 0, level: 1, streak: 0, badges: [], goal: "", goal_deadline: "" } };
  const xp = Number(user.xp || 0);
  const level = getXpLevel(xp);
  const levelStart = XP_THRESHOLDS[level - 1] || 0;
  const levelEnd = XP_THRESHOLDS[level] || null;
  const xpInLevel = xp - levelStart;
  const xpForNextLevel = levelEnd ? levelEnd - levelStart : null;
  const streak = Number(user.streak || 0);
  const badgeIds = user.badges ? user.badges.split(",").filter(Boolean) : [];
  const badgeMap = { first:"🌱 はじめての記録", streak3:"🔥 3日連続達成", streak7:"⚡ 7日連続達成", memo10:"📝 メモ名人", xp500:"🌟 XP500達成" };
  const badges = badgeIds.map(id => ({ id, label: badgeMap[id] || id }));
  const goals = effectiveGoals(user.student_email, user);
  const streakFreeze = Number(user.streak_freeze || 0);
  // 週ペース設計用: 直近8週の「記録した日数（ユニーク日付）」を週(月曜始まり)ごとに返す。
  // クライアントが本人の週目標と突き合わせて「今週●/N日」「週ストリーク」を算出する
  const weekDayCounts = computeWeekLogDays(getFilteredRows("DailyLog", "student_email", studentEmail), 8);
  // ★隠しジロー図鑑★ すでに読んである行から取り出すだけ（通信は増えない）
  const jiroCounts = jiroParseCounts_(user.jiro_counts);
  const jiroFound = jiroParseFound_(user.jiro_found);
  const jiro = {
    found: jiroFound,
    total: HIDDEN_JIRO.length,
    progress: HIDDEN_JIRO.map(function (j) {
      return { id: j.id, have: jiroFound.indexOf(j.id) !== -1,
               now: Math.min(Number(jiroCounts[j.key] || 0), j.need), need: j.need };
    })
  };
  return { ok: true, data: { xp, level, xpInLevel, xpForNextLevel, streak, streakFreeze, badges, goals, weekDayCounts, weekLogDays: (weekDayCounts[0] ? weekDayCounts[0].days : 0), jiro } };
}

// 日付文字列(YYYY-MM-DD)の週の月曜日を返す（JST固定・UTC基準で計算しTZに依存しない）
function mondayOf(ds) {
  const d = new Date(String(ds).substring(0, 10) + "T00:00:00Z");
  const day = d.getUTCDay();               // 0=日..6=土
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().substring(0, 10);
}
// 直近nWeeksの週(月曜始まり)ごとの「記録したユニーク日数」を新しい順で返す
function computeWeekLogDays(logs, nWeeks) {
  const byWeek = {};
  logs.forEach(l => {
    if (!l.date) return;
    const w = mondayOf(l.date);
    (byWeek[w] = byWeek[w] || {})[String(l.date).substring(0, 10)] = 1;
  });
  const out = [];
  let curMon = mondayOf(formatDate(new Date()));
  for (let i = 0; i < nWeeks; i++) {
    out.push({ weekStart: curMon, days: byWeek[curMon] ? Object.keys(byWeek[curMon]).length : 0 });
    const d = new Date(curMon + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - 7);
    curMon = d.toISOString().substring(0, 10);
  }
  return out;
}

// 直近7日間の記録量（ブロック数・活動日数）で全アクティブユーザーを順位付けする。
// 累積XPだと入会が早い人が有利になり続けるため、「今どれだけ真剣に取り組めているか」を
// 測る指標として直近の活動量を採用。他ユーザーの氏名やスコアは返さずプライバシーに配慮する。
// 本日のランキング: 各ユーザーの最新レポートのスコアで順位付けする。
// レポートは毎晩22時生成のため、日中は前日分のスコアで競う形になる。
// ホーム画面で毎回呼ばれるため、computeAllStatusesと同様に5分キャッシュする
// 「みんなの頑張り」のレポートランキングと基準を完全に一致させる。
// 生徒ごとにレポート生成日がずれるため、同じ日に最新レポートが出た人だけを対象にし、
// show_in_communityがFALSEの生徒（ランキング非表示を選んだ人）は分母からも除外する
// レポートランキングの対象集合を作る共通ロジック。
// 【なぜウィンドウ方式か】レポートは毎晩生成されるが、GASの6分制限で1回の実行で
// 全員分そろわず、遅延・翌朝バックフィルで生成日が生徒ごとにずれることがある。
// 「単一の最新日」だけで絞ると、その日にまだレポートが無い生徒が丸ごとランキングから
// 抜け落ちる（＝全員分反映されない）。そこで、最新日から windowDays 日以内の
// 「各生徒の最新レポート」を採用し、少しの生成ずれでは取りこぼさないようにする。
// （数週間前の古いスコアは除外され、公平性は保たれる）
// レポートランキングの対象期間（日）。最新レポート日から7日以内に自分のレポートが
// ある人だけがランキングに載る（止まっている人が分母に残り続けないように）
const RANKING_WINDOW_DAYS = 7;
// ★どの画面でも「その人の最新の点数」を同じルールで出す★（2026-08-04）
//   ランキングは最新レポート日、共有欄は最新の新レポート…と別々に見ていたため、
//   同じ瞬間に 73 と 66 が並んでいた。ここに一本化する。
//   優先順位: 今日の新レポート → 直近の新レポート → 夜レポートの最新
function latestScoreOf_(email, opsIndex, latestReportRow) {
  const o = opsIndex && opsIndex[email];
  if (o && o.score !== null && o.score !== undefined) {
    const lrDate = latestReportRow ? String(latestReportRow.date).slice(0, 10) : "";
    if (!lrDate || o.date >= lrDate) return { score: o.score, date: o.date, source: "daily_v2" };
  }
  if (latestReportRow) return { score: Number(latestReportRow.score) || 0,
                                date: String(latestReportRow.date).slice(0, 10), source: "legacy" };
  return o ? { score: o.score, date: o.date, source: "daily_v2" } : null;
}
// 全員分の「最新の新レポート点数」を1回で読む
function opsLatestIndex_() {
  const idx = {};
  try {
    // ★必要な4列だけ読む★（2026-08-05）
    //   sheetToObjects は全列をオブジェクト化するため、行が増えるほど重い。
    const sh = getP1Sheet("DailyOpsReport");
    const last = sh.getLastRow();
    if (last < 2) return idx;
    const hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const cols = ["student_email", "report_date", "operating_score", "finalized_at"];
    const ii = cols.map(function (c) { return hdr.indexOf(c); });
    if (ii.some(function (x) { return x === -1; })) return opsLatestIndexSlow_();
    const lo = Math.min.apply(null, ii), hi = Math.max.apply(null, ii);
    const vals = sh.getRange(2, lo + 1, last - 1, hi - lo + 1).getValues();
    const c = ii.map(function (x) { return x - lo; });
    vals.forEach(function (row) {
      const rawD = row[c[1]];
      const o = { student_email: row[c[0]],
                  report_date: rawD instanceof Date
                    ? Utilities.formatDate(rawD, "Asia/Tokyo", "yyyy-MM-dd") : rawD,
                  operating_score: row[c[2]], finalized_at: row[c[3]] };
      const em = String(o.student_email || ""), d = String(o.report_date).slice(0, 10);
      const v = String(o.operating_score || "").trim();
      // ★確定した日だけを使う★（2026-08-05）
      //   夜のレポートで締めていない日は、まだ動く可能性のある点数なので
      //   ランキングや共有欄には出さない。
      if (!String(o.finalized_at || "").trim()) return;
      if (!em || !d || v === "") return;
      if (!idx[em] || idx[em].date < d) idx[em] = { date: d, score: Number(v) };
    });
  } catch (e) {}
  return idx;
}

// 列名が想定と違うときの従来どおりの読み方（保険）
function opsLatestIndexSlow_() {
  const idx = {};
  try {
    sheetToObjects(getP1Sheet("DailyOpsReport")).forEach(function (o) {
      const em = String(o.student_email || ""), d = String(o.report_date).slice(0, 10);
      const v = String(o.operating_score || "").trim();
      if (!String(o.finalized_at || "").trim()) return;
      if (!em || !d || v === "") return;
      if (!idx[em] || idx[em].date < d) idx[em] = { date: d, score: Number(v) };
    });
  } catch (e) {}
  return idx;
}

function buildReportRankingSet(emailSet, allReports, windowDays) {
  const has = (emailSet && typeof emailSet.has === "function")
    ? function (e) { return emailSet.has(e); }
    : (function () { const s = new Set(emailSet || []); return function (e) { return s.has(e); }; })();
  const latestByEmail = new Map();
  allReports.forEach(function (r) {
    if (!has(r.student_email)) return;
    const cur = latestByEmail.get(r.student_email);
    if (!cur || r.date > cur.date) latestByEmail.set(r.student_email, r);
  });
  let latestDate = null;
  latestByEmail.forEach(function (r) { if (!latestDate || r.date > latestDate) latestDate = r.date; });
  if (!latestDate) return { latestDate: null, cutoff: null, scores: [] };
  // windowDays<=0 のときは期間しばり無し＝レポートを書いて点数が出ている人を全員対象にする。
  // それ以外は「最新日を含む windowDays 日ぶん」だけを対象に（例: 3 なら 最新日・前日・前々日）。
  const noWindow = !(windowDays > 0);
  const cutoff = noWindow ? null : formatDate(new Date(new Date(latestDate + "T00:00:00").getTime() - (windowDays - 1) * 86400000));
  // ★確定した新レポートがある人は、その点数でランキングに載せる★（2026-08-03 Kaiの判断）
  //   画面に出ている点数と、ランキングの点数が違うのはおかしいため。
  //   まだ新レポートが無い人は、これまでどおり夜レポートの点数で比べる。
  const opsFinal = opsLatestIndex_();
  const scores = [];
  latestByEmail.forEach(function (r, email) {
    if (!(noWindow || r.date >= cutoff)) return;
    const v = latestScoreOf_(email, opsFinal, r);
    scores.push({ email: email, score: v.score,
      // 同点のときだけ小数で比べる（画面に出すのは整数のまま）
      precise: v.source === "daily_v2" ? v.score : (Number(r.score_precise) || Number(r.score) || 0),
      source: v.source, date: v.date });
  });
  scores.sort(function (a, b) { return (b.score - a.score) || (b.precise - a.precise); });
  return { latestDate: latestDate, cutoff: cutoff, scores: scores,
           prev: buildPrevRankingScores_(has, allReports, latestDate, windowDays) };
}

// ★前回のランキングの並び★（↑↓の判定に使う）
//
// なぜ必要か（2026-08-05 Kai指摘）:
//   これまで ↑↓ は「自分の点数が前回より上がったか」で出していた。
//   だが利用者が見ているのは順位である。全員の点数が下がった日に
//   自分だけ下がり幅が小さければ、2位→1位に上がっているのに ▼ が出る。
//   実際にKaiの画面でそうなった。順位の増減で判定するのが正しい。
//
// 「前回」＝最新日より前で、その人がいちばん最後にレポートを書いた日。
// 今の点数（新レポート）は混ぜない。当時の点数どうしで並べる。
function buildPrevRankingScores_(has, allReports, latestDate, windowDays) {
  if (!latestDate) return [];
  const prevByEmail = new Map();
  allReports.forEach(function (r) {
    if (!has(r.student_email)) return;
    if (!(String(r.date) < String(latestDate))) return;   // 最新日そのものは除く
    const cur = prevByEmail.get(r.student_email);
    if (!cur || r.date > cur.date) prevByEmail.set(r.student_email, r);
  });
  let prevDate = null;
  prevByEmail.forEach(function (r) { if (!prevDate || r.date > prevDate) prevDate = r.date; });
  if (!prevDate) return [];
  const noWindow = !(windowDays > 0);
  const cutoff = noWindow ? null
    : formatDate(new Date(new Date(prevDate + "T00:00:00").getTime() - (windowDays - 1) * 86400000));
  const out = [];
  prevByEmail.forEach(function (r, email) {
    if (!(noWindow || r.date >= cutoff)) return;
    const s = Number(r.score) || 0;
    out.push({ email: email, score: s, precise: Number(r.score_precise) || s });
  });
  out.sort(function (a, b) { return (b.score - a.score) || (b.precise - a.precise); });
  return out;
}

// 並び順の中での順位（1始まり）。居なければ null
function rankInScores_(scores, email) {
  for (let i = 0; i < (scores || []).length; i++) if (scores[i].email === email) return i + 1;
  return null;
}

function getRanking(studentEmail) {
  // ラインの分離：学生（cohort付き）は学生同士、クライアント（cohortなし）はクライアント同士でだけ競う。
  // 有料顧客のランキングに学生が混ざる／学生に顧客が見える、という体験の混在を防ぐ
  const allUsersForCohort = sheetToObjects(getSheet("Users"));
  const meU = allUsersForCohort.find(u => u.student_email === studentEmail);
  const myCohort = String((meU && meU.cohort) || "").trim();
  // v7: 前回の並び(prev)を持つようになったため、旧キャッシュと混ぜない
  const CACHE_KEY = "ranking_scores_v7_" + (myCohort || "main");
  let payload;
  const cached = CacheService.getScriptCache().get(CACHE_KEY);
  if (cached) {
    payload = JSON.parse(cached);
  } else {
    const users = allUsersForCohort.filter(u =>
      u.is_active.toUpperCase() === "TRUE" && String(u.show_in_community || "").toUpperCase() !== "FALSE" &&
      String(u.cohort || "").trim() === myCohort
    );
    const active = new Set(users.map(u => u.student_email));
    const allReports = sheetToObjects(getSheet("Reports")).filter(r => active.has(r.student_email));

    // 直近7日以内にレポートが出ている人だけを対象にする（＝いま続いている人同士で競う）。
    // 一度書いたきり止まっている人がいつまでも分母に残らないようにするための期間しばり。
    // 一度も記録がない人はそもそもレポートが無いので、これまで通り対象外
    const cur = buildReportRankingSet(active, allReports, RANKING_WINDOW_DAYS);
    payload = { date: cur.latestDate, scores: cur.scores, prev: cur.prev || [] };
    try { CacheService.getScriptCache().put(CACHE_KEY, JSON.stringify(payload), 300); } catch (e) { /* サイズ超過時は無視 */ }
  }

  const scores = payload.scores || [];
  if (scores.length < 2) return { ok: true, data: null };

  // ★トレンド（▲▼）は「順位」の増減で出す★（2026-08-05 Kai指摘で修正）
  //   以前は点数の増減で出していたため、2位→1位に上がった日でも
  //   点数が前日より低ければ ▼ になっていた。見ている人は順位の話をしている。
  const myReports = getFilteredRows("Reports", "student_email", studentEmail).sort((a, b) => b.date > a.date ? 1 : -1);
  const prevScores = payload.prev || [];
  const myPrevRank = () => {
    if (!prevScores.length) return null;
    const r = rankInScores_(prevScores, studentEmail);
    if (r) return r;
    // 共有オフなどで並びに入っていない人は、当時の自分の点数から位置を出す
    if (myReports.length < 2) return null;
    const ps = Number(myReports[1].score) || 0;
    return prevScores.filter(function (s) { return s.score > ps; }).length + 1;
  };
  const myTrend = (curRank) => {
    if (!curRank) return null;
    const pr = myPrevRank();
    if (!pr) return null;                       // 前回が無い＝初参加。印は出さない
    return curRank < pr ? "up" : curRank > pr ? "down" : "same";   // 順位は小さいほど上位
  };

  // ★見ている本人の点数は、画面と必ず同じにする★（2026-08-03 Kai指摘）
  //   ランキングは5分キャッシュ、レポートはその場計算なので、
  //   その日のうちは数字がずれて見えていた。本人の分だけ出し直す。
  let myOps = null;
  try {
    if (hasFeature(meU, OPS_FEATURE_KEY)) {
      // 今日の分があれば今日、なければ直近の新レポート（他の画面と同じルール）
      const today0 = formatDate(new Date());
      const mine = p1List("DailyOpsReport", studentEmail);
      const todayRow = mine.find(function (r) { return String(r.report_date).slice(0, 10) === today0; });
      if (todayRow && String(todayRow.finalized_at || "").trim() &&
          String(todayRow.operating_score || "").trim() !== "") {
        myOps = Number(todayRow.operating_score);
      } else {
        // ★確定していない今日の点数はランキングに出さない★（2026-08-05 Kai報告）
        //   夜のレポートがまだ届いていないのに「46点」と出ていた。
        //   その場で計算した途中の点数を使っていたため。
        //   ランキングは確定した点数どうしで比べる（途中の点数で順位を作らない）。
        const idx = opsLatestIndex_()[studentEmail];
        if (idx) myOps = idx.score;
      }
    }
  } catch (e) {}

  const idx = scores.findIndex(s => s.email === studentEmail);
  if (idx !== -1) {
    const myScore = (myOps === null) ? scores[idx].score : myOps;
    const rank = (myOps === null) ? (idx + 1)
      : (scores.filter(function (s) { return s.email !== studentEmail && s.score > myScore; }).length + 1);
    return { ok: true, data: { rank: rank, total: scores.length, score: myScore, trend: myTrend(rank) } };
  }

  // 「みんなの頑張り」を非表示にしている本人は共有scoresから除外されるため、ここで個別救済。
  // レポートが1件でもあれば、その最新スコアで順位を算出（総数は本人を足した数）
  if (myReports.length) {
    const myScore = Number(myReports[0].score) || 0;
    const rank = scores.filter(s => s.score > myScore).length + 1;
    return { ok: true, data: { rank, total: scores.length + 1, score: myScore, trend: myTrend(rank) } };
  }
  // まだレポートが無い人（＝未記録）にも「今の参加人数」は見せる。rank=nullで
  // 「◯人が参加中・記録するとランキングに載る」と案内できるようにする
  return { ok: true, data: { rank: null, total: scores.length, score: null, trend: null } };
}

// 「みんなの頑張り」画面用。ニックネーム＋アバターは本名と違い公開前提の情報なので
// 実名やメールは一切含めず、直近7日の活動量でランキング表示する。
// 「みんなの頑張り」のランキングは、ホームの「ステータス」と同じ累計基準。
// 見ている場所によって基準がバラバラだと分かりにくいため一本化している。
// レポートスコア（直近レポートの点数）のランキングも別途あわせて返す。
// ★自己経営力の総合点（キャッシュ付き）★（2026-08-05）
//   週次の計算は1人あたり数秒かかる。ランキングで全員ぶん毎回回すと画面が開かない。
//   計算結果を6時間だけ取っておき、無ければ（かつ時間に余裕があれば）その場で計算する。
//   allowCompute=false のときは、キャッシュに無ければ null を返してすぐ諦める。
// ★総合点を Users シートに残しておく★（2026-08-05）
//   「みんなの頑張り」で全員ぶんをその場で計算していたため、開くのに
//   何十秒もかかっていた。しかも記録するたびキャッシュを捨てる作りにしたので、
//   毎回計算し直しになっていた。
//   本人の画面を開いたとき（＝必ず計算する場面）と夜の処理で、ここに書いておき、
//   ランキングはこの値を読むだけにする。他人の順位は秒単位の鮮度が要らない。
function smpStoreOverall_(studentEmail, score) {
  try {
    if (score === null || score === undefined) return;
    const sheet = getSheet("Users");
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const iEm = headers.indexOf("student_email");
    let iSc = headers.indexOf("smp_overall");
    let iAt = headers.indexOf("smp_overall_at");
    if (iSc === -1) { iSc = headers.length; sheet.getRange(1, iSc + 1).setValue("smp_overall"); }
    if (iAt === -1) { iAt = (iSc === headers.length ? headers.length + 1 : headers.length);
                      sheet.getRange(1, iAt + 1).setValue("smp_overall_at"); }
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][iEm]) !== studentEmail) continue;
      sheet.getRange(i + 1, iSc + 1).setValue(score);
      sheet.getRange(i + 1, iAt + 1).setValue(new Date().toISOString());
      return;
    }
  } catch (e) { Logger.log("smpStoreOverall_: " + e); }
}

function smpOverallCached_(studentEmail, allowCompute) {
  const key = "smpall_" + sha256Hex(studentEmail + "|" + SMP_VERSION + "|" + OPS_CALC_VERSION +
                                    "|" + mondayOf(formatDate(new Date())) +
                                    "|" + smpEpoch_(studentEmail)).slice(0, 40);
  try {
    const hit = CacheService.getScriptCache().get(key);
    if (hit !== null && hit !== undefined) return hit === "" ? null : Number(hit);
  } catch (e) {}
  if (!allowCompute) return null;
  let v = null;
  try {
    const r = computeSelfMgmtPower(studentEmail, null);
    v = (r && r.overall_score !== null && r.overall_score !== undefined) ? r.overall_score : null;
  } catch (e) { v = null; }
  try { CacheService.getScriptCache().put(key, v === null ? "" : String(v), 6 * 60 * 60); } catch (e) {}
  // 「みんなの頑張り」はこの値を読むだけなので、計算したら必ず残す
  // （夜の温め処理はここを通る）
  smpStoreOverall_(studentEmail, v);
  return v;
}

// ★全員ぶんの総合点をまとめて計算して残す★（運用コマンド）
//   「みんなの頑張り」は Users の smp_overall を読むだけなので、
//   一度も計算されていない人は載らない。移行のときに一度回す。
//     bash gas/ops.sh adminSmpWarmAll
function adminSmpWarmAll(coachEmail) {
  if (!verifyAdmin(coachEmail)) return { ok: false, error: "not admin" };
  const users = sheetToObjects(getSheet("Users")).filter(function (u) {
    return String(u.is_active || "").toUpperCase() === "TRUE" && hasFeature(u, SMP_FEATURE_KEY);
  });
  const start = Date.now();
  let done = 0, skipped = 0;
  users.forEach(function (u) {
    if (Date.now() - start > 4 * 60 * 1000) { skipped++; return; }   // 実行時間の上限を超えないように
    try { smpOverallCached_(u.student_email, true); done++; } catch (e) { skipped++; }
  });
  return { ok: true, total: users.length, done: done, skipped: skipped,
           note: skipped ? "時間切れの分が残っています。もう一度実行してください" : "全員ぶん終わりました" };
}

function getCommunity(studentEmail) {
  // ★開くたびに作り直さない★（2026-08-05 Kai報告「表示が遅すぎる。2秒で開きたい」）
  //   中身は「みんなの状況」なので、数分ずれても困らない。
  //   1人ぶん作るのに数秒かかるため、2分間だけ持ち回す。
  //   本人の記録やシェアはこの画面から書き換えないので、古い値が悪さをしない。
  //   （シェア投稿だけは shareAchievement 側でこのキーを消して即反映させる）
  const _ckC = "community_v2_" + studentEmail;
  try {
    const _hit = CacheService.getScriptCache().get(_ckC);
    if (_hit) { const o = JSON.parse(_hit); o.cached = true; return o; }
  } catch (e) { /* キャッシュが読めなくても本処理へ進む */ }
  const _r = getCommunityFresh_(studentEmail);
  try { CacheService.getScriptCache().put(_ckC, JSON.stringify(_r), 120); } catch (e) {}
  return _r;
}

function getCommunityFresh_(studentEmail) {
  // ラインの分離：学生（cohort付き）は学生同士、クライアントはクライアント同士だけが見える
  const allUsersC = sheetToObjects(getSheet("Users"));
  const meC = allUsersC.find(u => u.student_email === studentEmail);
  const myCohortC = String((meC && meC.cohort) || "").trim();
  // show_in_communityが明示的に"FALSE"の生徒は、本人以外の目からは完全に見えなくする
  // （自分自身は自分の結果を見られるよう例外にする）
  const users = allUsersC.filter(u =>
    u.is_active.toUpperCase() === "TRUE" &&
    String(u.cohort || "").trim() === myCohortC &&
    (u.student_email === studentEmail || String(u.show_in_community || "").toUpperCase() !== "FALSE")
  );
  // 「みんなの頑張り」を非表示にしている本人は、順位（数字）は見られてよいが、
  // 他の生徒の名前までは見せない（非表示は一方通行ではなく、お互いに匿名化する）
  const me = meC;
  const callerHidden = !!me && String(me.show_in_community || "").toUpperCase() === "FALSE";
  const maskName = (u, isMe) => (callerHidden && !isMe) ? "匿名さん" : (u.nickname || "名無しさん");
  const maskAvatar = (u, isMe) => (callerHidden && !isMe) ? "🙈" : (u.avatar || "🦊");

  // ★computeAllStatuses は呼ばない★（2026-08-05 Kai報告「開くのが遅すぎる」）
  //   ステータスランキングを自己経営力ランキングに置き換えたとき、
  //   この呼び出しだけが残った。結果はどこにも使っていないのに、
  //   全員ぶんの DailyLog を日ごとに減衰計算する、この画面で一番重い処理だった。
  // ★Reports は必要な3列だけ読む★（2026-08-05 Kai報告「開くのが遅すぎる」）
  //   ここで使うのは student_email / date / score だけ。
  //   sheetToObjects は breakdown などの長いJSON列まで毎行オブジェクト化するため、
  //   行数が増えるほど効いてくる。
  const allReports = (function () {
    const sh = getSheet("Reports");
    const last = sh.getLastRow();
    if (last < 2) return [];
    const hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const iE = hdr.indexOf("student_email"), iD = hdr.indexOf("date"), iS = hdr.indexOf("score");
    if (iE === -1 || iD === -1 || iS === -1) return sheetToObjects(sh);
    const lo = Math.min(iE, iD, iS), hi = Math.max(iE, iD, iS);
    const vals = sh.getRange(2, lo + 1, last - 1, hi - lo + 1).getValues();
    const cE = iE - lo, cD = iD - lo, cS = iS - lo;
    return vals.map(function (r) {
      const raw = r[cD];
      return { student_email: String(r[cE] || ""),
               date: raw instanceof Date ? Utilities.formatDate(raw, "Asia/Tokyo", "yyyy-MM-dd")
                                         : String(raw).slice(0, 10),
               score: r[cS] };
    });
  })();
  const latestReportByEmail = new Map();
  allReports.forEach(r => {
    const cur = latestReportByEmail.get(r.student_email);
    if (!cur || r.date > cur.date) latestReportByEmail.set(r.student_email, r);
  });
  // ★他の人から見える点数も、本人の画面と同じにする★（2026-08-03 Kai指摘）
  //   新しいレポートを使っている人は、その点数を使う
  const opsLatest = opsLatestIndex_();
  const reportScoreOf = function (email) {
    const v = latestScoreOf_(email, opsLatest, latestReportByEmail.get(email) || null);
    return v ? v.score : null;
  };

  // ★ステータスランキングを「自己経営力ランキング」に置き換える★（2026-08-05 Kai要望）
  //   旧ステータスは XP・記録数など「量」の指標で、いま見せている
  //   自己経営の状態（5つの力）と別物だった。同じ画面に別の物差しが2本あると
  //   どちらを見ればいいのか分からなくなるため、自己経営力の総合点に統一する。
  //   総合点が出ていない人（記録が少なく、確かに測れた力が1つも無い人）は
  //   ランキングに載せない。0点として並べると、始めたばかりの人が最下位に固定される。
  //   1人ぶんの計算に数秒かかるため、全員ぶんをその場で回すと画面が開かない。
  //   6時間キャッシュし、1回のリクエストで新しく計算するのは時間の許す範囲だけにする。
  //   夜のレポート生成時にも温めておくので、通常は全員ぶんキャッシュに乗っている。
  // ★その場で計算しない★（2026-08-05）
  //   1人ぶん数秒かかるため、全員ぶん回すと開くのに何十秒もかかっていた。
  //   本人がアプリを開いたときと夜の処理で Users に書いてある値を読むだけにする。
  //   まだ一度も計算されていない人は載せない（0点で最下位に固定しないため）。
  const smpTotalOf = function (email) {
    const uu = allUsersC.find(function (x) { return x.student_email === email; });
    if (!hasFeature(uu, SMP_FEATURE_KEY)) return null;
    const v = uu && uu.smp_overall;
    if (v === "" || v === null || v === undefined) return null;
    const n = Number(v);
    return isNaN(n) ? null : n;
  };
  const list = users.map(u => {
    const isMe = u.student_email === studentEmail;
    return {
      isMe,
      email: u.student_email,
      nickname: maskName(u, isMe),
      avatar: maskAvatar(u, isMe),
      streak: Number(u.streak || 0),
      score: smpTotalOf(u.student_email),
      reportScore: reportScoreOf(u.student_email)
    };
    // ★0点は載せない★（2026-08-05 Kai指摘「0点の人がいる」）
    //   まだ何も測れていない人が0点として最下位に固定されてしまう。
    //   総合点が出ていない人を載せない、という元の意図と揃える。
  }).filter(x => x.score !== null && Number(x.score) > 0)
    .map(x => { delete x.email; return x; })
    .sort((a, b) => b.score - a.score);

  // レポートランキングは「その人の最新レポートの点数」で競う場（合計/継続はステータス側が担う）。
  // 直近7日以内にレポートがある人だけを対象にし、ホームの getRanking と基準を統一している
  // （止まっている人が分母に残り続けないように）。
  const commEmails = new Set(users.map(u => u.student_email));
  const rankSet = buildReportRankingSet(commEmails, allReports, RANKING_WINDOW_DAYS);
  const userByEmail = new Map(users.map(u => [u.student_email, u]));
  const reportRanking = rankSet.scores.map(s => {
    const u = userByEmail.get(s.email);
    const isMe = u.student_email === studentEmail;
    return {
      isMe,
      nickname: maskName(u, isMe),
      avatar: maskAvatar(u, isMe),
      reportScore: s.score,
      reportDate: s.date
    };
  });

  // 連続記録ランキング（🔥ストリークの長さで競う。記録を継続する動機づけ）。
  // 0日の人は載せない（まだ記録が続いていない人を晒さないため）
  const streakRanking = users
    .map(u => {
      const isMe = u.student_email === studentEmail;
      return {
        isMe,
        nickname: maskName(u, isMe),
        avatar: maskAvatar(u, isMe),
        streak: Number(u.streak || 0),
        freeze: Number(u.streak_freeze || 0)
      };
    })
    .filter(u => u.streak > 0)
    .sort((a, b) => b.streak - a.streak);

  // ★階級ランキング★（2026-08-05 Kai要望）
  //   XPそのものではなく「いまどの階級か」で並べる。
  //   数字だけの競争にせず、ジローくんの姿が変わる楽しさに寄せる。
  //   Lv.1（まだ始めたばかり）は載せない。晒される場にしないため。
  const levelRanking = users
    .map(u => {
      const isMe = u.student_email === studentEmail;
      const xp = Number(u.xp || 0);
      const lv = getXpLevel(xp);
      const rk = getRank(lv);
      return {
        isMe,
        nickname: maskName(u, isMe),
        avatar: maskAvatar(u, isMe),
        level: lv,
        rankName: rk ? rk.name : "",
        // 同じ階級の中では、次の階級までの進み具合が分かるようにXPも返す
        xp: xp
      };
    })
    .filter(u => u.level > 1)
    .sort((a, b) => (b.level - a.level) || (b.xp - a.xp));

  // 最近記録した仲間（直近48時間に記録した人を全員）。ランキング（上位5人）とは別に、
  // 「記録した人は必ず載る」場を作ることで、頑張りを取りこぼさず称える
  const recentCut = formatDate(new Date(Date.now() - 1 * 86400000)); // 昨日・今日
  const recentLoggers = (function () {
    const emails = new Set(users.map(u => u.student_email));
    const byEmail = {};
    // ★DailyLog を丸ごとオブジェクトにしない★（2026-08-05 Kai報告「開くのが遅すぎる」）
    //   ここで欲しいのは「直近2日に誰が何件記録したか」だけなのに、
    //   全行を50列ぶんのオブジェクトへ変換していた。
    //   必要な2列だけを読み、追記順（古い→新しい）を利用して後ろから見て、
    //   古い日が続いたら打ち切る。
    const dl = getSheet("DailyLog");
    const lastRow = dl.getLastRow();
    if (lastRow > 1) {
      const hdr = dl.getRange(1, 1, 1, dl.getLastColumn()).getValues()[0];
      const iEm = hdr.indexOf("student_email"), iDt = hdr.indexOf("date");
      if (iEm !== -1 && iDt !== -1) {
        const lo = Math.min(iEm, iDt), hi = Math.max(iEm, iDt);
        const block = dl.getRange(2, lo + 1, lastRow - 1, hi - lo + 1).getValues();
        const cEm = iEm - lo, cDt = iDt - lo;
        let oldRun = 0;
        for (let i = block.length - 1; i >= 0; i--) {
          const raw = block[i][cDt];
          const d = raw instanceof Date ? Utilities.formatDate(raw, "Asia/Tokyo", "yyyy-MM-dd")
                                        : String(raw).slice(0, 10);
          if (d < recentCut) { if (++oldRun > 300) break; continue; }
          oldRun = 0;
          const em = String(block[i][cEm] || "");
          if (emails.has(em)) byEmail[em] = (byEmail[em] || 0) + 1;
        }
      }
    }
    return users
      .filter(u => byEmail[u.student_email])
      .map(u => {
        const isMe = u.student_email === studentEmail;
        return { isMe, nickname: maskName(u, isMe), avatar: maskAvatar(u, isMe), blocks: byEmail[u.student_email], streak: Number(u.streak || 0) };
      })
      .sort((a, b) => b.blocks - a.blocks);
  })();

  // 新しく入った仲間（直近14日に登録）。記録がまだ無くてもここに載せて歓迎し、
  // 顔（ニックネーム・アバター）が見えることでコミュニティに迎え入れる
  const nc14 = formatDate(new Date(Date.now() - 14 * 86400000));
  const newcomers = users
    .filter(u => {
      const j = u.joined_at instanceof Date ? formatDate(u.joined_at) : String(u.joined_at || "");
      return j && j >= nc14;
    })
    .sort((a, b) => (String(b.joined_at) > String(a.joined_at) ? 1 : -1))
    .slice(0, 20)
    .map(u => {
      const isMe = u.student_email === studentEmail;
      return { isMe, nickname: maskName(u, isMe), avatar: maskAvatar(u, isMe), joined_at: (u.joined_at instanceof Date ? formatDate(u.joined_at) : String(u.joined_at || "")) };
    });

  // シェア一覧も一緒に返す（別々に取ると往復が2回になり、そのぶん待たされる）
  let achievements = null;
  try { const a = getAchievements(studentEmail); if (a && a.ok) achievements = a.data; } catch (e) {}
  return { ok: true, data: list, reportRanking: reportRanking, streakRanking: streakRanking,
           levelRanking: levelRanking,
           newcomers: newcomers, recentLoggers: recentLoggers, achievements: achievements };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 達成シェア（任意）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function getAchievementsSheet() {
  let sheet = getSheet("Achievements");
  if (!sheet) {
    sheet = SpreadsheetApp.openById(SPREADSHEET_ID).insertSheet("Achievements");
    sheet.appendRow(["achievement_id", "date", "student_email", "nickname", "avatar", "message", "created_at", "category"]);
  }
  // 既存シートに古い形式（achievement_id列なし）が残っている場合の自己修復
  let headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (headers.indexOf("achievement_id") === -1) {
    sheet.insertColumnBefore(1);
    sheet.getRange(1, 1).setValue("achievement_id");
    headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  }
  // カテゴリ列（偏り防止のクールダウン判定に使う）を後付けで自己修復
  if (headers.indexOf("category") === -1) {
    sheet.getRange(1, headers.length + 1).setValue("category");
  }
  return sheet;
}

function shareAchievement(studentEmail, body) {
  const message = String(body.message || "").trim().slice(0, 200);
  if (!message) return { ok: false, error: "empty message" };
  // 投稿したのに自分の画面に出ないと壊れて見えるので、持ち回している分を捨てる
  try { CacheService.getScriptCache().remove("community_v2_" + studentEmail); } catch (e) {}
  const user = sheetToObjects(getSheet("Users")).find(u => u.student_email === studentEmail);
  if (!user) return { ok: false, error: "user not found" };
  const sheet = getAchievementsSheet();
  const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  const id = "ach_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
  sheet.appendRow([id, formatDate(new Date()), studentEmail, user.nickname || "名無しさん", user.avatar || "🦊", message, now]);
  return { ok: true };
}

// レポートで高スコア（絶好調）が出た生徒を、点数は伏せたままコミュニティのシェア欄へ自動投稿する。
// 「みんなの頑張り」をもっとリアルタイムに賑やかにしたいという要望から追加。
// show_in_communityがFALSEの生徒（ランキング非表示を選んだ人）は対象外にする
const HIGH_SCORE_ACHIEVEMENT_THRESHOLD = 88;
const HIGH_SCORE_MESSAGES = [
  "今日はとても絶好調でした🔥", "充実した一日を過ごせました🌟", "いい流れに乗れています✨",
  "今日は自分史上ベストな一日でした💪", "納得のいく一日を過ごせました😊", "自分の時間をしっかり使えました⏱️",
  "今日はやりたいことに集中できました🎯", "手応えのある一日でした👏",
  "今日は理想の過ごし方ができました🌈", "気持ちよく一日を締めくくれました🌙",
  "やるべきことをやり切りました✅", "自分をしっかりコントロールできた一日💯"
];
// 新しく使い始めた人・戻ってきた人・小さな節目を積極的に取り上げて、
// フィードが上位常連だけに偏らないようにレパートリーを増やす
const NEWCOMER_MESSAGES = [
  "はじめての記録を残しました🌱 新しい一歩！", "記録デビューしました🎉 これからが楽しみ",
  "JIROKUで最初の一歩を踏み出しました🌱", "はじめての記録、おめでとうございます✨",
  "記録の習慣、今日からスタート🚀", "自分と向き合う一歩を踏み出しました🌱"
];
const COMEBACK_MESSAGES = [
  "久しぶりに記録を再開しました🌿 おかえりなさい！", "またコツコツ再スタート🌱 いい流れ",
  "しばらくぶりの記録、戻ってきました👏", "再開の一歩を踏み出しました🌿",
  "ブランクを越えてまた歩き出しました🌿", "戻ってきた、それが一番大事👏"
];
const pickMsg = (arr) => arr[Math.floor(Math.random() * arr.length)];
function streakShareMessage(streak) {
  if (streak >= 100) return streak + "日連続記録を達成しました🏆 圧巻の継続力！";
  if (streak >= 30) return streak + "日連続を達成しました🔥 習慣になってきました";
  if (streak >= 14) return streak + "日連続で記録中🔥 いい調子！";
  if (streak >= 7) return streak + "日連続で記録できました🔥 素晴らしい継続";
  return streak + "日連続で記録できました🌟 その調子！";
}
// 数字を前面に出したシェア文（時間帯数・週の記録日数・フリーズ・タスク完了数）
function dailyVolumeShareMessage(blocks) {
  const tail = blocks >= 12 ? "圧巻の集中力🔥" : blocks >= 10 ? "よく動いた一日💪" : "集中の一日👏";
  return "今日は" + blocks + "時間帯を記録しました📝 " + tail;
}
function weeklyDaysShareMessage(days) {
  return "今週は" + days + "日記録しました📅 自分のペースを守れています";
}
function freezeShareMessage(streak) {
  return streak + "日連続でストリークフリーズを獲得🧊 休んでも連続が守られます";
}
function taskDoneShareMessage(n) {
  return "今日はタスクを" + n + "個やり切りました✅ 有言実行！";
}

// 達成シェア欄への投稿を共通化（show_in_communityがFALSEの生徒は投稿しない）。
// opts.category: 種類。opts.dailyCap: 1人の同日投稿の上限（既定2）。
// opts.cooldownDays: 同じ人・同カテゴリを再投稿しない日数（偏り防止）。
function postAchievementMessage(studentEmail, message, opts) {
  const user = sheetToObjects(getSheet("Users")).find(u => u.student_email === studentEmail);
  if (!user || String(user.show_in_community || "").toUpperCase() === "FALSE") return;
  opts = opts || {};
  const sheet = getAchievementsSheet();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const catIdx = headers.indexOf("category");
  const today = formatDate(new Date());

  // 偏り防止: 同じ人が1日にシェア欄を独占しないよう上限を設ける
  const mine = sheetToObjects(sheet).filter(r => r.student_email === studentEmail);
  const cap = opts.dailyCap || 2;
  if (mine.filter(r => r.date === today).length >= cap) return;
  // 偏り防止: 同じ種類（例:高スコア）を短期間に同じ人で連発しない
  if (opts.category && opts.cooldownDays) {
    const cutoff = formatDate(new Date(Date.now() - opts.cooldownDays * 86400000));
    if (mine.some(r => r.category === opts.category && r.date >= cutoff)) return;
  }

  const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  const id = "ach_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
  const row = [id, today, studentEmail, user.nickname || "名無しさん", user.avatar || "🦊", message, now];
  // categoryは列位置に合わせて入れる（列が末尾でない可能性に備える）
  if (catIdx >= row.length) { while (row.length < catIdx) row.push(""); row.push(opts.category || ""); }
  else if (catIdx !== -1) { row[catIdx] = opts.category || ""; }
  sheet.appendRow(row);
}

function postHighScoreAchievement(studentEmail, score) {
  if (Number(score) < HIGH_SCORE_ACHIEVEMENT_THRESHOLD) return;
  // 高スコアの常連が毎日フィードを埋めないよう、同じ人は3日に1回まで
  postAchievementMessage(studentEmail, pickMsg(HIGH_SCORE_MESSAGES), { category: "high_score", cooldownDays: 3 });
}

// 目標に関連した記録が節目（10・25・50…時間帯）に到達した時、LINEで祝福メッセージを
// 送り、達成シェア欄にも投稿する。ブロック数はUsersシートの累計カウンタで管理し、
// 記録全件を毎回スキャンしなくて済むようにしている
const GOAL_MILESTONES = [10, 25, 50, 100, 200, 365, 500, 1000];
function incrementGoalBlocksAndNotify(studentEmail, count) {
  if (!count || count <= 0) return;
  const sheet = getSheet("Users");
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  let colIdx = headers.indexOf("goal_blocks_total");
  if (colIdx === -1) { colIdx = headers.length; sheet.getRange(1, colIdx + 1).setValue("goal_blocks_total"); }
  const emailIdx = headers.indexOf("student_email");
  const lineIdx = headers.indexOf("line_user_id");
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][emailIdx]) !== studentEmail) continue;
    const before = Number(data[i][colIdx]) || 0;
    const after = before + count;
    sheet.getRange(i + 1, colIdx + 1).setValue(after);
    const crossed = GOAL_MILESTONES.find(m => before < m && after >= m);
    if (crossed) {
      const lineUserId = data[i][lineIdx];
      if (lineUserId) {
        sendLineMessage(lineUserId, "🎯 目標に関連した記録が" + crossed + "時間帯に到達しました！\n積み重ねが着実に形になっています。この調子で続けましょう💪");
      }
      postAchievementMessage(studentEmail, "目標に向けた取り組みが" + crossed + "時間帯を達成しました🎯", { category: "goal_milestone" });
    }
    return;
  }
}

// 直近の達成シェアを新しい順に返す（本人特定につながる情報はニックネーム・アバターのみ。点数等の具体的な中身は一切含めない）
function getAchievements(studentEmail) {
  const allUsers = sheetToObjects(getSheet("Users"));
  const hiddenEmails = new Set(
    allUsers.filter(u => String(u.show_in_community || "").toUpperCase() === "FALSE").map(u => u.student_email)
  );
  // ラインの分離：シェア欄も学生は学生同士、クライアントはクライアント同士だけ見える
  const cohortByEmail = new Map(allUsers.map(u => [u.student_email, String(u.cohort || "").trim()]));
  const myCohortA = cohortByEmail.get(studentEmail) || "";
  // 「みんなの頑張り」を非表示にしている本人には、他の生徒の名前を見せない（お互いに匿名化する）
  const callerHidden = hiddenEmails.has(studentEmail);
  const rows = sheetToObjects(getAchievementsSheet())
    .filter(r => !hiddenEmails.has(r.student_email) && (cohortByEmail.get(r.student_email) || "") === myCohortA)
    .sort((a, b) => b.created_at > a.created_at ? 1 : -1)
    .slice(0, 30)
    .map(r => {
      const isMe = r.student_email === studentEmail;
      return {
        id: r.achievement_id,
        nickname: (callerHidden && !isMe) ? "匿名さん" : r.nickname,
        avatar: (callerHidden && !isMe) ? "🙈" : r.avatar,
        message: r.message, date: r.date
      };
    });
  return { ok: true, data: rows };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// コーチCRM（/coach/ 画面用API）
// データは全て同じスプレッドシートを読む「別の窓口」。
// コーチングノートはCoachingNotesシートに保存し、v1ではコーチ内部用のみ
// （生徒には非表示）。ただしAIコーチのコンテキストには反映される。
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// コーチ認可: Coachesシートに登録されたメールのみAPIを使える
function verifyCoach(coachEmail) {
  if (!coachEmail) return null;
  return sheetToObjects(getSheet("Coaches")).find(c => c.coach_email === coachEmail) || null;
}

// 担当チェック: コーチは自分の担当生徒のデータしか見られない。
// JIROKUに登録済みならUsersシートで判定。まだ未登録でもコーチが手動で
// クライアントとして追加していれば（StudentProfile.coach_email）担当と認める
function coachOwnsStudent(coachEmail, studentEmail) {
  const user = sheetToObjects(getSheet("Users")).find(u => u.student_email === studentEmail);
  if (user && user.coach_email === coachEmail) return user;

  const profile = getStudentProfile(studentEmail);
  if (profile && profile.coach_email === coachEmail) {
    return {
      student_email: studentEmail,
      name: profile.name || studentEmail,
      nickname: profile.name || studentEmail,
      avatar: "🦊",
      streak: 0,
      goal: "", goal_deadline: "", goal2: "", goal_deadline2: "", goal3: "", goal_deadline3: "",
      joined_at: "",
      coach_email: coachEmail
    };
  }
  return null;
}

function getCoachingNotesSheet() {
  let sheet = getSheet("CoachingNotes");
  if (!sheet) {
    sheet = SpreadsheetApp.openById(SPREADSHEET_ID).insertSheet("CoachingNotes");
    sheet.appendRow(["note_id", "coach_email", "student_email", "date", "content", "next_theme", "promises", "created_at", "unverified"]);
    return sheet;
  }
  // 既存シートに後から追加された列（unverified）が無い場合の自己修復
  const lastCol = sheet.getLastColumn();
  const headers = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  if (!headers.includes("unverified")) {
    sheet.getRange(1, headers.length + 1).setValue("unverified");
  }
  return sheet;
}

// 生徒一覧ダッシュボード: 担当生徒の状態を一目で。
// JIROKU利用中の生徒に加え、まだJIROKUに登録していないがコーチが
// 手動で追加したクライアント（契約書・Stripe情報のみ）も一覧に含める
// 生徒メールアドレスをキーに配列をグルーピングするための汎用ヘルパー。
// ループ内で毎回 .filter() するO(M×N)の検索を、事前構築したMapのO(1)参照に置き換える
function groupBy(arr, key) {
  const map = new Map();
  arr.forEach(item => {
    const k = item[key];
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  });
  return map;
}

function coachGetStudents(coachEmail) {
  if (!verifyCoach(coachEmail)) return { ok: false, error: "not a coach" };

  // 各シートの読み込みは1回ずつ。DailyLogはcomputeAllStatusesにもそのまま渡し、
  // 内部でもう一度読み直させない
  const allUsers = sheetToObjects(getSheet("Users"));
  const jirokuUsers = allUsers.filter(u => u.coach_email === coachEmail && u.is_active.toUpperCase() === "TRUE");
  const allLogs = sheetToObjects(getSheet("DailyLog"));
  const statuses = computeAllStatuses(allLogs);
  const allReports = sheetToObjects(getSheet("Reports"));
  const allNotes = sheetToObjects(getCoachingNotesSheet());
  const allProfiles = sheetToObjects(getStudentProfileSheet());
  const jirokuEmails = new Set(jirokuUsers.map(u => u.student_email));

  // メールアドレスでグルーピングして、生徒ごとのループ内でO(1)参照できるようにする
  const logsByEmail = groupBy(allLogs, "student_email");
  const reportsByEmail = groupBy(allReports, "student_email");
  const notesByEmail = groupBy(allNotes, "student_email");
  const profileByEmail = new Map(allProfiles.map(p => [p.student_email, p]));

  const data = jirokuUsers.map(u => {
    const logs = logsByEmail.get(u.student_email) || [];
    const lastLogDate = logs.length ? logs.map(l => l.date).sort().pop() : null;
    const reports = (reportsByEmail.get(u.student_email) || []).sort((a,b)=>b.date>a.date?1:-1);
    const notes = (notesByEmail.get(u.student_email) || []).sort((a,b)=>b.date>a.date?1:-1);
    const status = statuses[u.student_email];
    const profile = profileByEmail.get(u.student_email);
    const contractEnd = profile ? profile.contract_end : "";
    const daysToEnd = contractEnd ? Math.ceil((new Date(contractEnd) - new Date()) / 86400000) : null;
    return {
      email: u.student_email,
      name: u.name,
      nickname: u.nickname || u.name,
      avatar: u.avatar || "🦊",
      streak: Number(u.streak || 0),
      lastLogDate: lastLogDate,
      latestReport: reports[0] ? { date: reports[0].date, score: Number(reports[0].score) } : null,
      prevReportScore: reports[1] ? Number(reports[1].score) : null,
      statusScore: status ? status.score : 0,
      lastCoachingDate: notes[0] ? notes[0].date : null,
      goal: u.goal || "",
      contractEnd: contractEnd || "",
      contractDaysLeft: daysToEnd,
      joinedJiroku: true,
      cohort: u.cohort || "",
      showInCommunity: String(u.show_in_community || "").toUpperCase() !== "FALSE"
    };
  });

  // JIROKU未登録だがコーチが手動追加したクライアント
  allProfiles
    .filter(p => p.coach_email === coachEmail && !jirokuEmails.has(p.student_email))
    .forEach(p => {
      const notes = (notesByEmail.get(p.student_email) || []).sort((a,b)=>b.date>a.date?1:-1);
      const contractEnd = p.contract_end || "";
      const daysToEnd = contractEnd ? Math.ceil((new Date(contractEnd) - new Date()) / 86400000) : null;
      data.push({
        email: p.student_email,
        name: p.name || p.student_email,
        nickname: p.name || p.student_email,
        avatar: "🦊",
        streak: 0,
        lastLogDate: null,
        latestReport: null,
        statusScore: 0,
        lastCoachingDate: notes[0] ? notes[0].date : null,
        goal: "",
        contractEnd: contractEnd || "",
        contractDaysLeft: daysToEnd,
        joinedJiroku: false
      });
    });

  // 記録が止まっている生徒を上に（要フォロー順）
  data.sort((a, b) => String(a.lastLogDate||"") > String(b.lastLogDate||"") ? 1 : -1);
  return { ok: true, data: data, isAdmin: verifyAdmin(coachEmail) };
}

// Usersシートの cohort 列（区分ラベル。例「九産大生」）を確保して列indexを返す
function ensureUsersCohortCol(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  let idx = headers.indexOf("cohort");
  if (idx === -1) { idx = headers.length; sheet.getRange(1, idx + 1).setValue("cohort"); }
  return idx;
}

// 指定した「登録日(joined_at)」の生徒をまとめて区分(cohort)タグ付けする管理機能。
// 例：本日一括登録した九産大の学生を全員「九産大生」にする。
function adminTagCohortByJoinDate(email, date, cohort) {
  if (!verifyAdmin(email)) return { ok: false, error: "not admin" };
  if (!date) return { ok: false, error: "missing date" };
  const label = String(cohort || "").slice(0, 40);
  const sheet = getSheet("Users");
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const emailIdx = headers.indexOf("student_email");
  const nameIdx = headers.indexOf("name");
  const joinedIdx = headers.indexOf("joined_at");
  const cohortIdx = ensureUsersCohortCol(sheet);
  const tagged = [];
  for (let i = 1; i < data.length; i++) {
    const rawJ = data[i][joinedIdx];
    const j = rawJ instanceof Date ? Utilities.formatDate(rawJ, "Asia/Tokyo", "yyyy-MM-dd") : String(rawJ || "");
    if (j === date) {
      sheet.getRange(i + 1, cohortIdx + 1).setValue(label);
      tagged.push({ email: data[i][emailIdx], name: data[i][nameIdx] });
    }
  }
  return { ok: true, date: date, cohort: label, count: tagged.length, tagged: tagged };
}

// 直近N日の登録者を一覧で返す（誰が学生かを見分けてタグ付け対象を決めるため）。
function adminListRecentRegistrations(email, days) {
  if (!verifyAdmin(email)) return { ok: false, error: "not admin" };
  const n = Math.max(1, Math.min(60, Number(days) || 7));
  const cutoff = formatDate(new Date(Date.now() - (n - 1) * 86400000));
  const users = sheetToObjects(getSheet("Users"));
  const list = users
    .map(u => {
      const j = u.joined_at instanceof Date ? Utilities.formatDate(u.joined_at, "Asia/Tokyo", "yyyy-MM-dd") : String(u.joined_at || "");
      return { email: u.student_email, name: u.name, joined_at: j, cohort: u.cohort || "" };
    })
    .filter(u => u.joined_at && u.joined_at >= cutoff)
    .sort((a, b) => a.joined_at < b.joined_at ? 1 : -1);
  return { ok: true, sinceDate: cutoff, count: list.length, users: list };
}

// メールアドレスのリスト（カンマ区切り）で、まとめて区分(cohort)タグ付けする。
function adminTagCohortByEmails(email, emailsCsv, cohort) {
  if (!verifyAdmin(email)) return { ok: false, error: "not admin" };
  const label = String(cohort || "").slice(0, 40);
  const targets = String(emailsCsv || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  if (targets.length === 0) return { ok: false, error: "no emails" };
  const sheet = getSheet("Users");
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const emailIdx = headers.indexOf("student_email");
  const nameIdx = headers.indexOf("name");
  const cohortIdx = ensureUsersCohortCol(sheet);
  const set = new Set(targets);
  const tagged = [];
  for (let i = 1; i < data.length; i++) {
    if (set.has(String(data[i][emailIdx]).trim().toLowerCase())) {
      sheet.getRange(i + 1, cohortIdx + 1).setValue(label);
      tagged.push({ email: data[i][emailIdx], name: data[i][nameIdx] });
    }
  }
  return { ok: true, cohort: label, count: tagged.length, tagged: tagged };
}

// コーチが個別に生徒の区分(cohort)を設定・変更する（空文字で解除）。
function coachSetCohort(coachEmail, body) {
  if (!verifyCoach(coachEmail)) return { ok: false, error: "not a coach" };
  const studentEmail = String(body.targetEmail || "");
  if (!coachOwnsStudent(coachEmail, studentEmail)) return { ok: false, error: "not your student" };
  const label = String(body.cohort || "").slice(0, 40);
  const sheet = getSheet("Users");
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const emailIdx = headers.indexOf("student_email");
  const cohortIdx = ensureUsersCohortCol(sheet);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][emailIdx]) === studentEmail) {
      sheet.getRange(i + 1, cohortIdx + 1).setValue(label);
      return { ok: true, cohort: label };
    }
  }
  return { ok: false, error: "student not found" };
}

// JIROKU未登録のクライアントを手動でCRMに追加する（契約書・Stripe情報だけ先に管理したい場合）
// 「Chatworkから取り込む」で誤って自分自身のメールアドレスに紐付けてしまった
// 場合の復旧用。coachEmailのプロフィールからchatwork_id/room_idを取り除いた上で、
// 正しいメールアドレスへ改めて取り込む（一度きりの手動復旧用ヘルパー）
function adminFixChatworkMisassignment(coachEmail, wrongEmail, correctEmail, correctName) {
  if (!verifyCoach(coachEmail)) return { ok: false, error: "not a coach" };
  const sheet = getStudentProfileSheet();
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const emailIdx = headers.indexOf("student_email");
  const cwIdIdx = headers.indexOf("chatwork_id");
  const cwRoomIdx = headers.indexOf("chatwork_room_id");
  let cwId = "", cwRoom = "";
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][emailIdx]) === wrongEmail) {
      cwId = String(data[i][cwIdIdx] || "");
      cwRoom = String(data[i][cwRoomIdx] || "");
      sheet.getRange(i + 1, cwIdIdx + 1).setValue("");
      sheet.getRange(i + 1, cwRoomIdx + 1).setValue("");
      break;
    }
  }
  if (!cwId) return { ok: false, error: "wrongEmail側にchatwork_idが見つかりませんでした" };
  const addResult = coachAddClient(coachEmail, { email: correctEmail, name: correctName, chatwork_id: cwId, chatwork_room_id: cwRoom });
  return { ok: true, movedChatworkId: cwId, movedRoomId: cwRoom, addResult: addResult };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// セッション管理（見込み客パイプライン）
// SNS→予約→実施→仕分け(アプリ/コーチング/見送り)までを管理する。
// 既存の生徒(Users/StudentProfile)とは別に、成約前のリードを扱う軽い台帳
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function getSessionLeadsSheet() {
  let sheet = getSheet("SessionLeads");
  if (!sheet) {
    sheet = SpreadsheetApp.openById(SPREADSHEET_ID).insertSheet("SessionLeads");
    sheet.appendRow(["lead_id", "coach_email", "name", "contact", "status", "memo", "created_at", "updated_at", "answers"]);
  }
  return sheet;
}

function coachListLeads(coachEmail) {
  if (!verifyCoach(coachEmail)) return { ok: false, error: "not a coach" };
  const leads = sheetToObjects(getSessionLeadsSheet())
    .filter(l => l.coach_email === coachEmail)
    .sort((a, b) => (b.updated_at || "") > (a.updated_at || "") ? 1 : -1);
  return { ok: true, data: leads };
}

function coachSaveLead(coachEmail, body) {
  if (!verifyCoach(coachEmail)) return { ok: false, error: "not a coach" };
  const name = String(body.name || "").trim();
  if (!name) return { ok: false, error: "name required" };
  const sheet = getSessionLeadsSheet();
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idIdx = headers.indexOf("lead_id");
  const coachIdx = headers.indexOf("coach_email");
  const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  const leadId = String(body.lead_id || "");

  // ヒアリング質問への回答（JSON文字列）。列がなければ自動追加（既存シートの自己修復）
  let answersIdx = headers.indexOf("answers");
  if (answersIdx === -1) { answersIdx = headers.length; sheet.getRange(1, answersIdx + 1).setValue("answers"); headers.push("answers"); }

  if (leadId) {
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idIdx]) === leadId) {
        if (String(data[i][coachIdx]) !== coachEmail) return { ok: false, error: "not your lead" };
        sheet.getRange(i + 1, headers.indexOf("name") + 1).setValue(name);
        sheet.getRange(i + 1, headers.indexOf("contact") + 1).setValue(String(body.contact || ""));
        sheet.getRange(i + 1, headers.indexOf("status") + 1).setValue(String(body.status || "予約前"));
        sheet.getRange(i + 1, headers.indexOf("memo") + 1).setValue(String(body.memo || "").slice(0, 1000));
        if (body.answers !== undefined) sheet.getRange(i + 1, answersIdx + 1).setValue(String(body.answers).slice(0, 20000));
        sheet.getRange(i + 1, headers.indexOf("updated_at") + 1).setValue(now);
        return { ok: true, lead_id: leadId };
      }
    }
    return { ok: false, error: "lead not found" };
  }

  const newId = "lead_" + Date.now();
  const row = headers.map(h => {
    if (h === "lead_id") return newId;
    if (h === "coach_email") return coachEmail;
    if (h === "name") return name;
    if (h === "contact") return String(body.contact || "");
    if (h === "status") return String(body.status || "予約前");
    if (h === "memo") return String(body.memo || "").slice(0, 1000);
    if (h === "answers") return body.answers !== undefined ? String(body.answers).slice(0, 20000) : "";
    if (h === "created_at" || h === "updated_at") return now;
    return "";
  });
  sheet.appendRow(row);
  return { ok: true, lead_id: newId };
}

// ヒアリング内容とタイプ（アプリ利用/コーチング/経営者）から、その相手専用の
// セールストーク台本をAIが生成する。生成結果はリードのsales_talk列に保存され、
// 次に開いた時も見られる。公開こそしないが成約に直結する成果物のためOpusを使う
function coachGenerateSalesTalk(coachEmail, body) {
  if (!verifyCoach(coachEmail)) return { ok: false, error: "not a coach" };
  const apiKey = PropertiesService.getScriptProperties().getProperty("CLAUDE_API_KEY");
  if (!apiKey) return { ok: false, error: "CLAUDE_API_KEY未設定" };

  const type = String(body.type || "未判定");
  const qa = String(body.qa || "").slice(0, 8000);
  const name = String(body.name || "見込み客");
  if (!qa.trim()) return { ok: false, error: "ヒアリング内容が空です。先に質問への回答を入力してください" };

  const typeGuide = {
    "アプリ利用": "月1,980円（7日間無料トライアルあり）のアプリのみプラン。ハードルは低いので、迷わせず「まず7日間試す」への即決を促す。同時に、伸びしろがある相手なら将来のコーチングへの布石も1文だけ入れる",
    "コーチング": "コーチングプラン（3ヶ月33万円・6ヶ月66万円・1年125万円、税込）。金額を伝える前に価値と変化の确度を十分に積み上げる。決断の場面では沈黙を恐れない。分割の選択肢も用意",
    "経営者": "経営者向け「時間経営」プログラム（個別提案・高単価）。生産性ではなく「経営判断の質」「時間の決算書」「記録が会社の資産・事業承継になる」という経営の言葉で語る。安売りせず、対等なパートナーとして提案する",
    "未判定": "まだタイプが定まっていない。ヒアリング内容からアプリのみ/コーチング/経営者向けのどれが最適かをまず判定し、その判定理由も添えること"
  };

  const prompt = `あなたはJIROKU（時間記録アプリ＋時間管理コーチング）のトップセールスコーチです。以下のヒアリング内容をもとに、この相手専用のセールストーク台本を作ってください。

【相手】${name}さん（見込みタイプ: ${type}）
【タイプ別の提案方針】${typeGuide[type] || typeGuide["未判定"]}

【ヒアリング内容（コーチが実際に聞き取った回答）】
${qa}

【セールスの原則】
- 相手が話した言葉をそのまま引用して使う（「先ほど◯◯とおっしゃっていましたが」）
- 売り込みではなく「相手の理想を実現する手段」として提示する
- 課題を放置した場合のコスト（失っている時間・お金・機会）を、相手の回答から具体的に言語化する
- 即決を迫らないが、その場で「次のアクションと期日」は必ず決める
- 誇張・保証・煽りはしない。誠実に

以下のJSON形式のみで返してください（説明文不要）:
{
  "judged_type": "<アプリ利用|コーチング|経営者 のどれが最適かの判定（typeが未判定の場合のみ理由も）>",
  "opening": "<セールスパートの入り方。相手の言葉を引用した共感と課題の要約（2-3文の話し言葉）>",
  "bridge": "<課題を放置した場合のコストと、理想との橋渡し（2-3文の話し言葉）>",
  "pitch": "<プラン提示のトーク。価格の伝え方まで含む（3-4文の話し言葉）>",
  "objections": [ { "objection": "<想定される反論・懸念>", "response": "<切り返しトーク（話し言葉）>" } ],
  "closing": "<クロージングのトーク。次のアクションと期日を決める形（2-3文の話し言葉）>",
  "caution": "<この相手に対して言ってはいけないこと・注意点を1-2文>"
}
objectionsは、ヒアリング内容から予想されるものを2〜3個。`;

  const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    payload: JSON.stringify({ model: "claude-opus-4-8", max_tokens: 2500, messages: [{ role: "user", content: prompt }] }),
    muteHttpExceptions: true
  });
  const result = JSON.parse(res.getContentText()); logAiUsage(result, "営業トーク生成");
  if (!result.content || !result.content[0]) return { ok: false, error: friendlyClaudeError(res.getContentText()) };

  try {
    const parsed = parseAiJson(result.content[0].text);
    if (!parsed) return { ok: false, error: "生成結果の解析に失敗しました。もう一度お試しください" };

    // リードに紐付けて保存（次に開いた時も見られるように）。sales_talk列は自己修復で追加
    if (body.lead_id) {
      const sheet = getSessionLeadsSheet();
      const data = sheet.getDataRange().getValues();
      const headers = data[0];
      let talkIdx = headers.indexOf("sales_talk");
      if (talkIdx === -1) { talkIdx = headers.length; sheet.getRange(1, talkIdx + 1).setValue("sales_talk"); }
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][headers.indexOf("lead_id")]) === String(body.lead_id) && String(data[i][headers.indexOf("coach_email")]) === coachEmail) {
          sheet.getRange(i + 1, talkIdx + 1).setValue(JSON.stringify(parsed).slice(0, 20000));
          break;
        }
      }
    }
    return { ok: true, data: parsed };
  } catch (e) {
    return { ok: false, error: "JSONパースエラー: " + e.toString() };
  }
}

function coachDeleteLead(coachEmail, body) {
  if (!verifyCoach(coachEmail)) return { ok: false, error: "not a coach" };
  const leadId = String(body.lead_id || "");
  const sheet = getSessionLeadsSheet();
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idIdx = headers.indexOf("lead_id");
  const coachIdx = headers.indexOf("coach_email");
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][idIdx]) === leadId) {
      if (String(data[i][coachIdx]) !== coachEmail) return { ok: false, error: "not your lead" };
      sheet.deleteRow(i + 1);
      return { ok: true };
    }
  }
  return { ok: false, error: "lead not found" };
}

function coachAddClient(coachEmail, body) {
  if (!verifyCoach(coachEmail)) return { ok: false, error: "not a coach" };
  const email = String(body.email || "").trim().toLowerCase();
  const name = String(body.name || "").trim();
  if (!email || !name) return { ok: false, error: "email/name required" };

  const existingUser = sheetToObjects(getSheet("Users")).find(u => u.student_email === email);
  if (existingUser && existingUser.coach_email && existingUser.coach_email !== coachEmail) {
    return { ok: false, error: "既に別のコーチが担当しています" };
  }

  const sheet = getStudentProfileSheet();
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const emailIdx = headers.indexOf("student_email");
  const coachIdx = headers.indexOf("coach_email");
  const nameIdx = headers.indexOf("name");
  const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });

  const chatworkId = String(body.chatwork_id || "");
  const chatworkRoomId = String(body.chatwork_room_id || "");

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][emailIdx]) === email) {
      const existingCoach = String(data[i][coachIdx] || "");
      if (existingCoach && existingCoach !== coachEmail) {
        return { ok: false, error: "既に別のコーチが担当しています" };
      }
      sheet.getRange(i + 1, coachIdx + 1).setValue(coachEmail);
      if (!data[i][nameIdx]) sheet.getRange(i + 1, nameIdx + 1).setValue(name);
      if (chatworkId) sheet.getRange(i + 1, headers.indexOf("chatwork_id") + 1).setValue(chatworkId);
      if (chatworkRoomId) sheet.getRange(i + 1, headers.indexOf("chatwork_room_id") + 1).setValue(chatworkRoomId);
      sheet.getRange(i + 1, headers.indexOf("updated_at") + 1).setValue(now);
      return { ok: true };
    }
  }

  const row = headers.map(h => {
    if (h === "student_email") return email;
    if (h === "coach_email") return coachEmail;
    if (h === "name") return name;
    if (h === "updated_at") return now;
    if (h === "chatwork_id") return chatworkId;
    if (h === "chatwork_room_id") return chatworkRoomId;
    return "";
  });
  sheet.appendRow(row);
  return { ok: true };
}

// コーチが生徒の課金状態を設定する（半自動運用の要）。
// Stripe入金をコーチが確認 → このAPIで plan_status を paid にして本利用を開放。
// status: "paid"（決済済み・無期限フル）/ "trial"（トライアル再設定）/ "free"（無料招待）/ "expired"（停止）
function coachSetPlanStatus(coachEmail, body) {
  if (!verifyCoach(coachEmail)) return { ok: false, error: "not a coach" };
  const targetEmail = String(body.targetEmail || "").trim().toLowerCase();
  const status = String(body.status || "").trim().toLowerCase();
  if (!targetEmail) return { ok: false, error: "targetEmail required" };
  if (["paid", "trial", "free", "expired"].indexOf(status) === -1) return { ok: false, error: "invalid status" };

  const sheet = getSheet("Users");
  const data = sheet.getDataRange().getValues();
  let headers = data[0];
  const ensureCol = (name) => {
    let idx = headers.indexOf(name);
    if (idx === -1) { idx = headers.length; sheet.getRange(1, idx + 1).setValue(name); headers.push(name); }
    return idx;
  };
  const emailIdx = headers.indexOf("student_email");
  const coachIdx = headers.indexOf("coach_email");
  const planIdx = ensureCol("plan_status");
  const trialIdx = ensureCol("trial_start");

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][emailIdx]).trim().toLowerCase() === targetEmail) {
      // 担当コーチ以外の生徒は操作できない（管理者は除く）
      const owner = String(data[i][coachIdx] || "");
      if (owner && owner !== coachEmail && !verifyAdmin(coachEmail)) return { ok: false, error: "担当外の生徒です" };
      sheet.getRange(i + 1, planIdx + 1).setValue(status);
      if (status === "trial") sheet.getRange(i + 1, trialIdx + 1).setNumberFormat("@").setValue(formatDate(new Date()));
      return { ok: true, plan_status: status };
    }
  }
  return { ok: false, error: "生徒が見つかりません（このメールでアプリ登録が必要）" };
}

// 「みんなの頑張り」（コミュニティランキング）に表示するかどうかを
// コーチ側から生徒ごとに設定する。列がまだ無い古いUsersシートにも
// 自動で列を追加する（他の自己修復パターンと同様）
function coachSetShowInCommunity(coachEmail, body) {
  if (!verifyCoach(coachEmail)) return { ok: false, error: "not a coach" };
  const targetEmail = String(body.targetEmail || "");
  if (!coachOwnsStudent(coachEmail, targetEmail)) return { ok: false, error: "not your student" };

  const sheet = getSheet("Users");
  const data = sheet.getDataRange().getValues();
  let headers = data[0];
  let colIdx = headers.indexOf("show_in_community");
  if (colIdx === -1) {
    colIdx = headers.length;
    sheet.getRange(1, colIdx + 1).setValue("show_in_community");
  }
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][headers.indexOf("student_email")]) === targetEmail) {
      sheet.getRange(i + 1, colIdx + 1).setValue(body.show === false || body.show === "false" ? "FALSE" : "TRUE");
      return { ok: true };
    }
  }
  return { ok: false, error: "student not found" };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 管理者ダッシュボード（全コーチ・全生徒を横断した数字を見る）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function verifyAdmin(email) {
  const admin = adminEmail();
  return !!admin && !!email && email === admin;
}

// 全体のサマリー（累計売上・平均スコア・コーチ別/生徒別の内訳）を返す。
// 「目標達成率」はアプリ側に達成フラグがないため、直近レポートスコア75点以上を
// 「順調」の目安として代用している（正確な達成率ではなく参考値である旨に注意）
function adminGetOverview(email) {
  if (!verifyAdmin(email)) return { ok: false, error: "not admin" };

  const allUsers = sheetToObjects(getSheet("Users")).filter(u => String(u.is_active).toUpperCase() === "TRUE");
  const coaches = sheetToObjects(getSheet("Coaches"));
  const profiles = sheetToObjects(getStudentProfileSheet());
  const profileByEmail = new Map(profiles.map(p => [p.student_email, p]));
  const allReports = sheetToObjects(getSheet("Reports"));
  const reportsByEmail = groupBy(allReports, "student_email");
  const allLogs = sheetToObjects(getSheet("DailyLog"));
  const logsByEmail = groupBy(allLogs, "student_email");
  const statuses = computeAllStatuses(allLogs);
  const allNotes = sheetToObjects(getCoachingNotesSheet());
  const notesByCoach = groupBy(allNotes, "coach_email");

  let totalRevenue = 0;
  let revenueCurrency = "jpy";
  profiles.forEach(p => {
    if (p.stripe_total_paid) {
      totalRevenue += Number(p.stripe_total_paid) || 0;
      if (p.stripe_currency) revenueCurrency = p.stripe_currency;
    }
  });

  const students = allUsers.map(u => {
    const reports = (reportsByEmail.get(u.student_email) || []).sort((a,b)=>b.date>a.date?1:-1);
    const logs = logsByEmail.get(u.student_email) || [];
    const lastLogDate = logs.length ? logs.map(l => l.date).sort().pop() : null;
    const profile = profileByEmail.get(u.student_email);
    const status = statuses[u.student_email];
    const lineLinked = !!String(u.line_user_id || "").trim();
    // 「アクティブ」= 記録あり または LINE連携済み。どちらも無い＝登録だけの未定着。
    // LINE未連携でも記録している人は消えないよう、記録の有無をORで見る
    const active = logs.length > 0 || lineLinked;
    return {
      email: u.student_email,
      name: u.name,
      coachEmail: u.coach_email || "",
      cohort: String(u.cohort || "").trim(),
      lineLinked: lineLinked,
      active: active,
      latestScore: reports[0] ? Number(reports[0].score) : null,
      statusScore: status ? status.score : 0,
      lastLogDate: lastLogDate,
      stripeTotalPaid: profile ? Number(profile.stripe_total_paid || 0) : 0
    };
  });

  // 未定着（登録のみ）は別枠に集約し、メインの一覧・数字はアクティブな人だけで綺麗に見せる
  const untetheredList = students.filter(s => !s.active);
  const untethered = {
    count: untetheredList.length,
    studentCount: untetheredList.filter(s => s.cohort).length,
    names: untetheredList.map(s => ({ name: s.name, cohort: s.cohort }))
  };
  const activeStudents = students.filter(s => s.active);

  const scored = students.filter(s => s.latestScore !== null);
  const avgScore = scored.length ? Math.round(scored.reduce((sum,s) => sum + s.latestScore, 0) / scored.length) : null;
  const onTrackCount = scored.filter(s => s.latestScore >= 75).length;
  const onTrackRate = scored.length ? Math.round(onTrackCount / scored.length * 100) : null;

  const coachStats = coaches.map(c => {
    const mine = students.filter(s => s.coachEmail === c.coach_email);
    const revenue = mine.reduce((sum,s) => sum + s.stripeTotalPaid, 0);
    const scoredMine = mine.filter(s => s.latestScore !== null);
    const avg = scoredMine.length ? Math.round(scoredMine.reduce((sum,s)=>sum+s.latestScore,0) / scoredMine.length) : null;
    const lastNote = (notesByCoach.get(c.coach_email) || []).sort((a,b)=>b.date>a.date?1:-1)[0];
    return {
      coachEmail: c.coach_email,
      coachName: c.coach_name || c.coach_email,
      studentCount: mine.length,
      avgScore: avg,
      revenue: revenue,
      lastCoachingDate: lastNote ? lastNote.date : null
    };
  }).sort((a,b) => b.studentCount - a.studentCount);

  // ── 運営メトリクス ──
  // セグメント（core=cohortなし / student=cohortあり）ごとの獲得・継続の漏斗と、
  // 通知インフラ（LINE連携）・品質（レポート欠落）・満足度（月次アンケート）を1画面に出す
  const todayStr = formatDate(new Date());
  const daysAgoStr = n => { const d = new Date(); d.setDate(d.getDate() - n); return formatDate(d); };
  const d3 = daysAgoStr(3), d7 = daysAgoStr(7);
  const segmentOf = u => String(u.cohort || "").trim() ? "student" : "core";
  const segStats = { core: null, student: null };
  ["core", "student"].forEach(seg => {
    const us = allUsers.filter(u => segmentOf(u) === seg);
    const withLog = us.filter(u => (logsByEmail.get(u.student_email) || []).length > 0);
    const lastLogOf = u => { const ls = logsByEmail.get(u.student_email) || []; return ls.length ? ls.map(l => l.date).sort().pop() : null; };
    segStats[seg] = {
      registered: us.length,
      everLogged: withLog.length,
      neverLogged: us.length - withLog.length,
      active3: withLog.filter(u => lastLogOf(u) >= d3).length,
      active7: withLog.filter(u => lastLogOf(u) >= d7).length,
      lineLinked: us.filter(u => String(u.line_user_id || "").trim()).length
    };
  });
  // 品質: 直近7日で「記録があるのにレポートがない」件数（昨日まで）
  const haveReportKeys = new Set(allReports.map(r => r.student_email + "|" + r.date));
  const activeEmails = new Set(allUsers.map(u => u.student_email));
  const missingKeys = new Set();
  allLogs.forEach(l => {
    if (!activeEmails.has(l.student_email)) return;
    if (l.date >= d7 && l.date < todayStr && !haveReportKeys.has(l.student_email + "|" + l.date)) {
      missingKeys.add(l.student_email + "|" + l.date);
    }
  });
  // 活動量: 直近7日の記録件数・記録した人数
  const recentLogs = allLogs.filter(l => l.date >= d7 && activeEmails.has(l.student_email));
  const weeklyLogCount = recentLogs.length;
  const weeklyLoggers = new Set(recentLogs.map(l => l.student_email)).size;
  // 満足度: 月次アンケート（直近90日の平均と最新コメント）
  const surveys = sheetToObjects(getSurveySheet());
  const d90 = daysAgoStr(90);
  const recentSurveys = surveys.filter(s => s.date >= d90);
  const satVals = recentSurveys.map(s => Number(s.satisfaction)).filter(n => n >= 1 && n <= 5);
  const userByEmailForSurvey = new Map(allUsers.map(u => [u.student_email, u]));
  const surveyComments = recentSurveys
    .filter(s => String(s.comment || "").trim())
    .sort((a, b) => b.date > a.date ? 1 : -1)
    .slice(0, 15)
    .map(s => {
      const u = userByEmailForSurvey.get(s.student_email);
      return { date: s.date, name: u ? (u.nickname || u.name) : s.student_email, satisfaction: Number(s.satisfaction) || null, comment: String(s.comment).trim() };
    });

  return { ok: true, data: {
    totalRevenue, revenueCurrency,
    activeStudentCount: allUsers.length,
    coachCount: coaches.length,
    avgScore, onTrackRate, onTrackCount, scoredCount: scored.length,
    coachStats: coachStats,
    students: activeStudents.sort((a,b) => b.statusScore - a.statusScore),
    activeCount: activeStudents.length,
    untethered: untethered,
    ops: {
      segments: segStats,
      weeklyLogCount, weeklyLoggers,
      missingReports7d: missingKeys.size,
      survey: {
        count90d: satVals.length,
        avgSatisfaction: satVals.length ? Math.round(satVals.reduce((a, b) => a + b, 0) / satVals.length * 10) / 10 : null,
        comments: surveyComments
      }
    }
  } };
}

// ── 月次満足度アンケート ──
function getSurveySheet() {
  let sheet = getSheet("Surveys");
  if (!sheet) {
    sheet = getSpreadsheet().insertSheet("Surveys");
    sheet.appendRow(["date", "student_email", "satisfaction", "comment", "created_at"]);
  }
  return sheet;
}

// 満足度(1〜5)と任意コメントを保存。同じ月の再送信は上書きせず追加のまま
// （最新を集計に使う場面はないため、素直に追記のみ）
function submitSurvey(studentEmail, body) {
  const sat = Number(body.satisfaction);
  if (!(sat >= 1 && sat <= 5)) return { ok: false, error: "満足度は1〜5で指定してください" };
  const comment = String(body.comment || "").trim().slice(0, 1000);
  getSurveySheet().appendRow([formatDate(new Date()), studentEmail, sat, comment, new Date().toISOString()]);
  return { ok: true, data: { saved: true } };
}

// 過去のレポート（breakdown_reasonsが未生成のもの）に、後からコメントだけを
// 追加する。既存の点数（score・breakdown）は一切変更しない。
// breakdown自体が保存されていない古いレポート（内訳データが無い）は、
// 何を根拠にコメントすべきか分からないためスキップする
function adminBackfillReportReasons(email) {
  if (!verifyAdmin(email)) return { ok: false, error: "not admin" };
  const apiKey = PropertiesService.getScriptProperties().getProperty("CLAUDE_API_KEY");
  if (!apiKey) return { ok: false, error: "CLAUDE_API_KEY が未設定" };

  const sheet = getSheet("Reports");
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const dateIdx = headers.indexOf("date");
  const emailIdx = headers.indexOf("student_email");
  let bIdx = headers.indexOf("breakdown");
  let rIdx = headers.indexOf("breakdown_reasons");
  if (rIdx === -1) { rIdx = headers.length; sheet.getRange(1, rIdx + 1).setValue("breakdown_reasons"); }

  const allLogs = sheetToObjects(getSheet("DailyLog"));
  const logsByKey = groupBy(allLogs, "student_email");

  let updated = 0, skippedNoBreakdown = 0, skippedError = 0;
  for (let i = 1; i < data.length; i++) {
    const existingReasons = data[i][rIdx];
    if (existingReasons) continue;
    const breakdownRaw = data[i][bIdx];
    if (!breakdownRaw) { skippedNoBreakdown++; continue; }
    let breakdown;
    try { breakdown = JSON.parse(breakdownRaw); } catch (e) { skippedNoBreakdown++; continue; }

    const studentEmail = String(data[i][emailIdx]);
    const date = String(data[i][dateIdx]);
    const logs = (logsByKey.get(studentEmail) || []).filter(l => l.date === date);
    const logsText = logs.map(l => l.time_block + " - " + l.task + "（集中度：" + l.focus_level + (l.goal_related === "true" ? "、目標関連" : "") + (l.memo ? "、メモ：" + l.memo : "") + "）").join("\n") || "記録なし";

    const prompt = `以下は生徒のある日の記録と、その日について既に採点済みの内訳（20点満点×5項目）です。点数は変更せず、それぞれの点数についての短いひとことコメントだけを日本語で書いてください。

【その日の記録】
${logsText}

【既に採点済みの内訳】
records: ${breakdown.records}, memo: ${breakdown.memo}, focus: ${breakdown.focus}, goal: ${breakdown.goal}, consistency: ${breakdown.consistency}

以下のJSON形式のみで返してください（説明文不要）:
{ "records": "<コメント1文>", "memo": "<同上>", "focus": "<同上>", "goal": "<同上>", "consistency": "<同上>" }`;

    try {
      const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        payload: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 400, messages: [{ role: "user", content: prompt }] }),
        muteHttpExceptions: true
      });
      const result = JSON.parse(res.getContentText()); logAiUsage(result, "レポート理由の補完");
      if (!result.content || !result.content[0]) { skippedError++; continue; }
      const m = result.content[0].text.match(/\{[\s\S]*\}/);
      if (!m) { skippedError++; continue; }
      const reasons = JSON.parse(m[0]);
      sheet.getRange(i + 1, rIdx + 1).setValue(JSON.stringify(reasons));
      updated++;
    } catch (e) {
      Logger.log("backfill error row " + (i + 1) + ": " + e);
      skippedError++;
    }
  }
  Logger.log(`backfill完了: 更新${updated}件 / 内訳なしでスキップ${skippedNoBreakdown}件 / エラーでスキップ${skippedError}件`);
  return { ok: true, data: { updated, skippedNoBreakdown, skippedError } };
}

// Chatworkの連絡先一覧を取得し、まだCRMに取り込んでいない相手だけを返す。
// Chatwork APIはメールアドレスを返さないため、氏名・Chatwork ID・ルームIDのみ取得し、
// メールアドレスはコーチが取り込み時に手入力する運用とする
function coachListChatworkContacts(coachEmail) {
  if (!verifyCoach(coachEmail)) return { ok: false, error: "not a coach" };
  const token = PropertiesService.getScriptProperties().getProperty("CHATWORK_API_TOKEN");
  if (!token) return { ok: false, error: "CHATWORK_API_TOKEN が未設定" };

  try {
    const res = UrlFetchApp.fetch("https://api.chatwork.com/v2/contacts", {
      headers: { "X-ChatWorkToken": token },
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) {
      return { ok: false, error: "Chatwork API error: " + res.getResponseCode() };
    }
    const contacts = JSON.parse(res.getContentText());
    const alreadyImported = new Set(
      sheetToObjects(getStudentProfileSheet())
        .filter(p => p.chatwork_id)
        .map(p => p.chatwork_id)
    );
    const data = contacts
      .filter(c => !alreadyImported.has(String(c.account_id)))
      .map(c => ({
        chatwork_id: String(c.account_id),
        room_id: String(c.room_id),
        name: c.name || "",
        organization_name: c.organization_name || "",
        avatar_image_url: c.avatar_image_url || ""
      }));
    return { ok: true, data: data };
  } catch (e) {
    return { ok: false, error: "chatwork fetch failed: " + e.toString() };
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Chatworkメッセージの自動連携（過去のやり取り・今後の会話をCRMに取り込む）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function getChatworkMessagesSheet() {
  let sheet = getSheet("ChatworkMessages");
  if (!sheet) {
    sheet = SpreadsheetApp.openById(SPREADSHEET_ID).insertSheet("ChatworkMessages");
    sheet.appendRow(["message_id", "room_id", "student_email", "account_id", "sender_name", "body", "send_time", "synced_at"]);
  }
  return sheet;
}

// Chatwork API v2は「未読メッセージの取得」が基本で、任意の過去日付までの
// ページングには対応していない。force=1で直近の最新メッセージ（最大100件）を
// 既読状態に関わらず取得できるので、それを定期的に呼び続けて差分（新規message_id）
// だけ蓄積していく。初回実行時にその時点の直近100件が「過去分」として取り込まれる
function fetchChatworkRoomMessages(roomId, token) {
  const res = UrlFetchApp.fetch(`https://api.chatwork.com/v2/rooms/${roomId}/messages?force=1`, {
    headers: { "X-ChatWorkToken": token },
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code === 204) return []; // 新着なし
  if (code !== 200) throw new Error("Chatwork API error: " + code);
  return JSON.parse(res.getContentText());
}

// 全生徒分のChatworkメッセージをまとめて同期する（定期トリガー）
function syncChatworkMessages() {
  const token = PropertiesService.getScriptProperties().getProperty("CHATWORK_API_TOKEN");
  if (!token) { Logger.log("CHATWORK_API_TOKEN が未設定"); return; }

  const profiles = sheetToObjects(getStudentProfileSheet()).filter(p => p.chatwork_room_id);
  if (profiles.length === 0) return;

  const sheet = getChatworkMessagesSheet();
  const existingIds = new Set(sheetToObjects(sheet).map(m => m.message_id));
  const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  const newRows = [];

  profiles.forEach(p => {
    try {
      const messages = fetchChatworkRoomMessages(p.chatwork_room_id, token);
      messages.forEach(m => {
        const messageId = String(m.message_id);
        if (existingIds.has(messageId)) return;
        existingIds.add(messageId);
        newRows.push([
          messageId, String(p.chatwork_room_id), p.student_email,
          String(m.account.account_id), m.account.name || "",
          String(m.body || "").slice(0, 2000),
          new Date(Number(m.send_time) * 1000).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }),
          now
        ]);
      });
    } catch (e) {
      Logger.log("Chatwork同期失敗 (" + p.student_email + "): " + e.toString());
    }
  });

  if (newRows.length > 0) {
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, newRows.length, newRows[0].length).setValues(newRows);
  }
  Logger.log("Chatworkメッセージ同期完了: " + newRows.length + "件追加");
}

// コーチ画面から1人分だけ即時同期する（取り込み直後の確認用）
function coachSyncChatworkOne(coachEmail, params) {
  if (!verifyCoach(coachEmail)) return { ok: false, error: "not a coach" };
  const targetEmail = String(params.targetEmail || "");
  if (!coachOwnsStudent(coachEmail, targetEmail)) return { ok: false, error: "not your student" };
  const token = PropertiesService.getScriptProperties().getProperty("CHATWORK_API_TOKEN");
  if (!token) return { ok: false, error: "CHATWORK_API_TOKEN が未設定" };

  const profile = getStudentProfile(targetEmail);
  if (!profile || !profile.chatwork_room_id) return { ok: false, error: "Chatworkのルームが紐付いていません" };

  try {
    const sheet = getChatworkMessagesSheet();
    const existingIds = new Set(sheetToObjects(sheet).map(m => m.message_id));
    const messages = fetchChatworkRoomMessages(profile.chatwork_room_id, token);
    const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
    const newRows = [];
    messages.forEach(m => {
      const messageId = String(m.message_id);
      if (existingIds.has(messageId)) return;
      newRows.push([
        messageId, String(profile.chatwork_room_id), targetEmail,
        String(m.account.account_id), m.account.name || "",
        String(m.body || "").slice(0, 2000),
        new Date(Number(m.send_time) * 1000).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }),
        now
      ]);
    });
    if (newRows.length > 0) {
      const startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, newRows.length, newRows[0].length).setValues(newRows);
    }
    return { ok: true, data: { imported: newRows.length } };
  } catch (e) {
    return { ok: false, error: "sync failed: " + e.toString() };
  }
}

// 生徒詳細: コーチング前の予習に必要な情報を時系列で
function coachGetStudentDetail(coachEmail, studentEmail) {
  if (!verifyCoach(coachEmail)) return { ok: false, error: "not a coach" };
  const user = coachOwnsStudent(coachEmail, studentEmail);
  if (!user) return { ok: false, error: "not your student" };

  const fourteenDaysAgo = formatDate(new Date(Date.now() - 14 * 86400000));
  const reports = getFilteredRows("Reports", "student_email", studentEmail)
    .sort((a,b)=>b.date>a.date?1:-1).slice(0, 7)
    .map(r => ({ date: r.date, score: Number(r.score), feedback: r.feedback, highlights: r.highlights, improvement: r.improvement, action: r.action }));
  const diaries = sheetToObjects(getJournalSheet())
    .filter(r => r.student_email === studentEmail && (r.diary || "").trim())
    .sort((a,b)=>b.date>a.date?1:-1).slice(0, 7)
    .map(r => ({ date: r.date, diary: r.diary }));
  const logs = getFilteredRows("DailyLog", "student_email", studentEmail)
    .filter(l => l.date >= fourteenDaysAgo);
  const logsByDay = {};
  logs.forEach(l => { (logsByDay[l.date] = logsByDay[l.date] || []).push(l); });
  const dailySummary = Object.keys(logsByDay).sort().reverse().map(d => ({
    date: d,
    blocks: logsByDay[d].length,
    goalBlocks: logsByDay[d].filter(l => l.goal_related === "true").length,
    memos: logsByDay[d].filter(l => l.memo && l.memo.trim()).map(l => l.time_block + " " + l.task + ": " + l.memo)
  }));
  const notes = sheetToObjects(getCoachingNotesSheet())
    .filter(n => n.student_email === studentEmail)
    .sort((a,b)=>b.date>a.date?1:-1).slice(0, 20);
  const status = computeAllStatuses()[studentEmail] || null;
  const profile = getStudentProfile(studentEmail);
  const files = sheetToObjects(getContractFilesSheet())
    .filter(f => f.student_email === studentEmail)
    .sort((a,b)=>b.uploaded_at>a.uploaded_at?1:-1);
  const joinedJiroku = !!sheetToObjects(getSheet("Users")).find(u => u.student_email === studentEmail);
  const chatworkMessages = sheetToObjects(getChatworkMessagesSheet())
    .filter(m => m.student_email === studentEmail)
    .sort((a,b)=>b.send_time>a.send_time?1:-1).slice(0, 50);

  return { ok: true, data: {
    name: user.name,
    nickname: user.nickname || user.name,
    avatar: user.avatar || "🦊",
    email: user.student_email,
    streak: Number(user.streak || 0),
    joined_at: user.joined_at || "",
    joinedJiroku: joinedJiroku,
    accessState: computeAccessState(user),
    goals: effectiveGoals(user.student_email, user),
    status: status,
    reports: reports,
    diaries: diaries,
    dailySummary: dailySummary,
    notes: notes,
    profile: profile || {},
    files: files,
    chatworkMessages: chatworkMessages
  } };
}

function coachSaveNote(coachEmail, body) {
  if (!verifyCoach(coachEmail)) return { ok: false, error: "not a coach" };
  if (!coachOwnsStudent(coachEmail, String(body.targetEmail))) return { ok: false, error: "not your student" };
  const content = String(body.content || "").trim();
  if (!content) return { ok: false, error: "empty content" };
  const sheet = getCoachingNotesSheet();
  const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  // unverified: AI(Zoom文字起こしの自動整理)が保存した場合はTRUE。要約が間違っている
  // 可能性があるため、コーチが後から確認するまで「未確認」の印を残しておく
  sheet.appendRow([
    "cn_" + Date.now(),
    coachEmail,
    String(body.targetEmail),
    String(body.date || formatDate(new Date())),
    content.slice(0, 2000),
    String(body.next_theme || "").slice(0, 500),
    String(body.promises || "").slice(0, 500),
    now,
    body.unverified ? "TRUE" : "FALSE"
  ]);
  return { ok: true };
}

// AI下書きとして保存されたコーチングログを、コーチが内容を確認した印を付ける
function coachVerifyNote(coachEmail, body) {
  if (!verifyCoach(coachEmail)) return { ok: false, error: "not a coach" };
  const noteId = String(body.note_id || "");
  const sheet = getCoachingNotesSheet();
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idIdx = headers.indexOf("note_id");
  const coachIdx = headers.indexOf("coach_email");
  const unverifiedIdx = headers.indexOf("unverified");
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idIdx]) === noteId) {
      if (String(data[i][coachIdx]) !== coachEmail) return { ok: false, error: "not your note" };
      sheet.getRange(i + 1, unverifiedIdx + 1).setValue("FALSE");
      return { ok: true };
    }
  }
  return { ok: false, error: "note not found" };
}

// 過去のコーチングログをまとめてインポートする（JIROKU導入前の履歴の一括登録用）。
// AIによる自動解析は使わず、コーチが入力した内容をそのまま複数件登録する
function coachImportNotes(coachEmail, body) {
  if (!verifyCoach(coachEmail)) return { ok: false, error: "not a coach" };
  const targetEmail = String(body.targetEmail || "");
  if (!coachOwnsStudent(coachEmail, targetEmail)) return { ok: false, error: "not your student" };
  const notes = Array.isArray(body.notes) ? body.notes : [];
  if (notes.length === 0) return { ok: false, error: "no notes" };

  const sheet = getCoachingNotesSheet();
  const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  let imported = 0;
  notes.forEach((n, i) => {
    const content = String(n.content || "").trim();
    if (!content) return;
    sheet.appendRow([
      "cn_" + Date.now() + "_" + i,
      coachEmail,
      targetEmail,
      String(n.date || formatDate(new Date())),
      content.slice(0, 2000),
      String(n.next_theme || "").slice(0, 500),
      String(n.promises || "").slice(0, 500),
      now
    ]);
    imported++;
  });
  return { ok: true, data: { imported } };
}

// コーチングセッション中のAIアシスタント: 生徒データ・前回の約束事項・
// 今入力中のメモをもとに、次に聞くべき質問を提案する
function coachSessionSuggestions(coachEmail, body) {
  if (!verifyCoach(coachEmail)) return { ok: false, error: "not a coach" };
  const targetEmail = String(body.targetEmail || "");
  const user = coachOwnsStudent(coachEmail, targetEmail);
  if (!user) return { ok: false, error: "not your student" };
  const apiKey = PropertiesService.getScriptProperties().getProperty("CLAUDE_API_KEY");
  if (!apiKey) return { ok: false, error: "CLAUDE_API_KEY が未設定" };

  const notes = sheetToObjects(getCoachingNotesSheet())
    .filter(n => n.student_email === targetEmail)
    .sort((a,b)=>b.date>a.date?1:-1);
  const lastNote = notes[0] || null;
  const ctx = buildStudentContext(targetEmail, user);
  const lastNoteText = lastNote
    ? `【前回のコーチング（${lastNote.date}）】\n内容: ${lastNote.content}\n次回テーマ: ${lastNote.next_theme || "なし"}\n約束事項: ${lastNote.promises || "なし"}`
    : "【前回のコーチング】まだ記録なし（初回コーチング）";
  const draftText = String(body.draftNotes || "").trim();
  const draftSection = draftText
    ? `【今回のセッションで今までにコーチが書いたメモ（進行中）】\n${draftText}`
    : "【今回のセッションのメモ】まだ何も書かれていない（セッション開始直後）";

  const prompt = `あなたはコーチングセッションに同席し、コーチをサポートするアシスタントです。以下の生徒データと今回のセッションの進行状況を読み、コーチが次に聞くとよい質問を3〜5個、提案してください。

${ctx}

${lastNoteText}

${draftSection}

【出力形式】質問だけを1行ずつ箇条書きで。見出し・タイトル・前置き・説明文・生徒の名前を書いた行は一切含めず、質問文そのものだけを出力すること。「#」などの記号や敬体すぎない自然な話し言葉の日本語で、コーチが実際にその場で口にするような表現にすること。記録の時間の単位は「ブロック」ではなく「時間帯」と表現する。すでにメモに書かれている内容の繰り返しにはならないよう、まだ深掘りできていない点や前回の約束事項の進捗確認を優先すること`;

  const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    payload: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 500, messages: [{ role: "user", content: prompt }] }),
    muteHttpExceptions: true
  });
  const result = JSON.parse(res.getContentText()); logAiUsage(result, "コーチング提案");
  if (!result.content || !result.content[0]) return { ok: false, error: "ai error" };
  const lines = result.content[0].text.split("\n")
    .map(l => l.replace(/^[#\-・*0-9.\s]+/, "").trim())
    .filter(l => l.length > 2 && !/さんへの(提案)?質問$/.test(l));
  return { ok: true, data: { suggestions: lines } };
}

// Zoomの文字起こし（コピペしたテキスト）をAIが「話した内容・約束事項・次回テーマ」に
// 整理し、コーチングログのフォームに仮入力できる形で返す。保存は自動化せず、
// コーチが内容を確認してから保存する運用とする（他のAI整理機能と同じ方針）
function coachSummarizeTranscript(coachEmail, body) {
  if (!verifyCoach(coachEmail)) return { ok: false, error: "not a coach" };
  const targetEmail = String(body.targetEmail || "");
  if (!coachOwnsStudent(coachEmail, targetEmail)) return { ok: false, error: "not your student" };
  const transcript = String(body.transcript || "").trim();
  if (!transcript) return { ok: false, error: "文字起こしが空です" };
  const apiKey = PropertiesService.getScriptProperties().getProperty("CLAUDE_API_KEY");
  if (!apiKey) return { ok: false, error: "CLAUDE_API_KEY が未設定" };

  const prompt = `以下はコーチングセッション（Zoom）の文字起こしです。この内容を、コーチングログとして記録するために整理してください。

【文字起こし】
${transcript.slice(0, 12000)}

以下のJSON形式のみで返してください（説明文不要）:
{
  "content": "<話した内容・深掘りした内容の要約。3〜6文程度、具体的なエピソードや数字に触れる>",
  "promises": "<生徒が約束した行動・宿題。複数あれば「、」で区切って1行にまとめる。無ければ空文字>",
  "next_theme": "<次回のコーチングで扱うとよいテーマ。無ければ空文字>"
}`;

  try {
    const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      payload: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 800, messages: [{ role: "user", content: prompt }] }),
      muteHttpExceptions: true
    });
    const result = JSON.parse(res.getContentText()); logAiUsage(result, "面談の要約");
    if (!result.content || !result.content[0]) return { ok: false, error: "AI応答が空でした" };
    const m = result.content[0].text.match(/\{[\s\S]*\}/);
    if (!m) return { ok: false, error: "AI応答の解析に失敗しました" };
    const parsed = JSON.parse(m[0]);
    return { ok: true, data: {
      content: String(parsed.content || "").trim(),
      promises: String(parsed.promises || "").trim(),
      next_theme: String(parsed.next_theme || "").trim()
    } };
  } catch (e) {
    return { ok: false, error: "summarize failed: " + e.toString() };
  }
}

// AI予習サマリー: 前回コーチング（無ければ直近14日）からの変化を要約
function coachPrepSummary(coachEmail, studentEmail) {
  if (!verifyCoach(coachEmail)) return { ok: false, error: "not a coach" };
  const user = coachOwnsStudent(coachEmail, studentEmail);
  if (!user) return { ok: false, error: "not your student" };
  const apiKey = PropertiesService.getScriptProperties().getProperty("CLAUDE_API_KEY");
  if (!apiKey) return { ok: false, error: "no api key" };

  const notes = sheetToObjects(getCoachingNotesSheet())
    .filter(n => n.student_email === studentEmail)
    .sort((a,b)=>b.date>a.date?1:-1);
  const lastNote = notes[0] || null;
  const ctx = buildStudentContext(studentEmail, user);
  const lastNoteText = lastNote
    ? `【前回のコーチング（${lastNote.date}）】\n内容: ${lastNote.content}\n次回テーマ: ${lastNote.next_theme || "なし"}\n約束事項: ${lastNote.promises || "なし"}`
    : "【前回のコーチング】まだ記録なし（初回コーチング）";

  const prompt = `あなたはコーチングの準備を手伝うアシスタントです。以下の生徒データを読み、コーチがセッション前に1分で把握できる予習サマリーを作ってください。

${ctx}

${lastNoteText}

【出力形式】以下の4項目を、それぞれ2〜3行の簡潔な箇条書きで。見出しはこのまま使う:
■ 前回からの変化
■ 良い兆候
■ 気になる点
■ 今回話すべきこと（前回の約束の進捗確認を含む）`;

  const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    payload: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 800, messages: [{ role: "user", content: prompt }] }),
    muteHttpExceptions: true
  });
  const result = JSON.parse(res.getContentText()); logAiUsage(result, "コーチング準備");
  if (!result.content || !result.content[0]) return { ok: false, error: "ai error" };
  return { ok: true, data: { summary: result.content[0].text.trim(), lastCoachingDate: lastNote ? lastNote.date : null } };
}

// セッション記録後に、その生徒へ送るフォローアップメッセージをAIが生成する。
// 直近のコーチングログ（約束事項・次回テーマ）＋生徒の状況を踏まえた、人間のコーチが
// セッション後に送るような温かい一言を作る。コーチが確認・編集して送る前提
function coachGenerateStudentMessage(coachEmail, body) {
  if (!verifyCoach(coachEmail)) return { ok: false, error: "not a coach" };
  const studentEmail = String(body.targetEmail || "");
  const user = coachOwnsStudent(coachEmail, studentEmail);
  if (!user) return { ok: false, error: "not your student" };
  const apiKey = PropertiesService.getScriptProperties().getProperty("CLAUDE_API_KEY");
  if (!apiKey) return { ok: false, error: "CLAUDE_API_KEY未設定" };

  const coach = sheetToObjects(getSheet("Coaches")).find(c => c.coach_email === coachEmail);
  const coachName = (coach && coach.coach_name) ? coach.coach_name : "コーチ";

  const notes = sheetToObjects(getCoachingNotesSheet())
    .filter(n => n.student_email === studentEmail)
    .sort((a, b) => b.date > a.date ? 1 : -1);
  const lastNote = notes[0] || null;
  const ctx = buildStudentContext(studentEmail, user);
  const lastNoteText = lastNote
    ? "【今日のセッション（" + lastNote.date + "）】\n話した内容: " + lastNote.content + "\n約束事項: " + (lastNote.promises || "なし") + "\n次回テーマ: " + (lastNote.next_theme || "なし")
    : "【今日のセッション】記録がまだありません";
  const recentMsgs = getRecentCoachMessages(studentEmail, 5);
  const tone = String(body.tone || "");

  const prompt = "あなたは教育コーチ「" + coachName + "」本人です。今日" + user.name + "さんとコーチングセッションを行いました。セッションの直後に、" + user.name + "さん本人へChatwork（チャットワーク）で送るフォローアップメッセージを書いてください。\n\n" +
    ctx + "\n\n" + lastNoteText + "\n" + recentMsgs + (tone ? "\n【今回のトーン指定】" + tone : "") + "\n\n" +
    "【メッセージの作り方】\n" +
    "- 今日のセッションで話した内容・約束事項に具体的に触れる（本人が「ちゃんと見てくれている」と感じられるように）\n" +
    "- セッションでの本人の良かった点・前向きな変化を1つ具体的に称える\n" +
    "- 約束事項があれば、それを一緒に頑張る姿勢で背中を押す（プレッシャーではなく応援）\n" +
    "- 頑張れている時は惜しみなく称え、停滞している時も愛を持って、行動（人格ではなく）にはっきり触れる\n" +
    "- 全体をていねいな敬語で書く（Chatworkでのビジネス的なやり取りにふさわしい、あたたかく丁寧な文体。タメ口・馴れ馴れしい表現は使わない）\n" +
    "- 「---」「【】」などの見出し・宛名（〇〇さんへ）は書かない。本文からそのまま始める\n" +
    "- そのままChatworkで送れる本文だけを出力する（説明・前置き不要）\n" +
    "- 3〜5文程度。1文ごとに句点で区切って改行が入りやすくする\n" + EMOJI_STYLE;

  const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    payload: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 600, messages: [{ role: "user", content: prompt }] }),
    muteHttpExceptions: true
  });
  const result = JSON.parse(res.getContentText()); logAiUsage(result, "生徒へのメッセージ");
  if (!result.content || !result.content[0]) return { ok: false, error: "生成に失敗しました" };
  return { ok: true, data: { message: stripSalutation(result.content[0].text.trim()), lineLinked: !!user.line_user_id } };
}

// 定期的なフォローアップ（特に記録が滞っている生徒向け）のメッセージを生成する。
// セッション直後ではなく、コーチが折を見て送る「声かけ」を想定。
// 記録の停滞状況に応じて、責めずに再開を後押しする文面を作る。
function coachGenerateNudgeMessage(coachEmail, body) {
  if (!verifyCoach(coachEmail)) return { ok: false, error: "not a coach" };
  const studentEmail = String(body.targetEmail || "");
  const user = coachOwnsStudent(coachEmail, studentEmail);
  if (!user) return { ok: false, error: "not your student" };
  const apiKey = PropertiesService.getScriptProperties().getProperty("CLAUDE_API_KEY");
  if (!apiKey) return { ok: false, error: "CLAUDE_API_KEY未設定" };

  const coach = sheetToObjects(getSheet("Coaches")).find(c => c.coach_email === coachEmail);
  const coachName = (coach && coach.coach_name) ? coach.coach_name : "コーチ";

  // 記録の停滞状況を算出
  const logs = sheetToObjects(getSheet("DailyLog")).filter(l => l.student_email === studentEmail);
  const lastLogDate = logs.length ? logs.map(l => l.date).sort().pop() : null;
  const today = formatDate(new Date());
  const daysSince = lastLogDate
    ? Math.round((new Date(today + "T00:00:00") - new Date(lastLogDate + "T00:00:00")) / 86400000)
    : null;

  let situation;
  if (daysSince === null) {
    situation = "この方はまだ一度も記録をつけていません。まずは記録を始める最初の一歩を、やさしく後押ししてください。";
  } else if (daysSince <= 1) {
    situation = "直近（" + (daysSince === 0 ? "今日" : "昨日") + "）まで記録できています。頑張りをしっかり認めつつ、無理なく続けられるよう声をかけてください。";
  } else if (daysSince <= 3) {
    situation = "最後の記録から" + daysSince + "日空いています。まだ大きくは離れていないので、責めずに軽く様子をうかがい、そっと再開を促してください。";
  } else if (daysSince <= 7) {
    situation = "最後の記録から" + daysSince + "日空いています。少し間が空いているので、体調や忙しさを気づかいつつ、ハードルを下げて（一言だけでもOKと伝えて）再開を後押ししてください。";
  } else {
    situation = "最後の記録から" + daysSince + "日以上空いています。だいぶ間が空いているため、決して責めず、まず気にかけていることを伝え、また一緒に少しずつで大丈夫だと安心させる文面にしてください。";
  }

  const ctx = buildStudentContext(studentEmail, user);
  const recentMsgs = getRecentCoachMessages(studentEmail, 5);
  const tone = String(body.tone || "");

  const prompt = "あなたは教育コーチ「" + coachName + "」本人です。担当している" + user.name + "さんへ、折を見て送る定期的な声かけメッセージを、Chatwork（チャットワーク）で送るために書いてください。\n\n" +
    ctx + "\n\n【記録の状況】" + situation + "\n" + recentMsgs + (tone ? "\n【今回のトーン指定】" + tone : "") + "\n\n" +
    "【メッセージの作り方】\n" +
    "- 記録の停滞を『サボっている』と決めつけない。まず気にかけている気持ちを伝える\n" +
    "- 目標や過去の頑張りに具体的に触れ、『ちゃんと見ている』ことが伝わるようにする\n" +
    "- 再開のハードルを下げる（『一言だけでも』『できた範囲でOK』など、小さな一歩を提示する）\n" +
    "- プレッシャーや罪悪感を与えない。あくまで応援・伴走の姿勢\n" +
    "- 直近で似た内容をすでに送っている場合は、繰り返しにならないよう切り口を変える\n" +
    "- 全体をていねいな敬語で書く（Chatworkでのあたたかく丁寧な文体。タメ口・馴れ馴れしい表現は使わない）\n" +
    "- 「---」「【】」などの見出し・宛名（〇〇さんへ）は書かない。本文からそのまま始める\n" +
    "- そのままChatworkで送れる本文だけを出力する（説明・前置き不要）\n" +
    "- 3〜4文程度。1文ごとに句点で区切って改行が入りやすくする\n" + EMOJI_STYLE;

  const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    payload: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 600, messages: [{ role: "user", content: prompt }] }),
    muteHttpExceptions: true
  });
  const result = JSON.parse(res.getContentText()); logAiUsage(result, "復帰の声かけ");
  if (!result.content || !result.content[0]) return { ok: false, error: "生成に失敗しました" };
  return { ok: true, data: { message: stripSalutation(result.content[0].text.trim()), daysSince: daysSince, lastLogDate: lastLogDate, lineLinked: !!user.line_user_id } };
}

// コーチが確認・編集したメッセージを、その生徒へ実際に送る（LINE＋アプリの受信箱に反映）
function coachSendStudentMessage(coachEmail, body) {
  if (!verifyCoach(coachEmail)) return { ok: false, error: "not a coach" };
  const studentEmail = String(body.targetEmail || "");
  const message = String(body.message || "").trim();
  if (!message) return { ok: false, error: "メッセージが空です" };
  const user = coachOwnsStudent(coachEmail, studentEmail);
  if (!user) return { ok: false, error: "not your student" };

  logCoachMessage(studentEmail, message); // アプリのメッセージ受信箱に残す
  let lineSent = false;
  if (user.line_user_id) {
    try { lineSent = sendLineMessage(user.line_user_id, formatForLine(message)); } catch (e) { Logger.log("coachSend LINE error: " + e); }
  }
  return { ok: true, lineSent: lineSent, lineLinked: !!user.line_user_id };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 生徒プロフィール・契約情報・契約書ファイル
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const STUDENT_PROFILE_HEADERS = ["student_email","coach_email","name","birthdate","gender","family","address","phone","occupation","profile_notes",
  "instagram","tiktok",
  "contract_start","contract_end","payment_type","contract_amount","installment_count","updated_at",
  "stripe_email","stripe_total_paid","stripe_currency","stripe_synced_at",
  "chatwork_id","chatwork_room_id"];

// StudentProfileシートを取得する。既存シートに後から追加された列
// （chatwork_idなど）が無い場合は自動で追加する（スキーマの自己修復）。
// 新しい列を追加するたびに既存シートを手動で直す必要がないようにするため
function getStudentProfileSheet() {
  let sheet = getSheet("StudentProfile");
  if (!sheet) {
    sheet = SpreadsheetApp.openById(SPREADSHEET_ID).insertSheet("StudentProfile");
    sheet.appendRow(STUDENT_PROFILE_HEADERS);
    return sheet;
  }
  const lastCol = sheet.getLastColumn();
  const currentHeaders = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  const missing = STUDENT_PROFILE_HEADERS.filter(h => !currentHeaders.includes(h));
  if (missing.length > 0) {
    sheet.getRange(1, currentHeaders.length + 1, 1, missing.length).setValues([missing]);
  }
  return sheet;
}

function getContractFilesSheet() {
  let sheet = getSheet("ContractFiles");
  if (!sheet) {
    sheet = SpreadsheetApp.openById(SPREADSHEET_ID).insertSheet("ContractFiles");
    sheet.appendRow(["file_id","student_email","file_name","file_url","note","uploaded_at"]);
  }
  return sheet;
}

// 契約書などの生徒ファイルを保存するDriveフォルダ（無ければ作成）。
// スプレッドシートと同じマイドライブ内に置き、コーチのGoogleアカウント
// 権限で読める場所に集約する
function getContractFolder() {
  const folderName = "JIROKU_契約書";
  const folders = DriveApp.getFoldersByName(folderName);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(folderName);
}

function getStudentProfile(studentEmail) {
  const rows = sheetToObjects(getStudentProfileSheet());
  return rows.find(r => r.student_email === studentEmail) || null;
}

function coachSaveProfile(coachEmail, body) {
  if (!verifyCoach(coachEmail)) return { ok: false, error: "not a coach" };
  const targetEmail = String(body.targetEmail || "");
  if (!coachOwnsStudent(coachEmail, targetEmail)) return { ok: false, error: "not your student" };

  const sheet = getStudentProfileSheet();
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const emailIdx = headers.indexOf("student_email");
  const fields = ["name","birthdate","gender","family","address","phone","occupation","profile_notes","instagram","tiktok","contract_start","contract_end","payment_type","contract_amount","installment_count","stripe_email"];

  const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][emailIdx]) === targetEmail) {
      fields.forEach(f => {
        if (body[f] !== undefined) sheet.getRange(i + 1, headers.indexOf(f) + 1).setValue(body[f]);
      });
      sheet.getRange(i + 1, headers.indexOf("updated_at") + 1).setValue(now);
      return { ok: true };
    }
  }
  const row = headers.map(h => {
    if (h === "student_email") return targetEmail;
    if (h === "updated_at") return now;
    return body[h] !== undefined ? body[h] : "";
  });
  sheet.appendRow(row);
  return { ok: true };
}

// 契約書ファイルのアップロード（POST、base64）。GETのURLパラメータでは
// ファイル本体を送れないためdoPost経由。Driveに保存しURLをシートに記録する
function coachUploadFile(coachEmail, body) {
  if (!verifyCoach(coachEmail)) return { ok: false, error: "not a coach" };
  const targetEmail = String(body.targetEmail || "");
  if (!coachOwnsStudent(coachEmail, targetEmail)) return { ok: false, error: "not your student" };
  if (!body.fileData || !body.fileName) return { ok: false, error: "missing file" };

  try {
    const bytes = Utilities.base64Decode(body.fileData);
    const blob = Utilities.newBlob(bytes, body.mimeType || "application/octet-stream", body.fileName);
    const folder = getContractFolder();
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    const sheet = getContractFilesSheet();
    const fileId = "file_" + Date.now();
    const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
    sheet.appendRow([fileId, targetEmail, body.fileName, file.getUrl(), String(body.note || "").slice(0, 300), now]);
    return { ok: true, data: { file_id: fileId, file_name: body.fileName, file_url: file.getUrl(), uploaded_at: now, note: body.note || "" } };
  } catch (e) {
    return { ok: false, error: "upload failed: " + e.toString() };
  }
}

// 契約書PDFをAIに読ませてプロフィール項目を抽出する。
// 抽出結果はフォームへの仮入力にのみ使い、保存はコーチの確認後に行う
function coachExtractContractInfo(coachEmail, body) {
  if (!verifyCoach(coachEmail)) return { ok: false, error: "not a coach" };
  const targetEmail = String(body.targetEmail || "");
  if (!coachOwnsStudent(coachEmail, targetEmail)) return { ok: false, error: "not your student" };
  if (!body.fileData) return { ok: false, error: "missing file" };
  return extractContractInfoFromBase64(body.fileData, body.mimeType || "application/pdf");
}

// 既にアップロード済みの契約書ファイルから、後からAI抽出を行う（機能追加前に
// アップロードされていた契約書など、抽出のタイミングを逃したファイル向け）
function coachExtractFromExistingFile(coachEmail, body) {
  if (!verifyCoach(coachEmail)) return { ok: false, error: "not a coach" };
  const targetEmail = String(body.targetEmail || "");
  if (!coachOwnsStudent(coachEmail, targetEmail)) return { ok: false, error: "not your student" };

  const file = sheetToObjects(getContractFilesSheet())
    .find(f => f.file_id === String(body.file_id) && f.student_email === targetEmail);
  if (!file) return { ok: false, error: "file not found" };

  try {
    const idMatch = String(file.file_url).match(/[-\w]{25,}/);
    if (!idMatch) return { ok: false, error: "invalid file url" };
    const driveFile = DriveApp.getFileById(idMatch[0]);
    const blob = driveFile.getBlob();
    const base64 = Utilities.base64Encode(blob.getBytes());
    return extractContractInfoFromBase64(base64, blob.getContentType() || "application/pdf");
  } catch (e) {
    return { ok: false, error: "extract failed: " + e.toString() };
  }
}

function extractContractInfoFromBase64(base64Data, mimeType) {
  const apiKey = PropertiesService.getScriptProperties().getProperty("CLAUDE_API_KEY");
  if (!apiKey) return { ok: false, error: "CLAUDE_API_KEY が未設定" };

  const prompt = `これは生徒との契約書です。以下の項目をこの書類から読み取り、JSON形式のみで出力してください。読み取れない項目は空文字にしてください。値の正確性が重要なので、書類に明記されていないことは推測せず空にすること。

{
  "name": "<氏名>",
  "birthdate": "<生年月日、YYYY-MM-DD形式>",
  "address": "<住所>",
  "phone": "<電話番号>",
  "contract_start": "<契約開始日、YYYY-MM-DD形式>",
  "contract_end": "<契約終了日、YYYY-MM-DD形式>",
  "payment_type": "<lump（一括）/card_installment（クレカ分割）/transfer_installment（振込分割）のいずれか>",
  "contract_amount": "<契約金額、数字のみ>",
  "installment_count": "<分割回数、数字のみ。一括の場合は空>"
}`;

  try {
    const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
      method: "post",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      payload: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 800,
        messages: [{
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: mimeType || "application/pdf", data: base64Data } },
            { type: "text", text: prompt }
          ]
        }]
      }),
      muteHttpExceptions: true
    });
    const data = JSON.parse(res.getContentText());
    const text = data.content && data.content[0] && data.content[0].text;
    if (!text) return { ok: false, error: "AI応答が空でした" };
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return { ok: false, error: "AI応答の解析に失敗しました" };
    const parsed = JSON.parse(m[0]);
    return { ok: true, data: parsed };
  } catch (e) {
    return { ok: false, error: "extract failed: " + e.toString() };
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Stripe連携（生徒ごとの累計支払額を把握）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// メールアドレスからStripe顧客を検索し、成功した支払いの合計額を返す。
// 見つからない場合はnullを返す（Stripeに未登録の生徒として扱う）
function fetchStripeTotalPaid(email) {
  const apiKey = PropertiesService.getScriptProperties().getProperty("STRIPE_SECRET_KEY");
  if (!apiKey) return null;
  const authHeader = "Basic " + Utilities.base64Encode(apiKey + ":");

  const custRes = UrlFetchApp.fetch(
    "https://api.stripe.com/v1/customers/search?query=" + encodeURIComponent(`email:'${email}'`),
    { headers: { Authorization: authHeader }, muteHttpExceptions: true }
  );
  const custData = JSON.parse(custRes.getContentText());
  const customerId = (custData.data && custData.data.length > 0) ? custData.data[0].id : null;

  if (customerId) {
    let total = 0;
    let currency = "jpy";
    let startingAfter = null;
    for (let i = 0; i < 10; i++) { // 最大1000件（100件×10ページ）まで
      let url = `https://api.stripe.com/v1/charges?customer=${customerId}&limit=100`;
      if (startingAfter) url += `&starting_after=${startingAfter}`;
      const res = UrlFetchApp.fetch(url, { headers: { Authorization: authHeader }, muteHttpExceptions: true });
      const data = JSON.parse(res.getContentText());
      if (!data.data) break;
      data.data.forEach(charge => {
        if (charge.paid && !charge.refunded) {
          total += charge.amount - (charge.amount_refunded || 0);
          currency = charge.currency;
        }
      });
      if (!data.has_more || data.data.length === 0) break;
      startingAfter = data.data[data.data.length - 1].id;
    }
    if (total > 0) return { total, currency, customerId };
  }

  // 決済リンク等で正式な顧客(Customer)を作らず支払いだけが行われた場合、
  // Stripe上は「ゲスト」という表示専用レコードになり、customers/searchでは
  // 見つからない。billing_details.emailはChargesのsearch対応フィールドに
  // 含まれていないため、一覧取得して自前でメールアドレス照合する
  return fetchStripeTotalPaidByChargeEmail(email, authHeader);
}

function fetchStripeTotalPaidByChargeEmail(email, authHeader) {
  const targetEmail = String(email).toLowerCase();
  let total = 0;
  let currency = "jpy";
  let found = false;
  let startingAfter = null;
  for (let i = 0; i < 20; i++) { // 最大2000件（100件×20ページ）まで
    let url = "https://api.stripe.com/v1/charges?limit=100";
    if (startingAfter) url += "&starting_after=" + startingAfter;
    const res = UrlFetchApp.fetch(url, { headers: { Authorization: authHeader }, muteHttpExceptions: true });
    const data = JSON.parse(res.getContentText());
    if (!data.data) break;
    data.data.forEach(charge => {
      const chargeEmail = (charge.billing_details && charge.billing_details.email) || charge.receipt_email || "";
      if (String(chargeEmail).toLowerCase() !== targetEmail) return;
      found = true;
      if (charge.paid && !charge.refunded) {
        total += charge.amount - (charge.amount_refunded || 0);
        currency = charge.currency;
      }
    });
    if (!data.has_more || data.data.length === 0) break;
    startingAfter = data.data[data.data.length - 1].id;
  }
  if (!found) return null;
  return { total, currency, customerId: null };
}

// 全生徒・全クライアント分をまとめてStripeと同期し、StudentProfileシートに記録する（日次トリガー）。
// JIROKU利用者に加え、コーチが手動追加しただけ（coach_emailのみ設定）のクライアントも対象にする
function syncStripeTotals() {
  const apiKey = PropertiesService.getScriptProperties().getProperty("STRIPE_SECRET_KEY");
  if (!apiKey) { Logger.log("STRIPE_SECRET_KEY が未設定"); return; }

  const activeUserEmails = sheetToObjects(getSheet("Users")).filter(u => String(u.is_active).toUpperCase() === "TRUE").map(u => u.student_email);
  const sheet = getStudentProfileSheet();
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const emailIdx = headers.indexOf("student_email");
  const coachIdx = headers.indexOf("coach_email");
  const stripeEmailIdx = headers.indexOf("stripe_email");
  const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });

  const targets = new Set(activeUserEmails);
  for (let i = 1; i < data.length; i++) {
    if (data[i][coachIdx]) targets.add(String(data[i][emailIdx]));
  }

  targets.forEach(email => {
    try {
      let rowIdx = -1;
      let stripeSearchEmail = email;
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][emailIdx]) === email) {
          rowIdx = i + 1;
          if (data[i][stripeEmailIdx]) stripeSearchEmail = String(data[i][stripeEmailIdx]);
          break;
        }
      }
      const result = fetchStripeTotalPaid(stripeSearchEmail);
      if (!result) return;
      if (rowIdx === -1) {
        const row = headers.map(h => h === "student_email" ? email : "");
        sheet.appendRow(row);
        rowIdx = sheet.getLastRow();
      }
      sheet.getRange(rowIdx, headers.indexOf("stripe_total_paid") + 1).setValue(result.total);
      sheet.getRange(rowIdx, headers.indexOf("stripe_currency") + 1).setValue(result.currency);
      sheet.getRange(rowIdx, headers.indexOf("stripe_synced_at") + 1).setValue(now);
    } catch (e) {
      Logger.log("Stripe同期失敗 (" + email + "): " + e.toString());
    }
  });
  Logger.log("Stripe同期完了");
}

// Stripe同期がなぜ失敗するかを切り分けるための診断用。
// customers/searchの生レスポンスをそのまま返し、0件なのかAPIエラーなのかが分かるようにする
// カレンダーの色分けが効いていない件の切り分け用。colorId毎の実際の名前・色を
// Google公式のColors.get()からそのまま取得する（憶測でIDを決め打ちしないため）
function adminDebugCalendarColors(coachEmail) {
  if (!verifyCoach(coachEmail)) return { ok: false, error: "not a coach" };
  const token = ScriptApp.getOAuthToken();
  const res = UrlFetchApp.fetch("https://www.googleapis.com/calendar/v3/colors", {
    headers: { Authorization: "Bearer " + token }, muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  let body;
  try { body = JSON.parse(res.getContentText()); } catch (e) { body = res.getContentText(); }
  return { ok: true, httpCode: code, response: body };
}

function adminDebugStripeSearch(coachEmail, email) {
  if (!verifyCoach(coachEmail)) return { ok: false, error: "not a coach" };
  const apiKey = PropertiesService.getScriptProperties().getProperty("STRIPE_SECRET_KEY");
  if (!apiKey) return { ok: false, error: "STRIPE_SECRET_KEY未設定" };
  // キーそのものは返さず、本番用(sk_live_)かテスト用(sk_test_)かのモードだけ分かるようにする
  const keyMode = apiKey.startsWith("sk_live_") ? "live"
    : apiKey.startsWith("sk_test_") ? "test"
    : apiKey.startsWith("rk_live_") ? "live(restricted)"
    : apiKey.startsWith("rk_test_") ? "test(restricted)"
    : "unknown";
  const authHeader = "Basic " + Utilities.base64Encode(apiKey + ":");
  const query = `email:'${email}'`;
  const res = UrlFetchApp.fetch(
    "https://api.stripe.com/v1/customers/search?query=" + encodeURIComponent(query),
    { headers: { Authorization: authHeader }, muteHttpExceptions: true }
  );
  const code = res.getResponseCode();
  let body;
  try { body = JSON.parse(res.getContentText()); } catch (e) { body = res.getContentText(); }

  const chargeResult = fetchStripeTotalPaidByChargeEmail(email, authHeader);

  return { ok: true, keyMode: keyMode, searchedEmail: email,
    customerSearch: { httpCode: code, response: body },
    chargeListMatch: chargeResult };
}

// コーチ画面から1人分だけ即時同期する（新規契約直後などの手動更新用）。
// プロフィールに「stripe_email」（上書き用メール）が設定されていればそちらで検索する
function coachSyncStripeOne(coachEmail, params) {
  if (!verifyCoach(coachEmail)) return { ok: false, error: "not a coach" };
  const targetEmail = String(params.targetEmail || "");
  if (!coachOwnsStudent(coachEmail, targetEmail)) return { ok: false, error: "not your student" };

  const profile = getStudentProfile(targetEmail);
  const stripeSearchEmail = (profile && profile.stripe_email) ? profile.stripe_email : targetEmail;
  const result = fetchStripeTotalPaid(stripeSearchEmail);
  if (!result) return { ok: false, error: "Stripeに顧客が見つかりませんでした" };

  const sheet = getStudentProfileSheet();
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const emailIdx = headers.indexOf("student_email");
  const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  let rowIdx = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][emailIdx]) === targetEmail) { rowIdx = i + 1; break; }
  }
  if (rowIdx === -1) {
    const row = headers.map(h => h === "student_email" ? targetEmail : "");
    sheet.appendRow(row);
    rowIdx = sheet.getLastRow();
  }
  sheet.getRange(rowIdx, headers.indexOf("stripe_total_paid") + 1).setValue(result.total);
  sheet.getRange(rowIdx, headers.indexOf("stripe_currency") + 1).setValue(result.currency);
  sheet.getRange(rowIdx, headers.indexOf("stripe_synced_at") + 1).setValue(now);
  return { ok: true, data: { total: result.total, currency: result.currency, synced_at: now } };
}

function coachDeleteFile(coachEmail, body) {
  if (!verifyCoach(coachEmail)) return { ok: false, error: "not a coach" };
  const targetEmail = String(body.targetEmail || "");
  if (!coachOwnsStudent(coachEmail, targetEmail)) return { ok: false, error: "not your student" };
  const sheet = getContractFilesSheet();
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idIdx = headers.indexOf("file_id");
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][idIdx]) === String(body.file_id)) {
      sheet.deleteRow(i + 1);
      return { ok: true };
    }
  }
  return { ok: false, error: "not found" };
}

function coachDeleteNote(coachEmail, body) {
  if (!verifyCoach(coachEmail)) return { ok: false, error: "not a coach" };
  const targetEmail = String(body.targetEmail || "");
  if (!coachOwnsStudent(coachEmail, targetEmail)) return { ok: false, error: "not your student" };
  const sheet = getCoachingNotesSheet();
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idIdx = headers.indexOf("note_id");
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][idIdx]) === String(body.note_id)) {
      sheet.deleteRow(i + 1);
      return { ok: true };
    }
  }
  return { ok: false, error: "not found" };
}

function getMessages(studentEmail) {
  const rows = getFilteredRows("Messages", "student_email", studentEmail);
  const msgs = rows
    .sort((a, b) => a.message_id > b.message_id ? 1 : -1)
    .map(r => ({ message_id: r.message_id, content: r.content, sender_name: r.sender_name, sender_role: r.sender_role, timestamp: r.timestamp, is_read: r.is_read }));
  return { ok: true, data: msgs };
}

function sendMessage(studentEmail, body) {
  const sheet = getSheet("Messages");
  const msgId = "msg_" + Date.now();
  const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  sheet.appendRow([msgId, studentEmail, body.content, body.sender_name, body.sender_photo || "", body.sender_role, now, "false"]);
  if (body.sender_role === "student") {
    notifyCoachOnMessage(studentEmail, body.sender_name, body.content);
    autoReplyFromClaude(studentEmail, body.content);
  }
  return { ok: true, message_id: msgId };
}

function autoReplyFromClaude(studentEmail, studentMessage) {
  try {
    const apiKey = PropertiesService.getScriptProperties().getProperty("CLAUDE_API_KEY");
    if (!apiKey) return;

    const user = sheetToObjects(getSheet("Users")).find(u => u.student_email === studentEmail);
    if (!user) return;

    const today = formatDate(new Date());
    const todayLogs = sheetToObjects(getSheet("DailyLog")).filter(l => l.student_email === studentEmail && l.date === today);
    const logSummary = todayLogs.length > 0
      ? todayLogs.map(l => l.time_block + ": " + l.task + "（集中度" + l.focus_level + "）").join("\n")
      : "まだ記録なし";

    const ctx = buildStudentContext(studentEmail, user);

    const allMsgs = sheetToObjects(getSheet("Messages"))
      .filter(m => m.student_email === studentEmail)
      .sort((a, b) => a.message_id > b.message_id ? 1 : -1);
    const recentMessages = allMsgs.slice(-21, -1)
      .map(m => ({ role: m.sender_role === "student" ? "user" : "assistant", content: m.content }));

    const systemPrompt = `あなたは生徒の友人でもあるコーチです。以下の情報をすべて把握した上で、会話に返信してください。

【コーチのスタイル】
- 敬語とタメ語を自然に混ぜながら話す（例：「すごいじゃん！それ続けていきましょう」）
- ユーモアを交えて、読んで少し笑えるくらいの温度感
- 「〇〇へのメッセージ」「〇〇案：」「〇〇さんへ」「---」「【】」などのAI的な見出し・宛名・ラベルは絶対使わない
- 本文だけをそのまま書く。前置き・宛名・説明は一切不要
- 心理学的アプローチ（承認→気づき→行動）を自然に織り込む
- 目標の期限に対する現在地をさらっと言語化する
- 2〜4文で。締めは必ず前向きかつ人間味のある言葉で
- 「お前」「てめぇ」などの荒い二人称・乱暴な言葉は、親しみを込めたつもりでも威圧的に感じられるため絶対に使わない。親しい間柄でも「〇〇さん」または名前を呼ぶか、二人称を省略する
- ログのメモ等が音声入力由来で「磁力」「地録」「字録」など、このアプリ名「JIROKU」の誤変換・空耳と思われる表記になっている場合は、そのまま引用せず「JIROKU」に読み替えて書く

${ctx}
【今日のログ】
${logSummary}`;

    const messages = [...recentMessages, { role: "user", content: studentMessage }];

    const response = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      payload: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 800, system: systemPrompt, messages }),
      muteHttpExceptions: true
    });

    const result = JSON.parse(response.getContentText());
    if (!result.content || !result.content[0]) return;

    const replyText = stripSalutation(result.content[0].text);
    const sheet = getSheet("Messages");
    const msgId = "msg_" + Date.now();
    const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
    sheet.appendRow([msgId, studentEmail, replyText, "コーチ", "", "coach", now, "false"]);

    // LINEで通知
    if (user.line_user_id) {
      sendLineMessage(user.line_user_id, "🤖 習慣AIコーチより\n\n" + formatForLine(replyText));
    }
  } catch (err) {
    Logger.log("autoReplyFromClaude error: " + err.toString());
  }
}

function getSchedule(studentEmail) {
  const user = getFilteredRows("Users", "student_email", studentEmail)[0];
  if (!user || !user.google_calendar_id) return { ok: true, data: [] };
  try {
    const cal = CalendarApp.getCalendarById(user.google_calendar_id);
    if (!cal) return { ok: true, data: [] };
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    // JIROKUの記録から自動で書き込んだ予定は、既に完了したことなので
    // 「今日の予定」からは除外する（フロント側と同じ扱い）。
    // CalendarAppのgetTagはAPI経由のprivate extendedPropertiesを読めない
    // 場合があるため、タイトルが✅/✔️始まりかどうかでも判定する
    // （マークを✅→✔️に変更した経緯があるため両方を見る）
    const data = cal.getEvents(start, end)
      .filter(ev => {
        const t = String(ev.getTitle() || "");
        return ev.getTag("jirokuRecord") !== "1" && t.indexOf("✅") !== 0 && t.indexOf("✔️") !== 0;
      })
      .map(ev => ({
        title: ev.getTitle(),
        time: ev.getStartTime().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" }),
        sub: ev.getLocation() || ""
      }));
    return { ok: true, data };
  } catch (err) { return { ok: true, data: [] }; }
}

function getStudents(coachEmail) {
  const coach = sheetToObjects(getSheet("Coaches")).find(c => c.coach_email === coachEmail);
  if (!coach) return { ok: false, error: "Coach not found" };
  const emails = (coach.assigned_students || "").split(",").map(s => s.trim()).filter(Boolean);
  const users = sheetToObjects(getSheet("Users")).filter(u => emails.includes(u.student_email));
  const reports = sheetToObjects(getSheet("Reports"));
  const data = users.map(u => {
    const r = reports.filter(r => r.student_email === u.student_email).sort((a, b) => b.date > a.date ? 1 : -1)[0];
    return { email: u.student_email, name: u.name, score: r ? Number(r.score) : null, lastReportDate: r?.date || null };
  });
  return { ok: true, data };
}

// 初回オンボーディング（自己分析12問）の保存。回答の読みやすい要約テキストと
// コーチのトーンをUsersに保存し、AIコーチが初日から性格を踏まえて接する。
// 通知間隔・目標時間もこの回答から初期設定する（body.notify_interval / body.goal_hours）
function saveOnboarding(studentEmail, body) {
  const sheet = getSheet("Users");
  const data = sheet.getDataRange().getValues();
  let headers = data[0];
  const emailIdx = headers.indexOf("student_email");
  const ensureCol = (name) => {
    let idx = headers.indexOf(name);
    if (idx === -1) { idx = headers.length; sheet.getRange(1, idx + 1).setValue(name); headers.push(name); }
    return idx;
  };
  const obIdx = ensureCol("onboarding_profile");   // 読める要約テキスト
  const toneIdx = ensureCol("coach_tone");         // 優しめ/厳しめ/淡々/伴走 等
  const intervalIdx = ensureCol("notify_interval");
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][emailIdx]) !== studentEmail) continue;
    if (body.profile_text !== undefined) sheet.getRange(i + 1, obIdx + 1).setValue(String(body.profile_text).slice(0, 3000));
    if (body.coach_tone !== undefined) sheet.getRange(i + 1, toneIdx + 1).setValue(String(body.coach_tone).slice(0, 60));
    if (body.notify_interval !== undefined) sheet.getRange(i + 1, intervalIdx + 1).setValue(Number(body.notify_interval) || 2);
    return { ok: true };
  }
  return { ok: false, error: "user not found" };
}

function saveSettings(studentEmail, body) {
  const sheet = getSheet("Users");
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const emailIdx = headers.indexOf("student_email");

  // 列がなければ追加するヘルパー
  function ensureCol(name) {
    let idx = headers.indexOf(name);
    if (idx === -1) { idx = headers.length; sheet.getRange(1, idx + 1).setValue(name); headers.push(name); }
    return idx;
  }

  const startIdx    = ensureCol("notify_start");
  const endIdx      = ensureCol("notify_end");
  const intervalIdx = ensureCol("notify_interval");
  const goal1Idx    = ensureCol("goal");
  const dead1Idx    = ensureCol("goal_deadline");
  const goal2Idx    = ensureCol("goal2");
  const dead2Idx    = ensureCol("goal_deadline2");
  const goal3Idx    = ensureCol("goal3");
  const dead3Idx    = ensureCol("goal_deadline3");
  const calIdx      = ensureCol("google_calendar_id");
  const lineIdx     = ensureCol("line_user_id");
  const nicknameIdx = ensureCol("nickname");
  const avatarIdx   = ensureCol("avatar");
  const restIdx     = ensureCol("rest_days");

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][emailIdx]) !== studentEmail) continue;
    if (body.notify_start    !== undefined) sheet.getRange(i + 1, startIdx    + 1).setValue(Number(body.notify_start) || 7);
    if (body.notify_end      !== undefined) sheet.getRange(i + 1, endIdx      + 1).setValue(Number(body.notify_end)   || 23);
    if (body.notify_interval !== undefined) sheet.getRange(i + 1, intervalIdx + 1).setValue(Number(body.notify_interval) || 2);
    if (body.goal            !== undefined) sheet.getRange(i + 1, goal1Idx    + 1).setValue(body.goal);
    if (body.goal_deadline   !== undefined) sheet.getRange(i + 1, dead1Idx    + 1).setValue(body.goal_deadline);
    if (body.goal2           !== undefined) sheet.getRange(i + 1, goal2Idx    + 1).setValue(body.goal2);
    if (body.goal_deadline2  !== undefined) sheet.getRange(i + 1, dead2Idx    + 1).setValue(body.goal_deadline2);
    if (body.goal3           !== undefined) sheet.getRange(i + 1, goal3Idx    + 1).setValue(body.goal3);
    if (body.goal_deadline3  !== undefined) sheet.getRange(i + 1, dead3Idx    + 1).setValue(body.goal_deadline3);
    if (body.google_calendar_id !== undefined) sheet.getRange(i + 1, calIdx   + 1).setValue(body.google_calendar_id);
    if (body.line_user_id    !== undefined) sheet.getRange(i + 1, lineIdx     + 1).setValue(body.line_user_id);
    if (body.nickname        !== undefined) sheet.getRange(i + 1, nicknameIdx + 1).setValue(String(body.nickname).trim());
    if (body.avatar          !== undefined) sheet.getRange(i + 1, avatarIdx   + 1).setValue(body.avatar);
    if (body.rest_days       !== undefined) sheet.getRange(i + 1, restIdx     + 1).setNumberFormat("@").setValue(String(body.rest_days));
    break;
  }
  return { ok: true };
}

// 休みの曜日設定（"0,6"のようなカンマ区切りの曜日番号。0=日〜6=土）。
// 休みの日はリマインダーを送らず、XP減衰・ストリークリセットもしない
function isRestDay(user, date) {
  const raw = String(user.rest_days || "").trim();
  if (!raw) return false;
  const d = date instanceof Date ? date : new Date(String(date) + "T00:00:00");
  return raw.split(",").map(s => Number(s.trim())).indexOf(d.getDay()) !== -1;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 自動トリガー
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 全生徒ループの前に5シートを1回だけ読み込み、生徒ごとの分をO(1)で取り出せる
// 関数を返す。buildStudentContextを生徒数ぶん呼んでも各シートの再読み込みが
// 発生しないようにするため（morningScheduleNotify/hourlyReminder/nightlyCoachMessage用）
function preloadContextBundles() {
  const logs = groupBy(sheetToObjects(getSheet("DailyLog")), "student_email");
  const monthlySummaries = groupBy(sheetToObjects(getSheet("MonthlySummary")), "student_email");
  const reports = groupBy(sheetToObjects(getSheet("Reports")), "student_email");
  const coachingNotes = groupBy(sheetToObjects(getCoachingNotesSheet()), "student_email");
  const chatworkMessages = groupBy(sheetToObjects(getChatworkMessagesSheet()), "student_email");
  const messages = groupBy(sheetToObjects(getSheet("Messages")), "student_email");
  return (email) => ({
    logs: logs.get(email) || [],
    monthlySummaries: monthlySummaries.get(email) || [],
    reports: reports.get(email) || [],
    coachingNotes: coachingNotes.get(email) || [],
    chatworkMessages: chatworkMessages.get(email) || [],
    messages: messages.get(email) || []
  });
}

function morningScheduleNotify() {
  const getContextBundle = preloadContextBundles();
  sheetToObjects(getSheet("Users")).filter(u => u.is_active.toUpperCase() === "TRUE").forEach(user => {
    try {
      if (!user.line_user_id && !user.fcm_token) return;

      const apiKey = PropertiesService.getScriptProperties().getProperty("CLAUDE_API_KEY");
      if (!apiKey) return;

      const bundle = getContextBundle(user.student_email);
      const ctx = buildStudentContext(user.student_email, user, bundle);
      const recentMsgs = getRecentCoachMessages(user.student_email, 5, bundle.messages);
      const hour = new Date().getHours();

      const prompt = `あなたは${user.name}の友人でもある教育コーチです。以下の情報をすべて把握した上で、今朝の個別メッセージを送ってください。

${ctx}
${recentMsgs}

【スタイル】
- 敬語とタメ語を自然に混ぜる（「すごいじゃん、さすが！」「今日も一緒に頑張りましょう」など）
- ユーモアを1つ忍ばせて、読んでクスッとできる温度感
- 「---」「【】」「〇〇へのメッセージ」「〇〇案：」「〇〇さんへ」などの見出し・宛名・区切りは絶対使わない
- 本文だけをそのまま書く。前置きや説明・宛名は一切不要
- 挨拶（おはよう等）は絶対に書かない。冒頭のヘッダーで挨拶済みのため、本文からいきなり始める
- 現在は${hour}時。すでに過ぎた時間帯についての行動指示（「朝起きたらまず」等）はせず、今この時間から実行できる提案にする
- 直近のコーチメッセージと同じ言い回し・内容・切り口は絶対に繰り返さない。毎回違う角度から話す
- 全レポート履歴と直近14日のログを踏まえて、具体的なエピソードや数字に触れる
- 過去の記録・メモ・出来事は積極的に引用し、目標と結びつけてコーチングする（本人の言葉を使うと刺さる）。ただし引用は元のメモの意味・文脈を正確に保つこと。意味を取り違えたり不自然なたとえになるくらいなら、その引用は使わない
- 「Chatworkで」のように情報の出どころを名指ししない。本人の状況として自然に触れる
- 記録の時間の単位は「ブロック」ではなく「時間帯」と表現する
- 今日のカレンダー予定がある場合は、目標との関係を意識しつつ今日の過ごし方に軽く触れる
- アメとムチを使い分ける。昨日しっかり記録・行動できていたら惜しみなく褒めて祝う（この時だけは絵文字2〜3個で盛大にしてよい）。逆に記録や行動が止まっているなら、ごまかさずはっきり指摘する。ただし人格ではなく行動を叱ること、見捨てない愛情が伝わる言い方にすること（例：「昨日の記録ゼロは正直もったいない。今日は1つだけでも取り返しましょう」）
- 3文以内。読点（、）で長くつなげず、1文ごとに句点（。！？）で区切って改行が入りやすくする
${EMOJI_STYLE}`;

      const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        payload: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 300, messages: [{ role: "user", content: prompt }] }),
        muteHttpExceptions: true
      });
      const result = JSON.parse(res.getContentText()); logAiUsage(result, "朝の予定通知");
      if (!result.content || !result.content[0]) return;
      const bodyText = stripSalutation(result.content[0].text);
      logCoachMessage(user.student_email, bodyText);
      notifyUserTimeSlot(user, "🌅 今日の一言", bodyText,
        "🌅 おはようございます、" + (user.nickname || user.name) + "さん！\n\n" + formatForLine(bodyText));
    } catch (err) { Logger.log("morningCoach error: " + err); }
  });
}

function hourlyReminder() {
  const hour = new Date().getHours();
  // 22時以降はレポート・夜のコーチメッセージの時間帯なのでリマインダーは送らない
  if (hour >= 22) return;
  const timeBlock = String(hour).padStart(2, "0") + ":00";
  const getContextBundle = preloadContextBundles();
  sheetToObjects(getSheet("Users")).filter(u => u.is_active.toUpperCase() === "TRUE").forEach(user => {
    const start = Number(user.notify_start) || 7;
    const end = Number(user.notify_end) || 23;
    const interval = Number(user.notify_interval) || 2;
    if (hour < start || hour > end) return;
    // 休みの日はリマインダーで急かさない（記録したい人は自発的にすればよい）
    if (isRestDay(user, new Date())) return;
    // 間隔チェック: 1日1回(interval=24)はstart時のみ、それ以外は間隔で割り切れる時間のみ
    if (interval >= 24) {
      if (hour !== start) return;
    } else {
      if ((hour - start) % interval !== 0) return;
    }
    const today = formatDate(new Date());
    const todayLogs = sheetToObjects(getSheet("DailyLog")).filter(l => l.student_email === user.student_email && l.date === today);

    // 直近interval時間以内に記録があればスキップ
    const alreadyLogged = todayLogs.some(l => {
      const lh = parseInt(l.time_block);
      return lh >= hour - interval && lh <= hour;
    });
    if (alreadyLogged) return;

    // 今日1件も記録が無い生徒には、AI生成コストをかけず、最後に記録した日からの
    // 経過日数に応じてエスカレーションする固定テンプレを送る（1日空いた程度と、
    // 何日も止まっている生徒とでは、声のかけ方を変えたいという要望に対応）
    if (todayLogs.length === 0) {
      const lastLogDateStr = user.last_log_date
        ? (user.last_log_date instanceof Date ? formatDate(user.last_log_date) : String(user.last_log_date))
        : "";
      const daysSinceLastLog = lastLogDateStr
        ? Math.round((new Date(today + "T00:00:00") - new Date(lastLogDateStr + "T00:00:00")) / 86400000)
        : null;

      if (daysSinceLastLog === null || daysSinceLastLog >= 2) {
        // LINE専用の日次継続支援(dailyLineWinback)を今日すでに送っていれば、
        // 同じ日にプッシュ側のリマインドを重ねない（通知過多を防ぐ）
        const wbStr = user.last_winback_date
          ? (user.last_winback_date instanceof Date ? formatDate(user.last_winback_date) : String(user.last_winback_date))
          : "";
        if (wbStr === today) return;
        let dormantText;
        if (daysSinceLastLog === null) {
          dormantText = "まだ1件も記録がありません。まずは直近の1時間、何をしていたか記録してみましょう";
        } else if (daysSinceLastLog >= 7) {
          dormantText = daysSinceLastLog + "日間記録がお休みになっています。無理のない範囲で、また1つから再開してみませんか？";
        } else if (daysSinceLastLog >= 4) {
          dormantText = daysSinceLastLog + "日間記録がありません。今日、1つだけでも記録してみましょう";
        } else {
          dormantText = daysSinceLastLog + "日間記録がありません。少しずつで大丈夫なので、今日1つ記録してみましょう";
        }
        notifyUserTimeSlot(user, "📝 記録のお願い", dormantText, dormantText + "\n📝 " + APP_URL + "#quick");
        return;
      }
    }

    // 最後に記録した時間からの経過時間
    const lastLogHour = todayLogs.length > 0
      ? Math.max(...todayLogs.map(l => parseInt(l.time_block)))
      : -99;
    const hoursWithoutLog = hour - lastLogHour;

    // 6時間以上記録がない場合はコーチメッセージ付き。
    // 【コスト対策】AI生成は「朝(9〜11時)・夕(17〜19時)の窓」かつ「1人あたり6時間に1回」
    // だけに制限する（以前は毎時×全員でAIを呼び、アプリ内最大のクレジット消費源だった）。
    // それ以外の時間帯は下の定型文ローテーションが送られる
    const aiWindow = (hour >= 9 && hour <= 11) || (hour >= 17 && hour <= 19);
    if (hoursWithoutLog >= 6 && aiWindow && !aiCapExceeded("hourlyAi", user.student_email, 1)) {
      const apiKey = PropertiesService.getScriptProperties().getProperty("CLAUDE_API_KEY");
      if (apiKey) {
        try {
          // 今日のログ内容をまとめる
          const todayLogSummary = todayLogs.length === 0
            ? "今日はまだ1件も記録していない"
            : `今日すでに${todayLogs.length}件記録済み（${todayLogs.map(l => l.time_block + " " + l.task).join("、")}）、直近の記録から${hoursWithoutLog}時間経過`;

          const bundle = getContextBundle(user.student_email);
          const ctx = buildStudentContext(user.student_email, user, bundle);
          const recentMsgs = getRecentCoachMessages(user.student_email, 3, bundle.messages);

          const prompt = `あなたは${user.name}の教育コーチです。以下の情報を踏まえて、記録を促すごく短い一言を送ってください。

【現在時刻】${hour}時（この時間帯に合わない挨拶は厳禁。「おはよう」は朝以外絶対に使わない。挨拶自体不要）
${ctx}
【今日の状況】${todayLogSummary}
${recentMsgs}

【スタイル】
- 1文だけ・40文字以内。LINEの通知でパッと読める長さ
- 挨拶なしで本題から入る
- 今日の状況に即した一言（記録済みなら軽く承認、未記録なら軽く後押し）
- これは同じ日の中で時間帯ごとに繰り返し送っているリマインドである。「今日も」「今日は」など複数日を比較するような言い回しは使わない（今日の話だと自明なため）
- 今の時間帯にカレンダーの予定があれば、それに触れると効果的（例：「散歩どうだった？記録しとこ」）
- 直近のコーチメッセージと同じ言い回しは使わない
- 「〇〇さんへ」「〇〇へのメッセージ案：」のような宛名・見出し・ラベル・説明は一切書かない。生徒にそのまま送るLINE本文だけを出力する
- URLやリンクは本文に含めない（アプリ側で自動的に案内が付くため）
- 「Chatworkで」のように情報の出どころを名指ししない
- 記録の時間の単位は「ブロック」ではなく「時間帯」と表現する
${EMOJI_STYLE}
- ただし1文だけの短文なので絵文字は1個まで`;

          const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
            payload: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 100, messages: [{ role: "user", content: prompt }] }),
            muteHttpExceptions: true
          });
          const result = JSON.parse(res.getContentText()); logAiUsage(result, "毎時間リマインダー");
          if (result.content && result.content[0]) {
            const bodyText = stripSalutation(result.content[0].text).trim();
            logCoachMessage(user.student_email, bodyText);
            notifyUserTimeSlot(user, "📝 記録リマインダー", bodyText, bodyText + "\n📝 " + APP_URL + "#quick");
            return;
          }
        } catch(e) { Logger.log("hourlyCoach error: " + e); }
      }
    }
    // 定型文ローテーション（AIなし・コストゼロ）。時間帯×日付で文面を回して単調さを避け、
    // 記録済みかどうかでトーンを変える
    const NUDGE_FRESH = [ // 今日まだ記録が少ない/直近が空いている人へ
      "いまの時間、何してた？ひとことだけ記録しよ📝",
      timeBlock + " の記録タイム！サクッといこう⏱",
      "1分だけ。さっきまでのこと、残しておこう✍️",
      "あとで思い出すの大変だから、今のうちに記録📝",
      "ここまでの時間、ひとことでOK🎙",
      "記録タイム！声でつぶやくだけでもOK🎙"
    ];
    const NUDGE_DONE = [ // 今日すでに記録が進んでいる人へ
      "いいペース！この時間の分も残しておこう📝",
      "続いてるね👏 いまの時間もサクッと記録",
      "今日の記録、積み上がってる。この調子で⏱",
      "あと1件だけ足しておこう✍️"
    ];
    const pool = todayLogs.length >= 3 ? NUDGE_DONE : NUDGE_FRESH;
    const pick = pool[(hour + new Date().getDate()) % pool.length];
    notifyUserTimeSlot(user, "⏱ 記録タイム", pick, pick + "\n📝 " + APP_URL + "#quick");
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LINE専用の継続支援（ウィンバック）通知
// 「ログインしていない／記録が止まっている人」を、続けられるように後押しする。
// プッシュ通知(hourlyReminder)とは別建てで、LINEにだけ・1日1回・停滞の節目
// （2/3/5/7/10/14日目、以降は週1）に、責めずに再開を促す温かい文面を送る。
// 未記録（一度も記録がない）人には3日おきに最初の一歩を促す。
// last_winback_dateで送信日を記録し、同じ日に重ねて送らない。
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function dailyLineWinback() {
  if (!LINE_CHANNEL_TOKEN) { Logger.log("dailyLineWinback: LINE未設定のためスキップ"); return; }
  const sheet = getSheet("Users");
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const emailIdx = headers.indexOf("student_email");
  const lineIdx = headers.indexOf("line_user_id");
  const activeIdx = headers.indexOf("is_active");
  const lastLogIdx = headers.indexOf("last_log_date");
  let winIdx = headers.indexOf("last_winback_date");
  if (winIdx === -1) { winIdx = headers.length; sheet.getRange(1, winIdx + 1).setValue("last_winback_date"); }

  const today = formatDate(new Date());
  const todayD = new Date(today + "T00:00:00");
  const link = "\n\n▼ いま、ひとことだけ🎙\n" + APP_URL + "#quick";
  const apiKey = PropertiesService.getScriptProperties().getProperty("CLAUDE_API_KEY");
  // 過去の記録内容を差し込むため、DailyLogをメールでまとめて先読み（ループ内で読み直さない）
  const logsByEmail = groupBy(sheetToObjects(getSheet("DailyLog")), "student_email");
  let sent = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[activeIdx]).toUpperCase() !== "TRUE") continue;
    const lineId = String(row[lineIdx] || "");
    if (!lineId) continue; // LINE連携している人だけが対象

    const user = rowToObject(row, headers);
    if (isRestDay(user, new Date())) continue; // 休みの日は急かさない

    const rawLL = row[lastLogIdx];
    const lastStr = rawLL instanceof Date ? formatDate(rawLL) : String(rawLL || "");
    const days = lastStr ? Math.round((todayD - new Date(lastStr + "T00:00:00")) / 86400000) : null;

    const rawWB = row[winIdx];
    const wbStr = rawWB instanceof Date ? formatDate(rawWB) : String(rawWB || "");
    if (wbStr === today) continue; // 今日はもう送信済み

    let send = false;
    if (days === null) {
      // 一度も記録がない人：3日おきに最初の一歩を促す
      const gap = wbStr ? Math.round((todayD - new Date(wbStr + "T00:00:00")) / 86400000) : 999;
      if (gap >= 3) send = true;
    } else if (days >= 2 && ([2, 3, 5, 7, 10, 14].indexOf(days) !== -1 || (days > 14 && days % 7 === 0))) {
      send = true;
    }
    if (!send) continue;

    // 過去の記録から直近数件を取り出して、AIに具体的に触れさせる材料にする
    const recentLogs = (logsByEmail.get(user.student_email) || [])
      .slice().sort((a, b) => (a.date + (a.time_block || "")) > (b.date + (b.time_block || "")) ? -1 : 1)
      .slice(0, 6);

    // まずAIで一人ひとりに刺さる文面を生成。失敗時はテンプレにフォールバック（取りこぼさない）
    let body = null;
    if (apiKey) { try { body = generateWinbackText(user, days, recentLogs, apiKey); } catch (e) { Logger.log("winback AI例外: " + e); } }
    if (!body) body = buildWinbackText(user, days);

    if (sendLineMessage(lineId, body + link)) {
      sheet.getRange(i + 1, winIdx + 1).setValue(today);
      sent++;
    }
  }
  Logger.log("dailyLineWinback: " + sent + "件送信");
}

// 記録したくなる、心理学を効かせた温かく可愛いウィンバック文面をAIで生成する。
// 本人の目標・過去の記録内容に具体的に触れつつ、責めずに好奇心と自己肯定をくすぐる。
// 生成できなければ null を返し、呼び出し側がテンプレにフォールバックする。
function generateWinbackText(user, days, recentLogs, apiKey) {
  const name = String(user.name || user.nickname || "").trim();
  const goals = effectiveGoalsText(user.student_email, user);
  const logLines = (recentLogs || []).map(function (l) {
    const m = String(l.memo || "").trim();
    return "・" + l.date + " " + (l.time_block || "") + " " + (l.task || "") + (m ? "（" + m.slice(0, 40) + "）" : "");
  }).join("\n");

  const situation = days === null
    ? "まだ一度も記録していません（使い始めの最初の一歩をそっと後押しする段階）。"
    : days + "日、記録がお休みになっています。";

  const nowHour = new Date().getHours();
  const prompt = "あなたはJIROKU（時間の使い方を記録して自分を好きになっていく習慣アプリ）の、優しくてちょっと可愛い相棒キャラです。"
    + (name ? name + "さん" : "この人") + "に、また記録したくなるLINEメッセージを1通書いてください。\n\n"
    + "【現在時刻】" + nowHour + "時台。時間帯に合わない挨拶は絶対に使わない（朝でないのに『おはよう』、昼でないのに『こんにちは』、夜でないのに『こんばんは』はNG）。基本は挨拶なしで本題から。\n"
    + "【状況】" + situation + "\n"
    + "【この人の目標】" + (goals || "未設定") + "\n"
    + "【過去の記録（あれば具体的に触れると効く）】\n" + (logLines || "（記録なし）") + "\n\n"
    + "【心理学のエッセンスをさりげなく効かせる（あくまで自然に。露骨にしない）】\n"
    + "- 好奇心のすき間: 「昨日の自分、何してたっけ？」と思い出したくなる問いかけ\n"
    + "- 自己肯定・アイデンティティ: 「記録できる人＝ちゃんと前に進んでる人」とそっと認める\n"
    + "- スモールステップ: 「ひとことだけ」「1つでいい」とハードルを思いっきり下げる\n"
    + "- 過去の一貫性: 以前がんばっていた記録があれば、その人らしさに触れて思い出させる\n"
    + "- 目標との接続: 目標があれば、その一歩になると軽くつなげる\n"
    + "- 損失回避は使ってよいが、罪悪感やプレッシャーは絶対に与えない\n\n"
    + "【トーン】\n"
    + "- 優しくて、ちょっと甘えるような・可愛い言い回し（絵文字は1〜2個まで。顔文字も可）\n"
    + "- 責めない・急かさない。まず「気にかけてるよ」の気持ちが伝わるように\n"
    + "- 2〜4文・短め。LINEでパッと読めて、思わず開きたくなる長さ\n"
    + "- 「" + (name || "あなた") + "さん」のように自然に呼びかけて始めてよい\n"
    + "- 見出し・ラベル・説明・URLは書かない。本文だけを出力する\n"
    + "- 若者言葉で寒くならないように。あくまで実在の優しい相棒が送る自然な言葉";

  const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    payload: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 300, messages: [{ role: "user", content: prompt }] }),
    muteHttpExceptions: true
  });
  const result = JSON.parse(res.getContentText()); logAiUsage(result, "復帰メッセージ");
  if (!result || !result.content || !result.content[0]) return null;
  const text = String(result.content[0].text || "").trim();
  return text || null;
}

// AIが使えない/失敗した時のフォールバック。停滞状況ごとに、可愛く温かい文面を
// ランダムに1つ選んで少しだけ変化を出す（毎回同じ文面にならないように）。
function buildWinbackText(user, days) {
  const name = String(user.name || user.nickname || "").trim();
  const goal = String(user.goal || "").trim();
  const nm = name ? name + "さん、" : "";
  const pick = function (arr) { return arr[Math.floor(Math.random() * arr.length)]; };
  const goalLine = goal ? "\n「" + goal + "」、あなたのペースで大丈夫だよ🌱" : "";
  let body;
  if (days === null) {
    body = nm + pick([
      "はじめまして、これから相棒になるよ☺️ まずは今日の“ひとこと”から、そっと始めてみない？",
      "まだ記録が真っ白のまま待ってるよ。直近の1時間、何してたか一言だけ教えて〜🎙",
      "最初の1回がいちばん勇気いるよね。でも“ひとこと”でいいの。いっしょにやろ？"
    ]) + goalLine;
  } else if (days >= 14) {
    body = nm + pick([
      "ひさしぶり…！ちゃんと待ってたよ🥺 責める気持ちはゼロ。今日ひとことだけ、戻ってきてくれたら嬉しいな。",
      "" + days + "日ぶりだね。離れる時期があるのも自然なこと。またゆっくり、一言から再会しよ？",
      "おかえりの準備、いつでもできてるよ☺️ 完璧じゃなくていいの。今日の“ひとこと”から。"
    ]) + goalLine;
  } else if (days >= 7) {
    body = nm + pick([
      "ちょっとだけ会えてなかったね（" + days + "日ぶり）。今日ひとこと残すと、また流れが戻ってくるよ〜🌿",
      "" + days + "日ぶりのあなたの“今”、こっそり知りたいな👀 一言でいいから教えて？",
      "完璧じゃなくて大丈夫。今日の1メモから、そっと再開しよ？"
    ]) + goalLine;
  } else if (days >= 5) {
    body = nm + pick([
      "ここ数日お休み中だね。ハードルは低くていいよ、今日の出来事を1つだけ残してみよ？☺️",
      "そういえば最近どうしてた？いま何してたか、ひとことだけ教えて〜🎙"
    ]);
  } else {
    body = nm + pick([
      "ここ" + days + "日ちょっと空いてるね。昨日の自分、何してたか思い出せる？今の“ひとこと”からいこ？",
      "ちょっとした一言でOK！今の時間、何してたか教えて〜☺️"
    ]);
  }
  return body;
}

function updateStreak(studentEmail) {
  const sheet = getSheet("Users");
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const emailIdx = headers.indexOf("student_email");
  let streakIdx = headers.indexOf("streak");
  let lastLogDateIdx = headers.indexOf("last_log_date");

  if (streakIdx === -1) {
    streakIdx = headers.length;
    sheet.getRange(1, streakIdx + 1).setValue("streak");
  }
  if (lastLogDateIdx === -1) {
    lastLogDateIdx = headers.length + (streakIdx === headers.length ? 1 : 0);
    sheet.getRange(1, lastLogDateIdx + 1).setValue("last_log_date");
  }

  const today = formatDate(new Date());
  const yesterday = formatDate(new Date(Date.now() - 86400000));

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][emailIdx]) !== studentEmail) continue;
    const rawLLD = data[i][lastLogDateIdx];
    const lastLogDate = rawLLD instanceof Date ? Utilities.formatDate(rawLLD, "Asia/Tokyo", "yyyy-MM-dd") : String(rawLLD || "");
    const currentStreak = Number(data[i][streakIdx] || 0);

    let newStreak;
    if (lastLogDate === today) return; // 今日すでに更新済み
    if (lastLogDate === yesterday) {
      newStreak = currentStreak + 1; // 連続
    } else {
      newStreak = 1; // リセット
    }

    sheet.getRange(i + 1, streakIdx + 1).setValue(newStreak);
    sheet.getRange(i + 1, lastLogDateIdx + 1).setValue(today);

    // ── コミュニティのシェア欄を賑やかに＆偏りなく ──
    // updateStreakは「その日の最初の記録」で1回だけ動くので、ここでのシェアは1日1回/人。
    // 新しく始めた人・戻ってきた人・小さな連続の節目を取り上げ、上位常連以外も光を当てる。
    try {
      if (lastLogDate === "") {
        // これまで一度も記録が無かった人の、はじめての記録
        postAchievementMessage(studentEmail, pickMsg(NEWCOMER_MESSAGES), { category: "newcomer" });
      } else if (newStreak === 1 && lastLogDate !== yesterday) {
        // 昨日は記録が無く連続が途切れていた＝しばらくぶりのカムバック
        const gap = Math.round((new Date(today + "T00:00:00") - new Date(lastLogDate + "T00:00:00")) / 86400000);
        if (gap >= 4) postAchievementMessage(studentEmail, pickMsg(COMEBACK_MESSAGES), { category: "comeback", cooldownDays: 7 });
      }
      // 連続記録の節目（小さな節目=3日も入れて初心者を拾う）
      if ([3, 7, 14, 30, 50, 100, 200, 365].indexOf(newStreak) !== -1) {
        postAchievementMessage(studentEmail, streakShareMessage(newStreak), { category: "streak" });
      }
    } catch (e) { Logger.log("streak share error: " + e); }

    // ストリークフリーズの獲得: 7日連続ごとに1個（最大2個まで保有）。
    // 続けたご褒美として「休んでも消えない保険」が貯まる（Duolingo方式）
    if (newStreak > 0 && newStreak % 7 === 0) {
      let freezeIdx = headers.indexOf("streak_freeze");
      if (freezeIdx === -1) { freezeIdx = headers.length; sheet.getRange(1, freezeIdx + 1).setValue("streak_freeze"); }
      const freezes = freezeIdx < data[i].length ? Number(data[i][freezeIdx] || 0) : 0;
      if (freezes < 2) {
        sheet.getRange(i + 1, freezeIdx + 1).setValue(freezes + 1);
        try { postAchievementMessage(studentEmail, freezeShareMessage(newStreak), { category: "freeze", cooldownDays: 5 }); } catch (e) {}
      }
    }
    break;
  }
}

// 夜間バッチが対象とする「締めの日」。22時のトリガーが正常な時間に動けば当日だが、
// 発火の遅延や手動実行が深夜0時を跨ぐと「今日=翌日」の記録（当然まだ0件）を見て
// 全員を記録なしと誤判定し、XP減衰・ストリークリセットを誤発動してしまうため、
// 正午より前の実行は「前日」を締めの対象にする
function nightlyTargetDate() {
  const now = new Date();
  if (now.getHours() < 12) return formatDate(new Date(now.getTime() - 86400000));
  return formatDate(now);
}

// 生徒1人ずつ順にAI呼び出し→保存するため、生徒数が増えるとGASの実行時間上限
// （6分）に達して途中で強制終了することがある。この場合エラーとしても記録されず、
// シートの後ろの方にいる生徒ほどレポートが生成されないまま無言で欠落していた
// （2026-07-13に発覚・修正）。対策として経過時間を監視し、上限に近づいたら
// 「どこまで処理したか」をスクリプトプロパティに保存して安全に中断、
// 1分後に自動再開するトリガーを1回だけ作る（この続き実行トリガーは発火後に自動削除される）
const NIGHTLY_REPORT_TIME_BUDGET_MS = 5 * 60 * 1000; // GAS上限6分に対して5分で切り上げる

function nightlyReport() {
  const today = nightlyTargetDate();
  const isSameDay = today === formatDate(new Date());
  const startedAt = Date.now();

  const props = PropertiesService.getScriptProperties();

  // ★重要: 今回この関数を発火させた「再開トリガー」を必ず削除する。
  // GASの .after() トリガーは発火後に自動削除されないため、放置するとトリガーが
  // 溜まり続け、上限（20個）に達して新しい再開トリガーの作成が失敗し、
  // 後半の生徒のレポートが無言で欠落する。IDで確実に消してから続きを処理する。
  const prevTid = props.getProperty("NIGHTLY_REPORT_RESUME_TRIGGER_ID");
  if (prevTid) {
    try { ScriptApp.getProjectTriggers().forEach(t => { if (t.getUniqueId() === prevTid) ScriptApp.deleteTrigger(t); }); } catch (e) { Logger.log("resume trigger削除失敗: " + e); }
    props.deleteProperty("NIGHTLY_REPORT_RESUME_TRIGGER_ID");
  }

  const resumeDate = props.getProperty("NIGHTLY_REPORT_RESUME_DATE");
  const startIndex = (resumeDate === today) ? Number(props.getProperty("NIGHTLY_REPORT_RESUME_INDEX") || 0) : 0;

  const users = sheetToObjects(getSheet("Users")).filter(u => u.is_active.toUpperCase() === "TRUE");
  // 各シートは一度だけ読む（生徒ごとにReports全読みするとO(N^2)で遅く、
  // 分割回数が増える＝再開トリガーも増えるため）
  const allLogs = sheetToObjects(getSheet("DailyLog"));
  const haveReport = new Set(
    sheetToObjects(getSheet("Reports")).map(r => r.student_email + "|" + r.date)
  );
  // そのレポートが何件の記録をもとに採点したか。夜22時のレポート生成より後に
  // 独り言などで記録を足すと、点数に反映されないまま固定されてしまっていたので、
  // 件数が変わっていたら翌晩に作り直す。log_count列が無い古い行はnullになり、
  // 「作り直しの対象にしない」（過去分を一斉に再生成してAI費用が跳ねるのを防ぐ）
  const reportLogCount = new Map();
  sheetToObjects(getSheet("Reports")).forEach(r => {
    const v = String(r.log_count == null ? "" : r.log_count).trim();
    if (v !== "") reportLogCount.set(r.student_email + "|" + r.date, Number(v));
  });
  // メール別に「記録がある日付」の集合を作る（当日判定と穴埋め判定の両方に使う）
  const logDatesByEmail = new Map();
  const logCountByKey = new Map(); // "email|date" → 記録件数（レポートの作り直し判定に使う）
  allLogs.forEach(l => {
    const em = String(l.student_email || "");
    if (!em) return;
    (logDatesByEmail.get(em) || logDatesByEmail.set(em, new Set()).get(em)).add(l.date);
    const k = em + "|" + l.date;
    logCountByKey.set(k, (logCountByKey.get(k) || 0) + 1);
  });

  // レポートを作る/作り直す必要があるか。
  // ①まだ無い → 作る ②既にあり、採点に使った件数と今の件数が違う → 作り直す
  // （log_count列が無い古いレポートは対象外＝作り直さない）
  const needsReport = (email, date) => {
    const k = email + "|" + date;
    if (!haveReport.has(k)) return true;
    const prev = reportLogCount.get(k);
    return prev != null && prev !== (logCountByKey.get(k) || 0);
  };
  const logsFor = (email, date) => allLogs
    .filter(r => r.student_email === email && r.date === date)
    .sort((a, b) => a.time_block > b.time_block ? 1 : -1)
    .map(r => ({ time_block: r.time_block, task: r.task, focus_level: r.focus_level, memo: r.memo }));

  // 処理リスト（jobs）を組み立てる：
  // ①当日分（記録あり・レポート未生成）②過去2日の穴埋め（生成失敗などで欠けた分）。
  // 以前は当日に生成失敗すると catch → Logger.log で黙って飛ばされ、そのユーザーの
  // その日のレポートが永久に欠落していた（「レポートが表示されない」の原因）。
  // 毎晩、直近2日ぶんの欠落を自動リカバリすることで穴が残らないようにする。
  const jobs = [];
  users.forEach(u => {
    const dset = logDatesByEmail.get(u.student_email);
    if (dset && dset.has(today) && needsReport(u.student_email, today)) {
      jobs.push({ user: u, date: today, backfill: false });
    }
  });
  for (let back = 1; back <= 2; back++) {
    const d = new Date(today + "T00:00:00+09:00"); d.setDate(d.getDate() - back);
    const bd = formatDate(d);
    users.forEach(u => {
      const dset = logDatesByEmail.get(u.student_email);
      if (dset && dset.has(bd) && needsReport(u.student_email, bd)) {
        // 既にレポートがある＝「欠落の穴埋め」ではなく「記録が増えたので採点し直し」。
        // 作り直しではLINE通知を送らない（同じ日のレポートが二度届くのを防ぐ）
        jobs.push({ user: u, date: bd, backfill: true, regenerate: haveReport.has(u.student_email + "|" + bd) });
      }
    });
  }

  // XP減少・ストリークリセット（当日記録なしのユーザー）は軽い処理なので
  // 初回起動時にまとめて実行する（再開時に二重適用しない）
  if (startIndex === 0) {
    users.forEach(u => {
      const dset = logDatesByEmail.get(u.student_email);
      if (!dset || !dset.has(today)) {
        try { applyXPDecay(u.student_email, today); } catch (e) { Logger.log(e); }
      }
    });
  }

  for (let i = startIndex; i < jobs.length; i++) {
    if (Date.now() - startedAt > NIGHTLY_REPORT_TIME_BUDGET_MS) {
      // 時間切れ: 続きから再開できるよう位置を保存し、1分後に自分自身を再実行するトリガーを張る。
      // 作ったトリガーのIDを控えておき、次回起動の冒頭で必ず削除する（溜まり防止）
      props.setProperty("NIGHTLY_REPORT_RESUME_DATE", today);
      props.setProperty("NIGHTLY_REPORT_RESUME_INDEX", String(i));
      try {
        const t = ScriptApp.newTrigger("nightlyReport").timeBased().after(60 * 1000).create();
        props.setProperty("NIGHTLY_REPORT_RESUME_TRIGGER_ID", t.getUniqueId());
      } catch (e) {
        // トリガー作成に失敗（上限等）した場合でも黙って落とさず記録に残す
        Logger.log("nightlyReport: 再開トリガー作成に失敗: " + e);
      }
      Logger.log("nightlyReport: 時間切れのため" + i + "件目から中断・1分後に再開します（全" + jobs.length + "件）");
      return;
    }
    const job = jobs[i];
    const user = job.user;
    try {
      const logs = logsFor(user.student_email, job.date);
      if (logs.length === 0) continue;

      // 日付を跨いだ後の実行では、updateStreakが「翌日」を記録日として
      // 誤登録してしまうためスキップする（記録保存時にも更新されているので実害はない）
      if (!job.backfill && isSameDay) updateStreak(user.student_email);
      const report = generateReportWithClaude(user.student_email, user.name, logs);
      if (!report) { Logger.log("nightlyReport: 生成失敗 " + user.student_email + " " + job.date + "（翌晩の穴埋めで再試行）"); continue; }
      if (job.regenerate) Logger.log("nightlyReport: 記録が増えたため採点し直し " + user.student_email + " " + job.date + "（" + logs.length + "件）");
      appendReportRow(job.date, user.student_email, report, logs.length);
      haveReport.add(user.student_email + "|" + job.date);
      reportLogCount.set(user.student_email + "|" + job.date, logs.length);

      // ★新しい5項目のレポートの点数を、この夜のうちに確定させる★（2026-08-05）
      //
      //   これまでこの処理は手動実行用の adminRunNightlyReport にしか入っておらず、
      //   実際に毎晩動く側（この関数）には入っていなかった。そのため
      //   ・LINEには古いAIの点数が送られ、アプリの画面と食い違う
      //   ・「一度作られたレポートは変わらない」が効かない
      //   という状態だった。機能を全員に開くにあたって、こちらへ移す。
      try {
        if (hasFeature(user, OPS_FEATURE_KEY)) {
          const ops = getDailyOpsReport(user.student_email, { date: job.date });
          if (ops && ops.ok && ops.data && ops.data.displayed_score !== null &&
              ops.data.displayed_score !== undefined) {
            report.__ops_score = ops.data.displayed_score;   // LINEにも同じ点数を送る
          }
          finalizeDailyOpsReport(user.student_email, job.date);   // 以後この日の点数は動かない
          // 自己経営力ランキング用の総合点を温めておく（1人数秒かかるため）。
          // ただしレポート生成そのものを圧迫しないよう、時間に余裕がある時だけ。
          if (Date.now() - startedAt < NIGHTLY_REPORT_TIME_BUDGET_MS * 0.7) {
            try { smpOverallCached_(user.student_email, true); } catch (e2) {}
          // 自己経営力そのものも温めておく（朝いちばんに開く人を待たせないため）
          try { getSelfMgmtPower(user.student_email, { withPrev: "1" }); } catch (e2) {}
          }
          // 点数が画面と食い違っていないか、夜のうちに自分で確かめる（2026-08-04 Kaiの指示）
          try {
            const dv = (ops && ops.ok && ops.data) ? ops.data.displayed_score : null;
            const lst = getReportList(user.student_email);
            const lrow = (lst.data || []).find(function (x) { return String(x.date).slice(0, 10) === job.date; });
            const lv = lrow ? lrow.score : null;
            if (dv !== null && lv !== null && Number(dv) !== Number(lv)) {
              authAudit("SCORE_MISMATCH", { result: "DENY", action: "nightlyReport",
                failureReason: user.student_email + " " + job.date + " detail=" + dv + " list=" + lv });
            }
          } catch (e3) {}
        }
      } catch (e) { /* 新レポートが作れなくても、従来の配信は止めない */ }
      // 穴埋め分は当日の文脈で送ると混乱するため、LINE/コーチ通知は当日分のみ
      if (!job.backfill) {
        sendReportLineMessage(user, report);
        notifyCoachOnReport(user, report);
        // その日たくさん記録した人を、時間帯数（数字）でシェア欄に取り上げる
        try {
          const blocks = logs.length;
          if ([6, 8, 10, 12, 15].some(m => blocks === m) || blocks >= 15) {
            postAchievementMessage(user.student_email, dailyVolumeShareMessage(blocks), { category: "daily_volume", cooldownDays: 1 });
          }
        } catch (e) {}
      }
    } catch (err) { Logger.log(err); }
  }

  // 全員処理完了。再開用の状態が残っていればクリアする
  props.deleteProperty("NIGHTLY_REPORT_RESUME_DATE");
  props.deleteProperty("NIGHTLY_REPORT_RESUME_INDEX");
  props.deleteProperty("NIGHTLY_REPORT_RESUME_TRIGGER_ID");
}

function sendReportLineMessage(user, report) {
  // 新しいレポートを使っている人には、その点数を送る（画面と食い違わせない）
  try {
    if (hasFeature(user, OPS_FEATURE_KEY) && report.__ops_score !== undefined && report.__ops_score !== null) {
      report = Object.assign({}, report, { score: report.__ops_score });
    }
  } catch (e) {}
  const latestUser = sheetToObjects(getSheet("Users")).find(u => u.student_email === user.student_email);
  const streak = Number(latestUser?.streak || 1);
  const streakMsg = streak >= 3 ? "\n\n🔥 連続" + streak + "日記録中！" : "";
  const trendMsg = report.trend ? "\n\n📈 " + formatForLine(stripSalutation(report.trend)) : "";
  sendLineMessage(user.line_user_id,
    "📊 今日のAIレポート\n\nスコア：" + report.score + "点\n\n"
    + formatForLine(stripSalutation(report.feedback))
    + trendMsg
    + "\n\n✅ 明日のアクション\n" + formatForLine(stripSalutation(report.action))
    + streakMsg);
}

// 夜間バッチが走らなかった時にWeb API経由で補完実行するための管理用エンドポイント。
// 通常のnightlyReportと違いXP減衰は行わず（手動の補完実行で罰を与えないため）、
// 生徒ごとの結果（生成/スキップ/エラー内容）をJSONで返すので原因調査にも使える
function adminRunNightlyReport(email) {
  if (!verifyAdmin(email)) return { ok: false, error: "not admin" };
  const targetDate = nightlyTargetDate();
  const results = [];
  sheetToObjects(getSheet("Users")).filter(u => u.is_active.toUpperCase() === "TRUE").forEach(user => {
    try {
      const logs = getLogs(user.student_email, { date: targetDate }).data;
      if (logs.length === 0) { results.push({ email: user.student_email, status: "no-logs" }); return; }
      const existing = sheetToObjects(getSheet("Reports")).find(r => r.student_email === user.student_email && r.date === targetDate);
      if (existing) { results.push({ email: user.student_email, status: "already-exists" }); return; }
      const report = generateReportWithClaude(user.student_email, user.name, logs);
      if (!report) { results.push({ email: user.student_email, status: "ai-failed", reason: REPORT_GEN_LAST_ERROR }); return; }
      appendReportRow(targetDate, user.student_email, report, logs.length);
      // 新しい5項目のレポートを使っている人は、その日の分をここで作って保存する。
      // 一覧・LINE・詳細で同じ点数になるようにするため（2026-08-03）
      try {
        if (hasFeature(user, OPS_FEATURE_KEY)) {
          const ops = getDailyOpsReport(user.student_email, { date: targetDate });
          if (ops && ops.ok && ops.data && ops.data.displayed_score !== null &&
              ops.data.displayed_score !== undefined) {
            report.__ops_score = ops.data.displayed_score;
          }
          // ここで締める。以後この日の点数は動かない
          finalizeDailyOpsReport(user.student_email, targetDate);
          // ★自己経営力ランキング用の総合点を、この夜のうちに計算しておく★（2026-08-05）
          //   1人あたり数秒かかるため、利用者が「みんなの頑張り」を開いた時に
          //   その場で全員ぶん回すと画面が開かない。夜のうちに温めておく。
          try { smpOverallCached_(user.student_email, true); } catch (e) {}
          // ★毎晩、点数が食い違っていないか自分で確かめる★（2026-08-04 Kaiの指示）
          //   画面ごとに違う数字が出ていたことがあるため、夜のうちに気づけるようにする
          try {
            const detail = getDailyOpsReport(user.student_email, { date: targetDate });
            const dv = detail && detail.ok && detail.data ? detail.data.displayed_score : null;
            const lst = getReportList(user.student_email);
            const lrow = (lst.data || []).find(function (x) { return String(x.date).slice(0, 10) === targetDate; });
            const lv = lrow ? lrow.score : null;
            if (dv !== null && lv !== null && Number(dv) !== Number(lv)) {
              authAudit("SCORE_MISMATCH", { result: "DENY", action: "nightlyReport",
                failureReason: user.student_email + " " + targetDate + " detail=" + dv + " list=" + lv });
            }
          } catch (e3) {}
        }
      } catch (e) { /* 新レポートが作れなくても、従来の配信は止めない */ }
      if (user.line_user_id) sendReportLineMessage(user, report);
      notifyCoachOnReport(user, report);
      results.push({ email: user.student_email, status: "sent", score: report.score });
    } catch (err) {
      results.push({ email: user.student_email, status: "error", error: String(err) });
    }
  });
  return { ok: true, targetDate: targetDate, results: results };
}

// 特定の日付でレポート欠落を補完する管理用エンドポイント。nightlyReportの
// GAS実行時間切れで生成されなかった過去分をまとめて埋めるために使う
// （2026-07-13の欠落発覚時に追加。既存レポート・ログなしはスキップするので何度呼んでも安全）
function adminBackfillReportsForDate(email, date) {
  if (!verifyAdmin(email)) return { ok: false, error: "not admin" };
  if (!date) return { ok: false, error: "missing date" };
  const results = [];
  sheetToObjects(getSheet("Users")).filter(u => u.is_active.toUpperCase() === "TRUE").forEach(user => {
    try {
      const logs = getLogs(user.student_email, { date: date }).data;
      if (logs.length === 0) { results.push({ email: user.student_email, status: "no-logs" }); return; }
      const existing = sheetToObjects(getSheet("Reports")).find(r => r.student_email === user.student_email && r.date === date);
      if (existing) { results.push({ email: user.student_email, status: "already-exists" }); return; }
      const report = generateReportWithClaude(user.student_email, user.name, logs);
      if (!report) { results.push({ email: user.student_email, status: "ai-failed", reason: REPORT_GEN_LAST_ERROR }); return; }
      appendReportRow(date, user.student_email, report, logs.length);
      // 補完実行なので、過去分のLINE通知は本人に再送しない（コーチ通知もしない）。
      // レポート自体（ランキング・レポート画面）だけを埋める
      results.push({ email: user.student_email, status: "sent", score: report.score });
    } catch (err) {
      results.push({ email: user.student_email, status: "error", error: String(err) });
    }
  });
  return { ok: true, targetDate: date, results: results };
}

function adminRunNightlyCoachMessage(email) {
  if (!verifyAdmin(email)) return { ok: false, error: "not admin" };
  nightlyCoachMessage();
  return { ok: true, targetDate: nightlyTargetDate() };
}

// JIROKUに登録済み(is_active=TRUE)かつLINE連携済みの生徒全員にLINEでお知らせを送る。
// confirm="yes"を渡さない限り実際には送信せず、対象人数とプレビューだけ返す
// （一斉送信は取り消せないため、必ず事前確認できるようにしている）
function adminBroadcastLine(email, message, confirm, imageUrl, previewUrl) {
  if (!verifyAdmin(email)) return { ok: false, error: "not admin" };
  if (!message) return { ok: false, error: "message is required" };
  const targets = sheetToObjects(getSheet("Users")).filter(u =>
    u.is_active.toUpperCase() === "TRUE" && u.line_user_id
  );
  if (confirm !== "yes") {
    return { ok: true, dryRun: true, recipientCount: targets.length, preview: message,
             image: imageUrl || null };
  }
  let sent = 0, imgSent = 0;
  targets.forEach(u => {
    // 画像 → 本文 の順。先に絵が出たほうが読んでもらえる
    if (imageUrl && sendLineImage(u.line_user_id, imageUrl, previewUrl)) imgSent++;
    if (sendLineMessage(u.line_user_id, message)) sent++;
  });
  return { ok: true, dryRun: false, recipientCount: targets.length,
           sentCount: sent, imageSentCount: imgSent };
}

// ★まだセッションを取得していない人だけへ送る★
//
// なぜ必要か:
//   切替日の予告（2通目）を全員へ送ると、すでに再ログインを済ませた人に
//   「まだやっていませんね」と伝わってしまう。協力してくれた人へ
//   催促を送るのは失礼だし、次の案内も読まれなくなる。
//
// 対象の数え方は authCohort / authInspect と同一条件にすること。
// revoked_at が空なだけの行を「有効」と数えると、実際には使えない
// セッションを持つ人を対象から外してしまい、その人が切替日に詰む。
function adminBroadcastLinePending(email, message, confirm) {
  if (!verifyAdmin(email)) return { ok: false, error: "not admin" };
  if (!message) return { ok: false, error: "message is required" };

  const users = sheetToObjects(getSheet("Users"));
  const tvByUser = {};
  users.forEach(function (u) { if (u.user_id) tvByUser[String(u.user_id)] = tokenVer_(u.token_version); });

  const now = Date.now();
  const hasUsable = {};
  sheetToObjects(getAuthSheet("Sessions")).forEach(function (x) {
    if (String(x.revoked_at || "").trim()) return;
    if (new Date(String(x.expires_at)).getTime() <= now) return;
    const cur = tvByUser[String(x.user_id)];
    if (cur === undefined) return;
    if (tokenVer_(x.token_version) !== cur) return;
    hasUsable[String(x.user_id)] = true;
  });

  const linked = users.filter(function (u) {
    return String(u.is_active).toUpperCase() === "TRUE" && String(u.line_user_id || "").trim();
  });
  const targets = linked.filter(function (u) {
    return !(u.user_id && hasUsable[String(u.user_id)]);
  });
  const skipped = linked.length - targets.length;

  if (confirm !== "yes") {
    return { ok: true, dryRun: true, linkedCount: linked.length,
             recipientCount: targets.length, alreadyDoneSkipped: skipped, preview: message };
  }
  let sent = 0;
  targets.forEach(function (u) { if (sendLineMessage(u.line_user_id, message)) sent++; });
  return { ok: true, dryRun: false, linkedCount: linked.length,
           recipientCount: targets.length, alreadyDoneSkipped: skipped, sentCount: sent };
}

function nightlyCoachMessage() {
  const today = nightlyTargetDate();
  const apiKey = PropertiesService.getScriptProperties().getProperty("CLAUDE_API_KEY");
  if (!apiKey) return;

  const getContextBundle = preloadContextBundles();
  sheetToObjects(getSheet("Users")).filter(u => u.is_active.toUpperCase() === "TRUE").forEach(user => {
    try {
      if (!user.line_user_id) return;
      const bundle = getContextBundle(user.student_email);
      // 今日のレポートがある場合のみ送る
      const report = bundle.reports.find(r => r.date === today);
      if (!report) return;

      const ctx = buildStudentContext(user.student_email, user, bundle);
      const recentMsgs = getRecentCoachMessages(user.student_email, 5, bundle.messages);
      const streak = Number(user.streak || 0);
      const coachPrompt = `あなたは${user.name}の友人でもある教育コーチです。1時間前にAIレポート（スコアと分析）は既に送信済みです。それとは別の、1日の終わりの人間らしい一言を送ってください。

${ctx}
【1時間前に送信済みのレポート内容（絶対に繰り返さない）】
スコア${report.score}点 / 良かった点：${report.highlights} / 改善点：${report.improvement}
【連続記録日数】${streak}日
${recentMsgs}

【スタイル】
- 今は夜22時台。挨拶（おはよう・こんにちは等）は書かず、時間帯に合った内容で本題から入る
- レポートの内容（スコア・良かった点・改善点）を言い直さない。分析はもう終わってる
- カレンダーの予定と実際の記録を見比べて、予定どおり実行できていた場面があれば具体的に承認する
- 今日のログの中の具体的な一場面を1つだけ拾って、そこに一言添える
- 過去のメモや出来事の引用は歓迎だが、元の意味・文脈を正確に保つこと。取り違えた引用をするくらいなら使わない
- 「Chatworkで」のように情報の出どころを名指ししない。本人の状況として自然に触れる
- 記録の時間の単位は「ブロック」ではなく「時間帯」と表現する
- 敬語とタメ語を自然に混ぜる。友人が寝る前に送るLINEのような温度感
- 「---」「【】」「〇〇さんへ」などの見出し・宛名は絶対使わない
- 直近のコーチメッセージと同じ言い回し・構成は絶対に繰り返さない
- アメとムチを使い分ける。今日よく頑張れた日（高スコア・目標への時間がしっかり積めた・有言実行できた等）は惜しみなく祝う（この時だけは絵文字2〜3個で盛大にしてよい）。逆に予定していたことをやれていない・記録が薄い日は、ごまかして褒めず、はっきり指摘して明日への発奮を促す。ただし人格ではなく行動を叱ること、見捨てない愛情が伝わる言い方にすること
- 2文以内。読点（、）で長くつなげず、1文ごとに句点（。！？）で区切って改行が入りやすくする
${EMOJI_STYLE}`;

      const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        payload: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 400, messages: [{ role: "user", content: coachPrompt }] }),
        muteHttpExceptions: true
      });
      const result = JSON.parse(res.getContentText()); logAiUsage(result, "夜のコーチメッセージ");
      if (result.content && result.content[0]) {
        const bodyText = stripSalutation(result.content[0].text);
        logCoachMessage(user.student_email, bodyText);
        sendLineMessage(user.line_user_id, formatForLine(bodyText));
      }
    } catch(e) { Logger.log("nightlyCoachMessage error: " + e); }
  });
}

// 記録なしの日はXPを減らしてストリークをリセット
function applyXPDecay(studentEmail, targetDate) {
  const sheet = getSheet("Users");
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const emailIdx = headers.indexOf("student_email");
  const xpIdx = headers.indexOf("xp");
  const streakIdx = headers.indexOf("streak");
  const lastLogDateIdx = headers.indexOf("last_log_date");
  let freezeIdx = headers.indexOf("streak_freeze");
  if (freezeIdx === -1) { freezeIdx = headers.length; sheet.getRange(1, freezeIdx + 1).setValue("streak_freeze"); }
  // 「締めの日」の前日。深夜0時を跨いだ実行でも判定がずれないよう、実行時刻ではなく
  // 対象日を基準に計算する（未指定なら従来通り実行日基準）
  const baseDate = targetDate ? new Date(targetDate + "T00:00:00") : new Date();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][emailIdx]) !== studentEmail) continue;

    const currentXP = Number(data[i][xpIdx] || 0);
    const rawLLD2 = data[i][lastLogDateIdx];
    const lastLogDate = rawLLD2 instanceof Date ? Utilities.formatDate(rawLLD2, "Asia/Tokyo", "yyyy-MM-dd") : String(rawLLD2 || "");
    const yesterday = formatDate(new Date(baseDate.getTime() - 86400000));
    const currentStreak = Number(data[i][streakIdx] || 0);
    const freezes = freezeIdx < data[i].length ? Number(data[i][freezeIdx] || 0) : 0;

    // 休みの日に記録がなくても罰しない: XP減衰もストリークリセットもフリーズ消費もせず、
    // last_log_dateだけ進めて翌日の連続性を保つ（休むこと自体を尊重する）
    const restIdx2 = headers.indexOf("rest_days");
    const restDays = restIdx2 !== -1 ? String(data[i][restIdx2] || "") : "";
    if (isRestDay({ rest_days: restDays }, baseDate)) {
      if (currentStreak > 0) sheet.getRange(i + 1, lastLogDateIdx + 1).setValue(formatDate(baseDate));
      Logger.log(studentEmail + ": 休みの日のため減衰・リセットなし");
      break;
    }

    // ストリークフリーズ（Duolingo方式）: 1日休んだだけで連続記録が消えるのは
    // 酷なので、保有していれば自動で1つ消費してストリークとXPを守る。
    // last_log_dateを「休んだ日」に進めることで、翌日の記録が連続として扱われる
    if (freezes > 0 && currentStreak > 0) {
      sheet.getRange(i + 1, freezeIdx + 1).setValue(freezes - 1);
      sheet.getRange(i + 1, lastLogDateIdx + 1).setValue(formatDate(baseDate));
      const lineIdx = headers.indexOf("line_user_id");
      const fcmIdx = headers.indexOf("fcm_token");
      try {
        notifyUserTimeSlot(
          { line_user_id: data[i][lineIdx], fcm_token: fcmIdx !== -1 ? data[i][fcmIdx] : "" },
          "🧊 連続記録を守りました",
          "昨日は記録がありませんでしたが、フリーズを1つ使って" + currentStreak + "日連続を守りました。今日1つ記録すれば継続です",
          "🧊 フリーズを1つ使って、" + currentStreak + "日連続の記録を守りました。\n今日1つ記録すれば、そのまま継続です！\n📝 " + APP_URL
        );
      } catch (e) { /* 通知失敗しても本処理は成立させる */ }
      Logger.log(studentEmail + ": フリーズ消費でストリーク" + currentStreak + "を維持（残り" + (freezes - 1) + "個）");
      break;
    }

    // 昨日も記録なしなら減少額を増やす（最大-30）
    const missedYesterday = lastLogDate !== yesterday;
    const decay = missedYesterday ? 30 : 15;
    // ★下限を設ける★（2026-08-05 Kaiの判断）
    //   これまで減点に下限が無く、ゼロまで削れていた。
    //   215件記録した人が28%、123件記録した人が2%まで落ち、
    //   Lv.1のルーキーに戻っていた。積み上げが全部消えると、
    //   離れた人が戻ってきたときに「また最初から」になる。
    //   到達した最高レベルの1つ下のレベル（の入口XP）までしか下げない。
    //   休んだ痛みは残しつつ、やってきた事実は残す。
    const floorXP = xpDecayFloor_(sheet, headers, data[i], i, currentXP);
    const newXP = Math.max(floorXP, currentXP - decay);

    sheet.getRange(i + 1, xpIdx + 1).setValue(newXP);
    // ストリークリセット
    if (streakIdx !== -1) sheet.getRange(i + 1, streakIdx + 1).setValue(0);

    Logger.log(studentEmail + ": XP " + currentXP + " → " + newXP + " (decay -" + decay + ")");
    break;
  }
}

// 直近のレポート生成失敗の理由。adminRunNightlyReportが診断結果に含めるための変数
let REPORT_GEN_LAST_ERROR = "";

// 会社員向け「業務報告書」生成。1日の記録（時間帯・タスク・メモ）と
// 今日のフォーカス・タスク（見積もり時間とチェック状態）から、上司に
// そのまま提出できる報告文を作る。就業終わりに「レポートを生成する」ボタンから呼ばれる。
// タスクのチェック状態や見積もり時間は端末（localStorage）にしかないため、
// フロントからPOSTボディで受け取る
function generateWorkReport(studentEmail, body) {
  try {
    return generateWorkReportInner(studentEmail, body);
  } catch (err) {
    Logger.log("generateWorkReport: " + (err && err.stack ? err.stack : err));
    return { ok: false, error: "生成中にエラーが発生しました。時間をおいてもう一度お試しください。" };
  }
}
function generateWorkReportInner(studentEmail, body) {
  const apiKey = PropertiesService.getScriptProperties().getProperty("CLAUDE_API_KEY");
  if (!apiKey) return { ok: false, error: "CLAUDE_API_KEY が未設定" };
  // 高品質モデルを使うため回数制限（6時間で4回。作り直しには十分、連打の暴走だけ防ぐ）
  if (aiCapExceeded("workReport", studentEmail, 4)) {
    return { ok: false, error: "生成回数の上限に達しました。少し時間を置いてからお試しください🙏" };
  }
  const date = String(body.date || formatDate(new Date()));
  const user = sheetToObjects(getSheet("Users")).find(u => u.student_email === studentEmail);
  if (!user) return { ok: false, error: "User not found" };

  const logs = getFilteredRows("DailyLog", "student_email", studentEmail)
    .filter(l => l.date === date)
    .sort((a, b) => a.time_block > b.time_block ? 1 : -1);
  if (logs.length === 0) return { ok: false, error: "この日の記録がまだありません。まず今日やったことを記録してください。" };

  const logLines = logs.map(l =>
    `${l.time_block}: ${l.task}${String(l.memo || "").trim() ? "（メモ: " + String(l.memo).trim() + "）" : ""}`
  ).join("\n");

  // 任意情報：今日のフォーカス（宣言）とタスクリスト（予定時間・完了状態）
  let intentText = "";
  try {
    const it = body.intent ? JSON.parse(body.intent) : null;
    if (it && it.intent) intentText = `【今日一番達成したいと宣言していたこと】${it.intent}（予定 ${it.hours || "?"}時間）` + (it.done ? " → 達成" : " → 未達成");
  } catch (e) {}
  let tasksText = "";
  try {
    const ts = body.tasks ? JSON.parse(body.tasks) : [];
    if (ts.length > 0) {
      tasksText = "【今日のタスクリスト（予定時間・完了状態）】\n" + ts.map(t =>
        `・${t.text}${t.min > 0 ? "（予定" + t.min + "分）" : ""} → ${t.done ? "完了" : "未完了"}`
      ).join("\n");
    }
  } catch (e) {}

  const prompt = `あなたは優秀なビジネスアシスタントです。以下の1日の作業記録から、上司・会社に提出する「業務報告書」を作成してください。

【日付】${date}
【報告者】${user.name}

【時間帯ごとの作業記録】
${logLines}

${intentText}

${tasksText}

【作成ルール】
- 記録された事実だけを書く。記録にない作業を創作・水増ししない
- 構成は次の順で、この見出し記号をそのまま使う:
【業務報告】日付(曜日) 氏名
■ 勤務時間: 最初の記録〜最後の記録の時間帯から書く（例: 9:00〜17:30）
■ 本日の業務: 時間帯順に「・9:00-10:30 やったこと ― 進捗や成果を1文で」。近い時間帯で同じ作業が続く場合はまとめてよい
■ 完了したタスク: タスクリストで完了になっているもの。予定時間があるものは「予定◯分→実績」の形で、予定より早く終わった場合は「前倒しで完了」と明記する
■ 未完了・持ち越し: 未完了タスク。記録から理由が読み取れれば簡潔に添える（読み取れなければ理由は書かない）
■ 特記事項: 予定外の対応・トラブル・共有事項。該当がなければ「特になし」
■ 明日の予定: 未完了タスクや記録の流れから自然に書ける範囲で。無理に埋めない
- 文体は「です・ます」調。簡潔だが情報量を削らない。件数・時間・金額・固有名詞（会社名・人名・日付）など、メモにある具体は必ず報告書に反映する
- 各業務は1行の言い換えで済ませず、メモに書かれた進捗・成果・決定事項が上司に伝わるように書く（メモが詳しい業務ほど報告も具体的に）
- 記録が趣味・私用（例: ゲーム、昼食）と明確に分かるものは業務報告からは省く（勤務時間の計算にも含めない）
- 出力は報告書本文のみ。前置き・解説・コードブロック記号は不要`;

  // モデルを順に試す（1つ目が過負荷・権限・レート制限などで失敗しても、別モデルで
  // 自動フォールバックして必ず生成を試みる）。失敗の実体はログに残し、最終失敗時は
  // 原因の要約もエラー文に含めて、次回すぐ診断できるようにする
  // 上司に出す文書なので品質最優先。フォールバック先も高品質モデルにする
  // （以前Haikuに落ちた際、内容が薄い報告書になったため）
  const MODELS = ["claude-sonnet-5", "claude-opus-4-8"];
  let lastErr = "";
  for (let mi = 0; mi < MODELS.length; mi++) {
    try {
      const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        // 記録が多い日でも途中で切れないよう出力上限を大きく取る（以前2500で切れていた）
        payload: JSON.stringify({ model: MODELS[mi], max_tokens: 8000, messages: [{ role: "user", content: prompt }] }),
        muteHttpExceptions: true
      });
      const code = res.getResponseCode();
      const bodyText = res.getContentText();
      const result = JSON.parse(bodyText); logAiUsage(result, "業務報告書");
      // 出力上限で途切れた場合はログに残す（さらに増やす判断材料に）
      if (result && result.stop_reason === "max_tokens") Logger.log("generateWorkReport: max_tokensで切れた可能性 " + studentEmail);
      // thinkingブロックが先頭に入るモデルもあるため、textブロックを探して取り出す
      const textBlock = (result.content || []).find(c => c && c.type === "text" && typeof c.text === "string");
      if (textBlock) return { ok: true, data: { text: textBlock.text.trim() } };
      lastErr = MODELS[mi] + " HTTP" + code + " " + bodyText.slice(0, 200);
      Logger.log("generateWorkReport: " + lastErr);
    } catch (e) {
      lastErr = MODELS[mi] + " exception: " + e;
      Logger.log("generateWorkReport: " + lastErr);
    }
  }
  // 利用上限到達はコードでは回復できないため、ユーザーに分かる言葉で返す
  if (/usage limits|rate_limit|credit balance/i.test(String(lastErr))) {
    return { ok: false, error: "AIの利用上限に達しているため、いま生成できません。管理者が上限を更新するまでお待ちください（記録自体は保存されています）。" };
  }
  return { ok: false, error: "AI生成に失敗しました。少し待ってからもう一度お試しください。（詳細: " + String(lastErr).slice(0, 160) + "）" };
}

// ══════════════════════════════════════════════════════════════════
// レポートの点数を、記録そのものから決める（2026-08-03 Kaiの指示）
//   これまではAIが5項目に0〜20点を付けていた。AIは14/16/18のような
//   きりのいい数字を選ぶため、別の人が同じ点数になりやすく、
//   ランキングで並んでしまっていた。
//   ここでは実データから連続的に計算し、1点単位で差が出るようにする。
//   AIは文章だけを書く（点数は上書きされる）。
// ══════════════════════════════════════════════════════════════════
// 採点対象の日付。ログの日付を使い、無ければ今日
function targetDateForReport_(logs) {
  const d = (logs && logs.length && logs[0] && logs[0].date) ? String(logs[0].date).slice(0, 10) : "";
  return d || formatDate(new Date());
}

function computeReportBreakdown_(studentEmail, logs, user, dateStr) {
  const date = String(dateStr || formatDate(new Date())).slice(0, 10);
  // 今日のタスクと、今日のフォーカス（アプリの中心にある行動を採点に入れる）
  let tasks = [], journal = {};
  try {
    tasks = p1List("Tasks", studentEmail).filter(function (t) {
      return !String(t.deleted_at || "").trim() && p1DateOut_(t.date) === date; });
  } catch (e) {}
  try {
    journal = sheetToObjects(getJournalSheet()).find(function (r) {
      const rd = r.date instanceof Date ? Utilities.formatDate(r.date, "Asia/Tokyo", "yyyy-MM-dd") : String(r.date).slice(0, 10);
      return String(r.student_email) === studentEmail && rd === date; }) || {};
  } catch (e) {}
  // 週間目標への前進（今週ぶんの達成率。無ければ null）
  let weekProgress = null;
  try {
    const wgs = p1List("WeeklyGoals", studentEmail).filter(function (w) {
      return p1Status_(w.status, "ACTIVE") === "ACTIVE"; });
    const ok = wgs.filter(function (w) {
      const t = Number(w.std_line) > 0 ? Number(w.std_line) : Number(w.target_total);
      return t > 0; });
    if (ok.length) {
      let acc = 0;
      ok.forEach(function (w) {
        const t = Number(w.std_line) > 0 ? Number(w.std_line) : Number(w.target_total);
        acc += Math.min(1, (Number(w.actual_value) || 0) / t);
      });
      weekProgress = acc / ok.length;
    }
  } catch (e) {}
  return computeReportBreakdownCore_(studentEmail, logs, user, tasks, journal, weekProgress, date);
}

function computeReportBreakdownCore_(studentEmail, logs, user, tasks, journal, weekProgress, date) {
  const n = logs.length;
  const clamp = function (v) { return Math.max(0, Math.min(20, v)); };
  // 記録した時間帯の数。10コマで満点、それ以上は少しずつ伸びる
  const records = clamp(n === 0 ? 0 : 20 * Math.min(1, Math.pow(n / 10, 0.85)));
  // メモ。書いた割合(4割)と、書いた量(6割)の両方を見る
  const memoLogs = logs.filter(function (l) { return String(l.memo || "").trim(); });
  const memoChars = memoLogs.reduce(function (a, l) { return a + String(l.memo).trim().length; }, 0);
  const memoRate = n ? memoLogs.length / n : 0;
  const memoVol = Math.min(1, memoChars / 600);
  const memo = clamp(20 * (memoRate * 0.4 + memoVol * 0.6));
  // 集中度の平均（1〜5 → 0〜20）。未入力は数えない
  const fv = logs.map(function (l) { return parseInt(l.focus_level, 10) || 0; }).filter(function (x) { return x > 0; });
  const focusAvg = fv.length ? fv.reduce(function (a, b) { return a + b; }, 0) / fv.length : 0;
  // 集中：自己評価の平均7割 ＋ 今日のフォーカスを達成できたか3割
  //   （宣言していない日は自己評価だけで見る）
  const focusBase = fv.length ? (focusAvg - 1) / 4 : 0;
  const declared = String((journal && journal.intent) || "").trim();
  const focusDone = String((journal && journal.intent_done) || "") === "true";
  const focus = clamp(declared ? 20 * (focusBase * 0.7 + (focusDone ? 1 : 0) * 0.3)
                               : 20 * focusBase);
  // 目標に関連した記録の割合。件数が少ない日は割合が跳ねるので件数でも補正
  const goalCount = logs.filter(function (l) { return String(l.goal_related) === "true" || l.goal_related === true; }).length;
  const goalRate = n ? goalCount / n : 0;
  // 目標：関連した記録の割合5割 ＋ 今日のタスクの実行3割 ＋ 週間目標への前進2割
  //   記録の割合だけだと「タスクを終わらせたこと」がまったく点数に入らなかった
  const doneT = tasks.filter(function (t) { return normalizeTaskStatus(t.status) === "DONE"; }).length;
  const startedT = tasks.filter(function (t) { return String(t.first_started_at || "").trim() &&
                                                      normalizeTaskStatus(t.status) !== "DONE"; }).length;
  const taskRate = tasks.length ? Math.min(1, (doneT + startedT * 0.5) / tasks.length) : null;
  const wp = (weekProgress === null || weekProgress === undefined) ? null : Math.min(1, weekProgress);
  // 測れない要素は「0点」にせず、測れた要素だけで割り直す
  const gParts = [[goalRate, 0.5]];
  if (taskRate !== null) gParts.push([taskRate, 0.3]);
  if (wp !== null) gParts.push([wp, 0.2]);
  const gW = gParts.reduce(function (a2, x) { return a2 + x[1]; }, 0);
  const goal = clamp(20 * (gParts.reduce(function (a2, x) { return a2 + x[0] * x[1]; }, 0) / gW));
  // 継続。連続記録日数（14日で満点）
  const streak = Number((user && user.streak) || 0);
  const consistency = clamp(20 * Math.min(1, Math.pow(streak / 14, 0.8)));

  // ★休みの日は、記録の量で責めない★
  //   休みと決めた曜日は「たくさん記録したか」を求めない。
  //   記録量に関する2項目だけ、達成の基準をゆるめる（休んだ日が0点にならないように）
  let records2 = records, memo2 = memo;
  try {
    if (isRestDay(user || {}, date)) {
      records2 = clamp(Math.max(records, 20 * Math.min(1, n / 3)));   // 3コマで満点扱い
      memo2 = clamp(Math.max(memo, memoLogs.length ? 14 : 0));        // 1件でも書けていれば及第
    }
  } catch (e) {}
  // ★測れないものを0点にしない★（2026-08-03 dry-runで発覚）
  //   集中度を1件も入れていない日は「集中0点」、目標に関連づける習慣がまだ無い人は
  //   「目標0点」となり、20点まるごと失っていた。それは「できていない」ではなく
  //   「測っていない」。測れない軸は、測れた軸の平均で埋めて、有利にも不利にもしない。
  const measurable = { records: true, memo: true, consistency: true,
                       focus: fv.length > 0,
                       goal: (goalCount > 0 || tasks.length > 0 || wp !== null) };
  const rawParts = { records: records2, memo: memo2, focus: focus, goal: goal, consistency: consistency };
  const okKeys = Object.keys(rawParts).filter(function (k) { return measurable[k]; });
  const avgOk = okKeys.length ? okKeys.reduce(function (a2, k) { return a2 + rawParts[k]; }, 0) / okKeys.length : 0;
  Object.keys(rawParts).forEach(function (k) { if (!measurable[k]) rawParts[k] = avgOk; });
  records2 = rawParts.records; memo2 = rawParts.memo;
  const focusF = rawParts.focus, goalF = rawParts.goal, consistencyF = rawParts.consistency;

  const r1 = function (v) { return Math.round(v * 10) / 10; };
  const parts = { records: r1(records2), memo: r1(memo2), focus: r1(focusF), goal: r1(goalF), consistency: r1(consistencyF) };
  const precise = parts.records + parts.memo + parts.focus + parts.goal + parts.consistency;
  // 表示は整数。合計を先に丸めてから、5項目の整数の合計が必ず一致するように配分する
  const score = Math.round(precise);
  const ints = {}; let acc = 0;
  const keys = ["records", "memo", "focus", "goal", "consistency"];
  keys.forEach(function (k, i) {
    if (i === keys.length - 1) { ints[k] = Math.max(0, Math.min(20, score - acc)); return; }
    ints[k] = Math.round(parts[k]); acc += ints[k];
  });
  return { score: score, score_precise: Math.round(precise * 10) / 10, breakdown: ints, raw: parts,
           facts: { blocks: n, memo_logs: memoLogs.length, memo_chars: memoChars,
                    focus_avg: Math.round(focusAvg * 100) / 100, goal_count: goalCount,
                    goal_rate: Math.round(goalRate * 100), streak: streak,
                    tasks_total: tasks.length, tasks_done: doneT, tasks_started: startedT,
                    daily_focus: declared ? (focusDone ? "達成" : "未達") : "未設定",
                    week_progress: wp === null ? null : Math.round(wp * 100),
                    rest_day: (function(){ try { return isRestDay(user || {}, date); } catch(e){ return false; } })(),
                    // 測れなかった軸（平均で埋めたもの）。理由の説明に使う
                    estimated_axes: Object.keys(measurable).filter(function (k) { return !measurable[k]; }) } };
}

function generateReportWithClaude(studentEmail, studentName, logs) {
  REPORT_GEN_LAST_ERROR = "";
  const apiKey = PropertiesService.getScriptProperties().getProperty("CLAUDE_API_KEY");
  if (!apiKey) { Logger.log("CLAUDE_API_KEY が未設定"); REPORT_GEN_LAST_ERROR = "CLAUDE_API_KEY が未設定"; return null; }

  const user = sheetToObjects(getSheet("Users")).find(u => u.student_email === studentEmail);
  const ctx = buildStudentContext(studentEmail, user);

  const totalBlocks = logs.length;
  const withMemo = logs.filter(l => l.memo && l.memo.trim()).length;
  const goalRelatedCount = logs.filter(l => l.goal_related === "true" || l.goal_related === true).length;
  const goalRelatedPct = totalBlocks > 0 ? Math.round(goalRelatedCount / totalBlocks * 100) : 0;
  const logsText = logs.map(l => l.time_block + " - " + l.task + "（集中度：" + l.focus_level + (l.goal_related === "true" ? "、目標関連" : "") + (l.memo ? "、メモ：" + l.memo : "") + "）").join("\n");

  const prompt = `あなたは生徒一人ひとりに寄り添う教育コーチです。以下の情報をすべて把握した上で、今日の振り返りレポートを生成してください。

【コーチの方針】
- 生徒を信じて応援するスタンスは崩さないが、アメとムチを使い分ける。よく頑張れた日は惜しみなく祝い、記録が薄い日・予定を実行できていない日はごまかして褒めず、はっきり指摘して発奮を促す（人格ではなく行動を叱る。見捨てない愛情が伝わる言い方で）
- 心理学的アプローチ（承認→気づき→行動）を意識する
- 目標の期限に対する「現在地」を具体的に言語化して伝える
- 今の取り組みが目標達成にどうつながるかを示す
- 継続できていることは積極的に称える
- 全レポート履歴を踏まえてスコアのトレンドや変化を具体的に読み取ること
- カレンダーの予定と実際の記録を照らし合わせ、予定を実行できたか（計画実行力）の視点も入れる
- 「今日いちばんやりたいこと」が設定されている日は、それを達成できたかに必ず触れる（達成なら盛大に祝い、未達成なら責めずに何が妨げたかへの気づきを促す）
- 今日が本人の【休みの日】の場合は採点・言葉選びを休息モードにする。記録が少なくても責めず、休めたこと自体を肯定する

${ctx}

【今日のログ（${totalBlocks}時間帯、メモ${withMemo}個、目標関連${goalRelatedCount}時間帯(${goalRelatedPct}%)）】
${logsText}

【点数について】
- 点数はアプリ側が記録から計算して確定させる。あなたが決めた数字は使われない
- 文章の中で「◯点」と具体的な点数を断定しない（下の観点は、何を見ているかの参考）
- 記録していない項目（例: 集中度を入れていない、目標に関連づけていない）は
  「できていない」ではなく「まだ測れていない」として書く。責めない
【採点の観点（各0〜20点・合計100点）】
- records（20点）: 記録した時間帯の数の多さ
- memo（20点）: 振り返りメモの深さと量
- focus（20点）: 自己評価（集中度）の平均の高さ
- goal（20点）: 目標関連の記録の割合の高さ
- consistency（20点）: 連続記録日数・継続状況の良さ

【文体ルール（全フィールド共通）】
- 「〇〇さん」「お疲れ様です」などの宛名・挨拶は絶対に書かない。本文から始める
- 毎日同じ書き出しにならないよう、直近レポートと違う切り口で書く
- 抽象的な褒め言葉より、今日のログの具体的な内容・数字に触れる
- 励ましの文末は「。」より「！」の方が自然。highlightsとactionには 👍 🔥 👏 🙌 👊 💪 🫵 やポジティブな表情の絵文字を文末に1個添えてよい（全フィールド合計2個まで）
- 「Chatworkで」「Chatworkのやり取りから」のように情報の出どころを名指ししない。本人の状況として自然に触れる
- 記録の時間の単位は「ブロック」ではなく「時間帯」と表現する
- 「お前」「てめぇ」などの荒い二人称・乱暴な言葉は、親しみを込めたつもりでも威圧的に感じられるため絶対に使わない。親しい間柄でも「〇〇さん」または名前を呼ぶか、二人称を省略する
- ログのメモ等が音声入力由来で「磁力」「地録」「字録」など、このアプリ名「JIROKU」の誤変換・空耳と思われる表記になっている場合は、そのまま引用せず「JIROKU」に読み替えて書く

以下のJSON形式のみで返してください（説明文不要）。breakdownの5項目の合計は必ずscoreと一致させること。
breakdown_reasonsは各項目の点数についてのひとことコメントで、必ず全項目分書くこと（品質・量の両面で何を評価/改善点としたか具体的に触れる）：
{
  "score": <0-100の整数>,
  "breakdown": { "records": <0-20>, "memo": <0-20>, "focus": <0-20>, "goal": <0-20>, "consistency": <0-20> },
  "breakdown_reasons": { "records": "<この点数についてのひとことコメント>", "memo": "<同上>", "focus": "<同上>", "goal": "<同上>", "consistency": "<同上>" },
  "feedback": "<目標の現在地と今日の取り組みへの共感・承認を含む2-3文>",
  "highlights": "<今日の具体的な良かった点を1文で称える>",
  "improvement": "<責めずに前向きな改善提案または継続すべき点を1文で>",
  "actions": ["<明日いちばん大事な具体的アクションを、それ単体で意味が通る完結した1文で。ちょうど1つだけ>"],
  "trend": "<全レポート履歴から見える成長・変化のトレンドを1文で>"
}
【actionsのルール（重要）】
- actionsは必ず「1個だけ」の配列にする（2個以上は入れない）。チェックリストの1項目としてそのまま表示される。
- 本人が自分の目標のために“自分ひとりで実行できる具体的な行動”にする（今日のログや目標から自然に導く）。
- 実在が確認できない前提を作らない。特に「チャットワークで報告する」「◯◯さんに連絡・報告する」「上司/コーチに共有する」など“第三者への報告・連絡”は、本人のログや目標に明確にそうした相手が出てこない限り絶対に書かない（報告相手を勝手に想定しない）。
- 「上で決めたアクション」のように他の項目を指す書き方はしない（1個なので不要）。`;

  const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    // breakdown_reasons追加でレポートJSONが長くなり、記録が多い日は1024トークンでは
    // 出力が途中で切れてJSONパースに失敗していた（ai-failedの原因）ため、余裕を持たせる
    payload: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 4000, messages: [{ role: "user", content: prompt }] }),
    muteHttpExceptions: true
  });

  const rawText = res.getContentText();
  Logger.log("Claude生レスポンス: " + rawText.substring(0, 800));
  const result = JSON.parse(rawText); logAiUsage(result, "夜のレポート");
  if (!result.content || !result.content[0]) {
    Logger.log("Claude エラー: " + rawText);
    REPORT_GEN_LAST_ERROR = "APIエラー: " + rawText.substring(0, 300);
    return null;
  }
  try {
    const text = result.content[0].text.trim();
    Logger.log("Claudeテキスト: " + text.substring(0, 500));
    const parsed = parseAiJson(text);
    if (!parsed) { Logger.log("JSONパース失敗"); REPORT_GEN_LAST_ERROR = "JSONパース失敗: " + text.substring(0, 200); return null; }
    // ★文章の中の「◯◯点」を消す★
    //   点数はこちらで計算するので、AIが書いた数字は必ず食い違う。
    //   実際にLINEへ「今日58点」と出て、画面の71点と矛盾していた（2026-08-03）。
    try {
      const dropScore = function (v) {
        return String(v || "")
          .replace(/(?:今日|本日|昨日|前日)?\s*\d{1,3}\s*点(?:へ|に|から|まで|台)?/g, "")
          .replace(/\s{2,}/g, " ").trim();
      };
      ["feedback", "highlights", "improvement", "action", "trend"].forEach(function (k) {
        if (parsed[k]) parsed[k] = dropScore(parsed[k]);
      });
      if (parsed.breakdown_reasons) {
        Object.keys(parsed.breakdown_reasons).forEach(function (k) {
          parsed.breakdown_reasons[k] = dropScore(parsed.breakdown_reasons[k]); });
      }
    } catch (e) {}
    // ★点数はAIに決めさせない★ 記録から計算した値で必ず上書きする
    try {
      const calc = computeReportBreakdown_(studentEmail, logs, user, targetDateForReport_(logs));
      parsed.score = calc.score;
      parsed.score_precise = calc.score_precise;
      parsed.breakdown = calc.breakdown;
      parsed.score_facts = calc.facts;
    } catch (e) { Logger.log("点数計算に失敗（AIの値を使う）: " + e); }
    // 「明日のアクション」は1つだけにする。AIが万一2つ以上返しても、先頭の1件だけ採用する。
    // （アプリ側は改行で分割してチェックリスト化するため、複数行にせず1行にする）
    if (Array.isArray(parsed.actions)) {
      const first = parsed.actions.map(a => String(a).trim()).filter(Boolean)[0] || "";
      parsed.action = first;
    } else if (parsed.action) {
      // 旧形式で複数行(action)が来た場合も先頭行だけにする
      parsed.action = String(parsed.action).split("\n").map(s => s.trim()).filter(Boolean)[0] || "";
    }
    return parsed;
  } catch (e) { Logger.log("JSONパースエラー: " + e.toString()); REPORT_GEN_LAST_ERROR = "JSONパースエラー: " + e.toString(); return null; }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// カレンダー同期（アプリがユーザー本人の権限で取得した予定を保存）
// GASからは他ユーザーのカレンダーを読めないため、アプリ経由でキャッシュする
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function syncCalendar(studentEmail, body) {
  if (!body.date || body.events === undefined) return { ok: false, error: "missing params" };
  let sheet = getSheet("CalendarCache");
  if (!sheet) {
    sheet = SpreadsheetApp.openById(SPREADSHEET_ID).insertSheet("CalendarCache");
    sheet.appendRow(["student_email", "date", "events", "updated_at"]);
  }
  const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const rowDate = data[i][1] instanceof Date
      ? Utilities.formatDate(data[i][1], "Asia/Tokyo", "yyyy-MM-dd")
      : String(data[i][1]);
    if (String(data[i][0]) === studentEmail && rowDate === String(body.date)) {
      sheet.getRange(i + 1, 3).setValue(String(body.events).slice(0, 8000));
      sheet.getRange(i + 1, 4).setValue(now);
      return { ok: true, updated: true };
    }
  }
  const newRow = sheet.getLastRow() + 1;
  sheet.appendRow([studentEmail, "", String(body.events).slice(0, 8000), now]);
  sheet.getRange(newRow, 2).setNumberFormat("@").setValue(String(body.date));
  return { ok: true };
}

// アプリ向け: 共有キャッシュから予定を返す（本人認証が使えない端末のフォールバック）
function getCalendar(studentEmail, body) {
  const targetDate = (body && body.date) ? String(body.date) : formatDate(new Date());
  const raw = getCachedCalendar(studentEmail, targetDate);
  if (!raw) return { ok: true, data: null };
  try { return { ok: true, data: JSON.parse(raw) }; }
  catch (e) { return { ok: true, data: null }; } // 旧形式（テキスト）は返さない
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 日記（ユーザーが自分で書く振り返り）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function getJournalSheet() {
  let sheet = getSheet("Journal");
  if (!sheet) {
    sheet = SpreadsheetApp.openById(SPREADSHEET_ID).insertSheet("Journal");
    sheet.appendRow(["date", "student_email", "diary", "updated_at"]);
  }
  return sheet;
}

function getDiary(studentEmail, body) {
  const targetDate = (body && body.date) ? String(body.date) : formatDate(new Date());
  const row = sheetToObjects(getJournalSheet()).find(r => r.student_email === studentEmail && r.date === targetDate);
  let autoSummary = row ? row.auto_summary : "";
  if (!autoSummary) {
    const logs = getLogs(studentEmail, { date: targetDate }).data;
    if (logs.length > 0) {
      const generated = generateDaySummary(studentEmail, targetDate, logs);
      if (generated) { autoSummary = generated; saveAutoSummary(studentEmail, targetDate, generated); }
    }
  }
  return { ok: true, data: { diary: row ? row.diary : "", autoSummary: autoSummary || "" } };
}

// 事実のみを整理する日次サマリー（時間ログ＋カレンダー予定を素材に、感想や推測を加えず時系列でまとめる）
function generateDaySummary(studentEmail, targetDate, logs) {
  const apiKey = PropertiesService.getScriptProperties().getProperty("CLAUDE_API_KEY");
  if (!apiKey) return null;

  let planText = "予定情報なし（カレンダー未連携）";
  const rawCal = getCachedCalendar(studentEmail, targetDate);
  if (rawCal) {
    try {
      const evs = JSON.parse(rawCal);
      planText = evs.length > 0
        ? evs.map(function(e){ return e.allDay ? ("終日 " + e.title) : (e.time + "〜 " + e.title); }).join("\n")
        : "予定なし";
    } catch (e) { planText = rawCal; }
  }

  const logsText = logs.map(l => l.time_block + " " + l.task + "（" + l.focus_level + (l.goal_related === "true" ? "・目標関連" : "") + (l.memo ? "・メモ：" + l.memo : "") + "）").join("\n");

  const prompt = `以下は${targetDate}のカレンダー予定と実際の記録です。これらの事実だけをもとに、その日1日に何をしたかを時系列でまとめた文章を作成してください。

【この日の予定（カレンダー）】
${planText}

【この日の記録（実際に行ったこと）】
${logsText}

【要件】
- 主観的な感想・評価・推測・アドバイス・励ましは一切加えない。記録に書かれていることだけを事実として並べる
- 「〜した」「〜を行った」のように淡々とした事実の記述にする
- 箇条書きにせず、3〜5文の自然な文章にする
- 宛名・見出し・前置きは不要。本文だけを出力する`;

  try {
    const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      payload: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 400, messages: [{ role: "user", content: prompt }] }),
      muteHttpExceptions: true
    });
    const rawText = res.getContentText();
    const result = JSON.parse(rawText);
    if (!result.content || !result.content[0]) {
      Logger.log("generateDaySummary: Claude応答にcontentなし: " + rawText.substring(0, 500));
      return null;
    }
    return stripSalutation(result.content[0].text).trim();
  } catch (e) {
    Logger.log("generateDaySummary error: " + e);
    return null;
  }
}

function saveAutoSummary(studentEmail, targetDate, summary) {
  upsertJournalRow(studentEmail, targetDate, { auto_summary: summary });
}

// Journalシートへの書き込みを一本化したupsert（diary/auto_summaryのどちらか、または両方を更新）。
// saveDiaryとsaveAutoSummaryが別々に「検索→なければ追加」をしていると、
// ほぼ同時にリクエストが来た場合に同じ日付の行が重複作成され、
// 以後の検索が常に空欄側の行にヒットして「生成されない」ように見える不具合があったため、
// スクリプトロックで排他制御しつつ1つの関数に統合する。
function upsertJournalRow(studentEmail, targetDate, fields) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getJournalSheet();
    let headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    ["auto_summary", "intent", "intent_done", "actions", "actions_checked", "intent_hours"].forEach(col => {
      if (headers.indexOf(col) === -1) {
        sheet.getRange(1, headers.length + 1).setValue(col);
        headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      }
    });
    const diaryIdx = headers.indexOf("diary");
    const updatedIdx = headers.indexOf("updated_at");
    const summaryIdx = headers.indexOf("auto_summary");
    const intentIdx = headers.indexOf("intent");
    const intentDoneIdx = headers.indexOf("intent_done");
    const actionsIdx = headers.indexOf("actions");
    const checkedIdx = headers.indexOf("actions_checked");
    const intentHoursIdx = headers.indexOf("intent_hours");
    const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const rowDate = data[i][0] instanceof Date
        ? Utilities.formatDate(data[i][0], "Asia/Tokyo", "yyyy-MM-dd")
        : String(data[i][0]);
      if (String(data[i][1]) === studentEmail && rowDate === targetDate) {
        if (fields.diary !== undefined) sheet.getRange(i + 1, diaryIdx + 1).setValue(fields.diary);
        if (fields.auto_summary !== undefined) sheet.getRange(i + 1, summaryIdx + 1).setValue(fields.auto_summary);
        if (fields.intent !== undefined) sheet.getRange(i + 1, intentIdx + 1).setValue(fields.intent);
        if (fields.intent_done !== undefined) sheet.getRange(i + 1, intentDoneIdx + 1).setValue(fields.intent_done);
        if (fields.actions !== undefined) sheet.getRange(i + 1, actionsIdx + 1).setValue(fields.actions);
        if (fields.actions_checked !== undefined) sheet.getRange(i + 1, checkedIdx + 1).setValue(fields.actions_checked);
        if (fields.intent_hours !== undefined) sheet.getRange(i + 1, intentHoursIdx + 1).setValue(fields.intent_hours);
        sheet.getRange(i + 1, updatedIdx + 1).setValue(now);
        return;
      }
    }
    const rowArr = new Array(headers.length).fill("");
    rowArr[1] = studentEmail;
    if (fields.diary !== undefined) rowArr[diaryIdx] = fields.diary;
    if (fields.auto_summary !== undefined) rowArr[summaryIdx] = fields.auto_summary;
    if (fields.intent !== undefined) rowArr[intentIdx] = fields.intent;
    if (fields.intent_done !== undefined) rowArr[intentDoneIdx] = fields.intent_done;
    if (fields.actions !== undefined) rowArr[actionsIdx] = fields.actions;
    if (fields.actions_checked !== undefined) rowArr[checkedIdx] = fields.actions_checked;
    if (fields.intent_hours !== undefined) rowArr[intentHoursIdx] = fields.intent_hours;
    rowArr[updatedIdx] = now;
    const newRow = sheet.getLastRow() + 1;
    sheet.appendRow(rowArr);
    sheet.getRange(newRow, 1).setNumberFormat("@").setValue(targetDate);
  } finally {
    lock.releaseLock();
  }
}

function saveDiary(studentEmail, body) {
  if (!body.date) return { ok: false, error: "missing date" };
  upsertJournalRow(studentEmail, String(body.date), { diary: body.diary || "" });
  return { ok: true };
}

// 朝アプリを開いた時に宣言する「今日いちばんやりたいこと」。Journalシートに保存し、
// AIコーチの全メッセージ・夜のレポートが達成状況をフォローする
function saveIntent(studentEmail, body) {
  if (body.intent === undefined && body.intent_done === undefined && body.hours === undefined) return { ok: false, error: "missing intent" };
  const fields = {};
  if (body.intent !== undefined) fields.intent = String(body.intent).trim();
  if (body.intent_done !== undefined) fields.intent_done = String(body.intent_done);
  if (body.hours !== undefined) fields.intent_hours = String(body.hours);
  upsertJournalRow(studentEmail, formatDate(new Date()), fields);
  return { ok: true };
}

// 今日のアクション（編集したチェックリストとチェック状態）の端末間同期。
// 以前はlocalStorageのみで、PCで編集した内容が携帯に反映されなかった
function saveTodayActions(studentEmail, body) {
  const fields = {};
  if (body.actions !== undefined) fields.actions = String(body.actions);          // JSON配列文字列 or ""（AIアクションに戻す）
  if (body.checked !== undefined) fields.actions_checked = String(body.checked);  // JSONオブジェクト文字列
  if (Object.keys(fields).length === 0) return { ok: false, error: "missing params" };
  const today = formatDate(new Date());
  upsertJournalRow(studentEmail, today, fields);

  // ★Tasksシートへの橋渡し★
  //   画面はまだ Journal.actions で動いている。ここで Tasks シートにも
  //   写しておかないと、移行済みの4件だけが古いまま取り残される。
  //   画面を Tasks に繋ぎ替えるまでの間だけの処理で、Phase 4 で外す。
  //   失敗しても本体の保存は成功させる（記録が消える方がずっと困る）。
  //   新方式（saveTaskMutations直接書き込み）の端末は noBridge="1" を送ってくる。
  //   その場合はTasksへ二重に書かない（直接書き込みとの競走でversionが乱れるため）。
  //   Journal.actionsへの保存は続ける（業務レポート等がまだそこを読むため）。
  if (body.actions !== undefined && String(body.noBridge || "") !== "1") {
    try { bridgeActionsToTasks(studentEmail, today, String(body.actions), body.checked); }
    catch (err) { console.error("bridgeActionsToTasks", err); }
  }
  return { ok: true };
}

// Journal.actions の内容を Tasks シートへ写す。
//   ・すでに同じ内容なら何も書かない（毎回全行を書き換えない）
//   ・削除済み（deleted_at あり）は復活させない
//   ・Tasks 側にしか無いタスクは消さない。まだ画面が Tasks を見ていないため、
//     ここで消すと Tasks 側の編集が一方的に失われる
// 書き込み経路の日次カウント。橋渡し撤去の終了条件（直近7日で bridge 0件）の判定に使う
function countWritePath_(path) {
  try {
    const key = "wp_" + path + "_" + Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyyMMdd");
    const p = PropertiesService.getScriptProperties();
    p.setProperty(key, String(Number(p.getProperty(key) || 0) + 1));
  } catch (e) {}
}

function bridgeActionsToTasks(studentEmail, dateStr, actionsJson, checkedJson) {
  countWritePath_("JOURNAL_BRIDGE");
  let items = [];
  try { items = JSON.parse(actionsJson || "[]"); } catch (e) { return; }
  if (!Array.isArray(items)) return;

  let checked = {};
  try { checked = JSON.parse(checkedJson || "{}") || {}; } catch (e) {}

  const sheet = getP1Sheet("Tasks");
  const nowIso = new Date().toISOString();

  items.forEach(function (it) {
    if (!it || typeof it !== "object") return;   // 旧形式（ただの文字列）は id が無いので写せない
    const id = String(it.id || "").trim();
    const title = String(it.title || "").trim();
    if (!id || !title) return;

    const existing = p1OwnedRow("Tasks", "task_id", id, studentEmail);
    if (existing && String(existing.deleted_at || "").trim()) return;   // 消したものは戻さない

    const done = !!(checked[id] !== undefined ? checked[id] : checked[title]);
    const rec = {
      task_id: id, student_email: studentEmail, date: dateStr, title: title,
      status: done ? "DONE" : normalizeTaskStatus(it.stt || (existing && existing.status) || "TODO")
    };
    if (it.imp) rec.importance_level = String(it.imp).toUpperCase();
    if (it.due) rec.due_at = String(it.due);
    if (it.est > 0) rec.estimated_minutes = Number(it.est);
    if (it.memo) rec.memo = String(it.memo);
    if (done && !(existing && String(existing.completed_at || "").trim())) rec.completed_at = nowIso;
    if (!done) rec.completed_at = "";

    // 中身が変わっていなければ書かない
    //   ★日付は型をそろえてから比べる★ シートは "2026-08-02" を日付型に変換して
    //   保存するため、文字列のまま比べると毎回「違う」と判定され、
    //   保存のたびに version が際限なく増える。
    const norm = function (k, v) {
      if (v === undefined || v === null) return "";
      if (k === "date") return v instanceof Date ? formatDate(v) : String(v).slice(0, 10);
      return String(v);
    };
    if (existing) {
      let same = true;
      Object.keys(rec).forEach(function (k) {
        if (norm(k, existing[k]) !== norm(k, rec[k])) same = false;
      });
      if (same) return;
      rec.version = Number(existing.version || 0) + 1;
    } else {
      rec.created_at = nowIso;
      rec.version = 1;
      rec.source_type = "SELF";
      rec.context = "UNSET";
    }
    rec.updated_at = nowIso;
    p1Upsert("Tasks", "task_id", rec);
  });
}

function getTodayActions(studentEmail) {
  const today = formatDate(new Date());
  if (!getSheet("Journal")) return { ok: true, data: null };
  const row = sheetToObjects(getJournalSheet()).find(r => {
    const rd = r.date instanceof Date ? Utilities.formatDate(r.date, "Asia/Tokyo", "yyyy-MM-dd") : String(r.date);
    return r.student_email === studentEmail && rd === today;
  });
  if (!row) return { ok: true, data: null };
  let actions = null, checked = null;
  try { if (row.actions) actions = JSON.parse(row.actions); } catch (e) {}
  try { if (row.actions_checked) checked = JSON.parse(row.actions_checked); } catch (e) {}
  return { ok: true, data: { actions, checked } };
}

function getIntent(studentEmail) {
  const today = formatDate(new Date());
  if (!getSheet("Journal")) return { ok: true, data: null };
  const row = sheetToObjects(getJournalSheet()).find(r => {
    const rd = r.date instanceof Date ? Utilities.formatDate(r.date, "Asia/Tokyo", "yyyy-MM-dd") : String(r.date);
    return r.student_email === studentEmail && rd === today;
  });
  return { ok: true, data: row && row.intent ? { intent: row.intent, done: String(row.intent_done) === "true", hours: row.intent_hours ? Number(row.intent_hours) : null } : null };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// タイマー終了通知（アプリが閉じられていてもLINEで気づけるように）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Firebase Cloud Messaging（バックグラウンドでもタイマー終了を通知するため）
// スクリプトプロパティに FCM_PROJECT_ID / FCM_CLIENT_EMAIL / FCM_PRIVATE_KEY
// （Firebaseのサービスアカウントキー）を設定して使う
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function registerPushToken(studentEmail, body) {
  const token = String(body.token || "").trim();
  if (!token) return { ok: false, error: "missing token" };
  const sheet = getSheet("Users");
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  let colIdx = headers.indexOf("fcm_token");
  if (colIdx === -1) { colIdx = headers.length; sheet.getRange(1, colIdx + 1).setValue("fcm_token"); }
  const emailIdx = headers.indexOf("student_email");
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][emailIdx]) === studentEmail) {
      sheet.getRange(i + 1, colIdx + 1).setValue(token);
      return { ok: true };
    }
  }
  return { ok: false, error: "student not found" };
}

// サービスアカウントのJWTを署名してOAuth2アクセストークンと交換する。
// トークンは55分だけキャッシュする（実際の有効期限は60分のため少し短めに）
function getFcmAccessToken() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get("fcm_access_token");
  if (cached) return cached;

  const clientEmail = PropertiesService.getScriptProperties().getProperty("FCM_CLIENT_EMAIL");
  const privateKey = PropertiesService.getScriptProperties().getProperty("FCM_PRIVATE_KEY");
  if (!clientEmail || !privateKey) return null;

  const now = Math.floor(Date.now() / 1000);
  const base64url = obj => Utilities.base64EncodeWebSafe(JSON.stringify(obj)).replace(/=+$/, "");
  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now
  };
  const toSign = base64url(header) + "." + base64url(claimSet);
  const signatureBytes = Utilities.computeRsaSha256Signature(toSign, privateKey.replace(/\\n/g, "\n"));
  const signature = Utilities.base64EncodeWebSafe(signatureBytes).replace(/=+$/, "");
  const jwt = toSign + "." + signature;

  const res = UrlFetchApp.fetch("https://oauth2.googleapis.com/token", {
    method: "post",
    payload: { grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt },
    muteHttpExceptions: true
  });
  const result = JSON.parse(res.getContentText());
  if (!result.access_token) return null;
  cache.put("fcm_access_token", result.access_token, 3300);
  return result.access_token;
}

// FCM経由でWebプッシュ通知を1件送信する。失敗しても呼び出し元は無視してよい
// （通知はあくまで補助であり、LINE通知が主）
// FCM送信の結果を詳細に返す（診断で失敗理由を見られるようにするため）。
// { ok, code, error } を返す。呼び出し元がbooleanだけ欲しい場合は .ok を見る
function sendFcmPushDetailed(token, title, body) {
  try {
    const projectId = PropertiesService.getScriptProperties().getProperty("FCM_PROJECT_ID");
    if (!projectId) return { ok: false, error: "FCM_PROJECT_ID未設定" };
    if (!token) return { ok: false, error: "トークンなし" };

    // 同じ端末に同じ内容のプッシュを5分以内に2回送らない送信側ガード。
    // トリガーの二重発火・シートの重複行など、原因がどこにあっても重複配信を止める
    try {
      const dedupKey = "push_" + Utilities.base64EncodeWebSafe(
        Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, token + "|" + title + "|" + body)
      );
      const cache = CacheService.getScriptCache();
      if (cache.get(dedupKey)) return { ok: true, deduped: true };
      cache.put(dedupKey, "1", 300);
    } catch (e) { /* キャッシュ不調時は通常送信にフォールバック */ }
    const accessToken = getFcmAccessToken();
    if (!accessToken) return { ok: false, error: "アクセストークン取得失敗（FCM_CLIENT_EMAIL/PRIVATE_KEY未設定か不正）" };
    // data-onlyメッセージで送る（notificationフィールドは付けない）。
    // notification付きだとバックグラウンド時に、FCM SDKによる自動表示と
    // sw.jsのonBackgroundMessageによる自前表示の2経路が両方動いてしまい、
    // 同じ内容の通知が毎回2連続で届く原因になっていた。data-onlyなら自前表示だけが動く
    const payload = {
      message: {
        token: token,
        data: { title: String(title), body: String(body), link: APP_URL },
        webpush: { headers: { Urgency: "high" } }
      }
    };
    const res = UrlFetchApp.fetch("https://fcm.googleapis.com/v1/projects/" + projectId + "/messages:send", {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + accessToken },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    if (code === 200) return { ok: true, code: code };
    return { ok: false, code: code, error: res.getContentText().substring(0, 300) };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

function sendFcmPush(token, title, body) {
  return sendFcmPushDetailed(token, title, body).ok;
}

// プッシュ通知の設定状況を診断する（トークン登録の有無・FCM鍵の有無を確認）
function adminDiagnosePush(coachEmail, targetEmail) {
  if (!verifyCoach(coachEmail)) return { ok: false, error: "not a coach" };
  const email = targetEmail || coachEmail;
  const user = sheetToObjects(getSheet("Users")).find(u => u.student_email === email);
  if (!user) return { ok: false, error: "user not found" };
  const props = PropertiesService.getScriptProperties();
  let accessTokenOk = false;
  let accessTokenError = null;
  try {
    accessTokenOk = !!getFcmAccessToken();
  } catch (e) {
    accessTokenError = String(e);
  }
  return {
    ok: true,
    email: email,
    hasFcmToken: !!user.fcm_token,
    fcmTokenPreview: user.fcm_token ? String(user.fcm_token).substring(0, 12) + "…" : null,
    server: {
      FCM_PROJECT_ID: !!props.getProperty("FCM_PROJECT_ID"),
      FCM_CLIENT_EMAIL: !!props.getProperty("FCM_CLIENT_EMAIL"),
      FCM_PRIVATE_KEY: !!props.getProperty("FCM_PRIVATE_KEY"),
      accessTokenOk: accessTokenOk,
      accessTokenError: accessTokenError
    }
  };
}

// 実際にテスト通知を1件送って、成否と失敗理由を返す
function adminTestPush(coachEmail, targetEmail, title, body) {
  if (!verifyCoach(coachEmail)) return { ok: false, error: "not a coach" };
  const email = targetEmail || coachEmail;
  const user = sheetToObjects(getSheet("Users")).find(u => u.student_email === email);
  if (!user) return { ok: false, error: "user not found" };
  if (!user.fcm_token) return { ok: false, error: "この生徒はまだプッシュ通知を有効にしていません（fcm_tokenなし）" };
  const result = sendFcmPushDetailed(user.fcm_token, title || "🔔 テスト通知", body || "プッシュ通知は正常に届いています！");
  return { ok: result.ok, detail: result };
}

function getTimerQueueSheet() {
  let sheet = getSheet("TimerQueue");
  if (!sheet) {
    sheet = SpreadsheetApp.openById(SPREADSHEET_ID).insertSheet("TimerQueue");
    sheet.appendRow(["student_email", "end_time", "label", "notified", "created_at"]);
  }
  return sheet;
}

// タイマー開始時に呼ばれる: 終了予定時刻を登録（同じユーザーの予約は上書き）
function scheduleTimerEnd(studentEmail, body) {
  if (!body.endTime) return { ok: false, error: "missing endTime" };
  const sheet = getTimerQueueSheet();
  const data = sheet.getDataRange().getValues();
  const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  const endDate = new Date(Number(body.endTime));
  const label = body.label || "タイマー";
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === studentEmail) {
      sheet.getRange(i + 1, 2).setValue(endDate);
      sheet.getRange(i + 1, 3).setValue(label);
      sheet.getRange(i + 1, 4).setValue(false);
      sheet.getRange(i + 1, 5).setValue(now);
      return { ok: true };
    }
  }
  sheet.appendRow([studentEmail, endDate, label, false, now]);
  return { ok: true };
}

// 一時停止・リセット・アプリ内で完了を確認できたときに呼ばれる: 予約を無効化
function cancelTimerEnd(studentEmail) {
  const sheet = getTimerQueueSheet();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === studentEmail) {
      sheet.getRange(i + 1, 4).setValue(true);
      break;
    }
  }
  return { ok: true };
}

// 毎分実行: 終了時刻を過ぎた未通知の予約があればLINEで知らせる
function checkTimerQueue() {
  const sheet = getTimerQueueSheet();
  const data = sheet.getDataRange().getValues();
  const now = new Date();
  const users = sheetToObjects(getSheet("Users"));
  for (let i = 1; i < data.length; i++) {
    const notified = data[i][3];
    if (notified === true || String(notified).toUpperCase() === "TRUE") continue;
    const endTime = data[i][1] instanceof Date ? data[i][1] : new Date(data[i][1]);
    if (endTime <= now) {
      const studentEmail = String(data[i][0]);
      const label = data[i][2] || "タイマー";
      const user = users.find(u => u.student_email === studentEmail);
      if (user && user.fcm_token) {
        sendFcmPush(user.fcm_token, "⏰ " + label, "終了しました！記録を忘れずに📝");
      }
      sheet.getRange(i + 1, 4).setValue(true);
    }
  }
}

// 指定日のカレンダー予定キャッシュを取得
function getCachedCalendar(studentEmail, dateStr) {
  if (!getSheet("CalendarCache")) return null;
  const row = getFilteredRows("CalendarCache", "student_email", studentEmail).find(r => r.date === dateStr);
  return row && row.events ? row.events : null;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 生徒コンテキスト構築（全プロンプト共通）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// preloaded: { logs, monthlySummaries, reports, coachingNotes, chatworkMessages }（すべてsheetToObjects形式、
// 対象生徒に絞り込み済みの配列）を呼び出し元が既に読み込んでいる場合はそれを渡すと、
// このシート全体の再読み込みをスキップする。朝・夜・毎時のバッチ処理のように
// 全生徒分をループする場面で、生徒ごとに5つのシートを読み直す（N×5回）のを防ぐため。
// 単発呼び出し（コーチCRMのAI予習サマリー等）はpreloadedなしで従来通り動く
function buildStudentContext(studentEmail, user, preloaded) {
  const today = formatDate(new Date());

  // 日付文字列(YYYY-MM-DD)に「今日/昨日/N日前/明日/N日後」の相対ラベルと曜日を付ける。
  // AIに日数計算をさせると「先日」「昨日」を取り違えるため、コード側で確定させて渡す。
  // これにより過去・未来すべての日付言及の時間軸が揃う
  const DOW_LABEL = ["日","月","火","水","木","金","土"];
  const todayMidnight = new Date(today + "T00:00:00");
  const dateLabel = (dateStr) => {
    const s = String(dateStr || "").substring(0, 10);
    const d = new Date(s + "T00:00:00");
    if (isNaN(d)) return dateStr;
    const diff = Math.round((d - todayMidnight) / 86400000);
    let rel;
    if (diff === 0) rel = "今日";
    else if (diff === -1) rel = "昨日";
    else if (diff === -2) rel = "一昨日";
    else if (diff < 0) rel = (-diff) + "日前";
    else if (diff === 1) rel = "明日";
    else if (diff === 2) rel = "明後日";
    else rel = diff + "日後";
    return s + "（" + DOW_LABEL[d.getDay()] + "・" + rel + "）";
  };

  // 直近14日の生ログ
  const fourteenDaysAgo = formatDate(new Date(Date.now() - 14 * 86400000));
  const allLogs = preloaded && preloaded.logs
    ? preloaded.logs
    : sheetToObjects(getSheet("DailyLog")).filter(l => l.student_email === studentEmail);
  const recentLogs = allLogs.filter(l => l.date >= fourteenDaysAgo);
  const logsByDay = {};
  recentLogs.forEach(l => {
    if (!logsByDay[l.date]) logsByDay[l.date] = [];
    logsByDay[l.date].push(l);
  });
  const recentLogsText = Object.entries(logsByDay)
    .sort((a,b) => a[0] > b[0] ? 1 : -1)
    .map(([date, dayLogs]) => {
      const entries = dayLogs
        .sort((a,b) => a.time_block > b.time_block ? 1 : -1)
        .map(l => l.time_block + " " + l.task + "（" + l.focus_level + (l.goal_related === "true" ? "・目標関連" : "") + (l.memo ? "・" + l.memo : "") + "）");
      return dateLabel(date) + ":\n  " + entries.join("\n  ");
    })
    .join("\n") || "記録なし";

  // 月次サマリー（全期間・古い順）
  const monthlySummaries = (preloaded && preloaded.monthlySummaries
    ? preloaded.monthlySummaries
    : sheetToObjects(getSheet("MonthlySummary")).filter(r => r.student_email === studentEmail)
  ).sort((a,b) => a.month > b.month ? 1 : -1);
  const summariesText = monthlySummaries.length > 0
    ? monthlySummaries.map(r => `【${r.month}】\n${r.summary}`).join("\n\n")
    : "まだ月次サマリーなし（入会1ヶ月未満）";

  // 直近30日のレポート履歴（月次サマリーを補完）
  const thirtyDaysAgo = formatDate(new Date(Date.now() - 30 * 86400000));
  const allReports = (preloaded && preloaded.reports
    ? preloaded.reports
    : sheetToObjects(getSheet("Reports")).filter(r => r.student_email === studentEmail)
  ).sort((a,b) => b.date > a.date ? 1 : -1);
  const recentReports = allReports.filter(r => r.date >= thirtyDaysAgo);
  const reportsText = recentReports.length > 0
    ? recentReports.map(r => `${dateLabel(r.date)}: ${r.score}点 / 良：${r.highlights} / 改善：${r.improvement}`).join("\n")
    : allReports.length > 0
      ? allReports.slice(0,7).map(r => `${dateLabel(r.date)}: ${r.score}点 / 良：${r.highlights} / 改善：${r.improvement}`).join("\n")
      : "まだレポートなし";

  // 全期間スコアトレンド
  const allScores = allReports.map(r => Number(r.score));
  const avgScore = allScores.length > 0 ? Math.round(allScores.reduce((a,b)=>a+b,0)/allScores.length) : null;
  const scoreTrend = avgScore !== null ? `全期間平均${avgScore}点（${allScores.length}日分）` : "データなし";

  // 目標と期限
  const goalsWithDeadline = effectiveGoals(user.student_email, user).map((g, i) => {
    const daysLeft = g.deadline ? Math.ceil((new Date(g.deadline) - new Date(today)) / 86400000) : null;
    const totalDays = g.deadline && user.joined_at ? Math.ceil((new Date(g.deadline) - new Date(user.joined_at)) / 86400000) : null;
    const progress = totalDays > 0 && daysLeft !== null ? Math.round((1 - daysLeft / totalDays) * 100) : null;
    return `目標${i+1}: ${g.goal}` +
      (daysLeft !== null ? `（期限まで残り${daysLeft}日` + (progress !== null ? `・経過率${progress}%` : "") + "）" : "（期限未設定）");
  });
  const goalsText = goalsWithDeadline.length > 0 ? goalsWithDeadline.join("\n") : "未設定";

  const streak = Number(user.streak || 0);
  const totalBlocks = allLogs.length;
  const totalDaysRecorded = new Set(allLogs.map(l => l.date)).size;

  // カレンダーキャッシュ（JSON形式と旧テキスト形式の両対応）を読みやすい文字列に整形する
  const formatCalPlan = (dateStr) => {
    let plan = getCachedCalendar(studentEmail, dateStr);
    if (!plan) return null;
    try {
      const evs = JSON.parse(plan);
      return evs.length > 0
        ? evs.map(function(e){ return e.allDay ? ("終日 " + e.title) : (e.time + "〜 " + e.title); }).join(" / ")
        : "予定なし";
    } catch (e) { return plan; /* 旧テキスト形式はそのまま */ }
  };
  // 今日と明日の日付・曜日・カレンダー予定を明示する。
  // 以前はAIに「今日の予定」だけを日付ラベルなしで渡していたため、AIが「明日」を
  // 推測で書いてズレる（例:「明日は大学講義」が昨日・今日どちらのレポートにも出る）
  // 事故が起きていた。今日/明日を実日付・曜日つきで渡し、明日の予定も別途渡すことで解消する
  const DOW = ["日","月","火","水","木","金","土"];
  const nowD = new Date();
  const tomorrow = formatDate(new Date(nowD.getTime() + 86400000));
  const todayDow = DOW[nowD.getDay()];
  const tomorrowDow = DOW[new Date(nowD.getTime() + 86400000).getDay()];
  const todayPlan = formatCalPlan(today);
  const tomorrowPlan = formatCalPlan(tomorrow);

  // 直近のコーチングセッション（人間のコーチとの面談記録）。
  // AIコーチはこれを踏まえてフォローアップする＝コーチングの続きを日々担う
  let coachingText = "まだコーチング記録なし";
  try {
    const coachingNotes = (preloaded && preloaded.coachingNotes
      ? preloaded.coachingNotes
      : sheetToObjects(getSheet("CoachingNotes") || getCoachingNotesSheet()).filter(n => n.student_email === studentEmail)
    ).sort((a,b)=>b.date>a.date?1:-1).slice(0, 3);
    if (coachingNotes.length > 0) {
      coachingText = coachingNotes.map(n =>
        `【${dateLabel(n.date)}】${n.content}` +
        (n.promises ? `\n  約束事項: ${n.promises}` : "") +
        (n.next_theme ? `\n  次回テーマ: ${n.next_theme}` : "")
      ).join("\n");
    }
  } catch (e) { /* シート未作成なら無視 */ }

  // Chatworkでの直近のやり取り（コーチ・本人双方の生の会話）。
  // 面談記録だけでは拾えない、日常の言葉遣いや悩みの温度感をAIが把握するために使う
  let chatworkText = "まだ連携なし";
  try {
    const messages = (preloaded && preloaded.chatworkMessages
      ? preloaded.chatworkMessages
      : sheetToObjects(getChatworkMessagesSheet()).filter(m => m.student_email === studentEmail)
    ).sort((a,b)=>b.send_time>a.send_time?1:-1).slice(0, 15).reverse();
    if (messages.length > 0) {
      // send_time（"YYYY-MM-DD HH:mm"等）の日付部分に相対ラベルを付け、時刻は残す
      chatworkText = messages.map(m => {
        const st = String(m.send_time || "");
        const timePart = st.length > 10 ? st.substring(10).trim() : "";
        return `${dateLabel(st)}${timePart ? " " + timePart : ""} ${m.sender_name}: ${m.body}`;
      }).join("\n");
    }
  } catch (e) { /* シート未作成なら無視 */ }

  // 休みの日の情報。休みの日に仕事や勉強を課すような助言をしないための最重要コンテキスト
  const nowDate = new Date();
  const restConfigured = String(user.rest_days || "").trim() !== "";
  const restDayNames = restConfigured
    ? String(user.rest_days).split(",").map(n => "日月火水木金土"[Number(String(n).trim())] + "曜").join("・")
    : "";
  const restText = restConfigured
    ? `休みの曜日: ${restDayNames}。今日は${isRestDay(user, nowDate) ? "【休みの日】" : "活動日"}、明日は${isRestDay(user, new Date(nowDate.getTime() + 86400000)) ? "【休みの日】" : "活動日"}。休みの日には仕事・勉強・タスクを課すような助言は絶対にしない（休養・リフレッシュ・好きなことを尊重し、記録も「したければでOK」の温度感にする）。明日が休みの日なら「明日の朝から仕事を頑張ろう」のような活動前提の助言もしない`
    : "未設定（すべて活動日として扱う）";

  // 本人が今朝アプリで宣言した「今日いちばんやりたいこと」
  let intentText = "未設定";
  try {
    // 全生徒ループ（朝・夜のバッチ）でJournalシートを毎回読み直さないよう、実行内でキャッシュする
    if (!globalThis.__journalCache) globalThis.__journalCache = sheetToObjects(getJournalSheet());
    const jRow = globalThis.__journalCache.find(r => {
      const rd = r.date instanceof Date ? Utilities.formatDate(r.date, "Asia/Tokyo", "yyyy-MM-dd") : String(r.date);
      return r.student_email === studentEmail && rd === today;
    });
    if (jRow && jRow.intent) intentText = jRow.intent + (jRow.intent_hours ? "（目標" + jRow.intent_hours + "時間）" : "") + (String(jRow.intent_done) === "true" ? "（✅達成済み）" : "（まだ未達成）");
  } catch (e) { /* シート未作成なら無視 */ }

  // セカンドブレインの蓄積（時間の使い道マップ・気づき集）をコーチの文脈に流し込む。
  // これによりタブを開かない生徒にも、朝夜のメッセージ・レポートを通じて洞察が能動的に届く
  let themesText = "未生成";
  try {
    if (getSheet("TimeThemes")) {
      if (!globalThis.__timeThemesCache) globalThis.__timeThemesCache = sheetToObjects(getTimeThemesSheet());
      const tRow = globalThis.__timeThemesCache.find(r => r.student_email === studentEmail);
      if (tRow && tRow.themes_json) {
        const pj = JSON.parse(tRow.themes_json);
        const arr = Array.isArray(pj) ? pj : (pj.themes || []);
        const sm = Array.isArray(pj) ? "" : (pj.summary || "");
        if (arr.length) {
          themesText = arr.map(function(t){ return t.name + " " + t.blocks + "時間帯"; }).join(" / ") + (sm ? "\n傾向: " + sm : "");
        }
      }
    }
  } catch (e) { /* 無視 */ }

  // 本人が週次ふりかえりで書いた「来週の一言」。その週のコーチングの軸として尊重する
  let weeklyIntentionText = "未設定";
  try {
    if (getSheet("WeeklySummary")) {
      if (!globalThis.__weeklyCache) globalThis.__weeklyCache = sheetToObjects(getWeeklySummarySheet());
      const rows = globalThis.__weeklyCache.filter(r => r.student_email === studentEmail)
        .sort((a, b) => (b.week_start > a.week_start ? 1 : -1));
      if (rows.length && rows[0].next_week_intention && String(rows[0].next_week_intention).trim()) {
        weeklyIntentionText = rows[0].next_week_intention + (rows[0].user_reflection ? "（先週のふりかえり: " + rows[0].user_reflection + "）" : "");
      }
    }
  } catch (e) { /* 無視 */ }

  let insightsText = "未生成";
  try {
    if (getSheet("Insights")) {
      if (!globalThis.__insightsCache) globalThis.__insightsCache = sheetToObjects(getInsightsSheet());
      const iRow = globalThis.__insightsCache.find(r => r.student_email === studentEmail);
      if (iRow && iRow.insights_json) {
        const items = JSON.parse(iRow.insights_json);
        if (items.length) {
          insightsText = items.map(function(it){ return (it.type === "caution" ? "【注意】" : "【強み】") + it.title + "：" + it.detail; }).join("\n");
        }
      }
    }
  } catch (e) { /* 無視 */ }

  return `【本日の日付】${today}（${todayDow}曜日）
【明日の日付】${tomorrow}（${tomorrowDow}曜日）
※日付の扱いは厳守：この文脈内のログ・レポート・面談記録・カレンダー予定などの日付には全て「（曜日・今日/昨日/N日前/明日/N日後）」という相対ラベルが付いている。これは確定情報なので、「昨日」「先日」「この前」等の時間表現は必ずこのラベルどおりに書き、自分で日数を計算し直したり推測で書いたりしない。今日の予定を「明日」と書くような取り違えは禁止
【生徒名】${user.name}
【入会日】${user.joined_at || "不明"}
${user.onboarding_profile ? "【本人の自己分析（初回アンケート。この人の性格・課題・好みの土台。特に" + (user.coach_tone ? "「" + user.coach_tone + "」というコーチングの好みは尊重する" : "声かけのトーンは本人の好みに合わせる") + "）】\n" + user.onboarding_profile + "\n" : ""}【連続記録日数】${streak}日
【全期間の記録】合計${totalDaysRecorded}日・${totalBlocks}時間帯
【今日（${today} ${todayDow}）のカレンダー予定】${todayPlan || "未同期（予定情報なし）"}
【明日（${tomorrow} ${tomorrowDow}）のカレンダー予定】${tomorrowPlan || "未同期（予定情報なし）"}
【休みの日】${restText}
【今日いちばんやりたいこと（本人が今朝宣言。達成できたか必ず気にかけること）】${intentText}
【今週こうしたい（本人が週の初めに宣言した来週の一言。今週の声かけの軸として尊重する）】${weeklyIntentionText}
【目標と期限】
${goalsText}
【全期間スコアトレンド】${scoreTrend}
【直近のコーチングセッション（担当コーチとの面談記録。約束事項のフォローアップを意識する）】
${coachingText}
【本人とのこれまでのやり取り（生成文では情報源に言及せず、本人の状況として自然に触れること）】
${chatworkText}
【時間の使い道マップ（直近30日をAIが自動分類。この人の時間配分の実態。目標に向けた偏り・かたよりすぎを踏まえて助言する）】
${themesText}
【この人の気づき・傾向（過去の記録から蒸留した強みと注意すべき癖。承認や助言の根拠として自然に織り込む。ただし説教くさくならないよう1回のメッセージで触れるのは1点まで）】
${insightsText}
【月次サマリー（入会〜先月まで）】
${summariesText}
【直近30日のレポート履歴】
${reportsText}
【直近14日の詳細ログ】
${recentLogsText}`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 月次サマリー生成（毎月1日に実行）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function generateMonthlySummaries() {
  const now = new Date();
  // 先月の年月を取得
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const monthStr = lastMonth.getFullYear() + "-" + String(lastMonth.getMonth() + 1).padStart(2, "0");
  const monthStart = monthStr + "-01";
  const monthEnd = monthStr + "-31";

  const apiKey = PropertiesService.getScriptProperties().getProperty("CLAUDE_API_KEY");
  if (!apiKey) return;

  const summarySheet = getSheet("MonthlySummary") || SpreadsheetApp.openById(SPREADSHEET_ID).insertSheet("MonthlySummary");
  if (summarySheet.getLastRow() === 0) {
    summarySheet.appendRow(["month", "student_email", "summary", "created_at"]);
  }

  sheetToObjects(getSheet("Users")).filter(u => u.is_active.toUpperCase() === "TRUE").forEach(user => {
    try {
      // 既に先月のサマリーがあればスキップ
      const existing = sheetToObjects(summarySheet).find(r => r.student_email === user.student_email && r.month === monthStr);
      if (existing) return;

      // 先月のログ
      const monthLogs = sheetToObjects(getSheet("DailyLog"))
        .filter(l => l.student_email === user.student_email && l.date >= monthStart && l.date <= monthEnd)
        .sort((a,b) => a.date > b.date ? 1 : -1);
      if (monthLogs.length === 0) {
        summarySheet.appendRow([monthStr, user.student_email, "記録なし（この月は活動なし）", new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })]);
        return;
      }

      // 先月のレポート
      const monthReports = sheetToObjects(getSheet("Reports"))
        .filter(r => r.student_email === user.student_email && r.date >= monthStart && r.date <= monthEnd)
        .sort((a,b) => a.date > b.date ? 1 : -1);

      // 統計
      const activeDays = new Set(monthLogs.map(l => l.date)).size;
      const totalBlocks = monthLogs.length;
      const goalRelatedCount = monthLogs.filter(l => l.goal_related === "true").length;
      const focusCounts = monthLogs.reduce((acc, l) => { acc[l.focus_level] = (acc[l.focus_level] || 0) + 1; return acc; }, {});
      const focusSummary = Object.entries(focusCounts).map(([k,v]) => `${k}:${v}件`).join("、");
      const taskCounts = monthLogs.reduce((acc, l) => { if (l.task) acc[l.task] = (acc[l.task] || 0) + 1; return acc; }, {});
      const topTasks = Object.entries(taskCounts).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([t,c])=>`${t}(${c}回)`).join("、");
      const avgScore = monthReports.length > 0
        ? Math.round(monthReports.reduce((s,r)=>s+Number(r.score),0)/monthReports.length)
        : null;
      const scoreRange = monthReports.length > 0
        ? `最高${Math.max(...monthReports.map(r=>Number(r.score)))}点・最低${Math.min(...monthReports.map(r=>Number(r.score)))}点`
        : "レポートなし";

      const logsText = monthLogs.map(l => l.date + " " + l.time_block + " " + l.task + "（" + l.focus_level + (l.goal_related === "true" ? "・目標関連" : "") + (l.memo ? "・" + l.memo : "") + "）").join("\n");

      const prompt = `以下のデータをもとに、${user.name}の${monthStr}の活動を次のコーチへの引き継ぎ文として簡潔にまとめてください。

【${monthStr}の統計】
- 記録日数: ${activeDays}日 / ${totalBlocks}時間帯
- 集中度内訳: ${focusSummary}
- 目標関連: ${goalRelatedCount}時間帯
- よく取り組んだこと: ${topTasks}
- スコア: 平均${avgScore !== null ? avgScore + "点" : "データなし"}（${scoreRange}）

【全ログ】
${logsText}

【要件】
- 箇条書きなし・見出しなし。自然な文章で3〜5文
- この月に何に取り組んだか、どんな状態だったか、良かった点と課題を含める
- 次のコーチが読んで「この生徒はこういう人だ」とわかる引き継ぎ文にする
- 宛名・前置き・説明は不要。本文だけ`;

      const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        payload: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 400, messages: [{ role: "user", content: prompt }] }),
        muteHttpExceptions: true
      });
      const result = JSON.parse(res.getContentText()); logAiUsage(result, "月次サマリー");
      if (!result.content || !result.content[0]) return;

      summarySheet.appendRow([monthStr, user.student_email, result.content[0].text, new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })]);
      Logger.log(user.student_email + ": " + monthStr + " 月次サマリー生成完了");
    } catch(err) { Logger.log("monthlySummary error: " + err); }
  });
}

function testGenerateMonthlySummary() {
  generateMonthlySummaries();
}

// 昨日の日付でレポートを一括生成する（エディタから引数なしで実行できるラッパー）。
// 夜間バッチが何らかの理由で走らなかった日の翌日に、これを1回実行すれば補完できる
function generateReportForYesterday() {
  generateReportForDate(formatDate(new Date(Date.now() - 86400000)));
}

// 全生徒のストリークをDailyLogの実記録から再計算する復旧ユーティリティ。
// 最終記録日から遡って連続日数を数え、streakとlast_log_dateを実データに合わせて直す
function adminRecomputeStreaks() {
  const sheet = getSheet("Users");
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const emailIdx = headers.indexOf("student_email");
  const streakIdx = headers.indexOf("streak");
  const lastLogDateIdx = headers.indexOf("last_log_date");
  if (streakIdx === -1 || lastLogDateIdx === -1) { Logger.log("streak/last_log_date列がありません"); return; }

  const datesByEmail = new Map();
  sheetToObjects(getSheet("DailyLog")).forEach(l => {
    const email = String(l.student_email || "");
    if (!email || !l.date) return;
    if (!datesByEmail.has(email)) datesByEmail.set(email, new Set());
    datesByEmail.get(email).add(String(l.date).substring(0, 10));
  });

  for (let i = 1; i < data.length; i++) {
    const email = String(data[i][emailIdx]);
    const dates = datesByEmail.get(email);
    if (!dates || dates.size === 0) continue;
    const sorted = Array.from(dates).sort();
    const last = sorted[sorted.length - 1];
    let streak = 1;
    let cursor = new Date(last + "T00:00:00");
    while (true) {
      cursor = new Date(cursor.getTime() - 86400000);
      if (dates.has(formatDate(cursor))) streak++;
      else break;
    }
    sheet.getRange(i + 1, streakIdx + 1).setValue(streak);
    sheet.getRange(i + 1, lastLogDateIdx + 1).setValue(last);
    Logger.log(email + ": streak=" + streak + " last_log_date=" + last);
  }
}

// フリーズを考慮して全員のストリークを正しく再計算する。
// 背景: ストリークフリーズ機能は2026-07-11に実装されたが、それ以前から長い連続記録が
// あったユーザーは、過去に達成済みの「7日ごとのフリーズ」が遡って付与されていなかった。
// そのため機能実装直後の1日欠けで、本来フリーズで守られるはずのストリークがリセットされた。
// この関数は全記録履歴からフリーズ経済（7日ごとに1個獲得・最大2個・1日の欠けを1個で橋渡し）を
// シミュレートし、本来あるべきstreak/streak_freeze/last_log_dateを復元する。
// confirm !== "yes" のときは書き込まず差分だけ返す（必ず先にドライランで確認すること）
function adminRepairStreaksFreeze(email, confirm) {
  if (!verifyAdmin(email)) return { ok: false, error: "not admin" };
  const sheet = getSheet("Users");
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const emailIdx = headers.indexOf("student_email");
  let streakIdx = headers.indexOf("streak");
  let lastLogDateIdx = headers.indexOf("last_log_date");
  let freezeIdx = headers.indexOf("streak_freeze");
  if (freezeIdx === -1) { freezeIdx = headers.length; sheet.getRange(1, freezeIdx + 1).setValue("streak_freeze"); headers.push("streak_freeze"); }
  if (streakIdx === -1 || lastLogDateIdx === -1) return { ok: false, error: "streak/last_log_date列がありません" };

  const daysBetween = (a, b) => Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
  const today = formatDate(new Date());
  const yesterday = formatDate(new Date(Date.now() - 86400000));

  // 記録日をユーザー別に集約
  const datesByEmail = new Map();
  sheetToObjects(getSheet("DailyLog")).forEach(l => {
    const em = String(l.student_email || "");
    if (!em || !l.date) return;
    if (!datesByEmail.has(em)) datesByEmail.set(em, new Set());
    datesByEmail.get(em).add(String(l.date).substring(0, 10));
  });

  const results = [];
  for (let i = 1; i < data.length; i++) {
    const em = String(data[i][emailIdx]);
    const set = datesByEmail.get(em);
    if (!set || set.size === 0) continue;
    const dates = Array.from(set).sort();

    // フリーズ経済をシミュレート
    let streak = 0, freeze = 0, prev = null;
    for (const d of dates) {
      if (prev === null) { streak = 1; }
      else {
        const gap = daysBetween(prev, d);
        if (gap === 1) streak += 1;
        else if (gap === 2 && freeze > 0) { freeze -= 1; streak += 1; } // 1日の欠けをフリーズで橋渡し
        else streak = 1; // 2日以上の欠け、またはフリーズなしの欠け → リセット
      }
      if (streak > 0 && streak % 7 === 0 && freeze < 2) freeze += 1; // 7日ごとに獲得
      prev = d;
    }

    // 今日時点でストリークが生きているか判定
    const gapToToday = daysBetween(prev, today);
    let finalStreak, finalFreeze, finalLastLog;
    if (gapToToday <= 1) { finalStreak = streak; finalFreeze = freeze; finalLastLog = prev; }
    else if (gapToToday === 2 && freeze > 0) { finalStreak = streak; finalFreeze = freeze - 1; finalLastLog = yesterday; }
    else { finalStreak = 0; finalFreeze = freeze; finalLastLog = prev; }

    const curStreak = Number(data[i][streakIdx] || 0);
    const curFreeze = freezeIdx < data[i].length ? Number(data[i][freezeIdx] || 0) : 0;
    const changed = curStreak !== finalStreak || curFreeze !== finalFreeze;

    results.push({
      email: em, name: String(data[i][headers.indexOf("name")] || ""),
      before: { streak: curStreak, freeze: curFreeze },
      after: { streak: finalStreak, freeze: finalFreeze },
      lastRecord: prev, changed: changed
    });

    if (confirm === "yes" && changed) {
      sheet.getRange(i + 1, streakIdx + 1).setValue(finalStreak);
      sheet.getRange(i + 1, freezeIdx + 1).setValue(finalFreeze);
      sheet.getRange(i + 1, lastLogDateIdx + 1).setNumberFormat("@").setValue(finalLastLog);
    }
  }

  return { ok: true, dryRun: confirm !== "yes", changedCount: results.filter(r => r.changed).length, results: results };
}

// 2026-07-07 0:06の誤実行（夜間バッチが日付を跨ぎ「翌日の記録0件」と誤判定した
// 事故）の復旧用。実行ログから判明しているXP減少分を戻し、全員のストリークを
// 実記録から再計算する。1回だけ実行すること（2回実行するとXPが二重に増える）
function adminRepairDecayIncident20260707() {
  const restore = {
    "work.sunagawa@gmail.com": 15,
    "kanayan0320@gmail.com": 15,
    "teddy.0923ak@gmail.com": 15,
    "www.mimikunlll@gmail.com": 15
  };
  const sheet = getSheet("Users");
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const emailIdx = headers.indexOf("student_email");
  const xpIdx = headers.indexOf("xp");
  for (let i = 1; i < data.length; i++) {
    const email = String(data[i][emailIdx]);
    if (!restore[email]) continue;
    const cur = Number(data[i][xpIdx] || 0);
    sheet.getRange(i + 1, xpIdx + 1).setValue(cur + restore[email]);
    Logger.log(email + ": XP " + cur + " → " + (cur + restore[email]) + " (復旧 +" + restore[email] + ")");
  }
  adminRecomputeStreaks();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 週次サマリー（毎週月曜の朝に、直前の月〜日を振り返って生成）
// 日次レポートだけだと「今週どうだったか」が見えないという要望から追加
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function getWeeklySummarySheet() {
  let sheet = getSheet("WeeklySummary");
  if (!sheet) {
    sheet = SpreadsheetApp.openById(SPREADSHEET_ID).insertSheet("WeeklySummary");
    sheet.appendRow(["week_start", "week_end", "student_email", "summary", "avg_score", "total_blocks", "goal_related_pct", "streak_end", "created_at"]);
  }
  return sheet;
}

function generateWeeklySummaries() {
  // 週末（土曜の朝）に、今週の月〜金を対象に生成する。生徒は土日にふりかえって
  // 来週の一言を書く、という週末の儀式にするため。曜日に依存せず今週の月曜を起点に計算
  const now = new Date();
  const dow = now.getDay();                     // 日=0, 月=1, ... 土=6
  const mondayOffset = (dow === 0) ? -6 : (1 - dow); // 今週の月曜までの日数
  const weekStart = addDaysToDate(now, mondayOffset);   // 今週の月曜
  const weekEnd = addDaysToDate(now, -1);       // 昨日（土曜実行なら金曜まで）
  const weekStartStr = formatDate(weekStart);
  const weekEndStr = formatDate(weekEnd);

  const apiKey = PropertiesService.getScriptProperties().getProperty("CLAUDE_API_KEY");
  if (!apiKey) return;

  const summarySheet = getWeeklySummarySheet();

  sheetToObjects(getSheet("Users")).filter(u => u.is_active.toUpperCase() === "TRUE").forEach(user => {
    try {
      // 既に今週分があればスキップ（重複防止）
      const existing = sheetToObjects(summarySheet).find(r => r.student_email === user.student_email && r.week_start === weekStartStr);
      if (existing) return;

      const weekLogs = sheetToObjects(getSheet("DailyLog"))
        .filter(l => l.student_email === user.student_email && l.date >= weekStartStr && l.date <= weekEndStr)
        .sort((a,b) => a.date > b.date ? 1 : -1);
      if (weekLogs.length === 0) return; // この週は活動なし → 生成しない（レポート同様、無理に作らない）

      const weekReports = sheetToObjects(getSheet("Reports"))
        .filter(r => r.student_email === user.student_email && r.date >= weekStartStr && r.date <= weekEndStr)
        .sort((a,b) => a.date > b.date ? 1 : -1);

      const activeDays = new Set(weekLogs.map(l => l.date)).size;
      const totalBlocks = weekLogs.length;
      const goalRelatedCount = weekLogs.filter(l => l.goal_related === "true").length;
      const goalRelatedPct = totalBlocks ? Math.round(goalRelatedCount / totalBlocks * 100) : 0;
      const avgScore = weekReports.length > 0
        ? Math.round(weekReports.reduce((s,r)=>s+Number(r.score),0)/weekReports.length)
        : null;
      const taskCounts = weekLogs.reduce((acc, l) => { if (l.task) acc[l.task] = (acc[l.task] || 0) + 1; return acc; }, {});
      const topTasks = Object.entries(taskCounts).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([t,c])=>`${t}(${c}回)`).join("、");
      const latestUser = sheetToObjects(getSheet("Users")).find(u => u.student_email === user.student_email);
      const streakEnd = Number(latestUser?.streak || 0);

      const logsText = weekLogs.map(l => l.date + " " + l.time_block + " " + l.task + "（" + l.focus_level + (l.goal_related === "true" ? "・目標関連" : "") + (l.memo ? "・" + l.memo : "") + "）").join("\n");

      const prompt = `以下は${user.name}の直近1週間（${weekStartStr}〜${weekEndStr}）の記録です。今週の振り返りコメントを生成してください。

【今週の統計】
- 記録日数: ${activeDays}日 / ${totalBlocks}時間帯
- 目標関連の記録: ${goalRelatedPct}%
- よく取り組んだこと: ${topTasks || "特になし"}
- レポート平均スコア: ${avgScore !== null ? avgScore + "点" : "データなし"}
- 現在の連続記録日数: ${streakEnd}日

【今週の全ログ】
${logsText}

【要件】
- 「〇〇さん」等の宛名・挨拶・見出しは書かない。本文からいきなり始める
- 3〜4文程度。今週何に取り組んだか、良かった点、来週に向けて意識するとよいことに触れる
- 抽象的な褒め言葉より、具体的な内容・数字に触れる
- 前向きで励みになるトーンにする。文末に絵文字は1個まで`;

      const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        payload: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 400, messages: [{ role: "user", content: prompt }] }),
        muteHttpExceptions: true
      });
      const result = JSON.parse(res.getContentText()); logAiUsage(result, "週次サマリー");
      if (!result.content || !result.content[0]) return;

      summarySheet.appendRow([
        weekStartStr, weekEndStr, user.student_email, result.content[0].text,
        avgScore !== null ? avgScore : "", totalBlocks, goalRelatedPct, streakEnd,
        new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })
      ]);
      Logger.log(user.student_email + ": " + weekStartStr + "〜" + weekEndStr + " 週次サマリー生成完了");
    } catch(err) { Logger.log("weeklySummary error: " + err); }
  });
}

function addDaysToDate(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// 生徒アプリから呼ばれる: 直近の週次サマリーを1件返す
function getWeeklySummary(studentEmail) {
  // シートがまだ無い（初回の月曜トリガー実行前）場合はエラーにせずnullを返す
  if (!getSheet("WeeklySummary")) return { ok: true, data: null };
  const rows = getFilteredRows("WeeklySummary", "student_email", studentEmail)
    .sort((a, b) => b.week_start > a.week_start ? 1 : -1);
  if (rows.length === 0) return { ok: true, data: null };
  const r = rows[0];
  return { ok: true, data: {
    weekStart: r.week_start, weekEnd: r.week_end, summary: r.summary,
    avgScore: r.avg_score !== "" ? Number(r.avg_score) : null,
    totalBlocks: Number(r.total_blocks) || 0,
    goalRelatedPct: Number(r.goal_related_pct) || 0,
    streakEnd: Number(r.streak_end) || 0,
    // 本人がこの週のふりかえりを記入済みか（未記入ならホームで記入を促す）
    reflection: r.user_reflection || "",
    nextIntention: r.next_week_intention || "",
    reflected: !!(r.user_reflection && String(r.user_reflection).trim())
  } };
}

// 本人が書く週次ふりかえり＋来週の一言を保存する。week_startで対象週を特定する。
// next_week_intentionはコーチの文脈にも渡され、翌週の声かけに反映される
function saveWeeklyReflection(studentEmail, body) {
  const weekStart = String(body.week_start || "").trim();
  if (!weekStart) return { ok: false, error: "week_start required" };
  const sheet = getWeeklySummarySheet();
  const data = sheet.getDataRange().getValues();
  let headers = data[0];
  const ensureCol = (name) => {
    let idx = headers.indexOf(name);
    if (idx === -1) { idx = headers.length; sheet.getRange(1, idx + 1).setValue(name); headers.push(name); }
    return idx;
  };
  const wsIdx = headers.indexOf("week_start");
  const emIdx = headers.indexOf("student_email");
  const refIdx = ensureCol("user_reflection");
  const intIdx = ensureCol("next_week_intention");
  const atIdx = ensureCol("reflected_at");
  const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  for (let i = 1; i < data.length; i++) {
    const rowWs = data[i][wsIdx] instanceof Date ? formatDate(data[i][wsIdx]) : String(data[i][wsIdx]);
    if (String(data[i][emIdx]) === studentEmail && rowWs === weekStart) {
      if (body.reflection !== undefined) sheet.getRange(i + 1, refIdx + 1).setValue(String(body.reflection).slice(0, 2000));
      if (body.intention !== undefined) sheet.getRange(i + 1, intIdx + 1).setValue(String(body.intention).slice(0, 500));
      sheet.getRange(i + 1, atIdx + 1).setValue(now);
      return { ok: true };
    }
  }
  return { ok: false, error: "対象の週次サマリーが見つかりません" };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 月間ふりかえり（毎月1日の朝に、先月分を生徒向けの文章で生成）
// MonthlySummaryはコーチ引き継ぎ用の文体のため、生徒が読む用は別に作る
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function getMonthlyReviewSheet() {
  let sheet = getSheet("MonthlyReview");
  if (!sheet) {
    sheet = SpreadsheetApp.openById(SPREADSHEET_ID).insertSheet("MonthlyReview");
    sheet.appendRow(["month", "student_email", "summary", "active_days", "total_blocks", "goal_related_pct", "avg_score", "created_at"]);
  }
  return sheet;
}

function generateMonthlyReviews() {
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const monthStr = lastMonth.getFullYear() + "-" + String(lastMonth.getMonth() + 1).padStart(2, "0");
  const monthStart = monthStr + "-01";
  const monthEnd = monthStr + "-31";
  // 前々月（先月との比較用）
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const prevStr = prevMonth.getFullYear() + "-" + String(prevMonth.getMonth() + 1).padStart(2, "0");

  const apiKey = PropertiesService.getScriptProperties().getProperty("CLAUDE_API_KEY");
  if (!apiKey) return;
  const reviewSheet = getMonthlyReviewSheet();
  const allLogs = sheetToObjects(getSheet("DailyLog"));
  const allReports = sheetToObjects(getSheet("Reports"));

  sheetToObjects(getSheet("Users")).filter(u => u.is_active.toUpperCase() === "TRUE").forEach(user => {
    try {
      const existing = sheetToObjects(reviewSheet).find(r => r.student_email === user.student_email && r.month === monthStr);
      if (existing) return;

      const monthLogs = allLogs.filter(l => l.student_email === user.student_email && l.date >= monthStart && l.date <= monthEnd);
      if (monthLogs.length === 0) return; // 活動なしの月は無理に作らない

      const prevLogs = allLogs.filter(l => l.student_email === user.student_email && l.date >= prevStr + "-01" && l.date <= prevStr + "-31");
      const monthReports = allReports.filter(r => r.student_email === user.student_email && r.date >= monthStart && r.date <= monthEnd);

      const activeDays = new Set(monthLogs.map(l => l.date)).size;
      const totalBlocks = monthLogs.length;
      const goalRelatedPct = Math.round(monthLogs.filter(l => l.goal_related === "true").length / totalBlocks * 100);
      const avgScore = monthReports.length > 0 ? Math.round(monthReports.reduce((s, r) => s + Number(r.score), 0) / monthReports.length) : null;
      const taskCounts = monthLogs.reduce((acc, l) => { if (l.task) acc[l.task] = (acc[l.task] || 0) + 1; return acc; }, {});
      const topTasks = Object.entries(taskCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t, c]) => `${t}(${c}回)`).join("、");
      const compareText = prevLogs.length > 0
        ? `前月（${prevStr}）は${new Set(prevLogs.map(l => l.date)).size}日・${prevLogs.length}時間帯の記録`
        : "前月の記録なし（比較不可）";

      const prompt = `以下は${user.name}の${monthStr}（先月）1ヶ月間の記録です。本人が読む月間ふりかえりコメントを生成してください。

【先月の統計】
- 記録日数: ${activeDays}日 / ${totalBlocks}時間帯
- 目標関連の記録: ${goalRelatedPct}%
- よく取り組んだこと: ${topTasks || "特になし"}
- レポート平均スコア: ${avgScore !== null ? avgScore + "点" : "データなし"}
- 前月との比較: ${compareText}

【先月の記録サンプル（最新50件）】
${monthLogs.slice(-50).map(l => l.date + " " + l.time_block + " " + l.task + "（" + l.focus_level + (l.memo ? "・" + l.memo : "") + "）").join("\n")}

【要件】
- 宛名・挨拶・見出しは書かない。本文からいきなり始める
- 4〜6文程度。1ヶ月で何に時間を使ったか、前月からの変化、良かった点、今月に向けての焦点を含める
- 抽象的な褒め言葉より、具体的な内容・数字に触れる
- アメとムチ: よく積み上げた月は盛大に称え、失速した月はごまかさず指摘する（人格ではなく行動を。愛のある言い方で）
- 文末の絵文字は合計2個まで`;

      const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        payload: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 500, messages: [{ role: "user", content: prompt }] }),
        muteHttpExceptions: true
      });
      const result = JSON.parse(res.getContentText()); logAiUsage(result, "月次レビュー");
      if (!result.content || !result.content[0]) return;

      reviewSheet.appendRow([monthStr, user.student_email, result.content[0].text,
        activeDays, totalBlocks, goalRelatedPct, avgScore !== null ? avgScore : "",
        new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })]);
      Logger.log(user.student_email + ": " + monthStr + " 月間ふりかえり生成完了");
    } catch (err) { Logger.log("monthlyReview error: " + err); }
  });
}

// 生徒アプリから呼ばれる: 直近の月間ふりかえりを1件返す
function getMonthlyReview(studentEmail) {
  if (!getSheet("MonthlyReview")) return { ok: true, data: null };
  const rows = getFilteredRows("MonthlyReview", "student_email", studentEmail)
    .sort((a, b) => b.month > a.month ? 1 : -1);
  if (rows.length === 0) return { ok: true, data: null };
  const r = rows[0];
  return { ok: true, data: {
    month: r.month, summary: r.summary,
    activeDays: Number(r.active_days) || 0,
    totalBlocks: Number(r.total_blocks) || 0,
    goalRelatedPct: Number(r.goal_related_pct) || 0,
    avgScore: r.avg_score !== "" ? Number(r.avg_score) : null
  } };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// あなたの気づき集（Insights・セカンドブレイン機能②）
// 蓄積したメモ・日記からAIが「繰り返し現れる学び・パターン」を抽出して蒸留する。
// 生の記録→知恵、という第二の脳の完成形。月1で自動更新＋本人が手動更新も可能
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function getInsightsSheet() {
  let sheet = getSheet("Insights");
  if (!sheet) {
    sheet = SpreadsheetApp.openById(SPREADSHEET_ID).insertSheet("Insights");
    sheet.appendRow(["student_email", "insights_json", "source_count", "updated_at"]);
  }
  return sheet;
}

function getInsights(studentEmail) {
  if (!getSheet("Insights")) return { ok: true, data: null };
  const row = sheetToObjects(getInsightsSheet()).find(r => r.student_email === studentEmail);
  if (!row || !row.insights_json) return { ok: true, data: null };
  let items = [];
  try { items = JSON.parse(row.insights_json); } catch (e) {}
  return { ok: true, data: { items: items, updatedAt: row.updated_at || "", sourceCount: Number(row.source_count) || 0 } };
}

// 1人分の気づきを生成してInsightsシートに保存（upsert）。
// throttle=trueのとき、直近に更新済みなら再生成せず既存を返す（手動更新の連打・コスト対策）
function generateInsightsForUser(studentEmail, throttle) {
  const apiKey = PropertiesService.getScriptProperties().getProperty("CLAUDE_API_KEY");
  if (!apiKey) return { ok: false, error: "CLAUDE_API_KEY未設定" };

  if (throttle) {
    const existing = sheetToObjects(getInsightsSheet()).find(r => r.student_email === studentEmail);
    if (existing && existing.updated_at) {
      const updated = new Date(existing.updated_at);
      if (!isNaN(updated) && (Date.now() - updated.getTime()) < 6 * 3600 * 1000) {
        let items = [];
        try { items = JSON.parse(existing.insights_json); } catch (e) {}
        return { ok: true, throttled: true, data: { items: items, updatedAt: existing.updated_at, sourceCount: Number(existing.source_count) || 0 } };
      }
    }
  }

  const cutoff = formatDate(new Date(Date.now() - 180 * 86400000));
  const user = sheetToObjects(getSheet("Users")).find(u => u.student_email === studentEmail);
  const name = user ? user.name : "この人";

  const logs = getFilteredRows("DailyLog", "student_email", studentEmail)
    .filter(l => l.date >= cutoff && l.memo && l.memo.trim())
    .sort((a, b) => a.date > b.date ? 1 : -1);
  const journalRows = getSheet("Journal")
    ? sheetToObjects(getJournalSheet()).filter(r => {
        const rd = r.date instanceof Date ? formatDate(r.date) : String(r.date);
        return r.student_email === studentEmail && rd >= cutoff && r.diary && r.diary.trim();
      })
    : [];

  // 気づきの蒸留には、繰り返しパターンを見るためある程度の量が必要
  if (logs.length + journalRows.length < 8) {
    return { ok: false, error: "まだ気づきを見つけるには記録が少なめです。メモ付きで記録を続けると、あなたの傾向や学びが蒸留されていきます（現在" + (logs.length + journalRows.length) + "件）" };
  }

  const logsText = logs.map(l => l.date + " " + l.task + "：" + l.memo).join("\n");
  const diaryText = journalRows.map(r => {
    const rd = r.date instanceof Date ? formatDate(r.date) : String(r.date);
    return rd + "：" + r.diary;
  }).join("\n");
  let material = "【時間の記録メモ】\n" + (logsText || "なし") + "\n\n【日記】\n" + (diaryText || "なし");
  if (material.length > 26000) material = material.slice(material.length - 26000);

  const prompt = `以下は${name}さんがJIROKUに書き溜めてきた実際の記録・日記です（すべて本人の言葉）。この蓄積から、${name}さん自身が繰り返し経験している「気づき・傾向・パターン」を抽出して、本人だけの"気づき集"として蒸留してください。

${material}

【抽出のルール】
- 1回きりの出来事ではなく、複数回・繰り返し現れているパターンを優先する
- 良い傾向（うまくいく条件・強み）と、注意すべき傾向（つまずくパターン・悪い癖）の両方をバランスよく
- 抽象的な一般論ではなく、この人の記録から実際に読み取れる固有のものにする
- 各気づきに、本人が「たしかに」と思えるよう記録からの根拠を1つ添える

5〜7個の気づきを、以下のJSON形式のみで返してください（説明文不要）:
{
  "insights": [
    { "title": "<気づきの見出し（15字前後・言い切り）>", "detail": "<どういうことか・どんな時に現れるか（2-3文の話し言葉）>", "evidence": "<記録からの根拠を一言（日付や本人の言葉を含める）>", "type": "<strength か caution>" }
  ]
}`;

  const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    payload: JSON.stringify({ model: "claude-opus-4-8", max_tokens: 2500, messages: [{ role: "user", content: prompt }] }),
    muteHttpExceptions: true
  });
  const result = JSON.parse(res.getContentText()); logAiUsage(result, "気づき");
  const textBlock = result.content && Array.isArray(result.content)
    ? result.content.find(function(b){ return b && typeof b.text === "string"; }) : null;
  if (!textBlock) return { ok: false, error: friendlyClaudeError(res.getContentText()) };
  try {
    const parsed = parseAiJson(textBlock.text);
    if (!parsed) return { ok: false, error: "気づきの解析に失敗しました。もう一度お試しください" };
    const items = parsed.insights || [];
    const sourceCount = logs.length + journalRows.length;
    const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });

    // Insightsシートへupsert
    const sheet = getInsightsSheet();
    const data = sheet.getDataRange().getValues();
    const rowVals = [studentEmail, JSON.stringify(items).slice(0, 40000), sourceCount, now];
    let found = false;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === studentEmail) { sheet.getRange(i + 1, 1, 1, rowVals.length).setValues([rowVals]); found = true; break; }
    }
    if (!found) sheet.appendRow(rowVals);

    return { ok: true, data: { items: items, updatedAt: now, sourceCount: sourceCount } };
  } catch (e) {
    return { ok: false, error: "気づきの解析に失敗しました: " + e.toString() };
  }
}

// 毎月1日に全アクティブユーザーの気づき集を自動更新する（月次バッチ）
function generateAllInsights() {
  sheetToObjects(getSheet("Users")).filter(u => u.is_active.toUpperCase() === "TRUE").forEach(user => {
    try { generateInsightsForUser(user.student_email, false); }
    catch (e) { Logger.log("insights error " + user.student_email + ": " + e); }
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 時間の使い道マップ（セカンドブレイン機能③）
// 記録をAIが自動でテーマ別にクラスタリングし「時間がどのテーマに何時間分かれているか」を
// 可視化する。ユーザーにタグ付けを求めず、ツールが自動でやる（JIROKUの思想に沿う）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function getTimeThemesSheet() {
  let sheet = getSheet("TimeThemes");
  if (!sheet) {
    sheet = SpreadsheetApp.openById(SPREADSHEET_ID).insertSheet("TimeThemes");
    sheet.appendRow(["student_email", "themes_json", "period_days", "total_blocks", "updated_at"]);
  }
  return sheet;
}

function getTimeThemes(studentEmail) {
  if (!getSheet("TimeThemes")) return { ok: true, data: null };
  const row = sheetToObjects(getTimeThemesSheet()).find(r => r.student_email === studentEmail);
  if (!row || !row.themes_json) return { ok: true, data: null };
  let payload = { themes: [], summary: "" };
  try {
    const parsed = JSON.parse(row.themes_json);
    // 保存形式は{themes,summary}。古い配列だけの形式にも一応対応
    if (Array.isArray(parsed)) payload.themes = parsed;
    else { payload.themes = parsed.themes || []; payload.summary = parsed.summary || ""; }
  } catch (e) {}
  return { ok: true, data: { themes: payload.themes, summary: payload.summary, periodDays: Number(row.period_days) || 30, totalBlocks: Number(row.total_blocks) || 0, updatedAt: row.updated_at || "" } };
}

function generateTimeThemesForUser(studentEmail, throttle) {
  const apiKey = PropertiesService.getScriptProperties().getProperty("CLAUDE_API_KEY");
  if (!apiKey) return { ok: false, error: "CLAUDE_API_KEY未設定" };

  if (throttle) {
    const existing = sheetToObjects(getTimeThemesSheet()).find(r => r.student_email === studentEmail);
    if (existing && existing.updated_at) {
      const updated = new Date(existing.updated_at);
      if (!isNaN(updated) && (Date.now() - updated.getTime()) < 6 * 3600 * 1000) {
        let themes = [];
        try { themes = JSON.parse(existing.themes_json); } catch (e) {}
        return { ok: true, throttled: true, data: { themes: themes, periodDays: Number(existing.period_days) || 30, totalBlocks: Number(existing.total_blocks) || 0, updatedAt: existing.updated_at } };
      }
    }
  }

  const periodDays = 30;
  const cutoff = formatDate(new Date(Date.now() - periodDays * 86400000));
  const logs = getFilteredRows("DailyLog", "student_email", studentEmail)
    .filter(l => l.date >= cutoff && l.task && l.task.trim())
    .sort((a, b) => a.date > b.date ? 1 : -1);
  if (logs.length < 8) {
    return { ok: false, error: "まだ分類できるほど記録がありません（現在" + logs.length + "件・直近30日）。記録を続けると、時間の使い道が見えてきます" };
  }
  const totalBlocks = logs.length;

  // タスク名を集計してAIに渡す（メモは長いので、この機能ではタスク名の頻度が主材料）
  const taskCounts = {};
  logs.forEach(l => { const t = String(l.task).trim(); taskCounts[t] = (taskCounts[t] || 0) + 1; });
  const taskList = Object.entries(taskCounts).sort((a, b) => b[1] - a[1])
    .map(function(e){ return e[0] + "（" + e[1] + "時間帯）"; }).join("\n");
  const goalRelated = logs.filter(l => l.goal_related === "true").length;

  const prompt = `以下は、ある人が直近30日間にJIROKUに記録した「時間の使い道」の一覧です（タスク名と、その時間帯数）。合計${totalBlocks}時間帯・うち目標関連${goalRelated}時間帯。

${taskList}

これらを意味のある3〜6個の「テーマ」にグルーピングし、各テーマに何時間帯が費やされているか集計してください。

【ルール】
- 似た活動はまとめる（例：「テレアポ」「商談」「営業リスト作成」→「営業活動」）
- テーマ名は一目で分かる短い名詞（10字前後）
- 各テーマのblocksの合計が全体（${totalBlocks}）とほぼ一致するようにする（端数は最も近いテーマに寄せる）
- 多い順に並べる
- 各テーマに、それが目標に近いか（前進しているか）のひとことコメントを添える

以下のJSON形式のみで返してください（説明文不要）:
{
  "themes": [
    { "name": "<テーマ名>", "blocks": <時間帯数の整数>, "examples": "<含まれる代表的なタスク2-3個>", "comment": "<このテーマへの一言（目標との距離・気づき）>" }
  ],
  "summary": "<時間の使い道全体を1-2文で総括（どこに偏っているか・バランス）>"
}`;

  const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    payload: JSON.stringify({ model: "claude-opus-4-8", max_tokens: 2000, messages: [{ role: "user", content: prompt }] }),
    muteHttpExceptions: true
  });
  const result = JSON.parse(res.getContentText()); logAiUsage(result, "時間テーマ");
  const textBlock = result.content && Array.isArray(result.content)
    ? result.content.find(function(b){ return b && typeof b.text === "string"; }) : null;
  if (!textBlock) return { ok: false, error: friendlyClaudeError(res.getContentText()) };
  try {
    const parsed = parseAiJson(textBlock.text);
    if (!parsed) return { ok: false, error: "分類の解析に失敗しました。もう一度お試しください" };
    const themes = parsed.themes || [];
    if (parsed.summary) themes._summary = parsed.summary; // 保存用に埋め込む
    const payload = { themes: parsed.themes || [], summary: parsed.summary || "" };
    const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });

    const sheet = getTimeThemesSheet();
    const data = sheet.getDataRange().getValues();
    const rowVals = [studentEmail, JSON.stringify(payload).slice(0, 40000), periodDays, totalBlocks, now];
    let found = false;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === studentEmail) { sheet.getRange(i + 1, 1, 1, rowVals.length).setValues([rowVals]); found = true; break; }
    }
    if (!found) sheet.appendRow(rowVals);

    return { ok: true, data: { themes: payload.themes, summary: payload.summary, periodDays: periodDays, totalBlocks: totalBlocks, updatedAt: now } };
  } catch (e) {
    return { ok: false, error: "分類の解析に失敗しました: " + e.toString() };
  }
}

function generateAllTimeThemes() {
  sheetToObjects(getSheet("Users")).filter(u => u.is_active.toUpperCase() === "TRUE").forEach(user => {
    try { generateTimeThemesForUser(user.student_email, false); }
    catch (e) { Logger.log("timeThemes error " + user.student_email + ": " + e); }
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// データの書き出し（セカンドブレイン機能④・データ所有）
// 自分の全記録・日記をMarkdown/CSVで持ち出せる。Obsidian等への移行にも使え、
// 「自分のデータは自分のもの」という信頼につながる。閲覧は本人のみ
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function exportMyData(studentEmail, body) {
  const format = String((body && body.format) || "markdown").toLowerCase();
  const user = sheetToObjects(getSheet("Users")).find(u => u.student_email === studentEmail);
  const name = user ? user.name : studentEmail;

  const logs = getFilteredRows("DailyLog", "student_email", studentEmail)
    .sort((a, b) => (a.date + a.time_block) > (b.date + b.time_block) ? 1 : -1);
  const diaries = getSheet("Journal")
    ? sheetToObjects(getJournalSheet()).filter(r => r.student_email === studentEmail && r.diary && String(r.diary).trim())
        .map(r => ({ date: r.date instanceof Date ? formatDate(r.date) : String(r.date), diary: r.diary }))
        .sort((a, b) => a.date > b.date ? 1 : -1)
    : [];
  const diaryByDate = {};
  diaries.forEach(d => { diaryByDate[d.date] = d.diary; });

  if (format === "csv") {
    // Excel等で開けるよう、ダブルクオートエスケープ＋改行を空白化したCSV
    const esc = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""').replace(/[\r\n]+/g, " ") + '"';
    const rows = [["date", "time_block", "task", "focus_level", "goal_related", "memo"].map(esc).join(",")];
    logs.forEach(l => {
      rows.push([l.date, l.time_block, l.task, l.focus_level, l.goal_related, l.memo].map(esc).join(","));
    });
    return { ok: true, filename: "jiroku_records_" + formatDate(new Date()) + ".csv", mime: "text/csv", content: "﻿" + rows.join("\r\n") };
  }

  // Markdown: 日付ごとに見出し、その日の記録と日記をまとめる
  const byDate = {};
  logs.forEach(l => { if (!byDate[l.date]) byDate[l.date] = []; byDate[l.date].push(l); });
  const allDates = Array.from(new Set(Object.keys(byDate).concat(Object.keys(diaryByDate)))).sort();

  let md = "# " + name + " の記録（JIROKU書き出し）\n\n";
  md += "書き出し日: " + formatDate(new Date()) + " / 記録 " + logs.length + "件・日記 " + diaries.length + "件\n\n";
  allDates.forEach(date => {
    md += "## " + date + "\n\n";
    (byDate[date] || []).sort((a, b) => a.time_block > b.time_block ? 1 : -1).forEach(l => {
      md += "- **" + l.time_block + "** " + (l.task || "") +
        (l.focus_level ? "（" + l.focus_level + (l.goal_related === "true" ? "・目標関連" : "") + "）" : "") + "\n";
      if (l.memo && String(l.memo).trim()) {
        md += "  " + String(l.memo).replace(/\r?\n/g, "\n  ") + "\n";
      }
    });
    if (diaryByDate[date]) {
      md += "\n> 日記: " + String(diaryByDate[date]).replace(/\r?\n/g, "\n> ") + "\n";
    }
    md += "\n";
  });

  return { ok: true, filename: "jiroku_records_" + formatDate(new Date()) + ".md", mime: "text/markdown", content: md };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 過去の自分に問いかける（セカンドブレイン機能）
// 蓄積された記録メモ・日記・レポートから、本人の問いにAIが本人の言葉を引用して答える。
// Obsidian等の受け身な知識庫と違い、JIROKUは能動的に過去を検索して洞察を返せるのが強み
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// AIが返すJSONを頑丈にパースする。AIは文字列値の中に半角ダブルクォート(")や
// 生の改行を混ぜてしまうことがあり、素のJSON.parseだと壊れる。段階的に修復して試す
// AnthropicのAPIエラー本文を、ユーザーに見せる短い日本語メッセージに変換する。
// 生JSON（利用上限・レート制限等）をそのまま画面に出さないための共通処理。
// 生の内容はLogger.logに残して原因調査できるようにする。
function friendlyClaudeError(rawText) {
  const s = String(rawText || "");
  Logger.log("Claude API error raw: " + s.substring(0, 400));
  if (/usage limit|credit balance|billing|regain access|insufficient/i.test(s)) {
    return "ただいまAIの利用が混み合っており、一時的にご利用いただけません。少し時間をおいて再度お試しください🙏";
  }
  if (/rate_limit|overloaded|too many requests|"status":\s*429|"status":\s*529/i.test(s)) {
    return "AIへのアクセスが集中しています。少し待ってから、もう一度お試しください🙏";
  }
  return "AIの処理で一時的な問題が発生しました。もう一度お試しください。";
}

function parseAiJson(rawText) {
  if (!rawText) return null;
  const m = String(rawText).trim().match(/\{[\s\S]*\}/);
  if (!m) return null;
  const s = m[0];
  try { return JSON.parse(s); } catch (e) {}
  // 修復1: 文字列値内の生の改行→\n、タブ→空白、復帰は削除（JSONでは本来エスケープが必要）
  const nl = s.replace(/\r/g, "").replace(/\n/g, "\\n").replace(/\t/g, " ");
  try { return JSON.parse(nl); } catch (e) {}
  // 修復2: 「構造的でない（＝文字列内部の）半角ダブルクォート」を全角”へ寄せる。
  // 直前が { [ , : か、直後が : , } ] のクオートだけを構造的として残し、それ以外は文字列内部とみなす
  try {
    const fixed = nl.replace(/"/g, function(_, offset, str){
      const prev = str.slice(0, offset).replace(/\s+$/, "").slice(-1);
      const next = str.slice(offset + 1).replace(/^\s+/, "").slice(0, 1);
      const isStructural = (prev === "" || prev === "{" || prev === "[" || prev === "," || prev === ":") ||
                           (next === ":" || next === "," || next === "}" || next === "]");
      return isStructural ? "\"" : "”";
    });
    return JSON.parse(fixed);
  } catch (e) {}
  return null;
}

// 「事実ベースのスカウター」= JIROKU人物レポート。日々の行動記録・メモ・レポートから、
// 強み・働き方・価値観・成長曲線を“日付つきの根拠”で示す。人材紹介/HR向けの成果物。
// メンタル・離職リスク等のセンシティブなスコアは出さない（強み側に限定）。
function generateTalentReport(email, targetEmail) {
  if (!verifyAdmin(email) && !verifyCoach(email)) return { ok: false, error: "not authorized" };
  const apiKey = PropertiesService.getScriptProperties().getProperty("CLAUDE_API_KEY");
  if (!apiKey) return { ok: false, error: "CLAUDE_API_KEY未設定" };
  const who = String(targetEmail || "").trim();
  if (!who) return { ok: false, error: "targetEmail required" };
  const user = sheetToObjects(getSheet("Users")).find(u => u.student_email === who);
  if (!user) return { ok: false, error: "user not found" };
  const name = user.name || "本人";
  const goals = effectiveGoalsText(user.student_email, user);

  const cutoff = formatDate(new Date(Date.now() - 180 * 86400000));
  const logs = getFilteredRows("DailyLog", "student_email", who)
    .filter(l => l.date >= cutoff && l.memo && l.memo.trim())
    .sort((a, b) => a.date > b.date ? 1 : -1);
  const reports = getFilteredRows("Reports", "student_email", who)
    .filter(r => r.date >= cutoff)
    .sort((a, b) => a.date > b.date ? 1 : -1);
  if (logs.length === 0 && reports.length === 0) return { ok: false, error: "記録がまだ少なく、人物レポートを作れません" };

  let logsText = logs.map(l => l.date + " " + (l.time_block || "") + " " + l.task + "：" + l.memo).join("\n");
  const reportsText = reports.map(r => r.date + " スコア" + r.score + "／良かった点:" + (r.highlights || "") + "／改善:" + (r.improvement || "") + (r.trend ? "／傾向:" + r.trend : "")).join("\n");
  // トークン上限に収める（新しい記録を優先して残す）
  if (logsText.length > 22000) logsText = logsText.slice(logsText.length - 22000);

  const prompt = "あなたは人材アセスメントの専門家です。以下は" + name + "さんがJIROKU（時間の使い方を毎日記録する習慣アプリ）に書き溜めた“実際の行動記録”です。アンケートの自己申告ではなく、日々の事実の積み重ねです。これを根拠に、企業の人事が読む『行動アセスメント帳票』を作ってください。\n\n"
    + "【目標】" + (goals || "未設定") + "\n\n"
    + "【日々の記録メモ（時系列・本人の言葉）】\n" + (logsText || "なし") + "\n\n"
    + "【AIレポートの推移（成長の軌跡）】\n" + (reportsText || "なし") + "\n\n"
    + "【厳守事項】\n"
    + "- 必ず記録の中の“事実（日付・本人の言葉・行動）”を根拠にする。記録にないことは推測で断定しない。\n"
    + "- メンタルヘルス・離職リスク・病気などセンシティブな判定は一切書かない。強み・働き方・価値観・成長・適性に絞る。\n"
    + "- 盛らない。実際の行動が示す範囲で正直に採点する（全部高得点にしない。行動の証拠が弱い尺度は50前後に寄せる）。\n\n"
    + "【採点ルール】各尺度は0〜100の整数。50=一般的な社会人の平均。60超=平均より明確に高い、70超=顕著、80超=傑出（記録に強い証拠がある時のみ）。40未満=平均より低い傾向。"
    + "各尺度に必ずbasis（採点根拠となった行動を1文・可能なら日付に触れる）を付ける。証拠が薄い尺度はconfidenceを low にし、басисにその旨を書く。\n\n"
    + "以下のJSON形式のみで返す（説明不要）。値の引用は「」を使い半角\"は使わない。各値は改行しない：\n"
    + "{\n"
    + '  "headline": "<この人を一言で表す人物像（事実に基づく）>",\n'
    + '  "summary": "<人事向けの総評を3〜4文。行動事実に基づき、この人がどう働きどう成長しているか>",\n'
    + '  "scales": {\n'
    + '    "personality": [\n'
    + '      { "name": "行動性", "low": "落ち着きがある、腰が重い", "high": "行動的、すぐ動く", "score": 50, "confidence": "high|mid|low", "basis": "<採点根拠の行動>" },\n'
    + '      { "name": "社交性", "low": "控えめ、一人を好む", "high": "人と関わることを好む", "score": 50, "confidence": "", "basis": "" },\n'
    + '      { "name": "慎重性", "low": "気さく、大胆", "high": "慎重、丁寧", "score": 50, "confidence": "", "basis": "" },\n'
    + '      { "name": "挑戦性", "low": "堅実、現状維持", "high": "新しいことに挑む", "score": 50, "confidence": "", "basis": "" },\n'
    + '      { "name": "粘り強さ", "low": "切り替えが早い", "high": "こだわり粘り強い", "score": 50, "confidence": "", "basis": "" },\n'
    + '      { "name": "主体性", "low": "周囲と調和、協調的", "high": "自分で決めて動く", "score": 50, "confidence": "", "basis": "" },\n'
    + '      { "name": "決断性", "low": "熟考型、情緒的", "high": "素早く合理的に決める", "score": 50, "confidence": "", "basis": "" }\n'
    + "    ],\n"
    + '    "motivation": [\n'
    + '      { "name": "向上欲求", "def": "自己成長・向上したいという意欲", "score": 50, "confidence": "", "basis": "" },\n'
    + '      { "name": "挑戦欲求", "def": "困難や目標にチャレンジしたいという意欲", "score": 50, "confidence": "", "basis": "" },\n'
    + '      { "name": "自律欲求", "def": "自分の意思で物事に取り組みたいという意欲", "score": 50, "confidence": "", "basis": "" },\n'
    + '      { "name": "探求欲求", "def": "本質や理由を知りたいという意欲", "score": 50, "confidence": "", "basis": "" },\n'
    + '      { "name": "啓発欲求", "def": "他者に良い影響を与えたいという意欲", "score": 50, "confidence": "", "basis": "" },\n'
    + '      { "name": "承認欲求", "def": "役割を果たし認められたいという意欲", "score": 50, "confidence": "", "basis": "" },\n'
    + '      { "name": "エネルギー", "def": "総合的な活動意欲の強さ", "score": 50, "confidence": "", "basis": "" }\n'
    + "    ],\n"
    + '    "ability": [\n'
    + '      { "name": "直観力", "def": "本質を感覚的に捉える力", "score": 50, "confidence": "", "basis": "" },\n'
    + '      { "name": "論理力", "def": "筋道立てて思考し捉える力", "score": 50, "confidence": "", "basis": "" },\n'
    + '      { "name": "実行力", "def": "計画を立てて行動し遂行する力", "score": 50, "confidence": "", "basis": "" },\n'
    + '      { "name": "共感力", "def": "他者の心理や感情を汲み取る力", "score": 50, "confidence": "", "basis": "" }\n'
    + "    ],\n"
    + '    "values": [\n'
    + '      { "name": "公益志向", "def": "人の役に立つことへの価値", "score": 50, "confidence": "", "basis": "" },\n'
    + '      { "name": "成長志向", "def": "能力向上への価値", "score": 50, "confidence": "", "basis": "" },\n'
    + '      { "name": "達成志向", "def": "目標達成・成果への価値", "score": 50, "confidence": "", "basis": "" },\n'
    + '      { "name": "協働志向", "def": "仲間と協力することへの価値", "score": 50, "confidence": "", "basis": "" },\n'
    + '      { "name": "安定志向", "def": "生活・収入の安定への価値", "score": 50, "confidence": "", "basis": "" }\n'
    + "    ],\n"
    + '    "aptitude": [ { "type": "<職務タイプ（例：企画・推進型）>", "score": 50, "reason": "<行動根拠1文>" } ]\n'
    + "  },\n"
    + '  "strengths": [ { "title": "<強みの見出し>", "detail": "<行動パターンでの説明>", "evidence": [ { "date": "<YYYY-MM-DD>", "quote": "<本人の記録の言葉（要約可）>" } ] } ],\n'
    + '  "growth": "<レポート推移や記録から見える成長・変化を2〜3文で>",\n'
    + '  "growth_edges": [ "<伸びしろ/気をつけたい行動の癖を建設的に1文で>" ],\n'
    + '  "fit_hint": "<どんな仕事・環境で力を発揮しやすそうか、事実からの示唆を1〜2文で>"\n'
    + "}\n"
    + "aptitudeは4〜5タイプ（得点順）。strengthsは3〜4個、各evidenceは1〜3件。";

  const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    payload: JSON.stringify({ model: "claude-opus-4-8", max_tokens: 8000, messages: [{ role: "user", content: prompt }] }),
    muteHttpExceptions: true
  });
  const result = JSON.parse(res.getContentText()); logAiUsage(result, "行動アセスメント帳票");
  const textBlock = result.content && Array.isArray(result.content) ? result.content.find(b => b.type === "text") : null;
  if (!textBlock) return { ok: false, error: friendlyClaudeError(res.getContentText()) };
  const parsed = parseAiJson(textBlock.text);
  if (!parsed) return { ok: false, error: "レポートの解析に失敗しました" };

  // 成長トレンド（レポートスコアの推移）はコード側で確定値を渡す（スカウターに無い時系列の武器）
  const trend = reports.map(r => ({ date: r.date, score: Number(r.score) || 0 }));
  // データ信頼性の材料（虚偽回答傾向の代替：行動データの厚み）
  const memoChars = logs.reduce((n, l) => n + String(l.memo || "").length, 0);

  // ★実測の行動統計（AIを介さない生の事実。検査型アセスメントが構造的に持てないデータ）
  const allLogs180 = getFilteredRows("DailyLog", "student_email", who).filter(l => l.date >= cutoff);
  const focusNums = allLogs180.map(l => parseInt(l.focus_level) || 0).filter(n => n > 0);
  const goalCount = allLogs180.filter(l => l.goal_related === "true" || l.goal_related === true).length;
  // 活動の上位（何にいちばん時間を使っているか）
  const taskHours = {};
  allLogs180.forEach(l => { const t = String(l.task || "").trim(); if (t) taskHours[t] = (taskHours[t] || 0) + 1; });
  const topTasks = Object.keys(taskHours).map(k => ({ task: k, blocks: taskHours[k] }))
    .sort((a, b) => b.blocks - a.blocks).slice(0, 6);
  // 時間帯分布（朝型/夜型が事実で見える）
  const buckets = { morning: 0, day: 0, evening: 0, night: 0 }; // 5-9 / 9-18 / 18-24 / 0-5
  allLogs180.forEach(l => {
    const h = parseInt(String(l.time_block || "").slice(0, 2));
    if (isNaN(h)) return;
    if (h >= 5 && h < 9) buckets.morning++;
    else if (h >= 9 && h < 18) buckets.day++;
    else if (h >= 18) buckets.evening++;
    else buckets.night++;
  });
  // 記録の継続性（直近28日のうち何日記録したか＝自己管理の実測）
  const d28 = formatDate(new Date(Date.now() - 27 * 86400000));
  const activeDays28 = new Set(allLogs180.filter(l => l.date >= d28).map(l => l.date)).size;

  // ★有言実行率（企業が最も知りたい「宣言→実行」の実測）。
  // 「今日のフォーカス」で朝宣言した日のうち、達成チェックまで至った日の割合
  let intentDeclared = 0, intentDone = 0;
  if (getSheet("Journal")) {
    sheetToObjects(getJournalSheet()).forEach(row => {
      if (row.student_email !== who) return;
      const rd = row.date instanceof Date ? formatDate(row.date) : String(row.date || "");
      if (rd < cutoff) return;
      if (String(row.intent || "").trim()) {
        intentDeclared++;
        if (String(row.intent_done) === "true") intentDone++;
      }
    });
  }

  const behavior = {
    totalBlocks180: allLogs180.length,
    goalPct: allLogs180.length ? Math.round(goalCount / allLogs180.length * 100) : 0,
    avgFocus: focusNums.length ? Math.round(focusNums.reduce((a, b) => a + b, 0) / focusNums.length * 10) / 10 : null,
    topTasks: topTasks,
    hourBuckets: buckets,
    activeDays28: activeDays28,
    streak: Number(user.streak || 0),
    intentDeclared: intentDeclared,
    intentDone: intentDone,
    intentRate: intentDeclared > 0 ? Math.round(intentDone / intentDeclared * 100) : null
  };

  return {
    ok: true, name: name, goals: goals,
    recordDays: new Set(logs.map(l => l.date)).size,
    recordBlocks: logs.length, memoChars: memoChars,
    reportCount: reports.length, sinceDate: cutoff,
    reportTrend: trend,
    behavior: behavior,
    data: parsed
  };
}

// ガクチカ素材集：日々の記録から、就活で語れるエピソードを
// 「状況→行動→結果→学び」の型で抽出する（日付つき根拠・本人の言葉ベース）。
// 面接でそのまま話せる素材と、自己PRの種を返す。
function generateGakuchika(email, targetEmail) {
  if (!verifyAdmin(email) && !verifyCoach(email)) return { ok: false, error: "not authorized" };
  const apiKey = PropertiesService.getScriptProperties().getProperty("CLAUDE_API_KEY");
  if (!apiKey) return { ok: false, error: "CLAUDE_API_KEY未設定" };
  const who = String(targetEmail || "").trim();
  const user = sheetToObjects(getSheet("Users")).find(u => u.student_email === who);
  if (!user) return { ok: false, error: "user not found" };
  const name = user.name || "本人";

  const cutoff = formatDate(new Date(Date.now() - 180 * 86400000));
  const logs = getFilteredRows("DailyLog", "student_email", who)
    .filter(l => l.date >= cutoff && l.memo && l.memo.trim())
    .sort((a, b) => a.date > b.date ? 1 : -1);
  if (logs.length === 0) return { ok: false, error: "記録がまだ少なく、素材集を作れません" };
  let logsText = logs.map(l => l.date + " " + (l.time_block || "") + " " + l.task + "：" + l.memo).join("\n");
  if (logsText.length > 22000) logsText = logsText.slice(logsText.length - 22000);

  const prompt = "あなたは就活支援のプロのキャリアコーチです。以下は" + name + "さんが習慣アプリJIROKUに日々書き溜めた実際の記録です（すべて本人の言葉・事実）。ここから就活の面接・ESで使える『ガクチカ／自己PRの素材集』を作ってください。\n\n"
    + "【日々の記録（時系列）】\n" + logsText + "\n\n"
    + "【作り方】\n"
    + "- 記録の中から“エピソードとして語れる出来事”を3〜5本選ぶ（挑戦・工夫・継続・協働・失敗からの立て直し等）。\n"
    + "- 各エピソードは面接の王道の型で構造化：状況(Situation)→行動(Action)→結果(Result)→学び(Learning)。\n"
    + "- 必ず記録の事実だけで書く。誇張・創作はしない（事実ベースが最大の武器。面接で深掘りされても本人が話せる内容にする）。\n"
    + "- evidenceに根拠の記録（日付＋本人の言葉）を入れる。\n"
    + "- keywordsは面接官に伝わる強みワード（例：継続力、巻き込み力）を2〜3個。\n"
    + "- self_pr_seedsは、複数エピソードを貫く本人の強みを「私は◯◯な人間です。実際に〜」の書き出しで使える1〜2文の種を2〜3本。\n\n"
    + "以下のJSON形式のみで返す（説明不要）。値の引用は「」を使い半角\"は使わない。各値は改行しない：\n"
    + "{\n"
    + '  "materials": [ { "title": "<エピソードの見出し（15字以内）>", "situation": "<状況1-2文>", "action": "<取った行動1-2文>", "result": "<結果1-2文>", "learning": "<学び1文>", "evidence": [ { "date": "<YYYY-MM-DD>", "quote": "<本人の記録の言葉>" } ], "keywords": ["<強みワード>"] } ],\n'
    + '  "self_pr_seeds": [ "<自己PRの種1-2文>" ]\n'
    + "}";

  // 学生（cohort付き）はSonnet、それ以外はOpus（コスト方針をaskMyPastと統一）
  const model = String(user.cohort || "").trim() ? "claude-sonnet-5" : "claude-opus-4-8";
  const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    payload: JSON.stringify({ model: model, max_tokens: 4000, messages: [{ role: "user", content: prompt }] }),
    muteHttpExceptions: true
  });
  const result = JSON.parse(res.getContentText()); logAiUsage(result, "ガクチカ");
  const textBlock = result.content && Array.isArray(result.content) ? result.content.find(b => b.type === "text") : null;
  if (!textBlock) return { ok: false, error: friendlyClaudeError(res.getContentText()) };
  const parsed = parseAiJson(textBlock.text);
  if (!parsed || !Array.isArray(parsed.materials)) return { ok: false, error: "素材集の解析に失敗しました" };
  return { ok: true, name: name, recordDays: new Set(logs.map(l => l.date)).size, sinceDate: cutoff, data: parsed };
}

function askMyPast(studentEmail, body) {
  const apiKey = PropertiesService.getScriptProperties().getProperty("CLAUDE_API_KEY");
  if (!apiKey) return { ok: false, error: "CLAUDE_API_KEY未設定" };
  const question = String(body.question || "").trim();
  if (!question) return { ok: false, error: "質問を入力してください" };
  // 全記録を毎回読み込む高コスト機能のため回数制限（6時間で8回＝1日実質20回超）
  if (aiCapExceeded("askMyPast", studentEmail, 8)) {
    return { ok: false, error: "たくさん使ってくれてありがとうございます🙏 少し時間を置いてからまた質問してください（利用回数の上限に達しました）" };
  }

  // 全期間のメモ付きログ＋日記を素材にする（記録が膨大な人向けに直近180日を上限）
  const cutoff = formatDate(new Date(Date.now() - 180 * 86400000));
  const user = sheetToObjects(getSheet("Users")).find(u => u.student_email === studentEmail);
  const name = user ? user.name : "あなた";

  const logs = getFilteredRows("DailyLog", "student_email", studentEmail)
    .filter(l => l.date >= cutoff && l.memo && l.memo.trim())
    .sort((a, b) => a.date > b.date ? 1 : -1);
  const journalRows = getSheet("Journal")
    ? sheetToObjects(getJournalSheet()).filter(r => {
        const rd = r.date instanceof Date ? formatDate(r.date) : String(r.date);
        return r.student_email === studentEmail && rd >= cutoff && r.diary && r.diary.trim();
      }).sort((a, b) => {
        const ad = a.date instanceof Date ? formatDate(a.date) : String(a.date);
        const bd = b.date instanceof Date ? formatDate(b.date) : String(b.date);
        return ad > bd ? 1 : -1;
      })
    : [];

  if (logs.length === 0 && journalRows.length === 0) {
    return { ok: false, error: "まだ振り返りの材料になる記録がありません。メモ付きで記録を続けると、過去の自分に問いかけられるようになります" };
  }

  const logsText = logs.map(l => l.date + " " + l.time_block + " " + l.task + "：" + l.memo).join("\n");
  const diaryText = journalRows.map(r => {
    const rd = r.date instanceof Date ? formatDate(r.date) : String(r.date);
    return rd + "：" + r.diary;
  }).join("\n");

  // 素材が長くなりすぎる場合に備え、プロンプト全体をトークン上限内に収める（末尾＝古い方から間引かず、新しい方を優先して残す）
  let material = "【時間の記録メモ（時系列）】\n" + (logsText || "なし") + "\n\n【日記】\n" + (diaryText || "なし");
  if (material.length > 24000) material = material.slice(material.length - 24000);

  const prompt = `あなたは${name}さん専用のパーソナルコーチAIです。${name}さんが自分自身の過去の記録に問いかけてきました。以下は${name}さんがこれまでJIROKUに書き溜めてきた実際の記録・日記です（すべて本人の言葉）。

${material}

【質問】
${question}

【回答の作り方】
- 上の記録の中から根拠になる箇所を必ず具体的に引用する（日付と本人の言葉をそのまま使う）。記録にないことは推測で断定しない
- 単なる要約ではなく、パターン・傾向・変化・繰り返している気づきを見つけて示す（例：「〇〇な時にうまくいっている」「△△の前はいつも□□になりがち」）
- 最後に、その気づきを踏まえた前向きな一言か、試す価値のある小さな提案を添える
- 親しみのある話し言葉で、3〜6文程度。宛名・挨拶は不要

以下のJSON形式のみで返してください（説明文不要）:
{
  "answer": "<本人の記録を引用しながらの回答（話し言葉）>",
  "evidence": [ { "date": "<YYYY-MM-DD>", "quote": "<引用した本人の言葉（要約可）>" } ],
  "insight": "<この問いから見えた、本人が意識するとよい一番のポイントを1文で>"
}
evidenceは根拠にした記録を1〜4件。
【重要・JSONを壊さないための厳守事項】値の中で引用する時は必ずカギ括弧「」を使い、半角のダブルクォート(")は絶対に使わないこと。各値は改行を入れず1行で書くこと。`;

  // 本人の人生データを扱う中核体験なので、他機能のHaikuより上位のモデルを使う。
  // ただしコスト最適化のため、学生（cohortタグ付き）はSonnetにする（十分な品質で単価は約半分）。
  // 有料クライアント等（cohortなし）は最上位のOpusのままにする。
  const askModel = (user && String(user.cohort || "").trim()) ? "claude-sonnet-5" : "claude-opus-4-8";
  const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    payload: JSON.stringify({ model: askModel, max_tokens: 1500, messages: [{ role: "user", content: prompt }] }),
    muteHttpExceptions: true
  });
  const result = JSON.parse(res.getContentText()); logAiUsage(result, "過去に聞く");
  // content配列から確実にテキストブロックを拾う（thinkingブロック等が先頭に来ても壊れないように）
  const textBlock = result.content && Array.isArray(result.content)
    ? result.content.find(function(b){ return b && typeof b.text === "string"; }) : null;
  if (!textBlock) return { ok: false, error: friendlyClaudeError(res.getContentText()) };
  const parsed = parseAiJson(textBlock.text);
  if (!parsed) return { ok: false, error: "回答の解析に失敗しました。もう一度お試しください" };
  return { ok: true, data: parsed, sourceCount: { logs: logs.length, diary: journalRows.length } };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SNSコンテンツのネタ出し（専用ページ content/ 用。全生徒には出さない機能）
// 蓄積された記録メモ・日記から、実際の出来事に基づいたリール台本/投稿ネタを
// AIが提案する。既存生徒アプリとは切り離し、専用ページからこのAPI群だけを叩く。
// 将来Kai以外も使う想定のため、初回に「ヒアリング」としてプラットフォーム・
// ジャンル・ターゲット・トーンをContentProfileシートに保存し、生成時のコンテキストにする
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function getContentProfileSheet() {
  let sheet = getSheet("ContentProfile");
  if (!sheet) {
    sheet = SpreadsheetApp.openById(SPREADSHEET_ID).insertSheet("ContentProfile");
    sheet.appendRow(["student_email", "platforms", "niche", "audience", "tone", "goal", "updated_at"]);
  }
  return sheet;
}

function getContentProfile(studentEmail) {
  const row = sheetToObjects(getContentProfileSheet()).find(r => r.student_email === studentEmail);
  if (!row) return { ok: true, data: null };
  return { ok: true, data: {
    platforms: row.platforms ? row.platforms.split(",") : [],
    niche: row.niche || "", audience: row.audience || "", tone: row.tone || "", goal: row.goal || ""
  } };
}

function saveContentProfile(studentEmail, body) {
  const sheet = getContentProfileSheet();
  const data = sheet.getDataRange().getValues();
  const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  const platforms = Array.isArray(body.platforms) ? body.platforms.join(",") : String(body.platforms || "");
  const row = [studentEmail, platforms, body.niche || "", body.audience || "", body.tone || "", body.goal || "", now];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === studentEmail) {
      sheet.getRange(i + 1, 1, 1, row.length).setValues([row]);
      return { ok: true };
    }
  }
  sheet.appendRow(row);
  return { ok: true };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SNS運用ダッシュボード（sns/ ページ用）
// フェーズ1: アカウント登録＋日次数値の手入力＋推移表示。
// 将来Meta/YouTube等のAPI連携（フェーズ2）に置き換わっても、
// SnsMetricsシートの形はそのまま使える設計にしている
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const SNS_OPS_PLATFORMS = ["instagram", "threads", "tiktok", "youtube"];

function getSnsAccountsSheet() {
  let sheet = getSheet("SnsAccounts");
  if (!sheet) {
    sheet = SpreadsheetApp.openById(SPREADSHEET_ID).insertSheet("SnsAccounts");
    sheet.appendRow(["student_email", "platform", "handle", "url", "created_at"]);
  }
  return sheet;
}

function getSnsMetricsSheet() {
  let sheet = getSheet("SnsMetrics");
  if (!sheet) {
    sheet = SpreadsheetApp.openById(SPREADSHEET_ID).insertSheet("SnsMetrics");
    sheet.appendRow(["date", "student_email", "platform", "followers", "reach", "impressions", "likes", "comments", "saves", "posts", "memo", "updated_at"]);
  }
  return sheet;
}

function snsListAccounts(studentEmail) {
  const rows = sheetToObjects(getSnsAccountsSheet()).filter(r => r.student_email === studentEmail);
  return { ok: true, data: rows.map(r => ({ platform: r.platform, handle: r.handle, url: r.url })) };
}

function snsSaveAccount(studentEmail, body) {
  const platform = String(body.platform || "");
  if (SNS_OPS_PLATFORMS.indexOf(platform) === -1) return { ok: false, error: "不明なプラットフォーム" };
  const sheet = getSnsAccountsSheet();
  const data = sheet.getDataRange().getValues();
  const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === studentEmail && String(data[i][1]) === platform) {
      sheet.getRange(i + 1, 3).setValue(body.handle || "");
      sheet.getRange(i + 1, 4).setValue(body.url || "");
      return { ok: true };
    }
  }
  sheet.appendRow([studentEmail, platform, body.handle || "", body.url || "", now]);
  return { ok: true };
}

function snsDeleteAccount(studentEmail, body) {
  const sheet = getSnsAccountsSheet();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === studentEmail && String(data[i][1]) === String(body.platform)) {
      sheet.deleteRow(i + 1);
      return { ok: true };
    }
  }
  return { ok: false, error: "アカウントが見つかりません" };
}

// 日次の数値を保存（同じ日×同じプラットフォームなら上書き＝後から修正できる）
function snsSaveMetrics(studentEmail, body) {
  const platform = String(body.platform || "");
  const date = String(body.date || formatDate(new Date()));
  if (SNS_OPS_PLATFORMS.indexOf(platform) === -1) return { ok: false, error: "不明なプラットフォーム" };
  const sheet = getSnsMetricsSheet();
  const data = sheet.getDataRange().getValues();
  const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  const num = v => (v === undefined || v === null || v === "") ? "" : Number(v);
  const rowVals = [date, studentEmail, platform,
    num(body.followers), num(body.reach), num(body.impressions),
    num(body.likes), num(body.comments), num(body.saves), num(body.posts),
    body.memo || "", now];
  for (let i = 1; i < data.length; i++) {
    const rowDate = data[i][0] instanceof Date ? Utilities.formatDate(data[i][0], "Asia/Tokyo", "yyyy-MM-dd") : String(data[i][0]);
    if (String(data[i][1]) === studentEmail && String(data[i][2]) === platform && rowDate === date) {
      sheet.getRange(i + 1, 1, 1, rowVals.length).setValues([rowVals]);
      sheet.getRange(i + 1, 1).setNumberFormat("@").setValue(date);
      return { ok: true, updated: true };
    }
  }
  const newRow = sheet.getLastRow() + 1;
  sheet.appendRow(rowVals);
  sheet.getRange(newRow, 1).setNumberFormat("@").setValue(date);
  return { ok: true };
}

function snsGetMetrics(studentEmail, body) {
  const days = Number(body.days) || 30;
  const cutoff = formatDate(new Date(Date.now() - days * 86400000));
  const platform = body.platform ? String(body.platform) : null;
  const rows = sheetToObjects(getSnsMetricsSheet())
    .filter(r => {
      const rd = r.date instanceof Date ? Utilities.formatDate(r.date, "Asia/Tokyo", "yyyy-MM-dd") : String(r.date);
      return r.student_email === studentEmail && rd >= cutoff && (!platform || r.platform === platform);
    })
    .map(r => ({
      date: r.date instanceof Date ? Utilities.formatDate(r.date, "Asia/Tokyo", "yyyy-MM-dd") : String(r.date),
      platform: r.platform,
      followers: r.followers !== "" ? Number(r.followers) : null,
      reach: r.reach !== "" ? Number(r.reach) : null,
      impressions: r.impressions !== "" ? Number(r.impressions) : null,
      likes: r.likes !== "" ? Number(r.likes) : null,
      comments: r.comments !== "" ? Number(r.comments) : null,
      saves: r.saves !== "" ? Number(r.saves) : null,
      posts: r.posts !== "" ? Number(r.posts) : null,
      memo: r.memo || ""
    }))
    .sort((a, b) => a.date > b.date ? 1 : -1);
  return { ok: true, data: rows };
}

// 投稿ログ: 1本ごとの投稿（フック・テーマ・成績）を記録する。
// 「どの投稿が伸びたか」をAIが分析してネタ提案に反映するための土台。
// フェーズ2でAPI連携したら、このシートに自動で書き込まれる形に置き換わる
function getSnsPostsSheet() {
  let sheet = getSheet("SnsPosts");
  if (!sheet) {
    sheet = SpreadsheetApp.openById(SPREADSHEET_ID).insertSheet("SnsPosts");
    sheet.appendRow(["post_id", "student_email", "platform", "posted_at", "hook", "theme", "url", "views", "likes", "comments", "saves", "follows_gained", "memo", "updated_at"]);
  }
  return sheet;
}

function snsListPosts(studentEmail, body) {
  if (!getSheet("SnsPosts")) return { ok: true, data: [] };
  const platform = body && body.platform ? String(body.platform) : null;
  const rows = sheetToObjects(getSnsPostsSheet())
    .filter(r => r.student_email === studentEmail && (!platform || r.platform === platform))
    .map(r => ({
      postId: r.post_id, platform: r.platform,
      postedAt: r.posted_at instanceof Date ? Utilities.formatDate(r.posted_at, "Asia/Tokyo", "yyyy-MM-dd") : String(r.posted_at),
      hook: r.hook || "", theme: r.theme || "", url: r.url || "",
      views: r.views !== "" ? Number(r.views) : null,
      likes: r.likes !== "" ? Number(r.likes) : null,
      comments: r.comments !== "" ? Number(r.comments) : null,
      saves: r.saves !== "" ? Number(r.saves) : null,
      followsGained: r.follows_gained !== "" ? Number(r.follows_gained) : null,
      memo: r.memo || ""
    }))
    .sort((a, b) => b.postedAt > a.postedAt ? 1 : -1);
  return { ok: true, data: rows };
}

function snsSavePost(studentEmail, body) {
  const sheet = getSnsPostsSheet();
  const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  const num = v => (v === undefined || v === null || v === "") ? "" : Number(v);
  const postId = String(body.postId || "") || Utilities.getUuid().substring(0, 8);
  const rowVals = [postId, studentEmail, String(body.platform || ""),
    String(body.postedAt || formatDate(new Date())),
    body.hook || "", body.theme || "", body.url || "",
    num(body.views), num(body.likes), num(body.comments), num(body.saves), num(body.followsGained),
    body.memo || "", now];
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === postId && String(data[i][1]) === studentEmail) {
      sheet.getRange(i + 1, 1, 1, rowVals.length).setValues([rowVals]);
      return { ok: true, updated: true, postId: postId };
    }
  }
  sheet.appendRow(rowVals);
  return { ok: true, postId: postId };
}

function snsDeletePost(studentEmail, body) {
  const sheet = getSnsPostsSheet();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(body.postId) && String(data[i][1]) === studentEmail) {
      sheet.deleteRow(i + 1);
      return { ok: true };
    }
  }
  return { ok: false, error: "投稿が見つかりません" };
}

// 過去投稿の成績をAIプロンプト用にまとめる（generateSnsIdeasから使う）。
// 「どのテーマ・フックが伸びたか」を成績付きで渡し、勝ちパターンの分析材料にする
function buildSnsPostsContext(studentEmail) {
  try {
    if (!getSheet("SnsPosts")) return "";
    const posts = snsListPosts(studentEmail, {}).data.slice(0, 30);
    if (posts.length === 0) return "";
    const lines = posts.map(p => {
      const stats = [];
      if (p.views !== null) stats.push("再生/リーチ" + p.views);
      if (p.likes !== null) stats.push("いいね" + p.likes);
      if (p.comments !== null) stats.push("コメント" + p.comments);
      if (p.saves !== null) stats.push("保存" + p.saves);
      if (p.followsGained !== null) stats.push("フォロー増" + p.followsGained);
      return p.postedAt + " [" + p.platform + "] 「" + (p.hook || p.theme) + "」" +
        (p.theme && p.hook ? "（テーマ: " + p.theme + "）" : "") +
        (stats.length ? " → " + stats.join("・") : " → 成績未入力") +
        (p.memo ? "（メモ: " + p.memo + "）" : "");
    });
    return "\n【過去の投稿と成績（最重要の分析材料。伸びた投稿のテーマ・フックの型を分析し、その勝ちパターンに寄せること。既に投稿済みの内容と同じネタは避けること）】\n" + lines.join("\n");
  } catch (e) { return ""; }
}

// ━━━ SNS数値の自動取得（フェーズ2） ━━━
// 毎日夜に全登録アカウントの数値をAPIから取得してSnsMetricsに書き込む。
// YouTube: YT_API_KEYスクリプトプロパティがあれば公開統計を自動取得（審査不要）
// Instagram/Threads: Meta開発者アプリの審査通過後にトークンを設定して有効化する（現状スタブ）
// TikTok: 開発者審査の通過後に有効化（現状スタブ）
function snsAutoFetchAll() {
  if (!getSheet("SnsAccounts")) return;
  sheetToObjects(getSnsAccountsSheet()).forEach(a => {
    try {
      if (a.platform === "youtube") snsFetchYoutubeStats(a);
      // instagram / threads / tiktok は各APIの審査・トークン設定後にここへ追加する
    } catch (e) { Logger.log("snsAutoFetch error (" + a.student_email + "/" + a.platform + "): " + e); }
  });
}

function snsFetchYoutubeStats(account) {
  const key = PropertiesService.getScriptProperties().getProperty("YT_API_KEY");
  if (!key) return; // キー未設定なら手入力運用のまま
  const channelId = resolveYoutubeChannelId(account, key);
  if (!channelId) { Logger.log("YouTubeチャンネル特定失敗: " + account.handle + " / " + account.url); return; }
  const res = UrlFetchApp.fetch("https://www.googleapis.com/youtube/v3/channels?part=statistics&id=" + channelId + "&key=" + key, { muteHttpExceptions: true });
  const data = JSON.parse(res.getContentText());
  const stats = data.items && data.items[0] && data.items[0].statistics;
  if (!stats) { Logger.log("YouTube統計取得失敗: " + res.getContentText().substring(0, 200)); return; }
  // 公開統計で取れるのは登録者数・累計再生数・動画本数。リーチ等の詳細は
  // 本人のOAuth（Analytics API）が必要なため、フェーズ2bで対応する
  snsSaveMetrics(account.student_email, {
    platform: "youtube",
    date: formatDate(new Date()),
    followers: Number(stats.subscriberCount || 0),
    impressions: Number(stats.viewCount || 0),
    posts: Number(stats.videoCount || 0),
    memo: "API自動取得（登録者・累計再生・本数）"
  });
  Logger.log("YouTube自動取得OK: " + account.student_email + " subscribers=" + stats.subscriberCount);
}

// チャンネルURL(channel/UC…)・@ハンドルURL・ハンドル名のみ、の3形式からチャンネルIDを解決する
function resolveYoutubeChannelId(account, key) {
  const url = String(account.url || "");
  let m = url.match(/channel\/(UC[\w-]+)/);
  if (m) return m[1];
  const handleMatch = url.match(/@([\w.\-]+)/) || String(account.handle || "").match(/@?([\w.\-]+)/);
  const handle = handleMatch ? handleMatch[1] : null;
  if (!handle) return null;
  const res = UrlFetchApp.fetch("https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=" + encodeURIComponent("@" + handle) + "&key=" + key, { muteHttpExceptions: true });
  const data = JSON.parse(res.getContentText());
  return data.items && data.items[0] ? data.items[0].id : null;
}

// 直近のSNS数値をAIプロンプト用のテキストにまとめる（generateSnsIdeasから使う）。
// 数値の伸び・停滞を踏まえた台本提案ができるようにするための連携ポイント
function buildSnsMetricsContext(studentEmail) {
  try {
    if (!getSheet("SnsMetrics")) return "";
    const rows = snsGetMetrics(studentEmail, { days: 14 }).data;
    if (rows.length === 0) return "";
    const lines = rows.map(r => {
      const parts = [];
      if (r.followers !== null) parts.push("フォロワー" + r.followers);
      if (r.reach !== null) parts.push("リーチ" + r.reach);
      if (r.impressions !== null) parts.push("インプレッション" + r.impressions);
      if (r.likes !== null) parts.push("いいね" + r.likes);
      if (r.comments !== null) parts.push("コメント" + r.comments);
      if (r.saves !== null) parts.push("保存" + r.saves);
      return r.date + " [" + r.platform + "] " + parts.join("・") + (r.memo ? "（メモ: " + r.memo + "）" : "");
    });
    return "\n【直近14日のSNS実績（数値の伸び・停滞を踏まえて、伸びている型に寄せた提案をすること）】\n" + lines.join("\n");
  } catch (e) { return ""; }
}

// プラットフォームごとに最適な出力形式が異なる（動画=台本、テキスト=そのまま投稿できる文章）ため、
// AIへの指示とレスポンス形式を出し分ける
const SNS_PLATFORM_INFO = {
  reels:    { label: "Instagramリール", format: "video" },
  tiktok:   { label: "TikTok", format: "video" },
  shorts:   { label: "YouTube Shorts", format: "video" },
  threads:  { label: "Threads", format: "text" },
  x:        { label: "X（旧Twitter）", format: "text" },
  post:     { label: "Instagram通常投稿（画像+キャプション）", format: "image" },
};

function generateSnsIdeas(studentEmail, body) {
  const apiKey = PropertiesService.getScriptProperties().getProperty("CLAUDE_API_KEY");
  if (!apiKey) return { ok: false, error: "CLAUDE_API_KEY未設定" };

  const days = Number(body.days) || 30;
  const cutoff = formatDate(new Date(Date.now() - days * 86400000));
  const count = Math.min(20, Math.max(1, Number(body.count) || 5));
  // 毎日投稿すると同じ日の記録から何度もネタを作ってしまうため、フロント側で
  // 「使用済みの元ネタ日付」をlocalStorageに記憶して渡してもらい、ここで除外する
  const excludeDates = String(body.excludeDates || "").split(",").map(s => s.trim()).filter(Boolean);

  const logs = getFilteredRows("DailyLog", "student_email", studentEmail)
    .filter(l => l.date >= cutoff && l.memo && l.memo.trim() && excludeDates.indexOf(l.date) === -1)
    .sort((a, b) => a.date > b.date ? 1 : -1);

  const journalRows = getSheet("Journal")
    ? sheetToObjects(getJournalSheet()).filter(r => r.student_email === studentEmail).sort((a, b) => {
        const ad = a.date instanceof Date ? formatDate(a.date) : String(a.date);
        const bd = b.date instanceof Date ? formatDate(b.date) : String(b.date);
        return ad > bd ? 1 : -1;
      })
    : [];
  const diaryEntries = journalRows.filter(r => {
    const rd = r.date instanceof Date ? formatDate(r.date) : String(r.date);
    return rd >= cutoff && r.diary && r.diary.trim() && excludeDates.indexOf(rd) === -1;
  });

  if (logs.length === 0 && diaryEntries.length === 0) {
    return { ok: false, error: "この期間には未使用の記録・日記がありません（期間を広げるか、使用済みネタをリセットしてください）" };
  }

  const platformKey = SNS_PLATFORM_INFO[body.platform] ? body.platform : "reels";
  const platform = SNS_PLATFORM_INFO[platformKey];

  // ヒアリング内容（プロフィール）があれば、そのジャンル・ターゲット・トーンを踏まえて生成する
  const profileRow = sheetToObjects(getContentProfileSheet()).find(r => r.student_email === studentEmail);
  const profileText = profileRow
    ? `【この人の発信プロフィール】\nジャンル: ${profileRow.niche || "未設定"}\nターゲット層: ${profileRow.audience || "未設定"}\nトーン: ${profileRow.tone || "未設定"}\n発信の目的: ${profileRow.goal || "未設定"}`
    : "";

  const logsText = logs.map(l => l.date + " " + l.time_block + " " + l.task + "：" + l.memo).join("\n");
  const diaryText = diaryEntries.map(r => {
    const rd = r.date instanceof Date ? formatDate(r.date) : String(r.date);
    return rd + "：" + r.diary;
  }).join("\n");

  const outputSpec = platform.format === "text"
    ? `各ネタについて:
- hook: 冒頭の一文（スクロールを止める具体的な事実・数字）
- angle: どんな切り口で語るか（失敗談／気づき／習慣化のコツ／数字の変化など）
- post_text: ${platform.label}にそのまま投稿できる完成テキスト（改行を含む、150〜400文字程度）
- source: どの記録・日記の内容を元にしたネタか（日付と要約）

以下のJSON形式のみで返してください（説明文不要）:
{ "ideas": [ { "hook": "...", "angle": "...", "post_text": "...", "source": "..." } ] }`
    : platform.format === "image"
    ? `各ネタについて:
- hook: 投稿の第一印象を決める一文
- angle: どんな切り口で語るか
- visual_idea: どんな写真・画像を使うと良いか（具体的に）
- caption_idea: 投稿につけるキャプション案（2〜4文、ハッシュタグは含めない）
- source: どの記録・日記の内容を元にしたネタか（日付と要約）

以下のJSON形式のみで返してください（説明文不要）:
{ "ideas": [ { "hook": "...", "angle": "...", "visual_idea": "...", "caption_idea": "...", "source": "..." } ] }`
    : `各ネタについて:
- hook: 冒頭3秒で惹きつける一言（具体的な数字や意外性のある事実を使う）
- angle: どんな切り口で語るか（失敗談／気づき／習慣化のコツ／数字の変化など）
- script_beats: 話す流れを3〜4個の箇条書きで（各箇条は1文、独立して意味が通るように）
- caption_idea: 投稿につけるキャプションの案（2〜3文、ハッシュタグは含めない）
- source: どの記録・日記の内容を元にしたネタか（日付と要約）

以下のJSON形式のみで返してください（説明文不要）:
{ "ideas": [ { "hook": "...", "angle": "...", "script_beats": ["...", "..."], "caption_idea": "...", "source": "..." } ] }`;

  const prompt = `以下は本人が直近${days}日間にJIROKUアプリへ書いた「行動の記録メモ」と「日記」です。これらは全て実際に起きた出来事・本人の言葉です。
${profileText}
${buildSnsPostsContext(studentEmail)}
${buildSnsMetricsContext(studentEmail)}

【記録メモ（時間帯ごとの振り返り）】
${logsText || "なし"}

【日記】
${diaryText || "なし"}

【依頼】
この人が「${platform.label}」で発信するためのネタを${count}個、上記の実際の記録から具体的に拾って提案してください。
一般論やテンプレート的なネタではなく、実際に書かれた出来事・数字・感情の動きを起点にすること。
発信プロフィールが設定されている場合は、そのジャンル・ターゲット・トーンに合わせること。
毎日1本ずつ投稿する前提のため、${count}個は互いに切り口が重ならないようにすること（同じ出来事を使う場合も、違う角度から語ること）。

${outputSpec}`;

  const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    // SNSコンテンツは公開物として質が直接見える成果物のため、他機能のHaikuより
    // 上位のOpusを使う（コスト差は無視できる規模の個人利用のため許容）
    payload: JSON.stringify({ model: "claude-opus-4-8", max_tokens: 3500, messages: [{ role: "user", content: prompt }] }),
    muteHttpExceptions: true
  });

  const rawText = res.getContentText();
  const result = JSON.parse(rawText);
  if (!result.content || !result.content[0]) {
    return { ok: false, error: "APIエラー: " + rawText.substring(0, 300) };
  }
  try {
    const parsed = parseAiJson(result.content[0].text);
    if (!parsed) return { ok: false, error: "生成結果の解析に失敗しました。もう一度お試しください" };
    return {
      ok: true, data: parsed.ideas || [],
      format: platform.format, platformLabel: platform.label,
      sourceCount: { logs: logs.length, diary: diaryEntries.length }
    };
  } catch (e) {
    return { ok: false, error: "JSONパースエラー: " + e.toString() };
  }
}

// レポート一覧画面の「時間の使い方」サマリー。直近14日の記録から
// 1日平均の記録量・平均集中・目標関連の割合・よく時間を使っていることを集計する
// ══════════════════════════════════════════════════════════════════
// レポート画面のまとめ取得（2026-08-05 Kaiの「読み込みが遅い」報告）
//
//   Apps Scriptのウェブアプリは、中身が空の呼び出しでも1回およそ2.5秒かかる
//   （302リダイレクトで接続が2回発生するため）。実測して分かった。
//   レポート画面はこれまで7回呼んでいて、しかも
//   「一覧を取る → 最新日が決まる → その日の中身を取る」の2段階直列だった。
//   つまり中身が軽くても最低5秒待たされる。呼び出しの数そのものを減らす。
//
//   ・getReportHome   … 一覧＋週次＋月次＋時間の使い方（4回 → 1回）
//   ・getReportDetail … その日のレポート＋記録＋新レポート（3回 → 1回）
// ══════════════════════════════════════════════════════════════════
// ★ロードマップのまとめ取得★（2026-08-05 起動高速化）
//   GASは同じ人からの同時リクエストを順番に処理するので、
//   呼び出しの本数がそのまま待ち時間になる。2本を1本にする。
function getRoadmap(studentEmail) {
  const out = { ok: true };
  try { out.sprints = getSprints(studentEmail, {}); } catch (e) { out.sprints = null; }
  try { const g = getGoalTree(studentEmail); out.goalTree = (g && g.ok) ? g.data : null; }
  catch (e) { out.goalTree = null; }
  return out;
}

function getReportHome(studentEmail) {
  const out = { ok: true };
  // 1つ落ちても画面全体を落とさない（レポートは出るのに月次で失敗、等を避ける）
  try { out.list = (getReportList(studentEmail) || {}).data || []; } catch (e) { out.list = []; }
  try { out.weekly = (getWeeklySummary(studentEmail) || {}).data || null; } catch (e) { out.weekly = null; }
  try { out.monthly = (getMonthlyReview(studentEmail) || {}).data || null; } catch (e) { out.monthly = null; }
  try { out.timeUse = (getTimeUseSummary(studentEmail) || {}).data || null; } catch (e) { out.timeUse = null; }
  return out;
}

function getReportDetail(studentEmail, body) {
  const date = String((body && body.date) || "").slice(0, 10);
  if (!date) return { ok: false, error: "no date" };
  const out = { ok: true, date: date };
  try { out.report = (getReport(studentEmail, { date: date }) || {}).data || null; } catch (e) { out.report = null; }
  try { out.logs = (getLogs(studentEmail, { date: date }) || {}).data || []; } catch (e) { out.logs = []; }
  try {
    const o = getDailyOpsReport(studentEmail, { date: date });
    out.ops = (o && o.ok && o.data) ? o : null;
  } catch (e) { out.ops = null; }
  return out;
}

function getTimeUseSummary(studentEmail) {
  // ★14日分の「時間の内訳」にする★（2026-08-05 Kai要望）
  //   これまでは記録の「件数」だけを見ていて、何に時間を使った2週間だったのかが
  //   分からなかった。記録タブの「今日の時間の内訳」と同じ形（分類ごとの時間）を
  //   直近14日ぶんで出す。数え方も画面・夜のレポートとそろえる
  //   （実測が無ければ時間帯の長さ。実測のある記録は1,724件中8件しかないため、
  //    実測だけを数えるとほぼ全部0分になってしまう）。
  const cutoff = formatDate(new Date(Date.now() - 14 * 86400000));
  const logs = getFilteredRows("DailyLog", "student_email", studentEmail)
    .filter(l => String(l.date).slice(0, 10) >= cutoff && !String(l.deleted_at || "").trim());
  if (logs.length === 0) return { ok: true, data: null };

  const minsOf = function (l) {
    const am = Number(l.actual_minutes);
    return am > 0 ? am : timeBlockMinutes(l.time_block);
  };
  const days = new Set(logs.map(l => String(l.date).slice(0, 10))).size;
  const focusNums = logs.map(l => parseInt(l.focus_level) || 0).filter(n => n > 0);

  let total = 0, measured = 0, classifiedMin = 0, unclassifiedMin = 0, classifiedCount = 0;
  const byClass = {};
  logs.forEach(function (l) {
    const m = minsOf(l);
    total += m;
    if (Number(l.actual_minutes) > 0) measured += m;
    // ★今の分類に無い値は「未分類」として数える★（2026-08-05）
    //   以前は空でなければ何でも「分類済み」に数えていたため、昔の分類が
    //   入った記録が内訳に出ないまま、割合だけ埋まって見えていた。
    const k0 = String(l.time_classification || "");
    const k = TIME_CLASSES[k0] ? k0 : "";
    if (k) { classifiedCount++; classifiedMin += m; byClass[k] = (byClass[k] || 0) + m; }
    else unclassifiedMin += m;
  });

  // 何に時間を使ったか（分類なしのときの手がかりとして残す）
  const taskMin = {};
  logs.forEach(l => { const t = String(l.task || "").trim(); if (t) taskMin[t] = (taskMin[t] || 0) + minsOf(l); });
  const topTasks = Object.entries(taskMin).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(entry => ({ task: entry[0], minutes: entry[1], hours: Math.round(entry[1] / 60 * 10) / 10 }));

  return { ok: true, data: {
    period_days: 14,
    from: cutoff,
    days,
    logs: logs.length,
    avgBlocksPerDay: Math.round(logs.length / days * 10) / 10,
    avgFocus: focusNums.length ? Math.round(focusNums.reduce((a, b) => a + b, 0) / focusNums.length * 10) / 10 : null,
    total_minutes: total,
    measured_minutes: measured,
    unclassified_minutes: unclassifiedMin,
    classified_pct: total > 0 ? Math.round(classifiedMin / total * 100) : 0,
    classified_count_pct: logs.length > 0 ? Math.round(classifiedCount / logs.length * 100) : 0,
    by_class: byClass,
    // 目標に直結した割合。分類が半分以上入っていれば分類で、そうでなければ
    // 従来どおり goal_related で出す（採点エンジンと同じ切り替え方）
    goalPct: total > 0
      ? (classifiedMin / total >= 0.5
          ? Math.round((byClass.GOAL_DIRECT || 0) / total * 100)
          : Math.round(logs.filter(l => l.goal_related === "true" || l.goal_related === true)
                           .reduce((a, l) => a + minsOf(l), 0) / total * 100))
      : 0,
    goal_source: total > 0 && classifiedMin / total >= 0.5 ? "CLASSIFICATION" : "GOAL_RELATED",
    topTasks
  } };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LINE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 句点・感嘆符の後に改行を入れて読みやすくする
function formatForLine(text) {
  if (!text) return text;
  return text
    .replace(/。(?!\n)/g, '。\n')
    .replace(/！(?!\n)/g, '！\n')
    .replace(/？(?!\n)/g, '？\n')
    .replace(/[!?](?!\n)/g, m => m + '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// 朝・夜・毎時の自動メッセージをMessagesシートに記録する。
// これを記録しないと getRecentCoachMessages が常に空を返し、プロンプトの
// 「直近のメッセージと被らないように」という指示が効かず、毎回似た文面に
// なってしまう（実際に「まずは1つ記録してみようか」が数時間おきに繰り返された）
function logCoachMessage(studentEmail, content) {
  try {
    const sheet = getSheet("Messages");
    const msgId = "msg_" + Date.now();
    const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
    sheet.appendRow([msgId, studentEmail, content, "コーチ", "", "coach", now, "false"]);
  } catch (e) { Logger.log("logCoachMessage error: " + e); }
}

// 直近N件のLINEメッセージ（コーチ→生徒）を取得して繰り返し防止に使う。
// preloadedMessagesを渡せばMessagesシートの再読み込みをスキップする
function getRecentCoachMessages(studentEmail, limit, preloadedMessages) {
  limit = limit || 5;
  const allMsgs = preloadedMessages || sheetToObjects(getSheet("Messages")).filter(m => m.student_email === studentEmail);
  const msgs = allMsgs
    .filter(m => m.sender_role === "coach")
    .sort((a, b) => b.message_id > a.message_id ? 1 : -1)
    .slice(0, limit)
    .map(m => m.content);
  return msgs.length > 0 ? "【直近のコーチメッセージ（これと被らないようにする）】\n" + msgs.join("\n---\n") : "";
}

// Claudeが生成した宛名行（「〇〇へ」「〇〇さん、」など）を除去する
function stripSalutation(text) {
  if (!text) return text;
  let lines = text.split('\n');
  while (lines.length > 0 && lines[0].trim() === '') lines.shift();

  // ケース0: 冒頭の「挨拶だけの行」「絵文字だけの行」を除去。
  // 固定ヘッダー側で挨拶を付けるため、AI本文側の挨拶は重複になる
  // （プロンプトで禁止していてもAIが書いてしまうことがある）
  while (lines.length > 0) {
    const t = lines[0].trim();
    const isGreeting = /^(おはよう(ございます)?|こんにちは|こんばんは|お疲れ様です?|お疲れさまです?|おつかれさまです?|やっほー?|ハロー)[！!？?。～〜ー♪☀🌅✨\s]*$/.test(t);
    const isEmojiOnly = t.length > 0 && t.length <= 4 && !/[ぁ-んァ-ヶ一-龠a-zA-Z0-9]/.test(t);
    if (!isGreeting && !isEmojiOnly) break;
    lines.shift();
    while (lines.length > 0 && lines[0].trim() === '') lines.shift();
  }

  let first = (lines[0] || '').trim();

  // ケース1: 短い行（30文字未満）で「へ」「さんへ」「さん、」「さん,」で終わるなら宛名のみの行として除去
  if (first.length < 30 && /(へ$|さんへ$|くんへ$|ちゃんへ$|さん[、,]$|さん$)/.test(first)) {
    lines.shift();
  }
  // ケース2: 短い行（40文字未満）が「：」「:」で終わる場合、内容によらず見出し・ラベル行として除去
  //（「〇〇へのメッセージ案：」「メッセージ案：」等、自然な会話文はコロンで終わらないため）
  else if (first.length < 40 && /[:：]\s*$/.test(first)) {
    lines.shift();
  }
  // ケース3: 「〇〇さん、」が行頭にある場合（名前+さん+読点で始まる）は名前部分だけ削る
  else {
    const salutationInline = first.match(/^.{1,15}さん[、,]\s*/);
    if (salutationInline) {
      lines[0] = first.slice(salutationInline[0].length);
      if (!lines[0].trim()) lines.shift();
    }
  }

  while (lines.length > 0 && lines[0].trim() === '') lines.shift();
  return lines.join('\n').trim();
}

// 送信結果を必ず確認してログに残す。muteHttpExceptions:trueだけだと
// レート制限・無料枠超過・ブロック等での失敗が完全に無音で握りつぶされ、
// 「送信にムラがある」原因の切り分けが一切できなくなるため
// レポート・コーチメッセージ以外の「時間帯系」通知（記録リマインダー・朝の予定通知など）向け。
// プッシュ通知を有効化済み(fcm_token あり)の生徒にはプッシュ、それ以外は今まで通りLINEに送る。
// LINEはレポート・コーチメッセージ専用にして通数を抑える狙い
function notifyUserTimeSlot(user, pushTitle, pushBody, lineText) {
  if (user.fcm_token) {
    const r = sendFcmPushDetailed(user.fcm_token, pushTitle, pushBody);
    if (r.ok) return true;
  }
  if (user.line_user_id) { sendLineMessage(user.line_user_id, lineText); return true; }
  return false;
}

// 送信直前の安全網：実際の送信時刻に合わない冒頭の挨拶（夜なのに「おはよう」等）を必ず除去する。
// AIが指示に反して時間帯外の挨拶を書いても、送信時刻を正として補正する（時間軸の最終チェック）。
// 時間帯に合った挨拶（朝の「おはよう」等）はそのまま残す。
function stripMismatchedGreeting(text, hour) {
  if (!text) return text;
  const okMorning = hour >= 5 && hour < 10;   // おはよう
  const okDay     = hour >= 10 && hour < 17;  // こんにちは
  const okEvening = hour >= 17 || hour < 5;   // こんばんは（夕〜深夜）
  // 冒頭（絵文字・記号・空白を挟んでも）にある挨拶語を判定
  return text.replace(
    /^([\s　🌅☀️🌞🌙✨、,.。！!]*)((?:おはよう(?:ございます)?|こんにちは|こんばんは)(?:さん)?)([、,.。！!\s　〜～ー♪]*)/,
    function (m, pre, greet) {
      let ok = false;
      if (/^おはよう/.test(greet)) ok = okMorning;
      else if (greet.indexOf("こんにちは") === 0) ok = okDay;
      else if (greet.indexOf("こんばんは") === 0) ok = okEvening;
      // 時間帯に合っていれば元のまま。合っていなければ、先頭の装飾ごと挨拶を丸ごと削除して本文から始める
      return ok ? m : "";
    }
  );
}

// ★画像を送る★（2026-08-05）
//   LINEの画像は公開URL（https）でしか送れない。GitHub Pages に置いたものを指す。
//   originalContentUrl は10MBまで、previewImageUrl は1MBまで。
function sendLineImage(lineUserId, imageUrl, previewUrl) {
  if (!lineUserId || !LINE_CHANNEL_TOKEN || !imageUrl) return false;
  try {
    const res = UrlFetchApp.fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + LINE_CHANNEL_TOKEN },
      payload: JSON.stringify({ to: lineUserId, messages: [
        { type: "image", originalContentUrl: imageUrl, previewImageUrl: previewUrl || imageUrl }
      ]}),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) {
      Logger.log("LINE画像送信失敗 " + res.getResponseCode() + " " + res.getContentText());
      return false;
    }
    return true;
  } catch (e) { Logger.log("LINE画像送信例外 " + e); return false; }
}

function sendLineMessage(lineUserId, text) {
  if (!lineUserId || !LINE_CHANNEL_TOKEN) return false;
  // 送信時刻に合わない挨拶は必ず取り除いてから送る
  text = stripMismatchedGreeting(text, new Date().getHours());
  try {
    const res = UrlFetchApp.fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + LINE_CHANNEL_TOKEN },
      payload: JSON.stringify({ to: lineUserId, messages: [{ type: "text", text: text }] }),
      muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    if (code !== 200) {
      Logger.log("LINE送信失敗 code=" + code + " lineUserId=" + lineUserId + " body=" + res.getContentText());
      return false;
    }
    return true;
  } catch (e) {
    Logger.log("LINE送信例外 lineUserId=" + lineUserId + " error=" + e.toString());
    return false;
  }
}

function notifyCoachOnMessage(studentEmail, studentName, content) {
  const user = sheetToObjects(getSheet("Users")).find(u => u.student_email === studentEmail);
  if (!user || !user.coach_line_id) return;
  sendLineMessage(user.coach_line_id, "💬 " + studentName + "さんからメッセージ：\n\n\"" + content.substring(0, 100) + "\"");
}

function notifyCoachOnReport(user, report) {
  if (!user.coach_line_id) return;
  sendLineMessage(user.coach_line_id, "📊 " + user.name + "さんの本日のスコア：" + report.score + "点\n\n良かった点：" + report.highlights + "\n改善点：" + report.improvement);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ユーティリティ
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function _pad2(n){ return n < 10 ? "0" + n : "" + n; }
function rowToObject(row, headers) {
  const obj = {};
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    const v = row[i];
    if (v instanceof Date) {
      if (v.getFullYear() === 1899) {
        // 時刻のみのセル（1899-12-30基準）。従来どおりローカル時刻をそのまま使う
        obj[h] = _pad2(v.getHours()) + ":" + _pad2(v.getMinutes());
      } else {
        // 以前は Date セルごとに toLocaleString + Utilities.formatDate の2つの重い
        // GAS呼び出しをしており、DailyLog全読み(約4600セル)で3秒近くかかっていた。
        // 日本標準時は通年 UTC+9 固定なので、UTCへ+9時間ずらして各フィールドを読むだけで
        // Asia/Tokyo の壁時計と完全に一致する（結果は従来と同一・スクリプトのTZにも依存しない）。
        const t = new Date(v.getTime() + 32400000); // +9h
        const y = t.getUTCFullYear(), mo = _pad2(t.getUTCMonth() + 1), d = _pad2(t.getUTCDate());
        const hh = t.getUTCHours(), mm = t.getUTCMinutes();
        obj[h] = (hh || mm)
          ? (y + "-" + mo + "-" + d + " " + _pad2(hh) + ":" + _pad2(mm))
          : (y + "-" + mo + "-" + d);
      }
    }
    else { obj[h] = v !== undefined && v !== null ? String(v) : ""; }
  }
  return obj;
}

// 読み取り専用のまとめ処理（getHomeData等）中だけ有効になる、実行内のシート読取キャッシュ。
// 同じ実行の中で同じシートを何度もgetDataRange()で読み直すのが遅さの主因のため、
// 有効中は1シート1回だけ読む。書き込みを伴う処理では絶対に有効にしないこと
// （書いた直後の読み直しが古いままになるため）。
var _sheetReadCacheOn = false, _sheetReadCache = {};
function sheetToObjects(sheet) {
  var key = null;
  if (_sheetReadCacheOn && sheet) {
    try { key = sheet.getName(); } catch (e) { key = null; }
    if (key && _sheetReadCache[key]) return _sheetReadCache[key];
  }
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) { if (key) _sheetReadCache[key] = []; return []; }
  const headers = data[0];
  const out = data.slice(1).map(row => rowToObject(row, headers));
  if (key) _sheetReadCache[key] = out;
  return out;
}

// 指定した列の値で先に絞り込んでから、対象行だけをオブジェクト化する。
// sheetToObjects()でシート全体を毎回フル変換すると、行数（全生徒の履歴）が
// 増えるほど遅くなるため、1人分のデータしか使わない関数はこちらを使う
function getFilteredRows(sheetName, filterColumn, filterValue) {
  // 読取キャッシュ有効中は、キャッシュ済みの全行からフィルタ（シート再読込を省く）
  if (_sheetReadCacheOn) {
    const all = sheetToObjects(getSheet(sheetName));
    return all.filter(function (r) { return String(r[filterColumn]) === String(filterValue); });
  }
  const sheet = getSheet(sheetName);
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  const colIdx = headers.indexOf(filterColumn);
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][colIdx]) !== filterValue) continue;
    rows.push(rowToObject(data[i], headers));
  }
  return rows;
}

function formatDate(date) {
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// セットアップ（初回のみ実行）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Phase 1: 自己経営OS のデータ基盤
// 3か月目標 → 2週間スプリント → 週間目標 → 今日のフォーカス → タスク → 毎時間ログ
// を親子関係でつなぐための土台。既存シートは列を追加するだけで、削除・改名はしない。
// 設計の詳細と決定の経緯は PHASE1_BASELINE.md を参照。
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ══════════════════════════════════════════════════════════════════
// 実績の履歴（2026-08-05 Kai要望）
//
//   これまで3か月目標の「いまの数字」は上書きするだけで、
//   いつ・何で・いくら増えたのかが残らなかった。
//   1件ずつ足していける形にし、あとから編集・削除もできるようにする。
//
//   ★current_value と履歴は必ず一緒に動かす★
//     current_value を「履歴の合計」に置き換えてしまうと、
//     履歴を使う前から手で入れていた数字が消える。
//     そこで current_value は今までどおり正とし、
//     追加・編集・削除のたびに差分だけ足し引きする。
// ══════════════════════════════════════════════════════════════════
const GOAL_ENTRY_CATEGORIES = { SALES:"売上", CONTRACT:"契約", OTHER:"その他" };

function goalEntryBumpCurrent_(studentEmail, goalId, delta) {
  if (!delta) return;
  const row = p1OwnedRow("Goals", "quarterly_goal_id", goalId, studentEmail);
  if (!row) return;
  const cur = Number(row.current_value);
  const next = (isNaN(cur) ? 0 : cur) + Number(delta);
  p1Upsert("Goals", "quarterly_goal_id",
    Object.assign({}, row, { current_value: Math.round(next * 100) / 100 }));
}

function addGoalEntry(studentEmail, body) {
  // 自己経営力は計算に時間がかかるので取っておいている。書き換えたら
  // 古い結果に当たらないよう世代を進める（2026-08-05）。
  smpBumpEpoch_(studentEmail);
  const chk = p1RequireUser(studentEmail);
  if (!chk.ok) return chk;
  const goalId = String((body && body.quarterly_goal_id) || "").trim();
  // ★週間目標のぶんも、ここに入れる★（2026-08-05 Kai指摘）
  //   以前は「＋」で時間の記録(DailyLog)を作っていた。
  //   だが「アポ1件取れた」は時間の記録ではないので、本日の記録に
  //   身に覚えのない行が並んでしまっていた。実績は実績として別に持つ。
  const wGoalId = String((body && body.weekly_goal_id) || "").trim();
  if (wGoalId) {
    const wRow = p1OwnedRow("WeeklyGoals", "weekly_goal_id", wGoalId, studentEmail);
    if (!wRow) return { ok: false, error: "not found" };
    // ★数で数える目標だけ受け付ける★（2026-08-05）
    //   「できた/できていない」や「何日やったか」で数える目標に数を足すと、
    //   記録から数えたぶんと二重になる。画面をすり抜けても入らないようにする。
    const mt2 = normalizeMetricType(wRow.metric_type);
    if (mt2 !== "COUNT" && mt2 !== "DURATION") {
      return { ok: false, error: "この目標は記録から自動で数えます" };
    }
  } else if (!goalId || !p1OwnedRow("Goals", "quarterly_goal_id", goalId, studentEmail)) {
    return { ok: false, error: "not found" };
  }
  const amount = Number(body && body.amount);
  if (isNaN(amount) || amount === 0) return { ok: false, error: "金額を入れてください" };
  const cat = String((body && body.category) || "OTHER").toUpperCase();
  const now = new Date().toISOString();
  const rec = {
    entry_id: makeP1Id("ge"),
    student_email: studentEmail,
    quarterly_goal_id: wGoalId ? "" : goalId,
    weekly_goal_id: wGoalId,
    amount: Math.round(amount * 100) / 100,
    category: GOAL_ENTRY_CATEGORIES[cat] ? cat : "OTHER",
    memo: p1Text_(body && body.memo, 200),
    entry_date: p1Text_((body && body.entry_date) || formatDate(new Date()), 10),
    created_at: now, updated_at: now, deleted_at: ""
  };
  p1Upsert("GoalEntries", "entry_id", rec);
  // 3か月目標のぶんだけ「いまの数字」を動かす。週間目標は集計で拾う
  if (!wGoalId) goalEntryBumpCurrent_(studentEmail, goalId, rec.amount);
  return { ok: true, entry: rec };
}

function listGoalEntries(studentEmail, body) {
  const chk = p1RequireUser(studentEmail);
  if (!chk.ok) return chk;
  const goalId = String((body && body.quarterly_goal_id) || "").trim();
  // ★週間目標の履歴も返す★（2026-08-05）
  //   3か月目標だけ履歴を見られて、今週の目標は見られなかった。
  //   間違えて足したときに、打ち消しで足すしかない状態だった。
  const wGoalId = String((body && body.weekly_goal_id) || "").trim();
  const rows = p1List("GoalEntries", studentEmail)
    .filter(function (r) { return !String(r.deleted_at || "").trim(); })
    .filter(function (r) {
      if (wGoalId) return String(r.weekly_goal_id || "") === wGoalId;
      if (goalId)  return String(r.quarterly_goal_id || "") === goalId;
      return true; })
    .map(function (r) {
      return { entry_id: r.entry_id, quarterly_goal_id: r.quarterly_goal_id,
               weekly_goal_id: r.weekly_goal_id || "",
               amount: Number(r.amount) || 0, category: String(r.category || "OTHER"),
               memo: String(r.memo || ""), entry_date: String(r.entry_date || "").slice(0, 10) }; })
    .sort(function (a, b) { return String(b.entry_date).localeCompare(String(a.entry_date)); });
  return { ok: true, data: rows };
}

function updateGoalEntry(studentEmail, body) {
  // 自己経営力は計算に時間がかかるので取っておいている。書き換えたら
  // 古い結果に当たらないよう世代を進める（2026-08-05）。
  smpBumpEpoch_(studentEmail);
  const chk = p1RequireUser(studentEmail);
  if (!chk.ok) return chk;
  const id = String((body && body.entry_id) || "").trim();
  const row = id ? p1OwnedRow("GoalEntries", "entry_id", id, studentEmail) : null;
  if (!row || String(row.deleted_at || "").trim()) return { ok: false, error: "not found" };
  const amount = Number(body && body.amount);
  if (isNaN(amount) || amount === 0) return { ok: false, error: "金額を入れてください" };
  const before = Number(row.amount) || 0;
  const after = Math.round(amount * 100) / 100;
  const cat = String((body && body.category) || row.category || "OTHER").toUpperCase();
  p1Upsert("GoalEntries", "entry_id", Object.assign({}, row, {
    amount: after, category: GOAL_ENTRY_CATEGORIES[cat] ? cat : "OTHER",
    memo: p1Text_(body && body.memo, 200), updated_at: new Date().toISOString() }));
  goalEntryBumpCurrent_(studentEmail, String(row.quarterly_goal_id), after - before);
  return { ok: true, entry_id: id, amount: after };
}

function deleteGoalEntry(studentEmail, body) {
  // 自己経営力は計算に時間がかかるので取っておいている。書き換えたら
  // 古い結果に当たらないよう世代を進める（2026-08-05）。
  smpBumpEpoch_(studentEmail);
  const chk = p1RequireUser(studentEmail);
  if (!chk.ok) return chk;
  const id = String((body && body.entry_id) || "").trim();
  const row = id ? p1OwnedRow("GoalEntries", "entry_id", id, studentEmail) : null;
  if (!row || String(row.deleted_at || "").trim()) return { ok: false, error: "not found" };
  // 消しても行は残す（あとで「なぜ数字が減ったのか」を追えるようにする）
  p1Upsert("GoalEntries", "entry_id", Object.assign({}, row, {
    deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }));
  goalEntryBumpCurrent_(studentEmail, String(row.quarterly_goal_id), -(Number(row.amount) || 0));
  return { ok: true, entry_id: id };
}


// 新規4シートの列定義。ここを唯一の定義元とし、取得関数が無ければ自動生成する
const P1_SHEETS = {
  // ★実績の履歴★（2026-08-05 Kai要望）
  //   3か月目標の「いまの数字」を上書きするだけだと、
  //   いつ・何で・いくら増えたのかが残らない。1件ずつ足していけるようにする。
  //   current_value は、この履歴の増減とあわせて必ず一緒に動かす。
  GoalEntries: ["entry_id","student_email","quarterly_goal_id","weekly_goal_id","amount","category","memo",
    "entry_date","created_at","updated_at","deleted_at"],
  Goals: ["quarterly_goal_id","student_email","title","category","current_value","target_value","unit",
    "start_date","end_date","why","success_condition","evidence","guardrails","priority","status",
    "created_at","updated_at"],
  Sprints: ["sprint_id","link_quarterly_goal_id","student_email","name","start_date","end_date",
    "bottleneck","target_state","hypothesis","action_metric","result_metric","try_actions","stop_actions",
    "if_then","success_condition","coaching_note","confirmed_at","status","created_at","updated_at"],
  WeeklyGoals: ["weekly_goal_id","link_sprint_id","link_quarterly_goal_id","student_email","title",
    "metric_type","unit","target_total","min_line","std_line","stretch_line","planned_days",
    "actual_value","actual_calculated_at","status","created_at","updated_at"],
  // ★重要度と緊急度は別物★（2026-08-01 追加）
  // priority 1本では「重要だが急がない」を表現できず、いちばん大事な仕事が
  // 常に後回しになる。急ぎの用事に押し流されるのを防ぐのが目的なので、
  // 重要度（本人が決める）と緊急度（期限から自動で決まる）を分ける。
  //
  //   importance_level        HIGH / MEDIUM / LOW ─ 本人が決める。AIは提案止まり
  //   due_at                  期限。日付＋時刻 / 日付のみ / 空（期限なし）
  //   urgency_override        本人が緊急度を上書きしたい時だけ入る
  //   urgency_override_reason 上書きの理由。後から見返すため
  //   first_started_at        最初に着手した時刻。「期限前に着手できたか」を見る
  //   carryover_count         翌日以降へ持ち越した回数。計画の甘さが見える
  //
  // ★urgency_level は保存しない★
  // 時間とともに変わる値を保存すると、due_at と食い違ったまま古い値が残る。
  // 表示のたびに due_at と現在時刻から算出する。
  Tasks: ["task_id","student_email","date","title","priority","link_weekly_goal_id","link_daily_focus_id",
    "estimated_minutes","actual_minutes","status","completed_at","completion_condition","memo",
    "created_at","updated_at",
    "importance_level","due_at","urgency_override","urgency_override_reason",
    "first_started_at","carryover_count","deleted_at","sort_order",
    // ★2026-08-02 追加（Phase 3の同期契約）★
    // version           更新のたびに1増える。競合を黙って上書きしないため
    // updated_at        いつ変わったか
    // last_mutation_id  同じ操作の再送を二重に実行しないため
    // context           何の文脈のタスクか（UNSET/WORK/PERSONAL/LEARNING/HEALTH/OTHER）
    // carried_from      持ち越し元の日付。新しいタスクを複製しない
    // source_type       誰の依頼か（SELF/MANAGER/COLLEAGUE/CLIENT/SYSTEM/OTHER）
    // requested_by      依頼者
    // requested_at      依頼された日時
    "version","last_mutation_id","context",
    "carried_from","source_type","requested_by","requested_at",
    // 旧形式（Journal.actionsのid無しタスク）からの移行の出どころ。
    // 何をどこから移したかを行ごとに残す。監査と巻き戻しに使う
    "migrated_from","source_journal_id","source_action_index","migration_id","migrated_at"],
  // ★AI日次レポート（self_management_daily_v1）★
  //   既存の Reports には手を触れない。列順が固定配列で書かれており、
  //   ランキングもそこを直接読むため、増やすと壊れる危険がある。
  //   一意キー: student_email + report_date + report_version
  DailyOpsReport: ["row_id","student_email","report_date","report_version",
    "operating_state_label","operating_summary","operating_score",
    "previous_day_delta","seven_day_average_delta","progress_items",
    "primary_management_issue","next_action","stop_action","recovery_summary",
    "evaluation_components","evaluation_state","coverage","confidence",
    "calculation_version","prompt_version","input_hash","generated_at",
    "narrative_json","generated_by","fallback_reason","regenerate_count",
    // ★確定★ 夜のトリガーで締めた印。これが入った日はもう計算し直さない
    "finalized_at","snapshot_json",
    "created_at","updated_at"],
  // ★自己経営力（self_mgmt_power_v1）★
  //   1ユーザー × 1週間 × 1指標 ＝ 1行（1人1週で最大5行）
  //   既存の status score とは別レイヤー。XP・ランキング・夜間レポートには繋がない。
  //   所有者キーは student_email（既存のp1List/p1OwnedRow/p1Upsertが
  //   この列名で所有権を絞っているため。owner_emailを新設すると
  //   所有権の仕組みを二重化してしまう）
  // ★1日の設計（DayPlan）★ 1ユーザー1日1行。
  //   day_type … NORMAL（ふつうの日）／REST（休息すると決めた日）／
  //               ADJUSTED（当日に事情があって計画を縮めた日）
  //   available_minutes … その日に使える時間。推測しない（未設定は空のまま）
  DayPlan: ["row_id","student_email","date","day_type","available_minutes",
    "source","reason","created_at","updated_at"],
  // ★DayPlanの変更履歴★ 追記だけ。過去の行は書き換えも削除もしない。
  DayPlanHistory: ["history_id","student_email","date","previous_day_type","new_day_type",
    "previous_available_minutes","new_available_minutes","reason","changed_by","changed_at",
    "change_timing","mutation_id"],
  // ★端末で起きた不具合の記録★
  //   画面側のエラーは、報告を受けるまで誰にも見えなかった（実際に
  //   「今日のフォーカスの画面が無い」に何日も気づけなかった）。
  //   1人1日5件までに絞って、同じ内容はまとめる。
  ClientErrors: ["row_id","student_email","occurred_at","app_build","kind","message",
    "detail","user_agent","viewport","path","count","last_at"],
  // ★XP台帳★ どの記録で何点入ったかを1行ずつ残す。
  //   記録を消したときに、その分だけを正確に戻せるようにするため。
  //   同じ source_id では二重に加算しない。
  XpEvents: ["event_id","student_email","source_type","source_id","amount","reason",
    "created_at","reversed_at","reversal_reason"],
  SelfMgmtPower: ["row_id","student_email","period_start","period_end","key","label",
    "score","evaluation_state","status_label","confidence","coverage","sample_count",
    "calculation_version","calculated_at","input_hash","components","incomplete_reason",
    "created_at","updated_at"]
};
// 既存シートへ追加する列（削除・改名は一切しない）
const P1_ADDED_COLUMNS = {
  // actual_minutes … タイマー等で実際に測った分数。DURATIONの第1優先
  // duration_confirmed … time_block から出した候補を本人が確認して確定したか
  //   （確定していない候補を勝手に足さないための印）
  // time_classification … その時間が経営上どの役割だったか（5分類）。1記録1分類のみ。
  //   Tasks.context（WORK/PERSONAL…＝活動領域）とは別の軸。変換しない。
  // classification_method … USER / RULE / AI。USERはルールで上書きしない
  // classification_reason_code … なぜその分類になったか（LINKED_WEEKLY_GOAL 等）
  DailyLog: ["action_execution_id","quantity","unit","primary_weekly_goal_id","related_goal_ids",
    "link_task_id","deleted_at","actual_minutes","duration_confirmed",
    "time_classification","classification_method","classification_version",
    "classification_reason_code","user_corrected_at"],
  Journal: ["daily_focus_id","focus_completion_condition","focus_min_line","focus_planned_time",
    "focus_if_then","link_weekly_goal_id","focus_achievement_state","focus_miss_reason"],
  Users: ["features","task_migrated_at"]
};

// 新規シートを取得（無ければ列付きで作る）。既存のgetXxxSheet()と同じ流儀
function getP1Sheet(name) {
  let sheet = getSheet(name);
  if (!sheet) {
    sheet = getSpreadsheet().insertSheet(name);
    sheet.appendRow(P1_SHEETS[name]);
    return sheet;
  }
  // ★既存シートにも、あとから増えた列を追加する★
  // P1_SHEETS はシートを新規作成するときにしか使われていなかったため、
  // 定義に列を足しても既存シートには反映されず、
  // 「コードは新しい列を書こうとするのに、シートにその列が無い」
  // という食い違いが起きる（書いたつもりで消えるので気づきにくい）。
  // 末尾へ足すだけ。並べ替えも改名も削除も一切しない。
  try {
    const want = P1_SHEETS[name] || [];
    // 見出し行が無いまま作られてしまったシートを直す（列0のまま読むと例外になる）
    if (want.length && sheet.getLastColumn() < 1) {
      sheet.getRange(1, 1, 1, want.length).setValues([want]);
      return sheet;
    }
    if (want.length) {
      const last = sheet.getLastColumn();
      const headers = last ? sheet.getRange(1, 1, 1, last).getValues()[0] : [];
      const missing = want.filter(c => headers.indexOf(c) === -1);
      if (missing.length) sheet.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
    }
  } catch (e) { Logger.log("getP1Sheet 列追加に失敗: " + name + " / " + e); }
  return sheet;
}
// 既存シートに不足している列を追加する（1回のsetValuesでまとめて書く）
function ensureP1Columns(sheetName) {
  const sheet = getSheet(sheetName);
  if (!sheet) return [];
  const want = P1_ADDED_COLUMNS[sheetName] || [];
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const missing = want.filter(c => headers.indexOf(c) === -1);
  if (missing.length) sheet.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
  return missing;
}

// ── ID生成 ──
// メールをそのままIDに埋めない（長い・個人情報）ため、安定した短縮ハッシュを使う。
// 同じメールからは常に同じ8文字が出る（DB移行後もそのまま使える）
function makeUserKey(email) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(email || "").toLowerCase());
  return bytes.slice(0, 4).map(b => ((b & 0xFF) + 0x100).toString(16).slice(1)).join("");
}
// 実行イベントの冪等キー。saveLogのUpsertキー(email+date+time_block)と一対一で対応するため、
// 同じ入力からは必ず同じIDになり、再送・連打でも重複しない
function makeExecutionId(email, dateStr, timeBlock) {
  return "exec_" + makeUserKey(email) + "_" + String(dateStr) + "_" + String(timeBlock).replace(/[^0-9]/g, "");
}
// makeUserKeyは8文字(32bit)なので理屈の上では衝突しうる。人数が増えたときに
// 黙って別人のIDが混ざると原因究明が困難になるため、衝突を検出できるようにしておく。
// 40人規模ではまず起きないが、起きたら即座に気づける状態にしておくのが目的。
function findUserKeyCollisions() {
  const byKey = {};
  sheetToObjects(getSheet("Users")).forEach(u => {
    const em = String(u.student_email || "").trim();
    if (!em) return;
    (byKey[makeUserKey(em)] = byKey[makeUserKey(em)] || []).push(em);
  });
  return Object.keys(byKey)
    .filter(k => new Set(byKey[k].map(e => e.toLowerCase())).size > 1)
    .map(k => ({ key: k, emails: byKey[k] }));
}

// タスクIDも決定的に作る。移行が途中で失敗して再試行されても同じIDになるよう、
// 連番ではなくタイトル由来のハッシュ＋同名の出現順で構成する。
// ★重要★ この関数を呼ぶのは migrateLocalTasks（localStorageからの一度きりの移行）だけ。
// 一度発行したtask_idはTasksシートに保存され、以後はその値を使い回す。
// タイトルを編集してもIDは作り直さない（作り直すと別タスク扱いになり、
// 記録との紐付け link_task_id が切れてしまうため）。
function makeTaskId(email, dateStr, title, occurrenceIndex) {
  const h = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(title || ""))
    .slice(0, 3).map(b => ((b & 0xFF) + 0x100).toString(16).slice(1)).join("");
  return "task_" + makeUserKey(email) + "_" + String(dateStr) + "_" + h + "_" + (occurrenceIndex || 0);
}
// 新規レコード用の一意ID（目標・スプリント・週間目標・フォーカス）
function makeP1Id(prefix) {
  return prefix + "_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
}

// ── 汎用アクセス層 ──
// UIやAI処理からSpreadsheetAppへ直接依存させないための入口。
// 将来Supabase等へ移行する際は、この2関数の中身だけを差し替えればよい
function p1List(sheetName, studentEmail) {
  const rows = sheetToObjects(getP1Sheet(sheetName));
  return studentEmail ? rows.filter(r => r.student_email === studentEmail) : rows;
}
// idColumn の値が一致する行を更新、無ければ追加する（行番号は外部キーにしない）
function p1Upsert(sheetName, idColumn, record) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getP1Sheet(sheetName);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
    const idIdx = headers.indexOf(idColumn);
    // ★他人の行を上書きしない★
    //   クライアント由来のタスクid（lt_〜）はタイトルと並び順のハッシュなので、
    //   別ユーザーが同じ名前のタスクを作ると同じidになる。idだけで行を探すと
    //   他人の行を乗っ取ってしまう（持ち主ごと書き換わり、相手のタスクが消える）。
    //   record に student_email があれば、持ち主が一致する行だけを更新対象にする。
    const emIdx = headers.indexOf("student_email");
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idIdx]) !== String(record[idColumn])) continue;
      if (emIdx !== -1 && record.student_email !== undefined &&
          String(data[i][emIdx]) !== String(record.student_email)) continue;
      const row = data[i].slice();
      headers.forEach((h, c) => { if (record[h] !== undefined) row[c] = record[h]; });
      if (headers.indexOf("updated_at") !== -1) row[headers.indexOf("updated_at")] = now;
      sheet.getRange(i + 1, 1, 1, headers.length).setValues([row]);
      return { id: record[idColumn], created: false };
    }
    const row = headers.map(h => {
      if (record[h] !== undefined) return record[h];
      if (h === "created_at" || h === "updated_at") return now;
      return "";
    });
    sheet.appendRow(row);
    return { id: record[idColumn], created: true };
  } finally { lock.releaseLock(); }
}

// ══════════════════════════════════════════════════════════════════
// 目標階層のCRUD（Checkpoint 2）
// 3か月目標(Goals) → 週間目標(WeeklyGoals) の2階層。
// ※2週間スプリント(Sprints)はKai合意のうえ後回し。シートだけ先に用意してある。
//
// 【認可の原則】どのAPIも「リクエストのstudentEmail本人の行」しか読み書きできない。
// p1Upsert はID一致だけで更新するため、他人のIDを渡されると上書きできてしまう。
// そこで保存前に必ず「既存行の持ち主が本人か」を確認する（p1OwnedRow）。
// ※このWeb appはメールを信用する構造なので、これは「なりすまし防止」ではなく
//   「別人の行を書き換える経路を作らない」ためのもの。トークン認証は別途。
// ══════════════════════════════════════════════════════════════════

// 機能が有効な本人かを確認する。段階公開のため、features に goals_v1 を持つ人だけ通す
function p1RequireUser(studentEmail) {
  const user = getFilteredRows("Users", "student_email", studentEmail)[0];
  if (!user || String(user.is_active).toUpperCase() !== "TRUE") return { ok: false, error: "invalid user" };
  if (!hasFeature(user, P1_FEATURE_KEY)) return { ok: false, error: "feature not enabled" };
  return { ok: true, user: user };
}

// 指定IDの行を返す。存在しない、または持ち主が違う場合は null（＝他人の行は触れない）
function p1OwnedRow(sheetName, idColumn, id, studentEmail) {
  if (!id) return null;
  const rows = p1List(sheetName, studentEmail);
  return rows.find(r => String(r[idColumn]) === String(id)) || null;
}

const P1_STATUSES = ["ACTIVE", "COMPLETED", "ARCHIVED"];
function p1Status_(v, fallback) {
  const s = String(v || "").toUpperCase();
  return P1_STATUSES.indexOf(s) !== -1 ? s : fallback;
}
// 数値欄。空文字は空のまま残す（0と「未入力」を区別したいため）
function p1Num_(v) {
  if (v === undefined || v === null || String(v).trim() === "") return "";
  const n = Number(v);
  return isNaN(n) ? "" : n;
}
function p1Text_(v, max) {
  return String(v == null ? "" : v).slice(0, max || 500);
}

// 目標階層をまとめて1回で返す。画面表示に必要なものを1リクエストに収める
// （APIを何本も叩くとGASの同時実行待ちで一気に遅くなるため、getHomeDataと同じ方針）
function getGoalTree(studentEmail) {
  const chk = p1RequireUser(studentEmail);
  if (!chk.ok) return chk;

  // 今週の実績をその場で集計して返す（画面が別APIを叩かずに済むように）
  const weekStart = mondayOf(formatDate(new Date()));
  let agg = {};
  try { agg = aggregateWeeklyActual(studentEmail, weekStart); } catch (e) { agg = {}; }

  const today = formatDate(new Date());
  const goals = p1List("Goals", studentEmail)
    .filter(g => p1Status_(g.status, "ACTIVE") !== "ARCHIVED")
    .sort((a, b) => (Number(a.priority) || 99) - (Number(b.priority) || 99))
    .map(g => {
      // 進捗とペースを添える。判定できないときは数字を出さず理由を返す
      const pace = computePace(g.start_date, g.end_date, g.current_value, g.target_value, g.unit, today);
      return Object.assign({}, g, { pace: pace, paceLabel: PACE_STATUS_LABEL[pace.status] || "不明" });
    });
  const weeklies = p1List("WeeklyGoals", studentEmail)
    .filter(w => p1Status_(w.status, "ACTIVE") !== "ARCHIVED");

  // 週間目標を3か月目標の下にぶら下げる。どの目標にも紐づかないものは orphans に入れ、
  // 画面から見えなくなってしまわないようにする
  const byGoal = {};
  const orphans = [];
  weeklies.forEach(w => {
    const k = String(w.link_quarterly_goal_id || "");
    if (k && goals.some(g => String(g.quarterly_goal_id) === k)) (byGoal[k] = byGoal[k] || []).push(w);
    else orphans.push(w);
  });

  // 週間目標に「今週どこまで進んだか」を付ける。
  // 達成の判定は最低ライン(min_line)を超えたかどうかを基準にする
  // （調子が悪い週でも最低ラインを超えれば continue 扱いにできるようにするため）
  const withProgress = (w) => {
    const a = agg[String(w.weekly_goal_id)] || { actual: 0, logCount: 0, entryCount: 0, recordCount: 0 };
    const recCount = (a.recordCount !== undefined) ? a.recordCount : (a.logCount || 0);
    const target = Number(w.target_total);
    const min = Number(w.min_line);
    // ★今週のペース★ 残り日数と、1日あたりあとどれだけ要るか。
    //   未入力と0を区別する（未入力なら「まだ記録がない」と言う）
    const today = formatDate(new Date());
    const sunday = (function(){ const d=new Date(weekStart+"T00:00:00Z"); d.setUTCDate(d.getUTCDate()+6);
                                return d.toISOString().substring(0,10); })();
    const daysLeft = Math.max(0, Math.round(
      (new Date(sunday+"T00:00:00+09:00") - new Date(today+"T00:00:00+09:00")) / 86400000) + 1);
    const elapsed = 7 - daysLeft + 1;
    const std = Number(w.std_line);
    const goalLine = (!isNaN(std) && std > 0) ? std : target;
    const hasGoal = !isNaN(goalLine) && goalLine > 0;
    return Object.assign({}, w, {
      actual_value: a.actual,
      log_count: a.logCount,
      percent: (!isNaN(target) && target > 0) ? Math.min(999, Math.round(a.actual / target * 100)) : null,
      met_min: (!isNaN(min) && min > 0) ? a.actual >= min : null,
      week_start: weekStart, week_end: sunday,
      days_left: daysLeft, days_elapsed: Math.max(1, Math.min(7, elapsed)),
      remaining_to_std: hasGoal ? Math.max(0, Math.round((goalLine - a.actual) * 10) / 10) : null,
      remaining_to_stretch: (!isNaN(Number(w.stretch_line)) && Number(w.stretch_line) > 0)
        ? Math.max(0, Math.round((Number(w.stretch_line) - a.actual) * 10) / 10) : null,
      required_per_day: (hasGoal && daysLeft > 0)
        ? Math.round((goalLine - a.actual) / daysLeft * 10) / 10 : null,
      actual_per_day: recCount > 0
        ? Math.round(a.actual / Math.max(1, Math.min(7, elapsed)) * 10) / 10 : null,
      // 記録が1件も無い＝未入力。0件達成として扱わない
      has_records: recCount > 0,
      // 数えなかった候補（数量・実測が未入力のぶん）。画面で「数えていません」と伝える
      pending_unconfirmed: a.pendingUnconfirmed || 0,
      confidence: recCount === 0 ? "NONE" : (elapsed >= 4 ? "MEDIUM" : "LOW"),
      link_state: (String(w.link_sprint_id||"").trim() || String(w.link_quarterly_goal_id||"").trim())
        ? "LINKED" : "UNLINKED"
    });
  };

  return {
    ok: true,
    data: {
      weekStart: weekStart,
      goals: goals.map(g => ({
        quarterly_goal_id: g.quarterly_goal_id,
        title: g.title, category: g.category,
        current_value: g.current_value, target_value: g.target_value, unit: g.unit,
        start_date: g.start_date, end_date: g.end_date,
        why: g.why, success_condition: g.success_condition, guardrails: g.guardrails,
        priority: g.priority, status: p1Status_(g.status, "ACTIVE"),
        evidence: g.evidence,
        // ★進捗とペース★ 上で計算していたのに、ここで拾い忘れていて
        //   画面には何も出せていなかった（数字が消えるだけで理由も出なかった）
        pace: g.pace, paceLabel: g.paceLabel,
        // 現在値の出どころ。本人が入れた値なのか、記録から集計した値なのかを区別する。
        // いまは本人入力のみ。DailyLog集計や外部連携を足すときにここを分ける
        current_value_source: (g.current_value === "" || g.current_value === null ||
                               g.current_value === undefined) ? "NONE" : "USER_ENTERED",
        weeklyGoals: (byGoal[String(g.quarterly_goal_id)] || []).map(withProgress)
      })),
      orphanWeeklyGoals: orphans.map(withProgress)
    }
  };
}

// 3か月目標の作成・更新。quarterly_goal_id があれば更新、無ければ新規
function saveGoal(studentEmail, body) {
  const chk = p1RequireUser(studentEmail);
  if (!chk.ok) return chk;

  const id = String(body.quarterly_goal_id || "").trim();
  if (id && !p1OwnedRow("Goals", "quarterly_goal_id", id, studentEmail)) {
    return { ok: false, error: "not found" }; // 他人の行・存在しない行は触らせない
  }
  const title = p1Text_(body.title, 120).trim();
  if (!title) return { ok: false, error: "目標のタイトルを入力してください" };
  // 1人あたりの上限。3か月で追える数には限りがあるし、行の量産も防げる
  if (!id && p1List("Goals", studentEmail).filter(g => p1Status_(g.status, "ACTIVE") === "ACTIVE").length >= 10) {
    return { ok: false, error: "3か月目標は10件までです。使わないものを完了/保留にしてください" };
  }

  const rec = {
    quarterly_goal_id: id || makeP1Id("goal"),
    student_email: studentEmail, // ★常にリクエスト本人。bodyの値は使わない
    title: title,
    category: p1Text_(body.category, 40),
    current_value: p1Num_(body.current_value),
    target_value: p1Num_(body.target_value),
    unit: p1Text_(body.unit, 20),
    start_date: p1Text_(body.start_date, 10),
    end_date: p1Text_(body.end_date, 10),
    why: p1Text_(body.why, 1000),
    success_condition: p1Text_(body.success_condition, 1000),
    guardrails: p1Text_(body.guardrails, 1000),
    priority: p1Num_(body.priority) === "" ? 3 : p1Num_(body.priority),
    status: p1Status_(body.status, "ACTIVE")
  };
  const r = p1Upsert("Goals", "quarterly_goal_id", rec);
  return { ok: true, id: r.id, created: r.created };
}

// 週間目標の作成・更新。3か月目標に紐づける（紐づけ先も本人のものか確認する）
function saveWeeklyGoal(studentEmail, body) {
  const chk = p1RequireUser(studentEmail);
  if (!chk.ok) return chk;

  const id = String(body.weekly_goal_id || "").trim();
  if (id && !p1OwnedRow("WeeklyGoals", "weekly_goal_id", id, studentEmail)) {
    return { ok: false, error: "not found" };
  }
  const title = p1Text_(body.title, 120).trim();
  if (!title) return { ok: false, error: "週間目標のタイトルを入力してください" };

  // 紐づけ先の3か月目標。他人の目標にはぶら下げられない
  let link = String(body.link_quarterly_goal_id || "").trim();
  if (link && !p1OwnedRow("Goals", "quarterly_goal_id", link, studentEmail)) {
    return { ok: false, error: "紐づけ先の3か月目標が見つかりません" };
  }
  // ★親のスプリント★ Sprint UI ができたので繋げる。
  //   スプリントを選んだら、その親の3か月目標を自動で引き継ぐ
  //   （画面で2回選ばせない。取り違えも防ぐ）
  const sprintId = String(body.link_sprint_id || "").trim();
  if (sprintId) {
    const sp = p1OwnedRow("Sprints", "sprint_id", sprintId, studentEmail);
    if (!sp) return { ok: false, error: "紐づけ先のスプリントが見つかりません" };
    if (!link) link = String(sp.link_quarterly_goal_id || "");
  }
  if (!id && p1List("WeeklyGoals", studentEmail).filter(w => p1Status_(w.status, "ACTIVE") === "ACTIVE").length >= 30) {
    return { ok: false, error: "週間目標は30件までです" };
  }

  // metric_type は大文字4種に統一（2026-08-01）。
  //   COUNT    回数。正の quantity があるときだけ加算する
  //   DURATION 分数。actual_minutes → quantity の順。time_block は自動加算しない
  //   DAYS     やった日数。同じ日に何件記録しても1日
  //   BOOLEAN  やったか。本人が完了にした時だけ達成
  // 小文字の旧表記（count/minutes/boolean）も受け取って変換する。
  const mt = normalizeMetricType(body.metric_type);

  const rec = {
    weekly_goal_id: id || makeP1Id("wg"),
    student_email: studentEmail, // ★常にリクエスト本人
    link_quarterly_goal_id: link,
    link_sprint_id: sprintId,
    title: title,
    metric_type: mt,
    unit: p1Text_(body.unit, 20),
    target_total: p1Num_(body.target_total),
    min_line: p1Num_(body.min_line),
    std_line: p1Num_(body.std_line),
    stretch_line: p1Num_(body.stretch_line),
    planned_days: p1Text_(body.planned_days, 60),
    status: p1Status_(body.status, "ACTIVE")
  };
  const r = p1Upsert("WeeklyGoals", "weekly_goal_id", rec);
  // ★親がないものは黙って通さない★ 保存はするが「未接続」と伝え、
  //   上位目標への集計対象外であることを画面で言えるようにする
  const unlinked = !sprintId && !link;
  return { ok: true, id: r.id, created: r.created,
           linkState: unlinked ? "UNLINKED" : "LINKED",
           note: unlinked ? "3か月目標にもスプリントにも紐づいていません（設定未完了・上位目標の進捗集計の対象外です）" : "" };
}

// 削除は行を消さず status を変えるだけ（記録から参照されているIDが宙に浮かないように）。
// kind: "goal" | "weekly"
function archiveGoalItem(studentEmail, body) {
  const chk = p1RequireUser(studentEmail);
  if (!chk.ok) return chk;

  const kind = String(body.kind || "").trim();
  const status = p1Status_(body.status, "ARCHIVED");
  if (kind === "goal") {
    const row = p1OwnedRow("Goals", "quarterly_goal_id", body.quarterly_goal_id, studentEmail);
    if (!row) return { ok: false, error: "not found" };
    p1Upsert("Goals", "quarterly_goal_id", { quarterly_goal_id: row.quarterly_goal_id, status: status });
    // ぶら下がっている週間目標も一緒に片付ける（親だけ消えて子が残らないように）
    if (status === "ARCHIVED") {
      p1List("WeeklyGoals", studentEmail)
        .filter(w => String(w.link_quarterly_goal_id) === String(row.quarterly_goal_id))
        .forEach(w => p1Upsert("WeeklyGoals", "weekly_goal_id", { weekly_goal_id: w.weekly_goal_id, status: "ARCHIVED" }));
    }
    return { ok: true };
  }
  if (kind === "weekly") {
    const row = p1OwnedRow("WeeklyGoals", "weekly_goal_id", body.weekly_goal_id, studentEmail);
    if (!row) return { ok: false, error: "not found" };
    p1Upsert("WeeklyGoals", "weekly_goal_id", { weekly_goal_id: row.weekly_goal_id, status: status });
    return { ok: true };
  }
  return { ok: false, error: "invalid kind" };
}

// 目標の取得元をここ1箇所に集約する。
// goals_v1 が有効な人は Goals シート（3か月目標）を正とし、無効な人は従来どおり
// Users の goal/goal2/goal3 を使う。階層をまだ1つも入れていない間は従来の目標に戻すので、
// 切り替えた瞬間にAIコーチ・レポート・独り言の整形が「目標なし」になることはない。
function effectiveGoals(studentEmail, user) {
  const legacy = [
    { goal: String((user && user.goal) || ""),  deadline: String((user && user.goal_deadline) || "") },
    { goal: String((user && user.goal2) || ""), deadline: String((user && user.goal_deadline2) || "") },
    { goal: String((user && user.goal3) || ""), deadline: String((user && user.goal_deadline3) || "") }
  ].filter(g => g.goal);
  if (!hasFeature(user, P1_FEATURE_KEY)) return legacy;
  try {
    const rows = p1List("Goals", studentEmail)
      .filter(g => String(g.status || "ACTIVE").toUpperCase() === "ACTIVE")
      .sort((a, b) => (Number(a.priority) || 99) - (Number(b.priority) || 99));
    if (!rows.length) return legacy;
    return rows.map(g => ({
      goal: String(g.title || "") + ((g.target_value !== "" && g.target_value != null)
        ? "（目標 " + g.target_value + String(g.unit || "") + "）" : ""),
      deadline: String(g.end_date || "")
    })).filter(g => g.goal);
  } catch (e) { return legacy; } // シート未作成などでも既存機能を止めない
}
function effectiveGoalsText(studentEmail, user) {
  return effectiveGoals(studentEmail, user).map(g => g.goal).join(" / ");
}

// ARCHIVED の目標・週間目標を物理削除する（検証データの後始末用）。
// ARCHIVED は本来「実ユーザーの履歴」を残すための状態なので、消す前に必ず
// 参照件数を確認する。dryRun=true なら数えるだけで消さない。
// 消せるのは「自分が持ち主」かつ「ARCHIVED」の行だけ。ACTIVE は絶対に消さない。
function p1PurgeArchived(studentEmail, dryRun) {
  const goals = p1List("Goals", studentEmail).filter(g => String(g.status).toUpperCase() === "ARCHIVED");
  const weeklies = p1List("WeeklyGoals", studentEmail).filter(w => String(w.status).toUpperCase() === "ARCHIVED");
  const allWeeklies = p1List("WeeklyGoals", studentEmail);
  const logs = sheetToObjects(getSheet("DailyLog")).filter(l => l.student_email === studentEmail);
  const tasks = p1List("Tasks", studentEmail);
  // ★「＋ 追加する」で入れた実績も参照として数える★（2026-08-05）
  //   ここを見ていなかったため、実績が GoalEntries にしか無い目標が
  //   「参照なし＝消してよい」と判定されていた。履歴ごと消えるところだった。
  const entries = p1List("GoalEntries", studentEmail)
    .filter(function (e) { return !String(e.deleted_at || "").trim(); });

  // 各目標が他から参照されていないか数える。1件でもあれば消さない
  const report = goals.map(g => {
    const id = String(g.quarterly_goal_id);
    const wgRefs = allWeeklies.filter(w => String(w.link_quarterly_goal_id) === id && String(w.status).toUpperCase() !== "ARCHIVED").length;
    const entryRefs = entries.filter(e => String(e.quarterly_goal_id || "") === id).length;
    return { kind: "goal", id: id, title: g.title, owner: g.student_email, refs: wgRefs + entryRefs };
  }).concat(weeklies.map(w => {
    const id = String(w.weekly_goal_id);
    const logRefs = logs.filter(l => String(l.primary_weekly_goal_id) === id || String(l.related_goal_ids || "").indexOf(id) !== -1).length;
    const taskRefs = tasks.filter(t => String(t.link_weekly_goal_id) === id).length;
    const entryRefs = entries.filter(e => String(e.weekly_goal_id || "") === id).length;
    return { kind: "weekly", id: id, title: w.title, owner: w.student_email,
             refs: logRefs + taskRefs + entryRefs };
  }));

  if (dryRun) return { ok: true, dryRun: true, candidates: report };

  const deletable = report.filter(r => r.refs === 0);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  let deleted = 0;
  try {
    [["Goals", "quarterly_goal_id"], ["WeeklyGoals", "weekly_goal_id"]].forEach(pair => {
      const sheet = getP1Sheet(pair[0]);
      const data = sheet.getDataRange().getValues();
      const headers = data[0];
      const idIdx = headers.indexOf(pair[1]);
      const emIdx = headers.indexOf("student_email");
      const stIdx = headers.indexOf("status");
      const ids = deletable.filter(r => (pair[0] === "Goals") === (r.kind === "goal")).map(r => r.id);
      // 下から消す（上から消すと行番号がずれる）
      for (let i = data.length - 1; i >= 1; i--) {
        if (ids.indexOf(String(data[i][idIdx])) === -1) continue;
        if (String(data[i][emIdx]) !== studentEmail) continue;              // 持ち主が違う行は触らない
        if (String(data[i][stIdx]).toUpperCase() !== "ARCHIVED") continue;  // ACTIVEは絶対に消さない
        sheet.deleteRow(i + 1);
        deleted++;
      }
    });
  } finally { lock.releaseLock(); }
  return { ok: true, deleted: deleted, skipped: report.filter(r => r.refs > 0) };
}

// バックアップ（複製）を作る。DriveApp を使うと Drive 権限の承認ダイアログが必要になり、
// 本人が画面を操作しないと進めないが、SpreadsheetApp.copy() なら既に許可済みの
// スプレッドシート権限だけで複製できるため、Webアプリ経由でも実行できる。
// コピー先は所有者（Kai）のマイドライブ直下。外部には一切出さない。
function p1BackupViaSheets() {
  const src = getSpreadsheet();
  const stamp = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyyMMdd_HHmm");
  const copy = src.copy("JIROKU_backup_" + stamp);
  const counts = {};
  src.getSheets().forEach(s => { counts[s.getName()] = Math.max(0, s.getLastRow() - 1); });
  const copyCounts = {};
  copy.getSheets().forEach(s => { copyCounts[s.getName()] = Math.max(0, s.getLastRow() - 1); });
  // 元とコピーで件数がズレていないかをその場で突き合わせる
  const mismatch = Object.keys(counts).filter(k => counts[k] !== copyCounts[k]);
  return {
    ok: true,
    name: copy.getName(),
    newSpreadsheetId: copy.getId(),
    sourceSpreadsheetId: src.getId(),
    url: copy.getUrl(),
    sheetCount: copy.getSheets().length,
    counts: copyCounts,
    mismatch: mismatch
  };
}

// バックアップの共有範囲を確認する。意図せず他人に見える状態になっていないかを見る。
// getEditors/getViewers は SpreadsheetApp の権限だけで取得できる（Drive権限は不要）。
function p1BackupInfo(id) {
  const ss = SpreadsheetApp.openById(String(id || ""));
  const owner = ss.getOwner ? ss.getOwner() : null;
  return {
    ok: true,
    name: ss.getName(),
    id: ss.getId(),
    owner: owner ? owner.getEmail() : "(取得不可)",
    editors: ss.getEditors().map(u => u.getEmail()),
    viewers: ss.getViewers().map(u => u.getEmail()),
    sheetCount: ss.getSheets().length
  };
}

// ══════════════════════════════════════════════════════════════════
// Checkpoint 3: 記録と週間目標の接続
//
// 【二重加点を防ぐ考え方】
// 1件の記録が計上されるのは「1つの週間目標」だけ（primary_weekly_goal_id）。
// 複数の目標に効く行動でも、集計対象は必ず1つに寄せる。
// これをしないと、同じ1時間が3つの目標それぞれで満点になり、点数が実態と乖離する。
// 将来「関連はしている」を記録したくなったら related_goal_ids に入れるが、
// 集計には使わない（表示だけに使う）という前提を守る。
// ══════════════════════════════════════════════════════════════════

// "09:00-10:30" → 90分。"09:00" のような単発は1時間とみなす。
function timeBlockMinutes(tb) {
  const s = String(tb || "");
  const m = s.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
  if (m) {
    let mins = (Number(m[3]) * 60 + Number(m[4])) - (Number(m[1]) * 60 + Number(m[2]));
    if (mins < 0) mins += 24 * 60; // 日をまたぐ記録
    return mins;
  }
  return /^\d{1,2}:\d{2}/.test(s) ? 60 : 0;
}

// 記録に紐づける週間目標を決める。本人のACTIVEな週間目標でなければ空にする
// （他人の目標IDや、しまった目標のIDを渡されても紐づけない）。
function resolvePrimaryWeeklyGoal(studentEmail, wanted) {
  const id = String(wanted || "").trim();
  if (!id) return "";
  const row = p1OwnedRow("WeeklyGoals", "weekly_goal_id", id, studentEmail);
  if (!row) return "";
  return String(row.status || "ACTIVE").toUpperCase() === "ACTIVE" ? id : "";
}

// saveLog / saveLogMulti から呼ぶ。Phase 1 で足した列だけを埋める。
// 既存の列には一切触らない（万一この処理が失敗しても、記録そのものは残る）。
// ══════════════════════════════════════════════════════════════════
// 時間の5分類
//   GOAL_DIRECT           目標に直結
//   OPERATIONS            日常業務
//   ASSET_BUILD           将来への投資
//   RECOVERY             回復
//   RELATIONSHIP         人間関係
//   RECOVERY_RELATIONSHIP 回復・人間関係（2026-08-05より前の旧分類）
//   UNPLANNED_LEAKAGE     計画外の時間
//
// ★Tasks.context（WORK/PERSONAL/LEARNING/HEALTH/OTHER）は「活動領域」で、
//   5分類は「経営上どの役割の時間か」。別の軸なので変換しない★
//   同じ仕事でも、売上に直結する営業=GOAL_DIRECT、経理=OPERATIONS、
//   営業資料の仕組み化=ASSET_BUILD に分かれる。
//
// 決め方の優先順位
//   1. 本人が選んだもの（USER）… 以後ルールで上書きしない
//   2. 明示された休息モード
//   3. 強いリンク（週間目標／今日のフォーカスに直接つながっている）
//   4. 決められなければ未分類（勝手に埋めない）
// UNPLANNED_LEAKAGE は本人が選んだときだけ。
// 「計画外だった」と「無駄だった」は別のことなので、機械が決めない。
// ══════════════════════════════════════════════════════════════════
const TIME_CLASS_VERSION = "time_classification_v1";
// ★6分類★（2026-08-05 Kaiの判断）
//   「回復・人間関係」を「回復」と「人間関係」に分けた。
//   休むことと人と会うことは性質が違うため、まとめると本人にも分からない。
//   ★RECOVERY_RELATIONSHIP は残す★
//     2026-08-05より前の記録（1,700件超）はこのキーで保存されている。
//     一括で書き換えると事故るので、旧キーもそのまま有効な分類として扱い、
//     休息の集計では新旧まとめて数える。画面側は表示だけ読み替える。
const TIME_CLASSES = { GOAL_DIRECT:1, OPERATIONS:1, ASSET_BUILD:1,
                       RECOVERY:1, RELATIONSHIP:1,
                       RECOVERY_RELATIONSHIP:1,   // 旧分類（新規では使わない）
                       UNPLANNED_LEAKAGE:1 };
// 「休めたか」を見る集計は、新旧どちらのキーも休息として数える
const REST_CLASSES = { RECOVERY:1, RECOVERY_RELATIONSHIP:1 };

// ══════════════════════════════════════════════════════════════════
// ★隠しジロー★（2026-08-05 Kai要望）
//   条件を満たした瞬間に会える、プレイスタイル別のキャラクター。
//   ★数え直さない★ Users の1行に通算カウンターを持ち、記録の保存や
//   分類の変更のときに±1するだけ。判定はその場でできるので、
//   シートを数え直す通信は一度も増えない。
//   絵が揃うまでは画面側でシルエットのままにしておく（判定だけ先に動かす）。
// ══════════════════════════════════════════════════════════════════
const HIDDEN_JIRO = [
  { id:"night",    no:"No.101", name:"夜ふかしジロー", rarity:"Epic",
    key:"night",        need:20, cond:"23:00〜5:00の記録が通算20件" },
  { id:"calm",     no:"No.102", name:"ととのえジロー", rarity:"Rare",
    key:"RECOVERY",     need:30, cond:"回復の記録が通算30件" },
  { id:"stack",    no:"No.103", name:"積み上げジロー", rarity:"Rare",
    key:"ASSET_BUILD",  need:50, cond:"将来への投資の記録が通算50件" },
  { id:"straight", no:"No.104", name:"一直線ジロー",   rarity:"Epic",
    key:"GOAL_DIRECT",  need:50, cond:"目標に直結の記録が通算50件" },
  { id:"kind",     no:"No.105", name:"思いやりジロー", rarity:"Rare",
    key:"RELATIONSHIP", need:20, cond:"人間関係の記録が通算20件" },
  { id:"support",  no:"No.106", name:"縁の下ジロー",   rarity:"Rare",
    key:"OPERATIONS",   need:80, cond:"日常業務の記録が通算80件" },
  { id:"turbo",    no:"No.107", name:"爆速ジロー",     rarity:"Epic",
    key:"hiscore7",     need:7,  cond:"日次スコア90点以上が7日連続" }
];

// 記録の時刻が「夜ふかし」に当たるか（23時〜翌5時のはじまり）
function jiroIsNight_(timeBlock) {
  const m = String(timeBlock || "").match(/^(\d{1,2}):/);
  if (!m) return false;
  const h = Number(m[1]);
  return h >= 23 || h < 5;
}

function jiroParseCounts_(raw) {
  let o = raw;
  if (typeof o === "string") { if (!o.trim()) return {}; try { o = JSON.parse(o); } catch (e) { return {}; } }
  return (o && typeof o === "object") ? o : {};
}
function jiroParseFound_(raw) {
  return String(raw || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean);
}

// カウンターを増減し、新しく条件を満たしたジローの一覧を返す。
//   counts / found は呼び出し元が持っている値をそのまま渡す（読み直さない）。
function jiroApply_(counts, found, deltas, absolutes) {
  const c = counts || {};
  Object.keys(deltas || {}).forEach(function (k) {
    const v = Number(c[k] || 0) + Number(deltas[k] || 0);
    c[k] = v > 0 ? v : 0;
  });
  // 連続日数のように「足すのではなく置き換える」もの
  Object.keys(absolutes || {}).forEach(function (k) { c[k] = Number(absolutes[k] || 0); });
  const have = {}; (found || []).forEach(function (id) { have[id] = 1; });
  const gained = [];
  HIDDEN_JIRO.forEach(function (j) {
    if (have[j.id]) return;
    if (Number(c[j.key] || 0) >= j.need) { have[j.id] = 1; gained.push(j.id); }
  });
  return { counts: c, found: Object.keys(have), gained: gained };
}

// 増減が空なら通信しない。空でなければ1回だけ Users を更新する。
//   ★通信を増やさないための門番★ 分類が変わらない保存では何もしない。
function jiroCollect_(studentEmail, deltas, force) {
  const d = deltas || {};
  let any = false;
  Object.keys(d).forEach(function (k) { if (Number(d[k])) any = true; });
  if (!any && !force) return { gained: [] };
  const r = jiroBumpUser_(studentEmail, d);
  return { gained: (r.gained || []).map(function (id) {
    const j = HIDDEN_JIRO.find(function (x) { return x.id === id; });
    return j ? { id: j.id, no: j.no, name: j.name, rarity: j.rarity } : { id: id };
  }) };
}

// Users の1行だけを読み書きして反映する（分類の後からの変更など、
// XPの更新と一緒に書けない場面で使う）。
function jiroBumpUser_(studentEmail, deltas, absolutes) {
  try {
    const sheet = getSheet("Users");
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const iEm = headers.indexOf("student_email");
    let iC = headers.indexOf("jiro_counts"), iF = headers.indexOf("jiro_found");
    if (iC === -1) { iC = headers.length; sheet.getRange(1, iC + 1).setValue("jiro_counts"); }
    if (iF === -1) { iF = (iC === headers.length ? headers.length + 1 : headers.length);
                     sheet.getRange(1, iF + 1).setValue("jiro_found"); }
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][iEm]) !== studentEmail) continue;
      const r = jiroApply_(jiroParseCounts_(data[i][iC]), jiroParseFound_(data[i][iF]), deltas, absolutes);
      sheet.getRange(i + 1, iC + 1).setValue(JSON.stringify(r.counts));
      if (r.gained.length) sheet.getRange(i + 1, iF + 1).setValue(r.found.join(","));
      return r;
    }
  } catch (e) { /* 図鑑が更新できなくても、記録そのものは成功させる */ }
  return { counts: {}, found: [], gained: [] };
}

// ★1日の区切り（画面側の DAY_CUTOFF_HOUR と必ず同じ値にすること）★
//   深夜0時〜この時刻までの記録は「前の日の続き」として扱う。
//   夜通しの作業が、暦の日付をまたいだだけで2日に割れるのを防ぐ。
// 0 = 暦の日付どおり（2026-08-05 Kai報告で4→0に戻した）。
// 画面側の DAY_CUTOFF_HOUR と必ず同じ値にすること。
const DAY_CUTOFF_HOUR_GAS = 0;

function classifyLogTime_(studentEmail, targetDate, body, current) {
  // 1. 本人の選択（保存時でも、あとからの修正でも最優先）
  const want = String(body.time_classification || "").toUpperCase();
  if (want && TIME_CLASSES[want]) {
    return { classification: want, method: "USER", reason_code: "USER_SELECTED" };
  }
  // 本人がすでに決めている記録は、ルールで触らない
  if (current && String(current.method || "").toUpperCase() === "USER") return null;

  // 2. 明示された休息（タイマーの休憩モードなど）
  if (String(body.rest_mode || "") === "true") {
    return { classification: "RECOVERY", method: "RULE", reason_code: "REST_MODE" };
  }

  // 3. 強いリンクだけを根拠にする
  if (resolvePrimaryWeeklyGoal(studentEmail, body.primary_weekly_goal_id)) {
    return { classification: "GOAL_DIRECT", method: "RULE", reason_code: "LINKED_WEEKLY_GOAL" };
  }
  const tid = String(body.link_task_id || "").trim();
  if (tid) {
    const t = p1OwnedRow("Tasks", "task_id", tid, studentEmail);
    if (t) {
      if (String(t.link_daily_focus_id || "").trim())
        return { classification: "GOAL_DIRECT", method: "RULE", reason_code: "LINKED_DAILY_FOCUS" };
      if (resolvePrimaryWeeklyGoal(studentEmail, t.link_weekly_goal_id))
        return { classification: "GOAL_DIRECT", method: "RULE", reason_code: "LINKED_TASK_TO_WEEKLY_GOAL" };
    }
  }
  // 4. goal_related だけでは確定しない（本人に選んでもらう）
  if (String(body.goal_related || "") === "true") {
    return { classification: "", method: "RULE", reason_code: "GOAL_RELATED_ONLY_NEEDS_USER" };
  }
  return { classification: "", method: "RULE", reason_code: "RULE_UNCERTAIN" };
}

// ══════════════════════════════════════════════════════════════════
// 1日の設計（DayPlan）と、曜日ごとの使える時間
//   休息日を「未達」「0点」にしないための土台。
//   ★推測しない★ 設定が無い日は insufficient_data のままにする。
// ══════════════════════════════════════════════════════════════════
const DAY_TYPES = { NORMAL: 1, REST: 1, ADJUSTED: 1 };
const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function parseWeeklyAvailable_(raw) {
  let o = raw;
  if (typeof o === "string") { try { o = JSON.parse(o); } catch (e) { return null; } }
  if (!o || typeof o !== "object") return null;
  const out = {};
  const keys = Object.keys(o);
  for (let i = 0; i < keys.length; i++) {
    if (WEEKDAY_KEYS.indexOf(keys[i]) === -1) return null;      // 知らないキーは受け取らない
    const v = Number(o[keys[i]]);
    if (!isFinite(v) || v < 0 || v > 1440 || Math.floor(v) !== v) return null;
    out[keys[i]] = v;
  }
  return out;
}

function saveWeeklyAvailable(studentEmail, body) {
  const parsed = parseWeeklyAvailable_(body && body.weekly_available_minutes);
  if (!parsed) return { ok: false, error: "invalid weekly_available_minutes" };
  const sheet = getSheet("Users");
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const iEm = headers.indexOf("student_email");
  let iW = headers.indexOf("weekly_available_minutes");
  if (iW === -1) { iW = headers.length; sheet.getRange(1, iW + 1).setValue("weekly_available_minutes"); }
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][iEm]) !== studentEmail) continue;
    sheet.getRange(i + 1, iW + 1).setValue(JSON.stringify(parsed));
    smpBumpEpoch_(studentEmail);   // 自己経営力の計算結果を取り直させる
    return { ok: true, weekly_available_minutes: parsed };
  }
  return { ok: false, error: "no user" };
}

// その日に使える時間を決める。当日のDayPlan → 曜日既定 → 未設定
function resolveAvailableMinutes(studentEmail, dateStr) {
  const date = String(dateStr || formatDate(new Date())).slice(0, 10);
  const plan = p1List("DayPlan", studentEmail).find(function (r) {
    return String(r.date).slice(0, 10) === date; }) || null;
  if (plan && String(plan.available_minutes || "").trim() !== "") {
    return { minutes: Number(plan.available_minutes), source: "DAY_PLAN",
             day_type: String(plan.day_type || "NORMAL"), state: "evaluated" };
  }
  const user = sheetToObjects(getSheet("Users")).find(function (u) { return u.student_email === studentEmail; });
  const wk = parseWeeklyAvailable_(user && user.weekly_available_minutes);
  const dow = WEEKDAY_KEYS[(new Date(date + "T00:00:00+09:00").getDay() + 6) % 7];
  if (wk && wk[dow] !== undefined) {
    return { minutes: wk[dow], source: "WEEKDAY_DEFAULT", weekday: dow,
             day_type: plan ? String(plan.day_type || "NORMAL") : "NORMAL", state: "evaluated" };
  }
  return { minutes: null, source: "NONE", day_type: plan ? String(plan.day_type || "NORMAL") : "",
           state: "insufficient_data", reason_code: "AVAILABLE_TIME_MISSING" };
}

// 端末で起きたエラーを受け取る（ログイン前でも受ける。だから中身は最小限）。
//   ・1人1日5件まで。同じ内容は count を増やすだけ
//   ・本文は500字で切る。ここに個人情報を積まない
function recordClientError(body) {
  try {
    const email = String((body && body.studentEmail) || "").slice(0, 120);
    const kind = String((body && body.kind) || "ERROR").slice(0, 40);
    const msg = String((body && body.message) || "").slice(0, 300);
    if (!msg) return { ok: false };
    const today = formatDate(new Date());
    const key = sha256Hex([email, today, kind, msg].join("|")).slice(0, 16);
    const rows = sheetToObjects(getP1Sheet("ClientErrors"));
    const mine = rows.filter(function (r) {
      return String(r.student_email) === email && String(r.occurred_at).slice(0, 10) === today; });
    const same = rows.find(function (r) { return String(r.row_id) === "ce_" + key; });
    if (same) {
      p1Upsert("ClientErrors", "row_id", { row_id: same.row_id, student_email: email,
        count: Number(same.count || 1) + 1, last_at: new Date().toISOString() });
      return { ok: true, deduped: true };
    }
    if (mine.length >= 5) return { ok: true, throttled: true };
    p1Upsert("ClientErrors", "row_id", {
      row_id: "ce_" + key, student_email: email,
      occurred_at: new Date().toISOString(), app_build: String((body && body.build) || "").slice(0, 40),
      kind: kind, message: msg, detail: String((body && body.detail) || "").slice(0, 500),
      user_agent: String((body && body.ua) || "").slice(0, 200),
      viewport: String((body && body.viewport) || "").slice(0, 40),
      path: String((body && body.path) || "").slice(0, 120),
      count: 1, last_at: new Date().toISOString()
    });
    return { ok: true };
  } catch (e) { return { ok: false }; }
}

function getDayPlan(studentEmail, body) {
  const date = String((body && body.date) || "").slice(0, 10) || formatDate(new Date());
  const plan = p1List("DayPlan", studentEmail).find(function (r) {
    return String(r.date).slice(0, 10) === date; }) || null;
  const user = sheetToObjects(getSheet("Users")).find(function (u) { return u.student_email === studentEmail; });
  return { ok: true, data: {
    date: date,
    day_type: plan ? String(plan.day_type || "NORMAL") : "",
    available_minutes: plan && String(plan.available_minutes || "").trim() !== "" ? Number(plan.available_minutes) : null,
    reason: plan ? String(plan.reason || "") : "",
    weekly_available_minutes: parseWeeklyAvailable_(user && user.weekly_available_minutes) || null,
    resolved: resolveAvailableMinutes(studentEmail, date)
  } };
}

function saveDayPlan(studentEmail, body) {
  const date = String((body && body.date) || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "bad date" };
  const dt = String((body && body.day_type) || "").toUpperCase();
  if (dt && !DAY_TYPES[dt]) return { ok: false, error: "bad day_type" };
  let am = body && body.available_minutes;
  if (am !== undefined && am !== null && String(am).trim() !== "") {
    am = Number(am);
    if (!isFinite(am) || am < 0 || am > 1440 || Math.floor(am) !== am) return { ok: false, error: "bad available_minutes" };
  } else am = "";

  const prev = p1List("DayPlan", studentEmail).find(function (r) {
    return String(r.date).slice(0, 10) === date; }) || null;
  const prevType = prev ? String(prev.day_type || "") : "";
  const prevMin = prev && String(prev.available_minutes || "").trim() !== "" ? Number(prev.available_minutes) : "";
  const newType = dt || prevType || "NORMAL";
  const newMin = (am === "" && prev) ? prevMin : am;

  const now = new Date();
  const today = formatDate(now);
  // ★いつ変えたのかを必ず残す★ あとから都合よく休息日にしたのかが分かるように
  let timing = "SAME_DAY";
  if (date > today) timing = "BEFORE_DAY";
  else if (date < today) {
    timing = "AFTER_DAY";
    const evaluated = p1List("DailyOpsReport", studentEmail).some(function (r) {
      return String(r.report_date).slice(0, 10) === date; });
    if (evaluated) timing = "AFTER_EVALUATION";
  }

  p1Upsert("DayPlan", "row_id", {
    row_id: prev ? prev.row_id : ("dp_" + sha256Hex(studentEmail + "|" + date).slice(0, 16)),
    student_email: studentEmail, date: date, day_type: newType,
    available_minutes: newMin, source: "USER",
    reason: p1Text_((body && body.reason) || "", 200),
    created_at: prev ? prev.created_at : now.toISOString(), updated_at: now.toISOString()
  });
  // 履歴は追記だけ。過去行は書き換えない
  p1Upsert("DayPlanHistory", "history_id", {
    history_id: "dph_" + Utilities.getUuid().slice(0, 12),
    student_email: studentEmail, date: date,
    previous_day_type: prevType, new_day_type: newType,
    previous_available_minutes: prevMin, new_available_minutes: newMin,
    reason: p1Text_((body && body.reason) || "", 200),
    changed_by: studentEmail, changed_at: now.toISOString(),
    change_timing: timing, mutation_id: p1Text_((body && body.mutation_id) || "", 60)
  });
  smpBumpEpoch_(studentEmail);   // 自己経営力の計算結果を取り直させる
  return { ok: true, data: { date: date, day_type: newType,
                             available_minutes: newMin === "" ? null : newMin,
                             change_timing: timing,
                             resolved: resolveAvailableMinutes(studentEmail, date) } };
}

// 記録カードから分類を変える（B6）。本人の行だけ、正しい値だけを書く。
//   ・classification_method はサーバーが決める（クライアントが USER/RULE/AI を名乗れない）
//   ・許可された5値以外は保存しない
//   ・他人の log_id では何も起きない
function setLogClassification(studentEmail, body) {
  // 自己経営力は計算に時間がかかるので取っておいている。書き換えたら
  // 古い結果に当たらないよう世代を進める（2026-08-05）。
  smpBumpEpoch_(studentEmail);
  const logId = String((body && body.log_id) || "").trim();
  const want = String((body && body.time_classification) || "").toUpperCase();
  if (!logId) return { ok: false, error: "no log_id" };
  if (!TIME_CLASSES[want]) return { ok: false, error: "invalid classification" };
  const sheet = getSheet("DailyLog");
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const iEm = headers.indexOf("student_email"), iId = headers.indexOf("log_id");
  const iCls = headers.indexOf("time_classification");
  if (iCls === -1) return { ok: false, error: "column missing" };
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][iId]) !== logId) continue;
    if (String(data[i][iEm]) !== studentEmail) return { ok: false, error: "not found" }; // 他人の行は「無い」と返す
    const iDel = headers.indexOf("deleted_at");
    if (iDel !== -1 && String(data[i][iDel] || "").trim()) return { ok: false, error: "not found" };
    const prevCls = String(data[i][iCls] || "");
    const set = function (col, v) { const k = headers.indexOf(col); if (k !== -1) sheet.getRange(i + 1, k + 1).setValue(v); };
    set("time_classification", want);
    set("classification_method", "USER");          // ★サーバーが決める★
    set("classification_version", TIME_CLASS_VERSION);
    set("classification_reason_code", "USER_SELECTED");
    set("user_corrected_at", new Date().toISOString());
    // ★カレンダーの色も塗り直す★（2026-08-05）
    //   サーバーから直接書き込む人（google_calendar_id を持つ人）は、
    //   画面側の書き込みを止めているため、ここで塗り直さないと
    //   分類を変えてもカレンダーだけ前の色のまま残ってしまう。
    try {
      const iDate = headers.indexOf("date"), iTb = headers.indexOf("time_block"), iTask = headers.indexOf("task");
      const rawD = data[i][iDate];
      const dStr = rawD instanceof Date ? Utilities.formatDate(rawD, "Asia/Tokyo", "yyyy-MM-dd") : String(rawD).slice(0, 10);
      writeRecordToOwnerCalendar(studentEmail, dStr, String(data[i][iTb]), String(data[i][iTask]), want);
    } catch (e) { /* 色が変わらなくても分類の保存は成功させる */ }
    // ★隠しジローのカウンター★ 付け替えなので、前の分類は-1・新しい分類は+1
    let jiroGained = [];
    if (prevCls !== want) {
      const d = {};
      if (prevCls) d[prevCls] = -1;
      d[want] = 1;
      jiroGained = jiroCollect_(studentEmail, d, false).gained;
    }
    return { ok: true, log_id: logId, time_classification: want, classification_method: "USER",
             jiro_gained: jiroGained };
  }
  return { ok: false, error: "not found" };
}

// タスクの実績時間を DailyLog から作り直す（Tasks側はキャッシュ）。
//   ・消した記録は数えない
//   ・duration_confirmed=TRUE（測った値）を優先し、それが1件でもあれば確定分だけで合計
//   ・1件も無ければ空のままにする（未確認を0分にしない）
function recomputeTaskActualMinutes_(studentEmail, taskId) {
  const tid = String(taskId || "").trim();
  if (!tid) return null;
  const t = p1OwnedRow("Tasks", "task_id", tid, studentEmail);
  if (!t) return null;                                  // 他人のタスクには触らない
  const logs = sheetToObjects(getSheet("DailyLog")).filter(function (l) {
    return String(l.student_email) === studentEmail &&
           String(l.link_task_id || "") === tid &&
           !String(l.deleted_at || "").trim(); });
  const confirmed = logs.filter(function (l) {
    return String(l.duration_confirmed || "").toUpperCase() === "TRUE" && Number(l.actual_minutes) > 0; });
  const use = confirmed.length ? confirmed : logs.filter(function (l) { return Number(l.actual_minutes) > 0; });
  if (!use.length) return null;                          // 未確認は0分にしない
  const sum = use.reduce(function (a, l) { return a + Number(l.actual_minutes); }, 0);
  p1Upsert("Tasks", "task_id", { task_id: tid, student_email: studentEmail, actual_minutes: sum });
  return { task_id: tid, actual_minutes: sum, from_logs: use.length, confirmed_only: !!confirmed.length };
}

// 戻り値: 隠しジローのカウンターに足すべき増減（呼び出し元がまとめて反映する）
function writeP1LogFields(sheet, rowNum, studentEmail, targetDate, timeBlock, body) {
  const jiroDelta = {};
  try {
    // ★1セルずつ書かない★（2026-08-05 Kai報告「記録ボタンの待ち時間が長い」）
    //   1回の setValue ごとにシートへの往復が発生する。ここは最大10か所あり、
    //   さらに分類の確認で1セルずつ読み直してもいた。
    //   行をまるごと1回だけ読み、まとめて1回だけ書く。
    const lastCol = sheet.getLastColumn();
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    const rowVals = sheet.getRange(rowNum, 1, 1, lastCol).getValues()[0];
    let dirty = false;
    const set = (col, val) => {
      const i = headers.indexOf(col);
      if (i !== -1) { rowVals[i] = val; dirty = true; }
    };
    // ★冪等キー★ クライアントが送ってきたIDを優先する。
    //   タイマーは開始時にIDを決めるので、再送・重複送信でも同じ行を更新する。
    //   送られてこない場合だけ、日付＋時間帯から作った従来のIDを使う。
    const execId = p1Text_(body.action_execution_id, 80).replace(/[^A-Za-z0-9_\-]/g, "");
    set("action_execution_id", execId || makeExecutionId(studentEmail, targetDate, timeBlock));
    if (body.quantity !== undefined) set("quantity", p1Num_(body.quantity));
    if (body.actual_minutes !== undefined) set("actual_minutes", p1Num_(body.actual_minutes));
    if (body.duration_confirmed !== undefined) set("duration_confirmed", String(body.duration_confirmed) === "true" ? "TRUE" : "FALSE");
    if (body.unit !== undefined) set("unit", p1Text_(body.unit, 20));
    if (body.primary_weekly_goal_id !== undefined) {
      set("primary_weekly_goal_id", resolvePrimaryWeeklyGoal(studentEmail, body.primary_weekly_goal_id));
    }
    if (body.link_task_id !== undefined) {
      const t = p1OwnedRow("Tasks", "task_id", body.link_task_id, studentEmail);
      set("link_task_id", t ? String(body.link_task_id) : "");
    }
    // ── 時間の5分類 ──────────────────────────────
    //   本人が選んだ分類は、あとからルールで上書きしない
    const iCls = headers.indexOf("time_classification");
    if (iCls !== -1) {
      const iMth = headers.indexOf("classification_method");
      const cur = {
        cls: String(rowVals[iCls] || ""),
        method: String(iMth === -1 ? "" : (rowVals[iMth] || ""))
      };
      const decided = classifyLogTime_(studentEmail, targetDate, body, cur);
      if (decided) {
        set("time_classification", decided.classification);
        set("classification_method", decided.method);
        set("classification_version", TIME_CLASS_VERSION);
        set("classification_reason_code", decided.reason_code);
        if (decided.method === "USER") set("user_corrected_at", new Date().toISOString());
        // ★隠しジローのカウンター★ 増えた分類を+1、前の分類を-1（付け替え）
        if (decided.classification !== cur.cls) {
          if (cur.cls) jiroDelta[cur.cls] = (jiroDelta[cur.cls] || 0) - 1;
          if (decided.classification) jiroDelta[decided.classification] = (jiroDelta[decided.classification] || 0) + 1;
        }
      }
    }
    // まとめて1回で書き戻す
    if (dirty) sheet.getRange(rowNum, 1, 1, lastCol).setValues([rowVals]);
    // 紐づいたタスクの実績時間を作り直す（同じ行を更新しても二重に増えない：
    // 足し算ではなく、DailyLog を読み直して合計を出し直しているため）
    if (body.link_task_id !== undefined && String(body.link_task_id || "").trim()) {
      try { recomputeTaskActualMinutes_(studentEmail, body.link_task_id); } catch (e2) {}
    }
  } catch (e) {
    Logger.log("writeP1LogFields 失敗（記録本体は保存済み）: " + e);
  }
  return jiroDelta;
}

// 週間目標の実績を集計する。weekStart は月曜(YYYY-MM-DD)。
// metric_type ごとに数え方を変える:
//   count   … quantity の合計（未入力の記録は1件＝1とみなす）
//   minutes … time_block から出した分の合計
//   boolean … 本人が「達成」にした時だけ1（記録があるだけでは達成にしない）
function aggregateWeeklyActual(studentEmail, weekStart) {
  const monday = weekStart ? String(weekStart) : mondayOf(formatDate(new Date()));
  const end = new Date(monday + "T00:00:00Z");
  end.setUTCDate(end.getUTCDate() + 6);
  const sunday = end.toISOString().substring(0, 10);

  const weeklies = p1List("WeeklyGoals", studentEmail)
    .filter(w => String(w.status || "ACTIVE").toUpperCase() !== "ARCHIVED");
  if (!weeklies.length) return {};

  const logs = sheetToObjects(getSheet("DailyLog")).filter(l => {
    if (l.student_email !== studentEmail) return false;
    if (String(l.deleted_at || "").trim()) return false; // 論理削除済みは数えない
    const d = String(l.date).substring(0, 10);
    return d >= monday && d <= sunday;
  });

  // 「＋」で足した実績（時間の記録ではないもの）。この週のぶんだけ拾う
  const entryByGoal = {};
  try {
    p1List("GoalEntries", studentEmail).forEach(function (e) {
      if (String(e.deleted_at || "").trim()) return;
      const wid = String(e.weekly_goal_id || "");
      if (!wid) return;
      const d = String(e.entry_date || "").slice(0, 10);
      if (!(d >= monday && d <= sunday)) return;
      if (!entryByGoal[wid]) entryByGoal[wid] = { sum: 0, count: 0 };
      entryByGoal[wid].sum += (Number(e.amount) || 0);
      entryByGoal[wid].count++;
    });
  } catch (e) {}

  const out = {};
  weeklies.forEach(w => {
    const id = String(w.weekly_goal_id);
    const mt = normalizeMetricType(w.metric_type);

    // ★数えるのは primary_weekly_goal_id が一致する記録だけ★
    // related_goal_ids は「関連あり」の目印であって、集計には使わない。
    // 使うと、1件の記録が複数の週間目標に加算されて数字が水増しされる。
    const mine = logs.filter(l => String(l.primary_weekly_goal_id || "") === id);

    let actual = 0;
    let pending = 0;   // 未確定で数えなかったぶん（画面で「確認しますか」と出すため）

    if (mt === "BOOLEAN") {
      // ★記録があるだけでは達成にしない★
      // 本人が明示的に「達成」へ変えたときだけ1。
      actual = String(w.status || "").toUpperCase() === "COMPLETED" ? 1 : 0;

    } else if (mt === "DAYS") {
      // 何日やったか。同じ日に何件記録しても1日。
      const days = {};
      mine.forEach(l => { const d = String(l.date).substring(0, 10); if (d) days[d] = 1; });
      actual = Object.keys(days).length;

    } else if (mt === "DURATION") {
      // 分数。優先順位は actual_minutes → quantity。
      // ★time_block の長さを自動で足さない★
      //   「10時〜12時に勉強」と記録しても、その2時間まるごとが
      //   目標の時間とは限らない。自動加算すると、目標に紐づけただけで
      //   数字が伸びてしまい、達成感だけが先に来る。
      //   time_block は候補として画面に出し、本人が確認して保存したぶんだけ数える。
      mine.forEach(l => {
        const am = Number(l.actual_minutes);
        if (!isNaN(am) && am > 0) { actual += am; return; }
        const q = Number(l.quantity);
        // ★マイナスも数える★（2026-08-05 Kai要望）
        //   間違えて足したぶんを戻せるように、打ち消しの記録を認める。
        //   記録を消すのではなく「戻した」という記録を残す方が、あとで追える。
        if (!isNaN(q) && q !== 0) { actual += q; return; }
        const cand = timeBlockMinutes(l.time_block);
        if (cand > 0) pending += cand;   // 候補として持つだけ。加算しない
      });

    } else {
      // COUNT。★正の quantity があるときだけ加算する★
      //   未入力を1として数えると、「紐づけただけ」で回数が増える。
      //   数えていないものを数えたことにしない。
      mine.forEach(l => {
        const q = Number(l.quantity);
        // マイナスも数える（打ち消しの記録を認める。上のDURATIONと同じ理由）
        if (!isNaN(q) && q !== 0) actual += q;
        else pending += 1;
      });
    }

    // 記録から数えたぶんに、「＋」で足したぶんを加える
    const ent = entryByGoal[id] || { sum: 0, count: 0 };
    actual += ent.sum;
    // ★「記録があるか」は「＋」で足したぶんも数える★（2026-08-05 Kai指摘）
    //   時間の記録（DailyLog）だけを見ていたため、「追加する」で実績を入れた人が
    //   数字は増えているのに「まだ今週の記録がありません」と言われていた。
    out[id] = { actual: actual, metric_type: mt,
                logCount: mine.length, entryCount: ent.count,
                recordCount: mine.length + ent.count,
                pendingUnconfirmed: pending };
  });
  return out;
}

// ★内部コードを大文字4種へ統一する★
// 以前は count / minutes / boolean（小文字）だった。
// 既存データを書き換えずに済むよう、読むときに変換する。
// 変換表に無いものは COUNT にする（勝手に時間として数えないため。
// 取り違えるなら、数字が小さく出るほうへ倒す）。
const METRIC_TYPES = ["COUNT", "DURATION", "DAYS", "BOOLEAN"];
function normalizeMetricType(v) {
  const s = String(v || "").trim().toUpperCase();
  if (METRIC_TYPES.indexOf(s) !== -1) return s;
  if (s === "MINUTES" || s === "TIME") return "DURATION";
  if (s === "DAY") return "DAYS";
  if (s === "BOOL") return "BOOLEAN";
  return "COUNT";
}

// 集計結果を WeeklyGoals に書き戻す（画面が毎回集計し直さなくて済むように）
function refreshWeeklyActuals(studentEmail, weekStart) {
  const agg = aggregateWeeklyActual(studentEmail, weekStart);
  const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  Object.keys(agg).forEach(id => {
    p1Upsert("WeeklyGoals", "weekly_goal_id", {
      weekly_goal_id: id, actual_value: agg[id].actual, actual_calculated_at: now
    });
  });
  return { ok: true, weekStart: weekStart || mondayOf(formatDate(new Date())), results: agg };
}

// LINEの送信枠を確認する。無料プランには月あたりの上限があり、
// 使い切ると push が失敗する。失敗はログに残るだけで誰も気づけないため、
// 「届かない」の原因を特定できるようにしておく。
function lineQuotaStatus() {
  const token = PropertiesService.getScriptProperties().getProperty("LINE_CHANNEL_TOKEN");
  if (!token) return { ok: false, error: "LINE_CHANNEL_TOKEN未設定" };
  const get = (path) => {
    const r = UrlFetchApp.fetch("https://api.line.me/v2/bot/" + path, {
      headers: { "Authorization": "Bearer " + token }, muteHttpExceptions: true
    });
    return { code: r.getResponseCode(), body: r.getContentText() };
  };
  const q = get("message/quota");
  const c = get("message/quota/consumption");
  let limit = null, used = null;
  try { const j = JSON.parse(q.body); limit = (j.type === "limited") ? j.value : "無制限"; } catch (e) {}
  try { used = JSON.parse(c.body).totalUsage; } catch (e) {}
  return {
    ok: q.code === 200 && c.code === 200,
    limit: limit, used: used,
    remaining: (typeof limit === "number" && typeof used === "number") ? (limit - used) : null,
    raw: { quota: q, consumption: c }
  };
}


// ══════════════════════════════════════════════════════════════════
// Auth CP1: 本人確認とセッション基盤
//
// 【なぜ必要か】このWeb appは長らく「リクエストに書かれたメールアドレス」を
// そのまま信用していた。認証情報を持たないクライアントから、管理者のアドレスを
// 書くだけで生徒21名の氏名とメールが取得できることを実測で確認している。
//
// 【この段階でやること】本人確認とセッションの土台を作るところまで。
// 既存143アクションへの認証強制は、次の段階(Auth CP2)以降で行う。
// ══════════════════════════════════════════════════════════════════

const AUTH_SHEETS = {
  AuthChallenges: ["challenge_id","state_hash","nonce_hash","created_at","expires_at","used_at","attempt_count","result"],
  Sessions: ["session_token_hash","user_id","google_sub","role","organization_id",
             "expires_at","created_at","last_seen_at","revoked_at","token_version","device_label"],
  // session_id は「発行済みセッションの識別子」、credential_fingerprint は
  // 「まだセッションが無い段階でIDトークンの再試行を追う」ための別物。
  // 混同すると監査の意味が壊れるので列を分けている。
  AuthAudit: ["event_id","timestamp","event_type","actor_user_id","target_user_id",
              "session_id","credential_fingerprint","action","result","failure_reason",
              "deployment_id","environment"]
};
const AUTH_USER_COLUMNS = ["user_id","google_sub","token_version","role","organization_id","auth_linked_at"];

// ★token_version は必ずこれを通して読む★（2026-08-05 本番で5人がログインできなくなった）
//   シートのセルが時刻書式になっていると、0 が Date（00:00）として返ってくる。
//   Number(Date) は NaN になり、NaN !== NaN が常に true なので
//   「版が変わった」と判定され、何度ログインしてもセッションが無効になる。
//   数字として読めないものは 0 として扱う。
function tokenVer_(v) {
  if (v === "" || v === null || v === undefined) return 0;
  if (v instanceof Date) return 0;             // 書式が崩れた 00:00 は「未設定」
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

const SESSION_ABSOLUTE_DAYS = 14;  // 絶対有効期限
const SESSION_IDLE_DAYS     = 7;   // 無操作で切れるまで
const SESSION_MAX_DEVICES   = 5;   // 1人あたりの同時端末数
const CHALLENGE_TTL_MS      = 5 * 60 * 1000;
const CHALLENGE_MAX_ATTEMPTS = 3;

function getAuthSheet(name) {
  let sh = getSheet(name);
  if (!sh) { sh = getSpreadsheet().insertSheet(name); sh.appendRow(AUTH_SHEETS[name]); }
  return sh;
}
// 認証用シートに不足している列を足す。
// ★AuthAuditに列を追加した際、既存シートのヘッダーを更新していなかったため、
//   12個の値を10列のシートへ書き込み、値が1つずつずれて記録されていた
//   （2026-07-31に発覚）。ヘッダーは必ず定義と揃える。
function ensureAuthColumns(name) {
  const sh = getSheet(name);
  if (!sh) return [];
  const want = AUTH_SHEETS[name] || [];
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const missing = want.filter(c => headers.indexOf(c) === -1);
  if (missing.length) sh.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
  return missing;
}

function setupAuthPhase1() {
  const created = [];
  Object.keys(AUTH_SHEETS).forEach(n => { if (!getSheet(n)) { getAuthSheet(n); created.push(n); } });
  const addedCols = {};
  Object.keys(AUTH_SHEETS).forEach(n => { const m = ensureAuthColumns(n); if (m.length) addedCols[n] = m; });
  // Users への列追加（削除・改名はしない）
  const u = getSheet("Users");
  const headers = u.getRange(1, 1, 1, u.getLastColumn()).getValues()[0];
  const missing = AUTH_USER_COLUMNS.filter(c => headers.indexOf(c) === -1);
  if (missing.length) u.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
  return { ok: true, createdSheets: created, addedAuthColumns: addedCols, addedUserColumns: missing };
}

// ── ハッシュ・比較 ──
function sha256Hex(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)
    .map(b => ((b & 0xFF) + 0x100).toString(16).slice(1)).join("");
}
// 入力によって処理時間が大きく変わらない比較。長さが違う場合も最後まで走らせる
function safeEquals(a, b) {
  const x = String(a || ""), y = String(b || "");
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

// ── セッショントークンの生成 ──
// GASには暗号学的乱数が無い（Math.random も getUuid も予測困難性を保証しない）。
// そこで「ローカルのOS CSPRNGで作った秘密鍵」を ScriptProperties に置き、
// それを鍵としたHMAC-SHA256の出力をトークンにする。
// 秘密鍵はコード・GitHub・ログのどこにも出さない。
function newSessionToken(userId) {
  const secret = PropertiesService.getScriptProperties().getProperty("SESSION_TOKEN_SECRET");
  if (!secret) throw new Error("SESSION_TOKEN_SECRET未設定");
  const material = [
    Utilities.getUuid(), Utilities.getUuid(), Utilities.getUuid(),
    String(userId), String(new Date().getTime()),
    String(Math.floor(Math.random() * 1e12))
  ].join("|");
  const raw = Utilities.computeHmacSha256Signature(material, secret);
  return Utilities.base64EncodeWebSafe(raw).replace(/=+$/, "");
}

// ── セッション鍵の設定 ──
// 鍵そのものをネットワークへ流さないため、GASの内部で生成してそのまま保存する。
// 戻り値は指紋（ハッシュの先頭12文字）だけで、鍵は絶対に返さない・ログにも出さない。
//
// 乱数源について: Utilities.getUuid() はJavaの UUID.randomUUID() 相当で、
// SecureRandom を用いた 122bit の乱数を返す。これを6回分＋時刻と混ぜて
// SHA-256 に通し、256bit の鍵材料とする。
// ※より厳密にはOS側のCSPRNGで作った鍵を手で設定する方が確実だが、
//   その場合は鍵を人の手で運ぶことになる。ここでは「鍵を一切外に出さない」ことを優先した。
function rotateSessionSecret(force) {
  const props = PropertiesService.getScriptProperties();
  const existing = props.getProperty("SESSION_TOKEN_SECRET");
  if (existing && !force) {
    return { ok: true, alreadySet: true, fingerprint: sha256Hex(existing).slice(0, 12) };
  }
  const material = [];
  for (let i = 0; i < 6; i++) material.push(Utilities.getUuid());
  material.push(String(new Date().getTime()));
  material.push(String(Math.random()));
  const secret = Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, material.join("|"), Utilities.Charset.UTF_8)
  ).replace(/=+$/, "");
  props.setProperty("SESSION_TOKEN_SECRET", secret);
  // 鍵を変えると既存セッションはすべて検証できなくなる＝全端末ログアウトと同じ
  return { ok: true, rotated: true, fingerprint: sha256Hex(secret).slice(0, 12),
           note: "既存のセッションはすべて無効になりました" };
}

// ══════════════════════════════════════════════════════════════════
// LINE連携のワンタイムトークン
//
// LINEのWebhookは署名を検証できない（GASはリクエストヘッダーを取得できない）。
// そのため「メールアドレスを送れば連携できる」方式では、誰でも他人になりすまして
// 通知の宛先を奪えた。認証済みのアプリからしか発行できないトークンを介することで、
// 署名検証が無くても「本人が発行したものである」ことを担保する。
//
// 短い数字コードは使わない。公開Webhookへ総当たりできるため、
// 十分に予測困難な長さにする。
// ══════════════════════════════════════════════════════════════════
const LINE_LINK_TOKEN_TTL_MS = 5 * 60 * 1000;
const LINE_LINK_MAX_ATTEMPTS = 5;
const LINE_LINK_SHEET = "LineLinkTokens";
const LINE_LINK_COLUMNS = ["token_hash","user_id","student_email","created_at","expires_at","used_at","attempt_count","result"];

function getLineLinkSheet() {
  let sh = getSheet(LINE_LINK_SHEET);
  if (!sh) { sh = getSpreadsheet().insertSheet(LINE_LINK_SHEET); sh.appendRow(LINE_LINK_COLUMNS); }
  return sh;
}

// 認証済みセッションからのみ発行する。対象はセッションから確定し、
// クライアントが送るメールは一切見ない。
function issueLineLinkToken(token) {
  const v = verifySession(token, false);
  if (!v.ok) return { ok: false, error: "AUTH_REQUIRED" };
  const actor = v.actor;

  // 128bit以上の予測困難性。セッショントークンと同じ作り方（HMAC-SHA256の出力）
  const secret = PropertiesService.getScriptProperties().getProperty("SESSION_TOKEN_SECRET");
  if (!secret) return { ok: false, error: "設定が未完了です" };
  const material = [Utilities.getUuid(), Utilities.getUuid(), actor.actor_user_id,
                    String(new Date().getTime()), String(Math.random())].join("|");
  const plain = Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(material, secret)).replace(/=+$/, "").slice(0, 24);

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = getLineLinkSheet();
    const data = sh.getDataRange().getValues(), h = data[0];
    const iUid = h.indexOf("user_id"), iUsed = h.indexOf("used_at"), iRes = h.indexOf("result");
    const now = new Date();
    // 同じ人の未使用トークンは失効させる（発行し直したら前のは使えない）
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][iUid]) !== String(actor.actor_user_id)) continue;
      if (String(data[i][iUsed] || "").trim()) continue;
      sh.getRange(i + 1, iUsed + 1).setValue(now.toISOString());
      sh.getRange(i + 1, iRes + 1).setValue("SUPERSEDED");
    }
    sh.appendRow([sha256Hex(plain), actor.actor_user_id, actor.email, now.toISOString(),
                  new Date(now.getTime() + LINE_LINK_TOKEN_TTL_MS).toISOString(), "", 0, "ISSUED"]);
  } finally { lock.releaseLock(); }

  authAudit("LINE_LINK_TOKEN_ISSUED", { result: "SUCCESS", actorUserId: actor.actor_user_id, action: "issueLineLinkToken" });
  // 平文はこの応答でのみ返す。シートにもログにも残さない
  return { ok: true, linkWord: plain, expiresInSec: Math.floor(LINE_LINK_TOKEN_TTL_MS / 1000) };
}

// LINEから送られてきたトークンを消費して連携する。
// 応答文は成否で内容を大きく変えない（有効なトークンかどうかを推測させない）。
function consumeLineLinkToken(plain, lineUserId) {
  const ng = { ok: false, message: "連携できませんでした。アプリで連携用のことばを発行し直して、もう一度お試しください。" };
  if (!plain || !lineUserId) return ng;

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = getLineLinkSheet();
    const data = sh.getDataRange().getValues(), h = data[0];
    const iHash = h.indexOf("token_hash"), iUid = h.indexOf("user_id"), iEmail = h.indexOf("student_email");
    const iExp = h.indexOf("expires_at"), iUsed = h.indexOf("used_at"),
          iAtt = h.indexOf("attempt_count"), iRes = h.indexOf("result");
    const want = sha256Hex(plain);

    for (let i = 1; i < data.length; i++) {
      if (!safeEquals(String(data[i][iHash]), want)) continue;
      const row = i + 1;
      const attempts = Number(data[i][iAtt] || 0) + 1;
      sh.getRange(row, iAtt + 1).setValue(attempts);
      const deny = function (why) {
        sh.getRange(row, iRes + 1).setValue(why);
        authAudit("LINE_LINK", { result: "DENY", failureReason: why, action: "consumeLineLinkToken" });
        return ng;
      };
      if (String(data[i][iUsed] || "").trim()) return deny("ALREADY_USED");
      if (attempts > LINE_LINK_MAX_ATTEMPTS) return deny("TOO_MANY_ATTEMPTS");
      if (new Date(String(data[i][iExp])).getTime() < Date.now()) return deny("EXPIRED");

      // 対象ユーザーの状態を確認する
      const ush = getSheet("Users");
      const ud = ush.getDataRange().getValues(), uh = ud[0];
      const uUid = uh.indexOf("user_id"), uLine = uh.indexOf("line_user_id"), uName = uh.indexOf("name");
      let target = -1;
      for (let k = 1; k < ud.length; k++) {
        if (String(ud[k][uUid]) === String(data[i][iUid])) { target = k; break; }
      }
      if (target === -1) return deny("USER_NOT_FOUND");
      if (String(ud[target][uLine] || "").trim()) return deny("ALREADY_LINKED");
      // 同じLINEアカウントが別の人に使われていないか
      for (let k = 1; k < ud.length; k++) {
        if (k !== target && String(ud[k][uLine] || "").trim() === String(lineUserId)) return deny("LINE_ID_IN_USE");
      }

      ush.getRange(target + 1, uLine + 1).setValue(lineUserId);
      sh.getRange(row, iUsed + 1).setValue(new Date().toISOString());
      sh.getRange(row, iRes + 1).setValue("CONSUMED");
      authAudit("LINE_LINK", { result: "SUCCESS", actorUserId: String(data[i][iUid]), action: "consumeLineLinkToken" });
      return { ok: true, message: "✅ 連携できました！\n" + String(ud[target][uName]) +
        "さんのアカウントとつながりました。\n\n毎時間の記録リマインダーと毎晩のAIレポートをお届けします。" };
    }
  } finally { lock.releaseLock(); }
  authAudit("LINE_LINK", { result: "DENY", failureReason: "NOT_FOUND", action: "consumeLineLinkToken" });
  return ng;
}

// ── 監査ログ ──
// 平文トークン・IDトークン・記録本文は絶対に書かない
function authAudit(eventType, o) {
  try {
    const sh = getAuthSheet("AuthAudit");
    ensureAuthColumns("AuthAudit");
    // ★位置ではなく列名で書く★
    // 以前は定義順にappendRowしていたが、後から足した列はシート末尾に付くため
    // 定義の並びと実際の並びがずれ、値が別の列に入っていた（2026-07-31）。
    // 実際のヘッダーを読んで、名前で対応させる。
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const v = {
      event_id: "ae_" + Utilities.getUuid().slice(0, 12),
      timestamp: new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }),
      event_type: String(eventType),
      actor_user_id: String((o && o.actorUserId) || ""),
      target_user_id: String((o && o.targetUserId) || ""),
      session_id: String((o && o.sessionId) || ""),
      credential_fingerprint: String((o && o.credentialFingerprint) || ""),
      action: String((o && o.action) || ""),
      result: String((o && o.result) || ""),
      failure_reason: String((o && o.failureReason) || ""),
      deployment_id: currentDeploymentId(),
      environment: currentEnvironment()
    };
    sh.appendRow(headers.map(function (h) { return v[h] !== undefined ? v[h] : ""; }));
  } catch (e) { Logger.log("authAudit失敗: " + e); }
}

// 検証で作ったセッションを片付ける。AuthAuditは監査記録なので消さない
// （environment列でTEST/PRODを区別できるようにしてある）。
// 検証で作った架空ユーザーだけを消す。
// ★.invalid で終わるメールの行しか触らない★
//   .invalid は RFC 2606 で「絶対に実在しない」と予約されたドメイン。
//   条件をメールの末尾一致にしておけば、実在の利用者に当たりようがない。
//   「テスト用と分かるように名前を付ける」といった運用の約束にはしない。
//   約束は破られるが、ドメインの判定は破られない。
function adminPurgeTestUsers(confirm) {
  const sh = getSheet("Users");
  const data = sh.getDataRange().getValues();
  const h = data[0];
  const iEmail = h.indexOf("student_email");
  if (iEmail === -1) return { ok: false, error: "student_email 列がありません" };

  const hits = [];
  for (let i = 1; i < data.length; i++) {
    const em = String(data[i][iEmail] || "").trim().toLowerCase();
    if (em && em.slice(-8) === ".invalid") hits.push({ row: i + 1, emailHead: em.split("@")[0] });
  }
  if (!confirm) return { ok: true, dryRun: true, found: hits.length, rows: hits.map(function (x) { return x.row; }) };

  // 下の行から消す（上から消すと行番号がずれる）
  hits.sort(function (a, b) { return b.row - a.row; }).forEach(function (x) { sh.deleteRow(x.row); });
  authAudit("PURGE_TEST_USERS", { result: "SUCCESS", action: "adminPurgeTestUsers",
            failureReason: "removed=" + hits.length });
  return { ok: true, dryRun: false, removed: hits.length };
}

// ── 2026-08-01 実施済みのデータ修復（記録として残す）──
// XPの誤加算10を是正した（before 5512 → after 5502 / streak・バッジ・レベルは不変）。
// ロールバック検証でわたしが作った記録が原因。記録自体は削除済みだった。
//
// ★修復用のコードは実行後に削除した★
//   XPを書き換えられる口を残すと、点数の意味がなくなる。
//   実行の痕跡は監査ログ（DATA_REPAIR）とスクリプトプロパティ
//   REPAIR_DONE_xp-2026-08-01-rollback-test に残っている。
//
// このとき、ChatGPTから指示された固定値（5482→5472）は既に古くなっており、
// 実行時点では5512だった。Kaiがその後も記録して正当にXPを得ていたため。
// 固定値をそのまま書き込んでいたら、正当に稼いだ30ポイントを消していた。
// 「期待値と一致したときだけ書く」というガードが実際に事故を止めた。
// 次に同種の修復を行うときも、必ず実行直前に現在値を取り直すこと。

function authCleanupTestData() {
  const now = new Date().toISOString();
  const sh = getAuthSheet("Sessions");
  const data = sh.getDataRange().getValues(), h = data[0];
  const iRev = h.indexOf("revoked_at");
  let revoked = 0;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][iRev] || "").trim()) continue;
    sh.getRange(i + 1, iRev + 1).setValue(now); revoked++;
  }
  // 期限切れ・未使用のchallengeを閉じる
  const cs = getAuthSheet("AuthChallenges");
  const cd = cs.getDataRange().getValues(), ch = cd[0];
  const iUsed = ch.indexOf("used_at"), iExp = ch.indexOf("expires_at"), iRes = ch.indexOf("result");
  let closed = 0;
  for (let i = 1; i < cd.length; i++) {
    if (String(cd[i][iUsed] || "").trim()) continue;
    if (new Date(String(cd[i][iExp])).getTime() > Date.now()) continue;
    cs.getRange(i + 1, iUsed + 1).setValue(now);
    cs.getRange(i + 1, iRes + 1).setValue("EXPIRED_CLEANUP"); closed++;
  }
  return { ok: true, revokedSessions: revoked, closedChallenges: closed,
           note: "AuthAuditは監査記録のため削除していない" };
}

// ロール割り当ての下見。★書き込みは一切しない★
// Kai=JIROKU_ADMIN / Coachesに載っている人=COACH / それ以外=USER
// MANAGER と ORG_ADMIN は法人機能の導入まで割り当てない
function authRoleDryRun() {
  const admin = String(adminEmail()).toLowerCase();
  const coachEmails = {};
  try {
    sheetToObjects(getSheet("Coaches")).forEach(function (c) {
      const e = String(c.coach_email || c.email || "").trim().toLowerCase();
      if (e) coachEmails[e] = true;
    });
  } catch (e) {}
  const users = sheetToObjects(getSheet("Users"));
  const counts = { JIROKU_ADMIN: 0, COACH: 0, USER: 0 };
  const exceptions = [];
  const seen = {};
  users.forEach(function (u) {
    const em = String(u.student_email || "").trim().toLowerCase();
    if (!em) { exceptions.push({ issue: "メール未設定の行", detail: String(u.name || "(名前なし)") }); return; }
    if (seen[em]) { exceptions.push({ issue: "メールの重複", detail: em }); return; }
    seen[em] = true;
    let role = "USER";
    if (em === admin) role = "JIROKU_ADMIN";
    else if (coachEmails[em]) role = "COACH";
    counts[role]++;
    const cur = String(u.role || "").trim();
    if (cur && cur !== role) exceptions.push({ issue: "既存roleと提案が不一致", detail: em + " 現在=" + cur + " 提案=" + role });
    if (String(u.is_active).toUpperCase() !== "TRUE") exceptions.push({ issue: "無効なユーザー", detail: em });
  });
  return { ok: true, dryRun: true, totalUsers: users.length, proposed: counts,
           coachSheetEntries: Object.keys(coachEmails).length,
           exceptions: exceptions,
           note: "書き込みは行っていない。MANAGER/ORG_ADMINは法人機能まで割り当てない" };
}

// 下見（authRoleDryRun）と同じ規則で role を実際に書き込む。
// 既に値が入っている行は上書きしない（手で設定したものを壊さないため）。
// role を変えた人は既存セッションを失効させる（古い権限で動き続けさせない）。
function authRoleApply() {
  const dry = authRoleDryRun();
  const admin = String(adminEmail()).toLowerCase();
  const coachEmails = {};
  try {
    sheetToObjects(getSheet("Coaches")).forEach(function (c) {
      const e = String(c.coach_email || c.email || "").trim().toLowerCase();
      if (e) coachEmails[e] = true;
    });
  } catch (e) {}

  const sh = getSheet("Users");
  const data = sh.getDataRange().getValues(), h = data[0];
  const iEmail = h.indexOf("student_email"), iRole = h.indexOf("role"), iTv = h.indexOf("token_version");
  if (iRole === -1) return { ok: false, error: "role列がありません" };

  const applied = [];
  for (let i = 1; i < data.length; i++) {
    const em = String(data[i][iEmail] || "").trim().toLowerCase();
    if (!em) continue;
    const cur = String(data[i][iRole] || "").trim();
    if (cur) continue;                                  // 既に設定済みは触らない
    const role = (em === admin) ? "JIROKU_ADMIN" : (coachEmails[em] ? "COACH" : "USER");
    sh.getRange(i + 1, iRole + 1).setValue(role);
    // 権限が変わったので、その人の既存セッションを無効化する
    if (iTv !== -1) sh.getRange(i + 1, iTv + 1).setValue(tokenVer_(data[i][iTv]) + 1);
    applied.push({ email: em, role: role });
    authAudit("ROLE_ASSIGN", { result: "SUCCESS", targetUserId: em, action: "authRoleApply", failureReason: role });
  }
  const counts = {};
  applied.forEach(function (a2) { counts[a2.role] = (counts[a2.role] || 0) + 1; });
  return { ok: true, appliedCount: applied.length, byRole: counts,
           skippedExisting: dry.totalUsers - applied.length,
           note: "既に設定済みの行は変更していない。role付与時にtoken_versionを上げ既存セッションを失効させた" };
}

// ── ログインの濫用対策 ──
// GASでは送信元IPを取得できない（リクエストヘッダー自体が取れないことを実測で確認済み）。
// そのためIPベースの制限は実装できない。代わりに
//   ①IDトークンの指紋 ②確定後のgoogle_sub ③全体の失敗率
// を使う。単なる呼び出し回数で全員を締め出すことは絶対にしない
// （攻撃者が数百回叩くだけで正規利用者をログイン不能にできてしまうため）。
const LOGIN_FP_MAX_PER_HOUR = 10;      // 同じIDトークン指紋からの試行
const LOGIN_SUB_MAX_PER_HOUR = 20;     // 本人確定後の試行
const BREAKER_WINDOW_MIN = 10;         // 障害率を見る窓
const BREAKER_MIN_SAMPLES = 8;
const BREAKER_FAIL_RATIO = 0.8;        // tokeninfo障害がこの割合を超えたら一時停止
const BREAKER_COOLDOWN_MIN = 5;

// ★数えるのは「失敗」だけ★
// 当初は試行のたびに数えていたが、Googleは同じログインセッション中は
// 同じIDトークンを返すため、正規の利用者が何度かやり直すだけで
// 同じ指紋が積み上がり、自分自身を締め出してしまった（2026-08-01に発生）。
// 総当たりを止めるのが目的なので、失敗回数だけを見る。
function rateCheck(key, maxPerHour) {
  const n = Number(CacheService.getScriptCache().get("rl_" + key) || 0);
  return { count: n, exceeded: n >= maxPerHour };
}
function rateFail(key) {
  const cache = CacheService.getScriptCache();
  const k = "rl_" + key;
  cache.put(k, String(Number(cache.get(k) || 0) + 1), 3600);
}
function rateClear(key) { try { CacheService.getScriptCache().remove("rl_" + key); } catch (e) {} }

// tokeninfo が連続して落ちている時だけ短時間止める。
// ★止まっている間も既存セッションは使える（verifySessionには影響しない）★
function breakerState() {
  const props = PropertiesService.getScriptProperties();
  const until = Number(props.getProperty("AUTH_BREAKER_UNTIL") || 0);
  if (until > Date.now()) return { open: true, until: new Date(until).toISOString() };
  return { open: false };
}
function breakerRecord(isFailure) {
  const cache = CacheService.getScriptCache();
  const kf = "brk_fail", kt = "brk_total";
  const total = Number(cache.get(kt) || 0) + 1;
  const fail = Number(cache.get(kf) || 0) + (isFailure ? 1 : 0);
  cache.put(kt, String(total), BREAKER_WINDOW_MIN * 60);
  cache.put(kf, String(fail), BREAKER_WINDOW_MIN * 60);
  if (total >= BREAKER_MIN_SAMPLES && (fail / total) >= BREAKER_FAIL_RATIO) {
    PropertiesService.getScriptProperties()
      .setProperty("AUTH_BREAKER_UNTIL", String(Date.now() + BREAKER_COOLDOWN_MIN * 60000));
    cache.remove(kf); cache.remove(kt);
    notifyAdminAuthAnomaly("tokeninfoの失敗が続いたため、ログインを" + BREAKER_COOLDOWN_MIN + "分間停止しました（既存のログインは影響なし）");
  }
}
// 管理者による即時解除
function breakerReset() {
  PropertiesService.getScriptProperties().deleteProperty("AUTH_BREAKER_UNTIL");
  try { CacheService.getScriptCache().remove("brk_fail"); CacheService.getScriptCache().remove("brk_total"); } catch (e) {}
  return { ok: true, reset: true };
}
// 異常時に管理者へ知らせる。1時間に1回までに抑える（通知で埋まらないように）
function notifyAdminAuthAnomaly(msg) {
  try {
    const cache = CacheService.getScriptCache();
    if (cache.get("auth_notice_sent")) return;
    cache.put("auth_notice_sent", "1", 3600);
    const admin = adminEmail();
    const u = sheetToObjects(getSheet("Users")).find(function (x) { return x.student_email === admin; });
    const text = "⚠️ JIROKU 認証の異常\n" + msg;
    if (u && u.line_user_id) { if (sendLineMessage(u.line_user_id, text)) return; }
    MailApp.sendEmail(admin, "JIROKU 認証の異常", text);
  } catch (e) { Logger.log("認証異常の通知に失敗: " + e); }
}

// ── ログイン開始（公開アクション）──
// state と nonce をサーバーで作り、ハッシュだけを保存する。
// 正はシート。CacheServiceは速度のためだけに使い、消えていてもシートで確認できる。
function authChallenge() {
  const challengeId = "ch_" + Utilities.getUuid();
  const state = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(
    Utilities.getUuid() + challengeId, Utilities.getUuid())).replace(/=+$/, "").slice(0, 32);
  const nonce = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(
    Utilities.getUuid() + "n" + challengeId, Utilities.getUuid())).replace(/=+$/, "").slice(0, 32);
  const now = new Date();
  const exp = new Date(now.getTime() + CHALLENGE_TTL_MS);
  getAuthSheet("AuthChallenges").appendRow([
    challengeId, sha256Hex(state), sha256Hex(nonce),
    now.toISOString(), exp.toISOString(), "", 0, "ISSUED"
  ]);
  try {
    CacheService.getScriptCache().put("ch_" + challengeId,
      JSON.stringify({ s: sha256Hex(state), n: sha256Hex(nonce), e: exp.getTime() }), 360);
  } catch (e) { /* キャッシュは無くても動く */ }
  return { ok: true, challenge_id: challengeId, state: state, nonce: nonce, expires_in: 300 };
}

// ★古いchallengeを捨てる★（2026-08-05）
//   AuthChallenges はログインのたびに1行ずつ増え、これまで一度も消していなかった。
//   13,000行を超えており、consumeChallenge が毎回この全部を読むため、
//   ログインが日に日に遅くなっていた。authChallenge は誰でも叩ける入口なので、
//   放っておくと際限なく増える。
//   行は必ず時系列で追記されるので、古い側をまとめて1回で消す。
function authPurgeOldChallenges() {
  const KEEP_DAYS = 7;
  const KEEP_MIN_ROWS = 500;          // 直近はどんなに古くても残す（調査用）
  const sh = getAuthSheet("AuthChallenges");
  const last = sh.getLastRow();
  if (last <= KEEP_MIN_ROWS + 1) return { ok: true, deleted: 0, note: "まだ少ないので何もしない" };
  const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const iCreated = h.indexOf("created_at");
  if (iCreated === -1) return { ok: false, error: "created_at 列がありません" };
  const cutoff = Date.now() - KEEP_DAYS * 86400000;
  const col = sh.getRange(2, iCreated + 1, last - 1, 1).getValues();
  // 何行目までが「古い」か（時系列に追記されている前提。念のため単調性は仮定せず全走査）
  let lastOld = 0;
  for (let i = 0; i < col.length; i++) {
    const t = new Date(String(col[i][0])).getTime();
    if (isFinite(t) && t < cutoff) lastOld = i + 1; else break;
  }
  // 直近 KEEP_MIN_ROWS 行は必ず残す
  const maxDeletable = (last - 1) - KEEP_MIN_ROWS;
  const n = Math.min(lastOld, maxDeletable);
  if (n <= 0) return { ok: true, deleted: 0 };
  sh.deleteRows(2, n);                // まとめて1回で消す
  return { ok: true, deleted: n, remaining: sh.getLastRow() - 1 };
}

// challenge を1回だけ消費する。成功・失敗にかかわらず再利用させない
function consumeChallenge(challengeId, state) {
  const sh = getAuthSheet("AuthChallenges");
  const data = sh.getDataRange().getValues();
  const h = data[0];
  const iId = h.indexOf("challenge_id"), iState = h.indexOf("state_hash"), iNonce = h.indexOf("nonce_hash");
  const iExp = h.indexOf("expires_at"), iUsed = h.indexOf("used_at"), iAtt = h.indexOf("attempt_count"), iRes = h.indexOf("result");
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][iId]) !== String(challengeId)) continue;
    const row = i + 1;
    const attempts = Number(data[i][iAtt] || 0) + 1;
    sh.getRange(row, iAtt + 1).setValue(attempts);
    const fail = (reason) => { sh.getRange(row, iRes + 1).setValue(reason); sh.getRange(row, iUsed + 1).setValue(new Date().toISOString()); return { ok: false, reason: reason }; };
    if (String(data[i][iUsed] || "").trim()) return { ok: false, reason: "CHALLENGE_ALREADY_USED" };
    if (attempts > CHALLENGE_MAX_ATTEMPTS) return fail("CHALLENGE_TOO_MANY_ATTEMPTS");
    if (new Date(String(data[i][iExp])).getTime() < Date.now()) return fail("CHALLENGE_EXPIRED");
    if (!safeEquals(sha256Hex(state), String(data[i][iState]))) return fail("STATE_MISMATCH");
    // ここまで通ったら消費する（nonceの照合は呼び出し側でIDトークンと突き合わせる）
    sh.getRange(row, iUsed + 1).setValue(new Date().toISOString());
    sh.getRange(row, iRes + 1).setValue("CONSUMED");
    try { CacheService.getScriptCache().remove("ch_" + challengeId); } catch (e) {}
    return { ok: true, nonceHash: String(data[i][iNonce]) };
  }
  return { ok: false, reason: "CHALLENGE_NOT_FOUND" };
}

// ── IDトークンの検証（短期: tokeninfo）──
// 【重要】これは緊急移行用。2026-08-31 / 法人導入前 / 利用者拡大前 の
// 最も早い時点までに、正式な検証基盤へ移行する。AUTH_PLAN.md 参照。
const AUTH_VERIFIER_MODE = "tokeninfo-2026-08";
const AUTH_VERSION = "cp1-2026-07-31";
const TEST_DEPLOYMENT_MARK = "AKfycbw-MhcAhOaqd_JJTlN4LltE";

// 実行中のデプロイを見分ける。本番と検証で同じスクリプトを共有しているため、
// スクリプトプロパティを1つにすると両方が同じ設定になってしまう。
function currentDeploymentId() {
  try { var u = ScriptApp.getService().getUrl() || ""; var m = u.match(/\/s\/([^\/]+)\//); return m ? m[1] : ""; }
  catch (e) { return ""; }
}
function isTestDeployment() { return currentDeploymentId().indexOf(TEST_DEPLOYMENT_MARK) === 0; }
function currentEnvironment() { return isTestDeployment() ? "TEST" : "PROD"; }

// 認証の段階をクライアントに推測させない。
//   LEGACY           … 認証基盤が未導入。従来ログインのみ
//   SESSION_OPTIONAL … 基盤は稼働。既存APIはまだ認証強制前。
//                      ただし認証に失敗しても従来ログインへ戻ってはいけない
//   SESSION_REQUIRED … セッション必須
function authMode() {
  const props = PropertiesService.getScriptProperties();
  const key = isTestDeployment() ? "AUTH_MODE_TEST" : "AUTH_MODE_PROD";
  const v = String(props.getProperty(key) || "").toUpperCase();
  if (["LEGACY", "SESSION_OPTIONAL", "SESSION_REQUIRED"].indexOf(v) !== -1) return v;
  return isTestDeployment() ? "SESSION_OPTIONAL" : "LEGACY"; // 本番の既定は安全側
}
function authConfig() {
  return { ok: true, auth_mode: authMode(), auth_version: AUTH_VERSION,
           verifier_mode: AUTH_VERIFIER_MODE, deployment_id: currentDeploymentId(),
           environment: currentEnvironment() };
}
// ★CP3/CP4の切り替え判断の土台★
// 「38名中◯名」では判断できない。38名のうち30名は元々記録していないので、
// 全員がセッションを持つのを待つと永久に切り替わらない。
// 逆に「8名を超えたら」という固定人数も、利用者が増えると意味が変わる。
// そこで「直近N日に実際に記録した人（active cohort）」を母数にする。
//
// 数え方は authInspect の usable と同一条件にすること。revoked_at が空なだけの
// セッションを数えると、token_version のずれで実際には使えないものが混ざり、
// 「普及した」と誤判断して記録できない人を出す。
function authCohort(days) {
  const nDays = (days > 0 && days <= 90) ? days : 7;
  const now = Date.now();
  const since = now - nDays * 86400000;

  // --- active cohort: 直近nDays日にDailyLogへ1件以上記録した人 ---
  const log = getSheet("DailyLog").getDataRange().getValues();
  const lh = log[0];
  const lEmail = lh.indexOf("student_email"), lDate = lh.indexOf("date");
  const lastRecord = {};   // email -> 最後に記録した日(yyyy-MM-dd)
  const recordCount = {};
  for (let i = 1; i < log.length; i++) {
    const em = String(log[i][lEmail] || "").trim();
    if (!em) continue;
    const raw = log[i][lDate];
    const d = raw instanceof Date ? Utilities.formatDate(raw, "Asia/Tokyo", "yyyy-MM-dd") : String(raw);
    if (!d) continue;
    if (!lastRecord[em] || d > lastRecord[em]) lastRecord[em] = d;
    if (new Date(d + "T00:00:00+09:00").getTime() >= since) {
      recordCount[em] = (recordCount[em] || 0) + 1;
    }
  }

  // --- 利用者台帳とセッション ---
  const users = sheetToObjects(getSheet("Users"));
  const byEmail = {};
  const tvByUser = {};
  users.forEach(function (u) {
    if (u.student_email) byEmail[String(u.student_email).trim()] = u;
    if (u.user_id) tvByUser[String(u.user_id)] = tokenVer_(u.token_version);
  });
  const ses = sheetToObjects(getAuthSheet("Sessions"));
  const hasUsable = {};   // user_id -> true
  ses.forEach(function (x) {
    if (String(x.revoked_at || "").trim()) return;
    if (new Date(String(x.expires_at)).getTime() <= now) return;
    const cur = tvByUser[String(x.user_id)];
    if (cur === undefined) return;
    if (tokenVer_(x.token_version) !== cur) return;
    hasUsable[String(x.user_id)] = true;
  });

  const cohort = [];
  Object.keys(recordCount).forEach(function (em) {
    const u = byEmail[em];
    cohort.push({
      emailHash: sha256Hex(em).slice(0, 10),   // 本文へメールを出さない
      records: recordCount[em],
      lastRecord: lastRecord[em] || "",
      inUsers: !!u,
      isActive: u ? String(u.is_active).toUpperCase() === "TRUE" : false,
      hasSession: !!(u && u.user_id && hasUsable[String(u.user_id)]),
      linked: !!(u && String(u.google_sub || "").trim()),
      line: !!(u && String(u.line_user_id || "").trim())
    });
  });
  cohort.sort(function (a, b) { return b.records - a.records; });

  const withSession = cohort.filter(function (c) { return c.hasSession; }).length;

  // --- 直近24時間のログイン失敗（未解決＝その後に成功していない指紋）---
  // ★検証環境の分を混ぜてはいけない★
  // スモークテストは毎回わざと壊れたトークンでログインを試みる。監査シートは
  // 本番と検証で共通なので、素直に数えると「未解決のログイン失敗57件」に見える。
  // 実体はテスト自身で、しかも同じ指紋を使い続けるので FP_RATE_LIMIT が積み上がる。
  // このままだと「直近24時間に未解決の失敗がない」という切り替え条件が永久に満たせない。
  const audit = sheetToObjects(getAuthSheet("AuthAudit"));
  const dayAgo = now - 86400000;
  const envAll = audit.filter(function (r) {
    const t = new Date(String(r.timestamp)).getTime();
    return t >= dayAgo && String(r.event_type || "").indexOf("LOGIN") === 0;
  });
  const recent = envAll.filter(function (r) {
    return String(r.environment || "").toUpperCase() !== "TEST";
  });
  const failures = recent.filter(function (r) { return String(r.result) !== "SUCCESS"; });
  const succeededFp = {};
  recent.forEach(function (r) {
    if (String(r.result) === "SUCCESS") succeededFp[String(r.credential_fingerprint || "")] = 1;
  });
  // 「その後ログインできた」失敗は未解決ではない。再試行で成功した人を
  // 障害として数えると、いつまでも切り替えられなくなる。
  //
  // ★指紋の一致だけでは足りない★
  // チャレンジが切れてやり直すと、Googleは新しいIDトークンを返すので指紋が変わる。
  // つまり「同じ指紋で成功したか」だけを見ると、実際には数十秒後にログインできた人まで
  // 未解決として数えてしまう。実測でも 01:28 の失敗3件の直後（01:29〜01:32）に
  // 成功セッションが発行されていた。
  // そこで時間的な近さも併用する。これは推定であって断定ではないため、
  // nearbySuccess として別に数え、判断材料として明示する。
  const successTimes = recent.filter(function (r) { return String(r.result) === "SUCCESS"; })
    .map(function (r) { return new Date(String(r.timestamp)).getTime(); });
  const RESOLVE_WINDOW_MS = 15 * 60 * 1000;
  function hasNearbySuccess(ts) {
    for (let i = 0; i < successTimes.length; i++) {
      const d = successTimes[i] - ts;
      if (d >= 0 && d <= RESOLVE_WINDOW_MS) return true;
    }
    return false;
  }
  const unresolved = failures.filter(function (r) {
    if (succeededFp[String(r.credential_fingerprint || "")]) return false;
    if (hasNearbySuccess(new Date(String(r.timestamp)).getTime())) return false;
    return true;
  });
  const reasons = {};
  unresolved.forEach(function (r) {
    const k = String(r.failure_reason || r.result || "UNKNOWN");
    reasons[k] = (reasons[k] || 0) + 1;
  });
  // ★件数だけでは「何人が困っているか」が分からない★
  // 1人が47回やり直した場合と、47人が1回ずつ失敗した場合では意味がまるで違う。
  // 前者は自分の検証の可能性が高く、後者は全員がログインできない障害。
  // 指紋の種類数と、指紋ごとの最終時刻で切り分ける。
  const fpAgg = {};
  unresolved.forEach(function (r) {
    const fp = String(r.credential_fingerprint || "(none)").slice(0, 10);
    if (!fpAgg[fp]) fpAgg[fp] = { fp: fp, count: 0, first: "", last: "", reasons: {} };
    const a = fpAgg[fp];
    a.count++;
    const t = String(r.timestamp);
    if (!a.first || t < a.first) a.first = t;
    if (!a.last || t > a.last) a.last = t;
    const k = String(r.failure_reason || r.result || "UNKNOWN");
    a.reasons[k] = (a.reasons[k] || 0) + 1;
  });
  const fpList = Object.keys(fpAgg).map(function (k) { return fpAgg[k]; })
    .sort(function (a, b) { return b.count - a.count; });

  // ★「探査由来」と「実フロー由来」を分ける★
  // 本番のスモークテストも同じ監査シートへ書く（environment=PROD）ので、
  // 環境だけでは切り分けられない。かといって「テストだ」と自己申告できる印を
  // 付けると、攻撃者が同じ印を付けて失敗を隠せてしまう。
  // そこで申告ではなく失敗理由で分類する。
  //   実フロー = チャレンジが実在した上での失敗（利用者が本当に困っている）
  //   探査     = 実在しないチャレンジ／その連打（正規の画面からは起きない）
  // どちらも捨てずに両方report する。判断は人間が行う。
  const REAL_FLOW_REASONS = { CHALLENGE_EXPIRED:1, CHALLENGE_ALREADY_USED:1,
                              STATE_MISMATCH:1, NONCE_MISMATCH:1, TOKEN_EXPIRED:1,
                              EMAIL_NOT_VERIFIED:1, USER_NOT_FOUND:1,
                              TOKENINFO_UNREACHABLE:1, AUD_MISMATCH:1 };
  const realFlow = unresolved.filter(function (r) {
    return REAL_FLOW_REASONS[String(r.failure_reason || "")];
  });
  const realFlowFp = {};
  realFlow.forEach(function (r) { realFlowFp[String(r.credential_fingerprint || "")] = 1; });

  return {
    ok: true,
    definition: "直近" + nDays + "日にDailyLogへ1件以上記録した利用者",
    windowDays: nDays,
    asOf: Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd HH:mm"),
    cohortSize: cohort.length,
    cohortWithSession: withSession,
    cohortAdoptionPct: cohort.length ? Math.round(withSession / cohort.length * 100) : 0,
    notInUsers: cohort.filter(function (c) { return !c.inUsers; }).length,
    // ★到達経路の内訳★ 案内をどのチャネルで送れば誰に届くかを出す。
    // メールアドレスはログインに使っているものなので原則到達するが、
    // 形式が壊れている行は「連絡できない」として別に数える。
    reach: (function () {
      const validEmail = function (u) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(u.student_email || "").trim()); };
      const line = users.filter(function (u) { return String(u.line_user_id || "").trim(); });
      const noLine = users.filter(function (u) { return !String(u.line_user_id || "").trim(); });
      return {
        total: users.length,
        lineReachable: line.length,
        lineUnlinked: noLine.length,
        emailReachable: users.filter(validEmail).length,
        unreachable: users.filter(function (u) { return !validEmail(u) && !String(u.line_user_id || "").trim(); }).length,
        cohortWithLine: cohort.filter(function (c) { return c.line; }).length,
        cohortWithoutLine: cohort.filter(function (c) { return !c.line; }).length,
        // アプリ内表示の対象＝セッションを持っていない人
        inAppTargets: users.filter(function (u) {
          return !(u.user_id && hasUsable[String(u.user_id)]);
        }).length
      };
    })(),
    registeredUsers: users.length,
    activeFlagUsers: users.filter(function (u) { return String(u.is_active).toUpperCase() === "TRUE"; }).length,
    login24h: { scope: "本番のみ（検証環境の行は除外）",
                excludedTestRows: envAll.length - recent.length,
                total: recent.length, failures: failures.length,
                unresolved: unresolved.length, reasons: reasons,
                // 切り替え判断に使うのはこちら（実フロー由来の未解決）
                realFlowUnresolved: realFlow.length,
                realFlowPeople: Object.keys(realFlowFp).length,
                distinctFingerprints: fpList.length, byFingerprint: fpList },
    cohort: cohort
  };
}
// 全利用者のセッションを失効させる。
// token_version を1つ上げると、その利用者の既存セッションはすべて
// verifySession の版チェックで落ちる（Sessionsシートを書き換えなくてよい）。
//
// ★実際に使えるセッションを持っている人だけを対象にする★
// 全員の token_version を上げると、一度もログインしていない30人ぶんまで
// 無駄に版が進み、後から「なぜ上がっているのか」が分からなくなる。
function authRevokeAllUsers(confirm, reason) {
  const sh = getSheet("Users");
  const data = sh.getDataRange().getValues();
  const h = data[0];
  const iEmail = h.indexOf("student_email"), iUid = h.indexOf("user_id"), iTv = h.indexOf("token_version");
  if (iTv === -1 || iUid === -1) return { ok: false, error: "Users に user_id / token_version 列がありません" };

  // いま実際に使えるセッションを持っている人（authCohort と同一条件）
  const tvByUser = {};
  for (let i = 1; i < data.length; i++) {
    if (data[i][iUid]) tvByUser[String(data[i][iUid])] = tokenVer_(data[i][iTv]);
  }
  const now = Date.now();
  const hasUsable = {};
  let usableSessions = 0;
  sheetToObjects(getAuthSheet("Sessions")).forEach(function (x) {
    if (String(x.revoked_at || "").trim()) return;
    if (new Date(String(x.expires_at)).getTime() <= now) return;
    const cur = tvByUser[String(x.user_id)];
    if (cur === undefined) return;
    if (tokenVer_(x.token_version) !== cur) return;
    hasUsable[String(x.user_id)] = true;
    usableSessions++;
  });

  const targets = [];
  for (let i = 1; i < data.length; i++) {
    const uid = String(data[i][iUid] || "");
    if (!uid || !hasUsable[uid]) continue;
    targets.push({ row: i + 1, uid: uid, tv: tokenVer_(data[i][iTv]) });
  }

  // 消すキャッシュのキーを先に集める。
  // verifySession は "sess_" + sha256Hex(token) をキーにしており、
  // シートに入っている session_token_hash がその sha256Hex そのもの。
  const cacheKeys = [];
  sheetToObjects(getAuthSheet("Sessions")).forEach(function (x) {
    if (hasUsable[String(x.user_id)]) cacheKeys.push("sess_" + String(x.session_token_hash));
  });

  if (!confirm) {
    return { ok: true, dryRun: true, usableSessions: usableSessions,
             affectedUsers: targets.length,
             note: "confirm=yes を付けると実行します。全員が再ログインになります（記録は消えません）" };
  }

  targets.forEach(function (t) {
    sh.getRange(t.row, iTv + 1).setValue(t.tv + 1);
  });
  // ★サーバー側のキャッシュも消す★
  // verifySession は判定結果を300秒キャッシュする。消さないと最大5分間、
  // 失効させたはずのセッションが通り続ける。
  // removeAll に空配列を渡しても何も消えないので、キーを明示して渡す。
  try { if (cacheKeys.length) CacheService.getScriptCache().removeAll(cacheKeys); } catch (e) {}
  authAudit("REVOKE_ALL_USERS", { result: "SUCCESS", action: "authRevokeAllUsers",
            failureReason: reason + " / users=" + targets.length + " sessions=" + usableSessions });

  return { ok: true, dryRun: false, usableSessions: usableSessions,
           affectedUsers: targets.length, reason: reason };
}

function verifyIdToken(idToken, expectedNonceHash) {
  if (!idToken) return { ok: false, reason: "NO_ID_TOKEN" };
  let res;
  try {
    res = UrlFetchApp.fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken),
      { muteHttpExceptions: true });
  } catch (e) {
    return { ok: false, reason: "TOKENINFO_UNREACHABLE" }; // タイムアウトも拒否。フォールバックしない
  }
  if (res.getResponseCode() !== 200) return { ok: false, reason: "TOKENINFO_HTTP_" + res.getResponseCode() };
  let p;
  try { p = JSON.parse(res.getContentText()); } catch (e) { return { ok: false, reason: "TOKENINFO_BAD_JSON" }; }

  const nowSec = Math.floor(Date.now() / 1000);
  if (!safeEquals(p.aud, GOOGLE_CLIENT_ID_SERVER)) return { ok: false, reason: "AUD_MISMATCH" };
  if (["accounts.google.com", "https://accounts.google.com"].indexOf(String(p.iss)) === -1) return { ok: false, reason: "ISS_MISMATCH" };
  if (!p.exp || Number(p.exp) <= nowSec) return { ok: false, reason: "TOKEN_EXPIRED" };
  if (!p.iat || Number(p.iat) < nowSec - 3600) return { ok: false, reason: "IAT_TOO_OLD" };
  if (String(p.email_verified) !== "true" && p.email_verified !== true) return { ok: false, reason: "EMAIL_NOT_VERIFIED" };
  if (!p.sub) return { ok: false, reason: "NO_SUB" };
  if (!p.nonce || !safeEquals(sha256Hex(p.nonce), expectedNonceHash)) return { ok: false, reason: "NONCE_MISMATCH" };

  return { ok: true, sub: String(p.sub), email: String(p.email || "").trim().toLowerCase(), hd: String(p.hd || "") };
}

// アクセストークンによる本人確認（コーチCRM用）。
// コーチCRMはポップアップ方式(initTokenClient)でアクセストークンを取るため、
// IDトークンの往復ができない。tokeninfo でトークンの発行先(aud/azp)が
// JIROKU自身であることを確かめてから本人を確定する。
// ★aud/azpの確認が要（これを省くと、別アプリ向けに発行されたトークンを
//   持ち込まれてログインできてしまう）★
function verifyAccessToken(accessToken) {
  if (!accessToken) return { ok: false, reason: "NO_ACCESS_TOKEN" };
  let res;
  try {
    res = UrlFetchApp.fetch("https://oauth2.googleapis.com/tokeninfo?access_token=" + encodeURIComponent(accessToken),
      { muteHttpExceptions: true });
  } catch (e) { return { ok: false, reason: "TOKENINFO_UNREACHABLE" }; }
  if (res.getResponseCode() !== 200) return { ok: false, reason: "TOKENINFO_HTTP_" + res.getResponseCode() };
  let p;
  try { p = JSON.parse(res.getContentText()); } catch (e) { return { ok: false, reason: "TOKENINFO_BAD_JSON" }; }

  const issuedTo = String(p.azp || p.aud || "");
  if (!safeEquals(issuedTo, GOOGLE_CLIENT_ID_SERVER)) return { ok: false, reason: "AUD_MISMATCH" };
  if (!p.exp || Number(p.exp) <= Math.floor(Date.now() / 1000)) return { ok: false, reason: "TOKEN_EXPIRED" };
  if (String(p.email_verified) !== "true" && p.email_verified !== true) return { ok: false, reason: "EMAIL_NOT_VERIFIED" };
  if (!p.sub) return { ok: false, reason: "NO_SUB" };
  return { ok: true, sub: String(p.sub), email: String(p.email || "").trim().toLowerCase(), hd: String(p.hd || "") };
}

// コーチCRMからのログイン。challengeは使わない（リダイレクトを伴わないため
// state/nonceの往復ができない）。代わりにaud確認と有効期限で担保する。
function authLoginAccess(body) {
  const generic = { ok: false, error: "ログインできませんでした。管理者へ確認してください" };
  const fp = body.accessToken ? sha256Hex(body.accessToken).slice(0, 16) : "";
  const fail = function (reason) {
    if (fp) rateFail("fpa_" + fp);
    authAudit("LOGIN_ACCESS", { result: "FAIL", failureReason: reason, action: "loginAccess", credentialFingerprint: fp });
    return generic;
  };
  const brk = breakerState();
  if (brk.open) return { ok: false, error: "ただいまログインが混み合っています。数分後にもう一度お試しください" };
  if (fp && rateCheck("fpa_" + fp, LOGIN_FP_MAX_PER_HOUR).exceeded) return fail("FP_RATE_LIMIT");

  const v = verifyAccessToken(body.accessToken);
  breakerRecord(!v.ok && String(v.reason).indexOf("TOKENINFO_") === 0);
  if (!v.ok) return fail(v.reason);
  if (rateCheck("sub_" + v.sub, LOGIN_SUB_MAX_PER_HOUR).exceeded) return fail("SUB_RATE_LIMIT");
  if (isTestDeployment() && v.email !== String(adminEmail()).toLowerCase()) return fail("TEST_ENV_ADMIN_ONLY");

  const u = resolveUserByIdentity(v.sub, v.email, v.hd);
  if (!u.ok) return fail(u.reason);

  const userRow = sheetToObjects(getSheet("Users")).find(function (x) { return String(x.user_id) === String(u.userId); }) || {};
  const sess = issueSession({ userId: u.userId, sub: v.sub, role: userRow.role || "USER",
                              organizationId: userRow.organization_id || "", tokenVersion: tokenVer_(userRow.token_version) }, String((body && body.device) || ""));
  authAudit("LOGIN_ACCESS", { result: "SUCCESS", actorUserId: u.userId, action: "loginAccess",
                              credentialFingerprint: fp, failureReason: u.linked ? "sub_linked" : "" });
  return { ok: true, token: sess.token, expiresAt: sess.expiresAt,
           user: { email: u.email, role: userRow.role || "USER" } };
}

// ── google_sub と既存ユーザーの紐づけ ──
// ログインだけでUsers行を作らない（招待制のため）
function resolveUserByIdentity(sub, email, hd) {
  const sh = getSheet("Users");
  const data = sh.getDataRange().getValues();
  const h = data[0];
  const iEmail = h.indexOf("student_email"), iSub = h.indexOf("google_sub");
  const iActive = h.indexOf("is_active"), iUid = h.indexOf("user_id");
  const iLinked = h.indexOf("auth_linked_at"), iRole = h.indexOf("role");
  if (iSub === -1) return { ok: false, reason: "AUTH_COLUMNS_MISSING" };

  // ① 検証済み sub で探す（メールが変わっていても同一人物）
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][iSub] || "").trim() && safeEquals(String(data[i][iSub]).trim(), sub)) {
      if (String(data[i][iActive]).toUpperCase() !== "TRUE") return { ok: false, reason: "USER_INACTIVE" };
      return { ok: true, row: i + 1, userId: ensureUserId(sh, i + 1, iUid, data[i][iUid]),
               email: String(data[i][iEmail]), role: String(data[i][iRole] || "USER") };
    }
  }
  // ② sub 未登録の時だけ、検証済み email で探す
  const norm = (v) => String(v || "").trim().toLowerCase();
  const matches = [];
  for (let i = 1; i < data.length; i++) if (norm(data[i][iEmail]) === norm(email)) matches.push(i);
  if (matches.length === 0) return { ok: false, reason: "AUTH_NOT_INVITED" };
  if (matches.length > 1) return { ok: false, reason: "DUPLICATE_EMAIL_ROWS" }; // 曖昧なので拒否
  const i = matches[0];
  if (String(data[i][iSub] || "").trim()) return { ok: false, reason: "SUB_ALREADY_LINKED_TO_OTHER" };
  if (String(data[i][iActive]).toUpperCase() !== "TRUE") return { ok: false, reason: "USER_INACTIVE" };
  // Gmail以外かつhd無し＝ドメインの持ち主を確認できないので、自動では紐づけない
  const isGmail = /@gmail\.com$/.test(norm(email));
  if (!isGmail && !hd) return { ok: false, reason: "NEEDS_ADMIN_APPROVAL" };

  sh.getRange(i + 1, iSub + 1).setValue(sub);                       // 1回だけ紐づける
  if (iLinked !== -1) sh.getRange(i + 1, iLinked + 1).setValue(new Date().toISOString());
  return { ok: true, row: i + 1, userId: ensureUserId(sh, i + 1, iUid, data[i][iUid]),
           email: String(data[i][iEmail]), role: String(data[i][iRole] || "USER"), linked: true };
}
function ensureUserId(sheet, rowNum, colIdx, current) {
  if (colIdx === -1) return "";
  const v = String(current || "").trim();
  if (v) return v;
  const id = "u_" + Utilities.getUuid().slice(0, 12);
  sheet.getRange(rowNum, colIdx + 1).setValue(id);
  return id;
}

// ── セッションの発行 ──
// device: 「どの環境から・どの方式でログインしたか」の短いラベル。
// ★ここを記録していなかった★ 列はあったのに常に空だった。
// そのため「スマホで通ったのか」「公式ボタンだったのかリダイレクトだったのか」を
// 毎回Kaiに口頭で聞くしかなかった。聞かなくても分かるようにする。
// 個人を特定する情報は入れない（UAそのものは保存しない）。
function issueSession(user, device) {
  const sh = getAuthSheet("Sessions");
  const token = newSessionToken(user.userId);
  const now = new Date();
  const exp = new Date(now.getTime() + SESSION_ABSOLUTE_DAYS * 86400000);

  // 同時端末数の上限。超える分は古い順に失効させる
  const data = sh.getDataRange().getValues();
  const h = data[0];
  const iUid = h.indexOf("user_id"), iRev = h.indexOf("revoked_at"), iCreated = h.indexOf("created_at");
  const alive = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][iUid]) === String(user.userId) && !String(data[i][iRev] || "").trim()) {
      alive.push({ row: i + 1, created: String(data[i][iCreated]) });
    }
  }
  alive.sort((a, b) => a.created > b.created ? 1 : -1);
  while (alive.length >= SESSION_MAX_DEVICES) {
    const old = alive.shift();
    sh.getRange(old.row, iRev + 1).setValue(now.toISOString());
  }

  sh.appendRow([
    sha256Hex(token), user.userId, user.sub, user.role || "USER", user.organizationId || "",
    exp.toISOString(), now.toISOString(), now.toISOString(), "", Number(user.tokenVersion || 0),
    String(device || "").slice(0, 40)
  ]);
  return { token: token, expiresAt: exp.toISOString() };
}

// ── セッションの検証 ──
// Sessionsシートが正。CacheServiceは速度のためだけに使い、消えていてもシートで確認する。
// 破壊的な操作では allowCache=false にして必ずシートを読む。
function verifySession(token, allowCache) {
  if (!token) return { ok: false, reason: "NO_TOKEN" };
  const hash = sha256Hex(token);
  const cacheKey = "sess_" + hash;
  const cache = CacheService.getScriptCache();

  if (allowCache !== false) {
    try {
      const c = cache.get(cacheKey);
      if (c) {
        const o = JSON.parse(c);
        // キャッシュに載っていても期限は必ず見る
        if (new Date(o.expiresAt).getTime() > Date.now()) return { ok: true, cached: true, actor: o };
        cache.remove(cacheKey);
      }
    } catch (e) { /* キャッシュ不調でもシートで続行 */ }
  }

  const sh = getAuthSheet("Sessions");
  const data = sh.getDataRange().getValues();
  const h = data[0];
  const iHash = h.indexOf("session_token_hash"), iUid = h.indexOf("user_id"), iSub = h.indexOf("google_sub");
  const iRole = h.indexOf("role"), iOrg = h.indexOf("organization_id"), iExp = h.indexOf("expires_at");
  const iSeen = h.indexOf("last_seen_at"), iRev = h.indexOf("revoked_at"), iTv = h.indexOf("token_version");

  for (let i = 1; i < data.length; i++) {
    if (!safeEquals(String(data[i][iHash]), hash)) continue;
    if (String(data[i][iRev] || "").trim()) return { ok: false, reason: "SESSION_REVOKED" };
    const now = Date.now();
    if (new Date(String(data[i][iExp])).getTime() <= now) return { ok: false, reason: "SESSION_EXPIRED" };
    const lastSeen = new Date(String(data[i][iSeen] || data[i][h.indexOf("created_at")])).getTime();
    if (now - lastSeen > SESSION_IDLE_DAYS * 86400000) {
      sh.getRange(i + 1, iRev + 1).setValue(new Date().toISOString());
      return { ok: false, reason: "SESSION_IDLE_EXPIRED" };
    }
    // ユーザー側の失効条件（token_version・無効化・subの不整合）を確認する
    const user = sheetToObjects(getSheet("Users")).find(u => String(u.user_id) === String(data[i][iUid]));
    if (!user) return { ok: false, reason: "USER_NOT_FOUND" };
    if (String(user.is_active).toUpperCase() !== "TRUE") return { ok: false, reason: "USER_INACTIVE" };
    if (tokenVer_(user.token_version) !== tokenVer_(data[i][iTv])) return { ok: false, reason: "TOKEN_VERSION_CHANGED" };
    if (String(user.google_sub || "") !== String(data[i][iSub])) return { ok: false, reason: "SUB_MISMATCH" };

    sh.getRange(i + 1, iSeen + 1).setValue(new Date().toISOString());
    const actor = {
      actor_user_id: String(data[i][iUid]), google_sub: String(data[i][iSub]),
      email: String(user.student_email), role: String(user.role || data[i][iRole] || "USER"),
      organization_id: String(data[i][iOrg] || ""), expiresAt: String(data[i][iExp])
    };
    try { cache.put(cacheKey, JSON.stringify(actor), 300); } catch (e) {}
    return { ok: true, cached: false, actor: actor };
  }
  return { ok: false, reason: "SESSION_NOT_FOUND" };
}

function revokeSession(token) {
  const hash = sha256Hex(token);
  const sh = getAuthSheet("Sessions");
  const data = sh.getDataRange().getValues();
  const h = data[0];
  const iHash = h.indexOf("session_token_hash"), iRev = h.indexOf("revoked_at");
  for (let i = 1; i < data.length; i++) {
    if (!safeEquals(String(data[i][iHash]), hash)) continue;
    sh.getRange(i + 1, iRev + 1).setValue(new Date().toISOString());
    try { CacheService.getScriptCache().remove("sess_" + hash); } catch (e) {}
    return { ok: true };
  }
  return { ok: true, notFound: true }; // 存在しなくても成功扱い（情報を漏らさない）
}

// ── ログイン（公開アクション）──
// 失敗理由はユーザーへ返さず、AuthAuditにだけ残す
function authLogin(body) {
  const generic = { ok: false, error: "ログインできませんでした。管理者へ確認してください" };
  const fp = body.idToken ? sha256Hex(body.idToken).slice(0, 16) : "";
  const fail = function (reason) {
    if (fp) rateFail("fp_" + fp);
    authAudit("LOGIN", { result: "FAIL", failureReason: reason, action: "login", credentialFingerprint: fp });
    return generic;
  };

  const brk = breakerState();
  if (brk.open) return { ok: false, error: "ただいまログインが混み合っています。数分後にもう一度お試しください" };

  // 同じIDトークンを何度も投げ込むのを止める（IPが使えないための代替）
  if (fp && rateCheck("fp_" + fp, LOGIN_FP_MAX_PER_HOUR).exceeded) return fail("FP_RATE_LIMIT");

  const ch = consumeChallenge(body.challenge_id, body.state);
  if (!ch.ok) return fail(ch.reason);

  const v = verifyIdToken(body.idToken, ch.nonceHash);
  breakerRecord(!v.ok && String(v.reason).indexOf("TOKENINFO_") === 0);
  if (!v.ok) return fail(v.reason);

  if (rateCheck("sub_" + v.sub, LOGIN_SUB_MAX_PER_HOUR).exceeded) return fail("SUB_RATE_LIMIT");

  // 検証環境は本番と同じスプレッドシートを見ている。
  // 一般利用者が ?gas=test を付けて別の認証状態に入れないよう、管理者だけに限定する
  if (isTestDeployment() && v.email !== String(adminEmail()).toLowerCase()) return fail("TEST_ENV_ADMIN_ONLY");

  const u = resolveUserByIdentity(v.sub, v.email, v.hd);
  if (!u.ok) return fail(u.reason);

  const userRow = sheetToObjects(getSheet("Users")).find(x => String(x.user_id) === String(u.userId)) || {};
  const sess = issueSession({ userId: u.userId, sub: v.sub, role: userRow.role || "USER",
                              organizationId: userRow.organization_id || "", tokenVersion: tokenVer_(userRow.token_version) }, String((body && body.device) || ""));
  if (fp) rateClear("fp_" + fp);
  rateClear("sub_" + v.sub);
  authAudit("LOGIN", { result: "SUCCESS", actorUserId: u.userId, action: "login",
                       credentialFingerprint: fp, failureReason: u.linked ? "sub_linked" : "" });
  return { ok: true, token: sess.token, expiresAt: sess.expiresAt,
           user: { email: u.email, role: userRow.role || "USER" } };
}

// ══════════════════════════════════════════════════════════════════
// Auth CP2: 高リスクAPIの認可
//
// 【原則】ここに登録されていないアクションは、この仕組みの対象外（従来どおり）。
// CP3・CP4で対象を広げ、最終的に「登録が無ければ拒否」へ寄せる。
// 今は「一斉送信・削除・個人情報の一覧」といった被害の大きい操作から先に閉じる。
//
// roles      … このアクションを実行できるロール
// scope      … SELF=自分だけ / ASSIGNED=担当関係のある相手 / GLOBAL=全体
// audit      … 監査ログに必ず残す
// noCache    … セッション検証でキャッシュを使わない（権限剥奪の直後を許さない）
// ══════════════════════════════════════════════════════════════════
const ACTION_POLICIES = {
  // 一斉送信・キャンペーン（最も被害が大きい）
  adminBroadcastLine:       { roles: ["JIROKU_ADMIN"], scope: "GLOBAL",   audit: true, noCache: true },
  adminSendStudentCampaign: { roles: ["JIROKU_ADMIN"], scope: "GLOBAL",   audit: true, noCache: true },
  // 個別送信
  coachSendStudentMessage:  { roles: ["COACH","JIROKU_ADMIN"], scope: "ASSIGNED", audit: true, noCache: true },
  coachGenerateStudentMessage: { roles: ["COACH","JIROKU_ADMIN"], scope: "ASSIGNED", audit: true },
  coachGenerateNudgeMessage:{ roles: ["COACH","JIROKU_ADMIN"], scope: "ASSIGNED", audit: true },
  // 削除
  coachDeleteFile:          { roles: ["COACH","JIROKU_ADMIN"], scope: "ASSIGNED", audit: true, noCache: true },
  coachDeleteNote:          { roles: ["COACH","JIROKU_ADMIN"], scope: "ASSIGNED", audit: true, noCache: true },
  coachDeleteLead:          { roles: ["COACH","JIROKU_ADMIN"], scope: "ASSIGNED", audit: true, noCache: true },
  // 個人情報の取得
  coachGetStudents:         { roles: ["COACH","JIROKU_ADMIN"], scope: "GLOBAL" },
  coachGetStudentDetail:    { roles: ["COACH","JIROKU_ADMIN"], scope: "ASSIGNED" },
  coachPrepSummary:         { roles: ["COACH","JIROKU_ADMIN"], scope: "ASSIGNED" },
  generateTalentReport:     { roles: ["COACH","JIROKU_ADMIN"], scope: "ASSIGNED", audit: true },
  adminGetOverview:         { roles: ["JIROKU_ADMIN"], scope: "GLOBAL" },
  adminListRecentRegistrations: { roles: ["JIROKU_ADMIN"], scope: "GLOBAL" },
  adminAiUsage:             { roles: ["JIROKU_ADMIN"], scope: "GLOBAL" },
  // 利用者データの一括書き換え
  coachSetCohort:           { roles: ["JIROKU_ADMIN"], scope: "GLOBAL", audit: true, noCache: true },
  coachSetPlanStatus:       { roles: ["COACH","JIROKU_ADMIN"], scope: "ASSIGNED", audit: true, noCache: true },
  coachSetShowInCommunity:  { roles: ["COACH","JIROKU_ADMIN"], scope: "ASSIGNED", audit: true },
  adminTagCohortByEmails:   { roles: ["JIROKU_ADMIN"], scope: "GLOBAL", audit: true, noCache: true },
  adminTagCohortByJoinDate: { roles: ["JIROKU_ADMIN"], scope: "GLOBAL", audit: true, noCache: true },
  // 運用操作
  adminSetupTriggers:       { roles: ["JIROKU_ADMIN"], scope: "GLOBAL", audit: true, noCache: true },
  adminInstallTrigger:      { roles: ["JIROKU_ADMIN"], scope: "GLOBAL", audit: true, noCache: true },
  adminRunNightlyReport:    { roles: ["JIROKU_ADMIN"], scope: "GLOBAL", audit: true },
  adminRunNightlyCoachMessage: { roles: ["JIROKU_ADMIN"], scope: "GLOBAL", audit: true },
  adminBackfillReports:     { roles: ["JIROKU_ADMIN"], scope: "GLOBAL", audit: true },
  adminBackfillReportsForDate: { roles: ["JIROKU_ADMIN"], scope: "GLOBAL", audit: true },
  adminBackfillCalendar:    { roles: ["JIROKU_ADMIN"], scope: "GLOBAL", audit: true },
  adminDedupeCalendar:      { roles: ["JIROKU_ADMIN"], scope: "GLOBAL", audit: true },
  adminRepairStreaksFreeze: { roles: ["JIROKU_ADMIN"], scope: "GLOBAL", audit: true },
  adminOpsHealthCheck:      { roles: ["JIROKU_ADMIN"], scope: "GLOBAL" },
  adminSystemHealth:        { roles: ["JIROKU_ADMIN"], scope: "GLOBAL" }
};

// ── CP3: 本人の書き込みAPI ──
// いずれも scope="SELF"。セッションから確定した本人の行だけを書き換えられる。
// クライアントが送る studentEmail は無視して、必ず本人で上書きする。
const ACTION_POLICIES_WRITE = {
  saveLog:{}, saveLogMulti:{}, quickLog:{}, deleteLog:{}, updateLogTime:{}, setLogClassification:{}, saveDayPlan:{}, saveWeeklyAvailable:{}, saveSettings:{}, saveOnboarding:{},
  saveTodayActions:{}, saveGoal:{}, saveWeeklyGoal:{}, archiveGoalItem:{}, migrateLocalTasks:{},
  addGoalEntry:{}, updateGoalEntry:{}, deleteGoalEntry:{},
  saveTask:{}, deleteTask:{}, carryOverTask:{}, saveTaskMutations:{}, saveSprint:{}, migrateTasksToSheet:{},
  submitSurvey:{}, syncCalendar:{}, sendMessage:{}, saveWeeklyReflection:{}, saveContentProfile:{},
  generateWorkReport:{}, snsSaveAccount:{}, snsSaveMetrics:{}, snsSavePost:{}
};
// ── CP4: 本人データの読み取りAPI ──
// ランキングや「みんなの頑張り」は共有情報なのでここには入れない
const ACTION_POLICIES_READ = {
  getUser:{}, getLogs:{}, getReport:{}, getReportList:{}, getHomeData:{}, getGoalTree:{},
  getReportHome:{}, getReportDetail:{}, getRoadmap:{}, listGoalEntries:{},
  getGameStatus:{}, getJournal:{}, getInsights:{}, getWeeklySummary:{}, getMonthlyReview:{}, getSelfMgmtPower:{}, getDailyOpsReport:{}, getDayPlan:{},
  getTimeUse:{}, getAchievements:{}, getMessages:{}, p1Status2:{}, getTasks:{}, getSprints:{}
};

// 段階的に有効化するためのスイッチ。スクリプトプロパティで切り替えるので、
// 有効化・巻き戻しにデプロイが要らない（本番と検証で別々に設定できる）。
//   AUTH_ENFORCE_WRITE_PROD / AUTH_ENFORCE_WRITE_TEST
//   AUTH_ENFORCE_READ_PROD  / AUTH_ENFORCE_READ_TEST
function enforceFlag(kind) {
  const props = PropertiesService.getScriptProperties();
  const on = function (k) { return String(props.getProperty(k) || "").toUpperCase() === "ON"; };
  const prod = on("AUTH_ENFORCE_" + kind + "_PROD");
  if (!isTestDeployment()) return prod;
  // ★検証環境は本番と同じスプレッドシート（本番データ）を見ている。
  //   本番だけ強制を有効にすると、検証環境が認証の抜け道になってしまう。
  //   そこで「本番で有効なら検証でも必ず有効」を下限にする。
  //   検証だけ先に厳しくすることはできる（先行検証のため）。
  return prod || on("AUTH_ENFORCE_" + kind + "_TEST");
}
// ★トークンが付いているのに無効なら、必ず拒否する★
//
// なぜ必要か:
//   強制スイッチがOFFの間、ポリシー対象外のアクション（getUser等）は
//   トークンを一切見ていなかった。壊れたトークンを付けても素通りする。
//   仕様としては「まだ強制していない」だけなのだが、実害がある:
//     セッションが失効しても従来経路で動き続ける
//     → 利用者は気づかない／普及率も健全に見える
//     → スイッチを入れた瞬間に全員が一斉に止まる
//   つまり「静かに壊れている」状態を作る。だから、
//   トークンを送ってきたのに無効なら、段階に関係なく拒否する。
//
// トークンが無い場合は SESSION_OPTIONAL の間だけ従来経路を許す。
// ★無効なトークンで従来経路へ縮退させてはいけない★（それが一番危ない）

// トークンの有無に関係なく通してよいもの。ログインの入口そのもの。
// ここを拒否すると、失効した人が再ログインできなくなって詰む。
const PUBLIC_ACTIONS = {
  authChallenge: 1, login: 1, loginAccess: 1, authConfig: 1, healthCheck: 1,
  // 起動に失敗した端末からも受け取りたいので、ログイン前でも通す。
  // 保存するのは件数制限つきの最小限の情報だけ（recordClientError 参照）
  clientError: 1
};

function strictTokenCheck(action, token) {
  if (!token) return { ok: true };                       // 未提示は従来どおり
  if (PUBLIC_ACTIONS[String(action || "")]) return { ok: true };
  if (!enforceFlag("STRICTTOKEN")) return { ok: true };  // スイッチOFFの間は従来どおり

  const v = verifySession(token, false);   // 失効を即座に反映するためキャッシュを使わない
  if (v.ok) return { ok: true, actor: v.actor };

  authAudit("SESSION_INVALID", { result: "DENY", failureReason: v.reason || "UNKNOWN", action: action });
  // ★理由を細かく返さない★ ただしクライアントが「再ログインすれば直る」と
  // 判断できる必要があるので、SESSION_INVALID という一種類だけは返す。
  // FORBIDDEN（権限不足）と混ぜると、再ログインの無限ループになる。
  return { ok: false, error: "SESSION_INVALID" };
}

// 段階に応じて、そのアクションに適用するポリシーを返す
function policyFor(action) {
  if (ACTION_POLICIES[action]) return ACTION_POLICIES[action];

  // ★fail-closed★ admin* / coach* で始まるものは、台帳に書き忘れても公開しない。
  // 「ポリシーに書かなかったので従来どおり誰でも叩ける」という状態を作らないため。
  // 個別に登録すればそちらが優先される（上のACTION_POLICIES）。
  const a = String(action || "");
  if (a.indexOf("admin") === 0) return { roles: ["JIROKU_ADMIN"], scope: "GLOBAL", audit: true };
  if (a.indexOf("coach") === 0) return { roles: ["COACH", "JIROKU_ADMIN"], scope: "ASSIGNED", audit: true };

  if (enforceFlag("WRITE") && ACTION_POLICIES_WRITE[action]) {
    return { roles: ["USER","COACH","JIROKU_ADMIN"], scope: "SELF" };
  }
  if (enforceFlag("READ") && ACTION_POLICIES_READ[action]) {
    return { roles: ["USER","COACH","JIROKU_ADMIN"], scope: "SELF" };
  }

  // ★SESSION_REQUIRED ─ 取りこぼしを潰す最後の段階★
  //
  // WRITE / READ は「対象を列挙して守る」方式なので、
  // 列挙し忘れたアクションは素通りする。実際 ACTION_POLICIES_WRITE には
  // 20件、READ には15件しか載っておらず、それ以外は無防備のまま。
  // 列挙を増やし続けても、新しいアクションを足すたびに書き忘れる。
  //
  // SESSION_REQUIRED では逆にする。
  // 「明示的に公開したもの以外はすべて要認証」。書き忘れても守られる。
  //
  // ★この判定はここまでの分岐をすべて通り抜けた後に置くこと★
  // 先に置くと admin/coach の厳しいポリシーを上書きして緩めてしまう。
  if (authMode() === "SESSION_REQUIRED" && !SESSION_REQUIRED_EXEMPT[String(action || "")]) {
    return { roles: ["USER","COACH","JIROKU_ADMIN"], scope: "SELF" };
  }
  return null;
}

// SESSION_REQUIRED でも認証を求めないもの。
// ここを絞りすぎると「新規登録できない」「失効した人がログインできない」
// という詰みが起きるので、入口だけは必ず開けておく。
const SESSION_REQUIRED_EXEMPT = {
  authChallenge: 1, login: 1, loginAccess: 1, authConfig: 1, healthCheck: 1
  // ★registerUser は外した★（2026-08-01）
  //   招待制なので「登録で行を作る」必要が無い。Kaiが先に行を用意し、
  //   その人がログインするとセッションが出る。プロフィールの記入は
  //   そのセッションを使って行う。免除に入れていたせいで、
  //   誰でも任意のメールで有効な利用者を作れる穴になっていた。
};

// COACHが相手を見てよいか。担当関係は CoachingNotes / Users.coach_email で判断する
function isAssignedTo(actorEmail, targetEmail) {
  if (!targetEmail) return true;              // 相手を指定しない操作（一覧など）は scope 側で判断
  const t = String(targetEmail).trim().toLowerCase();
  const a = String(actorEmail).trim().toLowerCase();
  if (t === a) return true;                   // 自分自身は常に可
  try {
    const u = sheetToObjects(getSheet("Users"))
      .find(function (x) { return String(x.student_email || "").trim().toLowerCase() === t; });
    if (u && String(u.coach_email || "").trim().toLowerCase() === a) return true;
  } catch (e) {}
  try {
    const hit = sheetToObjects(getSheet("CoachingNotes")).some(function (n) {
      return String(n.coach_email || "").trim().toLowerCase() === a &&
             String(n.student_email || "").trim().toLowerCase() === t;
    });
    if (hit) return true;
  } catch (e) {}
  return false;
}

// 認可の判定。actor（操作する人）と target（操作される人）を必ず分ける。
// クライアントが送ってくる target は「候補」に過ぎず、ここで必ず検査する。
// 運用・自動化のための「鍵による管理者アクセス」。
// ブラウザのセッションを持てない場面（コマンドラインからの運用作業、
// 定期処理の手動実行、LINEの一斉送信など）のために残す抜け道。
// ★メールだけでは通らない。本人しか知らない共有シークレットが必須★
// index.html にも coach/index.html にも埋め込まない（埋めた時点で秘密でなくなる）。
// 鍵で実行してよい操作を明示的に列挙する。
// 静的な鍵ひとつで55件すべてにJIROKU_ADMINとして到達できる状態は広すぎるため、
// 「ブラウザを持たない運用作業」に必要なものだけに限定する。
// 画面から行う管理操作（顧客情報の閲覧・編集・ファイル操作など）は
// Kaiの有効なセッションを必須とし、鍵では通さない。
const ADMIN_SECRET_ALLOWLIST = {
  // 状態の確認
  authConfig:1, p1Status:1, authInspect:1, authCohort:1, authAuditTail:1, lineLinkAudit:1, adminSystemHealth:1,
  // 定期処理の手動実行・補完
  adminOpsHealthCheck:1, adminRunNightlyReport:1, adminRunNightlyCoachMessage:1,
  adminBackfillReports:1, adminBackfillReportsForDate:1, adminBackfillReportReasons:1,
  adminBackfillCalendar:1, adminDedupeCalendar:1, adminRepairStreaksFreeze:1,
  // 一斉送信（Kaiの明示的な要望により残す）
  adminBroadcastLine:1, adminBroadcastLinePending:1, adminSendStudentCampaign:1,
  // セットアップ・保守
  adminSetupTriggers:1, adminInstallTrigger:1, adminSetupPhase1:1, adminSetupAuth:1, adminPhase4DryRun:1, adminLegacyBackfill:1, adminWritePathStats:1, adminIssueTestSession:1, adminDropTestSessions:1, adminOpsSelfTest:1, adminActualMinutesAudit:1, adminXpCorrection:1, adminStreakRecalc:1, adminGrantFeature:1, adminUserDiag:1, adminReportScoreDryRun:1, adminReportGenTest:1, adminScoreConsistency:1, adminFinalizeOps:1, adminUnfinalizeOps:1, adminSmpDump:1, adminSmpWarmAll:1, adminLevelAudit:1, adminXpRestore:1, adminCleanupPlusLogs:1, adminClassAudit:1, adminRecolorCalendar:1, adminFixTokenVersion:1, adminPurgeChallenges:1, adminJiroBackfill:1, adminCommunityTiming:1,
  authSetMode:1, authSetEnforce:1, authRoleApply:1, authRoleDryRun:1, authRevokeAll:1,
  authCleanupTestData:1, adminPurgeTestUsers:1, adminMigrateTasks:1, authBreakerReset:1, rotateSessionSecret:1,
  p1Backup:1, p1BackupInfo:1, p1PurgeArchived:1, weeklyBackup:1
};

// ── 署名付きの運用リクエスト ──
// 静的な鍵をそのまま送る方式には、有効期限もリプレイ対策も無く、
// GETだとURLに残る（履歴や中間ログに載る）という弱点があった。
// 鍵そのものは送らず、鍵で作った署名だけを送る形にする。
//
//   署名対象 = 「sig を除く全パラメータを key=value で並べ、キー順に & で連結したもの」
//   sig      = HMAC-SHA256(P1_ADMIN_SECRET, 署名対象)
//   ts       = 発行時刻（秒）。5分より古い/未来すぎるものは拒否
//   nonce    = 一度きり。使用済みは拒否
//
// 全パラメータを署名対象に含めるので、途中で1文字でも書き換えられたら通らない。
const OPS_SIG_WINDOW_SEC = 300;

function canonicalizeParams(params) {
  const keys = Object.keys(params).filter(function (k) { return k !== "sig"; }).sort();
  return keys.map(function (k) { return k + "=" + String(params[k]); }).join("&");
}
function computeOpsSignature(canonical) {
  const secret = PropertiesService.getScriptProperties().getProperty("P1_ADMIN_SECRET");
  if (!secret) return null;
  return Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(canonical, secret)).replace(/=+$/, "");
}
// 署名が正しければ管理者として扱う。鍵そのものは受け取らない
// 1回のリクエストの中で「もう検証済みの署名」を覚えておく入れ物。
// GASは実行ごとにスクリプトを読み直すので、リクエストをまたいで残らない。
var _opsSigVerifiedThisRequest = "";
function verifyOpsSignature(params) {
  const sig = String(params.sig || "");
  const ts = Number(params.ts || 0);
  const nonce = String(params.nonce || "");
  if (!sig || !ts || !nonce) return { ok: false, reason: "MISSING_SIG_FIELDS" };

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > OPS_SIG_WINDOW_SEC) return { ok: false, reason: "SIG_EXPIRED" };

  // ★同じリクエストの中では、何度検証しても通るようにする★
  //   1回のリクエストで署名を2回検証する経路がある。
  //   入口（authorizeAction）で1回、各アクションの中で verifyP1Admin が
  //   もう1回。nonceは使い捨てなので、2回目が NONCE_REUSED になり
  //   「認可は通ったのに処理が invalid signature で落ちる」という
  //   分かりにくい失敗になっていた（adminSetupPhase1 で実際に発生）。
  //   同一リクエスト内かどうかは、同じ署名文字列かどうかで判定する。
  if (_opsSigVerifiedThisRequest === sig) return { ok: true, cached: true };

  const cache = CacheService.getScriptCache();
  const nk = "opsn_" + sha256Hex(nonce).slice(0, 24);
  if (cache.get(nk)) return { ok: false, reason: "NONCE_REUSED" };

  const expected = computeOpsSignature(canonicalizeParams(params));
  if (!expected) return { ok: false, reason: "SECRET_NOT_SET" };
  if (!safeEquals(sig, expected)) return { ok: false, reason: "SIG_MISMATCH" };

  // 検証を通ったnonceだけを使用済みにする（総当たりで枠を潰されないように）
  cache.put(nk, "1", OPS_SIG_WINDOW_SEC * 2);
  _opsSigVerifiedThisRequest = sig;   // 同一リクエスト内の2回目のために覚えておく
  return { ok: true };
}

function adminSecretActor(email, secret, action) {
  const chk = verifyP1Admin(email, secret);
  if (!chk.ok) return null;
  // 許可リストに無い操作は、鍵を持っていても通さない
  if (!ADMIN_SECRET_ALLOWLIST[String(action || "")]) return null;
  const u = sheetToObjects(getSheet("Users")).find(function (x) { return x.student_email === email; }) || {};
  return { actor_user_id: String(u.user_id || "admin"), google_sub: String(u.google_sub || ""),
           email: String(email), role: "JIROKU_ADMIN", organization_id: "", viaSecret: true };
}

function authorizeAction(action, token, targetEmail, secretEmail, secret, sigParams) {
  const policy = policyFor(action);
  if (!policy) return { ok: true, skipped: true };   // この段階では対象外

  // ① 署名付きの運用リクエスト（推奨）。鍵そのものは送られてこない
  if (sigParams && sigParams.sig) {
    const v = verifyOpsSignature(sigParams);
    if (!v.ok) {
      authAudit("AUTHZ", { result: "DENY", failureReason: "OPS_SIG_" + v.reason, action: action });
      return { ok: false, error: "AUTH_REQUIRED" };
    }
    if (!ADMIN_SECRET_ALLOWLIST[String(action || "")]) {
      authAudit("AUTHZ", { result: "DENY", failureReason: "OPS_SIG_NOT_ALLOWED", action: action });
      return { ok: false, error: "AUTH_REQUIRED" };
    }
    const admin = String(adminEmail());
    const u = sheetToObjects(getSheet("Users")).find(function (x) { return x.student_email === admin; }) || {};
    const sa = { actor_user_id: String(u.user_id || "admin"), google_sub: String(u.google_sub || ""),
                 email: admin, role: "JIROKU_ADMIN", organization_id: "", viaSignature: true };
    authAudit("AUTHZ", { result: "ALLOW", action: action, actorUserId: sa.actor_user_id,
                         targetUserId: targetEmail || "", failureReason: "via_signature" });
    return { ok: true, actor: sa, forceSelfEmail: null };
  }

  // ② 旧方式（鍵をそのまま送る）は廃止した（2026-08-01）。
  //    鍵がURLに残る・有効期限が無い・リプレイできる・他パラメータを改ざんできる、
  //    という弱点があり、署名方式へ全て移行したうえで受付を止めた。
  //    監査ログ230件で旧方式の使用が0件であることを確認済み。
  if (secret) {
    authAudit("AUTHZ", { result: "DENY", failureReason: "LEGACY_SECRET_DISABLED", action: action });
    return { ok: false, error: "AUTH_REQUIRED" };
  }

  const v = verifySession(token, policy.noCache ? false : true);
  if (!v.ok) {
    authAudit("AUTHZ", { result: "DENY", failureReason: v.reason || "NO_SESSION", action: action });
    return { ok: false, error: "AUTH_REQUIRED" };
  }
  const actor = v.actor;
  const role = String(actor.role || "USER").toUpperCase();

  if (policy.roles.indexOf(role) === -1) {
    authAudit("AUTHZ", { result: "DENY", failureReason: "ROLE_" + role, action: action,
                         actorUserId: actor.actor_user_id, targetUserId: targetEmail || "" });
    return { ok: false, error: "FORBIDDEN" };
  }
  // JIROKU_ADMIN 以外は、担当している相手しか触れない
  if (policy.scope === "ASSIGNED" && role !== "JIROKU_ADMIN" && !isAssignedTo(actor.email, targetEmail)) {
    authAudit("AUTHZ", { result: "DENY", failureReason: "NOT_ASSIGNED", action: action,
                         actorUserId: actor.actor_user_id, targetUserId: targetEmail || "" });
    return { ok: false, error: "FORBIDDEN" };
  }
  if (policy.audit) {
    authAudit("AUTHZ", { result: "ALLOW", action: action,
                         actorUserId: actor.actor_user_id, targetUserId: targetEmail || "" });
  }
  // scope=SELF は「本人の分だけ」。呼び出し側で studentEmail をこの値に差し替える
  return { ok: true, actor: actor, forceSelfEmail: policy.scope === "SELF" ? actor.email : null };
}

// ══════════════════════════════════════════════════════════════════
// 週1回の自動バックアップ
//
// 作成は SpreadsheetApp.copy()（Drive権限の承認ダイアログが不要）。
// 古い分の削除だけ DriveApp を使うが、失敗してもバックアップ自体は成功させる。
//
// 【安全装置】削除で本番を消したら取り返しがつかないので、多重に守る。
//   ① 名前が JIROKU_backup_ で始まるものだけ
//   ② 本番のスプレッドシートIDと一致するものは、いかなる場合も対象外
//   ③ 1回の実行で削除できるのは最大3件
//   ④ 保持期間を過ぎたものだけ（既定8週間）
//   ⑤ 削除は「ゴミ箱へ移動」。完全削除はしない（30日間は戻せる）
// ══════════════════════════════════════════════════════════════════
const BACKUP_KEEP_WEEKS = 8;
const BACKUP_MAX_DELETE_PER_RUN = 3;
const BACKUP_PREFIX = "JIROKU_backup_";
const BACKUP_LOG_SHEET = "BackupLog";
const BACKUP_LOG_COLUMNS = ["created_at","name","spreadsheet_id","sheet_count","row_counts","url","deleted_at"];

function getBackupLogSheet() {
  let sh = getSheet(BACKUP_LOG_SHEET);
  if (!sh) { sh = getSpreadsheet().insertSheet(BACKUP_LOG_SHEET); sh.appendRow(BACKUP_LOG_COLUMNS); }
  return sh;
}

function weeklyBackup() {
  const started = new Date();
  let created = null, verifyNote = "", deleted = 0, deleteNote = "";
  try {
    // ① 複製を作る
    const src = getSpreadsheet();
    const stamp = Utilities.formatDate(started, "Asia/Tokyo", "yyyyMMdd_HHmm");
    const copy = src.copy(BACKUP_PREFIX + stamp);

    // ② 元とコピーで件数が一致するか確かめる（壊れたバックアップを「取れた」としない）
    const srcCounts = {}, dstCounts = {};
    src.getSheets().forEach(function (x) { srcCounts[x.getName()] = Math.max(0, x.getLastRow() - 1); });
    copy.getSheets().forEach(function (x) { dstCounts[x.getName()] = Math.max(0, x.getLastRow() - 1); });
    const mismatch = Object.keys(srcCounts).filter(function (k) { return srcCounts[k] !== dstCounts[k]; });
    verifyNote = mismatch.length ? "件数の不一致: " + mismatch.join(", ") : "件数一致";

    // ③ 外部に公開されていないか
    let shareNote = "";
    try {
      const viewers = copy.getViewers().map(function (u) { return u.getEmail(); });
      const editors = copy.getEditors().map(function (u) { return u.getEmail(); });
      const outside = viewers.concat(editors).filter(function (e) { return e && e !== adminEmail(); });
      shareNote = outside.length ? "★外部共有あり: " + outside.length + "件" : "外部共有なし";
    } catch (e) { shareNote = "共有範囲を確認できず"; }
    verifyNote += " / " + shareNote;

    created = { name: copy.getName(), id: copy.getId(), url: copy.getUrl(),
                sheets: copy.getSheets().length, counts: dstCounts };
    getBackupLogSheet().appendRow([started.toISOString(), created.name, created.id,
      created.sheets, JSON.stringify(dstCounts), created.url, ""]);
  } catch (e) {
    notifyAdminBackup("❌ バックアップの作成に失敗しました\n" + e);
    return { ok: false, error: String(e) };
  }

  // ④ 古い分をゴミ箱へ（失敗してもバックアップ自体は成功扱い）
  try {
    const keepBefore = new Date(started.getTime() - BACKUP_KEEP_WEEKS * 7 * 86400000);
    const sh = getBackupLogSheet();
    const data = sh.getDataRange().getValues(), h = data[0];
    const iAt = h.indexOf("created_at"), iName = h.indexOf("name"),
          iId = h.indexOf("spreadsheet_id"), iDel = h.indexOf("deleted_at");
    for (let i = 1; i < data.length && deleted < BACKUP_MAX_DELETE_PER_RUN; i++) {
      if (String(data[i][iDel] || "").trim()) continue;                       // 既に削除済み
      const name = String(data[i][iName] || ""), id = String(data[i][iId] || "");
      if (name.indexOf(BACKUP_PREFIX) !== 0) continue;                        // ①名前で守る
      if (!id || id === SPREADSHEET_ID) continue;                             // ②本番は絶対に消さない
      if (new Date(String(data[i][iAt])).getTime() > keepBefore.getTime()) continue;  // ④保持期間内
      try {
        DriveApp.getFileById(id).setTrashed(true);                            // ⑤ゴミ箱へ
        sh.getRange(i + 1, iDel + 1).setValue(new Date().toISOString());
        deleted++;
      } catch (e2) { deleteNote += "削除失敗(" + name + ") "; }
    }
  } catch (e) { deleteNote = "古い分の整理を実行できず: " + e; }

  const msg = "🗂 JIROKU 週次バックアップ\n" +
    created.name + "\n" +
    "シート " + created.sheets + "枚 / " + verifyNote + "\n" +
    (deleted ? "古い分を" + deleted + "件ゴミ箱へ移動\n" : "") +
    (deleteNote ? deleteNote + "\n" : "") +
    created.url;
  notifyAdminBackup(msg);
  return { ok: true, created: created, verify: verifyNote, deleted: deleted, note: deleteNote };
}

function notifyAdminBackup(text) {
  try {
    const admin = adminEmail();
    const u = sheetToObjects(getSheet("Users")).find(function (x) { return x.student_email === admin; });
    if (u && u.line_user_id && sendLineMessage(u.line_user_id, text)) return;
    MailApp.sendEmail(admin, "JIROKU 週次バックアップ", text);
  } catch (e) { Logger.log("バックアップ通知に失敗: " + e); }
}

// ── 管理操作の保護 ──
// 【重要な前提】このWeb appは「リクエストに書かれたメールアドレス」をそのまま信用している。
// つまり adminEmail() との比較だけでは、他人が管理者のメールを書けば通ってしまう。
// 全APIへの本格的なトークン認証は別途必要（[[project_jiroku_security_roadmap]]）だが、
// 少なくとも「シート構造を変える」「全体を覗く」管理操作は、本人しか知らない共有シークレット
// (スクリプトプロパティ P1_ADMIN_SECRET) を必須にして保護する。
// 未設定の場合は管理操作を一切通さない（誤って開いたままにしないため）。
function verifyP1Admin(email, secret, params) {
  const expected = PropertiesService.getScriptProperties().getProperty("P1_ADMIN_SECRET");
  if (!expected) return { ok: false, error: "P1_ADMIN_SECRET が未設定です（スクリプトプロパティに設定してください）" };
  // ① 署名付き（推奨）。鍵そのものは送られてこない
  if (params && params.sig) {
    const v = verifyOpsSignature(params);
    if (!v.ok) return { ok: false, error: "invalid signature" };
    if (!verifyAdmin(String(params.studentEmail || params.coachEmail || ""))) return { ok: false, error: "not owner" };
    return { ok: true, viaSignature: true };
  }
  // ② 旧方式（鍵をそのまま送る）は廃止した（2026-08-01）。
  //    運用コマンドは gas/ops.sh を使うこと（署名付きで叩く）。
  if (secret) return { ok: false, error: "この方式は廃止されました。gas/ops.sh を使ってください" };
  if (!verifyAdmin(email)) return { ok: false, error: "not owner" };
  return { ok: false, error: "signature required" };
  return { ok: true };
}

// ── 段階公開（features）──
// 新機能は features に該当キーを持つ人にだけ出す。cohortで分岐すると全画面に条件が
// 散らばるため、1つの列で制御する（学生の除外も自動的に達成される）
const P1_FEATURE_KEY = "goals_v1";
// 自己経営力の段階公開。Kai→core希望者→全体の順に広げる
const SMP_FEATURE_KEY = "self_mgmt_power_v1";
function hasFeature(user, key) {
  if (!user) return false;
  if (user.student_email === adminEmail()) return true; // オーナーは常に有効
  return String(user.features || "").split(",").map(s => s.trim()).indexOf(key) !== -1;
}

// ── localStorage にしかなかったタスク情報のサーバー移行 ──
// 想定時間・状態・メモは端末のlocalStorageにのみ存在し、機種変更で失われる状態だった。
// これを Tasks シートへ移す。日単位で全スキップすると取りこぼすため、タスク単位でマージする。
// 既存のサーバーデータは絶対に上書きしない。再試行しても同じIDになるので重複しない。
// body.items = [{date, title, estimated_minutes, status, memo, completed}] の配列
// ══════════════════════════════════════════════════════════════════
// タスクの重要度・緊急度（Checkpoint 3）
//
// なぜ分けるのか:
//   priority 1本では「重要だが急がない」を表現できない。
//   その結果、急ぎの用事に押し流されて、いちばん大事な仕事が
//   いつまでも後回しになる。これを見えるようにするのが目的。
//
//   重要度 … 本人が決める。AIやシステムは提案までで、確定はしない
//   緊急度 … 期限から自動で決まる。時間が経てば勝手に上がる
//
// ★緊急度は保存しない★
//   時間とともに変わる値を保存すると、due_at と食い違ったまま
//   古い値が残る。「昨日はHIGHだった」が今日も表示され続ける。
//   表示のたびに算出する。上書きしたいときだけ urgency_override を持つ。
// ══════════════════════════════════════════════════════════════════

// タスクの状態。既存データと新しいコードで表記が違っていた。
//   移行で入ったもの … COMPLETED
//   新しく作るもの   … DONE
// 揃えないと「完了したのに未完了として並び続ける」。
// 既存データは書き換えず、読むときに正規化する。
function normalizeTaskStatus(v) {
  const s = String(v || "").trim().toUpperCase();
  if (s === "COMPLETED" || s === "DONE") return "DONE";
  // ★DOING を IN_PROGRESS に寄せる★
  //   画面は "doing"、指示は IN_PROGRESS。表記が2つあると集計で取り違える。
  if (s === "DOING" || s === "IN_PROGRESS") return "IN_PROGRESS";
  if (s === "CARRIED_OVER") return "CARRIED_OVER";
  if (s === "ARCHIVED") return "ARCHIVED";
  return "TODO";
}
// タスクの文脈。★保存は内部コード、画面表示だけ日本語★
// 初期値は UNSET。タイトルから勝手に分類しない。
const TASK_CONTEXTS = ["UNSET", "WORK", "PERSONAL", "LEARNING", "HEALTH", "OTHER"];
// ★context と公開範囲は別概念★
// WORK だから上司へ自動共有、という設計にしない。
// 仕事のタスクでもPRIVATEなものはある。共有は本人の確認が要る。

// 依頼元。緊急対応が多い理由を「本人の計画不足」だけに帰さないため。
const TASK_SOURCE_TYPES = ["SELF", "MANAGER", "COLLEAGUE", "CLIENT", "SYSTEM", "OTHER"];

// タスクの状態。CARRIED_OVER は「持ち越した」ことが分かるように独立させる。
const TASK_STATUSES = ["TODO", "IN_PROGRESS", "DONE", "CARRIED_OVER", "ARCHIVED"];

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
function suggestImportance(task) {
  if (String(task.link_weekly_goal_id || "").trim()) return "HIGH";
  if (String(task.link_daily_focus_id || "").trim()) return "HIGH";
  return importanceFromPriority(task.priority);
}

// タスク1件に、算出した値を足して返す（保存はしない）
// ★シートは日付らしい文字列を勝手にDate型へ変える★
//   "2026-08-05" と書いても読むとDateオブジェクトが返る。そのままJSONにすると
//   UTCのISO文字列（前日の15:00）になり、期限の日付が1日ずれる。
//   時刻が0:00なら「日付だけの期限」、そうでなければ「時刻つき」として戻す。
function p1DateOut_(v) {
  if (v instanceof Date) {
    const hm = Utilities.formatDate(v, "Asia/Tokyo", "HH:mm:ss");
    return hm === "00:00:00"
      ? Utilities.formatDate(v, "Asia/Tokyo", "yyyy-MM-dd")
      : Utilities.formatDate(v, "Asia/Tokyo", "yyyy-MM-dd'T'HH:mm");
  }
  return String(v || "");
}

function decorateTask(t, nowMs) {
  const imp = IMPORTANCE_LEVELS.indexOf(String(t.importance_level || "").toUpperCase()) !== -1
    ? String(t.importance_level).toUpperCase() : "";
  const dueOut = p1DateOut_(t.due_at);
  const u = computeUrgency(dueOut, t.urgency_override, nowMs);
  const effectiveImportance = imp || suggestImportance(t);
  return {
    task_id: t.task_id, title: t.title, date: p1DateOut_(t.date), status: normalizeTaskStatus(t.status),
    link_weekly_goal_id: t.link_weekly_goal_id || "",
    link_daily_focus_id: t.link_daily_focus_id || "",
    estimated_minutes: t.estimated_minutes || "", actual_minutes: t.actual_minutes || "",
    due_at: dueOut, memo: t.memo || "",
    completed_at: t.completed_at || "", first_started_at: t.first_started_at || "",
    carryover_count: Number(t.carryover_count || 0),
    // 同期に使う。端末はこれを見て「自分が持っている版」と比べる
    version: Number(t.version || 0),
    updated_at: t.updated_at || "",
    context: String(t.context || "UNSET").toUpperCase(),
    deleted_at: t.deleted_at || "",
    sort_order: (t.sort_order === "" || t.sort_order === undefined) ? null : Number(t.sort_order),
    carried_from: t.carried_from || "",
    source_type: String(t.source_type || "SELF").toUpperCase(),
    requested_by: t.requested_by || "",
    priority: t.priority || "",                    // 既存互換。新UIでは使わない
    importance_level: effectiveImportance,
    importance_is_suggestion: !imp,                // 本人が決めていないなら提案値だと明示する
    urgency_level: u.level,                        // 都度算出。保存していない
    urgency_overridden: !!u.overridden,
    urgency_override_reason: t.urgency_override_reason || "",
    overdue: !!u.overdue,
    quadrant: classifyTask(effectiveImportance, u.level)
  };
}

// ══════════════════════════════════════════════════════════════════
// 進捗とペース
//
// 「残り280万円」だけでは、間に合うのかが分からない。
// 必要ペースと実績ペースを並べて初めて「足りていない」が見える。
//
// ★守ること★
//   ・未入力を0として扱わない（0は「やっていない」、未入力は「分からない」）
//   ・データが足りないときは数字を出さず「不明」と言う
//   ・偽の精密さを出さない（週32.7万円まで。32.6666…は書かない）
//   ・集計した期間を必ず添える（いつからいつまでの話かが分からないと判断できない）
// ══════════════════════════════════════════════════════════════════

// 小数を落とす。大きい数字ほど桁を減らす（精密に見せない）
function paceRound(v) {
  if (v === null || v === undefined || isNaN(v)) return null;
  const a = Math.abs(v);
  if (a >= 100) return Math.round(v);
  if (a >= 10) return Math.round(v * 10) / 10;
  return Math.round(v * 100) / 100;
}

// 開始日・終了日・現在値・目標値から、ペースを出す。
// startDate/endDate は "YYYY-MM-DD"。current/target は数値または未入力。
function computePace(startDate, endDate, current, target, unit, todayStr) {
  const out = { unit: unit || "", confidence: "LOW", note: "" };
  const sd = String(startDate || "").slice(0, 10);
  const ed = String(endDate || "").slice(0, 10);
  const today = todayStr || Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd");
  out.period = (sd && ed) ? (sd + " 〜 " + ed) : "";

  // ★未入力と0を区別する★
  const hasCurrent = !(current === "" || current === null || current === undefined || isNaN(Number(current)));
  const hasTarget  = !(target  === "" || target  === null || target  === undefined || isNaN(Number(target)));
  out.current = hasCurrent ? Number(current) : null;
  out.target  = hasTarget  ? Number(target)  : null;

  if (!hasTarget || !sd || !ed) {
    out.status = "UNKNOWN";
    // ★何を入れれば出せるのかまで言う★ 「判定できません」だけだと直しようがない
    const missing = [];
    if (!hasTarget) missing.push("目標値");
    if (!sd) missing.push("開始日");
    if (!ed) missing.push("終了日");
    out.missing = missing;
    out.note = missing.join("と") + "が未入力のため、必要なペースと着地の予測を出せません";
    return out;
  }
  const d1 = new Date(sd + "T00:00:00+09:00").getTime();
  const d2 = new Date(ed + "T00:00:00+09:00").getTime();
  const t  = new Date(today + "T00:00:00+09:00").getTime();
  if (isNaN(d1) || isNaN(d2) || d2 < d1) {
    out.status = "UNKNOWN"; out.note = "期間の指定が正しくありません"; return out;
  }
  const totalDays = Math.round((d2 - d1) / 86400000) + 1;
  const elapsedDays = Math.min(Math.max(Math.round((t - d1) / 86400000) + 1, 0), totalDays);
  const remainingDays = Math.max(Math.round((d2 - t) / 86400000), 0);
  out.totalDays = totalDays; out.elapsedDays = elapsedDays; out.remainingDays = remainingDays;

  if (!hasCurrent) {
    out.status = "UNKNOWN";
    out.missing = ["現在値"];
    out.note = "現在値が未入力のため判定できません（0ではなく、まだ記録していないという意味です）";
    return out;
  }

  const cur = Number(current), tgt = Number(target);
  out.remaining = paceRound(Math.max(tgt - cur, 0));
  out.progressPct = tgt > 0 ? paceRound(cur / tgt * 100) : null;

  // ★実績ペースは、経過が十分あるときだけ出す★
  //   現在値は「開始日からの積み上げ」として扱うが、本人が入力するのは
  //   多くの場合そのときの累計で、開始前のぶんも含む。経過3日で
  //   「128万 ÷ 3日 × 7 = 週299万」「着地3,968万」のような、
  //   実際に出た数字を出してしまう（目標400万に対して10倍）。
  //   短い期間から長期を占わない。7日未満は出さない。
  if (elapsedDays >= 7) {
    out.actualPerWeek = paceRound(cur / elapsedDays * 7);
    out.confidence = elapsedDays >= 21 ? "HIGH" : "MEDIUM";
  } else {
    out.actualPerWeek = null;
    out.confidence = "LOW";
    out.note = "始めてから" + elapsedDays + "日なので、実績ペースと着地の予測はまだ出せません（7日を過ぎると出ます）";
  }
  // 必要ペース
  out.requiredPerWeek = remainingDays > 0
    ? paceRound((tgt - cur) / remainingDays * 7)
    : null;

  // このままのペースで行った場合の予測
  if (out.actualPerWeek !== null) {
    out.forecast = paceRound(cur + (cur / elapsedDays) * remainingDays);
    // ★「やや遅れ」の幅を狭くする★
    //   最初は8割を境にしていたが、それだと目標を2割落としても
    //   「やや遅れ」と表示される。手遅れになるまで「まあ大丈夫」と
    //   思わせてしまう。あと一息（95%以上）だけを「やや遅れ」にする。
    // 予測が目標を大きく超えるのは、たいてい現在値が開始前のぶんを含んでいる。
    // 「順調」と言い切らず、確認を促す
    if (out.forecast > tgt * 2) {
      out.forecastWarning = "現在値に開始日より前のぶんが含まれていないか確認してください（予測が目標の2倍を超えています）";
      out.confidence = "LOW";
    }
    if (out.forecast >= tgt) out.status = "ON_TRACK";
    else if (out.forecast >= tgt * 0.95) out.status = "SLIGHTLY_BEHIND";
    else out.status = "BEHIND";
  } else {
    out.forecast = null;
    out.status = "UNKNOWN";
  }
  if (cur >= tgt) { out.status = "ACHIEVED"; out.forecast = paceRound(cur); }
  if (remainingDays === 0 && cur < tgt) out.status = "ENDED_SHORT";
  return out;
}

const PACE_STATUS_LABEL = {
  ACHIEVED: "達成", ON_TRACK: "順調", SLIGHTLY_BEHIND: "やや遅れ",
  BEHIND: "ペース不足", ENDED_SHORT: "期間終了・未達", UNKNOWN: "不明"
};

// ══════════════════════════════════════════════════════════════════
// 2週間Sprint（Checkpoint 3）
//
// 3か月目標と週間目標のあいだをつなぐ層。
// 「3か月で売上400万」から、いきなり「今週30万」は出てこない。
// 2週間で何を変えるのか（ボトルネックと仮説）を挟むことで、
// 週間目標が「ただの割り算」ではなくなる。
//
// ★進行中は原則1つ★
// 複数を同時に進めると、どれが今の焦点か分からなくなる。
// 作れはするが、画面には「今のSprint」を1つだけ出す。
// ══════════════════════════════════════════════════════════════════
// ★2週間Sprintの進捗★（2026-08-05 Kaiの判断・A案）
//
//   Sprintそのものには数値目標を持たせない。
//   「Sprintは3か月を2週間に切ったもの」なので、そこに紐づく週間目標の
//   積み上げがそのまま進捗になる、という考え方にする。
//   本人が入力する項目を増やさずに済むのが利点。
//
//   数え方：Sprint期間に含まれる各週について、紐づく週間目標の実績を足し、
//           週の目標×週数 を分母にする。
//           （今週ぶんの達成率の平均ではなく、期間全体に対する積み上げ。
//             こうしないと「Sprintの何%まで来たか」にならない）
//   週間目標が1つも紐づいていない人には null を返す（0%とは言わない）。
function sprintProgress_(studentEmail, sprint, weeklies) {
  const sd = String(sprint.start_date || "").slice(0, 10);
  const ed = String(sprint.end_date || "").slice(0, 10);
  if (!sd || !ed) return null;
  const linked = (weeklies || []).filter(function (w) {
    return String(w.link_sprint_id || "") === String(sprint.sprint_id) &&
           p1Status_(w.status, "ACTIVE") !== "ARCHIVED"; });
  if (!linked.length) return null;

  // Sprint期間にかかる週（月曜始まり）を並べる
  const weeks = [];
  let cur = mondayOf(sd);
  const guard = 12;   // 暴走よけ（通常は2週）
  for (let i = 0; i < guard; i++) {
    if (cur > ed) break;
    weeks.push(cur);
    const d = new Date(cur + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 7);
    cur = d.toISOString().substring(0, 10);
  }
  if (!weeks.length) return null;

  let actualSum = 0, targetSum = 0, measurable = 0;
  const perGoal = {};
  weeks.forEach(function (wk) {
    const agg = aggregateWeeklyActual(studentEmail, wk);
    linked.forEach(function (w) {
      const t = Number(w.target_total);
      if (isNaN(t) || t <= 0) return;              // 数値目標が無いものは数えない
      const a = (agg[String(w.weekly_goal_id)] || {}).actual || 0;
      actualSum += a; targetSum += t; measurable++;
      const k = String(w.weekly_goal_id);
      perGoal[k] = (perGoal[k] || 0) + a;
    });
  });
  if (!measurable || targetSum <= 0) return null;

  return {
    percent: Math.min(999, Math.round(actualSum / targetSum * 100)),
    actual: Math.round(actualSum * 10) / 10,
    target: Math.round(targetSum * 10) / 10,
    weeks: weeks.length,
    goal_count: linked.length,
    // 期間のどこまで来たか。進捗バーに「今いるべき位置」を出すために使う
    elapsed_percent: (sprint.totalDays > 0 && sprint.dayIndex !== null)
      ? Math.max(0, Math.min(100, Math.round(sprint.dayIndex / sprint.totalDays * 100))) : null,
    source: "WEEKLY_ROLLUP"
  };
}

function getSprints(studentEmail, body) {
  const chk = p1RequireUser(studentEmail);
  if (!chk.ok) return chk;
  const today = formatDate(new Date());
  const rows = p1List("Sprints", studentEmail)
    .filter(function (x) { return p1Status_(x.status, "ACTIVE") !== "ARCHIVED"; })
    .map(function (x) {
      const sd = String(x.start_date || "").slice(0, 10);
      const ed = String(x.end_date || "").slice(0, 10);
      const current = !!(sd && ed && sd <= today && today <= ed);
      let daysLeft = null, dayIndex = null, totalDays = null;
      if (sd && ed) {
        const d1 = new Date(sd + "T00:00:00+09:00").getTime();
        const d2 = new Date(ed + "T00:00:00+09:00").getTime();
        const t = new Date(today + "T00:00:00+09:00").getTime();
        totalDays = Math.round((d2 - d1) / 86400000) + 1;
        daysLeft = Math.round((d2 - t) / 86400000);
        dayIndex = Math.round((t - d1) / 86400000) + 1;
      }
      return {
        sprint_id: x.sprint_id, name: x.name || "",
        link_quarterly_goal_id: x.link_quarterly_goal_id || "",
        start_date: sd, end_date: ed,
        bottleneck: x.bottleneck || "", target_state: x.target_state || "",
        hypothesis: x.hypothesis || "",
        action_metric: x.action_metric || "", result_metric: x.result_metric || "",
        try_actions: x.try_actions || "", stop_actions: x.stop_actions || "",
        if_then: x.if_then || "", success_condition: x.success_condition || "",
        coaching_note: x.coaching_note || "", confirmed_at: x.confirmed_at || "",
        status: p1Status_(x.status, "ACTIVE"),
        isCurrent: current, daysLeft: daysLeft, dayIndex: dayIndex, totalDays: totalDays
      };
    })
    .sort(function (a, b) { return String(b.start_date).localeCompare(String(a.start_date)); });

  // 進捗は、いま進んでいるSprintだけ出す（終わったものまで毎回集計すると重い）
  const weeklies = p1List("WeeklyGoals", studentEmail);
  rows.forEach(function (r) {
    if (!r.isCurrent) { r.progress = null; return; }
    try { r.progress = sprintProgress_(studentEmail, r, weeklies); }
    catch (e) { r.progress = null; }
  });

  const current = rows.filter(function (x) { return x.isCurrent; });
  return { ok: true, data: rows,
           current: current.length ? current[0] : null,
           multipleCurrent: current.length > 1,   // 画面で注意を出せるように隠さない
           today: today };
}

function saveSprint(studentEmail, body) {
  const chk = p1RequireUser(studentEmail);
  if (!chk.ok) return chk;
  const id = String((body && body.sprint_id) || "").trim();
  if (id && !p1OwnedRow("Sprints", "sprint_id", id, studentEmail)) {
    return { ok: false, error: "Sprintが見つかりません" };
  }
  const link = String(body.link_quarterly_goal_id || "").trim();
  if (link && !p1OwnedRow("Goals", "quarterly_goal_id", link, studentEmail)) {
    return { ok: false, error: "紐づけ先の3か月目標が見つかりません" };
  }
  // 期間の前後が逆になっていないか。逆だと残り日数が負になり画面が壊れる
  const sd = p1Text_(body.start_date, 10), ed = p1Text_(body.end_date, 10);
  if (sd && ed && String(sd) > String(ed)) {
    return { ok: false, error: "開始日が終了日より後になっています" };
  }

  const rec = { sprint_id: id || makeP1Id("sp"), student_email: studentEmail };
  const text = { name:60, bottleneck:1000, target_state:1000, hypothesis:1000,
                 action_metric:200, result_metric:200, try_actions:1000, stop_actions:1000,
                 if_then:1000, success_condition:1000, coaching_note:2000 };
  Object.keys(text).forEach(function (k) {
    if (body[k] !== undefined) rec[k] = p1Text_(body[k], text[k]);
  });
  if (body.start_date !== undefined) rec.start_date = sd;
  if (body.end_date !== undefined) rec.end_date = ed;
  if (body.link_quarterly_goal_id !== undefined) rec.link_quarterly_goal_id = link;
  if (body.status !== undefined) rec.status = p1Status_(body.status, "ACTIVE");
  if (String(body.confirm || "") === "1") rec.confirmed_at = new Date().toISOString();

  const r = p1Upsert("Sprints", "sprint_id", rec);
  return { ok: true, id: r.id, created: r.created };
}

// ══════════════════════════════════════════════════════════════════
// Journal.actions → Tasks シートへの移行（Phase 3）
//
// いまタスクは Journal の1列にJSONで入っている。Tasksシート（23列）は空。
// Tasksシートを正にすると、日をまたいだ持ち越しや着手時刻を追える。
// いまは保存キーが日付ごとなので、翌日は別のタスクになってしまう。
//
// ★冪等にする★
//   同じ task_id は何度実行しても1件のまま。
//   既にサーバーにある値を、クライアントの値で上書きしない
//   （別の端末で編集された内容を、古い端末が巻き戻してしまう）。
//
// ★競合は勝手に解決しない★
//   同じ task_id で内容が食い違ったら、直さずに数えて報告する。
//   どちらが正しいかは、こちらでは判断できない。
// ══════════════════════════════════════════════════════════════════
// Phase 4 の移行前調査。全ユーザーの Journal.actions と Tasks シートを突き合わせ、
// 「何件がどうなるか」を数えるだけで、1行も書かない。
// 停止条件（conflict / task_id重複 / user不明 / 件数不一致）の判定材料になる。
function phase4DryRun() {
  const users = {};
  sheetToObjects(getSheet("Users")).forEach(function (u) {
    if (String(u.is_active).toUpperCase() === "TRUE") users[String(u.student_email).trim()] = 1;
  });

  // Journal.actions 全行を走査（日付は問わない: 過去の分も移行対象になり得るため全体像を出す）
  const journal = sheetToObjects(getJournalSheet());
  let jTotal = 0, jNoId = 0, jNoTitle = 0, jUnknownUser = 0, legacyRows = 0;
  const jById = {};            // task_id -> {email, title, date} 最後に見たもの
  const jIdOwners = {};        // task_id -> {email:1} 同じidを複数ユーザーが持つ検出
  const titleIds = {};         // email+"|"+title -> {id:1} 同名別idの検出
  journal.forEach(function (r) {
    const raw = String(r.actions || "").trim();
    if (!raw) return;
    let items;
    try { items = JSON.parse(raw); } catch (e) { legacyRows++; return; }
    if (!Array.isArray(items)) return;
    const em = String(r.student_email || "").trim();
    const rd = r.date instanceof Date ? Utilities.formatDate(r.date, "Asia/Tokyo", "yyyy-MM-dd") : String(r.date).slice(0, 10);
    items.forEach(function (it) {
      jTotal++;
      if (typeof it !== "object" || !it) { jNoId++; return; }   // 旧形式（文字列）
      const id = String(it.id || it.task_id || "").trim();
      const title = String(it.title || "").trim();
      if (!id) { jNoId++; return; }
      if (!title) { jNoTitle++; return; }
      if (!users[em]) { jUnknownUser++; return; }
      jById[em + "|" + id] = { email: em, id: id, title: title, date: rd };
      (jIdOwners[id] = jIdOwners[id] || {})[em] = 1;
      (titleIds[em + "|" + title] = titleIds[em + "|" + title] || {})[id] = 1;
    });
  });
  const jUnique = Object.keys(jById).length;
  const crossUserIds = Object.keys(jIdOwners).filter(function (k) { return Object.keys(jIdOwners[k]).length > 1; }).length;
  const sameTitleDiffId = Object.keys(titleIds).filter(function (k) { return Object.keys(titleIds[k]).length > 1; }).length;

  // Tasks シート側
  const tasks = sheetToObjects(getSheet("Tasks"));
  let tActive = 0, tTombstone = 0;
  const tById = {}, tDupIds = [];
  tasks.forEach(function (t) {
    if (String(t.deleted_at || "").trim()) tTombstone++; else tActive++;
    const key = String(t.student_email).trim() + "|" + String(t.task_id).trim();
    if (tById[key]) tDupIds.push(String(t.task_id)); else tById[key] = t;
  });

  // 突き合わせ（Journal → Tasks 方向）
  let willCreate = 0, willUpdate = 0, alreadySame = 0, conflict = 0, skipped = 0;
  Object.keys(jById).forEach(function (k) {
    const j = jById[k];
    const t = tById[j.email + "|" + j.id];
    if (!t) { willCreate++; return; }
    if (String(t.deleted_at || "").trim()) { skipped++; return; }   // 墓標は復活させない
    if (String(t.title) === j.title) { alreadySame++; return; }
    // タイトルが違う＝どちらが正か機械では決められない
    conflict++;
  });

  return {
    ok: true,
    journal: { taskTotal: jTotal, uniqueTaskKeys: jUnique, noId: jNoId, noTitle: jNoTitle,
               unknownUser: jUnknownUser, legacyRows: legacyRows,
               crossUserSameId: crossUserIds, sameTitleDiffId: sameTitleDiffId },
    tasksSheet: { active: tActive, tombstone: tTombstone, dupIds: tDupIds },
    plan: { willCreate: willCreate, willUpdate: willUpdate, alreadySame: alreadySame,
            conflict: conflict, skipped: skipped },
    stopConditions: {
      conflict: conflict > 0,
      taskIdDup: tDupIds.length > 0,
      unknownUser: jUnknownUser > 0
    }
  };
}

// ★旧形式111件のバックフィル★
//   Journal.actions に残る id 無しタスク（文字列）を Tasks へ移す。
//   ・IDはタイトルから作らない（同名で衝突する）。移行元の
//     「持ち主|Journal行の日付|並び位置」から決定的に作る。
//     再実行しても同じIDになり、同名タスクでも別々になる。
//   ・元の日付と完了状態を保つ（今日の未完了として蘇らせない）。
//   ・execute=false なら1行も書かない。
function legacyBackfill(execute, migrationId) {
  const users = {};
  sheetToObjects(getSheet("Users")).forEach(function (u) {
    if (String(u.is_active).toUpperCase() === "TRUE") users[String(u.student_email).trim()] = 1;
  });
  const journal = sheetToObjects(getJournalSheet());
  const seenSource = {};
  const plan = [];
  let legacyTotal = 0, noTitle = 0, unknownUser = 0, dupSource = 0, withIdSkipped = 0;

  journal.forEach(function (r) {
    const raw = String(r.actions || "").trim();
    if (!raw) return;
    let items; try { items = JSON.parse(raw); } catch (e) { return; }
    if (!Array.isArray(items)) return;
    const em = String(r.student_email || "").trim();
    const rd = r.date instanceof Date ? Utilities.formatDate(r.date, "Asia/Tokyo", "yyyy-MM-dd") : String(r.date).slice(0, 10);
    let checked = {}; try { checked = JSON.parse(String(r.actions_checked || "{}")) || {}; } catch (e) {}
    items.forEach(function (it, idx) {
      const isLegacy = (typeof it !== "object" || !it || !(it.id || it.task_id));
      if (!isLegacy) { withIdSkipped++; return; }   // id付きは橋渡し/直接書き込みの領分
      legacyTotal++;
      const title = String(typeof it === "string" ? it : (it && it.title) || "").trim();
      if (!title) { noTitle++; return; }
      if (!users[em]) { unknownUser++; return; }
      const sourceKey = em + "|" + rd + "|" + idx;
      if (seenSource[sourceKey]) { dupSource++; return; }
      seenSource[sourceKey] = 1;
      const tid = "legacy_" + sha256Hex(sourceKey).slice(0, 16);
      const done = !!(checked[title]);
      plan.push({ email: em, tid: tid, title: title, date: rd, done: done,
                  sourceJournalId: em + "|" + rd, sourceIndex: idx });
    });
  });

  // 既存との突き合わせ（所有者スコープで）
  let willCreate = 0, alreadyMigrated = 0, conflict = 0;
  const conflicts = [];
  plan.forEach(function (p) {
    const ex = p1OwnedRow("Tasks", "task_id", p.tid, p.email);
    if (!ex) { p.create = true; willCreate++; return; }
    if (String(ex.title) === p.title) { alreadyMigrated++; return; }
    conflict++; conflicts.push(p.tid);
  });

  // ★id付きだが Tasks に無い過去タスクも対象にする★
  //   旧形式ではないのでバックフィル対象外、橋渡しは当日分しか写さない。
  //   その隙間（例: 8/1 のid付き2件）を拾わないと、Journal の全アクションを
  //   Tasks で説明できない。id は既存のものを保つ（採番し直さない）。
  const withIdPlan = [];
  {
    const seenWid = {};
    journal.forEach(function (r) {
      const raw = String(r.actions || "").trim();
      if (!raw) return;
      let items; try { items = JSON.parse(raw); } catch (e) { return; }
      if (!Array.isArray(items)) return;
      const em = String(r.student_email || "").trim();
      const rd = r.date instanceof Date ? Utilities.formatDate(r.date, "Asia/Tokyo", "yyyy-MM-dd") : String(r.date).slice(0, 10);
      let checked = {}; try { checked = JSON.parse(String(r.actions_checked || "{}")) || {}; } catch (e) {}
      items.forEach(function (it, idx) {
        if (typeof it !== "object" || !it || !(it.id || it.task_id)) return;
        if (!users[em]) return;
        const id = String(it.id || it.task_id);
        const k = em + "|" + id;
        // 同じidが複数日に出るときは新しい日付を採用
        if (seenWid[k] && seenWid[k].date >= rd) return;
        seenWid[k] = { email: em, tid: id, title: String(it.title || ""), date: rd,
                       done: !!(checked[id] !== undefined ? checked[id] : checked[it.title]),
                       imp: String(it.imp || ""), due: String(it.due || ""),
                       est: Number(it.est) > 0 ? Number(it.est) : "",
                       memo: String(it.memo || ""),
                       sourceJournalId: em + "|" + rd, sourceIndex: idx };
      });
    });
    Object.keys(seenWid).forEach(function (k) {
      const p = seenWid[k];
      if (!p.title) return;
      if (p1OwnedRow("Tasks", "task_id", p.tid, p.email)) return;   // 既にある
      withIdPlan.push(p);
    });
  }

  const stop = conflict > 0 || unknownUser > 0 || dupSource > 0;
  const result = {
    ok: true, executed: false,
    counts: { legacyTotal: legacyTotal, targets: plan.length, willCreate: willCreate,
              alreadyMigrated: alreadyMigrated, conflict: conflict, noTitle: noTitle,
              unknownUser: unknownUser, dupSource: dupSource, withIdSkipped: withIdSkipped,
              withIdMissing: withIdPlan.length },
    stopConditions: { conflict: conflict > 0, unknownUser: unknownUser > 0, dupSource: dupSource > 0 },
    conflicts: conflicts.slice(0, 10)
  };
  if (!execute) return result;
  if (stop) { result.error = "停止条件に該当。書き込みません"; return result; }

  const mid = String(migrationId || ("bf_" + Date.now()));
  const nowIso = new Date().toISOString();
  let created = 0;
  plan.forEach(function (p) {
    if (!p.create) return;
    p1Upsert("Tasks", "task_id", {
      task_id: p.tid, student_email: p.email, date: p.date, title: p.title,
      status: p.done ? "DONE" : "TODO",
      completed_at: p.done ? (p.date + "T23:59:00+09:00") : "",
      created_at: nowIso, version: 1, source_type: "SELF", context: "UNSET",
      migrated_from: "JOURNAL_ACTIONS", source_journal_id: p.sourceJournalId,
      source_action_index: p.sourceIndex, migration_id: mid, migrated_at: nowIso
    });
    created++;
  });
  withIdPlan.forEach(function (p) {
    const rec = {
      task_id: p.tid, student_email: p.email, date: p.date, title: p.title,
      status: p.done ? "DONE" : "TODO",
      completed_at: p.done ? (p.date + "T23:59:00+09:00") : "",
      created_at: nowIso, version: 1, source_type: "SELF", context: "UNSET",
      migrated_from: "JOURNAL_ACTIONS", source_journal_id: p.sourceJournalId,
      source_action_index: p.sourceIndex, migration_id: mid, migrated_at: nowIso
    };
    if (p.imp) rec.importance_level = p.imp;
    if (p.due) rec.due_at = p.due;
    if (p.est) rec.estimated_minutes = p.est;
    if (p.memo) rec.memo = p.memo;
    p1Upsert("Tasks", "task_id", rec);
    created++;
  });
  result.executed = true;
  result.created = created;
  result.migration_id = mid;
  result.after = sheetToObjects(getSheet("Tasks")).length;
  return result;
}

function migrateTasksToSheet(studentEmail, body) {
  const chk = p1RequireUser(studentEmail);
  if (!chk.ok) return chk;

  const date = String((body && body.date) || formatDate(new Date())).slice(0, 10);

  // ★移行元はサーバー側で読む★
  //   クライアントから受け取る形だと、こちらで検証できない。
  //   Journal.actions が現在の正なので、そこから直接読む。
  //   items が明示的に渡された場合はそちらを使う（互換）。
  let items;
  if (body && body.items) {
    try { items = JSON.parse(String(body.items)); }
    catch (e) { return { ok: false, error: "items を読めませんでした" }; }
  } else {
    const jr = sheetToObjects(getJournalSheet()).find(function (r) {
      const rd = r.date instanceof Date ? Utilities.formatDate(r.date, "Asia/Tokyo", "yyyy-MM-dd") : String(r.date);
      return r.student_email === studentEmail && rd === date;
    });
    if (!jr || !String(jr.actions || "").trim()) {
      return { ok: true, dryRun: true, date: date, source: "Journal.actions",
               counts: { before: p1List("Tasks", studentEmail).length, incoming: 0,
                         willCreate: 0, alreadySame: 0, conflict: 0, skipped: 0 },
               note: "この日の Journal.actions が空です。移行するものがありません" };
    }
    try { items = JSON.parse(String(jr.actions)); }
    catch (e) { return { ok: false, error: "Journal.actions を読めませんでした" }; }
  }
  if (!Array.isArray(items)) return { ok: false, error: "items が配列ではありません" };
  if (items.length > 500) return { ok: false, error: "件数が多すぎます（500件まで）" };

  // ★旧形式（文字列の配列）が混ざっていたら移行しない★
  //   id が無いものへこちらで id を振ると、端末が持っている id と食い違い、
  //   同じタスクが2件になる。端末に一度保存させてから移行する。
  const legacy = items.filter(function (x) { return typeof x !== "object" || !x || !(x.id || x.task_id); });
  if (legacy.length) {
    return { ok: false, error: "旧形式のタスクが混ざっています（id が無い）",
             legacyCount: legacy.length, total: items.length,
             note: "端末でアプリを一度開いて保存し直すと、id が付いた形になります" };
  }
  const confirm = String((body && body.confirm) || "") === "yes";

  const existing = p1List("Tasks", studentEmail);
  const byId = {};
  existing.forEach(function (t) { byId[String(t.task_id)] = t; });

  const plan = { create: [], alreadySame: [], conflict: [], skipped: [] };

  items.forEach(function (it) {
    const id = String((it && (it.id || it.task_id)) || "").trim();
    const title = String((it && it.title) || "").trim();
    if (!id || !title) { plan.skipped.push({ reason: "id か title が無い" }); return; }

    const cur = byId[id];
    if (!cur) {
      plan.create.push({ id: id, title: title });
      return;
    }
    // 既にある。内容が違えば競合として数えるだけ（直さない）
    const diffs = [];
    if (String(cur.title || "") !== title) diffs.push("title");
    const impNew = String(it.imp || ""), impCur = String(cur.importance_level || "");
    if (impNew && impCur && impNew !== impCur) diffs.push("importance_level");
    const dueNew = String(it.due || ""), dueCur = String(cur.due_at || "").slice(0, 10);
    if (dueNew && dueCur && dueNew !== dueCur) diffs.push("due_at");
    if (diffs.length) plan.conflict.push({ id: id, title: title, fields: diffs, server: {
      title: cur.title, importance_level: cur.importance_level, due_at: cur.due_at } });
    else plan.alreadySame.push({ id: id });
  });

  const counts = {
    before: existing.length,
    incoming: items.length,
    willCreate: plan.create.length,
    alreadySame: plan.alreadySame.length,
    conflict: plan.conflict.length,
    skipped: plan.skipped.length
  };

  if (!confirm) {
    return { ok: true, dryRun: true, date: date, source: (body && body.items) ? "items" : "Journal.actions",
             counts: counts, conflicts: plan.conflict.slice(0, 20),
             note: "confirm=yes で実行します。競合があるものは作成しません（報告のみ）" };
  }

  // ★競合しているものは触らない★ 新規だけ作る
  let created = 0;
  plan.create.forEach(function (c) {
    const src = items.find(function (x) { return String(x.id || x.task_id) === c.id; }) || {};
    p1Upsert("Tasks", "task_id", {
      task_id: c.id,
      student_email: studentEmail,
      date: date,
      title: c.title,
      importance_level: String(src.imp || ""),
      due_at: String(src.due || ""),
      estimated_minutes: (Number(src.est) > 0 ? Number(src.est) : ""),
      memo: String(src.memo || ""),
      status: normalizeTaskStatus(src.stt === "done" ? "DONE" : src.stt)
    });
    created++;
  });

  const after = p1List("Tasks", studentEmail).length;
  authAudit("TASK_MIGRATE", { result: "SUCCESS", action: "migrateTasksToSheet",
            failureReason: "before=" + counts.before + " created=" + created +
                           " conflict=" + counts.conflict + " after=" + after });

  return { ok: true, dryRun: false, date: date,
           counts: Object.assign({}, counts, { created: created, after: after }),
           conflicts: plan.conflict.slice(0, 20),
           rollback: "作成された task_id を deleteTask で論理削除するか、Tasksシートの該当行を削除する" };
}

// タスク一覧。並び順は「期限超過 → 重要かつ緊急 → 今日のフォーカス直結 →
// 重要で期限が近い → その他 → 後回し候補」。
// 本人が手で並べ替えたぶん（sort_order）があればそれを最優先で尊重する。
function getTasks(studentEmail, body) {
  const chk = p1RequireUser(studentEmail);
  if (!chk.ok) return chk;
  const now = Date.now();
  const includeDone = String((body && body.includeDone) || "") === "1";

  let rows = p1List("Tasks", studentEmail).filter(function (t) {
    if (String(t.deleted_at || "").trim()) return false;
    if (!includeDone && normalizeTaskStatus(t.status) === "DONE") return false;
    return true;
  }).map(function (t) { return decorateTask(t, now); });

  // ★自動順位と、その理由★
  //   なぜ上に来ているのかを画面で言えるようにする（システムの判断を隠さない）
  const rankOf = function (t) {
    if (t.overdue) return { rank: 0, reason: "OVERDUE", label: "期限が過ぎています" };
    if (t.quadrant === "DO_NOW") return { rank: 1, reason: "IMPORTANT_URGENT", label: "重要かつ急ぎ" };
    if (t.link_daily_focus_id) return { rank: 2, reason: "DAILY_FOCUS", label: "今日のフォーカスに直結" };
    if (t.importance_level === "HIGH" && t.urgency_level === "MEDIUM")
      return { rank: 3, reason: "IMPORTANT_SOON", label: "重要で期限が近い" };
    if (t.quadrant === "DEFER_OR_DELETE") return { rank: 5, reason: "DEFER", label: "後回しでよさそう" };
    return { rank: 4, reason: "NORMAL", label: "通常" };
  };
  rows.forEach(function (t) {
    const r = rankOf(t);
    t.priority_rank = r.rank;
    t.priority_reason = r.reason;
    t.priority_label = r.label;
    // 本人が並べ替えたか。並べ替えていれば sort_order を尊重する
    t.manual_order = (t.sort_order !== null && t.sort_order !== undefined);
  });
  const rank = function (t) { return t.priority_rank; };
  rows.sort(function (a, b) {
    // ★期限超過は手動並び替えでも下に隠さない★
    //   自分で下へ動かした結果、締切を過ぎたものが見えなくなるのは事故になる
    if (!!a.overdue !== !!b.overdue) return a.overdue ? -1 : 1;
    // ★本人が並べ替えたものは、その順を尊重する★（自動順位より優先）
    const ma = a.manual_order, mb = b.manual_order;
    if (ma && mb) return Number(a.sort_order) - Number(b.sort_order);
    if (ma !== mb) return ma ? -1 : 1;   // 手で置いたものを先に
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    // 同じ段の中では期限が近いものを先に。期限なしは最後
    const da = a.due_at ? new Date(a.due_at).getTime() : Infinity;
    const db = b.due_at ? new Date(b.due_at).getTime() : Infinity;
    return da - db;
  });

  return { ok: true, data: rows, asOf: new Date().toISOString() };
}

// タスクの作成・更新。最小入力は「タスク名」のみ。
// 重要度・期限・週間目標との紐づけ・想定時間は任意。
// ★まとめ送りAPI★ タスク操作1回ごとに1リクエストを送ると、
//   GASの同時実行制限（全ユーザー共有）をすぐ食い潰す。
//   端末は操作をキューに貯め、まとめて送る。
//   各mutationは独立に判定する（1件の競合で他の正常な操作を道連れにしない）。
//   ただし配列の順序どおりに適用する（作成→編集→完了の依存を守るため）。
function saveTaskMutations(studentEmail, body) {
  // 自己経営力は計算に時間がかかるので取っておいている。書き換えたら
  // 古い結果に当たらないよう世代を進める（2026-08-05）。
  smpBumpEpoch_(studentEmail);
  const chk = p1RequireUser(studentEmail);
  if (!chk.ok) return chk;
  let muts;
  try { muts = JSON.parse(String((body && body.mutations) || "[]")); }
  catch (e) { return { ok: false, error: "mutations を読めませんでした" }; }
  if (!Array.isArray(muts)) return { ok: false, error: "mutations が配列ではありません" };
  if (muts.length > 50) return { ok: false, error: "1回50件までです" };
  countWritePath_("TASKS_DIRECT");

  const results = muts.map(function (m) {
    const mid = String((m && m.client_mutation_id) || "").trim();
    const op = String((m && m.operation) || "").toUpperCase();
    const out = { client_mutation_id: mid, task_id: String((m && m.task_id) || ""), result: "ERROR" };
    if (!mid) { out.error_code = "NO_MUTATION_ID"; return out; }
    try {
      let r;
      if (op === "CREATE" || op === "UPDATE") {
        const req = Object.assign({}, m.changes || {});
        req.task_id = m.task_id;
        req.mutation_id = mid;
        if (op === "CREATE") req.create = "1";
        if (m.base_version !== undefined && m.base_version !== null) req.base_version = m.base_version;
        // 変える項目ごとの「自分が見ていた値」。新規作成には使わない
        if (op === "UPDATE" && m.base_values) req.base_values = m.base_values;
        r = saveTask(studentEmail, req);
      } else if (op === "DELETE") {
        r = deleteTask(studentEmail, { task_id: m.task_id, mutation_id: mid });
      } else if (op === "CARRY_OVER") {
        r = carryOverTask(studentEmail, { task_id: m.task_id, mutation_id: mid,
                                          to_date: (m.changes && m.changes.to_date) || "" });
      } else {
        out.error_code = "UNKNOWN_OPERATION";
        return out;
      }
      if (r.ok) {
        out.result = r.duplicate ? "DUPLICATE" : "APPLIED";
        out.task_id = String(r.id || r.task_id || out.task_id);
        if (r.data) { out.new_version = r.data.version; out.canonical_task = r.data; }
        return out;
      }
      if (r.error === "FIELD_CONFLICT") {
        out.result = "FIELD_CONFLICT";
        out.error_code = "FIELD_CONFLICT";
        out.field_name = r.field_name;
        out.base_value = r.base_value;
        out.server_value = r.server_value;
        out.client_value = r.client_value;
        out.canonical_task = r.server;
        return out;
      }
      if (r.error === "TASK_CONFLICT") {
        out.result = "CONFLICT";
        out.canonical_task = r.server;   // サーバーの最新版。端末が判断材料に使う
        out.error_code = "TASK_CONFLICT";
        return out;
      }
      if (r.error === "TASK_DELETED") {
        out.result = "DELETED_REJECTED";  // 恒久エラー。再試行しても無駄
        out.error_code = "TASK_DELETED";
        return out;
      }
      out.error_code = String(r.error || "UNKNOWN");
      return out;
    } catch (err) {
      out.error_code = "EXCEPTION: " + String(err && err.message || err).slice(0, 120);
      return out;
    }
  });
  return { ok: true, results: results };
}

function saveTask(studentEmail, body) {
  // 自己経営力は計算に時間がかかるので取っておいている。書き換えたら
  // 古い結果に当たらないよう世代を進める（2026-08-05）。
  smpBumpEpoch_(studentEmail);
  const chk = p1RequireUser(studentEmail);
  if (!chk.ok) return chk;
  const id = String((body && body.task_id) || "").trim();
  const existing = id ? p1OwnedRow("Tasks", "task_id", id, studentEmail) : null;
  // ★create="1" はクライアント採番のidを持ち込む新規作成★
  //   オフラインの操作キューでは、作成→編集→完了が同じidで並ぶ。
  //   サーバー採番にすると後続の操作が迷子になるため、idごと受け取る。
  //   他ユーザーとのid衝突はp1Upsertが持ち主で行を分けるので安全。
  if (id && !existing && String((body && body.create) || "") !== "1") {
    return { ok: false, error: "タスクが見つかりません" };
  }

  // ★同じ操作の再送を二重に実行しない★
  //   オフラインで貯めた操作を送り直したとき、carryover_count が2回増えたり
  //   同じタスクが2件できたりするのを防ぐ。直前の結果をそのまま返す。
  const mutationId = String((body && body.mutation_id) || "").trim();
  if (mutationId && existing && String(existing.last_mutation_id || "") === mutationId) {
    return { ok: true, id: id, duplicate: true,
             data: decorateTask(existing, Date.now()),
             note: "同じ操作を受け取ったので、二重に実行していません" };
  }

  // ★消したタスクは復活させない★
  //   古い端末が同じ task_id を送ってきても、削除済みなら拒否する。
  if (existing && String(existing.deleted_at || "").trim() && String(body.restore || "") !== "1") {
    return { ok: false, error: "TASK_DELETED",
             note: "削除済みのタスクです。戻すには明示的な復元が要ります" };
  }

  // ★同じ項目を2端末で変えたときだけ止める（フィールド単位）★
  //   レコード全体のversionで見ると、PCで重要度・スマホで期限のような
  //   ぶつからない変更まで止まってしまう。逆にversionを見ないと、
  //   同じ期限を両方が変えたときに片方が黙って消える。
  //   そこで「変える項目の、自分が見ていた値」を送ってもらい、
  //   サーバーの今の値と違うときだけ止める。
  if (existing && body.base_values !== undefined) {
    let bv = body.base_values;
    if (typeof bv === "string") { try { bv = JSON.parse(bv); } catch (e) { bv = null; } }
    if (bv && typeof bv === "object") {
      const norm = function (k, v) {
        if (v === undefined || v === null) return "";
        if ((k === "due_at" || k === "date") && v instanceof Date) return p1DateOut_(v);
        if (k === "status") return normalizeTaskStatus(v);
        return String(v).trim();
      };
      // ★聞くのは「消えたら困る項目」だけ★（2026-08-03 Kaiの判断）
      //   題名・日付・期限が食い違ったときだけ止める。
      //   メモ・想定時間・状態・並び順は、あとから見て直せるものなので
      //   新しいほうを採用し、確認を求めない。
      //   （毎回の確認は手間で、しかも並べ替えは自分の送信同士でぶつかる）
      const ASK_ONLY = { title: 1, date: 1, due_at: 1 };
      const keys = Object.keys(bv).filter(function (k) { return ASK_ONLY[k]; });
      // 聞かずに上書きした項目は、あとで本人に伝えられるよう控えておく
      const autoResolved = [];
      Object.keys(bv).forEach(function (k) {
        if (ASK_ONLY[k]) return;
        const sv = norm(k, existing[k]), bvv = norm(k, bv[k]), wv = norm(k, body[k]);
        if (sv !== wv && sv !== bvv) autoResolved.push(k);
      });
      if (autoResolved.length) body.__auto_resolved = autoResolved;
      for (let i = 0; i < keys.length; i++) {
        const f = keys[i];
        const serverVal = norm(f, existing[f]);
        const baseVal = norm(f, bv[f]);
        // ★同じ値になるなら聞かない★ 結果が変わらない確認は手間なだけ
        const wantVal = norm(f, body[f]);
        if (serverVal === wantVal) continue;
        if (serverVal !== baseVal) {
          authAudit("TASK_FIELD_CONFLICT", { result: "DENY", action: "saveTask",
                    failureReason: "task=" + id + " field=" + f });
          return { ok: false, error: "FIELD_CONFLICT",
                   task_id: id, field_name: f,
                   base_value: baseVal, server_value: serverVal,
                   client_value: (body[f] !== undefined ? String(body[f]) : ""),
                   server: decorateTask(existing, Date.now()),
                   note: "別の端末で同じ項目が変更されています" };
        }
      }
    }
  }

  // ★レコード全体の版チェック（明示的に送られたときだけ）★
  //   クライアントが「自分が見ていた版」を送る。サーバーと違えば、
  //   どちらが正しいかはこちらで決めず、両方返して判断を委ねる。
  if (existing && body.base_version !== undefined && String(body.base_version) !== "") {
    const curVer = Number(existing.version || 0);
    if (Number(body.base_version) !== curVer) {
      return { ok: false, error: "TASK_CONFLICT",
               server: decorateTask(existing, Date.now()),
               yours: body,
               note: "別の端末で更新されています。サーバーの内容を確認してください" };
    }
  }
  const title = p1Text_(body.title, 200);
  if (!id && !String(title).trim()) return { ok: false, error: "タスク名を入れてください" };

  // 紐づけ先が本人のものかを必ず確認する（他人の週間目標へ結び付けさせない）
  const wg = String(body.link_weekly_goal_id || "").trim();
  if (wg && !p1OwnedRow("WeeklyGoals", "weekly_goal_id", wg, studentEmail)) {
    return { ok: false, error: "紐づけ先の週間目標が見つかりません" };
  }

  const rec = { task_id: id || makeP1Id("task"), student_email: studentEmail };
  if (body.title !== undefined) rec.title = title;
  if (body.date !== undefined) rec.date = p1Text_(body.date, 10);
  if (body.link_weekly_goal_id !== undefined) rec.link_weekly_goal_id = wg;
  if (body.link_daily_focus_id !== undefined) rec.link_daily_focus_id = p1Text_(body.link_daily_focus_id, 40);
  if (body.estimated_minutes !== undefined) rec.estimated_minutes = p1Num_(body.estimated_minutes);
  // ★actual_minutes はクライアントから書かせない★
  //   実績時間の正は DailyLog.actual_minutes。Tasks 側はそこから作る集計キャッシュ。
  //   両方を独立して書けると、どちらが本当か分からなくなる（二重の正）。
  //   互換のため、送られてきても黙って無視する（エラーにはしない）。
  if (body.memo !== undefined) rec.memo = p1Text_(body.memo, 1000);
  if (body.completion_condition !== undefined) rec.completion_condition = p1Text_(body.completion_condition, 500);

  // 重要度は本人が決める。範囲外の値は受け取らない
  if (body.importance_level !== undefined) {
    const imp = String(body.importance_level).toUpperCase();
    rec.importance_level = IMPORTANCE_LEVELS.indexOf(imp) !== -1 ? imp : "MEDIUM";
  }
  if (body.due_at !== undefined) rec.due_at = p1Text_(body.due_at, 25);
  // 緊急度の上書き。NONE や空なら解除
  if (body.urgency_override !== undefined) {
    const uo = String(body.urgency_override).toUpperCase();
    rec.urgency_override = URGENCY_LEVELS.indexOf(uo) !== -1 && uo !== "NONE" ? uo : "";
  }
  if (body.urgency_override_reason !== undefined) {
    rec.urgency_override_reason = p1Text_(body.urgency_override_reason, 300);
  }

  // 着手・完了の記録。あとから「期限前に着手できたか」を見るために使う
  if (body.status !== undefined) {
    const st = normalizeTaskStatus(body.status);
    rec.status = st;
    const cur = id ? p1OwnedRow("Tasks", "task_id", id, studentEmail) : null;
    // ★最初に着手したときだけ記録する★ 再開のたびに上書きしない。
    //   上書きすると「期限前に着手できた割合」が測れなくなる。
    if (st === "IN_PROGRESS" && (!cur || !String(cur.first_started_at || "").trim())) {
      rec.first_started_at = new Date().toISOString();
    }
    if (st === "DONE") rec.completed_at = new Date().toISOString();
    if (st !== "DONE" && cur && String(cur.completed_at || "").trim()) rec.completed_at = "";
    // 既存の COMPLETED 表記を DONE へ寄せる（読み替えではなく保存時に揃える）
    if (normalizeTaskStatus(cur && cur.status) === "DONE" && st === "DONE") rec.status = "DONE";
  }

  // 文脈。受け取るのは内部コードだけ。勝手に推測して振り分けない
  if (body.context !== undefined) {
    const cx = String(body.context).toUpperCase();
    rec.context = TASK_CONTEXTS.indexOf(cx) !== -1 ? cx : "UNSET";
  }
  if (body.source_type !== undefined) {
    const sc = String(body.source_type).toUpperCase();
    rec.source_type = TASK_SOURCE_TYPES.indexOf(sc) !== -1 ? sc : "SELF";
  }
  if (body.requested_by !== undefined) rec.requested_by = p1Text_(body.requested_by, 100);
  if (body.requested_at !== undefined) rec.requested_at = p1Text_(body.requested_at, 25);
  if (body.sort_order !== undefined) rec.sort_order = p1Num_(body.sort_order);

  rec.version = Number((existing && existing.version) || 0) + 1;
  rec.updated_at = new Date().toISOString();
  if (mutationId) rec.last_mutation_id = mutationId;
  rec.student_email = studentEmail;   // 持ち主を必ず入れて書く（他人の行を触らない）

  const r = p1Upsert("Tasks", "task_id", rec);
  const saved = p1OwnedRow("Tasks", "task_id", r.id, studentEmail);
  const autoResolvedOut = body.__auto_resolved || null;
  // ★サーバーが確定した内容をそのまま返す★
  //   端末はこれを反映する。各端末が独自の値を持ち続けないため。
  return { ok: true, id: r.id, created: r.created,
           // 聞かずに新しいほうを採用した項目（端末に一言だけ知らせるため）
           auto_resolved: autoResolvedOut,
           data: saved ? decorateTask(saved, Date.now()) : null };
}

// タスクの削除は論理削除にする。集計（持ち越し率・完了率）の母数が
// 消えてしまうと、あとから振り返れなくなるため。
// ★削除は物理削除しない★
//   行ごと消すと、古い端末が同じ task_id を送ってきたときに復活する。
//   deleted_at を立てて墓標（tombstone）として残し、
//   同期データには含めることで「これは消えた」と伝える。
function deleteTask(studentEmail, body) {
  const chk = p1RequireUser(studentEmail);
  if (!chk.ok) return chk;
  const id = String((body && body.task_id) || "").trim();
  const row = id ? p1OwnedRow("Tasks", "task_id", id, studentEmail) : null;
  if (!row) return { ok: false, error: "タスクが見つかりません" };

  const mutationId = String((body && body.mutation_id) || "").trim();
  if (mutationId && String(row.last_mutation_id || "") === mutationId) {
    return { ok: true, deleted: true, task_id: id, duplicate: true };
  }
  if (String(row.deleted_at || "").trim()) {
    return { ok: true, deleted: true, task_id: id, already: true };  // 何度呼んでも同じ
  }
  const rec = { task_id: id, student_email: studentEmail,
                deleted_at: new Date().toISOString(),
                version: Number(row.version || 0) + 1,
                updated_at: new Date().toISOString() };
  if (mutationId) rec.last_mutation_id = mutationId;
  p1Upsert("Tasks", "task_id", rec);
  return { ok: true, deleted: true, task_id: id };
}

// ★持ち越し★ 新しいタスクを複製しない。同じ task_id のまま日付を移す。
function carryOverTask(studentEmail, body) {
  const chk = p1RequireUser(studentEmail);
  if (!chk.ok) return chk;
  const id = String((body && body.task_id) || "").trim();
  const row = id ? p1OwnedRow("Tasks", "task_id", id, studentEmail) : null;
  if (!row) return { ok: false, error: "タスクが見つかりません" };
  if (String(row.deleted_at || "").trim()) return { ok: false, error: "TASK_DELETED" };

  const mutationId = String((body && body.mutation_id) || "").trim();
  if (mutationId && String(row.last_mutation_id || "") === mutationId) {
    // ★同じ操作を二重に実行しない★ carryover_count が2回増えるのを防ぐ
    return { ok: true, task_id: id, duplicate: true, data: decorateTask(row, Date.now()) };
  }

  const from = String(row.date || "").slice(0, 10);
  const to = String((body && body.to_date) || "").slice(0, 10) ||
             Utilities.formatDate(new Date(Date.now() + 86400000), "Asia/Tokyo", "yyyy-MM-dd");
  if (from === to) return { ok: false, error: "同じ日付へは持ち越せません" };

  const rec = {
    task_id: id, student_email: studentEmail, date: to,
    carryover_count: Number(row.carryover_count || 0) + 1,
    // 元の日付を残す。積み重なるので履歴として連ねる
    carried_from: (String(row.carried_from || "") ? row.carried_from + "," : "") + from,
    status: "CARRIED_OVER",
    version: Number(row.version || 0) + 1,
    updated_at: new Date().toISOString()
  };
  if (mutationId) rec.last_mutation_id = mutationId;
  p1Upsert("Tasks", "task_id", rec);
  const saved = p1OwnedRow("Tasks", "task_id", id, studentEmail);
  authAudit("TASK_CARRYOVER", { result: "SUCCESS", action: "carryOverTask",
            failureReason: "task=" + id + " " + from + "→" + to +
                           " count=" + rec.carryover_count });
  return { ok: true, task_id: id, from: from, to: to,
           carryover_count: rec.carryover_count,
           data: saved ? decorateTask(saved, Date.now()) : null };
}

function migrateLocalTasks(studentEmail, body) {
  // ── 認可 ──
  // 書き込み先は常に「リクエストのstudentEmail本人のTasks」に限定される（後述のp1Upsertで
  // student_email を studentEmail で固定しているため、他人の行は作れない）。
  // 加えて、実在する有効ユーザーであること・新機能の対象者であることを確認する。
  // ※このWeb appはリクエストのメールを信用する構造のため、これは「なりすまし防止」ではなく
  //   「無効な宛先への書き込みと、対象外ユーザーによる実行を防ぐ」ためのチェック。
  //   本格的なトークン認証は全API共通の課題として別途対応する
  const user = getFilteredRows("Users", "student_email", studentEmail)[0];
  if (!user || String(user.is_active).toUpperCase() !== "TRUE") return { ok: false, error: "invalid user" };
  if (!hasFeature(user, P1_FEATURE_KEY)) return { ok: false, error: "feature not enabled" };

  // ── 入力の検証 ──
  const raw = String(body.items || "");
  if (raw.length > 200000) return { ok: false, error: "items too large" }; // 巨大送信で行を量産させない
  let items;
  try { items = JSON.parse(raw || "[]"); } catch (e) { return { ok: false, error: "invalid items" }; }
  if (!Array.isArray(items)) return { ok: false, error: "invalid items" };
  if (items.length > 300) return { ok: false, error: "too many items" };   // 1日10件×30日を上限の目安に

  // 古い端末を後から開いた時の上書きを防ぐ最重要の防御
  if (String(user.task_migrated_at || "").trim()) {
    return { ok: true, skipped: true, reason: "already_migrated", migrated_at: String(user.task_migrated_at) };
  }

  const existing = p1List("Tasks", studentEmail);
  const byId = {};
  const byDateTitle = {};
  existing.forEach(t => {
    byId[String(t.task_id)] = true;
    byDateTitle[String(t.date) + "|" + String(t.title).trim()] = true;
  });

  // 同名タスクの出現順を数える（決定的なIDにするため）
  const seenCount = {};
  let created = 0, skipped = 0;
  items.forEach(it => {
    const date = String(it.date || "").slice(0, 10);
    const title = String(it.title || "").trim();
    if (!date || !title) return;
    const key = date + "|" + title;
    const idx = seenCount[key] = (seenCount[key] === undefined ? 0 : seenCount[key] + 1);
    const taskId = makeTaskId(studentEmail, date, title, idx);

    if (byId[taskId]) { skipped++; return; }               // 同じIDが既にある
    if (idx === 0 && byDateTitle[key]) { skipped++; return; } // 同日同名が既にある（既存を優先）

    // 同名の2件目以降は、どの補助情報がどれのものか判別できないため付けない（推測しない）
    const isFirst = idx === 0;
    p1Upsert("Tasks", "task_id", {
      task_id: taskId,
      student_email: studentEmail,
      date: date,
      title: title,
      priority: "NORMAL",
      link_weekly_goal_id: "",
      link_daily_focus_id: "",
      estimated_minutes: isFirst ? (Number(it.estimated_minutes) > 0 ? Number(it.estimated_minutes) : "") : "",
      actual_minutes: "",
      status: isFirst ? (it.completed ? "COMPLETED" : String(it.status || "TODO")) : "TODO",
      completed_at: "",
      completion_condition: "",
      memo: isFirst ? String(it.memo || "") : ""
    });
    byId[taskId] = true;
    byDateTitle[key] = true;
    created++;
  });

  // 成功した時だけ記録する（失敗時はフラグを立てず、次回起動で自動再試行される）
  const sheet = getSheet("Users");
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  let colIdx = headers.indexOf("task_migrated_at");
  if (colIdx === -1) { colIdx = headers.length; sheet.getRange(1, colIdx + 1).setValue("task_migrated_at"); }
  const data = sheet.getDataRange().getValues();
  const emailIdx = headers.indexOf("student_email");
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][emailIdx]) !== studentEmail) continue;
    sheet.getRange(i + 1, colIdx + 1).setValue(new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }));
    break;
  }
  return { ok: true, created: created, skipped: skipped, total: items.length };
}

// ── Phase 1 のセットアップ（新規シート作成＋既存シートへの列追加）──
// 何度実行しても同じ結果になる（既にあるものは触らない）
function setupPhase1() {
  const created = [], addedCols = {};
  Object.keys(P1_SHEETS).forEach(name => {
    const existed = !!getSheet(name);
    // ★既存シートでも必ず getP1Sheet を通す★
    // 以前は「シートが無いときだけ」呼んでいたため、P1_SHEETS の定義に
    // 列を足しても既存シートには永久に反映されなかった。
    // getP1Sheet は不足している列を末尾へ足すだけ（削除も改名もしない）。
    const before = existed ? getSheet(name).getLastColumn() : 0;
    getP1Sheet(name);
    if (!existed) { created.push(name); return; }
    const after = getSheet(name).getLastColumn();
    if (after > before) addedCols[name] = P1_SHEETS[name].slice(before, after);
  });
  Object.keys(P1_ADDED_COLUMNS).forEach(name => {
    const added = ensureP1Columns(name);
    if (added.length) addedCols[name] = added;
  });
  return { ok: true, createdSheets: created, addedColumns: addedCols };
}

// ══════════════════════════════════════════════════════════════════
// 以下2つは Apps Script のエディタから手で実行する専用の関数。
// ★doGet/doPostのcaseには絶対に追加しないこと★
// Web app経由にすると「リクエストに書いたメールを信用する」構造に乗ってしまい、
// 誰でも叩けてしまう。エディタからの実行はGoogleログイン＝本物の認証なので、
// 鍵の発行とデータのバックアップはこちらに置いている。
// ══════════════════════════════════════════════════════════════════

// 管理APIの共有シークレットを発行して保存する。実行後、ログに出た文字列を控える。
// 既に設定済みなら上書きせず、設定済みである旨だけ返す（誤って鍵を作り替えないため）。
function p1GenerateAdminSecret() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty("P1_ADMIN_SECRET")) {
    Logger.log("P1_ADMIN_SECRET は既に設定済みです。作り直したい場合は先に削除してください。");
    return { ok: true, alreadySet: true };
  }
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 紛らわしい0/O/1/l/Iは除く
  let secret = "";
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + String(new Date().getTime()));
  bytes.forEach(b => { if (secret.length < 32) secret += chars.charAt(((b & 0xFF)) % chars.length); });
  props.setProperty("P1_ADMIN_SECRET", secret);
  Logger.log("P1_ADMIN_SECRET を設定しました:\n" + secret + "\n管理APIを叩くときは &secret=" + secret + " を付けてください。");
  return { ok: true, secret: secret };
}

// スプレッドシート（本番データ）をまるごと複製してバックアップを取る。
// 個人情報を含むため、コピー先はKaiのGoogleドライブ内のフォルダのみ。
// GitHubや外部には絶対に出さない。古いものは自動で消さない（手で判断する）。
function p1BackupSpreadsheet() {
  const FOLDER_NAME = "JIROKUバックアップ";
  const it = DriveApp.getFoldersByName(FOLDER_NAME);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
  const stamp = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyyMMdd_HHmm");
  const src = DriveApp.getFileById(SPREADSHEET_ID);
  const copy = src.makeCopy("JIROKU_backup_" + stamp, folder);
  const counts = {};
  getSpreadsheet().getSheets().forEach(s => { counts[s.getName()] = Math.max(0, s.getLastRow() - 1); });
  const msg = "バックアップ完了\n場所: マイドライブ/" + FOLDER_NAME + "/" + copy.getName()
    + "\nURL: " + copy.getUrl() + "\n件数: " + JSON.stringify(counts, null, 2);
  Logger.log(msg);
  return { ok: true, name: copy.getName(), url: copy.getUrl(), counts: counts };
}

function setupSheets() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheets = {
    "Users": ["student_email","name","line_user_id","coach_email","coach_line_id","google_calendar_id","chatwork_room","is_active","joined_at","notify_start","notify_end","nickname","avatar","show_in_community","fcm_token","cohort"],
    "DailyLog": ["log_id","student_email","date","time_block","task","focus_level","memo","timestamp","goal_related","xp_awarded"],
    "Reports": ["date","student_email","score","feedback","action","highlights","improvement","created_at","breakdown"],
    "Messages": ["message_id","student_email","content","sender_name","sender_photo","sender_role","timestamp","is_read"],
    "Coaches": ["coach_email","coach_name","assigned_students"],
    "MonthlySummary": ["month","student_email","summary","created_at"],
    "WeeklySummary": ["week_start","week_end","student_email","summary","avg_score","total_blocks","goal_related_pct","streak_end","created_at"],
    "CalendarCache": ["student_email","date","events","updated_at"],
    "Journal": ["date","student_email","diary","updated_at","auto_summary"],
    "TimerQueue": ["student_email","end_time","label","notified","created_at"],
    "Achievements": ["achievement_id","date","student_email","nickname","avatar","message","created_at","category"],
    "CoachingNotes": ["note_id","coach_email","student_email","date","content","next_theme","promises","created_at","unverified"],
    "StudentProfile": ["student_email","coach_email","name","birthdate","gender","family","address","phone","occupation","profile_notes","instagram","tiktok","contract_start","contract_end","payment_type","contract_amount","installment_count","updated_at","stripe_email","stripe_total_paid","stripe_currency","stripe_synced_at","chatwork_id","chatwork_room_id"],
    "ContractFiles": ["file_id","student_email","file_name","file_url","note","uploaded_at"],
    "ChatworkMessages": ["message_id","room_id","student_email","account_id","sender_name","body","send_time","synced_at"]
  };
  Object.entries(sheets).forEach(([name, headers]) => {
    let s = ss.getSheetByName(name);
    if (!s) s = ss.insertSheet(name);
    if (s.getLastRow() === 0) s.appendRow(headers);
  });
  console.log("シート作成完了");
}

// 管理者がWeb API経由でトリガーを再設定するためのラッパー（editorを開かずに実行できる）。
// setupTriggersは全トリガーを削除して張り直すため、管理者のみ許可
function adminSetupTriggers(email) {
  if (!verifyAdmin(email)) return { ok: false, error: "not admin" };
  try {
    setupTriggers();
    const count = ScriptApp.getProjectTriggers().length;
    return { ok: true, triggerCount: count };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// 特定のハンドラのトリガーが無ければ1本だけ追加する（全張り直しを避けたい時用）。
// 既にあれば何もしない。新しい定期処理を1つ足す時に安全に使える
function adminInstallTrigger(email, handler, replaceFlag) {
  if (!verifyAdmin(email)) return { ok: false, error: "not admin" };
  const name = String(handler || "").trim();
  // 追加してよいハンドラと、その時刻をここで決める。
  // ★setupTriggers は冒頭で全トリガーを削除して張り直すため、
  //   稼働中に使うと夜間レポート等を巻き込む。1本だけ足したい時はこちらを使う★
  const allowed = {
    dailyOpsHealthCheck: function (b) { return b.timeBased().everyDays(1).atHour(23).nearMinute(59); },
    weeklyBackup:        function (b) { return b.timeBased().everyWeeks(1).onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(3); },
    // 控えておいたカレンダー書き込みを流す（記録の保存を待たせないため）
    flushOwnerCalendarQueue: function (b) { return b.timeBased().everyMinutes(1); },
    // 古いchallengeの掃除（ログインが遅くなるのを防ぐ）
    authPurgeOldChallenges: function (b) { return b.timeBased().everyDays(1).atHour(4); }
  };
  if (!allowed[name]) return { ok: false, error: "許可されていないハンドラ: " + name };
  // ★時刻を変えたいときは張り直す★（2026-08-05）
  //   コードの時刻を変えても、既に作られたトリガーは動かない。
  //   replace=1 のときだけ、その1本を消してから作り直す。
  const replace = String(replaceFlag || "") === "1";
  const olds = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === name);
  if (olds.length && !replace) return { ok: true, data: { added: false, note: "既に登録済み（張り直すなら replace=1）" } };
  if (olds.length && replace) olds.forEach(t => { try { ScriptApp.deleteTrigger(t); } catch (e) {} });
  if (ScriptApp.getProjectTriggers().length >= 20) return { ok: false, error: "トリガー上限(20)に達しています" };
  allowed[name](ScriptApp.newTrigger(name)).create();
  return { ok: true, data: { added: true, handler: name,
           triggerCount: ScriptApp.getProjectTriggers().length } };
}

function setupTriggers() {
  // GASは1スクリプトあたり時間主導トリガー最大20個までのため、
  // 「毎時7〜23時に個別トリガー」(17個)は他と合わせると上限を超えてしまう。
  // hourlyReminder側で時刻・間隔をチェックしているので、1時間ごとの単一トリガーに統合する。
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("morningScheduleNotify").timeBased().everyDays(1).atHour(7).create();
  ScriptApp.newTrigger("nightlyReport").timeBased().everyDays(1).atHour(22).create();
  ScriptApp.newTrigger("nightlyCoachMessage").timeBased().everyDays(1).atHour(22).nearMinute(30).create();
  ScriptApp.newTrigger("generateMonthlySummaries").timeBased().onMonthDay(1).atHour(3).create();
  ScriptApp.newTrigger("generateMonthlyReviews").timeBased().onMonthDay(1).atHour(8).create();
  ScriptApp.newTrigger("generateAllInsights").timeBased().onMonthDay(1).atHour(5).create();
  ScriptApp.newTrigger("generateAllTimeThemes").timeBased().onMonthDay(1).atHour(6).create();
  ScriptApp.newTrigger("generateWeeklySummaries").timeBased().everyWeeks(1).onWeekDay(ScriptApp.WeekDay.SATURDAY).atHour(8).create();
  // 週次バックアップ。利用が最も少ない日曜の早朝に取る
  ScriptApp.newTrigger("weeklyBackup").timeBased().everyWeeks(1).onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(3).create();
  ScriptApp.newTrigger("checkTimerQueue").timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger("hourlyReminder").timeBased().everyHours(1).create();
  ScriptApp.newTrigger("syncStripeTotals").timeBased().everyDays(1).atHour(4).create();
  ScriptApp.newTrigger("syncChatworkMessages").timeBased().everyHours(1).create();
  ScriptApp.newTrigger("checkGrowthMilestones").timeBased().everyWeeks(1).onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(9).create();
  ScriptApp.newTrigger("snsAutoFetchAll").timeBased().everyDays(1).atHour(21).create();
  ScriptApp.newTrigger("dailyLineWinback").timeBased().everyDays(1).atHour(19).create();
  // 運営ヘルスチェック：夜間レポート(22時)＋穴埋めが落ち着いた翌朝7時に、前日の欠落等を管理者へ
  // 運営レポートは23:59（Kai要望）。22時の夜レポートが出そろってから送る
  ScriptApp.newTrigger("dailyOpsHealthCheck").timeBased().everyDays(1).atHour(23).nearMinute(59).create();
  console.log("トリガーを設定しました（合計15個）");
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// テスト用
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 過去days日ぶんの「記録があるのにレポートがない」欠落を洗い出して生成する管理者用API。
// dryRun=1なら生成せず欠落一覧のみ返す。1回の呼び出しで生成するのはlimit件まで
// （Claude呼び出しは1件数秒〜十数秒かかり、GASの実行上限に当たらないようにするため。
// 残りがあれば戻り値のremainingで分かるので、続けてもう一度呼べばよい）
function adminBackfillReports(coachEmail, days, limit, dryRun) {
  if (!verifyCoach(coachEmail)) return { ok: false, error: "not a coach" };
  const nDays = Math.min(Number(days) || 7, 31);
  const nLimit = Math.min(Number(limit) || 5, 15);
  const users = sheetToObjects(getSheet("Users")).filter(u => u.is_active.toUpperCase() === "TRUE");
  const allLogs = sheetToObjects(getSheet("DailyLog"));
  const haveReport = new Set(sheetToObjects(getSheet("Reports")).map(r => r.student_email + "|" + r.date));
  const userByEmail = new Map(users.map(u => [u.student_email, u]));

  const today = formatDate(new Date());
  const dates = [];
  for (let k = 1; k <= nDays; k++) {
    const d = new Date(); d.setDate(d.getDate() - k);
    dates.push(formatDate(d));
  }
  const dateSet = new Set(dates);

  // (email, date)ごとにログを集める
  const logsByKey = new Map();
  allLogs.forEach(l => {
    const em = String(l.student_email || "");
    if (!em || !dateSet.has(l.date) || !userByEmail.has(em)) return;
    const key = em + "|" + l.date;
    (logsByKey.get(key) || logsByKey.set(key, []).get(key)).push(l);
  });

  const missing = [];
  logsByKey.forEach((logs, key) => { if (!haveReport.has(key)) missing.push(key); });
  missing.sort(); // 古い順・ユーザー順で安定させる

  if (String(dryRun) === "1") {
    return { ok: true, data: { missing: missing, count: missing.length } };
  }

  const doneList = [], failList = [];
  for (const key of missing.slice(0, nLimit)) {
    const sep = key.indexOf("|");
    const email = key.slice(0, sep), date = key.slice(sep + 1);
    const user = userByEmail.get(email);
    try {
      const logs = logsByKey.get(key)
        .sort((a, b) => a.time_block > b.time_block ? 1 : -1)
        .map(r => ({ time_block: r.time_block, task: r.task, focus_level: r.focus_level, memo: r.memo }));
      const report = generateReportWithClaude(email, user.name, logs);
      if (!report) { failList.push(key); continue; }
      appendReportRow(date, email, report, logs.length);
      doneList.push(key + " score=" + report.score);
    } catch (err) { failList.push(key + " " + err); }
  }
  return { ok: true, data: { generated: doneList, failed: failList, remaining: missing.length - Math.min(missing.length, nLimit) } };
}

// ── 学生向けLINE連携キャンペーンの一斉メール ──
// 送信者はスクリプト所有者(Kai)のGmail名義。dryRun=1で「宛先一覧＋実際の文面」を
// 返すだけ（送信しない）。承認後にdryRunなしで実送信する。宛先は九産大生(cohort付き)のみ。
//   segment=nolog    … 登録したが一度も記録していない学生（初記録＋LINE連携を促す）
//   segment=started  … 記録は始めたがLINE未連携の学生（毎晩レポートのためLINE連携を促す）
function adminSendStudentCampaign(email, body) {
  if (!verifyAdmin(email)) return { ok: false, error: "not admin" };
  const segment = String(body.segment || "");
  const dryRun = String(body.dryRun) === "1";
  const users = sheetToObjects(getSheet("Users")).filter(u => String(u.is_active).toUpperCase() === "TRUE");
  const students = users.filter(u => String(u.cohort || "").trim());
  const loggedEmails = new Set(sheetToObjects(getSheet("DailyLog")).map(l => l.student_email));
  const LINE_URL = "https://lin.ee/5pElLYY";

  let recipients, subject, makeBody;
  if (segment === "nolog") {
    recipients = students.filter(u => !loggedEmails.has(u.student_email));
    subject = "【JIROKU】登録ありがとう！30日記録すると“就活の武器”ができます";
    makeBody = u => u.name + "さん\n\n" +
      "ビジネスコーチング論の砂川です。\n" +
      "JIROKUに登録してくれてありがとう。まだ最初の記録がない人へ、先に「これ何のためにやるの？」の答えを送ります。\n\n" +
      "毎日の記録が30日たまると、この2つが自動で作れます。\n" +
      "・行動アセスメント帳票 … あなたの強み・継続力・集中パターンを「事実」で証明する1枚。盛れないぶん、就活で信用されます。\n" +
      "・ガクチカ素材集 … 面接でそのまま話せるエピソードの素材が、日々の記録から自動で貯まります。\n\n" +
      "始め方は2ステップ、合計2分です。\n" +
      "① アプリを開いて、今日やったことを1つ記録する（1分でOK）\n   " + APP_URL + "\n" +
      "② LINE連携する … 下のリンクを友だち追加し、アプリの 設定 →「LINE連携」で出した連携コードを送るだけ。\n   " + LINE_URL + "\n   → 毎晩、AIコーチがあなたの1日を採点したレポートを届けます。\n\n" +
      "記録は完璧じゃなくていい。「バイトだった」「ゲームしてた」でも、それが全部データになります。\n" +
      "わからないことがあれば授業で声をかけてください。\n\n砂川";
  } else if (segment === "started") {
    recipients = students.filter(u => loggedEmails.has(u.student_email) && !String(u.line_user_id || "").trim());
    subject = "【JIROKU】記録いいね！LINE連携で“毎晩のAIコーチレポート”が届きます";
    makeBody = u => u.name + "さん\n\n" +
      "ビジネスコーチング論の砂川です。\n" +
      "もう記録を始めてくれていますね、いいスタートです。\n" +
      "実は今、あなたに毎晩届くはずの「AIコーチのレポート」が届いていません。LINE連携がまだだからです。\n\n" +
      "JIROKUは毎晩、あなたのその日の記録をAIコーチが読んで、点数と「明日はこうするといい」を返します。\n" +
      "アプリを開かなくてもLINEに届くので、続けるのが一気にラクになります。\n\n" +
      "連携は1分：\n下のリンクを友だち追加 → アプリの 設定 →「LINE連携」で連携コードを出してトークで送る、これだけです。\n   " + LINE_URL + "\n\n" +
      "このまま30日続くと、就活で使える「行動アセスメント帳票」と「ガクチカ素材集」が作れます。\n" +
      "いいペースなので、もったいないところで止まらないように。\n\n砂川";
  } else {
    return { ok: false, error: "segmentは nolog か started を指定してください" };
  }

  if (dryRun) {
    return { ok: true, data: {
      segment: segment, count: recipients.length,
      recipients: recipients.map(u => ({ name: u.name, email: u.student_email })),
      subject: subject,
      bodySample: makeBody(recipients[0] || { name: "（例）" })
    } };
  }
  let sent = 0; const failed = [];
  recipients.forEach(u => {
    try { MailApp.sendEmail(u.student_email, subject, makeBody(u)); sent++; }
    catch (e) { failed.push(u.student_email + " " + e); }
  });
  Logger.log("adminSendStudentCampaign: segment=" + segment + " sent=" + sent + " failed=" + failed.length);
  return { ok: true, data: { segment: segment, sent: sent, failed: failed } };
}

function generateReportForDate(targetDate) {
  const users = sheetToObjects(getSheet("Users")).filter(u => u.is_active.toUpperCase() === "TRUE");
  users.forEach(user => {
    try {
      const allLogs = sheetToObjects(getSheet("DailyLog"));
      const logs = allLogs
        .filter(r => r.student_email === user.student_email && r.date === targetDate)
        .sort((a, b) => a.time_block > b.time_block ? 1 : -1)
        .map(r => ({ time_block: r.time_block, task: r.task, focus_level: r.focus_level, memo: r.memo }));

      if (logs.length === 0) {
        Logger.log(user.student_email + ": " + targetDate + " のログなし");
        return;
      }

      // 既存レポートがあればスキップ
      const existing = sheetToObjects(getSheet("Reports")).find(r => r.student_email === user.student_email && r.date === targetDate);
      if (existing) {
        Logger.log(user.student_email + ": " + targetDate + " のレポートは既に存在します");
        return;
      }

      const report = generateReportWithClaude(user.student_email, user.name, logs);
      if (!report) { Logger.log("レポート生成失敗"); return; }
      appendReportRow(targetDate, user.student_email, report, logs.length);
      Logger.log(user.student_email + ": " + targetDate + " レポート生成完了 スコア=" + report.score);
    } catch(err) { Logger.log(err); }
  });
}

// テスト関数用の管理者メールアドレス。本名を含むためコードに直書きせず、
// GASエディタの「プロジェクトの設定 > スクリプト プロパティ」に
// ADMIN_EMAIL として登録した値を読む（コードを貼り替えても消えない）。
function adminEmail() {
  return PropertiesService.getScriptProperties().getProperty("ADMIN_EMAIL") || "";
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 成長マイルストーン監視（週1実行）
// アクティブユーザー数がしきい値を超えたら、その規模で着手すべき
// セキュリティ・インフラ対応を管理者にメール+LINE/プッシュで通知する。
// 一度通知したしきい値はスクリプトプロパティに記録して再通知しない
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const GROWTH_MILESTONES = [
  { count: 300, todo:
    "①ユーザーごとのアクセストークン認証を導入（現状はメールアドレスだけで本人になりすませる）\n" +
    "②APIのレート制限（CacheServiceで同一ユーザー毎分N回まで）\n" +
    "③スプレッドシートの週次自動バックアップ" },
  { count: 500, todo:
    "①コーチ権限チェックの総点検（coachOwnsStudentの漏れ確認）\n" +
    "②プライバシーポリシー・利用規約の正式公開（LPフッターのリンク設置）\n" +
    "③アクセス監査ログの記録開始\n" +
    "④Supabase等へのDB移行の検討開始（スプレッドシートの性能限界が近い）" },
  { count: 1000, todo:
    "①スプレッドシート→Supabase等への移行を実行（行レベルセキュリティで自分のデータしか読めない構造に）\n" +
    "②Googleログイン（OAuth）ベースの正式な認証へ切り替え\n" +
    "③外部のセキュリティ脆弱性診断を1回受ける\n" +
    "④個人情報保護法の安全管理措置を文書化（漏洩時の報告体制など）" },
];

function checkGrowthMilestones() {
  const users = sheetToObjects(getSheet("Users"));
  const activeUsers = users.filter(u => String(u.is_active || "").toUpperCase() === "TRUE").length;
  const props = PropertiesService.getScriptProperties();
  let notified = [];
  try { notified = JSON.parse(props.getProperty("GROWTH_NOTIFIED") || "[]"); } catch (e) {}

  GROWTH_MILESTONES.forEach(m => {
    if (activeUsers < m.count || notified.indexOf(m.count) !== -1) return;

    const subject = "【JIROKU】ユーザー数が" + m.count + "人を突破 — セキュリティ対応のタイミングです";
    const bodyText = "アクティブユーザー数が " + activeUsers + " 人になり、" + m.count + "人のしきい値を超えました。\n\n" +
      "この規模で着手すべき対応:\n" + m.todo + "\n\n" +
      "（ロードマップに基づく自動リマインドです。着手する時はClaude Codeに「" + m.count + "人のセキュリティ対応を始めたい」と伝えてください）";

    const admin = adminEmail();
    if (admin) {
      try { MailApp.sendEmail(admin, subject, bodyText); } catch (e) { Logger.log("milestone mail error: " + e); }
      // 管理者がUsersシートにもいる場合はLINE/プッシュでも知らせる（メールより気づきやすい）
      try {
        const adminUser = users.find(u => u.student_email === admin);
        if (adminUser) notifyUserTimeSlot(adminUser, "🚨 " + m.count + "人突破", "セキュリティ対応のタイミングです。メールに詳細を送りました", "🚨 " + subject + "\n\n" + bodyText);
      } catch (e) { Logger.log("milestone notify error: " + e); }
    }

    notified.push(m.count);
    Logger.log("マイルストーン通知: " + m.count + "人（現在" + activeUsers + "人）");
  });

  props.setProperty("GROWTH_NOTIFIED", JSON.stringify(notified));
}

// ── 運営ヘルスチェック（毎朝、管理者のLINEに1通）──
// 夜間処理が静かに壊れても気づけるよう、前日の「記録があるのにレポートが無い」欠落や
// 再開トリガーの詰まり、LINE未連携などを毎朝チェックして管理者に要約を届ける。
// 異常があれば🚨、無ければ✅で始める（毎朝届くこと自体が「動いている」証明になる）。
function dailyOpsHealthCheck(dryRun) {
  const admin = adminEmail();
  if (!admin) { Logger.log("dailyOpsHealthCheck: ADMIN_EMAIL未設定"); return; }
  const users = sheetToObjects(getSheet("Users")).filter(u => String(u.is_active).toUpperCase() === "TRUE");
  const adminUser = users.find(u => u.student_email === admin);
  const allLogs = sheetToObjects(getSheet("DailyLog"));
  const allReports = sheetToObjects(getSheet("Reports"));
  const activeEmails = new Set(users.map(u => u.student_email));

  const today = formatDate(new Date());
  // ★見る日は、動く時刻で変える★（2026-08-05 Kai要望で23:59へ移動）
  //   夜のレポートは22時に作られる。
  //   朝に動かすなら「昨日」、夜に動かすなら「今日」を見ないと、
  //   ついさっき作られたレポートを見落として「欠落」と報告してしまう。
  const runHour = Number(Utilities.formatDate(new Date(), "Asia/Tokyo", "H"));
  const afterNightly = runHour >= 20;
  const yesterday = afterNightly ? today : formatDate(new Date(Date.now() - 86400000));
  const dayLabel = afterNightly ? "今日" : "昨日";
  const daysAgoStr = n => formatDate(new Date(Date.now() - n * 86400000));
  const d7 = daysAgoStr(7);

  // 前日：記録した人 → レポートが生成された人（欠落の検出）
  const loggedYesterday = new Set(allLogs.filter(l => l.date === yesterday && activeEmails.has(l.student_email)).map(l => l.student_email));
  const reportKeys = new Set(allReports.map(r => r.student_email + "|" + r.date));
  const missingYesterday = [...loggedYesterday].filter(em => !reportKeys.has(em + "|" + yesterday));

  // 直近7日の欠落総数（当日を除く）
  let missing7 = 0;
  const seen = new Set();
  allLogs.forEach(l => {
    if (!activeEmails.has(l.student_email)) return;
    if (l.date >= d7 && l.date < today) {
      const k = l.student_email + "|" + l.date;
      if (!seen.has(k)) { seen.add(k); if (!reportKeys.has(k)) missing7++; }
    }
  });

  // 名前解決とセグメント（core=cohortなし / student=cohortあり）
  const userByEmail = new Map(users.map(u => [u.student_email, u]));
  const nameOf = em => { const u = userByEmail.get(em); return u ? (u.nickname || u.name || em) : em; };
  const isStudent = em => { const u = userByEmail.get(em); return u && String(u.cohort || "").trim(); };
  const tag = em => isStudent(em) ? "🎓" : "💼"; // 学生/コーチングを一目で

  // 昨日のレポート（生成できた人のスコア・欠落した人の名前）
  const reportByKey = new Map(allReports.map(r => [r.student_email + "|" + r.date, r]));
  const generatedYesterday = [...loggedYesterday]
    .filter(em => reportByKey.has(em + "|" + yesterday))
    .map(em => ({ em, score: Number(reportByKey.get(em + "|" + yesterday).score) }))
    .sort((a, b) => b.score - a.score);
  const avgYesterday = generatedYesterday.length ? Math.round(generatedYesterday.reduce((s, x) => s + x.score, 0) / generatedYesterday.length) : null;

  // 活動量（当日の記録件数・記録した人数）＋セグメント内訳＋誰が何ブロック記録したか
  const todayLogs = allLogs.filter(l => l.date === today && activeEmails.has(l.student_email));
  const blocksByEmailToday = {};
  todayLogs.forEach(l => { blocksByEmailToday[l.student_email] = (blocksByEmailToday[l.student_email] || 0) + 1; });
  const todayLoggerEmails = Object.keys(blocksByEmailToday);
  const todayLoggers = todayLoggerEmails.length;
  const todayCore = todayLoggerEmails.filter(em => !isStudent(em)).length;
  const todayStudent = todayLoggers - todayCore;
  const todayLoggerList = todayLoggerEmails
    .sort((a, b) => blocksByEmailToday[b] - blocksByEmailToday[a])
    .map(em => tag(em) + nameOf(em) + " " + blocksByEmailToday[em] + "件");

  // 離脱リスク（最終記録からの経過日数つき）。一度でも記録した継続ユーザーが対象
  const lastLogByEmail = {};
  allLogs.forEach(l => { const p = lastLogByEmail[l.student_email]; if (!p || l.date > p) lastLogByEmail[l.student_email] = l.date; });
  const daysSince = ds => Math.floor((new Date(today + "T00:00:00+09:00") - new Date(ds + "T00:00:00+09:00")) / 86400000);
  const churnList = users
    .filter(u => lastLogByEmail[u.student_email] && lastLogByEmail[u.student_email] < d7)
    .map(u => ({ em: u.student_email, days: daysSince(lastLogByEmail[u.student_email]) }))
    .sort((a, b) => a.days - b.days);
  const churnRisk = churnList.length;
  // 未記録（一度も記録がない登録者）はファネル漏れとして別で数える
  const neverLogged = users.filter(u => !lastLogByEmail[u.student_email]);
  const neverLoggedStudent = neverLogged.filter(u => String(u.cohort || "").trim()).length;

  // 要フォロー（CRMと同じ基準）：一度でも記録した人のうち、3日以上停滞／スコア15点以上の下降／
  // 直近レポートが50点未満、のいずれか。未記録の未定着層はここには入れない（別枠の離脱・ファネルで扱う）
  const reportsByEmailDesc = {};
  allReports.forEach(r => { (reportsByEmailDesc[r.student_email] = reportsByEmailDesc[r.student_email] || []).push(r); });
  Object.values(reportsByEmailDesc).forEach(arr => arr.sort((a, b) => a.date > b.date ? -1 : 1));
  const followup = [];
  users.forEach(u => {
    const last = lastLogByEmail[u.student_email];
    if (!last) return; // 未記録は対象外
    const ago = daysSince(last);
    const reps = reportsByEmailDesc[u.student_email] || [];
    const latest = reps[0] ? Number(reps[0].score) : null;
    const prev = reps[1] ? Number(reps[1].score) : null;
    let reason = null, sev = 0;
    if (ago >= 3) { reason = ago + "日記録なし"; sev = 100 + ago; }
    else if (prev !== null && latest !== null && prev - latest >= 15) { reason = "スコア下降 " + prev + "→" + latest; sev = 50; }
    else if (latest !== null && latest < 50) { reason = "直近スコア " + latest + "点"; sev = 40; }
    if (reason) followup.push({ em: u.student_email, reason: reason, sev: sev });
  });
  followup.sort((a, b) => b.sev - a.sev);

  // 夜間処理の詰まり（再開トリガーが翌朝も残っている＝処理が完走していない兆候）
  const props = PropertiesService.getScriptProperties();
  const stuckResume = props.getProperty("NIGHTLY_REPORT_RESUME_DATE");
  const triggerCount = ScriptApp.getProjectTriggers().length;

  // カレンダーの重複を毎朝自動で掃除する（どの経路で重複が生まれても翌朝には消える）。
  // 失敗してもレポート本体は止めない
  let dedupeNote = "";
  try {
    const dd = dedupeOwnerJirokuEvents(2);
    if (dd && dd.removed > 0) dedupeNote = "🧹 カレンダー重複を" + dd.removed + "件掃除";
  } catch (e) { Logger.log("auto dedupe error: " + e); }

  const problems = [];
  if (missingYesterday.length > 0) problems.push("⚠️ " + dayLabel + "のレポート欠落 " + missingYesterday.length + "件（記録したのに未生成）");
  if (missing7 > 0) problems.push("⚠️ 直近7日の欠落 合計" + missing7 + "件");
  if (stuckResume) problems.push("⚠️ 夜間処理が未完了のまま（再開待ち: " + stuckResume + "）");
  if (triggerCount >= 18) problems.push("⚠️ トリガー数が上限に接近（" + triggerCount + "/20）");

  // システム診断（非deep=無料の範囲）も毎朝ここで回し、fail/warnがあれば要対応に混ぜる
  let sysLine = "確認失敗";
  try {
    const sys = systemHealthCheck(false).data;
    sysLine = sys.overall === "ok" ? "正常" : (sys.overall === "fail" ? "🔴 異常あり" : "🟡 要注意");
    sys.checks.filter(c => c.status !== "ok").forEach(c => {
      problems.push((c.status === "fail" ? "🔴" : "🟡") + " [システム] " + c.name + ": " + c.detail);
    });
  } catch (e) { sysLine = "確認失敗"; }

  const head = problems.length === 0 ? "✅ JIROKU 運営レポート（異常なし）" : "🚨 JIROKU 運営レポート（要確認）";
  const lines = [head, today + "（🎓学生 / 💼コーチング）", ""];

  // ① 昨日のレポート
  lines.push("📋 " + dayLabel + "のレポート（" + yesterday + "）");
  lines.push("記録 " + loggedYesterday.size + "人 → 生成 " + generatedYesterday.length + "人" + (missingYesterday.length ? " / 欠落 " + missingYesterday.length + "人" : "（全員生成✓）") + (avgYesterday !== null ? " / 平均 " + avgYesterday + "点" : ""));
  if (generatedYesterday.length) {
    lines.push(generatedYesterday.slice(0, 20).map(x => tag(x.em) + nameOf(x.em) + " " + x.score).join(" / "));
  }
  if (missingYesterday.length) lines.push("⚠️ 欠落: " + missingYesterday.map(em => tag(em) + nameOf(em)).join(" / "));
  lines.push("");

  // ② JIROKU（今日の記録の動き）
  lines.push("⏱ JIROKU 今日の記録（" + today + "）");
  lines.push(todayLogs.length + "件 / " + todayLoggers + "人（💼" + todayCore + " ・ 🎓" + todayStudent + "）");
  if (todayLoggerList.length) lines.push(todayLoggerList.slice(0, 25).join(" / "));
  lines.push("");

  // ③ 要フォロー（コーチが今日声をかけるべき人）
  lines.push("🔔 要フォロー " + followup.length + "人");
  if (followup.length) {
    followup.slice(0, 20).forEach(f => lines.push("・" + tag(f.em) + nameOf(f.em) + "（" + f.reason + "）"));
    if (followup.length > 20) lines.push("…ほか" + (followup.length - 20) + "人");
  } else {
    lines.push("該当なし👍");
  }
  lines.push("");

  // ④ 離脱リスク・ファネル（件数サマリ。名前は要フォローに集約済み）
  lines.push("📉 離脱リスク: 7日以上記録なし " + churnRisk + "人 / 一度も記録なし " + neverLogged.length + "人（うち🎓" + neverLoggedStudent + "）");
  lines.push("");

  // ⑤ システム
  lines.push("🩺 システム: " + sysLine + "（トリガー " + triggerCount + "/20）" + (dedupeNote ? " / " + dedupeNote : ""));

  // ⑤ AI費用（アプリ内のAPI消費。昨日と今月の累計、内訳の上位）
  try {
    const au = getAiUsageSummary();
    if (au.count > 0 || au.lastMonthCount > 0) {
      const yen = function (usd) { return "$" + usd.toFixed(2); };
      const topF = Object.keys(au.byFeature).sort(function (a, b) { return au.byFeature[b] - au.byFeature[a]; }).slice(0, 4)
        .map(function (f) { return f + " " + yen(au.byFeature[f]); }).join(" / ");
      const topM = Object.keys(au.byModel).sort(function (a, b) { return au.byModel[b] - au.byModel[a]; })
        .map(function (m2) { return m2 + " " + yen(au.byModel[m2]); }).join(" / ");
      lines.push("");
      lines.push("💰 AI費用（アプリ内）: 今日 " + yen(au.today) + " / 今月 " + yen(au.month));
      if (au.lastMonthCount > 0) {
        const lmTop = Object.keys(au.lastMonthByFeature || {})
          .sort(function (a, b) { return au.lastMonthByFeature[b] - au.lastMonthByFeature[a]; }).slice(0, 3)
          .map(function (f) { return f + " " + yen(au.lastMonthByFeature[f]); }).join(" / ");
        lines.push("先月(" + au.lastMonthLabel + "): " + yen(au.lastMonth) + (lmTop ? "（" + lmTop + "）" : ""));
      }
      if (topF) lines.push("内訳: " + topF);
      if (topM) lines.push("モデル: " + topM);
    }
  } catch (e) { Logger.log("ai usage line error: " + e); }

  if (problems.length > 0) {
    lines.push("");
    lines.push("── 要対応 ──");
    problems.forEach(p => lines.push(p));
    if (missing7 > 0) lines.push("→ CRMの管理者ダッシュボードで確認、または「レポート欠落を補充して」で自動修復できます");
  }
  const text = lines.join("\n");

  // dryRunなら送信せず文面だけ返す（動作確認用）。
  // ★=== が必須 ===★ 時間主導トリガーから呼ばれると、GASは第1引数にイベントオブジェクトを
  // 渡してくる。それは truthy なので if (dryRun) だと毎回ここで返ってしまい、
  // 文面を作った直後に捨てていた（2026-07-31まで運営レポートが1通も届かなかった原因）。
  // 明示的に true の時だけ dryRun とみなす。
  if (dryRun === true) return { ok: true, data: { text: text, problems: problems.length, sent: false } };

  // LINE優先。ただし「LINEが失敗したら黙って消える」ことがないよう、
  // 送信できなかった場合は必ずメールへ回す（届かない日があった原因）
  let sentBy = "";
  if (adminUser && adminUser.line_user_id) {
    if (sendLineMessage(adminUser.line_user_id, text)) sentBy = "line";
    else Logger.log("dailyOpsHealthCheck: LINE送信に失敗したためメールへ切り替えます");
  }
  if (!sentBy) {
    try { MailApp.sendEmail(admin, head, text); sentBy = "mail"; }
    catch (e) { Logger.log("ops health mail error: " + e); sentBy = "failed"; }
  }
  Logger.log("dailyOpsHealthCheck: " + head + " missing7=" + missing7);
  return { ok: true, data: { text: text, problems: problems.length, sent: sentBy !== "failed", sentBy: sentBy } };
}

// ── アプリ全体のシステム診断 ──
// 「レポートが出ているか」より一段下の“土台”を点検する。バックエンド・シート・
// 外部APIキー・LINE・トリガー・フロント配信・データ鮮度が生きているかを一括チェックし、
// ok / warn / fail の3段階で返す。deepPing=trueのときだけClaude/LINEに実際に軽い問い合わせをする
// （鍵が「設定されている」だけでなく「本当に有効か」まで確認できるが、少額の費用がかかるため任意）。
function systemHealthCheck(deepPing) {
  const checks = [];
  const add = (name, status, detail) => checks.push({ name: name, status: status, detail: detail });
  const props = PropertiesService.getScriptProperties();

  // 1) スプレッドシート到達性＋必須シート
  try {
    const ss = getSpreadsheet();
    const names = ss.getSheets().map(s => s.getName());
    const required = ["Users", "DailyLog", "Reports", "Coaches", "Journal", "Achievements", "Surveys"];
    const missing = required.filter(n => names.indexOf(n) === -1);
    if (missing.length) add("スプレッドシート", "fail", "必須シート欠落: " + missing.join(", "));
    else add("スプレッドシート", "ok", names.length + "シート・必須シート揃っています");
  } catch (e) { add("スプレッドシート", "fail", "アクセス不可: " + e); }

  // 2) Claudeキー（存在 / deepなら実疎通）
  const claudeKey = props.getProperty("CLAUDE_API_KEY");
  if (!claudeKey) add("Claude APIキー", "fail", "未設定（夜間レポート・各種AI生成が動きません）");
  else if (deepPing) {
    try {
      const r = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": claudeKey, "anthropic-version": "2023-06-01" },
        payload: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1, messages: [{ role: "user", content: "hi" }] }),
        muteHttpExceptions: true
      });
      const c = r.getResponseCode();
      if (c === 200) add("Claude APIキー", "ok", "有効（疎通OK）");
      else if (c === 401) add("Claude APIキー", "fail", "認証エラー(401)：鍵が失効している可能性");
      else if (c === 429) add("Claude APIキー", "warn", "レート制限(429)：一時的に混雑");
      else add("Claude APIキー", "warn", "想定外の応答 code=" + c);
    } catch (e) { add("Claude APIキー", "warn", "疎通確認に失敗: " + e); }
  } else add("Claude APIキー", "ok", "設定あり（疎通は未確認）");

  // 3) LINEトークン（存在 / deepなら /bot/info で有効性）
  const lineTok = props.getProperty("LINE_CHANNEL_TOKEN");
  if (!lineTok) add("LINE連携", "fail", "トークン未設定（通知が一切飛びません）");
  else if (deepPing) {
    try {
      const r = UrlFetchApp.fetch("https://api.line.me/v2/bot/info", {
        method: "GET", headers: { "Authorization": "Bearer " + lineTok }, muteHttpExceptions: true
      });
      add("LINE連携", r.getResponseCode() === 200 ? "ok" : "fail", r.getResponseCode() === 200 ? "トークン有効" : "無効 code=" + r.getResponseCode());
    } catch (e) { add("LINE連携", "warn", "確認失敗: " + e); }
  } else add("LINE連携", "ok", "トークン設定あり（有効性は未確認）");

  // 4) トリガー（重要ハンドラの登録・上限）
  try {
    const trigs = ScriptApp.getProjectTriggers();
    const handlers = trigs.map(t => t.getHandlerFunction());
    const critical = ["nightlyReport", "morningScheduleNotify", "dailyOpsHealthCheck", "weeklyBackup"];
    const missing = critical.filter(h => handlers.indexOf(h) === -1);
    const dupes = handlers.filter((h, i) => handlers.indexOf(h) !== i);
    if (missing.length) add("定期処理トリガー", "fail", "未登録: " + missing.join(", ") + "（" + trigs.length + "/20）");
    else if (trigs.length >= 18) add("定期処理トリガー", "warn", "上限に接近 " + trigs.length + "/20");
    else if (dupes.length) add("定期処理トリガー", "warn", "重複: " + [...new Set(dupes)].join(", "));
    else add("定期処理トリガー", "ok", trigs.length + "/20・重要トリガー登録済み");
  } catch (e) { add("定期処理トリガー", "warn", "確認失敗: " + e); }

  // 5) フロント配信（GitHub Pages が200かつ実体を返すか）
  [["アプリ本体", APP_URL + "index.html"], ["コーチCRM", APP_URL + "coach/index.html"]].forEach(([label, url]) => {
    try {
      const r = UrlFetchApp.fetch(url + "?_hc=" + Date.now(), { muteHttpExceptions: true });
      const code = r.getResponseCode();
      const okBody = code === 200 && /JIROKU/.test(r.getContentText().slice(0, 4000));
      add(label + "配信", okBody ? "ok" : "fail", okBody ? "200 OK" : "異常 code=" + code);
    } catch (e) { add(label + "配信", "fail", "取得失敗: " + e); }
  });

  // 6) データ鮮度（パイプラインが生きているか：直近48hに記録があるか）
  try {
    const logs = sheetToObjects(getSheet("DailyLog"));
    const latest = logs.reduce((m, l) => (l.date > m ? l.date : m), "");
    const d2 = formatDate(new Date(Date.now() - 2 * 86400000));
    if (!latest) add("データ鮮度", "warn", "記録がまだありません");
    else if (latest < d2) add("データ鮮度", "warn", "直近48hに記録なし（最新 " + latest + "）");
    else add("データ鮮度", "ok", "最新の記録 " + latest);
  } catch (e) { add("データ鮮度", "warn", "確認失敗: " + e); }

  const failCount = checks.filter(c => c.status === "fail").length;
  const warnCount = checks.filter(c => c.status === "warn").length;
  const overall = failCount ? "fail" : (warnCount ? "warn" : "ok");
  return { ok: true, data: { overall: overall, failCount: failCount, warnCount: warnCount, checks: checks, deepPing: !!deepPing } };
}

function generateYesterdayReport() {
  const yesterday = formatDate(new Date(Date.now() - 86400000));
  Logger.log("昨日: " + yesterday);
  generateReportForDate(yesterday);
}

function testSaveLog() {
  const result = saveLog(adminEmail(), { time_block: "10:00", task: "テスト", focus_level: "高", memo: "動作確認" });
  console.log(JSON.stringify(result));
}

function debugNightly() {
  const users = sheetToObjects(getSheet("Users")).filter(u => u.is_active.toUpperCase() === "TRUE");
  console.log("ユーザー数: " + users.length);
  users.forEach(u => {
    console.log("メール: " + u.student_email);
    const logs = getLogs(u.student_email).data;
    console.log("ログ数: " + logs.length);
  });
}

function testLine() {
  const users = sheetToObjects(getSheet("Users"));
  const user = users.find(u => u.student_email === adminEmail());
  if (!user) { console.log("ユーザーが見つかりません"); return; }
  const res = UrlFetchApp.fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + LINE_CHANNEL_TOKEN },
    payload: JSON.stringify({ to: user.line_user_id, messages: [{ type: "text", text: "EdVenture LINEテスト成功" }] }),
    muteHttpExceptions: true,
  });
  console.log(res.getResponseCode() + ": " + res.getContentText());
}

function testAutoReply() {
  const apiKey = PropertiesService.getScriptProperties().getProperty("CLAUDE_API_KEY");
  Logger.log("CLAUDE_API_KEY: " + (apiKey ? "OK" : "なし"));
  const response = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    payload: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 100, messages: [{ role: "user", content: "こんにちは" }] }),
    muteHttpExceptions: true
  });
  Logger.log(response.getResponseCode() + ": " + response.getContentText());
}

function testGetUser() {
  Logger.log(JSON.stringify(getUser(adminEmail())));
}

function testStreak() {
  updateStreak(adminEmail());
  Logger.log(JSON.stringify(getStreak(adminEmail())));
}

function testReportForMe() {
  const user = sheetToObjects(getSheet("Users")).find(u => u.student_email === adminEmail());
  const logs = getLogs(adminEmail()).data;
  Logger.log("ログ数: " + logs.length);
  const report = generateReportWithClaude(adminEmail(), user.name, logs);
  Logger.log("レポート: " + JSON.stringify(report));
}

function testDaySummaryForMe() {
  const email = adminEmail();
  const today = formatDate(new Date());
  const logs = getLogs(email, { date: today }).data;
  Logger.log("対象日: " + today + " / ログ数: " + logs.length);
  const summary = generateDaySummary(email, today, logs);
  Logger.log("事実まとめ: " + summary);
}
