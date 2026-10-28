# 別の事業体へ展開する手順（カスタマイズガイド）

このシステムは接骨院グループ向けに作られています。別の事業体（例：整体院・美容室・歯科・スクールなど）で
**別のプロジェクトとして**動かすときに、どこを・どの順で変えるかをまとめます。

- 作りの全体は `DESIGN.md`、設置・更新は `OPERATIONS.md` を見てください。
- 行番号（`ファイル:行`）は 2026-10-28 時点の目安です。ずれていたら、近くの同じ名前の関数・定数を探してください。
- 変えやすさの印：**【設定】** 画面や DB で変えられる／**【1か所】** 1 つの定数・ファイル／**【散らばり】** 何か所もそろえて直す必要がある

---

## 0. 全体の流れ

```
① 聞き取り（下の「聞き取りシート」）
② リポジトリを分ける（xserver/ を新しいリポジトリのいちばん上にする）
③ 名前・ブランド・ドメインを変える            ← 1 日
④ 時間枠・営業時間・祝日を合わせる            ← 半日
⑤ 来院区分（初めて／2 回目以降 など）と予約表の印を合わせる ← いちばん手間。先に作りを整理する（§9）
⑥ メニュー・選択肢・物販を入れ替える
⑦ 使わない機能を外す（自賠請求・窓口集計・日報 など）
⑧ 患者様（お客様）向けの文言・プライバシーポリシーを書き直す
⑨ 確認テストを新しい事業に合わせて直し、全部通す
⑩ 新しいサーバーに設置（OPERATIONS.md）→ 試験運用 → 本番
```

---

## 1. 聞き取りシート（展開先の事業体に確かめること）

| # | 聞くこと | 例 | 影響する場所 |
|---|---|---|---|
| 1 | 事業体の名前・ブランド名・ロゴ・色 | 「〇〇整体グループ」・ロゴ画像・#2a7 | §2 |
| 2 | 予約システムの URL（ドメイン） | `yoyaku.example.jp` | config.php の `APP_URL` |
| 3 | 店舗の数・エリア分け | 5 店舗・2 エリア | 本部の画面【設定】 |
| 4 | **予約の時間の単位** | 15 分・30 分・60 分 | §3（`slotMinutes`） |
| 5 | **1 回の予約で使う枠の数**（初めての方・2 回目以降） | 初回 2 枠・2 回目以降 1 枠 | §3・§4 |
| 6 | 営業時間（午前・午後に分かれるか）・休業日・祝日に休むか | 10:00〜19:00 通し・水曜休み | §3 |
| 7 | **お客様の区分**（WEB 予約で最初に選ぶもの） | 初めて／通院中／しばらくぶり | §4 |
| 8 | 同じ時間に何人受けられるか（ベッド・席・スタッフの数） | ベッド 4・スタッフで決まる | 店舗設定【設定】 |
| 9 | スタッフの役割（施術者・受付 など）と「初回を担当できる人」の区別 | | §4・店舗設定 |
| 10 | メニュー・物販・回数券 | カット・カラー・回数 | §5 |
| 11 | 使う機能・使わない機能（下の §6 の一覧を見せて選んでもらう） | | §6 |
| 12 | 患者様（お客様）への案内文（持ち物・支払い・遅刻のとき） | | §7 |
| 13 | 個人情報の扱い・プライバシーポリシーの内容・問い合わせ先 | | §7 |
| 14 | 通知（WEB 予約が入ったとき・特定の区分が来院したとき）を誰に・何で | LINE・メール | §6 |
| 15 | 呼び方（「患者様」→「お客様」、「来院」→「来店」、「施術」→「施術／カット」） | | §7 |

---

## 2. 名前・ブランド・ドメイン

| 変えるもの | 場所 | 印 |
|---|---|---|
| ページの題名「接骨院 WEB予約」 | `frontend/index.html:7` | 1か所 |
| グループ名「なつめ接骨院グループ」 | `frontend/src/components/PublicFooter.tsx:9`、`frontend/src/pages/Privacy.tsx:25`、`frontend/src/pages/admin/Layout.tsx:73`（本部の見出し）、`app/lib/Mail.php:36`（メールの差出人名）、`frontend/src/lib/privacy.ts` | 散らばり（5 か所） |
| ロゴ | `public/brand/*.png` と `frontend/src/pages/Stores.tsx:31-32`（alt の文） | 1か所 |
| 色（ブランドカラー） | `frontend/tailwind.config.ts` の `brand`（DEFAULT・dark・light）。患者様の画面の水色 `#1eb3e8` などは `Stores.tsx` の `SKY` | 1か所＋α |
| ストーリー画像の色 | `frontend/src/components/StoryCanvas.tsx:19-29` | 1か所 |
| 「接骨院」という言葉 | `frontend/src/pages/Home.tsx:6`、`app/sql/schema.sql:1`、`public/.htaccess:1`、`README.md`、`frontend/src/pages/admin/ReportPage.tsx:69-118`（店舗名を「接骨院」で区切る） | 散らばり |
| ドメイン | `app/config.php` の `APP_URL`。README・コメントの `hachimaru-80skip.com` も書き換える | 設定 |
| ブラウザに保存する名前 `natsume.*` | `lib/api.ts:8`、`lib/myReservations.ts:3`、`lib/patientMemory.ts:3`、`components/UpdateNotice.tsx:9`、`components/DayGrid.tsx:674`、`components/BlockSuggestions.tsx:29`（同じ端末で両方を使うとき混ざらないよう、新しい名前にする） | 散らばり（6 か所） |
| Cookie 名 `bk_session` `bk_store` | `app/lib/Auth.php:7-8`（同じドメインで 2 つ動かすときだけ変える） | 1か所 |
| `frontend/package.json` の `name`、メールのログ名 `natsume-mail.log`（`app/lib/Mail.php`） | | 1か所 |
| テストの `skipWhatsNew` が使う保存名 | `e2e/seen.mjs` | 1か所 |

---

## 3. 時間枠・営業時間・祝日

| 変えるもの | 場所 | 印 |
|---|---|---|
| 予約の時間の単位（既定 15 分） | 本部の画面「全店共通の設定」`slotMinutes`（`app/sql/schema.sql:6`、検証 `app/handlers/hq.php:100-110`） | **設定** |
| 1 回の予約で使う枠の数（初回 2・通院中 1） | 本部の画面 `newVisitSlots` / `returnVisitSlots`。**ただし予約表側は「2 枠目は 1 つ下のセル」を前提にしている**（§4-3） | 設定＋散らばり |
| WEB の受付締め切り・電話マークにする残り数 | 本部の画面 `webCutoffMinutes` `phoneCutoffMinutes` `phoneMarkRemaining` | 設定 |
| 営業時間の初期値 | `app/lib/Hours.php:9-27`（期間つきの値が入っている。新しい事業の時間に書き換える）。入れたあとは本部の画面で変えられる | 1か所＋設定 |
| 営業時間の入力欄の「よくある時間」 | `frontend/src/components/HoursEditor.tsx:13` | 1か所 |
| 午前・午後の 2 つに分かれる前提 | `Hours::NOON`（`app/lib/Hours.php:7`）・`frontend/src/lib/hours.ts:7`、1 日 2 つまでの入力（`frontend/src/lib/hoursForm.ts`）、枠数も午前・午後で持つ（`capacityAm/Pm`）。通し営業なら「午前だけ使う」形で動く。3 つ以上に分けるなら作りの見直しが要る | 散らばり |
| 祝日に休むか | 本部の画面 `closeOnHolidays` | 設定 |
| 祝日の計算（日本の祝日） | `app/lib/Holidays.php`（日本以外なら作り直し） | 1か所 |
| 時間帯（日本時間） | `app/bootstrap.php:5`、`app/lib/Time.php`、`frontend/src/lib/time.ts` | 散らばり |
| 店舗ごとの既定（ベッド 8・WEB 解放 3・公開 30 日・1 人 4 件・14 日先まで） | `app/sql/schema.sql` の `store`（入れたあとは店舗設定） | 設定 |
| そのほかの時間の決まり | 予約時刻を 30 分過ぎたら未チェック（`frontend/src/lib/attendance.ts:4`）、ブロックの提案は 14 日先まで（`app/lib/BlockSuggest.php:12`）、ログインは 12 時間（`app/lib/Auth.php:9`） | 1か所 |

---

## 4. 来院区分と予約表の「印」（いちばん大事）

### 4-1. 来院区分

今は 4 つで固定です：`NEW`（はじめて：ケガ・痛み）・`ACCIDENT`（はじめて：交通事故）・`RETURN`（通院中）・`REVISIT`（1 か月以上ぶり）。

| 何が決まっているか | 場所 |
|---|---|
| 区分の一覧・日本語名 | `app/lib/PublicApi.php:7-8,27-32`、`app/lib/Karte.php:7`、`frontend/src/components/WeekGrid.tsx:6-18`、`frontend/src/components/PhoneBookingDialog.tsx:7-12`、`frontend/src/lib/karte.ts:2,16-17` |
| 患者様に見せる文（はじめての方（ケガ・痛み・不調など）など） | `WeekGrid.tsx:11-18`、`frontend/src/pages/ReservationView.tsx:9` |
| スタッフに見せる名前（新患・初自・再 など） | `frontend/src/components/DayGrid.tsx:27`、`frontend/src/pages/admin/ReservationsPage.tsx:11`、`KarteHqPage.tsx`、`KartePage.tsx`、`app/handlers/karte.php`（Excel）、`app/lib/Churn.php:140`、`components/WebNotifier.tsx:7` |
| 区分ごとの決まり | 通院中だけ診察券番号が必須（`app/handlers/public.php:67,108`・`BookingApp.tsx:133-136`）、「10 分前にお越しください」（`public.php:122`・`BookingApp.tsx:192`）、新規・再来を止める（`kind_block.kinds` の N/R）、新規に数える（NEW と ACCIDENT）・再来に数える（REVISIT）（`PublicApi.php:147,154`） |
| WEB で同時に受ける人数 | スタッフの「初回を担当する」「再来を担当する」と、店舗設定の足し引き（`Availability.php`・`Settings::capacityFromShifts`） |

**区分を減らす**（例：交通事故の区分が要らない）は、患者様の選択肢から外すだけで動きます（`WeekGrid.tsx` の `GROUP_LABEL`・`KIND_TEXT`）。
**区分を足す・意味を変える**ときは、§9 の整理を先にしてください。

### 4-2. 予約表のセルの「印」

予約表は表計算ソフトのように自由に文字を入れられ、**区分はセルの文字の印から読み取っています**（データとして別に持っていない）。

| 印 | 意味 | 読み取る場所（PHP と TS で同じ規則） |
|---|---|---|
| （初診）（初）・初診 | 新規 | `app/lib/Text.php:26-35` `categorize`、`frontend/src/lib/attendance.ts:7-30` |
| （初自）・新自・初自 | 新規（交通事故） | 同上・`app/lib/Karte.php:54-69` |
| （再）・再来・再診 | 再来 | 同上 |
| 自賠・事故 | 自賠の人数に数える | 同上 |
| 上記初診対応・上記再来対応・〃 | 2 枠目（人数に数えない） | `Text.php:8-12`、`app/lib/Availability.php:155-156` |
| 〃 ✖ × - 休 など | 患者様ではない（枠を埋めるだけ） | `Availability.php:155` `NOT_A_PATIENT` |

印を**書き込む**場所：WEB 予約（`PublicApi.php:11-25` `cellName`）、スタッフのボタン（`frontend/src/lib/kindTag.ts`）、電話予約（`DayGrid.tsx:565-566`）。
印を**使う**場所：空き枠の計算・予約表の色（`frontend/src/lib/cellColor.ts`）・新患継続率・日報（`Report.php`）・離反（`Churn.php`）・臨時休業（`handlers/closure.php`）・本部の集計（`handlers/hq.php`）・担当数（`handlers/admin.php`）。

→ 印の言葉を変えるときは、**PHP の `Text.php` と TS の `attendance.ts`・`kindTag.ts`・`cellColor.ts` を必ずそろえて**直し、`e2e/smoke.mjs`・`capkind.mjs`・`karte.mjs` を通します。

### 4-3. 「2 枠目は 1 つ下のセル」の前提

`newVisitSlots` を 3 以上にすると、予約表の移動・キャンセル・色分けが正しく動きません（2 枠目だけを見ている）。
場所：`DayGrid.tsx`（`twoSlots`）、`ChangeDialog.tsx:40`、`PhoneBookingDialog.tsx`、`app/handlers/admin.php:312-313,356-357`（`Text::isTwoSlotName`）、`Text.php:15-19`、`attendance.ts:32-36`、`PrintPage.tsx`、`BlockSuggest.php:43`。
→ 3 枠以上が要る事業なら、「続きのセルが何個あるか」を数える形に直します（§9）。

---

## 5. メニュー・選択肢・物販

| 変えるもの | 場所 | 印 |
|---|---|---|
| メニュー（矯正・2回目・3回目・6回目・12回目・ワンコイン・自費・ワクスキ）・物販（テープ・プロテイン…）・きっかけ・他事業紹介・キャンペーン・症状カテゴリー・再来アクション の**初期値** | `app/lib/Karte.php:12-21` `OPTION_DEFAULTS`。入れたあとは本部「新患・再来集計（全店）」の「選択肢」で変えられる | 1か所＋設定 |
| 古いバージョンで選択肢を足す・消す処理 | `app/lib/Migrate.php` の `ver < 13・14・16・17` あたり（新しいプロジェクトでは最初から新しい選択肢にし、この処理は外す） | 散らばり |
| 内訳が必要なきっかけ（紹介他事業・キャンペーン・イベント・業者紹介） | `Karte.php:23` `DETAIL_FOR`（**選択肢の名前で結び付けている**ので、名前を変えるならここも） | 1か所 |
| 施術内容（矯正・マッサ） | `Karte.php:8`、`frontend/src/lib/karte.ts:18`、`ChurnPage.tsx:126`、`karteImport.ts:109` | 散らばり |
| 回数のメニュー「n回目」（2〜6 回目を新患継続率に数える） | 正規表現 `/^\d+回目$/`：`Karte.php:187-202`、`admin.php:159,217`、`cellColor.ts:17`、`menus.ts:6`、`karteImport.ts`。数える回数 `Karte.php:9 VISITS=5` と `karte.ts:19 VISIT_COUNT` | 散らばり |
| 特別な色・集計 | 矯正のセルの縞模様（`cellColor.ts:15-16`）、自費の人数（`Report.php:132`） | 1か所 |
| 物販の値段・原価 | 本部の画面「物販」 | 設定 |

---

## 6. 使う機能・使わない機能

接骨院に特有の機能が多くあります。使わない機能は「画面のメニューから外す」だけでも十分です（API とテーブルは残っていても害はない）。

| 機能 | 中身 | 外すときに触る場所 |
|---|---|---|
| WEB 予約・予約表・シフト・キャンセル名簿 | 中心の機能（外さない） | — |
| 店舗えらびページ・紹介 QR・媒体 QR | `/stores`・紹介元ごとの QR | 本部の画面で「公開しない」 |
| 新患継続率・新患・再来集計・担当数 | 初めての方が 2〜6 回目まで来たか | `Layout.tsx` のメニュー、`main.tsx` の画面 |
| 新自（交通事故）の事故日・通知（LINE・メール） | 交通事故の方の記録と通知 | `AccidentList.tsx`、`Karte::notifyAccident`、本部の「新自の通知」 |
| 自賠請求（OCR） | 自賠責の請求書のスクショを読み取って集計 | メニュー・`JibaiPage`・`public/tesseract`・`public/tessdata`・`tesseract.js`（外すと画面が軽くなる） |
| 窓口集計・経理 | 窓口の合計・入金・物販・返戻（保険の言葉が多い：`app/lib/Madoguchi.php:8-16`） | メニュー・`MadoguchiPage`・`AcctPage` |
| 日報 | スプレッドシートと同じ形の日報（`app/lib/Report.php:11-70` の項目） | メニュー・`ReportPage`。項目は本部の画面で変えられる |
| 離反・2 週間フォロー | 来なくなった方の記録 | メニュー・`ChurnPage` |
| 人員の過不足 | 店舗ごとの必要人数と在籍 | 本部・MG のメニュー |
| 新規・再来ブロックの提案 | 担当できる人が全員ふさがったら止める提案 | `BlockSuggestions`（スタッフの「初回を担当する」を使わない店舗では出ない） |
| 交通事故の相談 LINE の帯 | 予約ページの下 | 本部の画面で URL を空にする。文言は `ConsultLineBanner.tsx`・`Booking.tsx` |
| ストーリー画像 | Instagram 用の空き状況の画像 | 「その他」メニュー |
| SMS | 予約完了の SMS（本文に「現金のみ・マイナンバーカード」：`public.php:121-125`） | config の `TWILIO_*` を空に |
| 患者一覧の取り込み（CSV） | レセコンの CSV（診察券番号が 6 桁＋x/a/r）：`frontend/src/lib/patientCsv.ts`・`admin.php:1052-1087` | 店舗設定の欄 |

メニューは `frontend/src/pages/admin/Layout.tsx:92-133`、画面のルートは `frontend/src/main.tsx:63-79`、API は `app/routes.php`。
「機能ごとに ON/OFF できる設定」にしておくと、次の展開が楽になります（§9）。

---

## 7. お客様向けの文言・個人情報

| 変えるもの | 場所 |
|---|---|
| 予約ページの注意書き（15 分以上前後・予約優先制・急患） | `frontend/src/components/BookingApp.tsx:68-72` |
| 持ち物・支払い（現金のみ・マイナンバーカード・受給者証） | `BookingApp.tsx:190-192`、`ReservationView.tsx:57-58`、`public.php:122-125`（SMS） |
| 区分の説明・「診察券番号をご用意ください」 | `WeekGrid.tsx:11-18,137` |
| 呼び方（患者様・ご来院・診察券・施術・休診） | `BookingApp.tsx`、`WeekGrid.tsx`、`ReservationView.tsx`、`MyReservations.tsx`、`PublicFooter.tsx`、`UrlQrCard.tsx`、`DayGrid.tsx` など（「患者様」で検索） |
| 電話番号の形（日本の番号） | `app/lib/Text.php:38-54`、`frontend/src/lib/format.ts:4-10` |
| 住所から市・町を取り出す（日本の住所） | `frontend/src/lib/city.ts` |
| プライバシーポリシーのひな形 | `frontend/src/lib/privacy.ts:5-60`（会社名・電話・療養費・自賠責・サーバー会社）。本部の画面で書き直して公開 |
| 店舗えらびページの見出し | `frontend/src/pages/Stores.tsx` |
| 通知の文（【新自】…） | `app/lib/Karte.php`（`notifyAccident`）、`app/handlers/hq.php`（試し）、`app/handlers/public.php`（LINE の返事） |
| 使い方（ヘルプ）・更新のお知らせ | `frontend/src/lib/guide.ts`・`public/guide/*.png`（書き直し・撮り直し）、`frontend/src/changelog.ts`（新しいプロジェクトでは空から始める） |

---

## 8. 初期データ・テスト

- インストール時の本部アカウント `HQ`・見本の店舗 S001 / S002（`app/lib/Install.php:23-38`）。見本の店舗は本番では消す。
- 確認テスト（`e2e/*.mjs`）は接骨院の言葉（（初診）・初自・矯正 など）を使っています。§4・§5 を変えたら、テストも新しい言葉に直してから全部通します（`.claude/skills/e2e-test/SKILL.md`）。
- 使い方の画面写真は `e2e/guide-shots.mjs` で撮り直せます。

---

## 9. 展開の前にしておくとよい整理（作りの改善）

展開先が 1 つだけで、区分・印・2 枠が今と同じなら不要です。違うときや、今後も展開するときはこれを先にすると、あとが楽になります。

1. **区分の定義を 1 か所に**：PHP に `app/lib/Kinds.php`、TS に `frontend/src/lib/kinds.ts` を作り、区分のコード・名前（お客様用・スタッフ用）・色・使う枠の数・数え方（新規／再来）をそこにまとめる。今の散らばった定義はそれを読む形に直す。
2. **印の規則を 1 か所に**：`Text.php` と `attendance.ts`・`kindTag.ts`・`cellColor.ts` の正規表現を、上の定義から作る。PHP と TS の両方で同じ例を確かめる単体テストを置く。
3. **「続きのセル」を数で扱う**：`isTwoSlotName`（次の 1 つだけ）を「続きの印のセルが何個続くか」に直し、`newVisitSlots` を 3 以上にしても移動・キャンセル・色が正しく動くようにする。
4. **機能の ON/OFF**：`global_setting` に「使う機能」の一覧を持ち、メニュー・画面・API をそれで出し分ける（外した機能の API は 404）。
5. **ブランドの値を 1 か所に**：グループ名・ロゴ・色・呼び方（患者様／お客様）を `frontend/src/brand.ts`（と PHP の設定）にまとめる。

どれも、直したら全部のテストが通ることを確かめてから次に進みます。

---

## 10. チェックリスト

- [ ] 聞き取りシートの 15 項目がそろった
- [ ] 新しいリポジトリを作った（`xserver/` をいちばん上に。`app/config.php` は入れない）
- [ ] 名前・ロゴ・色・ドメイン・保存名（`natsume.*`）を変えた
- [ ] 時間の単位・営業時間の初期値・祝日を合わせた
- [ ] 区分・印を合わせた（必要なら §9 の整理を先に）
- [ ] メニュー・選択肢・施術内容の初期値を入れ替え、古い Migrate の選択肢の処理を外した
- [ ] 使わない機能をメニューから外した
- [ ] お客様向けの文言・注意書き・SMS・通知の文を書き直した
- [ ] プライバシーポリシーのひな形を新しい事業体の内容にした
- [ ] 使い方（ヘルプ）を書き直し、画面写真を撮り直した。更新のお知らせを空から始めた
- [ ] 確認テストを直し、全部通った
- [ ] 新しいサーバーに設置し、`INSTALL_TOKEN` を空にした。見本の店舗を消した
- [ ] 試験運用（数日）→ 本番
