# デプロイ棚卸し記録（2026-07-31）

## 削除前（9個）
```
Found 9 deployments.
- AKfycbzzV75KfztQpl8UP7B7-hXldM0K6henj0n63cfFB2g @HEAD 
- AKfycbz53wJDGCta1TZwHvLVYZgMOGmjdmIZKiSzSORr5XAjhaesh81xatcpyzn572DzrvIE @1 
- AKfycbz2tlHyh_DM_5_zhOyVOaGfshq_WrHgWT-zBbvoGBtiNbIu0eOxJM3csgya7eWxLIdo @13 
- AKfycbyZhwsmxhd1QMI3QsnPcG2hFdeuXZvsKKgn5bOJczD_bpLPihlhlF6Z9LL3_L9xx55r @6 
- AKfycbw-MhcAhOaqd_JJTlN4LltE-liM-WriznSgcDGIBR0uUMMB-rnYI74GUoXkmyNgTsx5 @368 - test: 運営レポートが届かない不具合の修正（トリガー引数）
- AKfycbz-Sd_0RHWjm_mUq6U24HC51l7LRnhID1mGNAxzSZ6Gfix9cjwiKiFfr5Kg8oh6eu0- @10 
- AKfycbwfjZUrPHtCW0tNrqkTHpCXKDGCZUYmEWvc82ARkM9qkIFxZnK4bdhMYwkdlcDAFn0x @4 
- AKfycbwJF8k3vRpJq5vd8_gX_GkJmG4bZJMbw06vRA4vRD2uhXaAWswJxt_8NLGL-tmv_Por @18 
- AKfycbzJ-QEpPVnmp-LFU5Jxww4VFP1qaseMtwCrzKxAA6ZULr1y3h_UeKzVdhHnl5ze57U @369 - 運営レポートが届かない不具合の修正（トリガー引数）
```

## 削除した6個
いずれも古いコードのまま生きており、**認証なしで応答することを実測で確認**したうえで削除した。
コード（index.html / coach/index.html / sw.js）からの参照はゼロ。
git履歴では @10 のIDが過去にコーチCRMで使われていたが、コーチは1名のため再読み込みで解決する。

| バージョン | 削除 |
|---|---|
| @1 | 済 |
| @13 | 済 |
| @6 | 済 |
| @10 | 済 |
| @4 | 済 |
| @18 | 済 |

## 削除後（3個）
```
Found 3 deployments.
- AKfycbzzV75KfztQpl8UP7B7-hXldM0K6henj0n63cfFB2g @HEAD 
- AKfycbw-MhcAhOaqd_JJTlN4LltE-liM-WriznSgcDGIBR0uUMMB-rnYI74GUoXkmyNgTsx5 @368 - test: 運営レポートが届かない不具合の修正（トリガー引数）
- AKfycbzJ-QEpPVnmp-LFU5Jxww4VFP1qaseMtwCrzKxAA6ZULr1y3h_UeKzVdhHnl5ze57U @369 - 運営レポートが届かない不具合の修正（トリガー引数）
```

- 本番 … index.html / coach/index.html が参照。変更しない
- テスト用 … push_gas.sh のデプロイ前検証で使う
- @HEAD … GASの仕様で削除不可。ただし /exec はエラーページを返すのみで、APIとしては開いていない（実測）

## 今後のルール
- デプロイは本番とテスト用の2つだけを使い回す（clasp deploy -i で上書き）
- `clasp deploy` を引数なしで実行すると新しいURLが増えるので使わない
- 認証導入時はテスト用デプロイにも同じ認証を適用する（素通しの入口を残さない）

---

## ★バージョン数の上限（2026-07-31に到達）

**GASは1プロジェクトあたり200バージョンまでしか持てない。** `clasp deploy` は
毎回新しいバージョンを作るため、上限に達すると**新しいコードを本番へ出せなくなる**。

### 到達したときの症状

```
Cannot create more versions: Script has reached the limit of 200 versions.
```

**終了コードが0のまま返ることがある。** そのため「デプロイした」と思い込んだまま
本番が古いバージョンのままになる事故が起きた（2026-07-31）。
`gas/push_gas.sh` の `deploy_or_die` で、`Deployed` の文字が出なければ
明示的に失敗させるようにしてある。

### 回避方法

既に必要なコードを含むバージョンがあるなら、新規作成せずそこへ向け直す:

```bash
clasp deploy -i <デプロイID> -V <既存の版番号>
```

### 恒久対応（未実施・Kaiの操作が必要）

Apps Scriptエディタの**「プロジェクトの履歴」から古いバージョンを削除**する。
これはコマンドラインからは操作できない。

### 今後の運用

- **1回の変更で2つのバージョンを作らない。** 検証用と本番で同じ版番号を使い回す
  （`clasp deploy -i <本番> -V <検証で使った版>`）
- 細かい修正のたびにデプロイせず、まとめてから出す
- 残りバージョン数を意識する。上限が近づいたら先に履歴を整理する

## デプロイ前の必須確認

**「デプロイした」と報告する前に、必ず本番URLを実際に叩いて確認する。**
コマンドの成功メッセージだけを根拠にしない（上記のとおり嘘をつくことがある）。

```bash
curl -sL "https://script.google.com/macros/s/<本番ID>/exec?action=authConfig&_=$(date +%s)"
```

---

## 運用コマンドの叩き方（2026-08-01 以降）

**鍵をURLに載せない。** 署名だけを送る。

```bash
export P1_ADMIN_SECRET='...'        # 履歴に残さないよう、環境変数で渡す
bash gas/ops.sh p1Status
bash gas/ops.sh adminOpsHealthCheck dryRun=1
bash gas/ops.sh authSetEnforce kind=WRITE on=1
TARGET=test bash gas/ops.sh p1Status   # 検証環境へ
```

### なぜ変えたか

以前は `?action=...&secret=xxxxx` と鍵をそのままURLに載せていた。

| 弱点 | 旧 | 新 |
|---|---|---|
| 鍵がURLに残る（履歴・中間ログ） | ❌ | ✅ 鍵は一度も送らない |
| 有効期限 | ❌ なし | ✅ 5分 |
| リプレイ | ❌ 傍受すれば何度でも | ✅ nonce で一度きり |
| パラメータの改ざん | ❌ 自由に変えられる | ✅ 全パラメータが署名対象 |

最後が重要。`dryRun=1` を付けた無害な確認コマンドを傍受しても、
それを外して本送信に変えることはできない。1文字でも変えれば署名が合わない。

### 署名の作り方

```
署名対象 = sig を除く全パラメータを key=value でキー順に & 連結
sig      = HMAC-SHA256(P1_ADMIN_SECRET, 署名対象) を base64url 化（末尾の = は削る）
ts       = 現在時刻（秒）
nonce    = 毎回ランダム
```

### 実行できる操作

`ADMIN_SECRET_ALLOWLIST` に載っている29件のみ（状態確認・定期処理の手動実行・
補完・一斉送信・セットアップ）。顧客情報の閲覧や編集、ファイル操作は**通らない**。
それらはブラウザでKaiのセッションを使うこと。

### 旧方式について

移行期のため当面は受け付けるが、監査ログに `via_admin_secret_LEGACY` と印が付く。
`authAuditTail` でこの印を検索し、ゼロになったら旧方式を削除する。
