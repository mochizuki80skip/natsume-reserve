<?php
// 入口：/api/... は PHP で処理し、それ以外は画面（index.html）を返す
declare(strict_types=1);

// セキュリティ関連のヘッダー（.htaccess では指定できないサーバーがあるため PHP で付ける）
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');
header('Referrer-Policy: strict-origin-when-cross-origin');
header('X-Robots-Tag: noindex, nofollow');

// プログラム本体（app フォルダ）を探す。同じフォルダの app を最優先にする。
// サブドメインの場合、1 つ上は WordPress などの public_html なので、そこにある別の app を読まないよう
// 「この予約システムの app か」（app/bootstrap.php と app/routes.php があるか）を確かめてから使う
$appDir = null;
foreach ([__DIR__ . '/app', dirname(__DIR__) . '/app'] as $cand) {
    if (is_file($cand . '/bootstrap.php') && is_file($cand . '/routes.php') && is_file($cand . '/lib/Availability.php')) { $appDir = $cand; break; }
}
if ($appDir === null) {
    http_response_code(503);
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><meta charset="utf-8"><p style="font-family:sans-serif">プログラム本体（app フォルダ）が見つかりません。index.php と同じフォルダに app フォルダを置いてください。</p>';
    exit;
}
require $appDir . '/bootstrap.php';
require $appDir . '/routes.php';

// 正式な URL（config.php の APP_URL）以外から開かれたら、正式な URL へ転送する。
// 例：WordPress 側の https://hachimaru-80skip.com/yoyaku.hachimaru-80skip.com/ から開かれた場合
$canonical = rtrim(Config::str('APP_URL'), '/');
if ($canonical !== '') {
    $want = parse_url($canonical, PHP_URL_HOST);
    $host = strtolower(explode(':', $_SERVER['HTTP_HOST'] ?? '')[0]);
    if ($want && $host !== '' && $host !== strtolower($want)) {
        $uri = $_SERVER['REQUEST_URI'] ?? '/';
        $base = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
        if ($base !== '' && str_starts_with($uri, $base . '/')) $uri = substr($uri, strlen($base));
        Http::redirect($canonical . $uri, 301);
    }
}

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
