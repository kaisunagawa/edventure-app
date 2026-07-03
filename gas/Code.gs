// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// EdVenture — GAS Web App エンドポイント
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const SPREADSHEET_ID = "1EbGxrI6e-rmzgDk4jczOX1RfHIYY-6Q1jOPpr5Hybqc";
const APP_URL = "https://kaisunagawa.github.io/edventure-app/";
const CLAUDE_API_KEY = PropertiesService.getScriptProperties().getProperty("CLAUDE_API_KEY");
const LINE_CHANNEL_TOKEN = PropertiesService.getScriptProperties().getProperty("LINE_CHANNEL_TOKEN");

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
    coachName: coach ? coach.name : "コーチ"
  } };
}

function getReportList(studentEmail) {
  const rows = sheetToObjects(getSheet("Reports"));
  const list = rows
    .filter(r => r.student_email === studentEmail)
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
function computeAllStatuses() {
  const sheet = getSheet("DailyLog");
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idx = {
    student_email: headers.indexOf("student_email"),
    date: headers.indexOf("date"),
    memo: headers.indexOf("memo"),
    focus_level: headers.indexOf("focus_level"),
    goal_related: headers.indexOf("goal_related"),
  };
  const byUser = {};
  for (let i = 1; i < data.length; i++) {
    const email = String(data[i][idx.student_email]);
    if (!email) continue;
    const rawDate = data[i][idx.date];
    const rowDate = rawDate instanceof Date
      ? Utilities.formatDate(rawDate, "Asia/Tokyo", "yyyy-MM-dd")
      : String(rawDate);
    (byUser[email] = byUser[email] || []).push({
      date: rowDate,
      memo: String(data[i][idx.memo] || ""),
      focus_level: String(data[i][idx.focus_level] || ""),
      goal_related: String(data[i][idx.goal_related] || ""),
    });
  }

  // ステータスは平均や割合ではなく「これまでの累計」で育つ設計。
  // やった分だけ必ず増え、サボっても下がらない（レベルと同じ感覚）。
  // sqrtカーブで、序盤は伸びやすく上限20に近づくほど1上げるのが大変になる。
  const grow = (total, factor) => Math.min(20, Math.floor(Math.sqrt(Math.max(0, total)) * factor));

  const result = {};
  Object.keys(byUser).forEach(email => {
    const logs = byUser[email];
    const days = {};
    logs.forEach(l => { (days[l.date] = days[l.date] || []).push(l); });
    const activeDays = Object.keys(days).length;

    const totalBlocks = logs.length;
    const totalMemos = logs.filter(l => l.memo && l.memo.trim()).length;
    const highFocusBlocks = logs.filter(l => (parseInt(l.focus_level) || 0) >= 4).length;
    const goalBlocks = logs.filter(l => l.goal_related === "true" || l.goal_related === true).length;

    const breakdown = {
      records: grow(totalBlocks, 1),        // 400ブロック(約2ヶ月)で20
      memo: grow(totalMemos, 1.3),          // 240メモで20
      focus: grow(highFocusBlocks, 1.3),    // 高集中240ブロックで20
      goal: grow(goalBlocks, 1.2),          // 目標関連280ブロックで20
      consistency: grow(activeDays, 2.5),   // 記録64日で20
    };
    const score = breakdown.records + breakdown.memo + breakdown.focus + breakdown.goal + breakdown.consistency;
    result[email] = { score, breakdown };
  });
  return result;
}

function getStatusSummary(studentEmail) {
  const status = computeAllStatuses()[studentEmail];
  if (!status) return { ok: true, data: null };
  return { ok: true, data: status };
}

function getReport(studentEmail, body) {
  const rows = sheetToObjects(getSheet("Reports"));
  const userRows = rows.filter(r => r.student_email === studentEmail).sort((a, b) => b.date > a.date ? 1 : -1);
  const targetDate = (body && body.date) ? body.date : formatDate(new Date());
  const report = userRows.find(r => r.date === targetDate) || userRows[0];
  if (!report) return { ok: true, data: null };
  let breakdown = null;
  if (report.breakdown) { try { breakdown = JSON.parse(report.breakdown); } catch (e) {} }
  return { ok: true, data: { score: Number(report.score), breakdown: breakdown, feedback: report.feedback, action: report.action, highlights: report.highlights, improvement: report.improvement, date: report.date } };
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
  for (let i = 1; i < data.length; i++) {
    const rawDate = data[i][dateIdx];
    const rowDate = rawDate instanceof Date
      ? Utilities.formatDate(rawDate, "Asia/Tokyo", "yyyy-MM-dd")
      : String(rawDate);
    if (String(data[i][emailIdx]) === studentEmail &&
        rowDate === targetDate &&
        String(data[i][timeIdx]) === String(body.time_block)) {
      sheet.getRange(i+1, headers.indexOf("task")+1).setValue(body.task);
      sheet.getRange(i+1, headers.indexOf("focus_level")+1).setValue(body.focus_level);
      sheet.getRange(i+1, headers.indexOf("memo")+1).setValue(body.memo || "");
      let grIdx = headers.indexOf("goal_related");
      if(grIdx === -1){ grIdx = headers.length; sheet.getRange(1, grIdx+1).setValue("goal_related"); }
      sheet.getRange(i+1, grIdx+1).setValue(body.goal_related || "false");
      if (!isPast) updateStreak(studentEmail);
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
  const xpResult = addXP(studentEmail, body.memo);
  return { ok: true, log_id: logId, ...xpResult };
}

function addXP(studentEmail, memo) {
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
    const today = formatDate(new Date());
    const todayLogs = sheetToObjects(getSheet("DailyLog")).filter(l => l.student_email === studentEmail && l.date === today);
    const isFirstLogToday = todayLogs.length <= 1;

    let gained = 10;
    if (memo && memo.trim()) gained += 5;
    if (isFirstLogToday) gained += Math.min(streak, 30) * 2;

    const newXP = currentXP + gained;
    const oldLevel = getXpLevel(currentXP);
    const newLevel = getXpLevel(newXP);
    const levelUp = newLevel > oldLevel;

    usersSheet.getRange(i+1, xpIdx+1).setValue(newXP);

    // バッジ判定
    const newBadges = checkBadges(studentEmail, currentBadges, newXP, streak);
    if (newBadges !== currentBadges) {
      usersSheet.getRange(i+1, badgesIdx+1).setValue(newBadges);
    }

    return { xp_gained: gained, total_xp: newXP, level: newLevel, level_up: levelUp, badges: newBadges };
  }
  return { xp_gained: 0, total_xp: 0, level: 1, level_up: false, badges: "" };
}

function checkBadges(studentEmail, currentBadges, xp, streak) {
  const badgeList = currentBadges ? currentBadges.split(",").filter(Boolean) : [];

  const today = formatDate(new Date());
  const logs = sheetToObjects(getSheet("DailyLog")).filter(l => l.student_email === studentEmail);
  const memoCount = logs.filter(l => l.memo && l.memo.trim()).length;
  const totalLogs = logs.length;

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
  const user = sheetToObjects(getSheet("Users")).find(u => u.student_email === studentEmail);
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
function getRanking(studentEmail) {
  const users = sheetToObjects(getSheet("Users")).filter(u => u.is_active.toUpperCase() === "TRUE");
  if (users.length < 2) return { ok: true, data: null };
  const active = new Set(users.map(u => u.student_email));

  const latest = {};
  sheetToObjects(getSheet("Reports")).forEach(r => {
    if (!active.has(r.student_email)) return;
    if (!latest[r.student_email] || r.date > latest[r.student_email].date) latest[r.student_email] = r;
  });

  const scores = Object.keys(latest).map(email => ({ email, score: Number(latest[email].score) || 0 }));
  scores.sort((a, b) => b.score - a.score);

  const idx = scores.findIndex(s => s.email === studentEmail);
  if (idx === -1) return { ok: true, data: null };
  return { ok: true, data: { rank: idx + 1, total: scores.length, score: scores[idx].score } };
}

// 「みんなの頑張り」画面用。ニックネーム＋アバターは本名と違い公開前提の情報なので
// 実名やメールは一切含めず、直近7日の活動量でランキング表示する。
// 「みんなの頑張り」のランキングは、ホームの「ステータス」と同じ累計基準。
// 見ている場所によって基準がバラバラだと分かりにくいため一本化している。
function getCommunity(studentEmail) {
  const users = sheetToObjects(getSheet("Users")).filter(u => u.is_active.toUpperCase() === "TRUE");
  const statuses = computeAllStatuses();

  const list = users.map(u => {
    const status = statuses[u.student_email];
    return {
      isMe: u.student_email === studentEmail,
      nickname: u.nickname || "名無しさん",
      avatar: u.avatar || "🦊",
      streak: Number(u.streak || 0),
      score: status ? status.score : 0
    };
  }).sort((a, b) => b.score - a.score);

  return { ok: true, data: list };
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

function getMessages(studentEmail) {
  const rows = sheetToObjects(getSheet("Messages"));
  const msgs = rows.filter(r => r.student_email === studentEmail)
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
  const user = sheetToObjects(getSheet("Users")).find(u => u.student_email === studentEmail);
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
    break;
  }
  return { ok: true };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 自動トリガー
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function morningScheduleNotify() {
  sheetToObjects(getSheet("Users")).filter(u => u.is_active.toUpperCase() === "TRUE").forEach(user => {
    try {
      if (!user.line_user_id) return;

      const apiKey = PropertiesService.getScriptProperties().getProperty("CLAUDE_API_KEY");
      if (!apiKey) return;

      const ctx = buildStudentContext(user.student_email, user);
      const recentMsgs = getRecentCoachMessages(user.student_email, 5);

      const prompt = `あなたは${user.name}の友人でもある教育コーチです。以下の情報をすべて把握した上で、今朝の個別メッセージを送ってください。

${ctx}
${recentMsgs}

【スタイル】
- 敬語とタメ語を自然に混ぜる（「すごいじゃん、さすが！」「今日も一緒に頑張りましょう」など）
- ユーモアを1つ忍ばせて、読んでクスッとできる温度感
- 「---」「【】」「〇〇へのメッセージ」「〇〇案：」「〇〇さんへ」などの見出し・宛名・区切りは絶対使わない
- 本文だけをそのまま書く。前置きや説明・宛名は一切不要
- 直近のコーチメッセージと同じ言い回し・内容・切り口は絶対に繰り返さない。毎回違う角度から話す
- 全レポート履歴と直近14日のログを踏まえて、具体的なエピソードや数字に触れる
- 今日のカレンダー予定がある場合は、目標との関係を意識しつつ今日の過ごし方に軽く触れる
- 3文以内。絵文字1個まで。「おはようございます」は不要（冒頭に入れるため）`;

      const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        payload: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 300, messages: [{ role: "user", content: prompt }] }),
        muteHttpExceptions: true
      });
      const result = JSON.parse(res.getContentText());
      if (!result.content || !result.content[0]) return;
      sendLineMessage(user.line_user_id, "🌅 おはようございます、" + user.name + "さん！\n\n" + formatForLine(stripSalutation(result.content[0].text)));
    } catch (err) { Logger.log("morningCoach error: " + err); }
  });
}

function hourlyReminder() {
  const hour = new Date().getHours();
  // 21時以降はレポート・夜のコーチメッセージの時間帯なのでリマインダーは送らない
  if (hour >= 21) return;
  const timeBlock = String(hour).padStart(2, "0") + ":00";
  sheetToObjects(getSheet("Users")).filter(u => u.is_active.toUpperCase() === "TRUE").forEach(user => {
    const start = Number(user.notify_start) || 7;
    const end = Number(user.notify_end) || 23;
    const interval = Number(user.notify_interval) || 2;
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

    // 3時間以上記録がない場合はコーチメッセージ付き
    if (hoursWithoutLog >= 3) {
      const apiKey = PropertiesService.getScriptProperties().getProperty("CLAUDE_API_KEY");
      if (apiKey) {
        try {
          // 今日のログ内容をまとめる
          const todayLogSummary = todayLogs.length === 0
            ? "今日はまだ1件も記録していない"
            : `今日すでに${todayLogs.length}件記録済み（${todayLogs.map(l => l.time_block + " " + l.task).join("、")}）、直近の記録から${hoursWithoutLog}時間経過`;

          const ctx = buildStudentContext(user.student_email, user);
          const recentMsgs = getRecentCoachMessages(user.student_email, 3);

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
- 絵文字1個まで`;

          const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
            payload: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 100, messages: [{ role: "user", content: prompt }] }),
            muteHttpExceptions: true
          });
          const result = JSON.parse(res.getContentText());
          if (result.content && result.content[0]) {
            sendLineMessage(user.line_user_id, stripSalutation(result.content[0].text).trim() + "\n📝 " + APP_URL);
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

  sheetToObjects(getSheet("Users")).filter(u => u.is_active.toUpperCase() === "TRUE").forEach(user => {
    try {
      if (!user.line_user_id) return;
      // 今日のレポートがある場合のみ送る
      const report = sheetToObjects(getSheet("Reports")).find(r => r.student_email === user.student_email && r.date === today);
      if (!report) return;

      const ctx = buildStudentContext(user.student_email, user);
      const recentMsgs = getRecentCoachMessages(user.student_email, 5);
      const streak = Number(user.streak || 0);
      const coachPrompt = `あなたは${user.name}の友人でもある教育コーチです。1時間前にAIレポート（スコアと分析）は既に送信済みです。それとは別の、1日の終わりの人間らしい一言を送ってください。

${ctx}
【1時間前に送信済みのレポート内容（絶対に繰り返さない）】
スコア${report.score}点 / 良かった点：${report.highlights} / 改善点：${report.improvement}
【連続記録日数】${streak}日
${recentMsgs}

【スタイル】
- 今は夜22時。挨拶（おはよう・こんにちは等）は書かず、時間帯に合った内容で本題から入る
- レポートの内容（スコア・良かった点・改善点）を言い直さない。分析はもう終わってる
- カレンダーの予定と実際の記録を見比べて、予定どおり実行できていた場面があれば具体的に承認する
- 今日のログの中の具体的な一場面を1つだけ拾って、そこに一言添える
- 敬語とタメ語を自然に混ぜる。友人が寝る前に送るLINEのような温度感
- 「---」「【】」「〇〇さんへ」などの見出し・宛名は絶対使わない
- 直近のコーチメッセージと同じ言い回し・構成は絶対に繰り返さない
- 2文以内。絵文字1個まで`;

      const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        payload: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 400, messages: [{ role: "user", content: coachPrompt }] }),
        muteHttpExceptions: true
      });
      const result = JSON.parse(res.getContentText());
      if (result.content && result.content[0]) {
        sendLineMessage(user.line_user_id, "🤖 習慣AIコーチより\n\n" + formatForLine(stripSalutation(result.content[0].text)));
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

以下のJSON形式のみで返してください（説明文不要）。breakdownの5項目の合計は必ずscoreと一致させること：
{
  "score": <0-100の整数>,
  "breakdown": { "records": <0-20>, "memo": <0-20>, "focus": <0-20>, "goal": <0-20>, "consistency": <0-20> },
  "feedback": "<目標の現在地と今日の取り組みへの共感・承認を含む2-3文>",
  "highlights": "<今日の具体的な良かった点を1文で称える>",
  "improvement": "<責めずに前向きな改善提案または継続すべき点を1文で>",
  "action": "<目標達成に向けた明日の具体的アクション。1〜3個。複数ある場合は必ず「・」で区切り、1つのアクションは途中で区切らず1つにまとめる>",
  "trend": "<全レポート履歴から見える成長・変化のトレンドを1文で>"
}`;

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
    return JSON.parse(m[0]);
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
  const sheet = getSheet("CalendarCache");
  if (!sheet) return null;
  const row = sheetToObjects(sheet).find(r => r.student_email === studentEmail && r.date === dateStr);
  return row && row.events ? row.events : null;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 生徒コンテキスト構築（全プロンプト共通）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function buildStudentContext(studentEmail, user) {
  const today = formatDate(new Date());

  // 直近14日の生ログ
  const fourteenDaysAgo = formatDate(new Date(Date.now() - 14 * 86400000));
  const allLogs = sheetToObjects(getSheet("DailyLog")).filter(l => l.student_email === studentEmail);
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
  const monthlySummaries = sheetToObjects(getSheet("MonthlySummary"))
    .filter(r => r.student_email === studentEmail)
    .sort((a,b) => a.month > b.month ? 1 : -1);
  const summariesText = monthlySummaries.length > 0
    ? monthlySummaries.map(r => `【${r.month}】\n${r.summary}`).join("\n\n")
    : "まだ月次サマリーなし（入会1ヶ月未満）";

  // 直近30日のレポート履歴（月次サマリーを補完）
  const thirtyDaysAgo = formatDate(new Date(Date.now() - 30 * 86400000));
  const allReports = sheetToObjects(getSheet("Reports"))
    .filter(r => r.student_email === studentEmail)
    .sort((a,b) => b.date > a.date ? 1 : -1);
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

  return `【生徒名】${user.name}
【入会日】${user.joined_at || "不明"}
【連続記録日数】${streak}日
【全期間の記録】合計${totalDaysRecorded}日・${totalBlocks}ブロック
【今日のカレンダー予定】${todayPlan || "未同期（予定情報なし）"}
【目標と期限】
${goalsText}
【全期間スコアトレンド】${scoreTrend}
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

// 直近N件のLINEメッセージ（コーチ→生徒）を取得して繰り返し防止に使う
function getRecentCoachMessages(studentEmail, limit) {
  limit = limit || 5;
  const msgs = sheetToObjects(getSheet("Messages"))
    .filter(m => m.student_email === studentEmail && m.sender_role === "coach")
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

function sendLineMessage(lineUserId, text) {
  if (!lineUserId || !LINE_CHANNEL_TOKEN) return;
  UrlFetchApp.fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + LINE_CHANNEL_TOKEN },
    payload: JSON.stringify({ to: lineUserId, messages: [{ type: "text", text }] }),
    muteHttpExceptions: true
  });
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

function sheetToObjects(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  return data.slice(1).map(row => {
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
  });
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
    "Users": ["student_email","name","line_user_id","coach_email","coach_line_id","google_calendar_id","chatwork_room","is_active","joined_at","notify_start","notify_end","nickname","avatar"],
    "DailyLog": ["log_id","student_email","date","time_block","task","focus_level","memo","timestamp","goal_related"],
    "Reports": ["date","student_email","score","feedback","action","highlights","improvement","created_at","breakdown"],
    "Messages": ["message_id","student_email","content","sender_name","sender_photo","sender_role","timestamp","is_read"],
    "Coaches": ["coach_email","coach_name","assigned_students"],
    "MonthlySummary": ["month","student_email","summary","created_at"],
    "CalendarCache": ["student_email","date","events","updated_at"],
    "Journal": ["date","student_email","diary","updated_at","auto_summary"],
    "TimerQueue": ["student_email","end_time","label","notified","created_at"],
    "Achievements": ["date","student_email","nickname","avatar","message","created_at"]
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
  ScriptApp.newTrigger("nightlyReport").timeBased().everyDays(1).atHour(21).create();
  ScriptApp.newTrigger("nightlyCoachMessage").timeBased().everyDays(1).atHour(22).create();
  ScriptApp.newTrigger("generateMonthlySummaries").timeBased().onMonthDay(1).atHour(3).create();
  ScriptApp.newTrigger("checkTimerQueue").timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger("hourlyReminder").timeBased().everyHours(1).create();
  console.log("トリガーを設定しました（合計6個）");
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
