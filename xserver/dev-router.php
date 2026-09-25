<?php
// ローカル確認用：php -S localhost:3002 -t public dev-router.php
// （Xserver では .htaccess が同じ役割をする）
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$file = __DIR__ . '/public' . $path;
if ($path !== '/' && is_file($file) && !str_ends_with($path, '.php')) return false; // 静的ファイルはそのまま
require __DIR__ . '/public/index.php';
