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

DESC="${1:-Claude Codeによる自動デプロイ $(date '+%Y-%m-%d %H:%M')}"

if [ "$SMOKE" != "1" ]; then
  echo "【3/6】テスト用デプロイへ反映"
  clasp deploy -i "$TEST_DEPLOYMENT_ID" -d "test: $DESC" >/dev/null
  echo "✓ 完了"

  echo "【4/6】テスト用URLへ実機スモークテスト"
  if ! bash smoke_test.sh live "$BASE/$TEST_DEPLOYMENT_ID/exec"; then
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
clasp deploy -i "$DEPLOYMENT_ID" -d "$DESC" >/dev/null
echo "✓ 本番デプロイ完了（新バージョンを公開）"

if [ "$SMOKE" != "1" ]; then
  echo "【6/6】本番URLへ実機スモークテスト（読み取りのみ）"
  if ! bash smoke_test.sh live "$BASE/$DEPLOYMENT_ID/exec"; then
    echo ""
    echo "✗✗ 本番が異常です。ただちに戻してください:"
    echo "     cd ~/Projects/edventure-app && git revert --no-commit HEAD && git commit -m '緊急revert' && bash gas/push_gas.sh"
    exit 1
  fi
fi

echo "すべて完了しました。"
