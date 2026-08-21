#!/bin/bash
# ログインの通し検査。通る道と、通らない道の両方を実際に叩いて確かめる。
#
# ★なぜ必要か★（2026-08-20 Kai指示「いろんな通らないパターンも想定して」）
#   「ログインできない」の原因が、期限切れ・別アカウント・トークン無しの
#   どれなのかを画面の文言だけでは切り分けられず、丸一日溶かした。
#   サーバーがどの理由を返すのかを、こちらで固定して確かめておく。
set -u
DEP="${DEP:-AKfycbzJ-QEpPVnmp-LFU5Jxww4VFP1qaseMtwCrzKxAA6ZULr1y3h_UeKzVdhHnl5ze57U}"
U="https://script.google.com/macros/s/$DEP/exec"
pass=0; fail=0; skip=0
ok(){ printf "  \033[32m✓\033[0m %s\n" "$1"; pass=$((pass+1)); }
ng(){ printf "  \033[31m✗\033[0m %s\n" "$1"; fail=$((fail+1)); }
# ★判定できないものを「通った」と数えない★（2026-08-20）
#   叩きすぎるとGoogleがHTMLのエラーページを返す。それを
#   「拒否されなかった＝通った」と読むと、本番が全開だという嘘の警報になる。
#   実際にこの検査の初回で、8件すべてが嘘の失敗になった。
und(){ printf "  \033[33m?\033[0m %s（判定できず）\n" "$1"; skip=$((skip+1)); }
isjson(){ case "$1" in *'"ok"'*) return 0;; *) return 1;; esac }
# ★POSTの答えは「転送先」にある★（2026-08-21 原因判明）
#   GASのPOSTは 302 を返し、本当の答えは Location の echo URL にある。
#   curl -L に任せると、こちらが付けた Content-Type ごと転送先へ運んでしまい、
#   GoogleがHTMLのページを返す。これをずっと「判定できず」と数えていた。
#   ★POSTは転送を追わせず、Location を自分で素のGETで取りにいく★
post(){ local body="$1" loc="" r=""
  for i in 1 2 3 4 5; do
    loc=$(curl -s -m 90 -o /dev/null -D - -X POST -H "Content-Type: text/plain" \
            -d "$body" "$U" | sed -n 's/^[Ll]ocation: //p' | tr -d '\r')
    if [ -n "$loc" ]; then
      r=$(curl -s -m 90 "$loc")           # ← 余計なヘッダを付けないのが肝心
    else
      r=$(curl -s -m 90 -X POST -H "Content-Type: text/plain" -d "$body" "$U")
    fi
    case "$r" in *'"ok"'*) echo "$r"; return 0;; esac
    sleep 20
  done
  echo "$r"; return 1; }
get(){ local q="$1" r=""
  for i in 1 2 3 4 5; do
    r=$(curl -sL -m 90 "$U?$q")
    case "$r" in *'"ok"'*) echo "$r"; return 0;; esac
    sleep 20
  done
  echo "$r"; return 1; }
has(){ case "$2" in *"$1"*) return 0;; *) return 1;; esac }

echo "── ログインの通し検査（本番）──"

CH=$(get "action=authChallenge")
if has '"challenge_id"' "$CH"; then ok "合言葉を発行できる"; else ng "合言葉を発行できない"; fi
CID=$(echo "$CH" | sed -n 's/.*"challenge_id":"\([^"]*\)".*/\1/p')
CST=$(echo "$CH" | sed -n 's/.*"state":"\([^"]*\)".*/\1/p')

R=$(post "{\"action\":\"login\",\"challenge_id\":\"$CID\",\"state\":\"$CST\"}")
if ! isjson "$R"; then und "身分証なしのログイン"
elif has '"ok":false' "$R"; then ok "身分証なしのログインを拒否"; else ng "身分証なしが通った"; fi

R=$(post "{\"action\":\"login\",\"idToken\":\"not-a-real-token\",\"challenge_id\":\"$CID\",\"state\":\"$CST\"}")
if ! isjson "$R"; then und "でたらめな身分証"
elif has '"ok":false' "$R" && ! has "ReferenceError" "$R" && ! has "TypeError" "$R"; then
  ok "でたらめな身分証を拒否（例外で落ちない）"; else ng "でたらめな身分証の扱いが異常"; fi

R=$(post "{\"action\":\"login\",\"idToken\":\"x\",\"challenge_id\":\"ch_does_not_exist\",\"state\":\"zzz\"}")
if ! isjson "$R"; then und "存在しない合言葉"
elif has '"ok":false' "$R"; then ok "存在しない合言葉を拒否"; else ng "存在しない合言葉が通った"; fi

R=$(post '{"action":"getUser","studentEmail":"work.sunagawa@gmail.com"}')
if ! isjson "$R"; then und "トークン無しの getUser"
elif has 'AUTH_REQUIRED' "$R"; then ok "トークン無しの getUser を拒否"; else ng "トークン無しで読めた"; fi

R=$(post '{"action":"getUser","studentEmail":"work.sunagawa@gmail.com","token":"tampered-xxxx"}')
if ! isjson "$R"; then und "偽のトークン"
elif has '"ok":false' "$R"; then ok "偽のトークンを拒否"; else ng "偽のトークンが通った"; fi

R=$(post '{"action":"registerUser","studentEmail":"work.sunagawa@gmail.com","name":"t"}')
if ! isjson "$R"; then und "トークン無しの registerUser"
elif has 'AUTH_REQUIRED' "$R"; then ok "トークン無しの registerUser を拒否"; else ng "トークン無しで登録できた"; fi

TOK=$(bash "$(dirname "$0")/ops.sh" adminIssueTestSession email=work.sunagawa@gmail.com 2>/dev/null | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
if [ -z "$TOK" ]; then ng "検証用セッションを発行できない（時間を置いて再実行）"
else
  R=$(post "{\"action\":\"getUser\",\"studentEmail\":\"work.sunagawa@gmail.com\",\"token\":\"$TOK\"}")
  if ! isjson "$R"; then und "正しいセッションの getUser"
  elif has '"ok":true' "$R"; then ok "正しいセッションで getUser が通る"; else ng "正しいセッションで通らない"; fi
  R=$(post "{\"action\":\"syncTag\",\"studentEmail\":\"work.sunagawa@gmail.com\",\"token\":\"$TOK\"}")
  if ! isjson "$R"; then und "正しいセッションの syncTag"
  elif has '"ok":true' "$R"; then ok "正しいセッションで syncTag が通る（同期の入口）"; else ng "syncTag が通らない"; fi
fi

echo
echo "合格 $pass 件 / 失敗 $fail 件 / 判定できず $skip 件"
if [ "$skip" != "0" ]; then
  echo "（判定できずが残っています。叩きすぎでGoogleが弾いている可能性が高いので、"
  echo "  10分ほど置いて再実行してください。合否は出ていません）"
fi
[ "$fail" = "0" ] && [ "$skip" = "0" ]
