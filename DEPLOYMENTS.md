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
