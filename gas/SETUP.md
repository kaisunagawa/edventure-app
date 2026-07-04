# GAS セットアップ手順

## 1. スクリプトエディタを開く

スプレッドシート（ID: `1EbGxrI6e-rmzgDk4jczOX1RfHIYY-6Q1jOPpr5Hybqc`）を開き、
「拡張機能」→「Apps Script」を選択。

## 2. コードを貼り付ける

`Code.gs` の内容を全コピーして、エディタに貼り付けて保存（Ctrl+S）。

## 3. スクリプトプロパティを設定する

「プロジェクトの設定」→「スクリプトのプロパティ」で以下を追加：

| プロパティ名           | 値                                          | 必須/任意 |
|-----------------------|---------------------------------------------|-----------|
| `CLAUDE_API_KEY`      | AnthropicのAPIキー                          | 必須（レポート生成・AIコーチ・コーチCRMのAI機能に使用） |
| `LINE_CHANNEL_TOKEN`  | LINE Messaging APIのチャネルアクセストークン | 必須（生徒への自動メッセージ送信） |
| `ADMIN_EMAIL`         | 管理者ダッシュボードを見られるGoogleアカウントのメールアドレス | 必須（コーチCRMの管理者ダッシュボード用） |
| `STRIPE_SECRET_KEY`   | Stripeの制限付きキー（読み取り専用推奨）     | 任意（生徒ごとの累計支払額の把握機能に使用。未設定でも他機能は動く） |
| `CHATWORK_API_TOKEN`  | Chatworkの個人APIトークン                    | 任意（Chatworkの連絡先取り込み・メッセージ連携機能に使用） |

## 4. Webアプリとしてデプロイ

「デプロイ」→「新しいデプロイ」→「種類：ウェブアプリ」

| 設定項目              | 値                                  |
|----------------------|-------------------------------------|
| 実行するユーザー      | 自分（スプレッドシートにアクセスするため） |
| アクセスできるユーザー | 全員（認証なしでアクセス可能）        |

→ デプロイ → URLをコピー

コードを更新するたびに、GASエディタで**同じ手順で貼り替えて保存**するだけで、
既存のデプロイURLはそのまま反映される（デプロイURL自体の再発行は不要）。

## 5. フロントエンドに接続

`index.html`（生徒用アプリ）と `coach/index.html`（コーチCRM）、両方の先頭にある
`GAS_URL` に同じURLを貼り付ける：

```js
const GAS_URL = "https://script.google.com/macros/s/XXXXX/exec";
```

## 6. シートを初期化する

GASエディタで `setupSheets` 関数を選択して「実行」ボタンを押す。
必要なシート（Users, DailyLog, Reports, CoachingNotes, StudentProfile,
ContractFiles, ChatworkMessages など）が存在しなければ自動作成される。
既存のシートに後から追加された列がある場合も、対象シートを次に読み込んだ
タイミングで自動的に列が補完される（StudentProfileは特に自己修復ロジックあり）。

## 7. トリガーをセットアップする

GASエディタで `setupTriggers` 関数を選択して「実行」ボタンを押す。
カレンダーへのアクセス許可が求められたら承認する。

**注意:** `setupTriggers` は実行するたびに既存のトリガーを全て削除してから
再作成する。他に手動で追加したトリガーがあれば消えるので、その場合は
`setupTriggers` 内のリストに追記してから実行すること。

これで以下が自動化される（2026-07時点で計8個のトリガー）：

| トリガー | タイミング | 内容 |
|---|---|---|
| `morningScheduleNotify` | 毎朝7時 | Googleカレンダー予定 → LINE通知 |
| `hourlyReminder` | 毎時0分 | ログ入力リマインダー → LINE通知 |
| `checkTimerQueue` | 毎分 | タイマー完了チェック |
| `nightlyReport` | 毎晩21時 | Claude APIでスコア生成 → スプレッドシート保存 → LINE通知 |
| `nightlyCoachMessage` | 毎晩22時 | AIコーチからのメッセージ送信 |
| `generateMonthlySummaries` | 毎月1日3時 | 月次サマリー生成 |
| `syncStripeTotals` | 毎日4時 | 生徒ごとのStripe累計支払額を同期 |
| `syncChatworkMessages` | 毎時0分 | Chatworkメッセージを同期 |

## 8. コーチCRM（coach/index.html）を使う

- `coach/index.html` はGitHub Pagesなどでホストし、コーチはGoogleアカウントで
  ログインする。ログインできるのは `Coaches` シートに `coach_email` が
  登録されているアカウントのみ。
- `ADMIN_EMAIL` に設定したアカウント（かつ `Coaches` シートにも登録済み）で
  ログインすると「管理者ダッシュボード」が追加で表示される。

## 注意点

- GASのWebアプリはCORSを自動でつけないため、フロントエンドから直接呼ぶ場合は
  `mode: 'no-cors'` が必要になることがあります。
  その場合はGAS側でリダイレクトを使うか、フロントをGASと同じドメイン（Pages等）で
  ホストするか検討してください。
- スプレッドシートのシート名・カラム名は既存の構成と完全一致させてください
  （StudentProfileシートは自己修復するが、他のシートは非対応）。
- GASエディタでコードを貼り替えた後は、必ず保存すること。フロントエンド
  （GitHub Pages）側の変更とは別に反映させる必要がある。
