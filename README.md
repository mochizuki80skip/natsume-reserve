# 接骨院 WEB予約システム（24店舗対応）

Excel の予約表（1日1シート・5ベッド×15分枠）を Web に置き換え、患者様が空き状況（〇／📞／×）を見て
予約できるようにするシステム。店舗コードでログインする管理画面は Excel 風の表で、コピー＆ペーストで
直接入力できる。仕様の詳細は [docs/SPEC.md](docs/SPEC.md)。

## 画面

| URL | 誰が | 内容 |
|---|---|---|
| `/s/<店舗コード>` | 患者様 | 来院区分 → 週間一覧（月〜日 × 15分枠、〇/📞/×）→ 氏名・電話番号入力 → 即時確定 |
| `/admin/login` | 店舗・本部 | 店舗コード＋パスワードでログイン |
| `/admin/day/<日付>` | 店舗 | Excel 風の予約表（ベッド 8 列）。来院チェック、キャンセル名簿、予約/来院人数、メモ |
| `/admin/calendar` | 店舗 | 日付ごとの公開／非公開／臨時休診 |
| `/admin/shifts` | 店舗 | 月間シフト表（〇・休・前休・後休・有給・前有・後有） |
| `/admin/reservations` | 店舗 | 予約・来院ログ（WEB予約一覧／キャンセル名簿）。期間・氏名で絞り込み |
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
2. Supabase でプロジェクトを作り、Connect から 2 種類の URI を取得して環境変数に設定
   - `DATABASE_URL`：Transaction pooler（ポート 6543）の URI の末尾に `?pgbouncer=true&connection_limit=1` を付ける
   - `DIRECT_URL`：Direct connection（ポート 5432）の URI（テーブル作成用）
3. 環境変数を設定（`.env.example` 参照）：`SESSION_SECRET`（32 文字以上の乱数）、`CRON_SECRET`、
   `HQ_PASSWORD`、SMS を使う場合は `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM`
4. Deploy を押す。ビルド時にテーブル作成（`prisma db push`）と初期データ投入（seed）が自動で走るので、
   ローカルでの作業は不要
5. デプロイ後 `/admin/login` に `HQ` でログインし、本部画面から 24 店舗を登録する（サンプル店舗 S001/S002 は停止する）

`vercel.json` の Cron（毎日 18:00 UTC ＝ 3:00 JST）が `/api/cron/cleanup` を呼び、保持期間を過ぎた
予約・予約表セルを削除する。Vercel は `CRON_SECRET` を自動で Authorization ヘッダーに付ける。

### 費用の目安

- Supabase 無料枠（DB 500MB・転送 5GB/月）で 24 店舗分をまかなえる見込み。
  予約表のセルは 1 店舗 1 日あたり最大 180 行、60 日保持でも全店で約 26 万行（100MB 未満）。
  無料枠は 1 週間アクセスが無いと一時停止されるが、毎日の利用と Cron があるため実運用では止まらない。
- SMS（Twilio）は有料のため当面は未設定（＝送信しない）。有効化するときは環境変数 3 つを追加するだけ。
- Vercel の Hobby（無料）プランは商用利用不可の規約のため、業務利用は Pro プラン（月額 20 ドル程度）が必要。
  無料で商用利用できるホスティングに置く場合は Netlify などへの移行が可能（要確認）。

## 運用メモ

- **シフト**：店舗設定でスタッフを登録し、「シフト」の月間表で 〇／休／前休／後休／有給／前有／後有 を選ぶ。
  午前・午後それぞれに勤務する施術者の人数が、患者様に見える空き枠数になる（予約表で日ごとに上書き可）。
  スタッフ未登録の店舗は店舗設定の「既定の施術者数」を使う。管理側は施術者数に関係なく 8 列すべてに入力できる。
- **Excel からの貼り付け**：既存の予約表で時間列を含めて範囲選択（例：B7:L36）→ コピー → 予約表の 9:00 ベッド1 のセルで貼り付け。
  時刻で行を合わせるので 12:00 行の有無や午前/午後の切れ目でずれない。結合セル（2列で1ベッド）は自動で 1 列にまとめる。
- **管理側だけの枠**：予約表には 12:00 / 19:30（土曜 18:30）の行があり、患者様は予約できないが院では入力できる。
- **初回（①）の予約**は同じベッドで 2 枠（30 分）を使い、2 枠目に「上記初診対応」が入る。
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
