<?php
// URL → 処理の対応表と振り分け
declare(strict_types=1);

require_once __DIR__ . '/handlers/public.php';
require_once __DIR__ . '/handlers/admin.php';
require_once __DIR__ . '/handlers/hq.php';
require_once __DIR__ . '/handlers/misc.php';
require_once __DIR__ . '/handlers/jibai.php';
require_once __DIR__ . '/handlers/sns.php';

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
        ['PUT', '#^/api/admin/help-in$#', 'adm_help_in_put'],
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
        ['POST', '#^/api/admin/hq/stores/bulk$#', 'hq_stores_bulk'],
        ['GET', '#^/api/admin/hq/overview$#', 'hq_overview'],
        // 自賠責請求の速報集計
        ['GET', '#^/api/admin/jibai$#', 'jibai_get'],
        ['PUT', '#^/api/admin/jibai/claims$#', 'jibai_claims_put'],
        ['DELETE', '#^/api/admin/jibai/claims$#', 'jibai_claims_delete'],
        ['POST', '#^/api/admin/jibai/submit$#', 'jibai_submit'],
        ['PUT', '#^/api/admin/jibai/verify$#', 'jibai_verify'],
        ['GET', '#^/api/admin/hq/jibai$#', 'hq_jibai'],
        ['PUT', '#^/api/admin/hq/jibai/settings$#', 'hq_jibai_settings_put'],
        // SNS 投稿管理（Instagram・Google ビジネスプロフィール）
        ['GET', '#^/api/admin/sns/home$#', 'sns_home'],
        ['GET', '#^/api/admin/sns/manual$#', 'sns_manual_get'],
        ['GET', '#^/api/admin/sns/posts$#', 'sns_posts_get'],
        ['POST', '#^/api/admin/sns/posts$#', 'sns_posts_post'],
        ['GET', '#^/api/admin/sns/posts/([0-9a-f]{24})$#', 'sns_post_get'],
        ['PUT', '#^/api/admin/sns/posts/([0-9a-f]{24})$#', 'sns_post_put'],
        ['POST', '#^/api/admin/sns/posts/([0-9a-f]{24})/action$#', 'sns_post_action'],
        ['POST', '#^/api/admin/sns/posts/([0-9a-f]{24})/image$#', 'sns_post_image'],
        ['POST', '#^/api/admin/sns/generate$#', 'sns_generate'],
        ['GET', '#^/api/admin/sns/topics$#', 'sns_topics_get'],
        ['POST', '#^/api/admin/sns/topics$#', 'sns_topics_post'],
        ['PUT', '#^/api/admin/sns/topics$#', 'sns_topics_put'],
        ['POST', '#^/api/admin/sns/topics/([0-9a-f]{24})/image$#', 'sns_topic_image'],
        ['GET', '#^/api/admin/sns/media$#', 'sns_media_get'],
        ['POST', '#^/api/admin/sns/media$#', 'sns_media_post'],
        ['PUT', '#^/api/admin/sns/media$#', 'sns_media_put'],
        ['POST', '#^/api/admin/hq/sns/topics/([0-9a-f]{24})/broadcast$#', 'hq_sns_topic_broadcast'],
        ['GET', '#^/api/admin/sns/drafts$#', 'sns_drafts_get'],
        ['GET', '#^/api/admin/sns/vars$#', 'sns_vars_get'],
        ['PUT', '#^/api/admin/sns/vars$#', 'sns_vars_put'],
        ['GET', '#^/api/admin/sns/credentials$#', 'sns_credentials_get'],
        ['PUT', '#^/api/admin/sns/credentials$#', 'sns_credentials_put'],
        ['POST', '#^/api/admin/sns/credentials/reveal$#', 'sns_credentials_reveal'],
        ['GET', '#^/api/admin/sns/settings$#', 'sns_settings_get'],
        ['PUT', '#^/api/admin/sns/settings$#', 'sns_settings_put'],
        ['POST', '#^/api/admin/sns/preview$#', 'sns_preview'],
        ['GET', '#^/api/admin/sns/insights$#', 'sns_insights'],
        ['GET', '#^/api/admin/sns/insights/export$#', 'sns_insights_export'],
        ['POST', '#^/api/admin/sns/reviews/reply$#', 'sns_review_reply'],
        ['GET', '#^/api/admin/sns/ig/connect$#', 'sns_ig_connect'],
        ['POST', '#^/api/admin/sns/ig/token$#', 'sns_ig_token_post'],
        ['GET', '#^/api/sns/ig/callback$#', 'sns_ig_callback'],
        ['GET', '#^/api/admin/sns/google/connect$#', 'sns_google_connect'],
        ['GET', '#^/api/sns/google/callback$#', 'sns_google_callback'],
        ['GET', '#^/api/admin/hq/sns$#', 'hq_sns_get'],
        ['GET', '#^/api/admin/hq/sns/stores$#', 'hq_sns_stores_get'],
        ['PUT', '#^/api/admin/hq/sns/settings$#', 'hq_sns_settings_put'],
        ['POST', '#^/api/admin/hq/sns/notify-test$#', 'hq_sns_notify_test'],
        ['POST', '#^/api/admin/hq/sns/run-cron$#', 'hq_sns_run_cron'],
        ['GET', '#^/api/admin/hq/sns/google/locations$#', 'hq_sns_google_locations'],
        ['PUT', '#^/api/admin/hq/sns/google/map$#', 'hq_sns_google_map'],
        ['POST', '#^/api/sns/line-webhook$#', 'sns_line_webhook'],
        ['GET', '#^/api/cron/sns$#', 'cron_sns'],
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
        // SNS 投稿管理だけの設置では、予約関連の API を出さない（店舗名の取得＝店舗別ログイン画面用だけ残す）
        if (Config::isSnsOnly() && str_starts_with($path, '/api/public/') && $fn !== 'pub_store') { Http::error('not found', 404); }
        // SNS 投稿管理だけの設置では Google の API 連携は使わない（手動投稿）。Instagram は API で自動投稿できる
        if (Config::isSnsOnly() && in_array($fn, ['sns_google_connect', 'sns_google_callback', 'hq_sns_google_locations', 'hq_sns_google_map', 'sns_review_reply'], true)) { Http::error('この設置では Google の API 連携は使いません', 404); }
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
