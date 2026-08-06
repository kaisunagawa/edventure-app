"""ops.sh から呼ぶ前提で書いた運用コマンドが、許可リストに載っているかを調べる。

判定の材料は、コード中のコメントに書いた使い方（bash gas/ops.sh <名前>）。
署名で呼ぶ経路は fail-closed で、許可リストに無いものは AUTH_REQUIRED で弾かれる。
気づきにくく、2026-08-05 に3つ載せ忘れてデプロイをやり直した。

コーチ画面からセッション付きで呼ぶコマンドはこの経路を通らないので、対象外。
"""
import re, sys

src = open("gas/Code.gs", encoding="utf-8").read()

m = re.search(r'const ADMIN_SECRET_ALLOWLIST = \{(.*?)\n\};', src, re.S)
if not m:
    print("✗ ADMIN_SECRET_ALLOWLIST が見つかりません"); sys.exit(1)
allowed = set(re.findall(r'([A-Za-z_$][\w$]*)\s*:\s*1', m.group(1)))

# コメントに「bash gas/ops.sh <名前>」と書いてあるもの＝ops.shから呼ぶ前提
intended = set(re.findall(r'bash gas/ops\.sh\s+([A-Za-z_$][\w$]*)', src))
cases    = set(re.findall(r'case\s+"([A-Za-z_$][\w$]*)"', src))
intended &= cases

missing = sorted(intended - allowed)
if missing:
    print("✗ ops.sh から呼べない運用コマンドがあります（許可リストに無い）")
    for a in missing:
        print(f"    {a}  … ADMIN_SECRET_ALLOWLIST に {a}:1 を足す")
    sys.exit(1)
print(f"✓ ops.sh 前提の運用コマンドが全て許可リストにある（{len(intended)}件）")
