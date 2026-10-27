<?php
// LINE 公式アカウント（Messaging API）で知らせる（新自の通知）。無料プランは月 200 通まで（超えた月は送られないだけで、料金はかからない）。
// 送り先は、本部の画面で出した 6 桁の番号を、公式アカウントのトーク（個人またはグループ）に送ってもらって登録する。
// 試験用：MAIL_LOG を決めたとき・本番以外は、送らずにメールと同じファイルに書く
declare(strict_types=1);

final class Line
{
    private const API = 'https://api.line.me/v2/bot';

    public static function token(): string
    {
        return (string)(Settings::global()['lineToken'] ?? '');
    }

    public static function secret(): string
    {
        return (string)(Settings::global()['lineSecret'] ?? '');
    }

    /** Webhook の署名（X-Line-Signature）が正しいか */
    public static function verify(string $raw, string $sig): bool
    {
        $s = self::secret();
        if ($s === '' || $sig === '') return false;
        return hash_equals(base64_encode(hash_hmac('sha256', $raw, $s, true)), $sig);
    }

    private static function testMode(): bool
    {
        return Config::str('MAIL_LOG') !== '' || Config::str('APP_ENV') !== 'production';
    }

    /** @return array{0:int,1:?array} [HTTP の状態, 返ってきた JSON] */
    private static function call(string $method, string $path, ?array $body = null): array
    {
        $token = self::token();
        if ($token === '' || !function_exists('curl_init')) return [0, null];
        $ch = curl_init(self::API . $path);
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 8, CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_HTTPHEADER => array_merge(['Authorization: Bearer ' . $token], $body !== null ? ['Content-Type: application/json'] : []),
        ]);
        if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_UNICODE));
        $res = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        $j = is_string($res) ? json_decode($res, true) : null;
        if ($code !== 200) error_log('[line] ' . $method . ' ' . $path . ' ' . $code . ' ' . (is_string($res) ? substr($res, 0, 300) : ''));
        return [$code, is_array($j) ? $j : null];
    }

    /** 1 つの送り先（ユーザー・グループ）に文を送る。送れたら true */
    public static function push(string $to, string $text): bool
    {
        if (self::testMode()) {
            @file_put_contents(Mail::logFile(), json_encode(['line' => $to, 'text' => $text], JSON_UNESCAPED_UNICODE) . "\n", FILE_APPEND | LOCK_EX);
            return self::token() !== '';
        }
        return self::call('POST', '/message/push', ['to' => $to, 'messages' => [['type' => 'text', 'text' => mb_substr($text, 0, 4900)]]])[0] === 200;
    }

    /** Webhook への返事（返事は通数に数えない） */
    public static function reply(string $replyToken, string $text): void
    {
        if (self::testMode()) {
            @file_put_contents(Mail::logFile(), json_encode(['lineReply' => $text], JSON_UNESCAPED_UNICODE) . "\n", FILE_APPEND | LOCK_EX);
            return;
        }
        self::call('POST', '/message/reply', ['replyToken' => $replyToken, 'messages' => [['type' => 'text', 'text' => $text]]]);
    }

    /** 今月送った数と上限（分からないときは null） */
    public static function quota(): ?array
    {
        if (self::testMode() || self::token() === '') return null;
        [$c1, $q] = self::call('GET', '/message/quota');
        [$c2, $u] = self::call('GET', '/message/quota/consumption');
        if ($c1 !== 200 || $c2 !== 200) return null;
        return ['used' => (int)($u['totalUsage'] ?? 0), 'limit' => ($q['type'] ?? '') === 'limited' ? (int)($q['value'] ?? 0) : null];
    }

    /** 店舗の新自の通知を受ける LINE（全店の分と、その店舗のエリアの分） */
    public static function targetsFor(array $areas): array
    {
        $out = [];
        foreach (Db::all("SELECT area, targetId FROM line_target WHERE active = 1 AND targetId IS NOT NULL ORDER BY sortOrder ASC, createdAt ASC") as $r) {
            if ($r['area'] === '' || in_array($r['area'], $areas, true)) $out[] = $r['targetId'];
        }
        return array_values(array_unique($out));
    }
}
