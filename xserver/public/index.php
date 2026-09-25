<?php
// 入口：/api/... は PHP で処理し、それ以外は画面（index.html）を返す
declare(strict_types=1);

$appDir = is_dir(__DIR__ . '/../app') ? __DIR__ . '/../app' : __DIR__ . '/app';
require $appDir . '/bootstrap.php';
require $appDir . '/routes.php';

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$path = rtrim($path, '/') ?: '/';
if (str_starts_with($path, '/api/') || $path === '/install') {
    if (!dispatch(Http::method(), $path)) Http::error('not found', 404);
    exit;
}

// 画面（React の単一ページアプリ）。ビルド済みの index.html を返す
$html = __DIR__ . '/index.html';
if (!is_file($html)) {
    http_response_code(503);
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><meta charset="utf-8"><p style="font-family:sans-serif">画面ファイル（index.html）がありません。frontend をビルドして public/ に配置してください。</p>';
    exit;
}
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-cache');
readfile($html);
