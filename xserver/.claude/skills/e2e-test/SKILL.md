---
name: e2e-test
description: この予約システムの確認テスト（Playwright の e2e と vitest）をローカルで動かす。PHP の開発用サーバー・MariaDB の準備、DB の初期化、1 本だけ／全部の実行、よくある失敗の見分け方。機能を直したあと・更新ファイルを作る前に使う。
---

# 確認テストを動かす

## 1. 準備（1 回だけ）

```bash
# MariaDB（MySQL）を起動し、空の DB とユーザーを作る
service mariadb start
mysql -uroot -e "CREATE DATABASE IF NOT EXISTS booking CHARACTER SET utf8mb4; CREATE USER IF NOT EXISTS 'booking'@'127.0.0.1' IDENTIFIED BY '<テスト用のパスワード>'; GRANT ALL ON booking.* TO 'booking'@'127.0.0.1';"
# app/config.php を app/config.example.php から作る（Git には入れない）
#   DB_HOST=127.0.0.1 / DB_NAME=booking / DB_USER=booking / DB_PASS=上のパスワード
#   HQ_PASSWORD=<テスト用> / INSTALL_TOKEN=inst-token / APP_ENV=production（本番と同じ動きで確かめる）
cd frontend && npm ci && npx vite build && cd ..
```

Chromium：`CHROMIUM_PATH` に Playwright の Chromium の場所を入れる（例：`/opt/pw-browsers/chromium-*/chrome-linux/chrome`）。

## 2. 開発用サーバーを起動する

```bash
# MAIL_LOG を付けると、メール・LINE を送らずにそのファイルへ書く（通知のテストで読む）
(MAIL_LOG=/tmp/natsume-mail.log nohup php -S 127.0.0.1:3003 -t public dev-router.php >/tmp/php.log 2>&1 &)
curl -s -o /dev/null -w '%{http_code}\n' 127.0.0.1:3003/   # 200 なら OK
```

サーバーは、しばらく使わないと止まっていることがあります。`ECONNREFUSED` や `ERR_CONNECTION_REFUSED` が出たら、上の 2 行で起動し直す（`pkill -f "php -S"` は自分のシェルごと止まることがあるので、止めるときは別のコマンドで）。

## 3. DB を初期化して 1 本動かす

テストは毎回まっさらな DB で動かします（見本の店舗 S001〜、本部 HQ ができる）。

```bash
mysql -uroot -e "DROP DATABASE IF EXISTS booking; CREATE DATABASE booking CHARACTER SET utf8mb4;"
curl -s "http://127.0.0.1:3003/install?token=inst-token" -o /dev/null
CHROMIUM_PATH=... HQ_PASSWORD=<テスト用> MAIL_LOG=/tmp/natsume-mail.log node e2e/smoke.mjs
```

結果は 1 行ずつ `PASS …` / `FAIL …` で出ます。FAIL が 1 つでもあれば終了コードが 1。

## 4. 全部動かす（30〜40 分）

```bash
for f in e2e/*.mjs; do n=$(basename $f .mjs); case $n in seen|guide-shots|live) continue;; esac
  mysql -uroot -e "DROP DATABASE IF EXISTS booking; CREATE DATABASE booking CHARACTER SET utf8mb4;"
  curl -s "http://127.0.0.1:3003/install?token=inst-token" -o /dev/null
  timeout 600 node $f > /tmp/out-$n.log 2>&1; echo "$n exit=$? pass=$(grep -c ^PASS /tmp/out-$n.log) fail=$(grep -c ^FAIL /tmp/out-$n.log)"
done
```

`seen.mjs` は部品、`guide-shots.mjs` は使い方の画面写真を撮るもの、`live.mjs` は本番に向けるもの（ふだんは動かさない）。
長くかかるので、`run_in_background` で動かして終わるのを待つ。

単体テスト：`cd frontend && npx vitest run`。

## 5. よくある失敗の見分け方

| 出かた | 原因 | すること |
|---|---|---|
| `exit=1 pass=0`、`ECONNREFUSED` | 開発用サーバーが止まっている | 2 を実行して起動し直す |
| pass の数がふだんより少なく、FAIL も無い | テストが途中で止まった（画面の部品が見つからない・ダイアログが邪魔） | ログの最後の Error を見る |
| 「画面が新しくなりました」の帯の FAIL | ビルドの途中で分をまたぎ、画面と version.json の版がずれた | `npx vite build` をもう一度 |
| 閉院後（夜）だけ落ちる | 閉院後に出る「ブロックの提案」の一覧が操作をふさぐ | `e2e/seen.mjs` で見たことにしている。新しいテストも `skipWhatsNew(br)` を使う |
| 日付によって落ちる | テストに固定の日付を書いている | 「3 日後以降の営業日」を計算する（`e2e/closurebulk.mjs` の書き方） |
| `getByLabel` が 2 つ以上に当たる | 名前の一部が同じ部品がある | `{ exact: true }` を付けるか、aria-label を別の言葉にする |

## 6. テストを書くときの決まり

- まっさらな DB から始まる前提で、必要なスタッフ・予約は API で入れる（`api(p, 'PUT', '/api/admin/cells', …)`）。
- 名前は見本の名前（「見本 太郎」など）。本物の名前を使わない。
- 直したら、直す前の作りで失敗することも確かめる（`git stash` で一時的に戻す。戻すときは `public/version.json` が変わっていたら `git checkout -- public/version.json` してから `git stash pop`）。
