<?php
// 連携トークンの暗号化（DB に平文で置かない）。鍵は config.php の SNS_SECRET（無ければ SESSION_SECRET）から作る
declare(strict_types=1);

final class SnsCrypto
{
    private static function key(): string
    {
        $s = Config::str('SNS_SECRET') !== '' ? Config::str('SNS_SECRET') : Config::str('SESSION_SECRET');
        if (strlen($s) < 16) throw new RuntimeException('SESSION_SECRET が設定されていません');
        return hash('sha256', 'sns:' . $s, true);
    }

    public static function encrypt(string $plain): string
    {
        $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
        $cipher = sodium_crypto_secretbox($plain, $nonce, self::key());
        return 'v1:' . base64_encode($nonce . $cipher);
    }

    public static function decrypt(?string $enc): ?string
    {
        if ($enc === null || $enc === '') return null;
        if (!str_starts_with($enc, 'v1:')) return null;
        $raw = base64_decode(substr($enc, 3), true);
        if ($raw === false || strlen($raw) <= SODIUM_CRYPTO_SECRETBOX_NONCEBYTES) return null;
        $nonce = substr($raw, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
        $cipher = substr($raw, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
        $plain = sodium_crypto_secretbox_open($cipher, $nonce, self::key());
        return $plain === false ? null : $plain;
    }

    /** OAuth の state（店舗 ID などを署名付きで往復させる） */
    public static function signState(array $data): string
    {
        $payload = rtrim(strtr(base64_encode(Sns::j($data + ['exp' => time() + 600])), '+/', '-_'), '=');
        $sig = rtrim(strtr(base64_encode(hash_hmac('sha256', $payload, self::key(), true)), '+/', '-_'), '=');
        return "$payload.$sig";
    }

    public static function verifyState(string $state): ?array
    {
        $parts = explode('.', $state);
        if (count($parts) !== 2) return null;
        [$payload, $sig] = $parts;
        $expect = rtrim(strtr(base64_encode(hash_hmac('sha256', $payload, self::key(), true)), '+/', '-_'), '=');
        if (!hash_equals($expect, $sig)) return null;
        $j = json_decode(base64_decode(strtr($payload, '-_', '+/')), true);
        if (!is_array($j) || ($j['exp'] ?? 0) < time()) return null;
        return $j;
    }
}
