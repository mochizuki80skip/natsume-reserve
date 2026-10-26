<?php
// 入口：/api/... は PHP で処理し、それ以外は画面（index.html）を返す
declare(strict_types=1);

// セキュリティ関連のヘッダー（.htaccess では指定できないサーバーがあるため PHP で付ける）
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');
header('Referrer-Policy: strict-origin-when-cross-origin');
header('X-Robots-Tag: noindex, nofollow');
// ほかのサイトの中に埋め込ませない・プラグインを動かさない・<base> を書き換えさせない
header("Content-Security-Policy: frame-ancestors 'self'; object-src 'none'; base-uri 'self'");

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
// https で開かれたら、次からは https だけを使うようブラウザに伝える（HSTS）。
// http → https の転送はサーバー側（Xserver の「常時SSL化」）に任せる（ここで転送すると、SSL の受け方によっては転送が止まらなくなるため）
if (Http::isHttps()) header('Strict-Transport-Security: max-age=31536000');
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
// index.html が指している画面ファイル（assets の JS・CSS）が無いと真っ白になるので、足りないときは案内を出す
$page = (string)file_get_contents($html);
preg_match_all('#/assets/([A-Za-z0-9_.-]+\.(?:js|css))#', $page, $m);
$missing = array_values(array_filter(array_unique($m[1]), fn($f) => !is_file(__DIR__ . '/assets/' . $f)));
if ($missing) {
    http_response_code(503);
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-cache');
    $list = implode('', array_map(fn($f) => '<li><code>assets/' . htmlspecialchars($f) . '</code></li>', $missing));
    echo '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>画面ファイルが足りません</title>'
        . '<div style="font-family:sans-serif;max-width:640px;margin:40px auto;padding:0 16px;line-height:1.7">'
        . '<h1 style="font-size:20px">画面ファイルが足りません</h1>'
        . '<p>index.html は更新されていますが、次のファイルがサーバーの <b>assets</b> フォルダにありません。更新ファイルの zip の中の assets フォルダから、このファイルを入れてください。</p>'
        . '<ul>' . $list . '</ul>'
        . '<p style="color:#666;font-size:13px">入れたあと、Ctrl + F5 で読み込み直してください。</p></div>';
    exit;
}
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-cache');
echo $page;
