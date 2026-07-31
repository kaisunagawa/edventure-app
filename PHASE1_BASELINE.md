# Phase 1 ベースライン記録（Checkpoint 0）

計測日時: 2026-07-31 18:11 JST
目的: Phase 1 実装後に「データが失われていないか」「速度が劣化していないか」を比較するための基準値。

## 復帰ポイント

| 項目 | 値 |
|---|---|
| コミット | `9d63e08` |
| タグ | `phase1-baseline`（GitHubへpush済み） |
| コードのバックアップ | `~/Desktop/JIROKU_backup_20260731_1811/`（index.html / Code.gs / coach_index.html / sw.js / appsscript.json） |
| GASデプロイID | `AKfycbzJ-QEpPVnmp-LFU5Jxww4VFP1qaseMtwCrzKxAA6ZULr1y3h_UeKzVdhHnl5ze57U`（変更しない） |

### ロールバック手順
1. `git reset --hard phase1-baseline`
2. `bash gas/push_gas.sh`（GASを元のコードで再デプロイ）
3. `git push -f origin main`（フロントをGitHub Pagesへ戻す）
4. 追加したシート（Goals / Sprints / WeeklyGoals / Tasks）は残るが、参照されなくなるだけで既存機能に影響しない
5. 既存シートへ追加した列も、読まれなくなるだけで既存動作に影響しない

**前提**: Phase 1 は「新規シートの追加」と「既存シートへの列追加」のみで、既存の列を削除・改名しない。したがってコードを戻せば動作も完全に戻る。

## データ件数（ヘッダ行を除く）

| シート | 行数 | 列数 |
|---|---:|---:|
| Users | 38 | 35 |
| DailyLog | 1,616 | 11 |
| Reports | 233 | 10 |
| Journal | 218 | 10 |
| Messages | 1,660 | 8 |
| Coaches | 1 | 4 |
| MonthlySummary | 0 | 4 |
| WeeklySummary | 36 | 12 |
| CalendarCache | 1 | 4 |
| TimerQueue | 14 | 5 |
| Achievements | 70 | 8 |
| CoachingNotes | 8 | 9 |
| StudentProfile | 13 | 24 |
| ContractFiles | 5 | 6 |
| ChatworkMessages | 593 | 8 |
| AiUsage | 446 | 7 |
| Surveys | 10 | 5 |

**既存シート一覧（24枚）**: Users, AiUsage, Surveys, TimeThemes, Insights, SessionLeads, WeeklySummary, SnsPosts, SnsMetrics, SnsAccounts, ContentProfile, ChatworkMessages, ContractFiles, StudentProfile, CoachingNotes, Achievements, TimerQueue, Journal, CalendarCache, MonthlySummary, DailyLog, Reports, Messages, Coaches

> 設計書には「15シート」と書いていたが、実際は24枚（SNS・気づき・時間テーマ等の後発シートを含む）。Phase 1 で新規4枚を足すと28枚になる。

## API速度（各2回計測）

| API | 1回目 | 2回目 | Phase 1 の基準 |
|---|---:|---:|---|
| getHomeData | 7.60s | 7.50s | 9.0s 以内 |
| getRanking | 3.08s | 4.11s | 悪化させない |
| getLogs | 3.80s | 4.19s | 悪化させない |
| getGameStatus | 3.57s | 3.79s | 悪化させない |

ログ保存（saveLog）は既存で約1.5s。Phase 1 の基準は **2.5s 以内**。

## AI費用

| 項目 | 値 |
|---|---|
| 本日 | $0.70 |
| 今月（計測開始後） | $5.34 |
| 記録件数 | 446 |

## Phase 1 で変更する予定のファイルと関数

### gas/Code.gs
- **新規**: シート取得関数（Goals / Sprints / WeeklyGoals / Tasks）、ID生成（`makeUserKey` / `makeExecutionId` / `makeTaskId`）、目標階層のCRUD API（約12本）、`resolvePrimaryWeeklyGoal`、`aggregateWeeklyActual`（metric_type別）、`migrateLocalTasks`
- **変更**: `setupSheets`（新規シート定義）、`saveLog` / `saveLogMulti`（action_execution_id・quantity・primary_weekly_goal_id の付与）、`deleteLog`（deleted_at）、`upsertJournalRow`（daily_focus_id ほかの列追加）、`getUser`（features返却）、`doGet` / `doPost`（新アクション追加）

### index.html
- **変更**: 設定画面の目標セクション（feature有効時は読み取り専用＋新画面への導線）、ホーム（週間目標の表示・タスクのサーバー同期）、記録フォーム（quantity の条件表示）、タスク詳細（Tasksシートへの保存）、起動時のlocalStorage移行処理

### coach/index.html
- **変更**: スプリント入力（15項目）と一覧

## Phase 1 で追加する構造（確定）

**新規シート4枚**: Goals / Sprints / WeeklyGoals / Tasks
**列追加**:
- DailyLog … action_execution_id, quantity, unit, primary_weekly_goal_id, related_goal_ids(空), link_task_id, deleted_at
- Journal … daily_focus_id, focus_completion_condition, focus_min_line, focus_planned_time, focus_if_then, link_weekly_goal_id, focus_achievement_state, focus_miss_reason
- Users … features, task_migrated_at

**作らないもの**: Executions（DailyLogが正）、DailyFocus（Journal拡張）、hourly_log_id（既存log_idを流用）

## 追加で確定した仕様（ChatGPTレビューによる）

1. **boolean目標の達成判定**: 関連ログの存在だけでは達成にしない。**本人が押す「達成」ボタンで status=COMPLETED になった場合のみ** actual_value=1。
2. **同名タスクの移行ID**: `task_{userKey}_{date}_{titleHash}_{occurrenceIndex}`。ランダムIDを使わず、再試行しても同じIDになる。既に同IDがあれば上書きせずスキップ。
