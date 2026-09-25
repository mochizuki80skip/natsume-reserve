# 接骨院 WEB予約システム（Xserver レンタルサーバー版）

Vercel を使わずに、Xserver のレンタルサーバー（スタンダードプラン）で動かすための版です。
サーバー側は PHP と MySQL、画面は React（ビルド済みの静的ファイル）で動きます。機能・画面・URL は Vercel 版と同じです。

```
xserver/
├─ app/        PHP 本体（Web から直接は見えない場所に置く）
│   ├─ config.example.php  設定の見本 → config.php にコピーして使う
│   ├─ lib/                共通処理（営業時間・祝日・空き判定・DB など）
│   ├─ handlers/           API の処理
│   ├─ sql/schema.sql      テーブル定義
│   └─ cron/cleanup.php    古い個人情報の自動削除（毎日）
├─ public/     公開フォルダ（public_html にそのまま置く）
│   ├─ index.php  入口（/api は PHP、それ以外は画面）
│   ├─ .htaccess  URL の振り分け
│   └─ index.html / assets/   ← frontend をビルドすると生成される（Git には入れない）
├─ frontend/   画面（React + Vite）のソース
└─ e2e/        ブラウザで一通り操作する確認スクリプト
```

## 1. Xserver 側の準備（サーバーパネルで行う）

1. **ドメイン**：「ドメイン設定」で使うドメインを追加します。予約専用にするなら「サブドメイン設定」で `yoyaku.〇〇.jp` のように作っても構いません。
   追加後、「SSL設定」で無料独自 SSL を ON にします（https で使うため）。
2. **PHP のバージョン**：「PHP Ver.切替」で対象ドメインを **PHP 8.2 以上** にします。
3. **MySQL**：「MySQL設定」で
   - 「MySQL追加」：データベース名（例：`xsXXXXXX_reserve`、文字コード UTF-8）
   - 「MySQLユーザ追加」：ユーザー名（例：`xsXXXXXX_yoyaku`）とパスワード
   - 「MySQL一覧」で、作ったデータベースの「アクセス権未所有ユーザ」から今のユーザーを追加
   - 画面下部の **MySQL ホスト名**（例：`mysqlXXXX.xserver.jp`）を控える
4. **SSH（自動デプロイを使う場合のみ）**：「SSH設定」を ON にし、GitHub Actions 用の公開鍵を登録します（後述）。

## 2. ファイルを置く

ビルド済みの一式（`app/` と `public/`）を用意します。

- GitHub の Actions ページで「Deploy to Xserver」の実行結果を開くと、**natsume-reserve-xserver.zip** がダウンロードできます（ビルド済み）。
- 手元でビルドする場合：`cd xserver/frontend && npm ci && npm run build` で `public/index.html` と `public/assets/` ができます。

Xserver の「ファイルマネージャ」または FTP ソフトで、次のように置きます（`〇〇.jp` はドメイン）。

```
/home/xsXXXXXX/〇〇.jp/
├─ app/          ← zip の app フォルダをここへ（public_html の「外」）
└─ public_html/  ← zip の public フォルダの中身をここへ（index.php, .htaccess, index.html, assets/）
```

`app` を public_html の外に置けない場合は `public_html/app/` に置いても動きます（`.htaccess` で外部から読めないようにしてあります）。

## 3. 設定ファイルを作る

`app/config.example.php` をコピーして `app/config.php` を作り、値を入れます。

| 項目 | 入れる値 |
|---|---|
| DB_HOST / DB_NAME / DB_USER / DB_PASS | 手順 1 で作った MySQL の情報 |
| SESSION_SECRET | 32 文字以上の適当な英数字（一度決めたら変えない） |
| HQ_PASSWORD | 本部アカウント HQ の初期パスワード |
| INSTALL_TOKEN | 初期設定ページ用の合言葉（適当な英数字） |
| CRON_SECRET | 自動削除用の合言葉（適当な英数字） |
| TWILIO_* | SMS を使う場合のみ。使わなければ空のまま |

## 4. 初期設定（テーブル作成）

ブラウザで次の URL を開きます（`INSTALL_TOKEN` は config.php に入れた値）。

```
https://〇〇.jp/install?token=INSTALL_TOKEN
```

「初期設定が完了しました」と出れば、テーブルと本部アカウント HQ、サンプル店舗 S001/S002 ができています。
終わったら **config.php の INSTALL_TOKEN を空文字 `''` にして**、このページを無効にしてください。

- 本部ログイン：`https://〇〇.jp/admin/login` に `HQ` / HQ_PASSWORD
- 患者様用：`https://〇〇.jp/s/店舗コード`、店舗の管理画面：`https://〇〇.jp/admin/login/店舗コード`
- 本部画面から実店舗を追加し、サンプル店舗は削除してください。

## 5. 毎日の自動削除（Cron）

サーバーパネルの「Cron設定」で、毎日 3:00 に次のコマンドを実行するように登録します（`CRON_SECRET` は config.php の値）。

```
/usr/bin/curl -s "https://〇〇.jp/api/cron/cleanup?token=CRON_SECRET" > /dev/null
```

保持日数（既定 60 日）は本部画面の「個人情報の保持日数」で変えられます。

## 6. 更新のしかた

### A. 自動（GitHub に保存すると自動で反映）

`.github/workflows/deploy-xserver.yml` が、`xserver/` に変更のある push のたびに画面をビルドして SSH で Xserver にアップロードします。
GitHub のリポジトリ設定 → Secrets and variables → Actions に次を登録すると有効になります（登録が無い間は zip の作成だけ行います）。

| Secret | 値 |
|---|---|
| XSERVER_HOST | サーバー番号のホスト名（例：`svXXXX.xserver.jp`） |
| XSERVER_USER | サーバー ID（例：`xsXXXXXX`） |
| XSERVER_SSH_KEY | SSH 秘密鍵の中身（サーバーパネルの SSH設定で登録した鍵と対） |
| XSERVER_DIR | ドメインのフォルダ（例：`/home/xsXXXXXX/〇〇.jp`） |

`config.php` は上書きしません。

### B. 手動

Actions の zip をダウンロードして、`app/` と `public_html/` の中身を入れ替えます（`config.php` は残す）。

## 7. ローカルで動かす（開発者向け）

```bash
cd xserver
cp app/config.example.php app/config.php      # ローカルの MySQL に合わせて編集、APP_ENV を development に
php -S 127.0.0.1:3003 -t public dev-router.php &   # PHP 側
cd frontend && npm ci && npm run build          # 画面をビルド（public/ に出力）
curl "http://127.0.0.1:3003/install?token=..."  # テーブル作成
npm test                                        # 単体テスト
BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... node ../e2e/smoke.mjs   # ブラウザでの一通り確認
```

## 8. Vercel 版との違い

- サーバー側を Node.js（Next.js + Prisma）から PHP（PDO + MySQL）に置き換えました。空き判定・祝日・営業時間・二重予約防止の規則は同じです。
- 画面はサーバーで組み立てる方式から、ブラウザ側で組み立てる方式（単一ページアプリ）に変えました。見た目と操作は同じです。
- 自動削除は Vercel Cron の代わりに Xserver の Cron を使います。
- 祝日は外部ライブラリの代わりに PHP で計算します（2024〜2035 年で一致を確認済み）。
