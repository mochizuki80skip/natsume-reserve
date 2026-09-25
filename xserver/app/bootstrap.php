<?php
// 共通の初期化（設定・タイムゾーン・ライブラリ読込）
declare(strict_types=1);

date_default_timezone_set('Asia/Tokyo');
mb_internal_encoding('UTF-8');

foreach (['Config', 'Time', 'Holidays', 'Hours', 'Availability', 'Text', 'Db', 'Http', 'Auth', 'RateLimit', 'Sms', 'Settings', 'PublicApi', 'DayData', 'Xlsx', 'Install'] as $lib) {
    require_once __DIR__ . '/lib/' . $lib . '.php';
}

if (Config::str('APP_ENV') === 'development') {
    ini_set('display_errors', '1');
    error_reporting(E_ALL);
} else {
    ini_set('display_errors', '0');
}
