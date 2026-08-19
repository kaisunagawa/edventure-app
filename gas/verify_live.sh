#!/bin/bash
# 公開したものが、本当に利用者へ届く形になっているかを確かめる。
#
# ★なぜ必要か★（2026-08-19 Kai報告「反映されてない」）
#   version.json と index.html は別のファイルなので、片方だけ古い状態が作れる。
#   そうなると、アプリは「新しい版がある」と判断して読み込み直すのに、
#   出てくる中身は古いまま——という終わらないループに入る。
#   デプロイのたびに、公開中の実物を見て突き合わせる。
set -u
BASE="${1:-https://kaisunagawa.github.io/edventure-app}"
fail=0
ok(){ printf "  \033[32m✓\033[0m %s\n" "$1"; }
ng(){ printf "  \033[31m✗\033[0m %s\n" "$1"; fail=1; }

echo "── 公開中の実物を確認（$BASE）──"
T=$(date +%s)
VJ=$(curl -s --max-time 30 "$BASE/version.json?t=$T")
VB=$(echo "$VJ" | sed -n 's/.*"build":"\([^"]*\)".*/\1/p')
[ -n "$VB" ] && ok "version.json = $VB" || { ng "version.json が読めない: $VJ"; exit 1; }

HTML=$(curl -s --max-time 60 "$BASE/index.html?t=$T")
HB=$(echo "$HTML" | sed -n 's/.*const APP_BUILD = "\([^"]*\)".*/\1/p' | head -1)
if [ "$HB" = "$VB" ]; then
  ok "index.html の版も $HB（食い違いなし）"
else
  ng "版が食い違っている: version.json=$VB / index.html=$HB ─ 更新が終わらないループになる"
fi

# ローカルのHEADと公開中が一致しているか（push忘れの検出）
LB=$(sed -n 's/.*const APP_BUILD = "\([^"]*\)".*/\1/p' "$(dirname "$0")/../index.html" | head -1)
if [ "$LB" = "$HB" ]; then
  ok "手元と公開中が同じ版（push漏れなし）"
else
  ng "手元=$LB だが公開中=$HB ─ push がまだ届いていない"
fi

echo
[ "$fail" = "0" ] && echo "公開の確認: 全て合格" || echo "公開の確認: 失敗（利用者にはまだ届いていません）"
exit $fail
