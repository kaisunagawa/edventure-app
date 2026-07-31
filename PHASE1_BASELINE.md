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

### ロールバック手順（修正版）

**`git push -f` は使わない。** 履歴を書き換えると、他の端末やGitHub Pagesのビルドと食い違いが起き、
「戻したはずなのに古いものが出る」状態を自分で作ってしまう。**打ち消しコミットを積んで前に進む**のが正しい。

```bash
cd ~/Projects/edventure-app
git revert --no-commit phase1-baseline..HEAD   # 変更を打ち消す内容を作る（履歴は消さない）
git commit -m "Phase 1 を取り消してベースラインへ戻す"
git push origin main                            # -f は付けない
bash gas/push_gas.sh                            # GASも同じ状態で再デプロイ
```

反映確認（マーカーは戻した版に含まれる文字列に置き換える）:
```bash
curl -s "https://kaisunagawa.github.io/edventure-app/index.html?_=$(date +%s)" | grep -c "確認したい文字列"
```

一部だけ戻したい場合は、`git revert <該当コミット>` で個別に打ち消す。
大きく作業をやり直したい場合は `git switch -c rollback phase1-baseline` で退避ブランチを作る。

**スプレッドシート側**:
- 追加したシート（Goals / Sprints / WeeklyGoals / Tasks）は残るが、参照されなくなるだけで既存機能に影響しない
- 既存シートへ追加した列も、読まれなくなるだけで既存動作に影響しない
- **データを戻す必要がある場合**は、Apps Scriptエディタから `p1BackupSpreadsheet()` で取ったコピー
  （マイドライブ/JIROKUバックアップ/）から復元する。コード側のロールバックでは戻らない

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

## 運用手順（Apps Scriptエディタから手で実行するもの）

Web app（doGet/doPost）には**意図的に載せていない**。このアプリはリクエストに書かれた
メールアドレスをそのまま信用する構造なので、Web app経由にすると誰でも叩けてしまう。
エディタからの実行はGoogleログインが必要＝本物の認証になる。

| 関数 | 用途 | 実行タイミング |
|---|---|---|
| `p1GenerateAdminSecret()` | 管理APIの鍵を発行。ログに出た文字列を控える | 最初に1回。以後は上書きしない |
| `p1BackupSpreadsheet()` | 本番データをまるごと複製（マイドライブ/JIROKUバックアップ/） | 大きな変更の前に毎回 |

`adminSetupPhase1` / `p1Status` は上で発行した鍵が必須：
`...?action=p1Status&studentEmail=<管理者>&secret=<鍵>`。鍵が未設定なら**常に拒否**される。

## データ公開レベル（法人向けを見据えた前提）

**まだ実装しない。ただし、これに反する設計をしない。**

法人向けに個人のパフォーマンスを測る機能を検討しているが、**本人の記録をそのまま上司へ
見せる設計にはしない**。全部見えると分かった時点で、人は正直に記録しなくなり、
データそのものの価値が失われるため。

| レベル | 見える人 | 中身 |
|---|---|---|
| `PRIVATE` | 本人のみ | 生の記録。感情・私生活・健康・自由記述・AIとの会話・失敗の内容 |
| `COACH_REVIEW` | JIROKU運営／担当コーチ | 伴走に必要な範囲の記録 |
| `MANAGER_REPORT` | 上司 | 業務に必要な範囲だけを抽出したレポート（生ログではない） |
| `ORG_AGGREGATE` | 組織管理者 | 個人を特定しない集計値 |

**既定は `PRIVATE`。** 上位レベルへ出すものは、その都度「出す」と決めたものだけ。

`MANAGER_REPORT` は既存の「業務報告書を生成する」ボタンを発展させる方針で、
①その日に実施した業務 ②目標に対する進捗 ③成果・完了事項 ④次に行うこと ⑤業務上の課題
を抽出したもの。**目標・タスク・ログの全データを無条件に上司へ渡す実装は作らない。**

Checkpoint 2・3ではこの分類を実装しないが、
「後から公開レベルを差し込めない構造」にしないことだけを守る。

## 認証についての既知の課題

Phase 1 で入れた保護は「新しく足した管理APIを塞ぐ」ところまで。
**既存の全APIは依然としてリクエストのメールを信用している**（`doGet`/`doPost` とも）。
利用者24名の招待制・URL非公開という前提で当面は許容し、
本格的なトークン認証は [[project_jiroku_security_roadmap]] の300人のしきい値で対応する。

### 「リクエスト本人」の実体（2026-07-31 実測）

| 項目 | 実際 |
|---|---|
| 判定を行う関数 | **存在しない**。`requestUser()` 相当のものは無い |
| doGet の取得元 | `e.parameter.studentEmail`（URLのクエリ文字列） |
| doPost の取得元 | `body.studentEmail`（リクエストボディ） |
| `Session.getActiveUser()` | **使っていない**（コード内に1件も無い） |
| ユーザー別トークン | **無い** |

したがって **`p1OwnedRow` は「所有権の確認」ではない**。
「送られてきた文字列と一致する行しか触らせない」だけであり、
その文字列を他人のものに書き換えれば、その人として振る舞える。

**実機で確認した事実（2026-07-31）**:
認証情報を一切持たないクライアント（curl）から `coachGetStudents` を叩き、
`coachEmail` に管理者のアドレスを書いただけで、**在籍する生徒21名の一覧と
メールアドレスを取得できた**。同様に、Phase 1 の目標階層APIについても、
`studentEmail` に管理者のアドレスを書くだけで作成・更新・アーカイブができている
（このセッションの検証はすべてその方法で実施した）。

→ **現時点の Phase 1 API を「所有権確認済み」と表現してはいけない。**
`p1OwnedRow` が防ぐのは「正規の利用者が他人の行を誤って壊すこと」までで、
意図的な偽装は防げない。これは Phase 1 で作り込んだ欠陥ではなく、
アプリ全体の構造的な課題である。

## ID設計の安定性

| ID | 生成タイミング | タイトル等を変えたら |
|---|---|---|
| `log_id` | 記録の新規作成時のみ | 変わらない（既存の仕組み） |
| `task_id` | `migrateLocalTasks` の一度きりの移行時のみ | **変わらない**。以後はシートの値を使い回す |
| `action_execution_id` | email+date+time_block から決定的に生成 | 同じ入力なら常に同じ＝再送しても重複しない |
| `makeUserKey` | メールから決定的に8文字 | 衝突は `p1Status` の `userKeyCollisions` で検出できる |

## 追加で確定した仕様（ChatGPTレビューによる）

1. **boolean目標の達成判定**: 関連ログの存在だけでは達成にしない。**本人が押す「達成」ボタンで status=COMPLETED になった場合のみ** actual_value=1。
2. **同名タスクの移行ID**: `task_{userKey}_{date}_{titleHash}_{occurrenceIndex}`。ランダムIDを使わず、再試行しても同じIDになる。既に同IDがあれば上書きせずスキップ。
