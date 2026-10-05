<?php
// Instagram API（Instagram ログイン方式）：連携・投稿・数字の取得
declare(strict_types=1);

final class Instagram
{
    public const SCOPES = 'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights';
    public const TOKEN_DAYS = 60; // 長期トークンの有効期間

    public static function configured(): bool
    {
        return Config::str('IG_APP_ID') !== '' && Config::str('IG_APP_SECRET') !== '';
    }

    private static function graph(): string
    {
        $mock = Config::str('SNS_API_MOCK');
        return ($mock !== '' ? rtrim($mock, '/') . '/ig-graph' : 'https://graph.instagram.com') . '/' . Config::str('IG_API_VERSION');
    }

    private static function graphRoot(): string
    {
        $mock = Config::str('SNS_API_MOCK');
        return $mock !== '' ? rtrim($mock, '/') . '/ig-graph' : 'https://graph.instagram.com';
    }

    private static function oauthBase(): string
    {
        $mock = Config::str('SNS_API_MOCK');
        return $mock !== '' ? rtrim($mock, '/') . '/ig-oauth' : 'https://www.instagram.com';
    }

    private static function tokenBase(): string
    {
        $mock = Config::str('SNS_API_MOCK');
        return $mock !== '' ? rtrim($mock, '/') . '/ig-api' : 'https://api.instagram.com';
    }

    public static function redirectUri(): string
    {
        return rtrim(Sns::baseUrl(), '/') . '/api/sns/ig/callback';
    }

    public static function authorizeUrl(string $state): string
    {
        return self::oauthBase() . '/oauth/authorize?' . http_build_query([
            'enable_fb_login' => '0', 'force_authentication' => '1', 'client_id' => Config::str('IG_APP_ID'), 'redirect_uri' => self::redirectUri(),
            'response_type' => 'code', 'scope' => self::SCOPES, 'state' => $state]);
    }

    /** 認可コード → 長期トークン。@return array{accessToken:string, userId:string, expiresAt:string} */
    public static function exchangeCode(string $code): array
    {
        $short = SnsHttp::requestOk('POST', self::tokenBase() . '/oauth/access_token', ['form' => [
            'client_id' => Config::str('IG_APP_ID'), 'client_secret' => Config::str('IG_APP_SECRET'), 'grant_type' => 'authorization_code', 'redirect_uri' => self::redirectUri(), 'code' => $code]]);
        $token = (string)($short['access_token'] ?? '');
        $userId = (string)($short['user_id'] ?? '');
        if ($token === '') throw new SnsApiError('アクセストークンを取得できませんでした');
        $long = SnsHttp::requestOk('GET', self::graphRoot() . '/access_token', ['query' => ['grant_type' => 'ig_exchange_token', 'client_secret' => Config::str('IG_APP_SECRET'), 'access_token' => $token]]);
        $expires = (int)($long['expires_in'] ?? self::TOKEN_DAYS * 86400);
        return ['accessToken' => (string)($long['access_token'] ?? $token), 'userId' => $userId, 'expiresAt' => date('Y-m-d H:i:s', time() + $expires)];
    }

    /** 長期トークンの更新（60 日で切れるため 30 日ごと）。@return array{accessToken:string, expiresAt:string} */
    public static function refresh(string $token): array
    {
        $r = SnsHttp::requestOk('GET', self::graphRoot() . '/refresh_access_token', ['query' => ['grant_type' => 'ig_refresh_token', 'access_token' => $token]]);
        $expires = (int)($r['expires_in'] ?? self::TOKEN_DAYS * 86400);
        return ['accessToken' => (string)($r['access_token'] ?? $token), 'expiresAt' => date('Y-m-d H:i:s', time() + $expires)];
    }

    /** 自分のアカウント情報 */
    public static function me(string $token): array
    {
        $r = SnsHttp::requestOk('GET', self::graph() . '/me', ['query' => ['fields' => 'user_id,username,followers_count,media_count', 'access_token' => $token]]);
        return ['userId' => (string)($r['user_id'] ?? $r['id'] ?? ''), 'username' => (string)($r['username'] ?? ''), 'followers' => isset($r['followers_count']) ? (int)$r['followers_count'] : null, 'mediaCount' => isset($r['media_count']) ? (int)$r['media_count'] : null];
    }

    /** 画像 1 枚の投稿。@return array{id:string, permalink:?string} */
    public static function publishImage(string $userId, string $token, string $imageUrl, string $caption): array
    {
        $c = SnsHttp::requestOk('POST', self::graph() . "/{$userId}/media", ['form' => ['image_url' => $imageUrl, 'caption' => $caption, 'access_token' => $token]]);
        $creation = (string)($c['id'] ?? '');
        if ($creation === '') throw new SnsApiError('メディアコンテナを作れませんでした');
        // 画像の取り込みが終わるまで少し待つ（通常は数秒）
        for ($i = 0; $i < 10; $i++) {
            $st = SnsHttp::request('GET', self::graph() . "/{$creation}", ['query' => ['fields' => 'status_code,status', 'access_token' => $token]]);
            $code = $st['json']['status_code'] ?? 'FINISHED';
            if ($code === 'FINISHED') break;
            if ($code === 'ERROR') throw new SnsApiError('画像の取り込みに失敗しました: ' . ($st['json']['status'] ?? ''));
            sleep(2);
        }
        $p = SnsHttp::requestOk('POST', self::graph() . "/{$userId}/media_publish", ['form' => ['creation_id' => $creation, 'access_token' => $token]]);
        $mediaId = (string)($p['id'] ?? '');
        if ($mediaId === '') throw new SnsApiError('投稿を公開できませんでした');
        $permalink = null;
        try {
            $m = SnsHttp::requestOk('GET', self::graph() . "/{$mediaId}", ['query' => ['fields' => 'permalink', 'access_token' => $token]]);
            $permalink = $m['permalink'] ?? null;
        } catch (Throwable) {
        }
        return ['id' => $mediaId, 'permalink' => $permalink];
    }

    /** 投稿ごとの数字。取れない指標は null */
    public static function mediaInsights(string $mediaId, string $token): array
    {
        $out = ['reach' => null, 'likes' => null, 'comments' => null, 'saved' => null, 'shares' => null, 'views' => null];
        try {
            $m = SnsHttp::requestOk('GET', self::graph() . "/{$mediaId}", ['query' => ['fields' => 'like_count,comments_count', 'access_token' => $token]]);
            $out['likes'] = isset($m['like_count']) ? (int)$m['like_count'] : null;
            $out['comments'] = isset($m['comments_count']) ? (int)$m['comments_count'] : null;
        } catch (Throwable) {
        }
        foreach (['reach,saved,shares,views', 'reach,saved,shares'] as $metrics) {
            $r = SnsHttp::request('GET', self::graph() . "/{$mediaId}/insights", ['query' => ['metric' => $metrics, 'access_token' => $token]]);
            if ($r['status'] >= 300 || !isset($r['json']['data'])) continue;
            foreach ($r['json']['data'] as $d) {
                $name = $d['name'] ?? '';
                $v = $d['values'][0]['value'] ?? ($d['total_value']['value'] ?? null);
                if (array_key_exists($name, $out) && is_numeric($v)) $out[$name] = (int)$v;
            }
            break;
        }
        return $out;
    }

    /** アカウントの日別リーチ（date → 値）。since/until は日付 */
    public static function dailyReach(string $userId, string $token, string $since, string $until): array
    {
        $r = SnsHttp::request('GET', self::graph() . "/{$userId}/insights", ['query' => ['metric' => 'reach', 'period' => 'day', 'since' => strtotime($since . ' 00:00:00 +09:00'), 'until' => strtotime($until . ' 23:59:59 +09:00'), 'access_token' => $token]]);
        $out = [];
        foreach ($r['json']['data'][0]['values'] ?? [] as $v) {
            if (!isset($v['end_time'], $v['value'])) continue;
            // end_time は期間の終わり（翌日 0 時 UTC-7 など）なので、その 1 日前が集計日
            $d = (new DateTimeImmutable($v['end_time']))->setTimezone(new DateTimeZone('Asia/Tokyo'))->modify('-1 day')->format('Y-m-d');
            $out[$d] = (int)$v['value'];
        }
        return $out;
    }
}
