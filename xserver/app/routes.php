<?php
// URL → 処理の対応表と振り分け
declare(strict_types=1);

require_once __DIR__ . '/handlers/public.php';
require_once __DIR__ . '/handlers/admin.php';
require_once __DIR__ . '/handlers/hq.php';
require_once __DIR__ . '/handlers/misc.php';
require_once __DIR__ . '/handlers/jibai.php';
require_once __DIR__ . '/handlers/karte.php';
require_once __DIR__ . '/handlers/accounts.php';
require_once __DIR__ . '/handlers/madoguchi.php';
require_once __DIR__ . '/handlers/churn.php';
require_once __DIR__ . '/handlers/closure.php';

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
        ['GET', '#^/api/public-reservation/([0-9a-f]{32})$#', 'pub_reservation_view'],
        ['GET', '#^/api/public-stores$#', 'pub_stores'],
        ['GET', '#^/api/public-privacy$#', 'pub_privacy'],
        // ログイン
        ['POST', '#^/api/admin/login$#', 'adm_login'],
        ['POST', '#^/api/admin/logout$#', 'adm_logout'],
        ['POST', '#^/api/admin/switch$#', 'adm_switch'],
        ['GET', '#^/api/admin/me$#', 'adm_me'],
        // 予約表
        ['GET', '#^/api/admin/day$#', 'adm_day'],
        ['PUT', '#^/api/admin/cells$#', 'adm_cells_put'],
        ['GET', '#^/api/admin/web-new$#', 'adm_web_new_get'],
        ['PUT', '#^/api/admin/cell-menus$#', 'adm_cell_menus_put'],
        ['GET', '#^/api/admin/move-slots$#', 'adm_move_slots'],
        ['PUT', '#^/api/admin/cell-staff$#', 'adm_cell_staff_put'],
        ['GET', '#^/api/admin/staff-counts$#', 'adm_staff_counts'],
        ['GET', '#^/api/admin/patients$#', 'adm_patients_get'],
        ['POST', '#^/api/admin/patients$#', 'adm_patients_post'],
        ['GET', '#^/api/admin/patients/lookup$#', 'adm_patients_lookup'],
        ['GET', '#^/api/admin/cell-log$#', 'adm_cell_log_get'],
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
        ['PUT', '#^/api/admin/help-in$#', 'adm_help_in_put'],
        ['POST', '#^/api/admin/move$#', 'adm_move_post'],
        ['POST', '#^/api/admin/blocks$#', 'adm_block_post'],
        ['GET', '#^/api/admin/karte$#', 'karte_get'],
        ['GET', '#^/api/admin/karte/export$#', 'karte_export'],
        ['POST', '#^/api/admin/karte$#', 'karte_post'],
        ['PATCH', '#^/api/admin/karte$#', 'karte_patch'],
        ['DELETE', '#^/api/admin/karte$#', 'karte_delete'],
        ['POST', '#^/api/admin/karte/import$#', 'karte_import'],
        ['GET', '#^/api/admin/hq/karte$#', 'hq_karte_get'],
        ['GET', '#^/api/admin/hq/karte/options$#', 'hq_karte_options_get'],
        ['PUT', '#^/api/admin/hq/karte/options$#', 'hq_karte_options_put'],
        ['PUT', '#^/api/admin/hq/areas$#', 'hq_areas_put'],
        ['GET', '#^/api/admin/hq/accounts$#', 'hq_accounts_get'],
        ['POST', '#^/api/admin/hq/accounts$#', 'hq_accounts_post'],
        ['PUT', '#^/api/admin/hq/accounts$#', 'hq_accounts_put'],
        ['GET', '#^/api/admin/hq/audit$#', 'hq_audit_get'],
        ['DELETE', '#^/api/admin/blocks$#', 'adm_block_delete'],
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
        ['PUT', '#^/api/admin/hq/stores-page$#', 'hq_stores_page_put'],
        ['GET', '#^/api/admin/special-days$#', 'adm_special_days_get'],
        ['PUT', '#^/api/admin/cell-phone$#', 'adm_cell_phone_put'],
        ['GET', '#^/api/admin/find$#', 'adm_find_get'],
        ['PUT', '#^/api/admin/special-days$#', 'adm_special_days_put'],
        ['DELETE', '#^/api/admin/special-days$#', 'adm_special_days_delete'],
        ['GET', '#^/api/admin/hq/referrals$#', 'hq_referrals_get'],
        ['PUT', '#^/api/admin/hq/referrals$#', 'hq_referrals_put'],
        ['GET', '#^/api/admin/madoguchi$#', 'mado_get'],
        ['PUT', '#^/api/admin/madoguchi/day$#', 'mado_day_put'],
        ['PUT', '#^/api/admin/madoguchi/month$#', 'mado_month_put'],
        ['PUT', '#^/api/admin/madoguchi/henrei$#', 'mado_henrei_put'],
        ['DELETE', '#^/api/admin/madoguchi/henrei$#', 'mado_henrei_delete'],
        ['GET', '#^/api/admin/madoguchi/export$#', 'mado_export'],
        ['GET', '#^/api/admin/acct/madoguchi$#', 'acct_mado_get'],
        ['PUT', '#^/api/admin/acct/madoguchi/check$#', 'acct_mado_check'],
        ['PUT', '#^/api/admin/acct/madoguchi/target$#', 'acct_mado_target'],
        ['GET', '#^/api/admin/acct/madoguchi/export$#', 'acct_mado_export'],
        ['GET', '#^/api/admin/churn$#', 'churn_get'],
        ['POST', '#^/api/admin/churn$#', 'churn_post'],
        ['PATCH', '#^/api/admin/churn$#', 'churn_patch'],
        ['DELETE', '#^/api/admin/churn$#', 'churn_delete'],
        ['POST', '#^/api/admin/churn/import$#', 'churn_import'],
        ['GET', '#^/api/admin/churn/export$#', 'churn_export'],
        ['GET', '#^/api/admin/follow$#', 'follow_get'],
        ['PATCH', '#^/api/admin/follow$#', 'follow_patch'],
        ['GET', '#^/api/admin/staffing$#', 'staffing_get'],
        ['PUT', '#^/api/admin/staffing/std$#', 'staffing_std_put'],
        ['GET', '#^/api/admin/hq/goods$#', 'hq_goods_get'],
        ['PUT', '#^/api/admin/hq/goods$#', 'hq_goods_put'],
        ['GET', '#^/api/admin/hq/privacy$#', 'hq_privacy_get'],
        ['PUT', '#^/api/admin/hq/privacy$#', 'hq_privacy_put'],
        ['GET', '#^/api/admin/hq/overview$#', 'hq_overview'],
        // 臨時休業をまとめて入れる（本部・管轄MG）と、店舗への通知
        ['POST', '#^/api/admin/kind-blocks$#', 'adm_kind_block_post'],
        ['DELETE', '#^/api/admin/kind-blocks$#', 'adm_kind_block_delete'],
        ['GET', '#^/api/admin/closures$#', 'closure_get'],
        ['PUT', '#^/api/admin/closures$#', 'closure_put'],
        ['GET', '#^/api/admin/closures/notices$#', 'closure_notices'],
        ['PUT', '#^/api/admin/closures/ack$#', 'closure_ack'],
        // 自賠責請求の速報集計
        ['GET', '#^/api/admin/jibai$#', 'jibai_get'],
        ['PUT', '#^/api/admin/jibai/claims$#', 'jibai_claims_put'],
        ['DELETE', '#^/api/admin/jibai/claims$#', 'jibai_claims_delete'],
        ['POST', '#^/api/admin/jibai/submit$#', 'jibai_submit'],
        ['PUT', '#^/api/admin/jibai/verify$#', 'jibai_verify'],
        ['GET', '#^/api/admin/hq/jibai$#', 'hq_jibai'],
        ['PUT', '#^/api/admin/hq/jibai/settings$#', 'hq_jibai_settings_put'],
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
            audit_register($fn, $method);
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
