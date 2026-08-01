# 本番へ出す手順

## いちばん大事なこと

**`index.html` はそのまま本番です。** GitHub Pages が公開しています。
`git push` した時点で、38名の利用者に届きます。

2026-08-01、`preview/index.html` へコピーしてから push する手順を続け、
「検証用にだけ出した」と報告していたが、**コピー元の `index.html` が本番**であり、
`git add -A` で両方が公開されていた。preview は検証の場ではなく、
本番のコピーになっていた。**報告の前提が崩れる。**

## 検証してから出したいとき

`preview/` のようなコピーは作らない（また同じことが起きる）。
**ブランチを分ける。**

```bash
git switch -c try-something          # 作業用ブランチ
# ...編集...
bash gas/smoke_test.sh static        # 必ず通す
git add -A && git commit -m "..."
# ★push しない★ この時点では本番に何も出ていない
```

Kaiに実機で見てもらう必要があるときは、
**ここで止めて、何を確認してほしいかを具体的に伝える**。

確認が取れてから:

```bash
git switch main && git merge try-something
git push origin main                 # ここで初めて本番へ出る
```

## GAS（サーバー側）

```bash
TEST_ONLY=1 bash gas/push_gas.sh "説明"   # 検証用デプロイまで。本番は無傷
bash gas/push_gas.sh "説明"               # 本番まで出す
```

検証用デプロイは**本番と同じスプレッドシート**を見ている。
読み取りの確認はできるが、**書き込むと本番データが変わる**。

## 出す前に必ず

```bash
bash gas/smoke_test.sh static
```

落ちたら出さない。「時間がないから」で未検証のものを出さない。
