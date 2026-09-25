<?php
// Xserver の Cron 設定から毎日実行する：php /home/xsXXXX/<ドメイン>/app/cron/cleanup.php
// （public_html の中に app を置いた場合は /home/xsXXXX/<ドメイン>/public_html/app/cron/cleanup.php）
declare(strict_types=1);

require dirname(__DIR__) . '/bootstrap.php';
require dirname(__DIR__) . '/handlers/misc.php';

$r = cleanup_run();
echo json_encode($r, JSON_UNESCAPED_UNICODE), "\n";
