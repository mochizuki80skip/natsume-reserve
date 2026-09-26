# 接骨院 WEB予約システム（Xserver レンタルサーバー版）

Vercel を使わずに、Xserver のレンタルサーバー（スタンダードプラン）で動かすための版です。
サーバー側は PHP と MySQL、画面は React（ビルド済みの静的ファイル）で動きます。機能・画面・URL は Vercel 版と同じです。

```
xserver/
├─ app/        PHP 本体（Web から直接は見えない場所に置く）
│   ├─ config.example.php  設定の見本 → config.php にコピーして使う
│   ├─ lib/                共通処理（営業時間・祝日・空き判定・DB など）
│   ├─ handlers/           API の処理
│   ├─ sql/schema.sql      テーブル定義（sql/jibai.sql は自賠請求の速報集計用）
│   └─ cron/cleanup.php    古い個人情報の自動削除（毎日）
├─ public/     公開フォルダ（public_html にそのまま置く）
│   ├─ index.php  入口（/api は PHP、それ以外は画面）
│   ├─ .htaccess  URL の振り分け
│   ├─ tessdata/  自賠請求のスクショ読み取り（OCR）の言語データ
│   ├─ tesseract/ ← OCR エンジン本体。frontend をビルドすると生成される（Git には入れない）
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
同じ Cron で、自賠請求の明細の氏名も保持期間（既定 180 日、本部「自賠集計」で変更）を過ぎた月から自動で消えます（金額は残ります）。

## 5-2. 自賠請求の速報集計（月末の売上をその日に把握する）

事故患者様の自賠責請求書は、月末に店舗が印刷して保険会社へ郵送し、コピーが本社に届いて経理・事故担当が確認するまで
売上額が分からない、という時間差をなくすための機能です。**外部サービスや AI の API は使わず、料金は一切かかりません。**

### 店舗の作業（月末・レセコンの PC で）

1. レセコンで自賠責の請求書を印刷する前のプレビュー画面を、患者様 1 人ごとに **Win + Shift + S** でスクショする。
2. 管理画面の「自賠請求」を開き、スクショを **Ctrl + V で貼り付け**（またはファイルをドラッグ＆ドロップ／「スクショを選ぶ」）。
   患者番号・氏名・実日数・合計金額が自動で読み取られ、一覧に並びます。読み取りは店舗の PC のブラウザの中だけで行い、画像はサーバーにも社外にも送りません。
3. 読み取り確認欄の切り抜き画像と見比べて、違っていれば直す（氏名は誤読しやすいので特に確認）。手入力の追加もできます。
4. 「変更を保存」→「この月を提出する」。自賠請求が無い月は「0 件で提出」。
   提出後は店舗では編集できません（「提出を取り消す」で再開できます）。

初回だけ OCR エンジン（約 10 MB）をサーバーから読み込むため、少し待ちます。2 回目からはブラウザに保存されたものを使います。

### 本部の作業

- 「自賠集計」に店舗別の件数・速報合計・提出状況と全社合計が並びます。未提出の店舗も一目で分かります。
- 経理が請求書コピーを確認する際は「明細・経理確認」からその店舗の明細を開き、1 件ずつ確定金額を登録します（速報と同額なら「確認」を押すだけ）。
  速報との差額は明細と集計の両方に表示されます。
- 氏名の保持期間は「自賠集計」の下で変更できます。患者番号・金額・確認結果は残り、氏名だけが消えます。
- 誰がいつ追加・変更・提出・確認したかは各月の「操作記録」に残ります（氏名は記録しません）。

### 読み取りの精度について

印字された定型の画面なので、患者番号・実日数・合計金額は高い精度で読めます（合計は数字欄だけを 2 回目に読み直して確認しています）。
氏名（漢字）は誤読することがあるため、照合の主キーは患者番号にし、氏名は確認画面で直す前提です。
読み取り結果の詳細を調べたいときは、ブラウザの開発者ツールのコンソールで `localStorage.setItem('jibaiDebug', '1')` を実行してから読み取ると、認識した文字と位置が出力されます。

### 既存の環境に追加するとき

テーブルは初回アクセス時に自動で作られるので、`/install` を再実行する必要はありません。`app/` と `public/` を更新してください（`public/tessdata/` と `public/tesseract/` を忘れずに）。

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
BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... SHOT=請求書画面.png node ../e2e/jibai.mjs   # 自賠請求：スクショ読み取り〜本部集計
```

`npm run build` は OCR エンジン（tesseract.js の worker と wasm）を `public/tesseract/` にコピーしてから画面をビルドします。

## 8. Vercel 版との違い

- サーバー側を Node.js（Next.js + Prisma）から PHP（PDO + MySQL）に置き換えました。空き判定・祝日・営業時間・二重予約防止の規則は同じです。
- 画面はサーバーで組み立てる方式から、ブラウザ側で組み立てる方式（単一ページアプリ）に変えました。見た目と操作は同じです。
- 自動削除は Vercel Cron の代わりに Xserver の Cron を使います。
- 祝日は外部ライブラリの代わりに PHP で計算します（2024〜2035 年で一致を確認済み）。
- 自賠請求の速報集計（5-2）はこの Xserver 版だけの機能です。
