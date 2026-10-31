# 設計書（WEB 予約システム・Xserver 版）

この文書は、システムの**作り**をまとめたものです。運用の手順は `OPERATIONS.md`、別の事業体へ展開するときの手順は `CUSTOMIZE.md` にあります。
行番号は 2026-10-28 時点の目安です（`Migrate::VERSION = 45`）。

---

## 1. 全体像

```
お客様のスマホ ──▶ /s/{店舗コード}  予約ページ（React）
                     │  GET  /api/public/{code}/week・slots・calendar
                     │  POST /api/public/{code}/reserve
店舗スタッフ   ──▶ /admin/...       予約表・シフト・集計（React）
本部・MG・経理 ──▶ /admin/hq/...     全店舗の設定・集計
                     │  /api/admin/...
                     ▼
              public/index.php ──▶ app/routes.php ──▶ app/handlers/*.php ──▶ app/lib/*.php ──▶ MySQL/MariaDB
LINE         ──▶ POST /api/line/webhook（通知先の登録）
Cron         ──▶ GET  /api/cron/cleanup（古いデータの削除）
```

| 層 | 技術 | 場所 |
|---|---|---|
| サーバー | PHP 8.2 以上（確認は 8.3）。フレームワーク・Composer なし | `app/` |
| DB | MySQL / MariaDB（PDO、utf8mb4、InnoDB） | `app/sql/schema.sql`・`app/lib/Migrate.php` |
| 画面 | React 19 + Vite + Tailwind + react-router（1 ページのアプリ） | `frontend/` → ビルドで `public/` |
| テスト | Playwright（e2e、`e2e/*.mjs`）、vitest（`frontend/src/lib/*.test.ts`） | |
| 設置先 | Xserver などのレンタルサーバー（共有ホスティング） | |

決まりごと：
- 時刻はすべて**日本時間**（`Asia/Tokyo`、DB 接続も `+09:00`）。
- 日付は `YYYY-MM-DD` の文字列（`CHAR(10)`）、時刻は 0:00 からの分の整数（9:00 = 540）。
- ID は `VARCHAR(32)`（`bin2hex(random_bytes(12))`）。
- 店舗のデータはほぼすべて `storeId → store.id`（`ON DELETE CASCADE`）。

---

## 2. フォルダ構成

```
xserver/
├─ app/                    サーバー側（公開フォルダの外 or .htaccess で拒否）
│  ├─ bootstrap.php        タイムゾーン・lib の読み込み
│  ├─ routes.php           URL → 関数の表（route_table）と dispatch()
│  ├─ handlers/            API の本体（public / admin / hq / accounts / karte / madoguchi
│  │                       / churn / closure / report / jibai / misc）
│  ├─ lib/                 共通の部品（§6）
│  ├─ sql/                 schema.sql（新規インストール）、jibai.sql
│  ├─ cron/cleanup.php     CLI からの自動削除
│  ├─ config.example.php   設定の見本（config.php は Git に入れない）
├─ public/                 公開フォルダ
│  ├─ index.php            入口（ヘッダー・API の振り分け・画面の配信）
│  ├─ .htaccess            実在ファイル以外を index.php へ
│  ├─ index.html, assets/  ビルドした画面
│  ├─ version.json         「画面の版」（ビルド日時）
│  └─ guide/*.png          「使い方」の画面写真
├─ frontend/src/
│  ├─ main.tsx             ルーティング（§8）
│  ├─ pages/、pages/admin/ 画面
│  ├─ components/          部品
│  ├─ lib/                 計算・API・文言（guide.ts）など
│  └─ changelog.ts         「更新のお知らせ」
├─ e2e/                    確認テスト
├─ scripts/make-update.sh  更新ファイル（zip）を作る
├─ docs/                   この文書・CUSTOMIZE.md・OPERATIONS.md
└─ .claude/skills/         作業手順（スキル）
```

---

## 3. リクエストの流れ

### 3-1. `public/.htaccess`
- `^app/` を拒否、実在するファイル・フォルダはそのまま、それ以外は `index.php` へ。
- ヘッダー・キャッシュの指定は書かない（Xserver で 500 になったため。ヘッダーは `index.php` で出す）。

### 3-2. `public/index.php`
1. 共通ヘッダー：`X-Content-Type-Options: nosniff`、`Referrer-Policy: strict-origin-when-cross-origin`、`X-Robots-Tag: noindex, nofollow`。
2. `app` フォルダを探す（`./app` → `../app`）。`bootstrap.php`・`routes.php`・`lib/Availability.php` がそろったものだけを採用（同じサーバーの WordPress の `app` を拾わないため）。無ければ 503。
3. 埋め込みの制限：管理画面・管理 API・cron・install は `X-Frame-Options: SAMEORIGIN`。公開ページは `APP_URL` の親ドメインとそのサブドメインからだけ埋め込み可（CSP `frame-ancestors`）。
4. HTTPS のときは HSTS。
5. `APP_URL` と違うホストで開かれたら 301 で正式な URL へ。
6. `/api/...` と `/install` は `dispatch()`、それ以外は `index.html` を返す（画面のファイルが欠けていたら案内付きの 503）。

### 3-3. `app/routes.php`
- `route_table()`：`[メソッド, 正規表現, 関数名]` の一覧。
- `dispatch()`：最初に一致した関数を呼ぶ。前に `audit_register()`（操作の記録）を登録。
- `HttpError` → そのステータスの JSON。そのほかの例外 → `error_log` に残して 500（中身は開発時だけ表示）。
- ハンドラーは `Http::json(...)` で終わる（`exit` する）。

### 3-4. 操作の記録（`audit_register`、`handlers/accounts.php`）
- GET・ログイン・ログアウト・切り替え以外の、`adm_ hq_ karte_ jibai_ mado_ acct_ staffing_ churn_ follow_ report_` と `closure_put` が対象。
- 記録するのは「誰が・どの店舗で・何を（日本語の名前）・日付や対象」。**変えた項目の名前だけで値は残さない**（個人情報を残さないため）。

---

## 4. ログインと権限

### 4-1. セッション（`app/lib/Auth.php`）
- Cookie `bk_session`：`base64url(JSON).base64url(署名)`。署名は `SESSION_SECRET`（16 文字以上）の HMAC-SHA256。
- 中身：`accountId, role, storeId, code, exp, iat, sv`。HttpOnly・SameSite=Lax・本番か HTTPS なら Secure。
- 12 時間操作が無ければ切れる（1 時間ごとに延長）。最長 30 日。
- 毎回 `admin_account` を読み直し、止めたアカウント・`sessVer` の違い（パスワード変更など）・店舗が止まった場合はログアウト扱い。
- Cookie `bk_store`：本部・MG が今見ている店舗。

### 4-2. 役割

| 役割 | 見られる店舗 | できること |
|---|---|---|
| `store`（店舗） | 自分の店舗だけ | 予約表・シフト・集計の入力。`hqOnly` の店舗ではログイン不可 |
| `hq`（本部） | すべて | すべての設定。`canManage=1` ならアカウントの発行・停止と操作の記録も |
| `mg`（管轄 MG） | `hqOnly` 以外の全店舗を見る | 自分の `area` の店舗だけ変更できる |
| `acct`（経理） | 集計だけ | 窓口集計・自賠請求の確認（店舗画面の API は使えない） |

- 店舗コードとアカウントのコードは同じ名前空間。`HQ` は持ち主のアカウントとして予約済み。
- 主なチェック関数：`requireSession`・`context()`（店舗画面の API の標準。`{session, store}` を返す）・`requireHq`・`requireManager`・`requireViewAll`・`canEditStore`。

### 4-3. ログインの守り
- IP ごとに 10 分で 20 回、コードごとに 10 分で 10 回の失敗まで（`RateLimit`、DB の `rate_limit` 表）。
- 無いコードでもダミーのハッシュで照合し、時間差でコードの有無が分からないようにする。
- JSON の書き込みはすべて `Http::requireJson()`（`Content-Type: application/json` 以外は 415）。SameSite=Lax と合わせて、別サイトからの送信（CSRF）を防ぐ。
- フォームの POST（ログアウト・店舗の切り替え）は `requireSameOrigin()`（Origin / Referer のホストを確認）。
- IP は `REMOTE_ADDR` だけを使う（`X-Forwarded-For` は偽れるので見ない）。

---

## 5. API 一覧

記号：**P** 公開／**S** ログイン済み／**C** `context()`（店舗・本部・MG。MG の書き込みは担当エリアだけ）／**HQ** 本部／**MGR** 本部の管理者／**VA** 本部・MG・経理。

### 5-1. お客様向け（`handlers/public.php`）

| メソッド | パス | 権限 | 内容 |
|---|---|---|---|
| GET | `/api/public/{code}/store` | P | 店名・電話・休業のお知らせ・相談 LINE の URL |
| GET | `/api/public/{code}/week?start&kind` | P | 7 日分の空き（○ / 電話 / ×） |
| GET | `/api/public/{code}/slots?date&kind` | P | 1 日分の空き |
| GET | `/api/public/{code}/calendar?month&kind` | P | 月のカレンダー |
| POST | `/api/public/{code}/reserve` | P・回数制限 | 予約する（§7-9） |
| GET | `/api/public-reservation/{32 桁}` | P・回数制限 | 予約の確認ページ（翌日まで） |
| GET | `/api/public-stores` | P | 店舗選びページ |
| GET | `/api/public-privacy` | P | プライバシーポリシー |
| POST | `/api/line/webhook` | LINE の署名 | 6 桁の番号で通知先を登録、ブロック・退出で停止 |

### 5-2. 店舗画面（`handlers/admin.php`）

| メソッド | パス | 内容 |
|---|---|---|
| POST | `/api/admin/login` ・ `logout` ・ `switch` | ログイン・ログアウト・店舗の切り替え |
| GET | `/api/admin/me` | 自分・今の店舗・店舗一覧・警告・新自の未入力件数 |
| GET | `/api/admin/day?date` | 予約表 1 日分（`DayData::load`） |
| PUT | `/api/admin/cells` | セルの保存（`prev` で同時編集を検出、`cell_log` に残す、WEB 予約のセルが全部消えたらキャンセル扱い） |
| PUT | `/api/admin/cell-menus` ・ `cell-staff` ・ `cell-phone` | セルのメニュー・担当・電話番号 |
| PUT | `/api/admin/visit` | 来院チェック（→ `Karte::reflectCell`） |
| POST/DELETE/PATCH | `/api/admin/cancel` | キャンセル名簿へ移す・戻す・メモ |
| POST | `/api/admin/move` ・ GET `move-slots` | 予約の移動 |
| PUT | `/api/admin/days` | 日ごとの公開・休業・メモ・人数の上書き |
| GET/PUT | `/api/admin/shifts` ・ PUT `help-in` | シフト・応援 |
| POST/PUT/DELETE | `/api/admin/staff-members` | スタッフ |
| POST/DELETE | `/api/admin/blocks` | ブロック（会議など） |
| POST/DELETE | `/api/admin/kind-blocks` | 新規・再来の WEB 受付を止める |
| GET/POST | `/api/admin/block-suggestions` | ブロックの提案（14 日分） |
| GET/PUT/PATCH | `/api/admin/settings` ・ `store` | 店舗設定（ベッド数・公開日数・上限・調整値・営業時間の上書き）、自分のパスワード |
| GET/PUT/DELETE | `/api/admin/special-days` | 特別営業日 |
| GET/DELETE | `/api/admin/reservations` （＋ `/export`） | WEB 予約・キャンセルの記録、CSV / xlsx |
| GET | `/api/admin/web-new` ・ `find` ・ `cell-log` ・ `calendar` ・ `staff-counts` | 新着・検索・取り消し・月・担当数 |
| GET/POST | `/api/admin/patients` （＋ `/lookup`） | 診察券番号と氏名の取り込み（CSV は画面側で読む） |

### 5-3. 本部（`handlers/hq.php`・`accounts.php`）

| パス | 権限 | 内容 |
|---|---|---|
| GET `/api/admin/hq` ・ PUT `hq/settings` | HQ | 全体の設定（枠の長さ・締め切り・保持日数・営業時間） |
| POST/PUT `/api/admin/hq/stores` ・ PUT `hq/stores-page` | HQ | 店舗の追加・変更・並び・店舗選びページ |
| GET/PUT `/api/admin/hq/referrals` | HQ | 紹介元・媒体の QR |
| GET `/api/admin/hq/overview` | VA | 全店舗の今日 |
| GET/PUT `/api/admin/hq/privacy` | HQ | プライバシーポリシー（【 】が残っていると公開不可） |
| `/api/admin/hq/jibai-notify`（＋ `/test`）・ `consult-line` ・ `notify-name` | HQ | 新自の通知メール・相談 LINE・通知での氏名の出し方 |
| `/api/admin/hq/line`（＋ `/targets` ・ `/test`） | HQ | LINE のトークン・送り先・試し送信（秘密の値は返さない） |
| `/api/admin/hq/accounts` | 一覧 HQ・変更 MGR | 本部・MG・経理のアカウント |
| GET `/api/admin/hq/audit` | MGR | 操作の記録（直近 300 件） |

### 5-4. 集計（`karte.php`・`churn.php`・`madoguchi.php`・`report.php`・`jibai.php`・`closure.php`）

| まとまり | パス | 内容 |
|---|---|---|
| 新患継続率 | `/api/admin/karte`（GET/POST/PATCH/DELETE、`/import`、`/export`）、`/api/admin/hq/karte`、`hq/karte/options`、`hq/areas` | 初回の記録。予約表から自動で行を作る |
| 離反者・2 週間フォロー | `/api/admin/churn`（＋ `/import` `/export`）、`/api/admin/follow` | 来なくなった方・フォローの一覧 |
| 窓口集計 | `/api/admin/madoguchi`（`/day` `/month` `/henrei` `/export`）、`/api/admin/acct/madoguchi`（`/check` `/target` `/export`）、`hq/goods` | 日々の金額・物販・返戻 |
| 人員 | `/api/admin/staffing`（＋ `/std`） | 店舗ごとの人の過不足 |
| 日報 | `/api/admin/report`（`/value` `/targets`）、`hq/report-items` | 日報の項目と値 |
| 自賠請求 | `/api/admin/jibai`（`/claims` `/submit` `/verify`）、`hq/jibai`（`/settings`） | 自賠責の請求の速報 |
| 臨時休業 | `/api/admin/closures`（`/notices` `/ack`） | 本部・MG からのまとめての休業と店舗の確認 |

### 5-5. その他（`handlers/misc.php`）
- `GET /api/cron/cleanup?token=CRON_SECRET`（または `Authorization: Bearer`）：古いデータの削除（§10）。
- `GET /install?token=INSTALL_TOKEN`：テーブル作成と初期データ。

---

## 6. サーバーの部品（`app/lib`）

| 部品 | 役目 |
|---|---|
| `Auth` | セッション・役割・店舗の選び方（§4） |
| `Availability` | **空き枠の計算（DB を読まない純粋な関数）**。`remainingAt`・`statusFor`・`compute`、セルの文字の判定 `isPatientText`・`isBlockMark` |
| `PublicApi` | お客様向けの空き。来院区分 `KINDS`・`neededSlots`・`buildInput`（DB → `Availability` の入力）・`slotsForCustomer` など |
| `Settings` | 全体設定・店舗・営業時間の決め方・**シフトからの人数**（`capacityFromShifts`） |
| `Hours` | 営業時間の設定（期間 × 曜日）。2 つ目の時刻は「最終受付」 |
| `Holidays` | 日本の祝日の計算 |
| `DayData` | 予約表 1 日分の全データ |
| `BlockSuggest` | 新規・再来の WEB 受付を止める提案 |
| `Karte` | 新患継続率（予約表 → 自動の行、n 回目、新自の通知） |
| `Churn` | 離反者・2 週間フォロー |
| `Madoguchi` | 窓口集計 |
| `Report` | 日報 |
| `Jibai` | 自賠請求の速報（氏名は保持日数で消す） |
| `Text` | セルの文字の分類（`categorize`：初診・再来・自賠）、電話番号・氏名の整え |
| `Time` | 日付と時刻の計算 |
| `Http` | リクエスト・レスポンス・入力チェック |
| `Db` | PDO（最初の接続で `Migrate::run`） |
| `Migrate` | DB の版上げ（§9） |
| `Install` | 初期設定（`schema.sql`、HQ アカウント、見本の店舗） |
| `Config` | `app/config.php` の読み込み（空なら環境変数） |
| `RateLimit` | 回数制限（DB の表） |
| `Mail` ・ `Line` ・ `Sms` | 通知（§11） |
| `Xlsx` | Excel ファイルを作る |

---

## 7. 空き枠の計算（お客様側）

いちばん大事な規則です。コードは `PublicApi::buildInput` → `Availability::compute`。

### 7-1. 公開（`PublicApi::isPublished`）
- `day_status.published` が 1 / 0 ならそれに従う。空なら「今日 〜 今日 + `publishDaysAhead`（既定 30 日）」を公開。
- 現在通院中（RETURN）は「今日 + `bookDaysAhead`（既定 14 日）」より先は、空きがあっても「お電話で」。初診・新自・1ヶ月以上ぶり（NEW・ACCIDENT・REVISIT）は公開する日数まで WEB で取れる（`PublicApi::BOOK_DAYS_KINDS`）。

### 7-2. 営業時間（`Settings::storeSessions`）
1. 1 日休業 → 枠なし。午前休・午後休はその半分を消す（12:00 より前に始まる時間帯が午前）。
2. 特別営業日（`special_day`）があればその時間（定休日・祝日でも）。
3. それ以外は `Hours::sessionsForDate`。祝日休み（`closeOnHolidays`）なら祝日は枠なし。店舗の `hoursOverride` に当てはまる期間があればそちら、なければ全体の `hours`。
4. お客様の枠は `start`〜`lastStart` を `slotMinutes`（既定 15 分）刻み。管理画面はその後に `adminExtraSlots` 枠足す（2 枠目を入れるため）。

### 7-3. 来院区分と使う枠の数（`PublicApi::neededSlots`）

| 区分 | 意味 | 枠の数 | セルの文字 |
|---|---|---|---|
| `NEW` | はじめて（初診） | `newVisitSlots`（既定 2） | `名前（初診）` → 下のセル `上記初診対応` |
| `ACCIDENT` | 交通事故で初めて（新自） | 同上 | `名前（初自）` → `上記初診対応` |
| （予約表だけ）新三 | 第三者行為で初めて（電話・窓口のみ。WEB には出さない） | 2 枠 | `名前（新三）` → `上記初診対応`。新規に数える。新患継続率は区分 `THIRD`、新自と同じく事故日・事故内容と通知 |
| `REVISIT` | 1 か月以上来ていない | 同上 | `名前（再）` → `上記再来対応` |
| `RETURN` | 通院中 | `returnVisitSlots`（既定 1） | `名前` |

**予約表のセルの文字が、そのまま「どの区分の予約か」の情報です**（`Text::categorize` と画面側の `attendance.ts`・`kindTag.ts`・`cellColor.ts` が同じ規則で読む）。区分を変えるときは `CUSTOMIZE.md` §4。

### 7-4. 埋まり具合（`buildInput`）
- ベッド番号のある空でないセルは「埋まり」。
- ブロックの印（✖・休・- など）はベッドを埋めるが、施術者の人数は使わない。
- `slot_block`（会議など）は指定ベッドを埋める。その時間の人数以下のベッド番号なら、人数も 1 使う。
- 時刻ごとに `newCount`（初診の印 + `上記初診対応`）、`revisitCount`（再来の印 + `上記再来対応`）を数える。

### 7-5. シフトからの人数（`Settings::capacityFromShifts`）
- 有効な施術者（`THERAPIST`）で在籍期間内の人を、午前・午後ごとに数える（シフトの行が無ければ出勤。休み・有給・応援に出るはその半分を引く）。
- 他店からの応援（`help_in`）は +1。日ごとの上書き（`capacityAm/Pm`）があればそれ。上限はベッド数。
- 施術者がだれも登録されていなければ `min(defaultActiveBeds, beds)`。
- **新規・再来の担当の上限**：
  - 店舗のだれかに「初回を担当できる（`canFirst`）」が付いていれば、新規の上限 = その日その半分に出勤している `canFirst` の人数。
  - 「再来を担当できる（`canRevisit`）」も同じく再来の上限。
  - 両方使っていれば「新規 + 再来」の上限 = どちらかができる人数。
  - それぞれ店舗設定の調整値（`newAdjust`・`revisitAdjust`・`totalAdjust`、-20〜20）を足し、0 未満は 0。
  - 使っていないチェックは「上限なし」。応援の人は数えない。
  - 店舗設定の画面には「今日のシフトなら」と「全員出勤なら」の人数を出す（`adm_settings_get` の `capToday`・`capAll`）。

### 7-6. 残り（`Availability::remainingAt`）
1. 必要な枠の数だけ続けて空いているベッドの数（`free`）。
2. その間の各時刻で：人数 −（その時刻の患者数）。さらに
   - 新規（NEW・ACCIDENT）で `newCount ≥ 新規の上限` なら 0。
   - 再来（REVISIT）で `revisitCount ≥ 再来の上限` なら 0。
   - NEW・ACCIDENT・REVISIT で `newCount + revisitCount ≥ 合計の上限` なら 0。
   - `kind_block` が掛かっていれば 0（NEW と REVISIT だけ。ACCIDENT と RETURN は止めない）。
3. 残り = `min(free, 各時刻の残りの最小)`。

※ 店舗の古い項目 `maxNewConcurrent`・`maxRevisitConcurrent` は残っているが計算には使わない。

### 7-7. 表示（`Availability::statusFor`）
- 今日：開始まで `phoneCutoffMinutes` 未満 → ×。`webCutoffMinutes`（既定 30 分）以内 → 電話。
- 残り 0 → ×、残り `phoneMarkRemaining`（既定 1）以下 → △（`few`。WEB で予約できる）、それ以外 → ○。過去 → ×。

### 7-8. 予約の受け付け（`pub_reserve`）
- チェック：区分・名前（「様」を除く、40 文字まで）・日本の電話番号・通院中は診察券番号が必須・紹介コード。
- 公開中か、予約できる日数内か（違えば 409）。
- `GET_LOCK('reserve:店舗:日付')` とトランザクションの中で：同じ日に同じ電話と名前の予約が無いか → 先の予約が `maxActiveBookings`（既定 4）件以下か → もう一度空きを計算して ○ か → いちばん若いベッドに `reservation` とセルを入れる。
- その後 SMS（Twilio を設定したときだけ）で確認ページ `/r/{token}` を送る。

---

## 8. 画面（`frontend/`）

### 8-1. ルーティング（`frontend/src/main.tsx`）

| パス | 画面 | 対象 |
|---|---|---|
| `/`・`/stores` | 店舗選び | お客様 |
| `/s/:code` | 予約ページ（`Booking.tsx`） | お客様 |
| `/r/:token` | 予約の確認 | お客様 |
| `/my` | この端末の予約 | お客様 |
| `/privacy` | プライバシーポリシー | お客様 |
| `/admin/login`（`/:code`） | ログイン | |
| `/admin/day/:date` | 予約表（`DayPage` → `DayGrid`） | 店舗 |
| `/admin/shifts` ・ `settings` ・ `reservations` ・ `staff-counts` | シフト・店舗設定・WEB 予約・担当数 | 店舗 |
| `/admin/karte` ・ `churn` ・ `madoguchi` ・ `report` ・ `jibai` ・ `story` | 継続率・離反者・窓口・日報・自賠・ストーリー | 店舗 |
| `/admin/hq` ・ `hq/overview` ・ `hq/karte` ・ `hq/jibai` ・ `hq/accounts` ・ `staffing` ・ `acct` | 本部・全店舗・アカウント・人員・経理 | 本部など |
| `/admin/updates` ・ `guide` | 更新のお知らせ・使い方 | 全員 |
| `/admin/print/:date` | 予約表の印刷 | 店舗 |

- `Layout.tsx`：上のメニュー・店舗の切り替え・未入力の件数のバッジ。`?store=CODE` 付きで開くと本部・MG は自動でその店舗へ切り替える（通知のリンク用）。

### 8-2. 決まり
- API は `frontend/src/lib/api.ts` を通す（`Content-Type: application/json`）。
- 型は `lib/types.ts`。
- 画面の部品には `aria-label` を付ける（テストで探すため）。
- お客様向けの入力欄は 16px 以上（iPhone で拡大されないように、`.pub`）。
- 予約ページの下には電話と相談 LINE の帯を固定（`.has-dock`）。
- 端末に残す値は `localStorage` の `natsume.*`（見た「更新のお知らせ」・提案を出した日・お客様の予約など）。

### 8-3. 更新のお知らせと使い方
- `changelog.ts`：`{id, date, title, audience, items}` の一覧。`id` は増やすだけ。ログイン後、まだ見ていないものを出す（`natsume.seenChangeId`）。
- `components/UpdateNotice.tsx`：2 分ごとに `version.json` を見て、版が変わっていたら「画面が新しくなりました」の帯（`version.json` はビルド時に `changelog.ts` から書き出す）。
- `lib/guide.ts`：画面の「使い方」と「よくある質問」。画面写真は `public/guide/*.png`。

---

## 9. データベース

### 9-1. 主な表

| 表 | 内容 |
|---|---|
| `global_setting`（1 行） | 枠の長さ、新規・通院中の枠数、締め切り、祝日休み、管理画面の追加枠、保持日数、営業時間 JSON、店舗選びページ、相談 LINE、LINE のトークン、通知での氏名の出し方 |
| `store` | 店舗：コード、名前、電話、ベッド数、公開日数・予約できる日数、先の予約の上限、調整値、営業時間の上書き、住所・地図、並び、`hqOnly`・`jibaiOnly` |
| `admin_account` | ログイン：コード、パスワード（bcrypt）、役割、店舗、エリア、`sessVer` |
| `cell` | **予約表のセル（埋まりの正本）**：店舗・日付・時刻・ベッドで 1 つ。文字・電話・来院・WEB 予約・メニュー・担当 |
| `reservation` | WEB 予約：区分・診察券番号・名前・電話・状態・確認ページの鍵・紹介元 |
| `day_status` | 日ごとの公開・休業・メモ・人数の上書き |
| `staff_member`・`shift`・`help_in` | スタッフ（初回・再来の担当可、休職）・シフト・応援 |
| `slot_block`・`kind_block`・`block_suggest` | ブロック・新規／再来の受付停止・提案 |
| `special_day` | 特別営業日 |
| `cancel_log`・`cell_log` | キャンセル名簿・取り消し用の記録 |
| `patient_card` | 診察券番号と氏名（レセコンから取り込み） |
| `referral` | 紹介元・媒体の QR |
| `campaign` | 経路別キャンペーン（route = card／ref:コード。内容・保険の目安を出すか・はじめに選ぶ区分・期間・店舗・店舗向けメモ）。予約したときの内容は reservation.campaign（JSON）に残し、店舗向けメモは患者様に返さない |
| `karte`・`karte_option` | 新患継続率の行（事故日・事故内容・通知日時を含む）と選択肢 |
| `churn`・`follow`・`visit_archive` | 離反者・フォロー・削除前の来院の控え |
| `madoguchi_*`・`goods_item` | 窓口集計・物販 |
| `report_*` | 日報 |
| `jibai_*` | 自賠請求 |
| `jibai_notify`・`line_target` | 新自の通知先（メール・LINE） |
| `area` | エリア（店舗コードの一覧）。MG の担当・並び・通知の送り先 |
| `site_page` | プライバシーポリシーなどの文 |
| `audit_log`・`rate_limit`・`app_meta` | 操作の記録・回数制限・DB の版 |

### 9-2. 版上げ（`app/lib/Migrate.php`）
- `Db::pdo()` の最初の接続で `Migrate::run()`。`app_meta` の版が `VERSION` より古ければ、`if ($ver < N)` の手順を順に実行（`hasColumn`・`hasTable` で何度実行しても同じ結果になるように）。
- `/install` の前（`staff_member` が無い）なら何もしない。
- 新しい項目を足すときは **`VERSION` を 1 上げ、手順を足し、`schema.sql` も同じ形にする**。

| 版 | 主な追加 |
|---|---|
| 1〜10 | スタッフの期間・応援・ブロック・継続率・アカウント・操作の記録・メニュー・確認ページ・担当 |
| 11〜20 | 初回／再来の担当可・診察券・店舗選び・紹介元・特別営業日 |
| 21〜30 | セルの電話・自賠のみの店舗・窓口・人員・離反者・半日休業・本部の休業・セッションの版 |
| 31〜35 | 店舗選びの並び・休職・受付停止・日報・提案 |
| 36 | 事故日・事故内容・通知日時、相談 LINE、通知メール |
| 37 | LINE のトークン・送り先 |
| 38 | 通知での氏名の出し方 |
| 39 | 新規・再来・合計の調整値 |
| 40 | 新患継続率の氏名の空白を取る（データの整え） |
| 41 | 新患継続率の名字の文字数（surnameLen） |
| 42 | メニューに「第三者」「自賠」を足す（新三の区分と合わせて） |
| 43 | 通知の患者様を「予約表のとおりの氏名」に（notifyName surname → full） |
| 44 | 媒体を使う店舗（referral.stores） |
| 45 | ストーリー画像のテーマ（store.storyTheme） |
| 46 | 経路別キャンペーン（campaign 表・global_setting.insuranceTable・reservation.campaign） |

---

## 10. 自動の削除（Cron）
`cleanup_run()`（`handlers/misc.php`）：
1. `今日 − retentionDays`（既定 60 日）より前の来院済みセルを `visit_archive` に控える。
2. それより前の `cell`・`day_status`・`shift`・`help_in`・`slot_block`・`kind_block`・`block_suggest` を消す。
3. 自賠請求の氏名を保持日数（既定 180 日）で消す。

`reservation`・`cancel_log`・`cell_log`・`karte`・`churn` は消さない。

---

## 11. 通知

| 通知 | いつ | 仕組み |
|---|---|---|
| 予約の確認 SMS（お客様） | WEB 予約のとき | `Sms::send`（Twilio）。設定が空なら送らない |
| 新着 SMS（店舗） | 同上 | `store.notifyPhone` があるとき |
| 新自の来院（本部・MG） | 予約表で新自に来院チェックが付き、継続率の行が自動でできたとき（その日か前日の分だけ） | `Karte::notifyAccident` → `Mail::send` と `Line::push`。送り先はエリアで絞る。同じ枠は 3 日間 1 回だけ（`accnotify:` の回数制限と `notifiedAt`） |
| 画面の中の新着 | 予約表を開いているとき | `WebNotifier`（`/api/admin/web-new` を定期的に見る） |

- 通知の文：店舗名・日時・区分・患者様（`notifyName`：出さない／診察券番号／姓／氏名）・事故日・リンク `{APP_URL}/admin/karte?store=CODE`。
- LINE：トークンとシークレットは本部の画面で入れ、DB に保存（画面には返さない）。送り先は本部で 6 桁の番号を発行し、LINE で送ってもらって登録。
- テスト時（`MAIL_LOG` を入れる、または本番以外）は送らずにファイルへ書く。

---

## 12. 安全と個人情報

- `config.php` は Git・zip に入れない。`INSTALL_TOKEN` は設置後に空、`APP_ENV` は `production`。
- 管理画面・API は他サイトから埋め込めない。公開ページも親ドメインからだけ。
- 書き込みは JSON 必須 + SameSite=Lax、フォームは同じサイトか確認。
- 回数制限：ログイン・予約・確認ページ・店舗選び。
- 確認ページは推測できない 32 桁の鍵で、予約日の翌日まで。
- お客様向け API は個人情報を返さない（空きの数だけ）。
- 操作の記録には値を残さない。
- CSV の書き出しは BOM 付き、数式として読まれる先頭文字を無害化。
- 自賠請求の氏名は保持日数で自動で消す。通知に載せる氏名は本部の設定で選ぶ。

---

## 12-2. 決めてある計算式（まだ画面は作っていない）

### 店舗生産性の人数（依頼者の決定 2026-10-28）
店舗生産性を出すときの「人数」は、**施術者を 1 人、受付を 0.5 人**として数える。

```
人数（人工）＝ 施術者の人数 × 1 ＋ 受付の人数 × 0.5
店舗生産性 ＝（売上などの分子）÷ 人数（人工）
```

- 施術者・受付は `staff_member.role`（THERAPIST／RECEPTION）。登録後に店舗設定で変えられる。
- 分子（売上・来院数など）と期間（日・月）、休み・半休・応援の数え方は、会計系（2027年4月開始）で決める。
- 作るときは `app/lib` に計算をまとめ、本部・店舗の画面と単体テストを足す。

## 13. テスト

| 種類 | 場所 | 動かし方 |
|---|---|---|
| 計算の単体テスト | `frontend/src/lib/*.test.ts` | `cd frontend && npx vitest run` |
| 画面からの確認テスト | `e2e/*.mjs`（44 本） | `.claude/skills/e2e-test/SKILL.md` |
| 自動 | `.github/workflows/deploy-xserver.yml` | `main` への push でビルド・テスト |

テストの一覧は `OPERATIONS.md` §7。
