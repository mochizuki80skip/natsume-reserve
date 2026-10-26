<?php
// 初期設定・自動削除
declare(strict_types=1);

/** 保持期間を過ぎた予約表（セル）・シフトなどを削除。WEB 予約・キャンセル名簿・入力の履歴は残す（あとから見返すため） */
function cleanup_run(): array
{
    $setting = Settings::global();
    $cutoff = Time::addDays(Time::nowJst()['date'], -$setting['retentionDays']);
    $deleted = [];
    // 予約表を消す前に、来院（来院チェック済み）の記録を残す（離反者リスト・通院回数のため）
    Db::exec('INSERT INTO visit_archive (storeId, date, name, staff, cardNo) SELECT c.storeId, c.date, c.text, COALESCE(c.staff, \'\'), COALESCE(r.cardNo, \'\') FROM cell c LEFT JOIN reservation r ON r.id = c.reservationId WHERE c.date < ? AND c.visited = 1 AND c.bed > 0', [$cutoff]);
    foreach (['cell', 'day_status', 'shift', 'help_in', 'slot_block', 'kind_block'] as $t) {
        $deleted[$t] = Db::exec("DELETE FROM `$t` WHERE date < ?", [$cutoff]);
    }
    $jibai = Jibai::cleanupNames(); // 自賠請求の氏名も保持期間を過ぎたら消す（金額は残す）
    return ['ok' => true, 'cutoff' => $cutoff, 'deleted' => $deleted, 'jibai' => $jibai];
}

/** /api/cron/cleanup?token=CRON_SECRET（または Authorization: Bearer） */
function cron_cleanup(): never
{
    $secret = Config::str('CRON_SECRET');
    $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    $token = Http::query('token', '');
    if (!Config::strongSecret($secret) || !(hash_equals("Bearer $secret", $auth) || hash_equals($secret, $token))) Http::error('unauthorized', 401);
    Http::json(cleanup_run());
}

/** /install?token=INSTALL_TOKEN：テーブル作成と初期データ（HTML で結果を表示） */
function install_page(): never
{
    $secret = Config::str('INSTALL_TOKEN');
    $token = Http::query('token', '');
    header('Content-Type: text/html; charset=utf-8');
    if (!Config::strongSecret($secret) || !hash_equals($secret, $token)) {
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
