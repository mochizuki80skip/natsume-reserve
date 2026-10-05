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
├─ public/     公開フォルダ（予約システム専用のフォルダにそのまま置く）
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

zip を展開すると `natsume-reserve-xserver` フォルダができます。**その中身を、予約システム専用のフォルダにそのまま置きます。**

おすすめは、ホームページ（WordPress など）と分けて**サブドメイン**を作る形です（サーバーパネル →「サブドメイン設定」、ドキュメントルートは初期のまま）。
例：`yoyaku.hachimaru-80skip.com` を作った場合

```
/home/main80skip/hachimaru-80skip.com/public_html/
├─ （WordPress のファイル）            ← 触らない
└─ yoyaku.hachimaru-80skip.com/        ← 予約システム専用のフォルダ。ここに zip の中身を置く
    ├─ index.php / .htaccess / index.html / assets/ / tesseract/ / tessdata/
    └─ app/
        └─ config.php                  ← 手順 3 で作る
```

WordPress と同じドメインの中に置いても、お互いに影響しない作りにしてあります。

- 予約システムは、自分のフォルダの `app` だけを使います（1 つ上の WordPress 側に `app` という名前のフォルダがあっても読みません）。
- 自分のフォルダの `.htaccess` で URL の振り分けをするので、WordPress の `.htaccess` の書き換え規則は効きません。
  空き状況などの API の応答は PHP 側で `Cache-Control: no-store` を付けるので、キャッシュされません。
- Xserver では `.htaccess` に `Header`・`Expires`・`ModPagespeed` などを書くと 500 エラーになったため、`.htaccess` は URL の振り分けだけにしています（セキュリティ用のヘッダーは `index.php` で付けます）。
- `config.php` の `APP_URL` に正式な URL を入れておくと、WordPress 側のフォルダ経由（例：`https://hachimaru-80skip.com/yoyaku.hachimaru-80skip.com/`）で開かれたときに正式な URL へ転送します。
- 自動更新（手順 6-A）は予約システム専用のフォルダの中だけを書き換え、WordPress のファイルがある場所には反映しません。

ドメインのフォルダ直下（public_html の外）に `app` を置く以前の形（`/home/xsXXXXXX/〇〇.jp/app/` ＋ `public_html/` に画面）でも動きます。

アップロードのコツ：

- zip（約 24MB・72 ファイル）は**手元のパソコンで展開してから**、FTP ソフト（FileZilla など）でフォルダごとアップロードすると確実です。
- `public` の中の **`.htaccess`（名前が「.」で始まる隠しファイル）も忘れずに**置いてください。FTP ソフトで「隠しファイルを表示」にすると見えます。無いと画面の URL が 404 になります。
- `public` の中の `tesseract/`（読み取りエンジン）と `tessdata/`（言語データ）も必ず置いてください。無いと自賠請求のスクショ読み取りが動きません。

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
| APP_URL | 予約システムの正式な URL（例：`https://yoyaku.hachimaru-80skip.com`）。それ以外の URL で開かれたら転送する。**SNS 投稿管理では必須**（画像の公開 URL・連携の戻り先） |
| IG_APP_ID / IG_APP_SECRET | SNS 投稿管理で Instagram に自動投稿する場合（Meta for Developers のアプリ）。空なら手動投稿の補助だけ |
| GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET | 同 Google ビジネスプロフィール（Google Cloud の OAuth クライアント）。空なら手動投稿の補助だけ |
| LINE_CHANNEL_ACCESS_TOKEN / LINE_CHANNEL_SECRET | SNS 投稿の通知を LINE で受ける場合（LINE 公式アカウントの Messaging API） |
| NOTIFY_EMAIL / NOTIFY_FROM | LINE を使わないときの通知メール（カンマ区切りで複数可） |
| SNS_SECRET | 連携トークンの暗号化の鍵（省略時は SESSION_SECRET から作る） |

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

## 5-1. SNS 投稿の自動処理（Cron）

SNS 投稿管理（Instagram・Google ビジネスプロフィールの下書き作成・予約投稿・数字の取り込み）を使う場合は、
同じ「Cron設定」で **5〜10 分おき** に次のコマンドも登録します（分の欄に `*/10` など）。

```
/usr/bin/curl -s "https://〇〇.jp/api/cron/sns?token=CRON_SECRET" > /dev/null
```

- 承認済みの下書きを予定時刻に投稿する／毎朝 6 時以降に先の下書きを作る／9 時以降に承認待ちを通知する／5 時以降に数字を取り込む、を 1 つの処理で行います。
- 投稿の画像は `public/media/sns/` に保存されます（自動更新で消えません）。フォルダが作れない場合は手動で作り、書き込み権限（755）を付けてください。
- 連携の手順・画面の説明は [docs/SNS.md](../docs/SNS.md) を参照してください。

## 5-2. 自賠請求の速報集計（月末の売上をその日に把握する）

事故患者様の自賠責請求書は、月末に店舗が印刷して保険会社へ郵送し、コピーが本社に届いて経理・事故担当が確認するまで
売上額が分からない、という時間差をなくすための機能です。**外部サービスや AI の API は使わず、料金は一切かかりません。**

### 店舗の作業（月末・レセコンの PC で）

1. レセコンで自賠責の請求書を印刷する前のプレビュー画面を、患者様 1 人ごとに **Win + Shift + S** でスクショする。
2. 管理画面の「自賠請求」を開き、スクショを **Ctrl + V で貼り付け**（またはファイルをドラッグ＆ドロップ／「スクショを選ぶ」）。
   患者番号・氏名・請求月（令和 年 月）・実日数・合計金額が自動で読み取られ、一覧に並びます。
   **合計は請求月で集計します。** 9月の画面で 8月分の請求書を登録しても、そのまま保存・提出でき、8月分の合計に入ります。
   画面上部に「この画面の請求月別の内訳：9月分 1件 41,880円 ／ 8月分 1件 54,780円」と表示し、8月の画面には「他の月の画面で登録された 8月分」として件数・金額を出して 8月の合計に含めます。
   画像から請求月を読み取れなかった行は「請求月」が赤枠の未選択になり、何年何月分かを選ぶまで保存も提出もできません（「未選択の行をすべて○月分にする」で一括でも選べます）。読み取りは店舗の PC のブラウザの中だけで行い、画像はサーバーにも社外にも送りません。
   住所・生年月日・傷病名は読み取り対象外で、確認用の切り抜き画像にも含めません。保存されるのは患者番号・氏名・実日数・合計金額だけです。
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

読み取りは次の順で行い、撮り方の違い（画面全体を撮る、画面の拡大率 100〜200%、JPEG 保存など）に強くしています。

1. 表の罫線を消してから全体を読み、「小計」「合計」が縦に並ぶ列と文字の大きさを測る
2. 請求書の部分だけを切り出し、文字を読みやすい大きさにそろえてもう一度読む
3. 合計は「全体の読み」と「合計欄だけを白黒にして読み直した結果」など複数の読みで多数決し、小計より小さい値（桁落ち）は除外する
4. 実日数は「実日数の列」「転帰（継続など）の直前」「施術回数（×13回など）」の多数決

**スクショの大きさの目安：請求書の縦の長さが画面の縦の 8 割以上**（一般的なフル HD のモニターの場合。プレビューを「ページ全体」表示にして画面の上から下までいっぱいになっていれば十分）。
レセコンのウィンドウは全画面でも左右半分でも構いません。画面の大きさはパソコンごとに違うため、何割かは画面の大きさから自動で計算してアップロード欄に絵つきで表示します
（縦 1440 のモニターなら 6 割、縦 768 の小さいノートパソコンでは画面いっぱいでも足りないため「必ず確認」と表示）。
内部の基準は「スクショ上で請求書の縦 860 ピクセル以上（横 600 ピクセル相当）」。検証では横 590〜1968 ピクセル（拡大率 90〜300%）で、切り抜いても画面全体を撮っても全項目が正しく読めました。
これを下回る画像には「今の画像は画面の縦の約 ○割」と撮り直しの案内を出します。

読み取りに自信がないとき（票が割れた、合計の行が特定できない、文字が小さすぎるなど）は、その行に ⚠ で理由と撮り直しの案内を出します。

印字された定型の画面なので、患者番号・請求月・実日数・合計金額は高い精度で読めます。
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
| XSERVER_DIR | **予約システム専用のフォルダ**（例：`/home/main80skip/hachimaru-80skip.com/public_html/yoyaku.hachimaru-80skip.com`） |

- 書き換えるのは `XSERVER_DIR` の中だけです。`config.php` は上書きしません。
- 安全のため、`XSERVER_DIR` が空欄・`public_html` そのもの・WordPress のファイル（wp-config.php など）がある場所のときは、何もせずに中止します。

### B. 手動

Actions の zip をダウンロードして展開し、`natsume-reserve-xserver` の中身で**予約システム専用のフォルダの中だけ**を上書きします。
`app/config.php` は zip に入っていないので、上書きしても消えません。WordPress のフォルダ（public_html 直下）には何も置かないでください。
新しい版で増えたテーブルや列（自賠請求の請求月、スタッフの所属期間、他店からの応援など）は、更新後の最初のアクセスで自動で追加されるので、`/install` の再実行やデータベースの手作業は不要です。

### 動作確認済みの環境

Xserver と同じ構成（Apache 2.4 ＋ `.htaccess` 有効、PHP 8.3、MariaDB 10.11、`app/` を public_html の外に配置）に Actions と同じ手順で作った zip を置き、
初期設定・予約システム全体の確認（57 項目）・自賠請求の確認（29 項目）・毎日の自動削除・旧版からの更新（列の自動追加）がすべて通ることを確認しています。
また、WordPress のある public_html の中にサブドメインのフォルダを作る構成（1 つ上に別の `app` フォルダがある状態）でも、予約システム全体（57 項目）・自賠請求（12 項目）・正式 URL への転送・自動更新で WordPress 側が変わらないことを確認しています（サブドメイン構成）。

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
node ../e2e/sns-mock.mjs &                      # SNS：Instagram・Google・LINE の代わりをするサーバー（config.php に SNS_API_MOCK を設定）
BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... node ../e2e/sns.mjs     # SNS 投稿管理の画面を一通り確認
```

SNS の確認では PHP を `PHP_CLI_SERVER_WORKERS=4 php -S ...` のように複数プロセスで起動してください（模擬の Instagram が画像を取りに来るため）。

`npm run build` は OCR エンジン（tesseract.js の worker と wasm）を `public/tesseract/` にコピーしてから画面をビルドします。

## 8. Vercel 版との違い

- サーバー側を Node.js（Next.js + Prisma）から PHP（PDO + MySQL）に置き換えました。空き判定・祝日・営業時間・二重予約防止の規則は同じです。
- 画面はサーバーで組み立てる方式から、ブラウザ側で組み立てる方式（単一ページアプリ）に変えました。見た目と操作は同じです。
- 自動削除は Vercel Cron の代わりに Xserver の Cron を使います。
- 祝日は外部ライブラリの代わりに PHP で計算します（2024〜2035 年で一致を確認済み）。
- 自賠請求の速報集計（5-2）はこの Xserver 版だけの機能です。
