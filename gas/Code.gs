// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// EdVenture — GAS Web App エンドポイント
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const SPREADSHEET_ID = "1EbGxrI6e-rmzgDk4jczOX1RfHIYY-6Q1jOPpr5Hybqc";
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
      case "getReport":    result = getReport(studentEmail, e.parameter); break;
      case "getReportList": result = getReportList(studentEmail); break;
      case "getLogs":      result = getLogs(studentEmail, e.parameter); break;
      case "getMessages":  result = getMessages(studentEmail); break;
      case "getSchedule":  result = getSchedule(studentEmail); break;
      case "getStudents":  result = getStudents(studentEmail); break;
      case "saveLog":      result = saveLog(studentEmail, e.parameter); break;
      case "sendMessage":  result = sendMessage(studentEmail, e.parameter); break;
      case "saveSettings": result = saveSettings(studentEmail, e.parameter); break;
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
          sendLineMessage(lineUserId, "EdVentureへようこそ！🎉\n\nアカウントを連携するために、登録済みのGmailアドレスをこのLINEに送ってください。\n（例: yourname@gmail.com）\n\nまだアプリ登録していない場合はこちらから👇\nhttps://kaisunagawa.github.io/edventure-app/");
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

  const idxEmail    = ensureHeader("student_email");
  const idxName     = ensureHeader("name");
  const idxActive   = ensureHeader("is_active");
  const idxJoined   = ensureHeader("joined_at");
  const idxGoal     = ensureHeader("goal");
  const idxDeadline = ensureHeader("goal_deadline");
  const idxStart    = ensureHeader("notify_start");
  const idxEnd      = ensureHeader("notify_end");

  const newRow = new Array(headers.length).fill("");
  newRow[idxEmail]    = studentEmail;
  newRow[idxName]     = body.name || "";
  newRow[idxActive]   = "TRUE";
  newRow[idxJoined]   = today;
  newRow[idxGoal]     = body.goal || "";
  newRow[idxDeadline] = body.goal_deadline || "";
  newRow[idxStart]    = 7;
  newRow[idxEnd]      = 23;
  sheet.appendRow(newRow);

  return { ok: true, data: { name: body.name, coachName: "コーチ", coach_email: "" } };
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
  return { ok: true, data: { name: user.name, coach_email: user.coach_email, coachName: coach ? coach.name : "コーチ" } };
}

function getReportList(studentEmail) {
  const rows = sheetToObjects(getSheet("Reports"));
  const list = rows
    .filter(r => r.student_email === studentEmail)
    .sort((a, b) => b.date > a.date ? 1 : -1)
    .map(r => ({ date: r.date, score: Number(r.score) }));
  return { ok: true, data: list };
}

function getReport(studentEmail, body) {
  const rows = sheetToObjects(getSheet("Reports"));
  const userRows = rows.filter(r => r.student_email === studentEmail).sort((a, b) => b.date > a.date ? 1 : -1);
  const targetDate = (body && body.date) ? body.date : formatDate(new Date());
  const report = userRows.find(r => r.date === targetDate) || userRows[0];
  if (!report) return { ok: true, data: null };
  return { ok: true, data: { score: Number(report.score), feedback: report.feedback, action: report.action, highlights: report.highlights, improvement: report.improvement, date: report.date } };
}

function getLogs(studentEmail, body) {
  const rows = sheetToObjects(getSheet("DailyLog"));
  const targetDate = (body && body.date) ? body.date : formatDate(new Date());
  const logs = rows.filter(r => r.student_email === studentEmail && r.date === targetDate)
    .sort((a, b) => a.time_block > b.time_block ? 1 : -1)
    .map(r => ({ log_id: r.log_id, time_block: r.time_block, task: r.task, focus_level: r.focus_level, memo: r.memo }));
  return { ok: true, data: logs };
}

function saveLog(studentEmail, body) {
  const sheet = getSheet("DailyLog");
  const today = formatDate(new Date());
  const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });

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
        rowDate === today &&
        String(data[i][timeIdx]) === String(body.time_block)) {
      sheet.getRange(i+1, headers.indexOf("task")+1).setValue(body.task);
      sheet.getRange(i+1, headers.indexOf("focus_level")+1).setValue(body.focus_level);
      sheet.getRange(i+1, headers.indexOf("memo")+1).setValue(body.memo || "");
      const xpResult = addXP(studentEmail, body.memo);
      return { ok: true, log_id: String(data[i][0]), updated: true, ...xpResult };
    }
  }

  const logId = "log_" + Date.now();
  const newRow = sheet.getLastRow() + 1;
  sheet.appendRow([logId, studentEmail, today, "", body.task, body.focus_level, body.memo || "", now]);
  sheet.getRange(newRow, 4).setNumberFormat("@").setValue(String(body.time_block));

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
  return { ok: true, data: { xp, level, xpInLevel, xpForNextLevel, streak, badges, goal: user.goal || "", goal_deadline: user.goal_deadline || "" } };
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
    const logs = sheetToObjects(getSheet("DailyLog")).filter(l => l.student_email === studentEmail && l.date === today);
    const logSummary = logs.length > 0
      ? logs.map(l => l.time_block + ": " + l.task + "（集中度" + l.focus_level + "）").join("\n")
      : "まだ記録なし";

    const allMsgs = sheetToObjects(getSheet("Messages"))
      .filter(m => m.student_email === studentEmail)
      .sort((a, b) => a.message_id > b.message_id ? 1 : -1);
    // 直前にappendRowした現在のメッセージを除いた直近10件
    const recentMessages = allMsgs.slice(-11, -1)
      .map(m => ({ role: m.sender_role === "student" ? "user" : "assistant", content: m.content }));

    const systemPrompt = `あなたは教育コーチです。温かく具体的なフィードバックを日本語で返してください。返信は2〜4文で簡潔にまとめてください。

【生徒名】${user.name}
【目標】${user.goal || "未設定"}
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

    const replyText = result.content[0].text;
    const sheet = getSheet("Messages");
    const msgId = "msg_" + Date.now();
    const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
    sheet.appendRow([msgId, studentEmail, replyText, "コーチ", "", "coach", now, "false"]);

    // LINEで通知
    if (user.line_user_id) {
      sendLineMessage(user.line_user_id, "💬 コーチより：\n" + replyText);
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
  const goalIdx     = ensureCol("goal");
  const deadlineIdx = ensureCol("goal_deadline");
  const calIdx      = ensureCol("google_calendar_id");
  const lineIdx     = ensureCol("line_user_id");

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][emailIdx]) !== studentEmail) continue;
    if (body.notify_start       !== undefined) sheet.getRange(i + 1, startIdx    + 1).setValue(Number(body.notify_start) || 7);
    if (body.notify_end         !== undefined) sheet.getRange(i + 1, endIdx      + 1).setValue(Number(body.notify_end)   || 23);
    if (body.goal               !== undefined) sheet.getRange(i + 1, goalIdx     + 1).setValue(body.goal);
    if (body.goal_deadline      !== undefined) sheet.getRange(i + 1, deadlineIdx + 1).setValue(body.goal_deadline);
    if (body.google_calendar_id !== undefined) sheet.getRange(i + 1, calIdx      + 1).setValue(body.google_calendar_id);
    if (body.line_user_id       !== undefined) sheet.getRange(i + 1, lineIdx     + 1).setValue(body.line_user_id);
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
      const s = getSchedule(user.student_email);
      if (!s.data || s.data.length === 0) return;
      sendLineMessage(user.line_user_id, "☀️ おはようございます、" + user.name + "さん！\n\n今日の予定：\n" + s.data.map(ev => ev.time + " " + ev.title).join("\n") + "\n\n頑張りましょう！");
    } catch (err) {}
  });
}

function hourlyReminder() {
  const hour = new Date().getHours();
  const timeBlock = String(hour).padStart(2, "0") + ":00";
  sheetToObjects(getSheet("Users")).filter(u => u.is_active.toUpperCase() === "TRUE").forEach(user => {
    const start = Number(user.notify_start) || 7;
    const end = Number(user.notify_end) || 23;
    if (hour < start || hour > end) return;
    sendLineMessage(user.line_user_id, "⏱ " + timeBlock + " の記録を入力しましょう！\nこの1時間、何をしましたか？\n\nhttps://kaisunagawa.github.io/edventure-app/");
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

      updateStreak(user.student_email);
      const report = generateReportWithClaude(user.student_email, user.name, logs);
      if (!report) return;
      getSheet("Reports").appendRow([today, user.student_email, report.score, report.feedback, report.action, report.highlights, report.improvement, new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })]);
      const streak = sheetToObjects(getSheet("Users")).find(u => u.student_email === user.student_email)?.streak || 1;
      const streakMsg = Number(streak) >= 3 ? "\n\n連続" + streak + "日記録中！すごい！" : "";
      sendLineMessage(user.line_user_id, "今日のAIレポート\n\nスコア：" + report.score + "点\n\n" + report.feedback + "\n\n明日のアクション：\n" + report.action + streakMsg);
      notifyCoachOnReport(user, report);
    } catch (err) { Logger.log(err); }
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
  const goal = user ? (user.goal || "未設定") : "未設定";
  const totalBlocks = logs.length;
  const withMemo = logs.filter(l => l.memo && l.memo.trim()).length;
  const focusVariety = new Set(logs.map(l => l.focus_level)).size;

  // 過去30日分のレポート履歴を取得
  const pastReports = sheetToObjects(getSheet("Reports"))
    .filter(r => r.student_email === studentEmail)
    .sort((a, b) => b.date > a.date ? 1 : -1)
    .slice(0, 30);

  // 過去7日分のログ統計
  const allLogs = sheetToObjects(getSheet("DailyLog")).filter(l => l.student_email === studentEmail);
  const sevenDaysAgo = formatDate(new Date(Date.now() - 7 * 86400000));
  const recentLogs = allLogs.filter(l => l.date >= sevenDaysAgo);
  const avgFocusRecent = recentLogs.length > 0
    ? (recentLogs.filter(l => l.focus_level === "高").length / recentLogs.length * 100).toFixed(0) + "%"
    : "データなし";

  const historyText = pastReports.length > 0
    ? pastReports.slice(0, 7).map(r => r.date + ": スコア" + r.score + "点 / " + r.feedback).join("\n")
    : "なし（初回レポート）";

  const logsText = logs.map(l => l.time_block + " - " + l.task + "（集中度：" + l.focus_level + (l.memo ? "、メモ：" + l.memo : "") + "）").join("\n");

  const prompt = `あなたは生徒の成長を長期的に支援する教育コーチです。
過去のデータと今日のログをもとに、深い分析と具体的なフィードバックを日本語で返してください。

【生徒名】${studentName}
【目標】${goal}
【過去7日の高集中率】${avgFocusRecent}
【過去レポート履歴（直近7日）】
${historyText}

【今日のログ（${totalBlocks}ブロック、メモ${withMemo}個、集中度${focusVariety}種類使用）】
${logsText}

【採点基準】
- 記録ブロック数: 多いほど良い（最大40点）
- メモの質・量: 振り返りの深さ（最大30点）
- 集中度の正直さ: 全部「高」でなく正直につけているか（最大30点）
- 過去との比較: 成長・改善が見られれば加点

以下のJSON形式のみで返してください（説明文不要）：
{
  "score": <0-100の整数>,
  "feedback": "<過去との比較を含む2-3文のフィードバック>",
  "highlights": "<今日の良かった点を1文で>",
  "improvement": "<改善点または継続すべき点を1文で>",
  "action": "<明日の具体的なアクションを1-2文で>",
  "trend": "<過去データからわかる成長トレンドを1文で>"
}`;

  const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    payload: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 512, messages: [{ role: "user", content: prompt }] }),
    muteHttpExceptions: true
  });

  const result = JSON.parse(res.getContentText());
  if (!result.content || !result.content[0]) {
    Logger.log("Claude エラー: " + res.getContentText());
    return null;
  }
  try {
    const m = result.content[0].text.trim().match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch (e) { return null; }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LINE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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
    "Users": ["student_email","name","line_user_id","coach_email","coach_line_id","google_calendar_id","chatwork_room","is_active","joined_at","notify_start","notify_end"],
    "DailyLog": ["log_id","student_email","date","time_block","task","focus_level","memo","timestamp"],
    "Reports": ["date","student_email","score","feedback","action","highlights","improvement","created_at"],
    "Messages": ["message_id","student_email","content","sender_name","sender_photo","sender_role","timestamp","is_read"],
    "Coaches": ["coach_email","coach_name","assigned_students"]
  };
  Object.entries(sheets).forEach(([name, headers]) => {
    let s = ss.getSheetByName(name);
    if (!s) s = ss.insertSheet(name);
    if (s.getLastRow() === 0) s.appendRow(headers);
  });
  console.log("シート作成完了");
}

function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("morningScheduleNotify").timeBased().everyDays(1).atHour(7).create();
  ScriptApp.newTrigger("nightlyReport").timeBased().everyDays(1).atHour(21).create();
  // 毎時ちょうどに届くよう、7〜23時それぞれにトリガーを設定
  for (let h = 7; h <= 23; h++) {
    ScriptApp.newTrigger("hourlyReminder").timeBased().everyDays(1).atHour(h).create();
  }
  console.log("トリガーを設定しました");
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
      getSheet("Reports").appendRow([targetDate, user.student_email, report.score, report.feedback, report.action, report.highlights, report.improvement, new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })]);
      Logger.log(user.student_email + ": " + targetDate + " レポート生成完了 スコア=" + report.score);
    } catch(err) { Logger.log(err); }
  });
}

function generateYesterdayReport() {
  const yesterday = formatDate(new Date(Date.now() - 86400000));
  Logger.log("昨日: " + yesterday);
  generateReportForDate(yesterday);
}

function testSaveLog() {
  const result = saveLog("work.sunagawa@gmail.com", { time_block: "10:00", task: "テスト", focus_level: "高", memo: "動作確認" });
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
  const user = users.find(u => u.student_email === "work.sunagawa@gmail.com");
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
  Logger.log(JSON.stringify(getUser("work.sunagawa@gmail.com")));
}

function testStreak() {
  updateStreak("work.sunagawa@gmail.com");
  Logger.log(JSON.stringify(getStreak("work.sunagawa@gmail.com")));
}
