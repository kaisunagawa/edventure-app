#!/bin/bash
# 本番デプロイ前後のスモークテスト。
#
# なぜ必要か（2026-07-31の事故）:
#   置換ミスで verifyP1Admin が破損したまま本番へデプロイした。
#   コードとしては「構文的に正しい別物」になっていたため node --check を通過し、
#   管理APIだけが ReferenceError で落ちる状態が約2分間、本番に出た。
#   構文チェックでは検出できない「関数の欠落・破損」を捕まえるのがこのスクリプトの目的。
#
# 使い方:
#   bash gas/smoke_test.sh static        … デプロイ前。ファイルだけを見る（ネットワーク不要）
#   bash gas/smoke_test.sh live <URL>    … デプロイ後。実際に叩いて確認する（読み取りのみ）
#
# 【重要】live は読み取り専用の操作しか行わない。データを書き換えるテストはしない。

set -u
cd "$(dirname "$0")"
export PATH="$HOME/.local/node-v22.17.0-darwin-arm64/bin:$PATH"

MODE="${1:-static}"
FAIL=0
ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; }
ng()   { printf "  \033[31m✗\033[0m %s\n" "$1"; FAIL=$((FAIL+1)); }

# ── 静的チェック: 必須の関数とアクションが存在するか ──
if [ "$MODE" = "static" ] || [ "$MODE" = "all" ]; then
  echo "── 静的チェック（gas/Code.gs）──"

  if node --check <(sed 's/^/ /' /dev/null) 2>/dev/null; then :; fi
  cp Code.gs /tmp/_smoke_check.js
  if node --check /tmp/_smoke_check.js 2>/dev/null; then ok "構文"; else ng "構文エラー"; fi

  # 定義が1つだけ存在すること。0=欠落、2以上=重複定義（後勝ちで意図しない挙動になる）
  for fn in doGet doPost verifyP1Admin verifyAdmin hasFeature \
            getGoalTree saveGoal saveWeeklyGoal archiveGoalItem \
            p1RequireUser p1OwnedRow p1List p1Upsert \
            effectiveGoals effectiveGoalsText \
            getLogs getReportList getHomeData getUser saveLog \
            appendReportRow nightlyReport migrateLocalTasks; do
    n=$(grep -c "^function ${fn}(" Code.gs)
    if [ "$n" -eq 1 ]; then ok "function ${fn}"; else ng "function ${fn} が ${n} 個（1個であるべき）"; fi
  done

  # doGet/doPost から呼べる状態になっているか（caseの消し忘れ・消しすぎを検出）
  for ac in getUser getLogs getReportList getHomeData getGoalTree p1Status \
            saveGoal saveWeeklyGoal archiveGoalItem saveLog; do
    n=$(grep -c "case \"${ac}\"" Code.gs)
    if [ "$n" -ge 1 ]; then ok "action ${ac}"; else ng "action ${ac} のcaseが無い"; fi
  done

  # 一時的なデバッグ用エンドポイントを消し忘れていないか
  for bad in adminExportSheet adminDumpAll; do
    if grep -q "case \"${bad}\"" Code.gs; then ng "一時エンドポイント ${bad} が残っている"; else ok "一時エンドポイント ${bad} なし"; fi
  done

  # トリガー関数が引数を取る場合、GASはイベントオブジェクトを渡してくる。
  # if (arg) のような真偽判定をすると必ず truthy になり、意図しない分岐に入る。
  # （運営レポートが毎日「dryRun扱い」で捨てられていた実例があるため必ず確認する）
  for fn in $(grep -o 'newTrigger("[a-zA-Z]*"' Code.gs | sed 's/newTrigger("//;s/"//' | sort -u); do
    sig=$(grep "^function ${fn}(" Code.gs | head -1)
    arg=$(printf '%s' "$sig" | sed 's/.*(\(.*\)).*/\1/')
    if [ -n "$arg" ]; then
      first=$(printf '%s' "$arg" | cut -d, -f1 | tr -d ' ')
      if grep -A40 "^function ${fn}(" Code.gs | grep -qE "if \(${first}\)"; then
        ng "トリガー関数 ${fn} が if (${first}) で真偽判定（イベントで必ずtrueになる）"
      else ok "トリガー関数 ${fn} の引数判定"; fi
    fi
  done

  # 管理APIが鍵チェックを通しているか（チェックを外した状態で出さない）
  for ac in adminSetupPhase1 p1Status; do
    if grep -A3 "case \"${ac}\"" Code.gs | grep -q "verifyP1Admin"; then ok "${ac} は鍵チェックあり"; else ng "${ac} の鍵チェックが無い"; fi
  done

  # ── 画面側（index.html / coach/index.html）──
  #
  # ★ここを見ていなかった★
  # 2026-08-01、ログインが両方の画面で壊れたが、このスモークテストは
  # Code.gs しか検査しておらず、まったく気づけなかった。
  # サーバーが健全でもログインできなければ利用者にとっては全停止なので、
  # 画面側の「ログインの骨格」も必ず検査する。
  echo "── 静的チェック（画面側）──"

  extract_js() {  # $1=htmlファイル → 埋め込みスクリプトを取り出す
    python3 - "$1" <<'PY'
import sys
s = open(sys.argv[1]).read()
i = s.index("<script>", 3000)
j = s.rindex("</script>")
sys.stdout.write(s[i+8:j])
PY
  }

  for f in ../index.html ../coach/index.html; do
    name=$(basename "$(dirname "$f")")/$(basename "$f")
    if [ ! -f "$f" ]; then ng "${f} が無い"; continue; fi
    if extract_js "$f" > /tmp/_smoke_front.js 2>/dev/null && node --check /tmp/_smoke_front.js 2>/dev/null; then
      ok "${name} 構文"
    else
      ng "${name} 構文エラー"
    fi
  done

  # Googleの公式ボタンを描画する土台が揃っているか。
  # 「押しても無反応」は原因が見えず、いちばん困る壊れ方なので必ず確認する。
  check_pair() {  # $1=ファイル $2=コンテナid $3=表示名
    if grep -q "id=\"$2\"" "$1" && grep -q "getElementById(\"$2\")" "$1"; then
      ok "$3 公式ボタンの土台（id=$2 の定義と参照が揃っている）"
    else
      ng "$3 公式ボタンの土台が壊れている（id=$2 の定義か参照が無い）"
    fi
    if grep -q "renderButton" "$1"; then ok "$3 renderButton あり"; else ng "$3 renderButton が無い"; fi
    # GISはasync読み込み。待たずに諦めると毎回、予備の経路へ落ちる。
    # ★関数名で探さないこと★
    # 最初は waitForGis|waitGis を探していたが、index.html には別用途の
    # waitForGis が元から存在しており、こちらを消しても検査が通ってしまった
    # （実際に壊して確かめて発覚）。readyかどうかを見ている式そのものを探す。
    if grep -q "accounts?.id?.renderButton" "$1"; then ok "$3 GISの読み込み待ちあり"; else ng "$3 GISの読み込み待ちが無い"; fi
    # htm+Reactでは ref がDOM要素へ渡らない。ボタンの取得にrefを使うと必ずnullになる
    if grep -q "ref=\${btnRef}" "$1"; then ng "$3 ボタン取得にrefを使っている（htmではnullになる）"; else ok "$3 ボタン取得にrefを使っていない"; fi
    if grep -q "accounts.google.com/gsi/client" "$1"; then ok "$3 GISスクリプトの読み込みあり"; else ng "$3 GISスクリプトが読み込まれていない"; fi
  }
  check_pair ../index.html       gsi-btn-app "index.html"
  check_pair ../coach/index.html gsi-btn     "coach"

  # Googleがエラーで返したとき、黙って元の画面に戻さない
  if grep -q 'hash.get("error")' ../index.html; then
    ok "index.html Googleのエラー戻りを表示する"
  else
    ng "index.html Googleのエラー戻りを無視している（無反応に見える）"
  fi

  # 緊急度と4分類の計算（純粋な計算なのでここで確かめられる）
  # ★Code.gs と urgency_test.js は貼り付けで二重管理★
  #   ずれていないかを、定義の一致で機械的に見る
  if node ../gas/urgency_test.js >/dev/null 2>&1 || node urgency_test.js >/dev/null 2>&1; then
    ok "緊急度と4分類の計算"
  else
    ng "緊急度と4分類の計算が期待どおりでない"
  fi
  for fn in computeUrgency classifyTask decorateTask; do
    n=$(grep -c "^function ${fn}(" Code.gs)
    if [ "$n" -eq 1 ]; then ok "function ${fn}"; else ng "function ${fn} が ${n} 個"; fi
  done

  # ★ログイン後の取得はトークンを添えること★
  # SESSION_REQUIRED を入れた際、ログイン直後の getUser がトークン無しで
  # 呼ばれており AUTH_REQUIRED になった。アプリはそれを「利用者が存在しない」と
  # 解釈し、既存利用者へ「はじめまして」の新規登録画面を出した（2026-08-01）。
  # 認証前に呼んでよいのは registerUser だけ。
  bad=$(grep -o 'publicApiRaw("[a-zA-Z]*"' ../index.html | sed 's/publicApiRaw("//;s/"//' | grep -v '^registerUser$' | sort -u | tr '\n' ' ')
  if [ -z "$bad" ]; then
    ok "ログイン後の取得はトークン付き（publicApiRawはregisterUserのみ）"
  else
    ng "認証前の取得が残っている: ${bad}─ 既存利用者が新規扱いになる"
  fi

  # ★画面とサーバーで判定がずれていないか★
  # 緊急度・4分類の規則を、集計用（Code.gs）と表示用（index.html）の
  # 2箇所に書いている。片方だけ直すと「画面は今すぐ、集計は別扱い」に
  # なるが、これは利用者からは絶対に見えない。機械で突き合わせる。
  if python3 build_parity_test.py >/dev/null 2>&1 || python3 ../gas/build_parity_test.py >/dev/null 2>&1; then
    ok "緊急度・4分類が画面とサーバーで一致"
  else
    ng "緊急度・4分類が画面とサーバーでずれている"
  fi

  # ══════════════════════════════════════════
  # ★ログインの出入口チェック★
  #
  # 2026-08-01、ログインを1日に3回壊した。3回とも同じ型だった:
  #   ① コーチCRM  : awaitでポップアップが塞がれた（押しても反応しない）
  #   ② 本体       : Googleのエラー戻りを無視（何も出ない）
  #   ③ 再ログイン : 出す条件だけ書いて消す条件が無い（無限ループ）
  #
  # 共通するのは「入る道は作ったが、出る道を作っていない」こと。
  # そして3つとも、コードを読むだけでは見つからなかった。
  #
  # ここでは「出る道が存在するか」だけを機械的に確かめる。
  # 存在の確認でしかないが、丸ごと消えたことには必ず気づける。
  # ══════════════════════════════════════════
  echo "── ログインの出入口 ──"

  # ③の再発防止: 再ログイン画面へ入る印を立てる箇所があるなら、消す箇所も必ずある
  inn=$(grep -c 'setItem("jiroku_reauth_needed"' ../index.html || true)
  outn=$(grep -c 'removeItem("jiroku_reauth_needed"' ../index.html || true)
  if [ "${inn:-0}" -ge 1 ] && [ "${outn:-0}" -ge 1 ]; then
    ok "再ログイン要求 立てる${inn}/消す${outn}（出る道あり）"
  else
    ng "再ログイン要求 立てる${inn}/消す${outn} ─ ★消す道が無い。ログインしても抜けられない★"
  fi

  # 画面側の状態も戻せること（localStorageを消すだけでは足りない）
  if grep -q 'jiroku:reauth' ../index.html && grep -q 'jiroku:authed' ../index.html; then
    ok "再ログイン画面 出す合図と戻す合図が両方ある"
  else
    ng "再ログイン画面 戻す合図(jiroku:authed)が無い ─ 画面から抜けられなくなる"
  fi

  # セッションを持てたら必ず印を消す（消す場所はここ以外にありえない）
  if awk '/function setSessionToken/,/^}/' ../index.html | grep -q 'jiroku_reauth_needed'; then
    ok "setSessionToken が再ログイン要求を解除している"
  else
    ng "setSessionToken が再ログイン要求を解除していない ─ 無限ループの原因"
  fi

  # ログインの入口は、トークンが無効でも必ず通れること（詰み防止）
  for a in authChallenge login authConfig; do
    if grep -q "${a}: *1" ../gas/Code.gs 2>/dev/null || grep -q "${a}: *1" Code.gs; then
      ok "PUBLIC_ACTIONS に ${a}（失効しても再ログインできる）"
    else
      ng "PUBLIC_ACTIONS に ${a} が無い ─ 失効した人がログインできなくなる"
    fi
  done

  # ★セッショントークンをURLへ載せない（2026-08-01に解消）★
  # クエリのトークンはブラウザ履歴・中間のログ・Googleのアクセスログに残る。
  # GASはヘッダーを読めないため、GETで送る限り回避できない。
  # 読み取りを含めてPOSTのJSON本文へ統一した。1箇所でも戻ったら失敗にする。
  n=$(grep -h 'searchParams\.set("token"' ../index.html ../coach/index.html | grep -vc '^\s*//' || true)
  if [ "${n:-0}" -eq 0 ]; then
    ok "URLクエリのトークン 0箇所"
  else
    ng "URLクエリにトークンを載せる処理が ${n}箇所 復活している"
  fi

  # GAS_URLへのGETが復活していないか（GETだとトークンの置き場所がクエリしか無い）
  g=$(grep -hc "await fetch(url)\|fetch(url)\.then" ../index.html ../coach/index.html | awk '{s+=$1} END{print s}')
  if [ "${g:-0}" -eq 0 ]; then
    ok "GAS_URLへのGET 0箇所（POSTに統一されている）"
  else
    ng "GAS_URLへのGETが ${g}箇所 残っている"
  fi

  # 通信の入口が2つに集約されているか
  for fn in publicApi authedApi; do
    if grep -q "^async function ${fn}(" ../index.html; then ok "通信ラッパー ${fn}"; else ng "通信ラッパー ${fn} が無い"; fi
  done
fi

# ── 実機チェック: デプロイ先を実際に叩く（すべて読み取り専用）──
if [ "$MODE" = "live" ] || [ "$MODE" = "all" ]; then
  URL="${2:-}"
  [ -z "$URL" ] && { echo "live には URL が必要です"; exit 2; }
  ADMIN="${SMOKE_ADMIN_EMAIL:-work.sunagawa@gmail.com}"
  SECRET="${P1_ADMIN_SECRET:-}"
  echo "── 実機チェック（${URL:0:60}…）──"

  # 同じURLはGoogle側でキャッシュされるため、毎回ユニークにする。
  # デプロイ直後は反映待ちで空応答が返ることがあり、そのまま失敗にすると
  # 「壊れていないのにデプロイが止まる」誤検知になるため、空のときだけ2回まで再試行する。
  call() {
    local r
    for _t in 1 2 3; do
      r=$(curl -sL --max-time 120 "${URL}?_=$(date +%s%N)$1")
      [ -n "$r" ] && { printf '%s' "$r"; return 0; }
      sleep 5
    done
    printf '%s' ""
  }

  # 反映待ちのウォームアップ（結果は判定に使わない）
  call "&action=getUser&studentEmail=${SMOKE_ADMIN_EMAIL:-work.sunagawa@gmail.com}" >/dev/null

  # ★期待値は「認証を強制しているかどうか」で変わる★
  # READ必須化や SESSION_REQUIRED を入れると、トークン無しの読み取りは
  # 拒否されるのが正しい。それを「異常」と判定すると、正しく守れているのに
  # デプロイが止まる（2026-08-01、実際にそうなった）。
  # まず1本叩いて現在の姿勢を調べ、全部が同じ姿勢かを確かめる。
  # ★どちらの姿勢でも「例外で落ちている」は必ず不合格★
  probe=$(call "&action=getUser&studentEmail=${ADMIN}")
  if echo "$probe" | grep -q "AUTH_REQUIRED"; then
    ENFORCED=1; echo "  （読み取りは認証必須。トークン無しは拒否されるのが正常）"
  else
    ENFORCED=0
  fi

  for ac in getUser getLogs getReportList getHomeData getGoalTree; do
    r=$(call "&action=${ac}&studentEmail=${ADMIN}")
    if [ -z "$r" ]; then ng "${ac} 応答が空（判定できない）"; continue; fi
    if echo "$r" | grep -qi "ReferenceError\|TypeError\|is not defined\|is not a function"; then
      ng "${ac} が例外: $(echo "$r" | head -c 120)"; continue
    fi
    if [ "$ENFORCED" = "1" ]; then
      if echo "$r" | grep -q "AUTH_REQUIRED"; then ok "${ac} 認証なしを拒否"
      else ng "${ac} 認証必須のはずが通った: $(echo "$r" | head -c 120)"; fi
    else
      if echo "$r" | grep -q '"ok":true'; then ok "${ac} 正常応答"
      else ng "${ac} 異常: $(echo "$r" | head -c 120)"; fi
    fi
  done

  # 管理APIが鍵なしで確実に閉じること（fail-closed）。
  # ここで ok:true が返ったら重大。ReferenceError も「壊れている」ので不合格にする
  r=$(call "&action=p1Status&studentEmail=${ADMIN}")
  if echo "$r" | grep -q '"ok":false' && ! echo "$r" | grep -qi "ReferenceError\|is not defined"; then
    ok "p1Status は鍵なしで拒否（fail-closed）"
  else ng "p1Status の拒否が異常: $(echo "$r" | head -c 140)"; fi

  # 運用リクエストは署名方式で確認する。
  # ★鍵をURLに載せない★（履歴や中間ログに残さないため）
  if [ -n "$SECRET" ]; then
    # 署名付きのクエリを作る（鍵は環境変数でPythonへ渡し、引数には出さない）
    sign() {  # $1=action  $2=studentEmail  [$3=追加パラメータ]
      ACTION="$1" WHO="$2" EXTRA="${3:-}" python3 - <<'PYEOF'
import os, hmac, hashlib, base64, secrets, time, urllib.parse
p = {"action": os.environ["ACTION"], "studentEmail": os.environ["WHO"],
     "coachEmail": os.environ["WHO"], "ts": str(int(time.time())),
     "nonce": secrets.token_urlsafe(12)}
for kv in os.environ.get("EXTRA", "").split():
    if "=" in kv:
        k, v = kv.split("=", 1); p[k] = v
c = "&".join("%s=%s" % (k, p[k]) for k in sorted(p))
p["sig"] = base64.urlsafe_b64encode(hmac.new(
    os.environ["P1_ADMIN_SECRET"].encode(), c.encode(), hashlib.sha256).digest()).decode().rstrip("=")
print(urllib.parse.urlencode(p))
PYEOF
    }
    # 署名付きは毎回nonceが変わるのでキャッシュ回避のパラメータを足せない
    # （足すと署名対象がずれて必ず落ちる）。空応答のときだけ署名を作り直して再試行する。
    # ★空応答を「拒否された」と誤判定しないこと★
    #   以前はこれで「リプレイが通ってしまう」と誤検知し、正常な本番デプロイを止めた
    callSigned() {   # $1=action $2=who [$3=extra]  → 応答を返す。空なら空文字
      local r
      for _t in 1 2 3; do
        r=$(curl -sL --max-time 120 "${URL}?$(sign "$1" "$2" "${3:-}")")
        [ -n "$r" ] && { printf '%s' "$r"; return 0; }
        sleep 5
      done
      printf '%s' ""
    }
    r=$(callSigned p1Status "$ADMIN")
    if [ -z "$r" ]; then ng "署名付きの応答が空（通信不良の可能性）"
    elif echo "$r" | grep -q '"ok":true'; then ok "署名付きで管理APIが通る"
    else ng "署名付きで通らない: $(echo "$r" | head -c 140)"; fi

    r=$(callSigned p1Status not-the-owner@example.com)
    if [ -z "$r" ]; then ng "管理者以外テストの応答が空"
    elif echo "$r" | grep -q '"ok":false'; then ok "管理者以外は署名があっても拒否"
    else ng "管理者以外の拒否が異常: $(echo "$r" | head -c 140)"; fi

    # 同じ署名の使い回し（リプレイ）が拒否されること。
    # 1回目が実際に通ったことを確認してから2回目を試す（前提が崩れた状態で判定しない）
    Q=$(sign p1Status "$ADMIN")
    first=$(curl -sL --max-time 120 "${URL}?$Q")
    if ! echo "$first" | grep -q '"ok":true'; then
      ng "リプレイ検査の前提が崩れた（1回目が通らない）: $(echo "$first" | head -c 100)"
    else
      second=$(curl -sL --max-time 120 "${URL}?$Q")
      if [ -z "$second" ]; then ng "リプレイ検査の2回目が空応答（判定不能）"
      elif echo "$second" | grep -q '"ok":false'; then ok "署名の使い回しを拒否"
      else ng "リプレイが通ってしまう: $(echo "$second" | head -c 140)"; fi
    fi
  else
    echo "  － P1_ADMIN_SECRET 未設定のため運用リクエストのテストはスキップ"
  fi

  # ── 認証（Auth CP1 / Production Gate 1.5）──
  r=$(call "&action=authConfig")
  MODE=$(printf '%s' "$r" | sed -n 's/.*"auth_mode":"\([A-Z_]*\)".*/\1/p')
  ENVN=$(printf '%s' "$r" | sed -n 's/.*"environment":"\([A-Z]*\)".*/\1/p')
  if [ -n "$MODE" ]; then ok "auth_mode = ${MODE} (${ENVN})"; else ng "authConfig が auth_mode を返さない: $(echo "$r" | head -c 120)"; fi
  if [ -n "${EXPECT_AUTH_MODE:-}" ]; then
    [ "$MODE" = "$EXPECT_AUTH_MODE" ] && ok "auth_mode が期待値と一致" || ng "auth_mode が期待値と不一致（期待 ${EXPECT_AUTH_MODE} / 実際 ${MODE}）"
  fi

  # 認証まわりの拒否（いずれも書き込みは発生しない）
  post() { curl -sL --max-time 120 -H "Content-Type: text/plain;charset=utf-8" --data-binary "$1" "$URL"; }
  # ★毎回ちがうダミーを使う★
  # 固定文字列だと指紋が毎回同じになり、レート制限のカウンタが積み上がって
  # 監査ログが FP_RATE_LIMIT で埋まる。「直近24時間に未解決のログイン失敗が無いこと」を
  # 切り替え条件にしているので、テスト自身がその条件を壊してしまう。
  r=$(post "{\"action\":\"login\",\"challenge_id\":\"ch_nope\",\"state\":\"x\",\"idToken\":\"smoke-$(date +%s)-$$\"}")
  echo "$r" | grep -q '"ok":false' && ok "存在しないchallengeを拒否" || ng "challenge拒否が異常: $(echo "$r"|head -c 100)"
  echo "$r" | grep -qi "STATE_MISMATCH\|CHALLENGE\|reason" && ng "失敗理由が利用者へ漏れている" || ok "失敗理由を利用者へ返していない"

  # 拒否の返し方は2種類ある。どちらも「拒否」であり、どちらでも合格。
  #   AUTH_REQUIRED  … 認可の段階で弾いた
  #   SESSION_INVALID … トークンが付いているのに無効だったので入口で弾いた
  # ★空応答は合格にしない★（拒否と区別がつかなくなる）
  r=$(post '{"action":"authWhoAmI","token":"tampered-session-token-xxxx"}')
  if [ -z "$r" ]; then ng "改ざんセッション ─ 応答が空。拒否と断定できない"
  elif echo "$r" | grep -qE "AUTH_REQUIRED|SESSION_INVALID"; then ok "改ざんセッションを拒否"
  else ng "改ざんセッションの拒否が異常: $(echo "$r" | head -c 100)"; fi

  r=$(post '{"action":"authWhoAmI"}')
  echo "$r" | grep -q "AUTH_REQUIRED" && ok "トークン無しを拒否" || ng "トークン無しの拒否が異常"

  # 検証環境が認証回避経路になっていないこと
  if [ "$ENVN" = "TEST" ]; then
    grep -q 'TEST_ENV_ADMIN_ONLY' Code.gs && ok "検証環境のログインは管理者限定" || ng "検証環境が一般に開いている"
  fi

  # goals_v1 が無効な相手には目標階層を開かないこと
  r=$(call "&action=getGoalTree&studentEmail=not-a-user@example.com")
  if echo "$r" | grep -q '"ok":false'; then ok "対象外ユーザーには getGoalTree を返さない"; else ng "対象外ユーザーに応答している: $(echo "$r" | head -c 120)"; fi
fi

echo
if [ "$FAIL" -eq 0 ]; then echo "スモークテスト: 全て合格"; exit 0
else echo "スモークテスト: ${FAIL}件 失敗（本番へ出さないこと）"; exit 1; fi
