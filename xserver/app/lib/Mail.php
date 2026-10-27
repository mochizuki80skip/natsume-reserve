<?php
// メールの送信（新自の通知など）。Xserver の PHP のメール（mb_send_mail）で送るので、料金はかからない。
// 試験用：MAIL_LOG（ファイルの場所）を決めたとき・本番（APP_ENV = production）以外は、送らずにファイルに書く
declare(strict_types=1);

final class Mail
{
    /** 送り主のアドレス：config.php の MAIL_FROM、無ければ APP_URL のドメインの no-reply@ */
    public static function from(): string
    {
        $f = trim(Config::str('MAIL_FROM'));
        if ($f !== '' && filter_var($f, FILTER_VALIDATE_EMAIL)) return $f;
        $host = (string)(parse_url(Config::str('APP_URL'), PHP_URL_HOST) ?: ($_SERVER['HTTP_HOST'] ?? 'localhost'));
        return 'no-reply@' . preg_replace('/:\d+$/', '', $host);
    }

    public static function logFile(): string
    {
        return Config::str('MAIL_LOG') !== '' ? Config::str('MAIL_LOG') : sys_get_temp_dir() . '/natsume-mail.log';
    }

    /** @param string[] $to 送り先。正しくないアドレスは飛ばす。送れた数を返す */
    public static function send(array $to, string $subject, string $body): int
    {
        $to = array_values(array_unique(array_filter(array_map('trim', $to), fn($a) => (bool)filter_var($a, FILTER_VALIDATE_EMAIL))));
        if (!$to) return 0;
        // ヘッダーに改行を入れさせない（件名は 1 行に）
        $subject = str_replace(["\r", "\n"], ' ', $subject);
        if (Config::str('MAIL_LOG') !== '' || Config::str('APP_ENV') !== 'production') {
            @file_put_contents(self::logFile(), json_encode(['to' => $to, 'subject' => $subject, 'body' => $body], JSON_UNESCAPED_UNICODE) . "\n", FILE_APPEND | LOCK_EX);
            return count($to);
        }
        mb_language('Japanese');
        mb_internal_encoding('UTF-8');
        $from = self::from();
        $headers = 'From: ' . mb_encode_mimeheader('なつめ接骨院グループ WEB予約') . " <$from>";
        $n = 0;
        foreach ($to as $a) if (@mb_send_mail($a, $subject, $body, $headers, '-f' . $from)) $n++;
        return $n;
    }
}
