// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// EdVenture — GAS Web App エンドポイント
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const SPREADSHEET_ID = "1EbGxrI6e-rmzgDk4jczOX1RfHIYY-6Q1jOPpr5Hybqc";
const APP_URL = "https://kaisunagawa.github.io/edventure-app/";
const CLAUDE_API_KEY = PropertiesService.getScriptProperties().getProperty("CLAUDE_API_KEY");
const LINE_CHANNEL_TOKEN = PropertiesService.getScriptProperties().getProperty("LINE_CHANNEL_TOKEN");

// 生徒向けメッセージ共通の文末・絵文字ルール（コーチの声のトーンを統一する）
const EMOJI_STYLE = `- 文末は「。」で終えるより「！」「？」や絵文字で終える方が自然。硬い「。」止めを多用しない
- 絵文字は次の中から優先して使う: 👍 🔥 👏 🙌 👊 💪 🫵 と、ポジティブな表情の絵文字（😊 😆 🤝 ✨ など）
- 絵文字は文中ではなく文末に置く。1メッセージ1〜3個まで`;

// XP閾値テーブル（非線形）: インデックス = レベル-1
const XP_THRESHOLDS = [0, 500, 1200, 2200, 3500, 5200, 7500, 10000, 13000, 17000, 21000, 25500, 30500, 36000, 42000, 49000];

function getXpLevel(xp) {
  let level = 1;
  for (let i = 1; i < XP_THRESHOLDS.length; i++) {
    if (xp >= XP_THRESHOLDS[i]) level = i + 1; else break;
  }
  return level;
}

function getSheet(name) {
  return SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(name);
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
  const studentEmail = e.parameter.studentEmail;
  const callback = e.parameter.callback;
  try {
    let result;
    switch (action) {
      case "getUser":      result = getUser(studentEmail); break;
      case "registerUser": result = registerUser(studentEmail, e.parameter); break;
      case "getStreak":    result = getStreak(studentEmail); break;
      case "getGameStatus": result = getGameStatus(studentEmail); break;
      case "getRanking":   result = getRanking(studentEmail); break;
      case "getCommunity": result = getCommunity(studentEmail); break;
      case "getAchievements": result = getAchievements(); break;
      case "shareAchievement": result = shareAchievement(studentEmail, e.parameter); break;
      case "getReport":    result = getReport(studentEmail, e.parameter); break;
      case "getReportList": result = getReportList(studentEmail); break;
      case "getStatusSummary": result = getStatusSummary(studentEmail); break;
      case "getLogs":      result = getLogs(studentEmail, e.parameter); break;
      case "getMessages":  result = getMessages(studentEmail); break;
      case "getSchedule":  result = getSchedule(studentEmail); break;
      case "getStudents":  result = getStudents(studentEmail); break;
      case "saveLog":      result = saveLog(studentEmail, e.parameter); break;
      case "saveLogMulti": result = saveLogMulti(studentEmail, e.parameter); break;
      case "coachGetStudents":      result = coachGetStudents(e.parameter.coachEmail); break;
      case "coachGetStudentDetail": result = coachGetStudentDetail(e.parameter.coachEmail, e.parameter.targetEmail); break;
      case "coachSaveNote":         result = coachSaveNote(e.parameter.coachEmail, e.parameter); break;
      case "coachPrepSummary":      result = coachPrepSummary(e.parameter.coachEmail, e.parameter.targetEmail); break;
      case "coachSyncStripeOne":    result = coachSyncStripeOne(e.parameter.coachEmail, e.parameter); break;
      case "coachAddClient":       result = coachAddClient(e.parameter.coachEmail, e.parameter); break;
      case "coachListChatworkContacts": result = coachListChatworkContacts(e.parameter.coachEmail); break;
      case "coachSyncChatworkOne": result = coachSyncChatworkOne(e.parameter.coachEmail, e.parameter); break;
      case "adminGetOverview":     result = adminGetOverview(e.parameter.coachEmail); break;
      case "coachSetShowInCommunity": result = coachSetShowInCommunity(e.parameter.coachEmail, e.parameter); break;
      case "adminBackfillReportReasons": result = adminBackfillReportReasons(e.parameter.coachEmail); break;
      case "sendMessage":  result = sendMessage(studentEmail, e.parameter); break;
      case "saveSettings": result = saveSettings(studentEmail, e.parameter); break;
      case "syncCalendar": result = syncCalendar(studentEmail, e.parameter); break;
      case "getCalendar":  result = getCalendar(studentEmail, e.parameter); break;
      case "getDiary":     result = getDiary(studentEmail, e.parameter); break;
      case "saveDiary":    result = saveDiary(studentEmail, e.parameter); break;
      case "scheduleTimerEnd": result = scheduleTimerEnd(studentEmail, e.parameter); break;
      case "cancelTimerEnd":   result = cancelTimerEnd(studentEmail); break;
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
          sendLineMessage(lineUserId, "🎉 追加ありがとうございます！\n\nまず、下のリンクからJIROKUアプリに登録してください👇\n" + APP_URL + "\n\n登録が完了したら、このLINEに登録したGmailアドレスを送ってください。それだけで連携完了です！\n\n✅ 毎時間の記録リマインダー\n✅ 毎晩のAIレポート\nがこのLINEに届くようになります。");
        }

        if (event.type === "message" && event.message.type === "text") {
          const lineUserId = event.source.userId;
          const text = event.message.text.trim().toLowerCase();
          // 既に連携済みなら、案内メッセージの再送はしない（雑談等の通常メッセージのため）
          const alreadyLinked = sheetToObjects(getSheet("Users")).find(u => u.line_user_id === lineUserId);
          if (alreadyLinked) return;

          // メールアドレス形式なら連携処理
          if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
            const sheet = getSheet("Users");
            const data = sheet.getDataRange().getValues();
            const headers = data[0];
            const emailIdx = headers.indexOf("student_email");
            const lineIdx = headers.indexOf("line_user_id");
            const nameIdx = headers.indexOf("name");
            for (let i = 1; i < data.length; i++) {
              if (String(data[i][emailIdx]).toLowerCase() === text) {
                sheet.getRange(i + 1, lineIdx + 1).setValue(lineUserId);
                sendLineMessage(lineUserId, "✅ 連携完了！\n" + String(data[i][nameIdx]) + "さんのアカウントと連携しました。\n\n毎時間の記録リマインダーと毎晩のAIレポートをお届けします！");
                return;
              }
            }
            sendLineMessage(lineUserId, "❌ このメールアドレスは見つかりませんでした。\nアプリで登録したGmailアドレスを確認して、もう一度送ってください。");
          } else {
            // メール以外のメッセージ（雑談等）が送られた場合、無反応にせず連携方法を再案内する
            sendLineMessage(lineUserId, "まだ連携が完了していません🙏\nJIROKUアプリに登録した「Gmailアドレス」だけをこのトークに送ってください。それだけで連携が完了します！\n\n（例：yourname@gmail.com）");
          }
        }
      });
      return ContentService.createTextOutput("OK");
    }

    // アプリからのPOST
    const action = body.action;
    const studentEmail = body.studentEmail;
    switch (action) {
      case "saveLog":      return jsonResponse(saveLog(studentEmail, body));
      case "sendMessage":  return jsonResponse(sendMessage(studentEmail, body));
      case "saveSettings": return jsonResponse(saveSettings(studentEmail, body));
      case "saveDiary":    return jsonResponse(saveDiary(studentEmail, body));
      case "syncCalendar": return jsonResponse(syncCalendar(studentEmail, body));
      case "coachSaveProfile":     return jsonResponse(coachSaveProfile(body.coachEmail, body));
      case "coachUploadFile":      return jsonResponse(coachUploadFile(body.coachEmail, body));
      case "coachDeleteFile":      return jsonResponse(coachDeleteFile(body.coachEmail, body));
      case "coachDeleteNote":      return jsonResponse(coachDeleteNote(body.coachEmail, body));
      case "coachExtractContractInfo": return jsonResponse(coachExtractContractInfo(body.coachEmail, body));
      case "coachExtractFromExistingFile": return jsonResponse(coachExtractFromExistingFile(body.coachEmail, body));
      case "coachImportNotes":     return jsonResponse(coachImportNotes(body.coachEmail, body));
      case "coachSessionSuggestions": return jsonResponse(coachSessionSuggestions(body.coachEmail, body));
      case "coachSummarizeTranscript": return jsonResponse(coachSummarizeTranscript(body.coachEmail, body));
      default: return jsonResponse({ ok: false, error: "Unknown action" });
    }
  } catch (err) {
    return jsonResponse({ ok: false, error: err.toString() });
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 各アクション
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function registerUser(studentEmail, body) {
  const sheet = getSheet("Users");
  const rows = sheetToObjects(sheet);

  // すでに登録済みならエラー
  if (rows.find(r => r.student_email === studentEmail)) {
    return { ok: false, error: "already_registered" };
  }

  const today = formatDate(new Date());
  let headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  function ensureHeader(name) {
    if (!headers.includes(name)) { sheet.getRange(1, headers.length + 1).setValue(name); headers.push(name); }
    return headers.indexOf(name);
  }

  const idxEmail     = ensureHeader("student_email");
  const idxName      = ensureHeader("name");
  const idxActive    = ensureHeader("is_active");
  const idxJoined    = ensureHeader("joined_at");
  const idxGoal1     = ensureHeader("goal");
  const idxDead1     = ensureHeader("goal_deadline");
  const idxGoal2     = ensureHeader("goal2");
  const idxDead2     = ensureHeader("goal_deadline2");
  const idxGoal3     = ensureHeader("goal3");
  const idxDead3     = ensureHeader("goal_deadline3");
  const idxStart     = ensureHeader("notify_start");
  const idxEnd       = ensureHeader("notify_end");
  const idxNickname  = ensureHeader("nickname");
  const idxAvatar    = ensureHeader("avatar");

  const newRow = new Array(headers.length).fill("");
  newRow[idxEmail]  = studentEmail;
  newRow[idxName]   = body.name || "";
  newRow[idxActive] = "TRUE";
  newRow[idxJoined] = today;
  newRow[idxGoal1]  = body.goal || "";
  newRow[idxDead1]  = body.goal_deadline || "";
  newRow[idxGoal2]  = body.goal2 || "";
  newRow[idxDead2]  = body.goal_deadline2 || "";
  newRow[idxGoal3]  = body.goal3 || "";
  newRow[idxDead3]  = body.goal_deadline3 || "";
  newRow[idxStart]  = 7;
  newRow[idxEnd]    = 23;
  newRow[idxNickname] = (body.nickname || body.name || "").trim();
  newRow[idxAvatar]   = body.avatar || "🦊";
  sheet.appendRow(newRow);

  return { ok: true, data: { name: body.name, nickname: newRow[idxNickname], avatar: newRow[idxAvatar], coachName: "コーチ", coach_email: "" } };
}

function getStreak(studentEmail) {
  const user = sheetToObjects(getSheet("Users")).find(u => u.student_email === studentEmail);
  if (!user) return { ok: true, data: 0 };
  return { ok: true, data: Number(user.streak || 0) };
}

function getUser(studentEmail) {
  const user = sheetToObjects(getSheet("Users")).find(u => u.student_email === studentEmail && u.is_active.toUpperCase() === "TRUE");
  if (!user) return { ok: false, error: "User not found" };
  const coach = sheetToObjects(getSheet("Coaches")).find(c => c.coach_email === user.coach_email);
  return { ok: true, data: {
    name: user.name,
    nickname: user.nickname || user.name,
    avatar: user.avatar || "🦊",
    coach_email: user.coach_email,
    coachName: (coach && coach.coach_name) ? coach.coach_name : "コーチ",
    lineLinked: !!user.line_user_id
  } };
}

function getReportList(studentEmail) {
  const rows = getFilteredRows("Reports", "student_email", studentEmail);
  const list = rows
    .sort((a, b) => b.date > a.date ? 1 : -1)
    .map(r => {
      let breakdown = null;
      if (r.breakdown) { try { breakdown = JSON.parse(r.breakdown); } catch (e) {} }
      return { date: r.date, score: Number(r.score), breakdown };
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
  const CACHE_KEY = "all_statuses_v1";
  if (!preloadedLogObjects) {
    const cached = CacheService.getScriptCache().get(CACHE_KEY);
    if (cached) return JSON.parse(cached);
  }

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

  if (!preloadedLogObjects) {
    try { CacheService.getScriptCache().put(CACHE_KEY, JSON.stringify(result), 300); } catch (e) { /* サイズ超過時は無視してキャッシュなしで返す */ }
  }
  return result;
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
function appendReportRow(targetDate, studentEmail, report) {
  const sheet = getSheet("Reports");
  const newRow = sheet.getLastRow() + 1;
  sheet.appendRow([targetDate, studentEmail, report.score, report.feedback, report.action, report.highlights, report.improvement, new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })]);
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
  try { CacheService.getScriptCache().remove("ranking_scores_v1"); } catch (e) { /* ignore */ }
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
    });
  }
  logs.sort((a, b) => a.time_block > b.time_block ? 1 : -1);
  return { ok: true, data: logs };
}

function saveLog(studentEmail, body) {
  const sheet = getSheet("DailyLog");
  const today = formatDate(new Date());
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

  for (let i = 1; i < data.length; i++) {
    const rawDate = data[i][dateIdx];
    const rowDate = rawDate instanceof Date
      ? Utilities.formatDate(rawDate, "Asia/Tokyo", "yyyy-MM-dd")
      : String(rawDate);
    if (String(data[i][emailIdx]) === studentEmail &&
        rowDate === targetDate &&
        String(data[i][timeIdx]) === String(body.time_block)) {
      const focusIdx = headers.indexOf("focus_level");
      const prevFocus = String(data[i][focusIdx] || "").trim();
      const newFocus = String(body.focus_level || "").trim();
      sheet.getRange(i+1, headers.indexOf("task")+1).setValue(body.task);
      sheet.getRange(i+1, focusIdx+1).setValue(body.focus_level);
      sheet.getRange(i+1, headers.indexOf("memo")+1).setValue(body.memo || "");
      let grIdx = headers.indexOf("goal_related");
      if(grIdx === -1){ grIdx = headers.length; sheet.getRange(1, grIdx+1).setValue("goal_related"); }
      sheet.getRange(i+1, grIdx+1).setValue(body.goal_related || "false");
      if (!isPast) { updateStreak(studentEmail); invalidateStatusCache(); }

      // 保存時に自己評価が未入力だった記録に、後から評価を追加した場合だけ
      // このタイミングで1回だけXPを付与する。評価が既にあった記録の更新では
      // 付与しない（何度更新してもポイントが積み上がらないようにするため）
      if (!isPast && !prevFocus && newFocus) {
        const xpResult = addXP(studentEmail, body.memo, todaysLogCount, {
          totalLogs, memoCount: memoCount + ((body.memo || "").trim() ? 1 : 0)
        });
        return { ok: true, log_id: String(data[i][0]), updated: true, ...xpResult };
      }
      return { ok: true, log_id: String(data[i][0]), updated: true, xp_gained: 0 };
    }
  }

  const logId = "log_" + Date.now();
  const newRow = sheet.getLastRow() + 1;
  sheet.appendRow([logId, studentEmail, targetDate, "", body.task, body.focus_level, body.memo || "", now, body.goal_related || "false"]);
  sheet.getRange(newRow, 4).setNumberFormat("@").setValue(String(body.time_block));

  // 過去日の後付け入力はストリーク・XPの対象外（後から稼げない）
  if (isPast) return { ok: true, log_id: logId, xp_gained: 0 };

  updateStreak(studentEmail);
  invalidateStatusCache();
  // +1 = 今追加した1件（totalLogs/memoCountにも反映）
  const xpResult = addXP(studentEmail, body.memo, todaysLogCount + 1, {
    totalLogs: totalLogs + 1,
    memoCount: memoCount + ((body.memo || "").trim() ? 1 : 0)
  });
  return { ok: true, log_id: logId, ...xpResult };
}

// 複数の時間帯に同じ内容を一括保存する（2時間の会議などを1回の入力で記録）。
// DailyLogの読み込み・書き込みをこの関数内で1回にまとめ、ストリーク・XPも
// ブロック数ぶん繰り返さずリクエスト全体で1回だけ計算する
function saveLogMulti(studentEmail, body) {
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

  const today = formatDate(new Date());
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

  const newRows = [];
  let updatedAny = false;
  let xpEligible = false; // 新規ブロック、または「未評価→評価あり」に変わった更新がある場合のみXP対象にする
  blocks.forEach(b => {
    const dataIdx = rowIndexByKey[targetDate + "|" + b];
    if (dataIdx !== undefined) {
      const prevFocus = String(data[dataIdx][idx.focus] || "").trim();
      const newFocus = String(body.focus_level || "").trim();
      if (!prevFocus && newFocus) xpEligible = true;
      // 列の並びに依存しないよう、行全体を1回のsetValuesで書き換える
      const updatedRow = data[dataIdx].slice();
      updatedRow[idx.task] = body.task;
      updatedRow[idx.focus] = body.focus_level;
      updatedRow[idx.memo] = body.memo || "";
      updatedRow[goalIdx] = body.goal_related || "false";
      sheet.getRange(dataIdx + 1, 1, 1, updatedRow.length).setValues([updatedRow]);
      updatedAny = true;
    } else {
      xpEligible = true;
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

  if (isPast) return { ok: true, xp_gained: 0, updated: updatedAny, count: blocks.length };

  updateStreak(studentEmail); // ブロック数ぶんではなく1回だけ
  invalidateStatusCache();
  // 既に評価済みの記録をただ再編集しただけ（新規ブロックも評価追加もない）場合はXPを与えない
  if (!xpEligible) return { ok: true, xp_gained: 0, updated: updatedAny, count: blocks.length };
  const xpResult = addXP(studentEmail, body.memo, todaysLogCount, { totalLogs, memoCount }); // DailyLogの再読み込みなし
  return { ok: true, xp_gained: xpResult.xp_gained, level_up: xpResult.level_up, level: xpResult.level, updated: updatedAny, count: blocks.length };
}

// todaysLogCount: 呼び出し元（saveLog/saveLogMulti）がこのリクエストで確定させた
// 「今日この生徒が記録した件数」。ここでDailyLogを再度読み込まずに済ませるための引数
function addXP(studentEmail, memo, todaysLogCount, logSummary) {
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
  const goals = [
    { goal: user.goal || "", deadline: user.goal_deadline || "" },
    { goal: user.goal2 || "", deadline: user.goal_deadline2 || "" },
    { goal: user.goal3 || "", deadline: user.goal_deadline3 || "" },
  ].filter(g => g.goal);
  return { ok: true, data: { xp, level, xpInLevel, xpForNextLevel, streak, badges, goals } };
}

// 直近7日間の記録量（ブロック数・活動日数）で全アクティブユーザーを順位付けする。
// 累積XPだと入会が早い人が有利になり続けるため、「今どれだけ真剣に取り組めているか」を
// 測る指標として直近の活動量を採用。他ユーザーの氏名やスコアは返さずプライバシーに配慮する。
// 本日のランキング: 各ユーザーの最新レポートのスコアで順位付けする。
// レポートは毎晩21時生成のため、日中は前日分のスコアで競う形になる。
// ホーム画面で毎回呼ばれるため、computeAllStatusesと同様に5分キャッシュする
function getRanking(studentEmail) {
  const CACHE_KEY = "ranking_scores_v1";
  let scores;
  const cached = CacheService.getScriptCache().get(CACHE_KEY);
  if (cached) {
    scores = JSON.parse(cached);
  } else {
    const users = sheetToObjects(getSheet("Users")).filter(u => u.is_active.toUpperCase() === "TRUE");
    const active = new Set(users.map(u => u.student_email));

    const latest = {};
    sheetToObjects(getSheet("Reports")).forEach(r => {
      if (!active.has(r.student_email)) return;
      if (!latest[r.student_email] || r.date > latest[r.student_email].date) latest[r.student_email] = r;
    });

    scores = Object.keys(latest).map(email => ({ email, score: Number(latest[email].score) || 0 }));
    scores.sort((a, b) => b.score - a.score);
    try { CacheService.getScriptCache().put(CACHE_KEY, JSON.stringify(scores), 300); } catch (e) { /* サイズ超過時は無視 */ }
  }

  if (scores.length < 2) return { ok: true, data: null };

  const idx = scores.findIndex(s => s.email === studentEmail);
  if (idx === -1) return { ok: true, data: null };
  return { ok: true, data: { rank: idx + 1, total: scores.length, score: scores[idx].score } };
}

// 「みんなの頑張り」画面用。ニックネーム＋アバターは本名と違い公開前提の情報なので
// 実名やメールは一切含めず、直近7日の活動量でランキング表示する。
// 「みんなの頑張り」のランキングは、ホームの「ステータス」と同じ累計基準。
// 見ている場所によって基準がバラバラだと分かりにくいため一本化している。
// レポートスコア（直近レポートの点数）のランキングも別途あわせて返す。
function getCommunity(studentEmail) {
  // show_in_communityが明示的に"FALSE"の生徒は、本人以外の目からは完全に見えなくする
  // （自分自身は自分の結果を見られるよう例外にする）
  const users = sheetToObjects(getSheet("Users")).filter(u =>
    u.is_active.toUpperCase() === "TRUE" &&
    (u.student_email === studentEmail || String(u.show_in_community || "").toUpperCase() !== "FALSE")
  );
  const statuses = computeAllStatuses();
  const allReports = sheetToObjects(getSheet("Reports"));
  const latestReportByEmail = new Map();
  allReports.forEach(r => {
    const cur = latestReportByEmail.get(r.student_email);
    if (!cur || r.date > cur.date) latestReportByEmail.set(r.student_email, r);
  });

  const list = users.map(u => {
    const status = statuses[u.student_email];
    const latestReport = latestReportByEmail.get(u.student_email);
    return {
      isMe: u.student_email === studentEmail,
      nickname: u.nickname || "名無しさん",
      avatar: u.avatar || "🦊",
      streak: Number(u.streak || 0),
      score: status ? status.score : 0,
      reportScore: latestReport ? Number(latestReport.score) : null
    };
  }).sort((a, b) => b.score - a.score);

  // レポートランキングは「最新のレポートの点数」で競う場（合計/継続の指標はステータス側が担う）。
  // 生徒ごとにレポート生成日がずれるため、直近で最も新しい日付のレポートを持つ生徒だけに絞り、
  // 数日前のレポートしか無い生徒が混ざって不公平にならないようにする
  let latestDate = null;
  latestReportByEmail.forEach(r => { if (!latestDate || r.date > latestDate) latestDate = r.date; });

  const reportRanking = users
    .map(u => {
      const r = latestReportByEmail.get(u.student_email);
      return {
        isMe: u.student_email === studentEmail,
        nickname: u.nickname || "名無しさん",
        avatar: u.avatar || "🦊",
        reportScore: r ? Number(r.score) : null,
        reportDate: r ? r.date : null
      };
    })
    .filter(u => u.reportScore !== null && u.reportDate === latestDate)
    .sort((a, b) => b.reportScore - a.reportScore);

  return { ok: true, data: list, reportRanking: reportRanking };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 達成シェア（任意）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function getAchievementsSheet() {
  let sheet = getSheet("Achievements");
  if (!sheet) {
    sheet = SpreadsheetApp.openById(SPREADSHEET_ID).insertSheet("Achievements");
    sheet.appendRow(["date", "student_email", "nickname", "avatar", "message", "created_at"]);
  }
  return sheet;
}

function shareAchievement(studentEmail, body) {
  const message = String(body.message || "").trim().slice(0, 200);
  if (!message) return { ok: false, error: "empty message" };
  const user = sheetToObjects(getSheet("Users")).find(u => u.student_email === studentEmail);
  if (!user) return { ok: false, error: "user not found" };
  const sheet = getAchievementsSheet();
  const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  sheet.appendRow([formatDate(new Date()), studentEmail, user.nickname || "名無しさん", user.avatar || "🦊", message, now]);
  return { ok: true };
}

// 直近の達成シェアを新しい順に返す（本人特定につながる情報はニックネーム・アバターのみ）
function getAchievements() {
  const rows = sheetToObjects(getAchievementsSheet())
    .sort((a, b) => b.created_at > a.created_at ? 1 : -1)
    .slice(0, 30)
    .map(r => ({ nickname: r.nickname, avatar: r.avatar, message: r.message, date: r.date }));
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
    sheet.appendRow(["note_id", "coach_email", "student_email", "date", "content", "next_theme", "promises", "created_at"]);
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
      statusScore: status ? status.score : 0,
      lastCoachingDate: notes[0] ? notes[0].date : null,
      goal: u.goal || "",
      contractEnd: contractEnd || "",
      contractDaysLeft: daysToEnd,
      joinedJiroku: true,
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

// JIROKU未登録のクライアントを手動でCRMに追加する（契約書・Stripe情報だけ先に管理したい場合）
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
    return {
      email: u.student_email,
      name: u.name,
      coachEmail: u.coach_email || "",
      latestScore: reports[0] ? Number(reports[0].score) : null,
      statusScore: status ? status.score : 0,
      lastLogDate: lastLogDate,
      stripeTotalPaid: profile ? Number(profile.stripe_total_paid || 0) : 0
    };
  });

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

  return { ok: true, data: {
    totalRevenue, revenueCurrency,
    activeStudentCount: allUsers.length,
    coachCount: coaches.length,
    avgScore, onTrackRate, onTrackCount, scoredCount: scored.length,
    coachStats: coachStats,
    students: students.sort((a,b) => b.statusScore - a.statusScore)
  } };
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
      const result = JSON.parse(res.getContentText());
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
  const reports = sheetToObjects(getSheet("Reports"))
    .filter(r => r.student_email === studentEmail)
    .sort((a,b)=>b.date>a.date?1:-1).slice(0, 7)
    .map(r => ({ date: r.date, score: Number(r.score), feedback: r.feedback, highlights: r.highlights, improvement: r.improvement, action: r.action }));
  const diaries = sheetToObjects(getJournalSheet())
    .filter(r => r.student_email === studentEmail && (r.diary || "").trim())
    .sort((a,b)=>b.date>a.date?1:-1).slice(0, 7)
    .map(r => ({ date: r.date, diary: r.diary }));
  const logs = sheetToObjects(getSheet("DailyLog"))
    .filter(l => l.student_email === studentEmail && l.date >= fourteenDaysAgo);
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
    goals: [
      { goal: user.goal, deadline: user.goal_deadline },
      { goal: user.goal2, deadline: user.goal_deadline2 },
      { goal: user.goal3, deadline: user.goal_deadline3 }
    ].filter(g => g.goal),
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
  sheet.appendRow([
    "cn_" + Date.now(),
    coachEmail,
    String(body.targetEmail),
    String(body.date || formatDate(new Date())),
    content.slice(0, 2000),
    String(body.next_theme || "").slice(0, 500),
    String(body.promises || "").slice(0, 500),
    now
  ]);
  return { ok: true };
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

【出力形式】質問だけを1行ずつ箇条書きで。前置きや説明文は不要。すでにメモに書かれている内容の繰り返しにはならないよう、まだ深掘りできていない点や前回の約束事項の進捗確認を優先すること`;

  const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    payload: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 500, messages: [{ role: "user", content: prompt }] }),
    muteHttpExceptions: true
  });
  const result = JSON.parse(res.getContentText());
  if (!result.content || !result.content[0]) return { ok: false, error: "ai error" };
  const lines = result.content[0].text.split("\n").map(l => l.replace(/^[-・0-9.\s]+/, "").trim()).filter(l => l.length > 2);
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
    const result = JSON.parse(res.getContentText());
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
  const result = JSON.parse(res.getContentText());
  if (!result.content || !result.content[0]) return { ok: false, error: "ai error" };
  return { ok: true, data: { summary: result.content[0].text.trim(), lastCoachingDate: lastNote ? lastNote.date : null } };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 生徒プロフィール・契約情報・契約書ファイル
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const STUDENT_PROFILE_HEADERS = ["student_email","coach_email","name","birthdate","gender","family","address","phone","occupation","profile_notes",
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
  const fields = ["name","birthdate","gender","family","address","phone","occupation","profile_notes","contract_start","contract_end","payment_type","contract_amount","installment_count","stripe_email"];

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
  if (!custData.data || custData.data.length === 0) return null;
  const customerId = custData.data[0].id;

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
  return { total, currency, customerId };
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
    const data = cal.getEvents(start, end).map(ev => ({
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

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][emailIdx]) !== studentEmail) continue;
    if (body.notify_start    !== undefined) sheet.getRange(i + 1, startIdx    + 1).setValue(Number(body.notify_start) || 7);
    if (body.notify_end      !== undefined) sheet.getRange(i + 1, endIdx      + 1).setValue(Number(body.notify_end)   || 23);
    if (body.notify_interval !== undefined) sheet.getRange(i + 1, intervalIdx + 1).setValue(Number(body.notify_interval) || 4);
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
    break;
  }
  return { ok: true };
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
      if (!user.line_user_id) return;

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
- 今日のカレンダー予定がある場合は、目標との関係を意識しつつ今日の過ごし方に軽く触れる
- 3文以内
${EMOJI_STYLE}`;

      const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        payload: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 300, messages: [{ role: "user", content: prompt }] }),
        muteHttpExceptions: true
      });
      const result = JSON.parse(res.getContentText());
      if (!result.content || !result.content[0]) return;
      const bodyText = stripSalutation(result.content[0].text);
      logCoachMessage(user.student_email, bodyText);
      sendLineMessage(user.line_user_id, "🌅 おはようございます、" + (user.nickname || user.name) + "さん！\n\n" + formatForLine(bodyText));
    } catch (err) { Logger.log("morningCoach error: " + err); }
  });
}

function hourlyReminder() {
  const hour = new Date().getHours();
  // 23時以降はレポート・夜のコーチメッセージの時間帯なのでリマインダーは送らない
  if (hour >= 23) return;
  const timeBlock = String(hour).padStart(2, "0") + ":00";
  const getContextBundle = preloadContextBundles();
  sheetToObjects(getSheet("Users")).filter(u => u.is_active.toUpperCase() === "TRUE").forEach(user => {
    const start = Number(user.notify_start) || 7;
    const end = Number(user.notify_end) || 23;
    const interval = Number(user.notify_interval) || 4;
    if (hour < start || hour > end) return;
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

    // 最後に記録した時間からの経過時間
    const lastLogHour = todayLogs.length > 0
      ? Math.max(...todayLogs.map(l => parseInt(l.time_block)))
      : -99;
    const hoursWithoutLog = hour - lastLogHour;

    // 5時間以上記録がない場合はコーチメッセージ付き（送信数を抑えるため、以前の3時間から緩和）
    if (hoursWithoutLog >= 5) {
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
${EMOJI_STYLE}
- ただし1文だけの短文なので絵文字は1個まで`;

          const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
            payload: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 100, messages: [{ role: "user", content: prompt }] }),
            muteHttpExceptions: true
          });
          const result = JSON.parse(res.getContentText());
          if (result.content && result.content[0]) {
            const bodyText = stripSalutation(result.content[0].text).trim();
            logCoachMessage(user.student_email, bodyText);
            sendLineMessage(user.line_user_id, bodyText + "\n📝 " + APP_URL);
            return;
          }
        } catch(e) { Logger.log("hourlyCoach error: " + e); }
      }
    }
    sendLineMessage(user.line_user_id, "⏱ " + timeBlock + " の記録タイム！\n📝 " + APP_URL);
  });
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
    break;
  }
}

function nightlyReport() {
  const today = formatDate(new Date());
  sheetToObjects(getSheet("Users")).filter(u => u.is_active.toUpperCase() === "TRUE").forEach(user => {
    try {
      const logs = getLogs(user.student_email).data;

      // ログなし → XP減少・ストリークリセット
      if (logs.length === 0) {
        applyXPDecay(user.student_email);
        return;
      }

      // 既存レポートがあればスキップ（重複防止）
      const existing = sheetToObjects(getSheet("Reports")).find(r => r.student_email === user.student_email && r.date === today);
      if (existing) { Logger.log(user.student_email + ": 本日のレポートは既に存在します"); return; }

      updateStreak(user.student_email);
      const report = generateReportWithClaude(user.student_email, user.name, logs);
      if (!report) return;
      appendReportRow(today, user.student_email, report);
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

      notifyCoachOnReport(user, report);
    } catch (err) { Logger.log(err); }
  });
}

function nightlyCoachMessage() {
  const today = formatDate(new Date());
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
- 今は夜23時台。挨拶（おはよう・こんにちは等）は書かず、時間帯に合った内容で本題から入る
- レポートの内容（スコア・良かった点・改善点）を言い直さない。分析はもう終わってる
- カレンダーの予定と実際の記録を見比べて、予定どおり実行できていた場面があれば具体的に承認する
- 今日のログの中の具体的な一場面を1つだけ拾って、そこに一言添える
- 過去のメモや出来事の引用は歓迎だが、元の意味・文脈を正確に保つこと。取り違えた引用をするくらいなら使わない
- 「Chatworkで」のように情報の出どころを名指ししない。本人の状況として自然に触れる
- 敬語とタメ語を自然に混ぜる。友人が寝る前に送るLINEのような温度感
- 「---」「【】」「〇〇さんへ」などの見出し・宛名は絶対使わない
- 直近のコーチメッセージと同じ言い回し・構成は絶対に繰り返さない
- 2文以内
${EMOJI_STYLE}`;

      const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        payload: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 400, messages: [{ role: "user", content: coachPrompt }] }),
        muteHttpExceptions: true
      });
      const result = JSON.parse(res.getContentText());
      if (result.content && result.content[0]) {
        const bodyText = stripSalutation(result.content[0].text);
        logCoachMessage(user.student_email, bodyText);
        sendLineMessage(user.line_user_id, "🤖 習慣AIコーチより\n\n" + formatForLine(bodyText));
      }
    } catch(e) { Logger.log("nightlyCoachMessage error: " + e); }
  });
}

// 記録なしの日はXPを減らしてストリークをリセット
function applyXPDecay(studentEmail) {
  const sheet = getSheet("Users");
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const emailIdx = headers.indexOf("student_email");
  const xpIdx = headers.indexOf("xp");
  const streakIdx = headers.indexOf("streak");
  const lastLogDateIdx = headers.indexOf("last_log_date");

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][emailIdx]) !== studentEmail) continue;

    const currentXP = Number(data[i][xpIdx] || 0);
    const rawLLD2 = data[i][lastLogDateIdx];
    const lastLogDate = rawLLD2 instanceof Date ? Utilities.formatDate(rawLLD2, "Asia/Tokyo", "yyyy-MM-dd") : String(rawLLD2 || "");
    const yesterday = formatDate(new Date(Date.now() - 86400000));

    // 昨日も記録なしなら減少額を増やす（最大-30）
    const missedYesterday = lastLogDate !== yesterday;
    const decay = missedYesterday ? 30 : 15;
    const newXP = Math.max(0, currentXP - decay);

    sheet.getRange(i + 1, xpIdx + 1).setValue(newXP);
    // ストリークリセット
    if (streakIdx !== -1) sheet.getRange(i + 1, streakIdx + 1).setValue(0);

    Logger.log(studentEmail + ": XP " + currentXP + " → " + newXP + " (decay -" + decay + ")");
    break;
  }
}

function generateReportWithClaude(studentEmail, studentName, logs) {
  const apiKey = PropertiesService.getScriptProperties().getProperty("CLAUDE_API_KEY");
  if (!apiKey) { Logger.log("CLAUDE_API_KEY が未設定"); return null; }

  const user = sheetToObjects(getSheet("Users")).find(u => u.student_email === studentEmail);
  const ctx = buildStudentContext(studentEmail, user);

  const totalBlocks = logs.length;
  const withMemo = logs.filter(l => l.memo && l.memo.trim()).length;
  const goalRelatedCount = logs.filter(l => l.goal_related === "true" || l.goal_related === true).length;
  const goalRelatedPct = totalBlocks > 0 ? Math.round(goalRelatedCount / totalBlocks * 100) : 0;
  const logsText = logs.map(l => l.time_block + " - " + l.task + "（集中度：" + l.focus_level + (l.goal_related === "true" ? "、目標関連" : "") + (l.memo ? "、メモ：" + l.memo : "") + "）").join("\n");

  const prompt = `あなたは生徒一人ひとりに寄り添う教育コーチです。以下の情報をすべて把握した上で、今日の振り返りレポートを生成してください。

【コーチの方針】
- 基本は肯定的・共感的。生徒を信じて応援するスタンスを崩さない
- 心理学的アプローチ（承認→気づき→行動）を意識する
- 目標の期限に対する「現在地」を具体的に言語化して伝える
- 今の取り組みが目標達成にどうつながるかを示す
- 継続できていることは積極的に称える
- 全レポート履歴を踏まえてスコアのトレンドや変化を具体的に読み取ること
- カレンダーの予定と実際の記録を照らし合わせ、予定を実行できたか（計画実行力）の視点も入れる

${ctx}

【今日のログ（${totalBlocks}ブロック、メモ${withMemo}個、目標関連${goalRelatedCount}ブロック(${goalRelatedPct}%)）】
${logsText}

【採点基準（各0〜20点・合計で100点満点のscoreになるようにする）】
- records（20点）: 記録したブロック数の多さ
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

以下のJSON形式のみで返してください（説明文不要）。breakdownの5項目の合計は必ずscoreと一致させること。
breakdown_reasonsは各項目の点数についてのひとことコメントで、必ず全項目分書くこと（品質・量の両面で何を評価/改善点としたか具体的に触れる）：
{
  "score": <0-100の整数>,
  "breakdown": { "records": <0-20>, "memo": <0-20>, "focus": <0-20>, "goal": <0-20>, "consistency": <0-20> },
  "breakdown_reasons": { "records": "<この点数についてのひとことコメント>", "memo": "<同上>", "focus": "<同上>", "goal": "<同上>", "consistency": "<同上>" },
  "feedback": "<目標の現在地と今日の取り組みへの共感・承認を含む2-3文>",
  "highlights": "<今日の具体的な良かった点を1文で称える>",
  "improvement": "<責めずに前向きな改善提案または継続すべき点を1文で>",
  "actions": ["<明日実行する具体的アクションを、それ単体で意味が通る完結した1文で>", "<必要なら2つ目>", "<必要なら3つ目>"],
  "trend": "<全レポート履歴から見える成長・変化のトレンドを1文で>"
}
actionsは1〜3個の配列。各要素はチェックリストの1項目としてそのまま表示されるため、他の要素に依存せず独立して意味が通る完結した1文にすること。`;

  const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    payload: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1024, messages: [{ role: "user", content: prompt }] }),
    muteHttpExceptions: true
  });

  const rawText = res.getContentText();
  Logger.log("Claude生レスポンス: " + rawText.substring(0, 800));
  const result = JSON.parse(rawText);
  if (!result.content || !result.content[0]) {
    Logger.log("Claude エラー: " + rawText);
    return null;
  }
  try {
    const text = result.content[0].text.trim();
    Logger.log("Claudeテキスト: " + text.substring(0, 500));
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) { Logger.log("JSONが見つかりません"); return null; }
    const parsed = JSON.parse(m[0]);
    // actionsは配列で受け取り、改行区切りの文字列に変換して保存する。
    // アプリ側は改行だけで分割するため、文中の「・」や「。」で
    // 1つのアクションが途中で千切れることがなくなる
    if (Array.isArray(parsed.actions)) {
      parsed.action = parsed.actions.map(a => String(a).trim()).filter(Boolean).join("\n");
    }
    return parsed;
  } catch (e) { Logger.log("JSONパースエラー: " + e.toString()); return null; }
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
    if (headers.indexOf("auto_summary") === -1) {
      sheet.getRange(1, headers.length + 1).setValue("auto_summary");
      headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    }
    const diaryIdx = headers.indexOf("diary");
    const updatedIdx = headers.indexOf("updated_at");
    const summaryIdx = headers.indexOf("auto_summary");
    const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const rowDate = data[i][0] instanceof Date
        ? Utilities.formatDate(data[i][0], "Asia/Tokyo", "yyyy-MM-dd")
        : String(data[i][0]);
      if (String(data[i][1]) === studentEmail && rowDate === targetDate) {
        if (fields.diary !== undefined) sheet.getRange(i + 1, diaryIdx + 1).setValue(fields.diary);
        if (fields.auto_summary !== undefined) sheet.getRange(i + 1, summaryIdx + 1).setValue(fields.auto_summary);
        sheet.getRange(i + 1, updatedIdx + 1).setValue(now);
        return;
      }
    }
    const rowArr = new Array(headers.length).fill("");
    rowArr[1] = studentEmail;
    if (fields.diary !== undefined) rowArr[diaryIdx] = fields.diary;
    if (fields.auto_summary !== undefined) rowArr[summaryIdx] = fields.auto_summary;
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// タイマー終了通知（アプリが閉じられていてもLINEで気づけるように）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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
      if (user && user.line_user_id) {
        sendLineMessage(user.line_user_id, "⏰ " + label + "が終了しました！\n記録を忘れずに📝\n" + APP_URL);
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
      return date + ":\n  " + entries.join("\n  ");
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
    ? recentReports.map(r => `${r.date}: ${r.score}点 / 良：${r.highlights} / 改善：${r.improvement}`).join("\n")
    : allReports.length > 0
      ? allReports.slice(0,7).map(r => `${r.date}: ${r.score}点 / 良：${r.highlights} / 改善：${r.improvement}`).join("\n")
      : "まだレポートなし";

  // 全期間スコアトレンド
  const allScores = allReports.map(r => Number(r.score));
  const avgScore = allScores.length > 0 ? Math.round(allScores.reduce((a,b)=>a+b,0)/allScores.length) : null;
  const scoreTrend = avgScore !== null ? `全期間平均${avgScore}点（${allScores.length}日分）` : "データなし";

  // 目標と期限
  const goalsWithDeadline = [
    { goal: user.goal, deadline: user.goal_deadline },
    { goal: user.goal2, deadline: user.goal_deadline2 },
    { goal: user.goal3, deadline: user.goal_deadline3 }
  ].filter(g => g.goal).map((g, i) => {
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

  // 今日のカレンダー予定（アプリが同期したキャッシュ。JSON形式と旧テキスト形式の両対応）
  let todayPlan = getCachedCalendar(studentEmail, today);
  if (todayPlan) {
    try {
      const evs = JSON.parse(todayPlan);
      todayPlan = evs.length > 0
        ? evs.map(function(e){ return e.allDay ? ("終日 " + e.title) : (e.time + "〜 " + e.title); }).join(" / ")
        : "予定なし";
    } catch (e) { /* 旧テキスト形式はそのまま使う */ }
  }

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
        `【${n.date}】${n.content}` +
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
      chatworkText = messages.map(m => `${m.send_time} ${m.sender_name}: ${m.body}`).join("\n");
    }
  } catch (e) { /* シート未作成なら無視 */ }

  return `【生徒名】${user.name}
【入会日】${user.joined_at || "不明"}
【連続記録日数】${streak}日
【全期間の記録】合計${totalDaysRecorded}日・${totalBlocks}ブロック
【今日のカレンダー予定】${todayPlan || "未同期（予定情報なし）"}
【目標と期限】
${goalsText}
【全期間スコアトレンド】${scoreTrend}
【直近のコーチングセッション（担当コーチとの面談記録。約束事項のフォローアップを意識する）】
${coachingText}
【本人とのこれまでのやり取り（生成文では情報源に言及せず、本人の状況として自然に触れること）】
${chatworkText}
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
- 記録日数: ${activeDays}日 / ${totalBlocks}ブロック
- 集中度内訳: ${focusSummary}
- 目標関連: ${goalRelatedCount}ブロック
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
      const result = JSON.parse(res.getContentText());
      if (!result.content || !result.content[0]) return;

      summarySheet.appendRow([monthStr, user.student_email, result.content[0].text, new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })]);
      Logger.log(user.student_email + ": " + monthStr + " 月次サマリー生成完了");
    } catch(err) { Logger.log("monthlySummary error: " + err); }
  });
}

function testGenerateMonthlySummary() {
  generateMonthlySummaries();
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
function sendLineMessage(lineUserId, text) {
  if (!lineUserId || !LINE_CHANNEL_TOKEN) return false;
  try {
    const res = UrlFetchApp.fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + LINE_CHANNEL_TOKEN },
      payload: JSON.stringify({ to: lineUserId, messages: [{ type: "text", text }] }),
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

function rowToObject(row, headers) {
  const obj = {};
  headers.forEach((h, i) => {
    const v = row[i];
    if (v instanceof Date) {
      if (v.getFullYear() === 1899) {
        obj[h] = String(v.getHours()).padStart(2,"0") + ":" + String(v.getMinutes()).padStart(2,"0");
      } else {
        const inTokyo = new Date(v.toLocaleString("en-US", {timeZone:"Asia/Tokyo"}));
        const hasTime = inTokyo.getHours() !== 0 || inTokyo.getMinutes() !== 0;
        obj[h] = hasTime
          ? Utilities.formatDate(v, "Asia/Tokyo", "yyyy-MM-dd HH:mm")
          : Utilities.formatDate(v, "Asia/Tokyo", "yyyy-MM-dd");
      }
    }
    else { obj[h] = v !== undefined && v !== null ? String(v) : ""; }
  });
  return obj;
}

function sheetToObjects(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  return data.slice(1).map(row => rowToObject(row, headers));
}

// 指定した列の値で先に絞り込んでから、対象行だけをオブジェクト化する。
// sheetToObjects()でシート全体を毎回フル変換すると、行数（全生徒の履歴）が
// 増えるほど遅くなるため、1人分のデータしか使わない関数はこちらを使う
function getFilteredRows(sheetName, filterColumn, filterValue) {
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

function setupSheets() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheets = {
    "Users": ["student_email","name","line_user_id","coach_email","coach_line_id","google_calendar_id","chatwork_room","is_active","joined_at","notify_start","notify_end","nickname","avatar","show_in_community"],
    "DailyLog": ["log_id","student_email","date","time_block","task","focus_level","memo","timestamp","goal_related"],
    "Reports": ["date","student_email","score","feedback","action","highlights","improvement","created_at","breakdown"],
    "Messages": ["message_id","student_email","content","sender_name","sender_photo","sender_role","timestamp","is_read"],
    "Coaches": ["coach_email","coach_name","assigned_students"],
    "MonthlySummary": ["month","student_email","summary","created_at"],
    "CalendarCache": ["student_email","date","events","updated_at"],
    "Journal": ["date","student_email","diary","updated_at","auto_summary"],
    "TimerQueue": ["student_email","end_time","label","notified","created_at"],
    "Achievements": ["date","student_email","nickname","avatar","message","created_at"],
    "CoachingNotes": ["note_id","coach_email","student_email","date","content","next_theme","promises","created_at"],
    "StudentProfile": ["student_email","coach_email","name","birthdate","gender","family","address","phone","occupation","profile_notes","contract_start","contract_end","payment_type","contract_amount","installment_count","updated_at","stripe_email","stripe_total_paid","stripe_currency","stripe_synced_at","chatwork_id","chatwork_room_id"],
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

function setupTriggers() {
  // GASは1スクリプトあたり時間主導トリガー最大20個までのため、
  // 「毎時7〜23時に個別トリガー」(17個)は他と合わせると上限を超えてしまう。
  // hourlyReminder側で時刻・間隔をチェックしているので、1時間ごとの単一トリガーに統合する。
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("morningScheduleNotify").timeBased().everyDays(1).atHour(7).create();
  ScriptApp.newTrigger("nightlyReport").timeBased().everyDays(1).atHour(23).create();
  ScriptApp.newTrigger("nightlyCoachMessage").timeBased().everyDays(1).atHour(23).nearMinute(30).create();
  ScriptApp.newTrigger("generateMonthlySummaries").timeBased().onMonthDay(1).atHour(3).create();
  ScriptApp.newTrigger("checkTimerQueue").timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger("hourlyReminder").timeBased().everyHours(1).create();
  ScriptApp.newTrigger("syncStripeTotals").timeBased().everyDays(1).atHour(4).create();
  ScriptApp.newTrigger("syncChatworkMessages").timeBased().everyHours(1).create();
  console.log("トリガーを設定しました（合計8個）");
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// テスト用
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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
      appendReportRow(targetDate, user.student_email, report);
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
