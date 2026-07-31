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

  # 管理APIが鍵チェックを通しているか（チェックを外した状態で出さない）
  for ac in adminSetupPhase1 p1Status; do
    if grep -A3 "case \"${ac}\"" Code.gs | grep -q "verifyP1Admin"; then ok "${ac} は鍵チェックあり"; else ng "${ac} の鍵チェックが無い"; fi
  done
fi

# ── 実機チェック: デプロイ先を実際に叩く（すべて読み取り専用）──
if [ "$MODE" = "live" ] || [ "$MODE" = "all" ]; then
  URL="${2:-}"
  [ -z "$URL" ] && { echo "live には URL が必要です"; exit 2; }
  ADMIN="${SMOKE_ADMIN_EMAIL:-work.sunagawa@gmail.com}"
  SECRET="${P1_ADMIN_SECRET:-}"
  echo "── 実機チェック（${URL:0:60}…）──"

  # 同じURLはGoogle側でキャッシュされるため、毎回ユニークにする
  call() { curl -sL --max-time 90 "${URL}?_=$(date +%s%N)$1"; }

  # 一般APIが ReferenceError や例外で落ちていないこと
  for ac in getUser getLogs getReportList getHomeData; do
    r=$(call "&action=${ac}&studentEmail=${ADMIN}")
    if echo "$r" | grep -q '"ok":true'; then ok "${ac} 正常応答"
    elif echo "$r" | grep -qi "ReferenceError\|TypeError\|is not defined\|is not a function"; then ng "${ac} が例外: $(echo "$r" | head -c 120)"
    else ng "${ac} 異常: $(echo "$r" | head -c 120)"; fi
  done

  # goals_v1 が有効な本人で目標階層が引けること
  r=$(call "&action=getGoalTree&studentEmail=${ADMIN}")
  if echo "$r" | grep -q '"ok":true'; then ok "getGoalTree 正常応答"; else ng "getGoalTree 異常: $(echo "$r" | head -c 120)"; fi

  # 管理APIが鍵なしで確実に閉じること（fail-closed）。
  # ここで ok:true が返ったら重大。ReferenceError も「壊れている」ので不合格にする
  r=$(call "&action=p1Status&studentEmail=${ADMIN}")
  if echo "$r" | grep -q '"ok":false' && ! echo "$r" | grep -qi "ReferenceError\|is not defined"; then
    ok "p1Status は鍵なしで拒否（fail-closed）"
  else ng "p1Status の拒否が異常: $(echo "$r" | head -c 140)"; fi

  # 管理者以外は鍵があっても通らないこと
  if [ -n "$SECRET" ]; then
    r=$(call "&action=p1Status&studentEmail=not-the-owner@example.com&secret=${SECRET}")
    if echo "$r" | grep -q 'not owner'; then ok "管理者以外は鍵があっても拒否"; else ng "管理者以外の拒否が異常: $(echo "$r" | head -c 140)"; fi
    r=$(call "&action=p1Status&studentEmail=${ADMIN}&secret=${SECRET}")
    if echo "$r" | grep -q '"ok":true'; then ok "正しい鍵で管理APIが通る"; else ng "正しい鍵で通らない: $(echo "$r" | head -c 140)"; fi
  else
    echo "  － P1_ADMIN_SECRET 未設定のため鍵ありのテストはスキップ"
  fi

  # goals_v1 が無効な相手には目標階層を開かないこと
  r=$(call "&action=getGoalTree&studentEmail=not-a-user@example.com")
  if echo "$r" | grep -q '"ok":false'; then ok "対象外ユーザーには getGoalTree を返さない"; else ng "対象外ユーザーに応答している: $(echo "$r" | head -c 120)"; fi
fi

echo
if [ "$FAIL" -eq 0 ]; then echo "スモークテスト: 全て合格"; exit 0
else echo "スモークテスト: ${FAIL}件 失敗（本番へ出さないこと）"; exit 1; fi
