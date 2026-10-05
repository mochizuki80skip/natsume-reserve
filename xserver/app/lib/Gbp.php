<?php
// Google ビジネスプロフィール：Google アカウント連携（OAuth）・拠点一覧・投稿・パフォーマンス・クチコミ
declare(strict_types=1);

final class Gbp
{
    public const SCOPE = 'https://www.googleapis.com/auth/business.manage';
    public const DAILY_METRICS = ['BUSINESS_IMPRESSIONS_DESKTOP_MAPS', 'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH', 'BUSINESS_IMPRESSIONS_MOBILE_MAPS', 'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
        'CALL_CLICKS', 'WEBSITE_CLICKS', 'BUSINESS_DIRECTION_REQUESTS', 'BUSINESS_CONVERSATIONS', 'BUSINESS_BOOKINGS'];

    public static function configured(): bool
    {
        return Config::str('GOOGLE_CLIENT_ID') !== '' && Config::str('GOOGLE_CLIENT_SECRET') !== '';
    }

    private static function base(string $real, string $mockPath): string
    {
        $mock = Config::str('SNS_API_MOCK');
        return $mock !== '' ? rtrim($mock, '/') . $mockPath : $real;
    }

    public static function redirectUri(): string
    {
        return rtrim(Sns::baseUrl(), '/') . '/api/sns/google/callback';
    }

    public static function authorizeUrl(string $state): string
    {
        return self::base('https://accounts.google.com', '/google-auth') . '/o/oauth2/v2/auth?' . http_build_query([
            'client_id' => Config::str('GOOGLE_CLIENT_ID'), 'redirect_uri' => self::redirectUri(), 'response_type' => 'code', 'scope' => self::SCOPE,
            'access_type' => 'offline', 'prompt' => 'consent', 'include_granted_scopes' => 'true', 'state' => $state]);
    }

    /** @return array{accessToken:string, refreshToken:?string, expiresAt:string} */
    public static function exchangeCode(string $code): array
    {
        $r = SnsHttp::requestOk('POST', self::base('https://oauth2.googleapis.com', '/google-token') . '/token', ['form' => [
            'code' => $code, 'client_id' => Config::str('GOOGLE_CLIENT_ID'), 'client_secret' => Config::str('GOOGLE_CLIENT_SECRET'), 'redirect_uri' => self::redirectUri(), 'grant_type' => 'authorization_code']]);
        return ['accessToken' => (string)($r['access_token'] ?? ''), 'refreshToken' => $r['refresh_token'] ?? null, 'expiresAt' => date('Y-m-d H:i:s', time() + (int)($r['expires_in'] ?? 3600) - 60)];
    }

    /** 本部の Google 連携の有効なアクセストークン（期限が近ければ更新して保存） */
    public static function accessToken(): string
    {
        $acc = Sns::account(null, 'gbp');
        if (!$acc || !$acc['refreshToken']) throw new SnsApiError('Google アカウントが連携されていません');
        $token = SnsCrypto::decrypt($acc['accessToken']);
        if ($token && $acc['tokenExpiresAt'] && strtotime($acc['tokenExpiresAt']) > time() + 120) return $token;
        $refresh = SnsCrypto::decrypt($acc['refreshToken']);
        if (!$refresh) throw new SnsApiError('Google の更新トークンを読めません。再連携してください');
        $r = SnsHttp::requestOk('POST', self::base('https://oauth2.googleapis.com', '/google-token') . '/token', ['form' => [
            'client_id' => Config::str('GOOGLE_CLIENT_ID'), 'client_secret' => Config::str('GOOGLE_CLIENT_SECRET'), 'refresh_token' => $refresh, 'grant_type' => 'refresh_token']]);
        $token = (string)($r['access_token'] ?? '');
        if ($token === '') throw new SnsApiError('Google のアクセストークンを更新できませんでした');
        Sns::saveAccount(null, 'gbp', ['accessToken' => $token, 'tokenExpiresAt' => date('Y-m-d H:i:s', time() + (int)($r['expires_in'] ?? 3600) - 60), 'tokenRefreshedAt' => Time::nowJstDateTime(), 'lastError' => null]);
        return $token;
    }

    private static function auth(): array
    {
        return ['Authorization: Bearer ' . self::accessToken()];
    }

    /** 連携した Google アカウントで管理しているアカウント（ビジネスグループ）一覧 */
    public static function accounts(): array
    {
        $r = SnsHttp::requestOk('GET', self::base('https://mybusinessaccountmanagement.googleapis.com', '/gbp-accounts') . '/v1/accounts', ['headers' => self::auth(), 'query' => ['pageSize' => 20]]);
        return array_map(fn($a) => ['name' => $a['name'] ?? '', 'accountName' => $a['accountName'] ?? '', 'type' => $a['type'] ?? ''], $r['accounts'] ?? []);
    }

    /** アカウント配下の拠点一覧 */
    public static function locations(string $accountName): array
    {
        $out = [];
        $token = null;
        do {
            $q = ['readMask' => 'name,title,storefrontAddress', 'pageSize' => 100];
            if ($token) $q['pageToken'] = $token;
            $r = SnsHttp::requestOk('GET', self::base('https://mybusinessbusinessinformation.googleapis.com', '/gbp-info') . "/v1/{$accountName}/locations", ['headers' => self::auth(), 'query' => $q]);
            foreach ($r['locations'] ?? [] as $l) {
                $addr = $l['storefrontAddress'] ?? [];
                $out[] = ['name' => $l['name'] ?? '', 'title' => $l['title'] ?? '', 'address' => trim(implode(' ', array_merge([$addr['administrativeArea'] ?? '', $addr['locality'] ?? ''], $addr['addressLines'] ?? [])))];
            }
            $token = $r['nextPageToken'] ?? null;
        } while ($token);
        return $out;
    }

    /** 投稿（最新情報）。@return array{name:string, url:?string} */
    public static function createLocalPost(string $accountName, string $locationName, string $summary, ?string $imageUrl, ?string $ctaUrl): array
    {
        $body = ['languageCode' => 'ja', 'summary' => $summary, 'topicType' => 'STANDARD'];
        if ($ctaUrl) $body['callToAction'] = ['actionType' => 'BOOK', 'url' => $ctaUrl];
        if ($imageUrl) $body['media'] = [['mediaFormat' => 'PHOTO', 'sourceUrl' => $imageUrl]];
        $r = SnsHttp::requestOk('POST', self::base('https://mybusiness.googleapis.com', '/gbp-v4') . "/v4/{$accountName}/{$locationName}/localPosts", ['headers' => self::auth(), 'json' => $body]);
        return ['name' => (string)($r['name'] ?? ''), 'url' => $r['searchUrl'] ?? null];
    }

    /** 日別のパフォーマンス指標（date → metric → 値）。日付は "Y-m-d" */
    public static function dailyMetrics(string $locationName, string $from, string $to): array
    {
        [$fy, $fm, $fd] = array_map('intval', explode('-', $from));
        [$ty, $tm, $td] = array_map('intval', explode('-', $to));
        $qs = 'dailyRange.startDate.year=' . $fy . '&dailyRange.startDate.month=' . $fm . '&dailyRange.startDate.day=' . $fd
            . '&dailyRange.endDate.year=' . $ty . '&dailyRange.endDate.month=' . $tm . '&dailyRange.endDate.day=' . $td;
        foreach (self::DAILY_METRICS as $m) $qs .= '&dailyMetrics=' . $m;
        $r = SnsHttp::requestOk('GET', self::base('https://businessprofileperformance.googleapis.com', '/gbp-perf') . "/v1/{$locationName}:fetchMultiDailyMetricsTimeSeries?{$qs}", ['headers' => self::auth()]);
        $out = [];
        foreach ($r['multiDailyMetricTimeSeries'] ?? [] as $group) {
            foreach ($group['dailyMetricTimeSeries'] ?? [] as $series) {
                $metric = $series['dailyMetric'] ?? '';
                foreach ($series['timeSeries']['datedValues'] ?? [] as $dv) {
                    $d = $dv['date'] ?? null;
                    if (!$d) continue;
                    $date = sprintf('%04d-%02d-%02d', $d['year'] ?? 0, $d['month'] ?? 0, $d['day'] ?? 0);
                    $out[$date][$metric] = (int)($dv['value'] ?? 0);
                }
            }
        }
        return $out;
    }

    /** API の指標名 → この仕組みで保存する名前（表示・分析用にまとめる） */
    public static function summarizeMetrics(array $byMetric): array
    {
        $g = fn(string $k) => (int)($byMetric[$k] ?? 0);
        return [
            'impressions_maps' => $g('BUSINESS_IMPRESSIONS_DESKTOP_MAPS') + $g('BUSINESS_IMPRESSIONS_MOBILE_MAPS'),
            'impressions_search' => $g('BUSINESS_IMPRESSIONS_DESKTOP_SEARCH') + $g('BUSINESS_IMPRESSIONS_MOBILE_SEARCH'),
            'calls' => $g('CALL_CLICKS'), 'website_clicks' => $g('WEBSITE_CLICKS'), 'directions' => $g('BUSINESS_DIRECTION_REQUESTS'),
            'conversations' => $g('BUSINESS_CONVERSATIONS'), 'bookings' => $g('BUSINESS_BOOKINGS'),
        ];
    }

    /** クチコミ一覧（新しい順、最大 50 件） */
    public static function reviews(string $accountName, string $locationName): array
    {
        $r = SnsHttp::requestOk('GET', self::base('https://mybusiness.googleapis.com', '/gbp-v4') . "/v4/{$accountName}/{$locationName}/reviews", ['headers' => self::auth(), 'query' => ['pageSize' => 50, 'orderBy' => 'updateTime desc']]);
        $stars = ['ONE' => 1, 'TWO' => 2, 'THREE' => 3, 'FOUR' => 4, 'FIVE' => 5];
        $out = [];
        foreach ($r['reviews'] ?? [] as $v) {
            $out[] = ['name' => $v['name'] ?? '', 'reviewer' => $v['reviewer']['displayName'] ?? '', 'rating' => $stars[$v['starRating'] ?? ''] ?? 0, 'comment' => $v['comment'] ?? null,
                'createTime' => self::toJst($v['createTime'] ?? null), 'replyComment' => $v['reviewReply']['comment'] ?? null, 'replyTime' => self::toJst($v['reviewReply']['updateTime'] ?? null)];
        }
        return $out;
    }

    public static function replyReview(string $reviewName, string $comment): void
    {
        SnsHttp::requestOk('PUT', self::base('https://mybusiness.googleapis.com', '/gbp-v4') . "/v4/{$reviewName}/reply", ['headers' => self::auth(), 'json' => ['comment' => $comment]]);
    }

    private static function toJst(?string $iso): ?string
    {
        if (!$iso) return null;
        try { return (new DateTimeImmutable($iso))->setTimezone(new DateTimeZone('Asia/Tokyo'))->format('Y-m-d H:i:s'); } catch (Throwable) { return null; }
    }
}
