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

    // 'development' にすると画面にエラーを表示する（本番では 'production'）
    'APP_ENV' => 'production',
];
