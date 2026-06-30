// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// EdVenture — GAS Web App エンドポイント
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const SPREADSHEET_ID = "1EbGxrI6e-rmzgDk4jczOX1RfHIYY-6Q1jOPpr5Hybqc";
const CLAUDE_API_KEY = PropertiesService.getScriptProperties().getProperty("CLAUDE_API_KEY");
const LINE_CHANNEL_TOKEN = PropertiesService.getScriptProperties().getProperty("LINE_CHANNEL_TOKEN");

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
      case "getStreak":    result = getStreak(studentEmail); break;
      case "getGameStatus": result = getGameStatus(studentEmail); break;
      case "getReport":    result = getReport(studentEmail, e.parameter); break;
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
          const sheet = getSheet("Users");
          const rows = sheetToObjects(sheet);
          const exists = rows.find(r => r.line_user_id === lineUserId);
          if (!exists) {
            sheet.appendRow(["", "", lineUserId, "", "", "", "", "TRUE", formatDate(new Date())]);
            sendLineMessage(lineUserId, "EdVentureへようこそ！\nコーチから案内が届くまで少々お待ちください。");
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

function getReport(studentEmail, body) {
  const rows = sheetToObjects(getSheet("Reports"));
  const targetDate = (body && body.date) ? body.date : formatDate(new Date());
  const userRows = rows.filter(r => r.student_email === studentEmail).sort((a, b) => b.date > a.date ? 1 : -1);
  const report = userRows.find(r => r.date === targetDate);
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
    if (String(data[i][emailIdx]) === studentEmail &&
        String(data[i][dateIdx]) === today &&
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

    let gained = 10;
    if (memo && memo.trim()) gained += 5;
    gained += streak * 2;

    const newXP = currentXP + gained;
    const oldLevel = Math.floor(currentXP / 100) + 1;
    const newLevel = Math.floor(newXP / 100) + 1;
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
  const level = Math.floor(xp / 100) + 1;
  const xpInLevel = xp % 100;
  const streak = Number(user.streak || 0);
  const badgeIds = user.badges ? user.badges.split(",").filter(Boolean) : [];
  const badgeMap = { first:"🌱 はじめての記録", streak3:"🔥 3日連続達成", streak7:"⚡ 7日連続達成", memo10:"📝 メモ名人", xp500:"🌟 XP500達成" };
  const badges = badgeIds.map(id => ({ id, label: badgeMap[id] || id }));
  return { ok: true, data: { xp, level, xpInLevel, streak, badges, goal: user.goal || "", goal_deadline: user.goal_deadline || "" } };
}

function getMessages(studentEmail) {
  const rows = sheetToObjects(getSheet("Messages"));
  const msgs = rows.filter(r => r.student_email === studentEmail)
    .sort((a, b) => a.timestamp > b.timestamp ? 1 : -1)
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

    // 生徒情報を取得
    const user = sheetToObjects(getSheet("Users")).find(u => u.student_email === studentEmail);
    if (!user) return;

    // 今日のログを取得
    const today = formatDate(new Date());
    const logs = sheetToObjects(getSheet("DailyLog")).filter(l => l.student_email === studentEmail && l.date === today);
    const logSummary = logs.length > 0
      ? logs.map(l => l.time_block + ": " + l.task + "（集中度" + l.focus_level + "）").join("\n")
      : "まだ記録なし";

    // 直近のチャット履歴（最新10件）
    const recentMessages = sheetToObjects(getSheet("Messages"))
      .filter(m => m.student_email === studentEmail)
      .slice(-10)
      .map(m => ({ role: m.sender_role === "student" ? "user" : "assistant", content: m.content }));

    const systemPrompt = `あなたは教育コーチです。以下の生徒の情報をもとに、温かく具体的なフィードバックを日本語で返してください。返信は2〜4文で簡潔にまとめてください。

【生徒名】${user.name}
【目標】${user.goal || "未設定"}
【今日のログ】
${logSummary}`;

    const messages = [
      ...recentMessages,
      { role: "user", content: studentMessage }
    ];

    const response = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
      method: "post",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      payload: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        system: systemPrompt,
        messages: messages
      }),
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

  const startIdx = ensureCol("notify_start");
  const endIdx   = ensureCol("notify_end");
  const goalIdx  = ensureCol("goal");
  const deadlineIdx = ensureCol("goal_deadline");

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][emailIdx]) !== studentEmail) continue;
    if (body.notify_start !== undefined) sheet.getRange(i + 1, startIdx + 1).setValue(Number(body.notify_start) || 7);
    if (body.notify_end   !== undefined) sheet.getRange(i + 1, endIdx   + 1).setValue(Number(body.notify_end)   || 23);
    if (body.goal         !== undefined) sheet.getRange(i + 1, goalIdx  + 1).setValue(body.goal);
    if (body.goal_deadline !== undefined) sheet.getRange(i + 1, deadlineIdx + 1).setValue(body.goal_deadline);
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
    sendLineMessage(user.line_user_id, "⏱ " + timeBlock + " の記録を入力しましょう！\nこの1時間、何をしましたか？");
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
    const lastLogDate = String(data[i][lastLogDateIdx] || "");
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
    const lastLogDate = String(data[i][lastLogDateIdx] || "");
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
  const user = sheetToObjects(getSheet("Users")).find(u => u.student_email === studentEmail);
  const goal = user ? (user.goal || "未設定") : "未設定";
  const totalBlocks = logs.length;
  const withMemo = logs.filter(l => l.memo && l.memo.trim()).length;
  const focusLevels = logs.map(l => l.focus_level);
  const focusVariety = new Set(focusLevels).size;

  const logsText = logs.map(l => l.time_block + " - " + l.task + "（集中度：" + l.focus_level + (l.memo ? "、メモ：" + l.memo : "") + "）").join("\n");
  const prompt = `あなたは生徒の振り返りをサポートする教育コーチです。
以下は${studentName}さんの今日の時間ログです。

【目標】${goal}
【ログ】
${logsText}

【採点基準】
- 記録したブロック数（${totalBlocks}ブロック）: 多いほど良い（最大40点）
- メモを書いた割合（${totalBlocks}中${withMemo}個）: 振り返りの質（最大30点）
- 集中度の正直さ（${focusVariety}種類使用）: 全部「高」でなく正直につけているか（最大30点）
- 目標との関連性: ログが目標に沿っているか加点

以下のJSON形式でレポートを生成してください（必ずJSONのみ返すこと）：
{
  "score": <0-100の整数>,
  "feedback": "<2-3文の振り返りフィードバック。記録できたこと自体を褒めて>",
  "highlights": "<良かった点を1文で>",
  "improvement": "<改善点を1文で>",
  "action": "<明日の具体的なアクションを1-2文で>"
}`;
  const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": CLAUDE_API_KEY, "anthropic-version": "2023-06-01" },
    payload: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 512, messages: [{ role: "user", content: prompt }] }),
    muteHttpExceptions: true
  });
  const result = JSON.parse(res.getContentText());
  if (!result.content || !result.content[0]) return null;
  try { const m = result.content[0].text.trim().match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null; } catch (e) { return null; }
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
        obj[h] = v.getFullYear() === 1899
          ? String(v.getHours()).padStart(2,"0") + ":" + String(v.getMinutes()).padStart(2,"0")
          : formatDate(v);
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

function testSaveLog() {
  const result = saveLog("[REDACTED_EMAIL]", { time_block: "10:00", task: "テスト", focus_level: "高", memo: "動作確認" });
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
  const user = users.find(u => u.student_email === "[REDACTED_EMAIL]");
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
  Logger.log("APIキー取得: " + (apiKey ? "OK (長さ:" + apiKey.length + ")" : "なし"));

  const user = sheetToObjects(getSheet("Users")).find(u => u.student_email === "[REDACTED_EMAIL]");
  Logger.log("ユーザー: " + JSON.stringify(user));

  const response = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
    method: "post",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    payload: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 100,
      messages: [{ role: "user", content: "こんにちは" }]
    }),
    muteHttpExceptions: true
  });
  Logger.log("ステータス: " + response.getResponseCode());
  Logger.log("レスポンス: " + response.getContentText());
}

function testGetUser() {
  Logger.log(JSON.stringify(getUser("[REDACTED_EMAIL]")));
}

function testStreak() {
  updateStreak("[REDACTED_EMAIL]");
  Logger.log(JSON.stringify(getStreak("[REDACTED_EMAIL]")));
}
