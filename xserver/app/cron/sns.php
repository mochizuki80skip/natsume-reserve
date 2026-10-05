<?php
// Xserver の Cron 設定から 5〜10 分おきに実行する：php /home/xsXXXX/<ドメイン>/public_html/<予約システムのフォルダ>/app/cron/sns.php
// （/api/cron/sns?token=CRON_SECRET を curl で呼んでも同じ。CLI では APP_URL が必要）
declare(strict_types=1);

require dirname(__DIR__) . '/bootstrap.php';
require dirname(__DIR__) . '/handlers/misc.php';
require dirname(__DIR__) . '/handlers/sns.php';

echo json_encode(SnsCron::run(), JSON_UNESCAPED_UNICODE), "\n";
