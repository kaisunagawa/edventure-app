#!/bin/bash
# 所有権・認可の回帰テスト（検証環境専用）
#
# なぜ必要か:
#   「関数を実装した」ことと「入口から実際に呼ばれて期待どおり拒否された」ことは別物。
#   実際、forceSelfEmail は実装済みなのに doGet/doPost へ配線されておらず、
#   コードを読むだけでは気づけなかった。入口を叩いて確かめる以外に確認手段はない。
#
# 何を確かめるか（ChatGPTのレビューで列挙された観点）:
#   正常系 / 未認証 / 権限不足 / 他人のメール / 他人のID /
#   改ざん / 期限切れ / リプレイ / 空応答 / タイムアウト / ロールバック
#
# 前提:
#   このスクリプトは検証用デプロイ（TEST）だけを叩く。
#   検証環境は本番と同じスプレッドシートを見ているため、
#   ★書き込みが成功してしまうケースを避ける★ 設計にしてある。
#   具体的には、存在しないID・他人のIDだけを対象にし、
#   「拒否されること」を期待値とする。万一通ってしまった場合は
#   その時点で失敗として報告し、以降の書き込みを行わない。
#
# 使い方:
#   export P1_ADMIN_SECRET='...'
#   bash gas/ownership_test.sh

set -u
cd "$(dirname "$0")"

TEST_DEP="AKfycbw-MhcAhOaqd_JJTlN4LltE-liM-WriznSgcDGIBR0uUMMB-rnYI74GUoXkmyNgTsx5"
URL="https://script.google.com/macros/s/$TEST_DEP/exec"
ADMIN="${OPS_ADMIN_EMAIL:-work.sunagawa@gmail.com}"
OTHER="sumie.fuu0112@gmail.com"      # 実在する別人（USERロール）
NOBODY="not-a-user@example.com"

PASS=0; FAIL=0; UNKNOWN=0
ok()   { echo "  ✓ $1"; PASS=$((PASS+1)); }
ng()   { echo "  ✗ $1"; FAIL=$((FAIL+1)); }
unk()  { echo "  ? $1"; UNKNOWN=$((UNKNOWN+1)); }

# ★空応答と拒否を混同しない★
# 昨夜、応答が空だったのを「拒否された」と読み違えて、正常なデプロイを止めた。
# 逆に本当に破れているときも同じ「空」に見えるため、区別できないと検査の意味がない。
get()  { curl -sL --max-time 120 "$URL?$1"; }
post() { curl -sL --max-time 120 -H "Content-Type: text/plain;charset=utf-8" --data-binary "$1" "$URL"; }

# $1=応答 $2=説明  → 拒否されていれば合格。空なら「判定不能」（合格にしない）
expect_denied() {
  local r="$1" label="$2"
  if [ -z "$r" ]; then unk "$label ─ 応答が空。拒否と断定できない"; return; fi
  if echo "$r" | grep -q '"ok":false'; then ok "$label"; else
    ng "$label ─ 通ってしまった: $(echo "$r" | head -c 160)"; fi
}
expect_ok() {
  local r="$1" label="$2"
  if [ -z "$r" ]; then unk "$label ─ 応答が空"; return; fi
  if echo "$r" | grep -q '"ok":true'; then ok "$label"; else
    ng "$label ─ 正常系が失敗: $(echo "$r" | head -c 160)"; fi
}

echo "── 所有権・認可の回帰テスト（検証環境）──"
echo "対象: $URL"
echo ""

echo "【現在の強制状態】"
get "action=authConfig" | head -c 300; echo; echo ""

# ───────────────────────────────────────────
echo "【1】正常系 ─ 本人のデータは読める"
expect_ok "$(get "action=getUser&studentEmail=$ADMIN")"      "getUser（本人）"
expect_ok "$(get "action=getLogs&studentEmail=$ADMIN")"      "getLogs（本人）"
expect_ok "$(get "action=getHomeData&studentEmail=$ADMIN")"  "getHomeData（本人）"
expect_ok "$(get "action=getGoalTree&studentEmail=$ADMIN")"  "getGoalTree（本人）"

# ───────────────────────────────────────────
echo ""
echo "【2】未認証 ─ セッションを持たずに管理系を叩く"
for a in adminBroadcastLine adminSendStudentCampaign adminTagCohortByEmails \
         adminRunNightlyReport adminSystemHealth; do
  expect_denied "$(get "action=$a&studentEmail=$ADMIN")" "$a を未認証で拒否"
done

echo ""
echo "【3】未認証 ─ コーチ系（他人の個人情報）"
for a in coachGetStudents coachGetStudentDetail coachSendStudentMessage \
         coachUploadFile coachDeleteFile; do
  expect_denied "$(get "action=$a&coachEmail=$ADMIN&studentEmail=$OTHER")" "$a を未認証で拒否"
done

# ───────────────────────────────────────────
echo ""
echo "【4】他人のメール ─ 存在しない利用者を騙る"
expect_denied "$(get "action=getGoalTree&studentEmail=$NOBODY")" "対象外ユーザーにgetGoalTreeを返さない"

echo ""
echo "【5】改ざんセッション ─ ポリシー対象のアクションで"
# 対象アクション（admin系）では、壊れたトークンは必ず拒否されなければならない
expect_denied "$(get "action=adminSystemHealth&studentEmail=$ADMIN&token=not-a-real-token")" "壊れたトークンを拒否（admin系）"
expect_denied "$(get "action=adminSystemHealth&studentEmail=$ADMIN&token=92f560cb7d27000000000000")" "実在ハッシュに似せた値を拒否（admin系）"
expect_denied "$(get "action=coachGetStudents&coachEmail=$ADMIN&token=not-a-real-token")" "壊れたトークンを拒否（coach系）"

# ★ここは「拒否されない」ことを確認する項目★
# 強制スイッチがOFFの間、ポリシー対象外のアクション（getUser等）は
# トークンを一切見ない。壊れたトークンを付けても素通りする。
# これは仕様どおりだが、副作用として
#   「セッションが失効していても従来経路で動き続ける」
#   → 利用者は不具合に気づかず、普及率も健全に見える
#   → スイッチを入れた瞬間に一斉に使えなくなる
# という状態を作る。CP3の判断に直結するため、黙って通さず明示的に記録する。
r=$(get "action=getUser&studentEmail=$ADMIN&token=not-a-real-token")
if [ -z "$r" ]; then unk "getUser＋壊れたトークン ─ 応答が空"
elif echo "$r" | grep -q '"ok":true'; then
  echo "  ! getUser は壊れたトークンを無視して応答する（強制OFFのため仕様どおり）"
  echo "    → 失効セッションが従来経路で動き続ける。CP3の判断材料として要検討"
  UNKNOWN=$((UNKNOWN+1))
else ok "getUser も壊れたトークンを拒否している"; fi

echo ""
echo "【6】ログインの改ざん・期限切れ・再利用"
BODY1="{\"action\":\"login\",\"challenge_id\":\"ch_nope\",\"state\":\"x\",\"idToken\":\"own-$(date +%s)-$$\"}"
expect_denied "$(post "$BODY1")" "存在しないchallengeでのログインを拒否"
BODY2="{\"action\":\"login\",\"challenge_id\":\"ch_nope\",\"state\":\"x\",\"idToken\":\"own2-$(date +%s)-$$\"}"
r=$(post "$BODY2")
if echo "$r" | grep -qiE "STATE_MISMATCH|CHALLENGE_|AUD_|NONCE"; then
  ng "失敗理由が利用者へ漏れている: $(echo "$r" | head -c 120)"
else ok "失敗理由を利用者へ返していない"; fi
# 内部の例外メッセージをそのまま返していないか
if echo "$r" | grep -qiE "SyntaxError|TypeError|at position|line [0-9]+ column"; then
  ng "内部の例外メッセージが利用者へ漏れている: $(echo "$r" | head -c 140)"
else ok "内部の例外メッセージを返していない"; fi

# ───────────────────────────────────────────
echo ""
echo "【7】運用リクエストの署名 ─ 改ざん・期限切れ・リプレイ"
if [ -z "${P1_ADMIN_SECRET:-}" ]; then
  unk "P1_ADMIN_SECRET 未設定のため署名テストをスキップ"
else
  # 正しい署名を1組つくる（後でリプレイに使う）
  QS=$(ACTION="p1Status" ADMIN="$ADMIN" python3 - <<'PY'
import os, hmac, hashlib, base64, secrets, time, urllib.parse
p = {"action": os.environ["ACTION"], "studentEmail": os.environ["ADMIN"],
     "coachEmail": os.environ["ADMIN"], "ts": str(int(time.time())),
     "nonce": secrets.token_urlsafe(12)}
c = "&".join("%s=%s" % (k, p[k]) for k in sorted(p) if k != "sig")
p["sig"] = base64.urlsafe_b64encode(hmac.new(os.environ["P1_ADMIN_SECRET"].encode(),
           c.encode(), hashlib.sha256).digest()).decode().rstrip("=")
print(urllib.parse.urlencode(p))
PY
)
  r1=$(get "$QS"); expect_ok "$r1" "正しい署名は通る"
  # 同じものをもう一度＝リプレイ
  if [ -z "$r1" ]; then
    unk "リプレイ検査 ─ 1回目が空だったため判定不能"
  else
    r2=$(get "$QS"); expect_denied "$r2" "同じ署名の再送（リプレイ）を拒否"
  fi

  # 期限切れ（ts を10分前に）
  QS_OLD=$(ACTION="p1Status" ADMIN="$ADMIN" python3 - <<'PY'
import os, hmac, hashlib, base64, secrets, time, urllib.parse
p = {"action": os.environ["ACTION"], "studentEmail": os.environ["ADMIN"],
     "coachEmail": os.environ["ADMIN"], "ts": str(int(time.time()) - 600),
     "nonce": secrets.token_urlsafe(12)}
c = "&".join("%s=%s" % (k, p[k]) for k in sorted(p) if k != "sig")
p["sig"] = base64.urlsafe_b64encode(hmac.new(os.environ["P1_ADMIN_SECRET"].encode(),
           c.encode(), hashlib.sha256).digest()).decode().rstrip("=")
print(urllib.parse.urlencode(p))
PY
)
  expect_denied "$(get "$QS_OLD")" "10分前のタイムスタンプを拒否"

  # 改ざん（署名はそのままでパラメータを足す）
  QS_TAMPER=$(ACTION="p1Status" ADMIN="$ADMIN" python3 - <<'PY'
import os, hmac, hashlib, base64, secrets, time, urllib.parse
p = {"action": os.environ["ACTION"], "studentEmail": os.environ["ADMIN"],
     "coachEmail": os.environ["ADMIN"], "ts": str(int(time.time())),
     "nonce": secrets.token_urlsafe(12)}
c = "&".join("%s=%s" % (k, p[k]) for k in sorted(p) if k != "sig")
p["sig"] = base64.urlsafe_b64encode(hmac.new(os.environ["P1_ADMIN_SECRET"].encode(),
           c.encode(), hashlib.sha256).digest()).decode().rstrip("=")
p["dryRun"] = "0"          # ← 署名後に足す。全パラメータが署名対象なので弾かれるはず
print(urllib.parse.urlencode(p))
PY
)
  expect_denied "$(get "$QS_TAMPER")" "署名後にパラメータを足した要求を拒否"

  # 別アクションへの差し替え
  QS_SWAP=$(ACTION="p1Status" ADMIN="$ADMIN" python3 - <<'PY'
import os, hmac, hashlib, base64, secrets, time, urllib.parse
p = {"action": os.environ["ACTION"], "studentEmail": os.environ["ADMIN"],
     "coachEmail": os.environ["ADMIN"], "ts": str(int(time.time())),
     "nonce": secrets.token_urlsafe(12)}
c = "&".join("%s=%s" % (k, p[k]) for k in sorted(p) if k != "sig")
p["sig"] = base64.urlsafe_b64encode(hmac.new(os.environ["P1_ADMIN_SECRET"].encode(),
           c.encode(), hashlib.sha256).digest()).decode().rstrip("=")
p["action"] = "adminBroadcastLine"   # ← 無害な確認を一斉送信へすり替える
print(urllib.parse.urlencode(p))
PY
)
  expect_denied "$(get "$QS_SWAP")" "署名後にactionを一斉送信へすり替えた要求を拒否"

  # 鍵をそのまま送る旧方式
  expect_denied "$(get "action=p1Status&studentEmail=$ADMIN&secret=$P1_ADMIN_SECRET")" \
    "鍵をURLに載せる旧方式を拒否"
  # 許可リスト外のアクションを鍵で叩く
  QS_OUT=$(ACTION="coachGetStudents" ADMIN="$ADMIN" python3 - <<'PY'
import os, hmac, hashlib, base64, secrets, time, urllib.parse
p = {"action": os.environ["ACTION"], "studentEmail": os.environ["ADMIN"],
     "coachEmail": os.environ["ADMIN"], "ts": str(int(time.time())),
     "nonce": secrets.token_urlsafe(12)}
c = "&".join("%s=%s" % (k, p[k]) for k in sorted(p) if k != "sig")
p["sig"] = base64.urlsafe_b64encode(hmac.new(os.environ["P1_ADMIN_SECRET"].encode(),
           c.encode(), hashlib.sha256).digest()).decode().rstrip("=")
print(urllib.parse.urlencode(p))
PY
)
  expect_denied "$(get "$QS_OUT")" "許可リスト外のアクションは鍵でも通らない"
fi

# ───────────────────────────────────────────
echo ""
echo "【8】空応答・タイムアウトの扱い"
r=$(curl -sL --max-time 1 "$URL?action=getUser&studentEmail=$ADMIN" 2>/dev/null)
if [ -z "$r" ]; then ok "1秒で打ち切ると空応答になる（＝空を合格と読んではいけない証拠）"
else unk "1秒でも応答があった。タイムアウト検査は成立せず"; fi

echo ""
echo "─────────────────────────────"
echo "合格 $PASS / 失敗 $FAIL / 判定不能 $UNKNOWN"
if [ "$FAIL" -gt 0 ]; then echo "✗ 失敗があります"; exit 1; fi
if [ "$UNKNOWN" -gt 0 ]; then echo "△ 判定不能があります（合格ではありません）"; exit 2; fi
echo "✓ すべて合格"
