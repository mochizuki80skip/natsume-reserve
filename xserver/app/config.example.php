<?php
// このファイルを config.php という名前でコピーして値を入れてください（config.php は Git に入れません）
return [
    // ---- データベース（Xserver サーバーパネル → MySQL設定 で作成した値）----
    'DB_HOST' => 'mysqlXXXX.xserver.jp', // 「MySQL5.7/8.0 ホスト名」または「MariaDB ホスト名」
    'DB_PORT' => 3306,
    'DB_NAME' => 'xsXXXXXX_reserve',     // 作成したデータベース名
    'DB_USER' => 'xsXXXXXX_yoyaku',      // 作成した MySQL ユーザー名
    'DB_PASS' => 'パスワード',

    // ---- ログインの署名用の秘密（32 文字以上の適当な英数字。1 度決めたら変えない）----
    'SESSION_SECRET' => 'change-me-to-a-long-random-string-32chars',

    // ---- 初期設定（/install で使用）----
    'HQ_PASSWORD' => 'change-me',         // 本部アカウント HQ の初期パスワード
    'INSTALL_TOKEN' => 'change-me-once',  // /install?token=この値 でテーブル作成。設定後は空文字にすると無効化できる

    // ---- 毎日の自動削除（cron）用トークン。/api/cron/cleanup?token=この値 ----
    'CRON_SECRET' => 'change-me',

    // ---- SMS（Twilio、有料）。3 つとも空なら送信しない ----
    'TWILIO_ACCOUNT_SID' => '',
    'TWILIO_AUTH_TOKEN' => '',
    'TWILIO_FROM' => '',

    // ---- SNS 投稿管理（Instagram・Google ビジネスプロフィール）。使わない項目は空のままで可 ----
    // Instagram：Meta for Developers のアプリ（「Instagram API with Instagram Login」）の ID とシークレット
    'IG_APP_ID' => '',
    'IG_APP_SECRET' => '',
    // Google：Google Cloud の OAuth クライアント（ウェブアプリ）。Business Profile API の利用許可が別途必要
    'GOOGLE_CLIENT_ID' => '',
    'GOOGLE_CLIENT_SECRET' => '',
    // 通知：LINE 公式アカウント（Messaging API）のチャネルアクセストークン（長期）とチャネルシークレット
    'LINE_CHANNEL_ACCESS_TOKEN' => '',
    'LINE_CHANNEL_SECRET' => '',
    // 通知：LINE を使わない（または失敗した）ときのメール送信先（カンマ区切りで複数可）と送信元
    'NOTIFY_EMAIL' => '',
    'NOTIFY_FROM' => '',
    // 連携トークンの暗号化に使う秘密（省略時は SESSION_SECRET から作る。1 度決めたら変えない）
    'SNS_SECRET' => '',

    // 予約システムの正式な URL（例：https://yoyaku.hachimaru-80skip.com）。
    // これ以外の URL から開かれたら正式な URL に転送する（WordPress 側のフォルダ経由で開かれるのを防ぐ）。空なら転送しない。
    // SNS 投稿管理では、画像の公開 URL と Instagram／Google 連携の戻り先 URL にも使うため必須
    'APP_URL' => '',

    // 'development' にすると画面にエラーを表示する（本番では 'production'）
    'APP_ENV' => 'production',
];
