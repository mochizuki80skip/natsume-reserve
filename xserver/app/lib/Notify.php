<?php
// 担当者への通知：LINE 公式アカウント（Messaging API）→ 無ければメール → どちらも無ければログ
declare(strict_types=1);

final class Notify
{
    public static function lineEnabled(): bool
    {
        return Config::str('LINE_CHANNEL_ACCESS_TOKEN') !== '';
    }

    public static function mailEnabled(): bool
    {
        return Config::str('NOTIFY_EMAIL') !== '';
    }

    private static function lineBase(): string
    {
        $mock = Config::str('SNS_API_MOCK');
        return $mock !== '' ? rtrim($mock, '/') . '/line' : 'https://api.line.me';
    }

    /** @return string 'LINE'|'MAIL'|'LOG'|'FAILED' */
    public static function send(string $text, string $subject = 'SNS 投稿のお知らせ'): string
    {
        $text = trim($text);
        if ($text === '') return 'LOG';
        if (self::lineEnabled()) {
            $targets = Sns::setting()['lineTargets'];
            if ($targets) {
                try {
                    $chunks = array_chunk(array_values(array_unique($targets)), 500);
                    foreach ($chunks as $to) {
                        $messages = [['type' => 'text', 'text' => mb_substr($text, 0, 4900)]];
                        if (count($to) === 1) SnsHttp::requestOk('POST', self::lineBase() . '/v2/bot/message/push', ['headers' => self::lineAuth(), 'json' => ['to' => $to[0], 'messages' => $messages]]);
                        else SnsHttp::requestOk('POST', self::lineBase() . '/v2/bot/message/multicast', ['headers' => self::lineAuth(), 'json' => ['to' => $to, 'messages' => $messages]]);
                    }
                    return 'LINE';
                } catch (Throwable $e) {
                    error_log('[notify:line] ' . $e->getMessage());
                }
            }
        }
        if (self::mailEnabled()) {
            $to = implode(',', array_map('trim', explode(',', Config::str('NOTIFY_EMAIL'))));
            $from = Config::str('NOTIFY_FROM') !== '' ? Config::str('NOTIFY_FROM') : 'no-reply@' . (parse_url(Sns::baseUrl(), PHP_URL_HOST) ?: 'localhost');
            $ok = @mail($to, '=?UTF-8?B?' . base64_encode($subject) . '?=', $text, "From: {$from}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit");
            if ($ok) return 'MAIL';
            error_log('[notify:mail] 送信に失敗しました');
        }
        error_log('[notify:log] ' . str_replace("\n", ' / ', $text));
        return (self::lineEnabled() || self::mailEnabled()) ? 'FAILED' : 'LOG';
    }

    private static function lineAuth(): array
    {
        return ['Authorization: Bearer ' . Config::str('LINE_CHANNEL_ACCESS_TOKEN')];
    }

    /** LINE Webhook の署名確認 */
    public static function verifyLineSignature(string $body, string $signature): bool
    {
        $secret = Config::str('LINE_CHANNEL_SECRET');
        if ($secret === '' || $signature === '') return false;
        return hash_equals(base64_encode(hash_hmac('sha256', $body, $secret, true)), $signature);
    }

    /** LINE の表示名（取れなければ空） */
    public static function lineProfileName(string $userId): string
    {
        try {
            $r = SnsHttp::requestOk('GET', self::lineBase() . "/v2/bot/profile/{$userId}", ['headers' => self::lineAuth()]);
            return (string)($r['displayName'] ?? '');
        } catch (Throwable) {
            return '';
        }
    }
}
