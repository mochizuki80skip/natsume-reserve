# OCR の言語データ（Tesseract）

自賠請求のスクショ読み取り（ブラウザ内 OCR）で使う Tesseract の学習済みデータです。
tesseract.js が既定で CDN から取得するものと同じ「best_int（LSTM 整数版）」を、社外に通信しないよう自社サーバーに置いています。

- `jpn.traineddata.gz`：日本語（画面全体の読み取り）
- `eng.traineddata.gz`：英数字（合計金額の数字だけを読み直す 2 段階目）

出典：npm パッケージ `@tesseract.js-data/jpn` / `@tesseract.js-data/eng`（`4.0.0_best_int`）。Apache-2.0 ライセンス。
