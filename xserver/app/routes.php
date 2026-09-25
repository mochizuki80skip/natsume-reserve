<?php
// URL → 処理の対応表と振り分け
declare(strict_types=1);

require_once __DIR__ . '/handlers/public.php';
require_once __DIR__ . '/handlers/admin.php';
require_once __DIR__ . '/handlers/hq.php';
require_once __DIR__ . '/handlers/misc.php';

/** @return array<int, array{0:string,1:string,2:callable}> [メソッド, 正規表現, 関数] */
function route_table(): array
{
    return [
        // 顧客向け
        ['GET', '#^/api/public/([^/]+)/store$#', 'pub_store'],
        ['GET', '#^/api/public/([^/]+)/week$#', 'pub_week'],
        ['GET', '#^/api/public/([^/]+)/slots$#', 'pub_slots'],
        ['GET', '#^/api/public/([^/]+)/calendar$#', 'pub_calendar'],
        ['POST', '#^/api/public/([^/]+)/reserve$#', 'pub_reserve'],
        // ログイン
        ['POST', '#^/api/admin/login$#', 'adm_login'],
        ['POST', '#^/api/admin/logout$#', 'adm_logout'],
        ['POST', '#^/api/admin/switch$#', 'adm_switch'],
        ['GET', '#^/api/admin/me$#', 'adm_me'],
        // 予約表
        ['GET', '#^/api/admin/day$#', 'adm_day'],
        ['PUT', '#^/api/admin/cells$#', 'adm_cells_put'],
        ['PUT', '#^/api/admin/days$#', 'adm_days_put'],
        ['PUT', '#^/api/admin/visit$#', 'adm_visit_put'],
        ['POST', '#^/api/admin/cancel$#', 'adm_cancel_post'],
        ['DELETE', '#^/api/admin/cancel$#', 'adm_cancel_delete'],
        ['PATCH', '#^/api/admin/cancel$#', 'adm_cancel_patch'],
        // ログ
        ['GET', '#^/api/admin/reservations$#', 'adm_reservations_get'],
        ['DELETE', '#^/api/admin/reservations$#', 'adm_reservations_delete'],
        ['GET', '#^/api/admin/reservations/export$#', 'adm_reservations_export'],
        // カレンダー・シフト・スタッフ
        ['GET', '#^/api/admin/calendar$#', 'adm_calendar_get'],
        ['GET', '#^/api/admin/shifts$#', 'adm_shifts_get'],
        ['PUT', '#^/api/admin/shifts$#', 'adm_shifts_put'],
        ['POST', '#^/api/admin/staff-members$#', 'adm_staff_post'],
        ['PUT', '#^/api/admin/staff-members$#', 'adm_staff_put'],
        ['DELETE', '#^/api/admin/staff-members$#', 'adm_staff_delete'],
        // 店舗設定
        ['GET', '#^/api/admin/settings$#', 'adm_settings_get'],
        ['PUT', '#^/api/admin/store$#', 'adm_store_put'],
        ['PATCH', '#^/api/admin/store$#', 'adm_store_patch'],
        // 本部
        ['GET', '#^/api/admin/hq$#', 'hq_get'],
        ['PUT', '#^/api/admin/hq/settings$#', 'hq_settings_put'],
        ['POST', '#^/api/admin/hq/stores$#', 'hq_stores_post'],
        ['PUT', '#^/api/admin/hq/stores$#', 'hq_stores_put'],
        ['GET', '#^/api/admin/hq/overview$#', 'hq_overview'],
        // 自動削除・初期設定
        ['GET', '#^/api/cron/cleanup$#', 'cron_cleanup'],
        ['GET', '#^/install$#', 'install_page'],
    ];
}

/** API を振り分ける。該当なしなら false */
function dispatch(string $method, string $path): bool
{
    foreach (route_table() as [$m, $re, $fn]) {
        if ($m !== $method || !preg_match($re, $path, $mm)) continue;
        try {
            $fn($mm);
        } catch (HttpError $e) {
            Http::error($e->getMessage(), $e->status);
        } catch (Throwable $e) {
            error_log('[api] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
            Http::error(Config::str('APP_ENV') === 'development' ? $e->getMessage() : 'サーバーでエラーが発生しました', 500);
        }
        return true;
    }
    return false;
}
