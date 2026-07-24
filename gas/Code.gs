// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// EdVenture — GAS Web App エンドポイント
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const SPREADSHEET_ID = "1EbGxrI6e-rmzgDk4jczOX1RfHIYY-6Q1jOPpr5Hybqc";
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
const XP_THRESHOLDS = [0, 500, 1200, 2200, 3500, 5200, 7500, 10000, 13000, 17000, 21000, 25500, 30500, 36000, 42000, 49000];

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
  const studentEmail = e.parameter.studentEmail;
  const callback = e.parameter.callback;
  try {
    let result;
    switch (action) {
      case "getUser":      result = getUser(studentEmail); break;
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
        _logs.forEach(function (l) { if (l.time_block && String(l.task || "").trim()) { writeRecordToOwnerCalendar(studentEmail, l.date, String(l.time_block), l.task); _cnt++; } });
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
      case "getStatusSummary": result = getStatusSummary(studentEmail); break;
      case "getLogs":      result = getLogs(studentEmail, e.parameter); break;
      case "getMessages":  result = getMessages(studentEmail); break;
      case "getSchedule":  result = getSchedule(studentEmail); break;
      case "getStudents":  result = getStudents(studentEmail); break;
      case "saveLog":      result = saveLog(studentEmail, e.parameter); break;
      case "deleteLog":    result = deleteLog(studentEmail, e.parameter); break;
      case "quickLog":     result = quickLog(studentEmail, e.parameter); break;
      case "saveLogMulti": result = saveLogMulti(studentEmail, e.parameter); break;
      case "coachGetStudents":      result = coachGetStudents(e.parameter.coachEmail); break;
      case "adminTagCohortByJoinDate": result = adminTagCohortByJoinDate(e.parameter.coachEmail, e.parameter.date, e.parameter.cohort); break;
      case "adminListRecentRegistrations": result = adminListRecentRegistrations(e.parameter.coachEmail, e.parameter.days); break;
      case "adminBackfillReports": result = adminBackfillReports(e.parameter.coachEmail, e.parameter.days, e.parameter.limit, e.parameter.dryRun); break;
      case "adminOpsHealthCheck": result = verifyAdmin(e.parameter.coachEmail) ? (dailyOpsHealthCheck(e.parameter.dryRun === "1") || {ok:true}) : {ok:false,error:"not admin"}; break;
      case "adminInstallTrigger": result = adminInstallTrigger(e.parameter.coachEmail, e.parameter.handler); break;
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
      case "adminBroadcastLine": result = adminBroadcastLine(e.parameter.coachEmail, e.parameter.message, e.parameter.confirm); break;
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
      case "deleteLog":    return jsonResponse(deleteLog(studentEmail, body));
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
  const idxPlan      = ensureHeader("plan_status");
  const idxTrial     = ensureHeader("trial_start");

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
  // 新規登録は7日間の無料トライアルから開始（既存ユーザーはplan_status空欄のまま＝制限なし）
  newRow[idxPlan]     = "trial";
  newRow[idxTrial]    = today;
  sheet.appendRow(newRow);

  return { ok: true, data: { name: body.name, nickname: newRow[idxNickname], avatar: newRow[idxAvatar], coachName: "コーチ", coach_email: "" } };
}

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
    serverCalendar: (studentEmail === adminEmail() && !!user.google_calendar_id)
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
    return { ok: true, data: data };
  } finally { _sheetReadCacheOn = false; _sheetReadCache = {}; }
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
  try {
    // ランキングキャッシュはcohortごとに分かれているため、書き込んだ本人のcohortのキーを消す
    const au = sheetToObjects(getSheet("Users")).find(u => u.student_email === studentEmail);
    const ck = "ranking_scores_v5_" + (String((au && au.cohort) || "").trim() || "main");
    CacheService.getScriptCache().remove(ck);
  } catch (e) { /* ignore */ }
  try { postHighScoreAchievement(studentEmail, report.score); } catch (e) { /* ignore */ }
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
  if (!sheet) return { today: 0, month: 0, byFeature: {}, byModel: {}, count: 0 };
  var rows = sheetToObjects(sheet);
  var today = formatDate(new Date()), month = today.slice(0, 7);
  var t = 0, m = 0, byF = {}, byM = {}, cnt = 0;
  rows.forEach(function (r) {
    var d = String(r.date), c = Number(r.cost_usd) || 0;
    if (d.slice(0, 7) !== month) return;
    m += c; cnt++;
    var f = String(r.feature || "その他") || "その他";
    byF[f] = (byF[f] || 0) + c;
    var mo = String(r.model || "").replace("claude-", "").replace("-20251001", "");
    byM[mo] = (byM[mo] || 0) + c;
    if (d === today) t += c;
  });
  return { today: t, month: m, byFeature: byF, byModel: byM, count: cnt };
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
  const text = String(body.text || "").trim();
  if (!text) return { ok: false, error: "何をしたか一言だけ教えてください" };
  const apiKey = PropertiesService.getScriptProperties().getProperty("CLAUDE_API_KEY");
  if (!apiKey) return { ok: false, error: "CLAUDE_API_KEY未設定" };

  const now = new Date();
  const hour = now.getHours();
  const pad2 = (n) => String(n).padStart(2, "0");
  const curBlock = pad2(hour) + ":00";
  const nowStr = pad2(hour) + ":" + pad2(now.getMinutes());
  const today = formatDate(now);

  const user = sheetToObjects(getSheet("Users")).find(u => u.student_email === studentEmail);
  const goalsText = user ? [user.goal, user.goal2, user.goal3].filter(Boolean).join(" / ") : "";

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
    const sr = saveLog(studentEmail, {
      time_block: tb,
      task: String(r.task || "記録").slice(0, 60),
      focus_level: FOCUS_LABELS[fnum],
      memo: String(r.memo || "").slice(0, 3000),
      goal_related: r.goal_related === true ? "true" : "false"
    });
    if (sr.ok) {
      saved.push({ time_block: tb, task: r.task, focus_level: fnum, goal_related: r.goal_related === true });
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
function writeRecordToOwnerCalendar(studentEmail, dateStr, timeBlock, task) {
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
      try { existing[0].setColor(CalendarApp.EventColor.GRAY); } catch (e) {}
      // 同じ開始時刻のJIROKU記録が既に複数ある＝過去の二重登録。1件だけ残して掃除する
      for (var _di = 1; _di < existing.length; _di++) { try { existing[_di].deleteEvent(); } catch (e) {} }
    } else {
      var ev = cal.createEvent(title, start, end);
      try { ev.setTag("jirokuRecord", "1"); } catch (e) {}
      // クライアント書き込みと同じ灰色(graphite)に揃える（既定の青のままにしない）
      try { ev.setColor(CalendarApp.EventColor.GRAY); } catch (e) {}
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
      else { seen[key] = true; try { ev.setColor(CalendarApp.EventColor.GRAY); } catch (err) {} }
    });
    perCal.push(cal.getName() + ":" + evs.length + "件/削除" + rem);
  });
  // eventsは診断用（レスポンスが重くなるので通常運用のLINEレポート等では参照しない）
  return { ok: true, scanned: scanned, removed: removed, calendars: perCal, events: debugList.sort() };
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
      let awardedIdx = headers.indexOf("xp_awarded");
      if (awardedIdx === -1) { awardedIdx = headers.length; sheet.getRange(1, awardedIdx + 1).setValue("xp_awarded"); }
      const prevFocus = String(data[i][focusIdx] || "").trim();
      const newFocus = String(body.focus_level || "").trim();
      const flagRaw = String(data[i][awardedIdx] || "").toUpperCase();
      // xp_awardedフラグが未設定の古い記録は、既に評価が入っていれば「付与済み」とみなす
      // （デプロイ前からある記録が、編集で二重にXPをもらわないための移行措置）
      const prevAwarded = flagRaw === "TRUE" || (flagRaw === "" && !!prevFocus);
      sheet.getRange(i+1, headers.indexOf("task")+1).setValue(body.task);
      sheet.getRange(i+1, focusIdx+1).setValue(body.focus_level);
      sheet.getRange(i+1, headers.indexOf("memo")+1).setValue(body.memo || "");
      let grIdx = headers.indexOf("goal_related");
      if(grIdx === -1){ grIdx = headers.length; sheet.getRange(1, grIdx+1).setValue("goal_related"); }
      sheet.getRange(i+1, grIdx+1).setValue(body.goal_related || "false");
      writeRecordToOwnerCalendar(studentEmail, targetDate, String(body.time_block), body.task);
      if (!isPast) { updateStreak(studentEmail); invalidateStatusCache(); }

      // 「まだXP未付与」かつ「今回きちんと評価が入っている」記録にだけ、1回だけXPを付与する。
      // 評価なしで保存→あとで評価を足した修正でも確実に付き、付与済みの記録は何度更新しても増えない
      if (!isPast && !prevAwarded && newFocus) {
        sheet.getRange(i+1, awardedIdx+1).setValue("TRUE");
        if (String(body.goal_related) === "true") incrementGoalBlocksAndNotify(studentEmail, 1);
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
  writeRecordToOwnerCalendar(studentEmail, targetDate, String(body.time_block), body.task);
  let awardedIdxN = headers.indexOf("xp_awarded");
  if (awardedIdxN === -1) { awardedIdxN = headers.length; sheet.getRange(1, awardedIdxN + 1).setValue("xp_awarded"); }

  const newFocusN = String(body.focus_level || "").trim();
  // 過去日の後付け入力はストリーク・XPの対象外（後から稼げない）
  if (isPast) { sheet.getRange(newRow, awardedIdxN + 1).setValue("FALSE"); return { ok: true, log_id: logId, xp_gained: 0 }; }

  updateStreak(studentEmail);
  invalidateStatusCache();
  // 評価が入っている記録だけ、その場でXPを付与して「付与済み」の印を付ける。
  // 評価なしで保存した場合は付与せず未付与のままにし、あとで評価を足した更新時に付与する
  if (!newFocusN) { sheet.getRange(newRow, awardedIdxN + 1).setValue("FALSE"); return { ok: true, log_id: logId, xp_gained: 0 }; }
  sheet.getRange(newRow, awardedIdxN + 1).setValue("TRUE");
  if (String(body.goal_related) === "true") incrementGoalBlocksAndNotify(studentEmail, 1);
  const xpResult = addXP(studentEmail, body.memo, todaysLogCount + 1, {
    totalLogs: totalLogs + 1,
    memoCount: memoCount + ((body.memo || "").trim() ? 1 : 0)
  });
  return { ok: true, log_id: logId, ...xpResult };
}

// 記録の削除。間違えて記録した時間帯を消せるようにする（編集画面で内容を空にして
// 更新＝この時間帯の記録を消す、という操作の受け皿）。該当行を1件だけ削除する。
function deleteLog(studentEmail, body) {
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
      sheet.deleteRow(i + 1);
      try { invalidateStatusCache(); } catch (e) { /* ignore */ }
      return { ok: true, deleted: true };
    }
  }
  return { ok: true, deleted: false };
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
  let awardedIdx = headers.indexOf("xp_awarded");
  if (awardedIdx === -1) {
    awardedIdx = headers.length;
    sheet.getRange(1, awardedIdx + 1).setValue("xp_awarded");
    headers = headers.concat(["xp_awarded"]);
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
  blocks.forEach(function (b) { writeRecordToOwnerCalendar(studentEmail, targetDate, b, body.task); });

  if (isPast) return { ok: true, xp_gained: 0, updated: updatedAny, count: blocks.length };

  updateStreak(studentEmail); // ブロック数ぶんではなく1回だけ
  invalidateStatusCache();
  // 今回どの記録も新たにXP対象にならなかった（評価済みの再編集だけ等）場合はXPを与えない
  if (awardedBlockCount === 0) return { ok: true, xp_gained: 0, updated: updatedAny, count: blocks.length };
  const xpResult = addXP(studentEmail, body.memo, todaysLogCount, { totalLogs, memoCount }); // DailyLogの再読み込みなし
  if (awardedGoalBlockCount > 0) incrementGoalBlocksAndNotify(studentEmail, awardedGoalBlockCount);
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
  const streakFreeze = Number(user.streak_freeze || 0);
  // 週ペース設計用: 直近8週の「記録した日数（ユニーク日付）」を週(月曜始まり)ごとに返す。
  // クライアントが本人の週目標と突き合わせて「今週●/N日」「週ストリーク」を算出する
  const weekDayCounts = computeWeekLogDays(getFilteredRows("DailyLog", "student_email", studentEmail), 8);
  return { ok: true, data: { xp, level, xpInLevel, xpForNextLevel, streak, streakFreeze, badges, goals, weekDayCounts, weekLogDays: (weekDayCounts[0] ? weekDayCounts[0].days : 0) } };
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
  const scores = [];
  latestByEmail.forEach(function (r, email) {
    if (noWindow || r.date >= cutoff) scores.push({ email: email, score: Number(r.score) || 0, date: r.date });
  });
  scores.sort(function (a, b) { return b.score - a.score; });
  return { latestDate: latestDate, cutoff: cutoff, scores: scores };
}

function getRanking(studentEmail) {
  // ラインの分離：学生（cohort付き）は学生同士、クライアント（cohortなし）はクライアント同士でだけ競う。
  // 有料顧客のランキングに学生が混ざる／学生に顧客が見える、という体験の混在を防ぐ
  const allUsersForCohort = sheetToObjects(getSheet("Users"));
  const meU = allUsersForCohort.find(u => u.student_email === studentEmail);
  const myCohort = String((meU && meU.cohort) || "").trim();
  const CACHE_KEY = "ranking_scores_v5_" + (myCohort || "main");
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

    // 期間しばり無し（windowDays=0）＝レポートを書いて点数が出ている人を“全員”対象にする
    const cur = buildReportRankingSet(active, allReports, 0);
    payload = { date: cur.latestDate, scores: cur.scores };
    try { CacheService.getScriptCache().put(CACHE_KEY, JSON.stringify(payload), 300); } catch (e) { /* サイズ超過時は無視 */ }
  }

  const scores = payload.scores || [];
  if (scores.length < 2) return { ok: true, data: null };

  // トレンド（↑↓）は本人の直近2回のレポートのスコア推移で判定する
  const myReports = getFilteredRows("Reports", "student_email", studentEmail).sort((a, b) => b.date > a.date ? 1 : -1);
  const myTrend = () => {
    if (myReports.length < 2) return null;
    const cs = Number(myReports[0].score) || 0, ps = Number(myReports[1].score) || 0;
    return cs > ps ? "up" : cs < ps ? "down" : "same";
  };

  const idx = scores.findIndex(s => s.email === studentEmail);
  if (idx !== -1) {
    return { ok: true, data: { rank: idx + 1, total: scores.length, score: scores[idx].score, trend: myTrend() } };
  }

  // 「みんなの頑張り」を非表示にしている本人は共有scoresから除外されるため、ここで個別救済。
  // レポートが1件でもあれば、その最新スコアで順位を算出（総数は本人を足した数）
  if (myReports.length) {
    const myScore = Number(myReports[0].score) || 0;
    const rank = scores.filter(s => s.score > myScore).length + 1;
    return { ok: true, data: { rank, total: scores.length + 1, score: myScore, trend: myTrend() } };
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
function getCommunity(studentEmail) {
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

  const statuses = computeAllStatuses();
  const allReports = sheetToObjects(getSheet("Reports"));
  const latestReportByEmail = new Map();
  allReports.forEach(r => {
    const cur = latestReportByEmail.get(r.student_email);
    if (!cur || r.date > cur.date) latestReportByEmail.set(r.student_email, r);
  });

  const list = users.map(u => {
    const isMe = u.student_email === studentEmail;
    const status = statuses[u.student_email];
    const latestReport = latestReportByEmail.get(u.student_email);
    return {
      isMe,
      nickname: maskName(u, isMe),
      avatar: maskAvatar(u, isMe),
      streak: Number(u.streak || 0),
      score: status ? status.score : 0,
      reportScore: latestReport ? Number(latestReport.score) : null
    };
  }).sort((a, b) => b.score - a.score);

  // レポートランキングは「その人の最新レポートの点数」で競う場（合計/継続はステータス側が担う）。
  // 期間しばり無し（windowDays=0）＝レポートを書いて点数が出ている人を全員、最新スコアで反映する。
  // 数日前にレポートを書いた人が消えないよう、ホームの getRanking と基準を統一している。
  const commEmails = new Set(users.map(u => u.student_email));
  const rankSet = buildReportRankingSet(commEmails, allReports, 0);
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

  // 最近記録した仲間（直近48時間に記録した人を全員）。ランキング（上位5人）とは別に、
  // 「記録した人は必ず載る」場を作ることで、頑張りを取りこぼさず称える
  const recentCut = formatDate(new Date(Date.now() - 1 * 86400000)); // 昨日・今日
  const recentLoggers = (function () {
    const emails = new Set(users.map(u => u.student_email));
    const byEmail = {};
    sheetToObjects(getSheet("DailyLog")).forEach(function (l) {
      if (emails.has(l.student_email) && String(l.date) >= recentCut) {
        byEmail[l.student_email] = (byEmail[l.student_email] || 0) + 1;
      }
    });
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

  return { ok: true, data: list, reportRanking: reportRanking, streakRanking: streakRanking, newcomers: newcomers, recentLoggers: recentLoggers };
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
  const result = JSON.parse(res.getContentText()); logAiUsage(result);
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
      const result = JSON.parse(res.getContentText()); logAiUsage(result);
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
  const result = JSON.parse(res.getContentText()); logAiUsage(result);
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
    const result = JSON.parse(res.getContentText()); logAiUsage(result);
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
  const result = JSON.parse(res.getContentText()); logAiUsage(result);
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
  const result = JSON.parse(res.getContentText()); logAiUsage(result);
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
  const result = JSON.parse(res.getContentText()); logAiUsage(result);
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
      const result = JSON.parse(res.getContentText()); logAiUsage(result);
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

    // 6時間以上記録がない場合はコーチメッセージ付き
    if (hoursWithoutLog >= 6) {
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
          const result = JSON.parse(res.getContentText()); logAiUsage(result);
          if (result.content && result.content[0]) {
            const bodyText = stripSalutation(result.content[0].text).trim();
            logCoachMessage(user.student_email, bodyText);
            notifyUserTimeSlot(user, "📝 記録リマインダー", bodyText, bodyText + "\n📝 " + APP_URL + "#quick");
            return;
          }
        } catch(e) { Logger.log("hourlyCoach error: " + e); }
      }
    }
    notifyUserTimeSlot(user, "⏱ 記録タイム", timeBlock + " の記録タイム！",
      "⏱ " + timeBlock + " の記録タイム！\n📝 " + APP_URL + "#quick");
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
  const goals = [user.goal, user.goal2, user.goal3].filter(Boolean).join(" / ");
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
  const result = JSON.parse(res.getContentText()); logAiUsage(result);
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
  // メール別に「記録がある日付」の集合を作る（当日判定と穴埋め判定の両方に使う）
  const logDatesByEmail = new Map();
  allLogs.forEach(l => {
    const em = String(l.student_email || "");
    if (!em) return;
    (logDatesByEmail.get(em) || logDatesByEmail.set(em, new Set()).get(em)).add(l.date);
  });
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
    if (dset && dset.has(today) && !haveReport.has(u.student_email + "|" + today)) {
      jobs.push({ user: u, date: today, backfill: false });
    }
  });
  for (let back = 1; back <= 2; back++) {
    const d = new Date(today + "T00:00:00+09:00"); d.setDate(d.getDate() - back);
    const bd = formatDate(d);
    users.forEach(u => {
      const dset = logDatesByEmail.get(u.student_email);
      if (dset && dset.has(bd) && !haveReport.has(u.student_email + "|" + bd)) {
        jobs.push({ user: u, date: bd, backfill: true });
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
      appendReportRow(job.date, user.student_email, report);
      haveReport.add(user.student_email + "|" + job.date);
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
      appendReportRow(targetDate, user.student_email, report);
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
      appendReportRow(date, user.student_email, report);
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
function adminBroadcastLine(email, message, confirm) {
  if (!verifyAdmin(email)) return { ok: false, error: "not admin" };
  if (!message) return { ok: false, error: "message is required" };
  const targets = sheetToObjects(getSheet("Users")).filter(u =>
    u.is_active.toUpperCase() === "TRUE" && u.line_user_id
  );
  if (confirm !== "yes") {
    return { ok: true, dryRun: true, recipientCount: targets.length, preview: message };
  }
  let sent = 0;
  targets.forEach(u => { if (sendLineMessage(u.line_user_id, message)) sent++; });
  return { ok: true, dryRun: false, recipientCount: targets.length, sentCount: sent };
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
      const result = JSON.parse(res.getContentText()); logAiUsage(result);
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
    const newXP = Math.max(0, currentXP - decay);

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
        payload: JSON.stringify({ model: MODELS[mi], max_tokens: 2500, messages: [{ role: "user", content: prompt }] }),
        muteHttpExceptions: true
      });
      const code = res.getResponseCode();
      const bodyText = res.getContentText();
      const result = JSON.parse(bodyText); logAiUsage(result, "業務報告書");
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

【採点基準（各0〜20点・合計で100点満点のscoreになるようにする）】
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
  upsertJournalRow(studentEmail, formatDate(new Date()), fields);
  return { ok: true };
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
      const result = JSON.parse(res.getContentText()); logAiUsage(result);
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
      const result = JSON.parse(res.getContentText()); logAiUsage(result);
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
      const result = JSON.parse(res.getContentText()); logAiUsage(result);
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
  const result = JSON.parse(res.getContentText()); logAiUsage(result);
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
  const goals = [user.goal, user.goal2, user.goal3].filter(Boolean).join(" / ");

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
function getTimeUseSummary(studentEmail) {
  const cutoff = formatDate(new Date(Date.now() - 14 * 86400000));
  const logs = getFilteredRows("DailyLog", "student_email", studentEmail).filter(l => l.date >= cutoff);
  if (logs.length === 0) return { ok: true, data: null };

  const days = new Set(logs.map(l => l.date)).size;
  const focusNums = logs.map(l => parseInt(l.focus_level) || 0).filter(n => n > 0);
  const goalCount = logs.filter(l => l.goal_related === "true" || l.goal_related === true).length;
  const taskHours = {};
  logs.forEach(l => { const t = String(l.task || "").trim(); if (t) taskHours[t] = (taskHours[t] || 0) + 1; });
  const topTasks = Object.entries(taskHours).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(entry => ({ task: entry[0], hours: entry[1] }));

  return { ok: true, data: {
    days,
    avgBlocksPerDay: Math.round(logs.length / days * 10) / 10,
    avgFocus: focusNums.length ? Math.round(focusNums.reduce((a, b) => a + b, 0) / focusNums.length * 10) / 10 : null,
    goalPct: Math.round(goalCount / logs.length * 100),
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
function adminInstallTrigger(email, handler) {
  if (!verifyAdmin(email)) return { ok: false, error: "not admin" };
  const name = String(handler || "").trim();
  const allowed = { dailyOpsHealthCheck: 1 };
  if (!allowed[name]) return { ok: false, error: "許可されていないハンドラ: " + name };
  const exists = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === name);
  if (exists) return { ok: true, data: { added: false, note: "既に登録済み" } };
  if (ScriptApp.getProjectTriggers().length >= 20) return { ok: false, error: "トリガー上限(20)に達しています" };
  ScriptApp.newTrigger(name).timeBased().everyDays(1).atHour(7).nearMinute(30).create();
  return { ok: true, data: { added: true } };
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
  ScriptApp.newTrigger("checkTimerQueue").timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger("hourlyReminder").timeBased().everyHours(1).create();
  ScriptApp.newTrigger("syncStripeTotals").timeBased().everyDays(1).atHour(4).create();
  ScriptApp.newTrigger("syncChatworkMessages").timeBased().everyHours(1).create();
  ScriptApp.newTrigger("checkGrowthMilestones").timeBased().everyWeeks(1).onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(9).create();
  ScriptApp.newTrigger("snsAutoFetchAll").timeBased().everyDays(1).atHour(21).create();
  ScriptApp.newTrigger("dailyLineWinback").timeBased().everyDays(1).atHour(19).create();
  // 運営ヘルスチェック：夜間レポート(22時)＋穴埋めが落ち着いた翌朝7時に、前日の欠落等を管理者へ
  ScriptApp.newTrigger("dailyOpsHealthCheck").timeBased().everyDays(1).atHour(7).nearMinute(30).create();
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
      appendReportRow(date, email, report);
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
      "② LINE連携する … 下のリンクを友だち追加して、登録したメールアドレスを送るだけ。\n   " + LINE_URL + "\n   → 毎晩、AIコーチがあなたの1日を採点したレポートを届けます。\n\n" +
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
      "連携は1分：\n下のリンクを友だち追加 → 登録したメールアドレスをトークで送る、これだけです。\n   " + LINE_URL + "\n\n" +
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
  const yesterday = formatDate(new Date(Date.now() - 86400000));
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
  if (missingYesterday.length > 0) problems.push("⚠️ 昨日のレポート欠落 " + missingYesterday.length + "件（記録したのに未生成）");
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
  lines.push("📋 昨日のレポート（" + yesterday + "）");
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
    if (au.count > 0) {
      const yen = function (usd) { return "$" + usd.toFixed(2); };
      const topF = Object.keys(au.byFeature).sort(function (a, b) { return au.byFeature[b] - au.byFeature[a]; }).slice(0, 4)
        .map(function (f) { return f + " " + yen(au.byFeature[f]); }).join(" / ");
      const topM = Object.keys(au.byModel).sort(function (a, b) { return au.byModel[b] - au.byModel[a]; })
        .map(function (m2) { return m2 + " " + yen(au.byModel[m2]); }).join(" / ");
      lines.push("");
      lines.push("💰 AI費用（アプリ内）: 今日 " + yen(au.today) + " / 今月 " + yen(au.month));
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

  // dryRunなら送信せず文面だけ返す（動作確認用）
  if (dryRun) return { ok: true, data: { text: text, problems: problems.length, sent: false } };

  // LINE優先、無ければメール
  if (adminUser && adminUser.line_user_id) {
    sendLineMessage(adminUser.line_user_id, text);
  } else {
    try { MailApp.sendEmail(admin, head, text); } catch (e) { Logger.log("ops health mail error: " + e); }
  }
  Logger.log("dailyOpsHealthCheck: " + head + " missing7=" + missing7);
  return { ok: true, data: { text: text, problems: problems.length, sent: true } };
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
    const critical = ["nightlyReport", "morningScheduleNotify", "dailyOpsHealthCheck"];
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
