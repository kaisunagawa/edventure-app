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

  extract_js() {  # $1=htmlファイル → 埋め込みスクリプト（src無し）を全部つなげて取り出す
    # 以前は「最初の<script>から最後の</script>まで」を切り出していたが、
    # 途中にHTMLや別のscriptがあると構文エラーに見えてしまうため、
    # インラインのスクリプトだけを1つずつ拾って連結する
    python3 - "$1" <<'PYX'
import sys, re
s = open(sys.argv[1]).read()
out = []
for m in re.finditer(r"<script([^>]*)>(.*?)</script" + ">", s, re.S | re.I):
    attrs, body = m.group(1), m.group(2)
    if "src=" in attrs.lower():
        continue
    if len(body.strip()) < 40:
        continue
    out.append("(function(){" + body + "\n})();")
sys.stdout.write("\n".join(out))
PYX
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

  # ★画面とサーバーで同じでなければならない定義★
  #   レベルのしきい値は両方に持っている。片方だけ配信すると、
  #   サーバーは古い区切りでレベルを返し、画面は新しい区切りで階級を出す。
  #   「コンシステントのはずがチャレンジャー」になった（2026-08-05）。
  if (cd .. && python3 .preview/check_shared.py >/tmp/_smoke_shared.txt 2>&1); then
    ok "画面とサーバーの定義が一致"
  else
    ng "$(grep '✗' /tmp/_smoke_shared.txt | head -1)"
  fi

  # ★描画時に評価される依存配列の順番★
  #   useEffect の [x] は描画のたびにその場で評価されるので、xの宣言より前に
  #   書くと "Cannot access 'x' before initialization" で画面が真っ赤になる。
  #   構文としては正しいので node --check では見つからない（実際に本番で発生）。
  if (cd .. && python3 .preview/check_deps.py >/tmp/_smoke_deps.txt 2>&1); then
    ok "依存配列の順番"
  else
    ng "$(sed -n '2p' /tmp/_smoke_deps.txt)"
  fi

  # ★別の関数の中の定数を、外から参照していないか★
  #   2026-08-05、設定画面のローカル RANK_RULES を攻略本から参照して
  #   「攻略本を開くと落ちる」を本番で出した。構文は正しいので検出できなかった。
  if (cd .. && python3 .preview/check_scope.py >/tmp/_smoke_scope.txt 2>&1); then
    ok "定数が見える場所にある"
  else
    ng "$(sed -n '2p' /tmp/_smoke_scope.txt)"
  fi

  # ★運用コマンドが ops.sh から呼べるか★
  #   admin* は fail-closed。許可リストに載せ忘れると AUTH_REQUIRED で弾かれ、
  #   デプロイし直しになる（2026-08-05に3つ載せ忘れた）。
  if (cd .. && python3 .preview/check_ops_allowlist.py >/tmp/_smoke_allow.txt 2>&1); then
    ok "運用コマンドが許可リストにある"
  else
    ng "$(sed -n '2p' /tmp/_smoke_allow.txt)"
  fi

  # ★渡している値が、その場所にあるか★
  #   2026-08-05、App には無い game を SettingsScreen に渡してしまい、
  #   本番で "Can't find variable: game" が出てアプリ全体が開かなくなった。
  #   構文は正しく、依存配列の検査も通ってしまう種類のバグ。
  if (cd .. && python3 .preview/check_props.py >/tmp/_smoke_props.txt 2>&1); then
    ok "受け渡している値が存在する"
  else
    ng "$(sed -n '2p' /tmp/_smoke_props.txt)"
  fi

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

  # ★本番のコピーを作らない★
  # 2026-08-01、preview/index.html へコピーしてから push する手順を続け、
  # 「検証用にだけ出した」と報告していたが、コピー元の index.html が本番であり、
  # git add -A で両方が公開されていた。preview は検証の場ではなく本番のコピーで、
  # 報告の前提が崩れていた。コピー方式そのものをやめる（DEPLOY.md 参照）。
  if [ -d ../preview ]; then
    ng "preview/ が復活している ─ 本番のコピーになる。ブランチで分けること"
  else
    ok "本番のコピー置き場が無い"
  fi

  # ★registerUser で新規のUsers行を作れないこと★
  # 2026-08-01の監査で、curl 1本で任意のメールの有効な利用者を作れた。
  # 招待制なので「登録で行を作る」経路は存在してはいけない。
  if grep -q 'function registerUser' Code.gs && \
     awk '/^function registerUser/,/^}/' Code.gs | grep -q 'verifySession'; then
    ok "registerUser はセッション必須"
  else
    ng "registerUser がセッション無しで通る ─ 誰でも利用者を作れる"
  fi
  if awk '/^function registerUser/,/^}/' Code.gs | grep -q 'appendRow\|insertRow'; then
    ng "registerUser が新規行を作れる ─ 招待制に反する"
  else
    ok "registerUser は新規行を作らない（更新のみ）"
  fi
  if grep -q 'registerUser: 1' Code.gs; then
    ng "registerUser が認証免除リストに残っている"
  else
    ok "registerUser は認証免除リストに無い"
  fi

  # ★ログイン後の取得はトークンを添えること★
  # SESSION_REQUIRED を入れた際、ログイン直後の getUser がトークン無しで
  # 呼ばれており AUTH_REQUIRED になった。アプリはそれを「利用者が存在しない」と
  # 解釈し、既存利用者へ「はじめまして」の新規登録画面を出した（2026-08-01）。
  # 認証前に呼んでよいのは registerUser だけ。
  # ★認証前に呼べる道具は残さない★（2026-08-01 招待制に合わせて厳格化）
  #   当初は registerUser だけ例外にしていたが、招待制では
  #   「登録で行を作る」必要が無く、registerUser もセッション必須にした。
  #   よって認証前に呼ぶものは1つも無い。関数ごと削除してある。
  bad=$(grep -o 'publicApiRaw("[a-zA-Z]*"' ../index.html | sed 's/publicApiRaw("//;s/"//' | sort -u | tr '\n' ' ')
  if [ -z "$bad" ] && ! grep -q 'function publicApiRaw' ../index.html; then
    ok "認証前に呼べる通信の道具が無い"
  elif [ -n "$bad" ]; then
    ng "認証前の取得が残っている: ${bad}─ 既存利用者が新規扱いになる"
  else
    ng "publicApiRaw が未使用のまま残っている ─ 認証なしで呼べる道具を残さない"
  fi

  # ★保存形式を変えたのに、読む側が文字列前提のまま残っていないか★
  # Phase 1 で actions を [{id,title}] にしたが、業務レポート生成が
  # 文字列前提のままで、text にオブジェクトが入っていた（実際に混入）。
  # localStorage から actions を読む箇所は、必ず normalizeTaskList を通す。
  bad=$(grep -n 'getItem("jiroku_custom_actions_' ../index.html | grep -v setItem | grep -v removeItem | wc -l | tr -d " ")
  norm=$(grep -A3 'getItem("jiroku_custom_actions_' ../index.html | grep -c "normalizeTaskList" || true)
  if [ "${norm:-0}" -ge 2 ]; then
    ok "actions を読む箇所が正規化を通っている"
  else
    ng "actions を文字列前提で読んでいる箇所がある（${bad}箇所中 ${norm} だけ正規化）"
  fi

  # タスク一覧の統合（端末ごとに別々のタスクを持っていても混ざるか）
  if python3 build_merge_test.py >/dev/null 2>&1 || python3 ../gas/build_merge_test.py >/dev/null 2>&1; then
    ok "タスク一覧の統合（端末をまたいで混ざる）"
  else
    ng "タスク一覧が統合されない ─ 端末ごとに別々のタスクになる"
  fi

  # ★レポートの採点が「ありえない点」を出さないこと★（2026-08-10）
  #   1件の記録で71点が出ていた。割合で出す項目が件数1件でも満点になるため。
  #   実際の採点関数をそのまま動かして確かめる。
  if python3 build_score_test.py >/dev/null 2>&1 || python3 ../gas/build_score_test.py >/dev/null 2>&1; then
    ok "レポートの採点（1件で高得点にならない・0件は0点）"
  else
    ng "レポートの採点がおかしい ─ python3 gas/build_score_test.py で内訳が見られます"
  fi

  # ★設定の受け取りが「端末にタスクが無いとき」に閉じ込められていないこと★
  # 取り込み処理をその条件の中に入れていたため、既にタスクがある端末では
  # 一度も動かなかった。PCにはタスクがあるので設定が永久に届かなかった。
  # いまは一覧も統合方式にしたので、その条件自体を使っていない。
  if python3 -c "
import sys
s=open('../index.html').read()
i=s.index('if(d.todayActions){')
seg=s[i:i+4500]
closed = 'jiroku_custom_actions_\"+todayStr) === null' in seg
sys.exit(1 if closed else 0)
" 2>/dev/null; then
    ok "設定・一覧とも「端末に無いときだけ」の条件に閉じ込められていない"
  else
    ng "「端末にタスクが無いとき」の条件が残っている ─ 既存端末に届かない"
  fi

  # ★設定を変えたらサーバーへ送ること★
  # 重要度・期限・想定時間・メモは localStorage に書くだけで、
  # タスクの追加や編集をしたついでにしか送られていなかった。
  # 設定だけ変えても他の端末に届かない（Kaiの指摘で判明）。
  if python3 -c "
import sys
s=open('../index.html').read()
missing=[]
for n in ['setTaskImp','setTaskDueAt','setTaskTime','setTaskNote']:
    i=s.find('const '+n+' = ')
    if i<0: missing.append(n+'(無い)'); continue
    j=s.index(chr(10)+'  };', i)
    if 'pushTaskMeta' not in s[i:j]: missing.append(n)
print(','.join(missing))
sys.exit(1 if missing else 0)
" 2>/dev/null; then
    ok "設定変更がサーバーへ送られる（重要度・期限・想定時間・メモ）"
  else
    ng "設定を変えてもサーバーへ送っていない ─ 端末間で食い違う"
  fi

  # ★index.html を変えたら APP_BUILD も変える★
  # 変え忘れると、利用者の端末は古い版のまま更新されない。
  # 実際、更新検知が「サーバーの版と自分自身」を比べる作りになっており、
  # 古い版で動いていても差が出ず、変更が永久に届かなかった。
  if git -C .. diff --quiet HEAD -- index.html 2>/dev/null; then
    if grep -q '^const APP_BUILD = "' ../index.html; then
      ok "APP_BUILD あり（index.html に変更なし）"
    else
      ng "APP_BUILD が無い ─ 更新検知が働かない"
    fi
  else
    # ★行頭に固定する★ 更新検知のコード内にある正規表現の文字列
    #   /const APP_BUILD = "([^"]+)"/ にも一致してしまい、
    #   宣言を消しても値が取れて検査が素通りしていた
    cur=$(grep -o '^const APP_BUILD = "[^"]*"' ../index.html | head -1)
    prev=$(git -C .. show HEAD:index.html 2>/dev/null | grep -o '^const APP_BUILD = "[^"]*"' | head -1)
    if [ -z "$cur" ]; then
      ng "APP_BUILD が無い ─ 更新検知が働かず、端末は古い版のままになる"
    elif [ "$cur" = "$prev" ]; then
      ng "index.html を変えたのに APP_BUILD が同じ ─ 端末に更新が届かない"
    else
      ok "APP_BUILD を更新済み"
    fi
  fi

  # ★version.json と APP_BUILD は必ず同じ値★（2026-08-05）
  #   更新の検知は version.json（数十バイト）を見るようにした。
  #   ここがずれると「更新が届かない」か「毎回リロードし続ける」のどちらかになる。
  build_html=$(grep -o '^const APP_BUILD = "[^"]*"' ../index.html | head -1 | sed 's/.*"\(.*\)"/\1/')
  build_json=$(grep -o '"build"[[:space:]]*:[[:space:]]*"[^"]*"' ../version.json 2>/dev/null | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
  if [ -z "$build_json" ]; then
    ng "version.json が無い/読めない ─ 更新検知が働かない"
  elif [ "$build_html" != "$build_json" ]; then
    ng "version.json($build_json) と APP_BUILD($build_html) が違う ─ 更新が届かないか、再読み込みが止まらなくなる"
  else
    ok "version.json と APP_BUILD が一致"
  fi

  # ★定義していない定数を参照していないか★（2026-08-03）
  #   SMP_SHORT を参照だけ入れて定義を忘れ、レポート画面が真っ赤になった。
  #   構文としては正しいので node --check では見つからない。
  #   大文字の定数だけを対象に、宣言があるかどうかを照合する。
  undef=$(python3 - <<'PYX'
import re
KNOWN = set("""JSON Math Date Object Array String Number Boolean RegExp Promise Set Map WeakMap
Intl NaN Infinity URL URLSearchParams TextEncoder TextDecoder Error TypeError
DOMParser FormData FileReader Audio Image Notification AbortController
React ReactDOM APP_BUILD GAS_URL""".split())
bad = []
for f in ("../index.html", "../coach/index.html"):
    try: s = open(f).read()
    except OSError: continue
    js = "\n".join(m.group(2) for m in re.finditer(r"<script([^>]*)>(.*?)</script" + ">", s, re.S | re.I)
                    if "src=" not in m.group(1).lower())
    declared = set(re.findall(r"(?:const|let|var|function|class)\s+([A-Z][A-Z0-9_]{2,})\b", js))
    scan = re.sub(r"/\*.*?\*/", " ", js, flags=re.S)
    scan = re.sub(r"//[^\n]*", " ", scan)
    # 文字列は「同じ行の中だけ」で消す。行をまたいで消すと、
    # テンプレート内の本物のコードまで巻き込んでしまう（実測）
    scan = "\n".join(
        re.sub(r'"(?:\\.|[^"\\])*"', " ", re.sub(r"'(?:\\.|[^'\\])*'", " ", ln))
        for ln in scan.split("\n"))
    used = set(re.findall(r"(?<![.\w$#])([A-Z][A-Z0-9_]{2,})\s*(?=[\[\.(])", scan))
    for n in sorted(used - declared - KNOWN):
        if n.startswith("_"): continue
        # SVGのパス（M13 など）は英字1文字なので対象外にする
        if sum(1 for c in n if c.isalpha()) < 2: continue
        bad.append(f.split("/")[-2] + ":" + n)
print(",".join(bad))
PYX
)
  if [ -z "$undef" ]; then ok "定義していない定数の参照なし"
  else ng "定義していない定数を参照している: ${undef}"; fi

  # ★「開くための状態」があるのに、描画する場所が無い画面を見つける★
  #   2026-08-02に「今日のフォーカス」の宣言モーダルを、描画ブロックごと
  #   消してしまった。状態も保存処理も残っていたので静的検査を素通りし、
  #   利用者が「押しても何も出ない」と気づくまで分からなかった。
  #   const [showX,setShowX]=useState があるなら、showX を描画で使っているか確かめる。
  orphan=$(python3 - <<'PYX'
import re
s = open("../index.html").read()
names = set(re.findall(r"const \[(show[A-Z]\w*)\s*,", s))
bad = []
for n in names:
    # 宣言と set 呼び出しを除いた出現箇所があるか
    uses = [m.start() for m in re.finditer(r"(?<![A-Za-z])" + n + r"(?![A-Za-z0-9_])", s)]
    real = 0
    for i in uses:
        line = s[s.rfind("\n", 0, i) + 1 : s.find("\n", i)]
        if "useState" in line and "const [" in line:
            continue
        real += 1
    if real == 0:
        bad.append(n)
print(",".join(sorted(bad)))
PYX
)
  if [ -z "$orphan" ]; then ok "開く状態と描画が対応している（画面の消し忘れなし）"
  else ng "描画されていない画面がある: ${orphan}"; fi

  # ★Tasksの行を「持ち主なし」で特定するコードを増やさないこと★
  #   task_idはクライアント採番（旧lt_はタイトルのハッシュ）のため
  #   別ユーザー間で衝突し得る。idだけで行を引くと他人の行に当たる。
  #   行の特定は p1OwnedRow / p1List（持ち主で絞る）だけに限定する。
  #   直接 getSheet("Tasks") を触ってよいのは phase4DryRun / legacyBackfill /
  #   actualMinutesAudit（いずれも管理者専用の全体集計。書き込みはしない）だけ。
  direct_reads=$(grep -c 'getSheet("Tasks")' Code.gs)
  if [ "$direct_reads" -le 3 ]; then ok "Tasksの直接読みは管理者集計のみ（${direct_reads}箇所）"
  else ng "Tasksを直接読む箇所が増えた（${direct_reads}箇所）─ 持ち主なしの行特定は禁止"; fi
  #   各呼び出しの直前60行以内で rec に student_email を入れているか
  upsert_bad=$(python3 - <<'PYEOF'
lines = open("Code.gs").read().split("\n")
bad = 0
for i, ln in enumerate(lines):
    if 'p1Upsert("Tasks"' not in ln: continue
    ctx = "\n".join(lines[max(0, i-60):i+13])   # 複数行呼び出しは引数が後ろに続く
    if "student_email" not in ctx: bad += 1
print(bad)
PYEOF
)
  if [ "$upsert_bad" -eq 0 ]; then ok "Tasksへの書き込みは全て持ち主つき"
  else ng "持ち主なしのTasks書き込みが ${upsert_bad} 箇所ある"; fi

  # ★新規タスクIDはランダムであること★ タイトル由来のIDは同名で衝突する
  if grep -q 'makeClientTaskId()' ../index.html && grep -A3 'let id = prev\[title\];' ../index.html | grep -q 'makeClientTaskId'; then
    ok "新規タスクIDはランダム（makeClientTaskId）"
  else
    ng "新規タスクIDがランダムでない ─ タイトル由来IDは衝突する"
  fi

  # ★タスク行は「押す場所」と「起きること」が一致していること★
  # 行全体が完了トグルだったため、内容を見ようとして押しただけで
  # 完了になっていた（Kaiの指摘）。チェックボックスだけが完了。
  if python3 -c "
import sys
s=open('../index.html').read()
i=s.index('const row = (item, showBorder) => html\`')
seg=s[i:i+2600]
tg=seg.count('toggleCheck(item)'); dt=seg.count('setDetailTask(item)')
sys.exit(0 if (tg==1 and dt==1) else 1)
" 2>/dev/null; then
    ok "タスク行 完了トグル1箇所・詳細1箇所（押す場所と結果が一致）"
  else
    ng "タスク行 押した場所と違う結果になる（完了トグルと詳細の数が想定外）"
  fi

  # 表示ラベル（高・中・低で別の言葉になるか）
  if python3 build_label_test.py >/dev/null 2>&1 || python3 ../gas/build_label_test.py >/dev/null 2>&1; then
    ok "タスクの表示ラベル（高・中・低が別の言葉）"
  else
    ng "表示ラベルが重複している ─ 中を選ぶ意味が無くなる"
  fi

  # 端末間の同期（スマホで設定した重要度・期限がPCへ届くか）
  if python3 build_sync_test.py >/dev/null 2>&1 || python3 ../gas/build_sync_test.py >/dev/null 2>&1; then
    ok "端末間の同期（重要度・期限・想定時間）"
  else
    ng "端末間の同期が壊れている ─ スマホの設定がPCに出ない"
  fi

  # マップのキーを id へ付け替える（改名しても設定が残るか・消さないか）
  if python3 build_keymigration_test.py >/dev/null 2>&1 || python3 ../gas/build_keymigration_test.py >/dev/null 2>&1; then
    ok "マップのキー付け替え（改名しても設定が残る）"
  else
    ng "マップのキー付け替えが壊れている ─ 重要度や期限が消える恐れ"
  fi

  # タスクの保存形式の往復（★いちばん困るのはタスクが消えること★）
  if python3 build_roundtrip_test.py >/dev/null 2>&1 || python3 ../gas/build_roundtrip_test.py >/dev/null 2>&1; then
    ok "タスクの保存形式の往復（件数・順番・idが保たれる）"
  else
    ng "タスクの保存形式の往復が壊れている ─ タスクが消える恐れ"
  fi

  # task_id への変換（同名タスクの区別・改名時の情報保持）
  if python3 build_taskid_test.py >/dev/null 2>&1 || python3 ../gas/build_taskid_test.py >/dev/null 2>&1; then
    ok "task_idへの変換"
  else
    ng "task_idへの変換が期待どおりでない"
  fi

  # 進捗とペースの計算（純粋な計算。未入力と0を取り違えないことを含む）
  if python3 build_pace_test.py >/dev/null 2>&1 || python3 ../gas/build_pace_test.py >/dev/null 2>&1; then
    ok "進捗とペースの計算"
  else
    ng "進捗とペースの計算が期待どおりでない"
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

  # ★キャッシュ名を書き写していないか★（2026-08-19 Kai報告「反映されない」）
  #   新しい版を先にキャッシュへ入れてから読み込み直す作りだが、
  #   その入れ先の名前を index.html に直接書いていたため、sw.js 側だけ
  #   名前を変えた時に「書く場所」と「読む場所」が別物になり、
  #   何度開き直しても古い本体が出続けた（jiroku-v13… と jiroku-v16…）。
  #   名前を覚えさせない（caches.keys() から探す）のが正解なので、
  #   直書きが復活したら止める。
  n=$(grep -hc 'caches\.open("jiroku-' ../index.html ../coach/index.html 2>/dev/null | awk '{s+=$1} END{print s+0}')
  if [ "${n:-0}" -eq 0 ]; then
    ok "キャッシュ名の直書き 0箇所（sw.js と食い違わない）"
  else
    ng "キャッシュ名を直接書いている箇所が ${n}件ある（sw.js の名前を変えた時にズレる）"
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
  # ★整合性チェックは毎回走らせる★（2026-08-04 Kaiの指示）
  #   鍵を毎回手で export しないと運用系の検査が飛ばされ、点数の食い違いを
  #   見逃していた。ローカルの鍵ファイル（リポジトリ外）があれば自動で使う。
  # ★鍵の置き場所は1つにする★（2026-08-07 実測で事故）
  #   以前は ~/.config/jiroku/admin_secret も見ていたため、鍵を入れ替えたときに
  #   ops.sh（キーチェーン）とスモークテスト（ファイル）で食い違い、
  #   正しい変更なのに「本番へ出さない」で止まった。ops.sh と同じ順番にする。
  SECRET="${P1_ADMIN_SECRET:-}"
  if [ -z "$SECRET" ]; then
    SECRET="$(security find-generic-password -s P1_ADMIN_SECRET -w 2>/dev/null || true)"
  fi
  if [ -z "$SECRET" ] && [ -f "$HOME/.config/jiroku/admin_secret" ]; then
    SECRET="$(cat "$HOME/.config/jiroku/admin_secret")"
  fi
  [ -n "$SECRET" ] && export P1_ADMIN_SECRET="$SECRET"   # 署名を作るPythonは環境変数から読む
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
  # ★この1本の結果に全部を賭けない★（2026-08-19）
  #   叩きすぎでGoogleのHTMLが返ると「認証は不要」と誤判定し、
  #   正しく拒否された読み取り5本がまとめて「異常」に化けた（実際に起きた）。
  #   JSONが返るまで数回試し、それでも判定できなければ、
  #   決めつけずに不合格として止める。
  ENFORCED=""
  for _try in 1 2 3; do
    probe=$(call "&action=getUser&studentEmail=${ADMIN}")
    if echo "$probe" | grep -q "AUTH_REQUIRED"; then
      ENFORCED=1; echo "  （読み取りは認証必須。トークン無しは拒否されるのが正常）"; break
    elif echo "$probe" | grep -q '"ok":'; then
      ENFORCED=0; break
    fi
    sleep 5
  done
  if [ -z "$ENFORCED" ]; then
    ng "認証の姿勢を判定できませんでした（JSONが返らない。時間を置いて再実行してください）"
    ENFORCED=skip
  fi

  for ac in getUser getLogs getReportList getHomeData getGoalTree; do
    [ "$ENFORCED" = "skip" ] && break
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

    # ★点数の食い違いを見つける★（2026-08-03）
    #   同じ日の点数が、レポート詳細・一覧・ランキング・みんなの頑張りで
    #   別々の数字になっていたことがある（64 / 71 / 73）。
    #   1か所でも違ったらデプロイを止める。
    cons=$(curl -sL --max-time 180 "${URL}?$(sign adminScoreConsistency "$ADMIN")")
    if [ -z "$cons" ]; then ng "点数の整合性チェックが空応答"
    elif echo "$cons" | grep -q '"consistent":true'; then
      ok "点数が4か所で一致（詳細・一覧・ランキング・みんなの頑張り）"
    elif echo "$cons" | grep -q '"ok":false'; then
      echo "  － 点数の整合性チェックは対象外（$(echo "$cons" | head -c 80)）"
    else
      ng "点数が食い違っている: $(echo "$cons" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("values"))' 2>/dev/null || echo "$cons" | head -c 140)"
    fi

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
