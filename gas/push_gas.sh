#!/bin/bash
# Code.gs（gitで管理する編集用ファイル）を、GAS側の実ファイル名「コード.js」にコピーして
# clasp push する。Code.gs自体はリネームしない（GAS側のファイル名を変えると事故リスクがあるため）
set -e
cd "$(dirname "$0")"
export PATH="$HOME/.local/node-v22.17.0-darwin-arm64/bin:$PATH"
cp Code.gs "コード.js"
clasp push --force
echo "✓ GASへpush完了"
