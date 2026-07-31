#!/bin/bash
# 運用コマンドを「署名付き」で叩くためのヘルパー。
#
# なぜ必要か:
#   以前は共有シークレットをそのままURLに載せていた。GETだとブラウザ履歴や
#   中間のログに鍵が残るうえ、有効期限もリプレイ対策も無かった。
#   このスクリプトは鍵を送らず、鍵で作った「署名」だけを送る。
#
#   署名対象 = sig を除く全パラメータを key=value でキー順に & 連結したもの
#   sig      = HMAC-SHA256(P1_ADMIN_SECRET, 署名対象) を base64url 化
#   ts       = 現在時刻（秒）。5分を過ぎると無効
#   nonce    = 一度きり。使い回すと拒否される
#
# 使い方:
#   export P1_ADMIN_SECRET='...'
#   bash gas/ops.sh p1Status
#   bash gas/ops.sh adminOpsHealthCheck dryRun=1
#   bash gas/ops.sh authSetEnforce kind=WRITE on=1
#   TARGET=test bash gas/ops.sh p1Status        # 検証環境へ
#
# ★鍵はコマンドライン引数に書かないこと★（環境変数で渡す。履歴に残さないため）

set -u
PROD="AKfycbzJ-QEpPVnmp-LFU5Jxww4VFP1qaseMtwCrzKxAA6ZULr1y3h_UeKzVdhHnl5ze57U"
TEST="AKfycbw-MhcAhOaqd_JJTlN4LltE-liM-WriznSgcDGIBR0uUMMB-rnYI74GUoXkmyNgTsx5"
DEP="$PROD"; [ "${TARGET:-prod}" = "test" ] && DEP="$TEST"
ADMIN="${OPS_ADMIN_EMAIL:-work.sunagawa@gmail.com}"

if [ -z "${P1_ADMIN_SECRET:-}" ]; then
  echo "P1_ADMIN_SECRET が未設定です。export してから実行してください" >&2; exit 2
fi
ACTION="${1:-}"
if [ -z "$ACTION" ]; then
  echo "使い方: bash gas/ops.sh <action> [key=value ...]" >&2; exit 2
fi
shift

# パラメータを組み立てて署名する（Pythonに任せる。鍵は環境変数で渡し、引数には出さない）
QS=$(ACTION="$ACTION" ADMIN="$ADMIN" EXTRA="$*" python3 - <<'PY'
import os, hmac, hashlib, base64, secrets, time, urllib.parse
params = {
    "action": os.environ["ACTION"],
    "studentEmail": os.environ["ADMIN"],
    "coachEmail": os.environ["ADMIN"],
    "ts": str(int(time.time())),
    "nonce": secrets.token_urlsafe(12),
}
for kv in os.environ.get("EXTRA", "").split():
    if "=" in kv:
        k, v = kv.split("=", 1)
        params[k] = v
canonical = "&".join("%s=%s" % (k, params[k]) for k in sorted(params) if k != "sig")
sig = base64.urlsafe_b64encode(
    hmac.new(os.environ["P1_ADMIN_SECRET"].encode(), canonical.encode(), hashlib.sha256).digest()
).decode().rstrip("=")
params["sig"] = sig
print(urllib.parse.urlencode(params))
PY
)
[ -z "$QS" ] && { echo "署名の生成に失敗しました" >&2; exit 1; }

curl -sL --max-time 240 "https://script.google.com/macros/s/$DEP/exec?$QS"
echo
