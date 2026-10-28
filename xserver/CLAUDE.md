# CLAUDE.md — WEB 予約システム（Xserver 版）

複数店舗の WEB 予約・予約表・集計を、Xserver などの PHP レンタルサーバーで動かすシステムです。
元は接骨院グループ向けに作り、ほかの事業体へも展開できるようにしています。

- 設計書：`docs/DESIGN.md`（全体の作り・データ・API・空き枠の計算）
- 別の事業体へ展開する手順：`docs/CUSTOMIZE.md`（変える場所の一覧と進め方）
- 運用（更新・配布・テスト）：`docs/OPERATIONS.md`
- スキル：`.claude/skills/`（更新ファイルの作成・確認テスト・事業体への合わせ込み・機能追加の進め方）

## 依頼者とのやりとり

- 依頼者はプログラムに詳しくありません。**返事は丁寧でやさしい日本語**で、専門用語は言い換えます。
- 大きな機能は、作る前に**ラフ（HTML の見た目の試作）を見せて質問**します（スクラッチパッドに HTML を作り、`SendUserFile` の `display: render` で送る）。
- 返事の最後には必ず「**確認待ち・保留**」の一覧を付けます（依頼者に確かめてもらうこと・決めてもらうこと・止めていること）。
- 受け取り方が 2 通り以上ある依頼は、作る前に例を挙げて確かめます。
- 依頼者がチャットにパスワードや合言葉を貼らないよう、必要なときは「画面の欄に直接入れてください」と案内します。

## 守ること（安全・個人情報）

- `app/config.php` は Git にも配布 zip にも入れない。インストール後は `INSTALL_TOKEN` を空にし、`APP_ENV` は `'production'`。
- 本物の患者様（お客様）の氏名などの個人情報を、コミット・テスト・返事・資料に書かない。例は「見本 太郎」「試験 花子」などの見本の名前を使う。依頼者の画面写真に本名が写っていても、返事で繰り返さない。
- 同じサーバーにあるほかのサイト（WordPress など）のファイルやデータベースには触らない。PHP のバージョンも変えない。
- コミットメッセージや資料に、AI のモデル名・識別子を書かない。
- 外部への送信（メール・LINE・SMS）に載せる個人情報は最小限にし、載せ方は本部の設定で選べるようにする。

## 作り（概要）

- `app/`：PHP 8.3（フレームワークなし）。`routes.php` → `handlers/*.php` → `lib/*.php`。DB は MySQL/MariaDB（PDO）。
- `frontend/`：React 19 + Vite + Tailwind + react-router。ビルドすると `public/index.html`・`public/assets/` と `public/version.json` ができる。
- `public/`：公開フォルダ（`index.php` が API の入口、`index.html` が画面）。
- `e2e/`：Playwright の確認テスト（PHP の開発用サーバーに対して動かす）。
- 時刻はすべて日本時間。日付は `YYYY-MM-DD` の文字列、時刻は 0:00 からの分（9:00 = 540）。

## 変更するときの決まり

1. DB の項目を足すときは `app/lib/Migrate.php` の `VERSION` を 1 つ上げ、`if ($ver < N)` の手順を足し、`app/sql/schema.sql` も同じ形に直す（新規インストールとアップデートの両方で同じ表になるように）。
2. 画面の変更には `frontend/src/changelog.ts` に「更新のお知らせ」を足す（`id` を 1 つ上げる、`audience` で出す相手を決める）。
3. 操作が変わったら `frontend/src/lib/guide.ts`（画面の「使い方」）も直す。画面写真が古くなったら撮り直す。
4. 機能を足したら `e2e/` に確認テストを足す。画面の部品にはテストで探せる `aria-label` を付ける。
5. 直す前に、できるだけ「直す前の作りでテストが失敗する」ことを確かめる。
6. `public/version.json` が確認用の版（`2099…`）になったままコミットしない（`e2e/updates.mjs` が一時的に書き換えるため）。
7. 依頼者には、更新ファイル（zip）と「画面の版」（画面の右下に出る日時）を伝える。作り方は `.claude/skills/release-package/SKILL.md`。

## 決めてある計算式（依頼者の決定）

- **店舗生産性**の人数は「施術者＝1、受付＝0.5」で数える（`docs/DESIGN.md` §12-2）。会計系（2027年4月開始）で画面を作るときに使う。

## よく使うコマンド

```bash
# 画面の型チェックとビルド
cd frontend && npx tsc --noEmit -p . && npx vite build
# 単体テスト
cd frontend && npx vitest run
# 確認テスト（準備は .claude/skills/e2e-test/SKILL.md）
node e2e/smoke.mjs
# 更新ファイルを作る
scripts/make-update.sh <前回まるごと入れたコミット> <出力先> update-MMDDx
```
