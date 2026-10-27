<?php
// 設定の読み込み（app/config.php。無ければ環境変数）
declare(strict_types=1);

final class Config
{
    private static ?array $cfg = null;

    public static function get(): array
    {
        if (self::$cfg !== null) return self::$cfg;
        $file = dirname(__DIR__) . '/config.php';
        $cfg = is_file($file) ? (require $file) : [];
        $keys = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASS', 'SESSION_SECRET', 'HQ_PASSWORD', 'INSTALL_TOKEN', 'CRON_SECRET',
            'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM', 'APP_ENV', 'APP_URL', 'MAIL_FROM', 'MAIL_LOG'];
        foreach ($keys as $k) {
            $env = getenv($k);
            if (($cfg[$k] ?? '') === '' && $env !== false) $cfg[$k] = $env;
        }
        $cfg += ['DB_HOST' => 'localhost', 'DB_PORT' => 3306, 'DB_NAME' => '', 'DB_USER' => '', 'DB_PASS' => '', 'SESSION_SECRET' => '', 'HQ_PASSWORD' => '',
            'INSTALL_TOKEN' => '', 'CRON_SECRET' => '', 'TWILIO_ACCOUNT_SID' => '', 'TWILIO_AUTH_TOKEN' => '', 'TWILIO_FROM' => '', 'APP_ENV' => 'production', 'APP_URL' => '', 'MAIL_FROM' => '', 'MAIL_LOG' => ''];
        return self::$cfg = $cfg;
    }

    public static function str(string $k): string
    {
        return (string)(self::get()[$k] ?? '');
    }

    /** 合言葉（CRON_SECRET・INSTALL_TOKEN）として使える値か：空・短すぎる・見本のまま（change-me）は使えない */
    public static function strongSecret(string $v): bool
    {
        return strlen($v) >= 8 && stripos($v, 'change-me') === false;
    }
}
