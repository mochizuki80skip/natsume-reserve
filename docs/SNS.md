# SNS 投稿管理（Instagram ＋ Google ビジネスプロフィール）設計書

部下の方が作成した「SNS 投稿の自動化ツール」の設計図（Vercel ＋ Upstash ＋ Claude／Gemini 版）を、接骨院 WEB 予約システム（Xserver 版：PHP ＋ MySQL ＋ React）に合わせて組み込んだものです。
**生成 AI（Claude API・Gemini 画像生成）は使っていません。** 課金が発生しないよう、文章は「ネタ ＋ 文章の型」から組み立て、画像はブラウザで描きます。生成 AI を組み込む場合の案は末尾にまとめました。Yahoo!プレイスは対象外です。

## 1. 何をするか

```
毎朝（自動、Cron）
  ├─ 承認済みで予定時刻を過ぎた下書き → Instagram／Google に投稿（5〜10 分おきに確認）
  ├─ 先の下書きを作る（既定 60 日先まで。ネタと文章の型から組み立て）→ 通知「下書きができました」
  ├─ 24 時間以内に予定の未承認 → 通知「承認待ちがあります」
  ├─ Instagram のトークン更新（60 日で切れるため 30 日ごと）
  ├─ 数字の取り込み（Instagram：フォロワー・リーチ・投稿ごとの数字、Google：表示回数・電話・ルート・クチコミ）
  └─ 毎週月曜に週まとめを通知

人がやること
  店舗または本部が管理画面で下書きを見る → 直す（文章・画像・ネタ・パターン）→ 承認
  月に 1 回「分析」の気づきを見て、ネタ・頻度・運用メモを見直す
```

- **承認していない下書きは絶対に投稿しない**（元の設計図と同じ）。
- 24 店舗を 1 つの管理画面で扱う。店舗は自店舗だけ、本部は全店舗を見られる（既存のログインをそのまま使う）。
- Google の API 利用許可が出るまでは「手動投稿の補助」（本文コピー → Google の画面に貼る → 「投稿した」）。Instagram も連携前は同じ。

## 2. 元の設計図との違い（接骨院用に変えた点）

| 項目 | 元の設計図 | この実装 | 理由 |
|---|---|---|---|
| 基盤 | Vercel Serverless ＋ Upstash Redis | Xserver の PHP ＋ MySQL（既存の予約システムに同居） | 既に本番で動いている環境・ログイン・店舗マスタ・Cron を使う。追加費用なし |
| 文章 | Claude API が生成 | **ネタ（見出し＋本文）× 文章の型（書き出し・締め・キーワードの文）** を組み合わせる。「別のパターン」で型を切り替え | 生成 AI の費用をゼロにする。誤字・言い過ぎ・他言語混入の心配もない |
| 画像 | Gemini で生成／@napi-rs/canvas でサーバー描画 | **ブラウザで描く定型画像**（1080×1080、白／紺／ブランド色の 3 種）または写真をアップロード（1080px に縮小して JPEG） | Gemini は課金必須。サーバーに日本語フォントを置く必要もなくなる |
| 図解・リール | Claude ＋ Gemini ＋ ffmpeg | 対象外 | 生成 AI と動画処理が必要なため。必要になれば「AI 案」参照 |
| ログイン | パスワード 1 つ | 既存の店舗／本部アカウント | 店舗ごとに権限を分ける |
| 下書きの保存 | Redis ハッシュ | MySQL の `sns_post` 表 | 同時更新の問題は DB が解決 |
| Google | 手動投稿のみ（API 許可待ち） | **API 連携を実装済み**（投稿・パフォーマンス指標・クチコミ取得と返信）。許可が出るまでは手動投稿 | 24 店舗の MEO 分析が目的のため |
| 通知 | LINE | LINE（Messaging API）。無ければメール（PHP の mail）。どちらも無ければログ | Xserver では mail() が使えるため、LINE 公式アカウントが無くても始められる |
| 分析 | Claude の月次分析 | ルールに基づく「気づき」（前期間比 ±20％ 以上、保存が多い投稿、リーチが高い曜日、未返信のクチコミ）。CSV 出力 | 数字そのものと比較は AI 無しで十分。解釈は人が行う |
| 広告規制 | 禁止語を AI に使わせない ＋ 保存前チェック | 禁止語リスト（本部が編集）で保存時・承認時・入力中にチェック。Google は NG なら承認不可、Instagram は警告 | 柔道整復師法・あはき法の広告制限、景品表示法 |

## 3. 画面

| URL | 誰が | 内容 |
|---|---|---|
| `/admin/sns` | 店舗・本部 | ホーム：承認待ち（近い日付順）、手動投稿、失敗、店舗ごとの件数、「下書きを今すぐ作る」 |
| `/admin/sns/posts` | 店舗・本部 | 投稿一覧（媒体切替、一覧／月カレンダー、選択して承認・削除、手で下書きを追加）。本部は `?store=コード` |
| `/admin/sns/posts/<id>` | 店舗・本部 | 下書きの詳細：左に画像（定型画像を描く／写真を選ぶ）、右に見出し・本文・締め・タグ・日時の編集、投稿文を直接編集、別のパターン、別のネタ、前後の投稿と入れ替え、承認／取消、今すぐ投稿、投稿した（手動）、削除。禁止語の警告、文字数、投稿後の数字 |
| `/admin/sns/topics` | 店舗・本部 | ネタの一覧と編集。全店共通（本部が管理）とこの店舗だけのもの。使う月の指定、使用回数 |
| `/admin/sns/settings` | 店舗・本部 | 投稿の有無・頻度（毎週○曜／毎月第○○曜 ＋ 時刻、全店共通の既定か店舗で決めるか）、地域・住所・営業時間・ハッシュタグ・検索キーワード・運用メモ、投稿文の見本、Instagram の連携ボタン |
| `/admin/sns/insights` | 店舗・本部 | 分析：期間（7／28／90 日）、店舗 × 媒体の数字と前期間比、店舗の詳細（気づき・投稿ごとの数字・クチコミと返信・日別）。本部は CSV 書き出し |
| `/admin/hq/sns` | 本部 | SNS 管理：接続状況（config.php の設定の有無）、各サービスに登録する URL、Google 連携と拠点の割り当て、店舗ごとの状態、全店共通の設定（既定の頻度・何日先まで・禁止語・文章の型・ハッシュタグ・LINE 通知先）、通知テスト、自動処理の手動実行と記録 |

## 4. データ（MySQL。`xserver/app/sql/sns.sql`。無ければ自動作成）

| 表 | 内容 |
|---|---|
| `sns_setting` | 全店共通：禁止語、文章の型、既定の頻度、何日先まで、通知の時間、共通ハッシュタグ、LINE 通知先 |
| `sns_store_setting` | 店舗ごと：Instagram／Google の有無と頻度（NULL なら共通の既定）、地域・住所・営業時間・タグ・キーワード・運用メモ |
| `sns_account` | 連携：店舗 × 媒体のトークン（**暗号化して保存**。libsodium、鍵は SNS_SECRET または SESSION_SECRET から）。Google の本部連携は storeId が NULL の 1 行。Google の拠点は店舗ごとの行に `accounts/…`＋`locations/…` |
| `sns_topic` | ネタ：見出し・本文・媒体（ig／gbp／both）・使う月・使用回数・最終使用日。storeId NULL は全店共通 |
| `sns_post` | 投稿：予定日時、状態（draft → approved → publishing → posted／failed）、見出し・本文・締め・タグ・組み立てた投稿文、型の番号、画像、投稿方法（api／manual）、承認者、投稿結果（外部 ID・URL・エラー） |
| `sns_post_stat` | 投稿ごとの数字（リーチ・いいね・コメント・保存・シェア）。毎朝上書き |
| `sns_insight_daily` | 店舗 × 媒体 × 日 × 指標（IG：followers／reach、Google：impressions_maps／impressions_search／calls／website_clicks／directions／conversations／bookings） |
| `sns_review` | Google のクチコミ（評価・本文・返信） |
| `sns_line_user` | LINE で話しかけてきた人（通知先の候補） |
| `sns_job` | 1 日 1 回の処理の実行記録（二重実行の防止） |

## 5. 文章の組み立て（生成 AI なし）

```
Instagram                             Google
{書き出し}                            {書き出し}（店名・地域入り）
                                      
■{見出し}                             {見出し}
{本文}                                {本文}
                                      
{締めの一言}                          「{地域} {キーワード}」でお探しの方は…（キーワードの文）
                                      {締め}（WEB 予約 URL・電話）
{ハッシュタグ}                        
                                      ■営業時間 …／■住所 …（店舗設定にあれば）
```

- 書き出し・締め・キーワードの文はそれぞれ複数の型を持ち、**型の番号（patternIdx）で巡回**する。「別のパターン」は番号を 1 進める。
- 差し込み語：`{店舗名} {地域} {電話} {予約URL} {月} {キーワード}`。電話・予約 URL は店舗マスタから自動。
- 検索キーワード＝「毎回入れる語」＋「日替わりの語（番号で巡回）」。
- ネタの選び方：「使用回数が少ない → 最後に使ってから長い」順。使う月の指定があればその月のものを優先。直近に使ったものは避ける。使えるネタが無い枠は作らず「ネタが足りません」を通知。
- 文字数の上限：Instagram 2,200、Google 1,500。超えると保存できない。
- 投稿文を**直接編集**した場合は、組み立てをやめてその文章をそのまま使う（見出し・本文を直すと組み立て直す）。

## 6. 投稿のしくみ

### Instagram（Instagram API with Instagram Login）

- 連携：店舗の設定画面「Instagram と連携する」→ Instagram のログイン画面で許可 → 戻ってくる（`/api/sns/ig/callback`）。短期トークンを長期トークン（60 日）に交換して暗号化保存。本部はトークンを直接貼ることもできる。
- 権限：`instagram_business_basic` `instagram_business_content_publish` `instagram_business_manage_insights`
- 投稿：`POST /{userId}/media`（image_url・caption）→ 取り込み完了を待つ → `POST /{userId}/media_publish`。画像は **公開 URL の JPEG が必須**（`public/media/sns/` に保存し、`APP_URL` で URL を作る）。
- トークン更新：`refresh_access_token`。取得から 24 時間以上たったものを 30 日ごとに。失敗したら通知。
- 数字：`/me`（followers_count）、`/{userId}/insights?metric=reach&period=day`、`/{mediaId}/insights`（reach・saved・shares、取れれば views）、like_count・comments_count。
- API のバージョンは `IG_API_VERSION`（既定 v23.0）。Meta が古いバージョンを終了したら config.php で上げる。

### Google ビジネスプロフィール

- 連携：本部が「Google と連携する」→ 全店舗を管理している Google アカウントで許可（スコープ `business.manage`、offline）→ 更新トークンを暗号化保存。「拠点を読み込む」で `accounts` → `locations` を取り、店舗ごとに拠点を割り当てる。
- 投稿：`POST /v4/{account}/{location}/localPosts`（languageCode ja、STANDARD、callToAction BOOK＝WEB 予約 URL、写真があれば media）。
- 数字：Performance API `fetchMultiDailyMetricsTimeSeries`（表示回数 4 種・電話・サイト・ルート・メッセージ・予約）。数日遅れて確定するため直近 10 日分を毎日取り直す。
- クチコミ：`/v4/…/reviews` を取り込み、画面から返信（`reply`）。返信にも禁止語チェック。
- **API の利用許可**：Google Cloud プロジェクトを作り、Business Profile API の「Application for Basic Access」から申請（オーナー確認から 60 日以上のプロフィール、ホームページが必要）。許可が出るまで API は 403 になる。連携と拠点の割り当て自体は許可前でも行える。
- 許可前（または拠点未割当）は自動で **手動投稿** 扱い：予定時刻に通知が届き、ホームの「手動で投稿するもの」から本文をコピーして Google の画面に貼る → 「投稿した」を押す。許可後は何もしなくても自動投稿に切り替わる。

### 自動処理（Cron）

`/api/cron/sns?token=CRON_SECRET`（または `php app/cron/sns.php`）を **5〜10 分おき** に呼ぶ。

| 処理 | いつ | 内容 |
|---|---|---|
| 投稿 | 毎回 | 承認済みで予定時刻を過ぎたものを送る（1 回 10 件まで）。`approved → publishing` に変えられた 1 プロセスだけが送るので二重投稿しない。予定を 2 日以上過ぎていたら送らず「失敗」にして通知 |
| 手動投稿の通知 | 毎回 | 手動投稿の予定時刻が来たら 1 回だけ通知 |
| 数字の取り込み | 5 時以降 1 日 1 回 | Instagram・Google の数字とクチコミ |
| 下書きの生成 | 6 時以降 1 日 1 回 | 全店舗 × 媒体で、予定枠に下書きが無ければ作る（1 店舗 1 媒体 10 件まで／回）。できたら通知 |
| トークン更新 | 6 時以降 1 日 1 回 | Instagram の長期トークン |
| 承認待ちの通知 | 9 時以降 1 日 1 回 | 設定時間以内に予定の未承認と、失敗したままの投稿 |
| 週まとめ | 月曜 9 時以降 | 店舗ごとの投稿数・IG リーチ・Google 表示・電話 |

## 7. 通知

LINE Messaging API（`LINE_CHANNEL_ACCESS_TOKEN`）があれば LINE に push／multicast。通知先は、通知を受けたい人が LINE 公式アカウントに 1 通送る → Webhook（`/api/sns/line-webhook`、署名検証）で userId を記録 → 本部の SNS 管理でチェック。LINE が無ければ `NOTIFY_EMAIL` にメール。どちらも無ければサーバーのログだけ。

## 8. 広告規制（柔道整復師法・あはき法の広告制限、景品表示法）

- 禁止語の初期値：治る／治り／治す／完治／根治／必ず／絶対／確実に／改善します／効果があります／効きます／即効／最高／最先端／日本一／No.1／唯一／安全です／副作用なし／医学的に／痛みが消え／永久／保証／激安 など。本部の SNS 管理で編集。
- Google：禁止語があると承認できない（投稿時にも再チェック）。Instagram：警告（承認は可）。
- 入力中にも同じ判定で警告を出す（画面側にも同じ関数）。
- 症状名と施術効果を結びつける表現、料金、他院との比較などは禁止語では拾いきれないため、「運用メモ」に店舗ごとのルールを書き、承認前に人が読む。

## 9. 設定（config.php）

| 項目 | 内容 |
|---|---|
| `APP_URL` | **必須**。画像の公開 URL と連携の戻り先に使う（例 `https://yoyaku.〇〇.jp`） |
| `CRON_SECRET` | 自動処理の合言葉（既存） |
| `IG_APP_ID` / `IG_APP_SECRET` | Meta for Developers のアプリ（Instagram API with Instagram Login）。リダイレクト URI に `APP_URL/api/sns/ig/callback` を登録 |
| `IG_API_VERSION` | 省略可（既定 v23.0） |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Cloud の OAuth クライアント（ウェブアプリ）。リダイレクト URI に `APP_URL/api/sns/google/callback` |
| `LINE_CHANNEL_ACCESS_TOKEN` / `LINE_CHANNEL_SECRET` | LINE 公式アカウントの Messaging API。Webhook URL に `APP_URL/api/sns/line-webhook` |
| `NOTIFY_EMAIL` / `NOTIFY_FROM` | メール通知（LINE の代わり。カンマ区切りで複数可） |
| `SNS_SECRET` | トークン暗号化の鍵（省略時は SESSION_SECRET から作る。決めたら変えない） |

画像は `public/media/sns/` に保存する（Git には入れない。デプロイの rsync でも消さない）。

## 10. 外部サービスの準備（本部が行う）

1. **Instagram**：全店舗のアカウントをプロアカウント（ビジネス）にする → Meta for Developers でアプリを作成（Instagram API with Instagram Login）→ 上記 3 権限 → テスターとして各店舗のアカウントを追加（アプリ審査が終わるまでは「テスター」のみ連携できる）→ アプリ審査（ビジネス認証が必要。通常 5 営業日以上）。
2. **Google**：Google Cloud プロジェクト → OAuth 同意画面 → OAuth クライアント（ウェブアプリ）→ Business Profile API の利用申請（Application for Basic Access）。承認後、GBP の API 群（Account Management / Business Information / My Business v4 / Business Profile Performance）を有効化。
3. **LINE**（任意）：LINE Developers で Messaging API チャネルを作成 → Webhook を ON → 応答メッセージを OFF。
4. **Xserver**：Cron 設定に 5〜10 分おきの実行を登録、`config.php` に上記を記入、`APP_URL` を設定。

## 11. 費用

| 項目 | 月額 |
|---|---|
| サーバー | 既存の Xserver に同居。追加なし |
| Instagram API / Google API | 無料（利用枠内） |
| LINE | 無料枠（通知だけなら足りる）。メールなら 0 円 |
| 生成 AI | 使わないため 0 円 |

## 12. 生成 AI を組み込む場合の案（ご判断用）

いまの実装は「ネタ ＋ 型」で費用ゼロですが、ネタの本文を人が書く手間は残ります。組み込むなら次の 3 段階で、**いずれも承認前の人の確認は残す**前提です。

| 案 | 内容 | 費用の目安（24 店舗・月） | 向いている場面 |
|---|---|---|---|
| A. ネタ出しの補助（おすすめ） | 「ネタ」画面に「AI に 10 件提案してもらう」ボタン。見出し＋本文の候補を作り、人が選んで登録。禁止語は system プロンプトで指示し保存前にチェック | 月 100〜300 円程度（Claude Haiku／Sonnet で月数十回） | ネタ切れの解消。費用が最も小さい |
| B. 下書き文章の生成 | 元の設計図と同じく、下書きごとに文章を生成（口調・文字数・禁止語を system に）。「別のパターン」も AI で作り直し | 月 500〜2,000 円程度（1 日 2〜3 件 × 24 店舗） | 店舗ごとに文章の変化を出したい場合。誤字・言い過ぎの確認は必須 |
| C. 画像生成（図解・イラスト） | Gemini 画像生成など。1 枚数十円、作り直すほど増える。日本語の誤字が出る | 月 1,000〜5,000 円以上 | 保存されやすい図解投稿を狙う場合。費用対効果を見てから |

- A・B は Claude API（Anthropic）を想定。鍵は `config.php` に `ANTHROPIC_API_KEY` として入れ、画面にボタンが出る形にすれば、鍵が無いときは今のまま動く（費用ゼロ）。
- 「分析」の月次コメントを AI に書かせる案もありますが、いまのルール型の気づきで数字は出ているため、必要性を見てからで十分です。

## 13. 今後の拡張候補

- 「本日の空き状況」ストーリー画像の自動投稿（Instagram のストーリーズ API。サーバー側で描くため日本語フォントの同梱が必要）
- ツール以外で投稿したものの数字も取り込む（`/{userId}/media` 一覧から）
- Google 投稿の写真を複数枚、イベント／クーポン型の投稿
- Yahoo!プレイス（API パートナー契約が取れた場合）

## 14. 確認方法（開発者向け）

```bash
# 1. ローカル MariaDB と config.php を用意し、/install でテーブル作成（xserver/README.md 参照）
# 2. 外部 API の代わり（Instagram・Google・LINE を模したサーバー）
node xserver/e2e/sns-mock.mjs &            # http://127.0.0.1:3010
#    config.php に 'SNS_API_MOCK' => 'http://127.0.0.1:3010', 'APP_URL' => 'http://127.0.0.1:3003',
#    IG_APP_ID / IG_APP_SECRET / GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / LINE_* に適当な値
# 3. PHP は複数プロセスで（画像を取りに来る動きを確認するため）
cd xserver && PHP_CLI_SERVER_WORKERS=4 php -S 127.0.0.1:3003 -t public dev-router.php &
# 4. 画面の一通りの確認
cd xserver/frontend && npm ci && npm run build && cd .. && BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... node e2e/sns.mjs
```
