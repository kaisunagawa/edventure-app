#!/bin/bash
# Code.gs（gitで管理する編集用ファイル）を、GAS側の実ファイル名「コード.js」にコピーして
# clasp push し、本番Webアプリのデプロイ（DEPLOYMENT_ID）も新バージョンで更新する。
# Code.gs自体はGAS側でリネームしない（ファイル名を変えると事故リスクがあるため）。
#
# ── デプロイの順序（2026-07-31の事故を受けて固定した）──
#   ① 静的スモークテスト（必須の関数・アクションが揃っているか）
#   ② clasp push … HEADのコードだけを更新する。本番デプロイはまだ古いまま
#   ③ テスト用デプロイへ反映
#   ④ テスト用URLへ実機スモークテスト（読み取りのみ）
#   ⑤ 合格した時だけ本番デプロイ
#   ⑥ 本番URLへ実機スモークテスト（読み取りのみ）
#   ⑦ 失敗したら即座に戻す（git revert → 再実行）
#
# どこかで失敗したら本番へは進まない。②のpushだけでは本番は変わらないので安全。
#
# 本番で使われているWebアプリのURL(GAS_URL)に対応するデプロイID。
# index.htmlのGAS_URLと紐づいているため、絶対に変更しないこと
DEPLOYMENT_ID="AKfycbzJ-QEpPVnmp-LFU5Jxww4VFP1qaseMtwCrzKxAA6ZULr1y3h_UeKzVdhHnl5ze57U"
# 本番とは別の、テスト専用デプロイ。ここが壊れても利用者には影響しない
TEST_DEPLOYMENT_ID="AKfycbw-MhcAhOaqd_JJTlN4LltE-liM-WriznSgcDGIBR0uUMMB-rnYI74GUoXkmyNgTsx5"

BASE="https://script.google.com/macros/s"
set -e

# ★夜の処理が動いている時間帯はデプロイしない★（2026-08-05の事故）
#   夜のレポートは22:00に始まり、時間切れになると1分後に自分を再実行して続きを処理する。
#   その最中にデプロイすると動いているコードが差し替わり、生成が途中で止まる。
#   実際、22:00〜22:30に4回デプロイして3人分で止め、点数も食い違わせた。
#   22:00〜23:00は既定で止める。どうしても出す必要があるときだけ FORCE_NIGHT=1。
_hour=$(date +%H)
if [ "$_hour" = "22" ] && [ "${FORCE_NIGHT:-0}" != "1" ]; then
  echo "✗ 22時台は夜のレポートが動いているためデプロイしません（利用者のレポートが途中で止まります）"
  echo "   23時以降にやり直すか、どうしても今出すなら FORCE_NIGHT=1 を付けてください"
  exit 1
fi
cd "$(dirname "$0")"
export PATH="$HOME/.local/node-v22.17.0-darwin-arm64/bin:$PATH"

# SKIP_SMOKE=1 を付けると飛ばせるが、通常は使わないこと
SMOKE="${SKIP_SMOKE:-0}"

if [ "$SMOKE" != "1" ]; then
  echo "【1/6】静的スモークテスト"
  bash smoke_test.sh static >/tmp/_smoke_static.log 2>&1 || {
    echo "✗ 静的スモークテストに失敗。本番へは出しません"; grep "✗" /tmp/_smoke_static.log; exit 1; }
  echo "✓ 合格"
fi

echo "【2/6】GASへpush（HEADのみ。本番デプロイはまだ変わらない）"
cp Code.gs "コード.js"
clasp push --force >/dev/null
echo "✓ push完了"

# ★GASはバージョンを200個までしか持てない。上限に達すると deploy が失敗するが、
#   終了コードに現れないことがあるため、出力を見て明示的に止める。
#   （2026-07-31に上限へ到達。既存バージョンへ向け直して回避した）
deploy_or_die() {  # $1=deploymentId  $2=説明
  local out
  out=$(clasp deploy -i "$1" -d "$2" 2>&1)
  if printf '%s' "$out" | grep -q "limit of 200 versions"; then
    echo "✗ バージョン数が上限(200)に達しています。新しいバージョンを作れません。"
    echo "   対処: Apps Scriptの「プロジェクトの履歴」で古い版を削除するか、"
    echo "         既存バージョンへ向け直す:  clasp deploy -i $1 -V <既存の版番号>"
    return 1
  fi
  if ! printf '%s' "$out" | grep -q "^Deployed"; then
    echo "✗ デプロイに失敗しました:"; printf '%s\n' "$out"; return 1
  fi
  printf '%s\n' "$out" | tail -1
  return 0
}

DESC="${1:-Claude Codeによる自動デプロイ $(date '+%Y-%m-%d %H:%M')}"

if [ "$SMOKE" != "1" ]; then
  echo "【3/6】テスト用デプロイへ反映"
  # ★バージョンを1回だけ作り、検証と本番で同じ版を使い回す。
  #   以前は検証用と本番で clasp deploy を別々に呼び、1回の変更で
  #   2バージョン消費していた。上限200に達した原因のひとつ。
  VER=$(clasp version "$DESC" 2>&1 | sed -n 's/^Created version \([0-9]*\)\.*/\1/p')
  if [ -z "$VER" ]; then
    echo "✗ バージョンを作成できませんでした（上限200に達している可能性）"
    echo "   Apps Scriptの「プロジェクトの履歴」で古い版を削除してください"
    exit 1
  fi
  echo "  作成した版: @$VER"
  clasp deploy -i "$TEST_DEPLOYMENT_ID" -V "$VER" -d "test: $DESC" >/dev/null || { echo "✗ テスト用デプロイに失敗"; exit 1; }
  echo "✓ 完了"

  echo "【4/6】テスト用URLへ実機スモークテスト"
  if ! EXPECT_AUTH_MODE="${EXPECT_AUTH_MODE_TEST:-}" bash smoke_test.sh live "$BASE/$TEST_DEPLOYMENT_ID/exec"; then
    echo "✗ テスト環境で失敗。本番へは出しません（本番は今も無傷です）"; exit 1
  fi
fi

# TEST_ONLY=1 のときはテスト用デプロイまでで止める（本番へ出さない）
if [ "${TEST_ONLY:-0}" = "1" ]; then
  echo "TEST_ONLY=1 のため本番デプロイは行いません（本番は無傷のままです）"
  echo "テスト用URL: $BASE/$TEST_DEPLOYMENT_ID/exec"
  exit 0
fi

echo "【5/6】本番デプロイ"
# 検証で通したのと同じ版をそのまま本番へ出す（別の版を作らない＝差異も生まれない）
if [ -n "${VER:-}" ]; then
  clasp deploy -i "$DEPLOYMENT_ID" -V "$VER" -d "$DESC" >/dev/null || { echo "✗ 本番デプロイに失敗"; exit 1; }
  echo "✓ 本番デプロイ完了（@$VER を公開。検証と同一の版）"
else
  deploy_or_die "$DEPLOYMENT_ID" "$DESC" || exit 1
  echo "✓ 本番デプロイ完了"
fi

if [ "$SMOKE" != "1" ]; then
  echo "【6/6】本番URLへ実機スモークテスト（読み取りのみ）"
  if ! EXPECT_AUTH_MODE="${EXPECT_AUTH_MODE_PROD:-}" bash smoke_test.sh live "$BASE/$DEPLOYMENT_ID/exec"; then
    echo ""
    echo "✗✗ 本番が異常です。ただちに戻してください:"
    echo "     cd ~/Projects/edventure-app && git revert --no-commit HEAD && git commit -m '緊急revert' && bash gas/push_gas.sh"
    exit 1
  fi
fi

# ★利用者に届く形になっているかを、公開中の実物で確かめる★（2026-08-19）
#   version.json と index.html は別のファイルなので、片方だけ古い状態が作れる。
#   そうなるとアプリは「新しい版がある」と判断して読み込み直すのに、
#   出てくる中身は古いまま——という終わらないループに入る（実際に起きた）。
#   GASを出しただけでは利用者の画面は変わらない。ここまで見て初めて「出した」。
if [ -f verify_live.sh ]; then
  echo "【公開の確認】GitHub Pages の実物"
  bash verify_live.sh || echo "  （アプリ側は git push がまだのようです）"
fi

echo "すべて完了しました。"
