<?php
// 初期設定・自動削除
declare(strict_types=1);

/** 保持期間を過ぎた個人情報（予約・セル・名簿など）を削除 */
function cleanup_run(): array
{
    $setting = Settings::global();
    $cutoff = Time::addDays(Time::nowJst()['date'], -$setting['retentionDays']);
    $deleted = [];
    foreach (['cell', 'reservation', 'day_status', 'shift', 'cancel_log'] as $t) {
        $deleted[$t] = Db::exec("DELETE FROM `$t` WHERE date < ?", [$cutoff]);
    }
    return ['ok' => true, 'cutoff' => $cutoff, 'deleted' => $deleted];
}

/** /api/cron/cleanup?token=CRON_SECRET（または Authorization: Bearer） */
function cron_cleanup(): never
{
    $secret = Config::str('CRON_SECRET');
    $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    $token = Http::query('token', '');
    if ($secret === '' || !(hash_equals("Bearer $secret", $auth) || hash_equals($secret, $token))) Http::error('unauthorized', 401);
    Http::json(cleanup_run());
}

/** /install?token=INSTALL_TOKEN：テーブル作成と初期データ（HTML で結果を表示） */
function install_page(): never
{
    $secret = Config::str('INSTALL_TOKEN');
    $token = Http::query('token', '');
    header('Content-Type: text/html; charset=utf-8');
    if ($secret === '' || !hash_equals($secret, $token)) {
        http_response_code(403);
        echo '<!doctype html><meta charset="utf-8"><title>初期設定</title><p style="font-family:sans-serif">config.php の INSTALL_TOKEN を URL に付けてください（例：/install?token=...）。設定済みなら INSTALL_TOKEN を空にすると、このページは無効になります。</p>';
        exit;
    }
    try {
        $log = Install::run(Http::query('samples', '1') !== '0');
        $items = implode('', array_map(fn($l) => '<li>' . htmlspecialchars($l, ENT_QUOTES, 'UTF-8') . '</li>', $log));
        echo '<!doctype html><meta charset="utf-8"><title>初期設定</title><div style="font-family:sans-serif;max-width:640px;margin:40px auto"><h1>初期設定が完了しました</h1><ul>' . $items . '</ul>'
            . '<p><a href="/admin/login">管理画面ログイン</a>（本部：HQ）</p><p style="color:#a00">このあと config.php の INSTALL_TOKEN を空文字にして、このページを無効にしてください。</p></div>';
    } catch (Throwable $e) {
        http_response_code(500);
        echo '<!doctype html><meta charset="utf-8"><title>初期設定</title><div style="font-family:sans-serif;max-width:640px;margin:40px auto"><h1>エラー</h1><pre>' . htmlspecialchars($e->getMessage(), ENT_QUOTES, 'UTF-8') . '</pre><p>config.php のデータベース設定（ホスト名・DB名・ユーザー名・パスワード）を確認してください。</p></div>';
    }
    exit;
}
