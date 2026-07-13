#!/bin/bash
# Code.gs（gitで管理する編集用ファイル）を、GAS側の実ファイル名「コード.js」にコピーして
# clasp push し、本番Webアプリのデプロイ（DEPLOYMENT_ID）も新バージョンで更新する。
# Code.gs自体はGAS側でリネームしない（ファイル名を変えると事故リスクがあるため）。
#
# 本番で使われているWebアプリのURL(GAS_URL)に対応するデプロイID。
# index.htmlのGAS_URLと紐づいているため、絶対に変更しないこと
DEPLOYMENT_ID="AKfycbzJ-QEpPVnmp-LFU5Jxww4VFP1qaseMtwCrzKxAA6ZULr1y3h_UeKzVdhHnl5ze57U"

set -e
cd "$(dirname "$0")"
export PATH="$HOME/.local/node-v22.17.0-darwin-arm64/bin:$PATH"
cp Code.gs "コード.js"
clasp push --force
echo "✓ GASへpush完了"

DESC="${1:-Claude Codeによる自動デプロイ $(date '+%Y-%m-%d %H:%M')}"
clasp deploy -i "$DEPLOYMENT_ID" -d "$DESC"
echo "✓ 本番デプロイ完了（新バージョンを公開）"
