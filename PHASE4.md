# Phase 4: Tasksシートへの完全移行 — 残作業と終了条件

2026-08-02 時点。

## 現在の書き込み経路

| 経路 | 誰が使う | 状態 |
|---|---|---|
| TASKS_DIRECT (saveTaskMutations) | 新ビルドの端末 | 本番稼働 |
| JOURNAL_BRIDGE (saveTodayActions→橋渡し) | 旧ビルドの端末 | 互換のため残置 |

計測: `bash gas/ops.sh adminWritePathStats`（日次カウント、直近14日）

## 橋渡し（JOURNAL_BRIDGE）の終了条件 — P1として維持

以下を**すべて**満たしたら停止する:

1. アクティブコホート（直近14日にDailyLogがある利用者）の全端末が新ビルド
   - 判定: Sessions.device_label と last_seen_at、および adminWritePathStats
2. 直近7日間の JOURNAL_BRIDGE 書き込みが 0件
3. 未送信mutation（クライアントキュー滞留）が 0件
4. 旧形式（id無し文字列）の書き込みが 0件
5. 旧形式バックフィル完了 — **済（2026-08-02、107件、migration_id=bf_1785649375285）**
6. ロールバック手順の確認 — バックアップから Tasks シートを復元し、
   `migration_id` 列で backfill 行を特定して削除できる

**目標日: 2026-08-16**（利用者の大半は毎日開くため2週間で全端末が更新される想定）。
それまでに条件1-4が満たされなければ、最低対応ビルド未満へ
更新案内を表示する設計を検討する（外向き通知はKaiの承認必須）。

## Journal.actions の役割（最終形への向き）

- 現在: 画面(旧ビルド)→Journal→Tasks（橋渡し）、新ビルドは並行して両方へ書く
- 最終形: **Tasks が唯一の正**。Journal.actions は Tasks から生成する
  レポート用 projection にする（独立編集しない）
- 移行手順: ①業務レポート生成を Tasks 読みへ切り替え →
  ②新ビルドの saveTodayActions(actions) 送信を停止 → ③橋渡し撤去

## バックフィルの記録

- 実行: 2026-08-02 14:42 JST（直前バックアップ: JIROKU_backup_20260802_1442）
- 対象107件 / conflict 0 / user不明 0 / source重複 0 / 件数一致（4→111）
- ID: `legacy_<sha256(持ち主|Journal行日付|並び位置)の先頭16桁>` — タイトル不使用・再実行冪等
- provenance: migrated_from / source_journal_id / source_action_index / migration_id / migrated_at
- 過去日付・完了状態を保持。ホームは当日分しか表示しないため過去タスクは画面に出ない

## 自己経営指標のデータ範囲（表示時の約束）

- タスクデータが完全なのは **2026-08-02 以降**（直接書き込み開始日）
- それ以前は Journal からの移行分（タイトル・完了状態・日付のみ。
  重要度・期限・想定時間は無い）
- 指標を出すときは coverage_start_date / migrated_task_count /
  unmigrated_task_count / confidence を添え、不足データを0として集計しない
