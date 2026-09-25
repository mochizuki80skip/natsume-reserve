<?php
// SMS 送信（Twilio）。設定が無ければ送らず SKIPPED を返す
declare(strict_types=1);

final class Sms
{
    public static function enabled(): bool
    {
        return Config::str('TWILIO_ACCOUNT_SID') !== '' && Config::str('TWILIO_AUTH_TOKEN') !== '' && Config::str('TWILIO_FROM') !== '';
    }

    /** @return 'SENT'|'FAILED'|'SKIPPED' */
    public static function send(string $to, string $body): string
    {
        if (!self::enabled()) {
            error_log("[sms:skipped] to=$to " . str_replace("\n", ' / ', $body));
            return 'SKIPPED';
        }
        $sid = Config::str('TWILIO_ACCOUNT_SID');
        $ch = curl_init("https://api.twilio.com/2010-04-01/Accounts/{$sid}/Messages.json");
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => http_build_query(['To' => $to, 'From' => Config::str('TWILIO_FROM'), 'Body' => $body]),
            CURLOPT_USERPWD => $sid . ':' . Config::str('TWILIO_AUTH_TOKEN'),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 15,
        ]);
        $res = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        if ($res === false || $status >= 300) {
            error_log("[sms:failed] status=$status " . (is_string($res) ? $res : ''));
            return 'FAILED';
        }
        return 'SENT';
    }
}
