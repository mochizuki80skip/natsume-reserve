# 接骨院 WEB予約システム（24店舗対応）

Excel の予約表（1日1シート・5ベッド×15分枠）を Web に置き換え、患者様が空き状況（〇／📞／×）を見て
予約できるようにするシステム。店舗コードでログインする管理画面は Excel 風の表で、コピー＆ペーストで
直接入力できる。仕様の詳細は [docs/SPEC.md](docs/SPEC.md)。

## 画面

| URL | 誰が | 内容 |
|---|---|---|
| `/s/<店舗コード>` | 患者様 | 来院区分 → カレンダー → 時間（〇/📞/×）→ 氏名・電話番号入力 → 即時確定（SMS 送信） |
| `/admin/login` | 店舗・本部 | 店舗コード＋パスワードでログイン |
| `/admin/day/<日付>` | 店舗 | Excel 風の予約表。ベッドの稼働チェック、枠外列、午前/午後の人数、メモ |
| `/admin/calendar` | 店舗 | 日付ごとの公開／非公開／臨時休診 |
| `/admin/settings` | 店舗 | 店舗名・電話・ベッド数・公開日数・営業時間の個別設定・パスワード変更 |
| `/admin/print/<日付>` | 店舗 | A4 印刷／PDF 保存用の予約表 |
| `/admin/hq` | 本部 | 店舗の追加・停止・パスワード再設定、全店共通設定（営業時間・締切・電話マーク閾値など） |

本部アカウント（`HQ`）はヘッダーの店舗切替で全店舗の予約表・カレンダー・設定を横断して操作できる。

## 技術構成

- Next.js 15（App Router）/ TypeScript / Tailwind CSS
- PostgreSQL + Prisma 6（Supabase / Neon / Vercel Postgres いずれも可）
- 認証：bcrypt ＋ 署名付き Cookie（jose）
- SMS：Twilio REST API（環境変数未設定時は送信せずログ出力）
- Vercel Cron で個人情報を保持期間（既定 60 日）経過後に自動削除

## ローカルで動かす

```bash
cd booking
npm install
cp .env.example .env      # DATABASE_URL などを設定
npm run db:push           # テーブル作成
npm run seed              # 共通設定・本部アカウント(HQ)・サンプル店舗 S001/S002 を作成
npm run dev               # http://localhost:3002
```

- 本部ログイン：`HQ` / `.env` の `HQ_PASSWORD`
- サンプル店舗：`S001` / `password`（本番では seed 後に本部画面から実店舗を追加し、サンプルは停止する）
- 患者様ページ：http://localhost:3002/s/S001

テスト：

```bash
npm test          # 営業時間・祝日・空き判定のユニットテスト
```

## Vercel へのデプロイ

1. Vercel → Add New → Project → このリポジトリを選択、**Root Directory を `booking`** にする
2. Storage で Postgres（Supabase / Neon）を接続するか、環境変数 `DATABASE_URL` を設定
3. 環境変数を設定（`.env.example` 参照）：`SESSION_SECRET`（32 文字以上の乱数）、`CRON_SECRET`、
   `HQ_PASSWORD`、SMS を使う場合は `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM`
4. 初回のみ、ローカルから本番 DB に対して `DATABASE_URL=... npm run db:push && npm run seed`
5. デプロイ後 `/admin/login` に `HQ` でログインし、本部画面から 24 店舗を登録する

`vercel.json` の Cron（毎日 18:00 UTC ＝ 3:00 JST）が `/api/cron/cleanup` を呼び、保持期間を過ぎた
予約・予約表セルを削除する。Vercel は `CRON_SECRET` を自動で Authorization ヘッダーに付ける。

## 運用メモ

- **稼働ベッドのチェック**：予約表の列見出しのチェックが入った台数が、患者様に見える空き枠数になる。
  日別設定が無い日は店舗設定の「既定の稼働台数」を使う。
- **初回（①）の予約**は同じベッドで 2 枠（30 分）を使い、2 枠目に「〃」が入る。
- **枠外列**：定員以上に受けた患者様を時間ごとに入れる。空き判定には影響せず人数には含める。
- **公開／非公開**：既定は「今日から N 日先まで公開」。カレンダーで日付ごとに上書きできる。
- **営業終了後の印刷**：予約表の「印刷／PDF」→ ブラウザの印刷ダイアログで「PDF に保存」。
- **営業時間**：2026-10-21 以降は全店統一。それ以前に店舗ごとの時間が必要なら店舗設定の個別設定に
  JSON で入れる（形式は docs/SPEC.md）。

## 動作確認（E2E）

`e2e/smoke.mjs` は起動中のサーバーに対して、患者様の予約→管理画面での反映→貼り付け→印刷ページ→本部画面を
一通り確認する Playwright スクリプト。

```bash
npm run build && npm start &          # 3002 番で起動（seed 済みの DB が必要）
npm i -D playwright                    # 初回のみ
node e2e/smoke.mjs                     # BASE_URL / HQ_PASSWORD で上書き可
```
