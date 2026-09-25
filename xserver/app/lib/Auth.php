<?php
// ログインセッション（署名付き Cookie）と操作対象店舗の解決
declare(strict_types=1);

final class Auth
{
    public const SESSION_COOKIE = 'bk_session';
    public const STORE_COOKIE = 'bk_store'; // 本部アカウントが表示中の店舗コード
    private const MAX_AGE = 12 * 60 * 60;

    private static ?array $session = null;
    private static bool $sessionLoaded = false;
    private static ?array $store = null;
    private static bool $storeLoaded = false;

    private static function secret(): string
    {
        $s = Config::str('SESSION_SECRET');
        if (strlen($s) < 16) throw new RuntimeException('SESSION_SECRET が設定されていません（config.php に 16 文字以上の乱数を設定してください）');
        return $s;
    }

    /** @param array{accountId:string,role:string,storeId:?string,code:string} $s */
    public static function sign(array $s): string
    {
        $payload = rtrim(strtr(base64_encode(json_encode($s + ['exp' => time() + self::MAX_AGE], JSON_UNESCAPED_UNICODE)), '+/', '-_'), '=');
        $sig = rtrim(strtr(base64_encode(hash_hmac('sha256', $payload, self::secret(), true)), '+/', '-_'), '=');
        return "$payload.$sig";
    }

    public static function verify(string $token): ?array
    {
        $parts = explode('.', $token);
        if (count($parts) !== 2) return null;
        [$payload, $sig] = $parts;
        $expect = rtrim(strtr(base64_encode(hash_hmac('sha256', $payload, self::secret(), true)), '+/', '-_'), '=');
        if (!hash_equals($expect, $sig)) return null;
        $j = json_decode(base64_decode(strtr($payload, '-_', '+/')), true);
        if (!is_array($j) || !isset($j['accountId'], $j['role'], $j['exp'])) return null;
        if ($j['exp'] < time()) return null;
        if ($j['role'] !== 'store' && $j['role'] !== 'hq') return null;
        return ['accountId' => (string)$j['accountId'], 'role' => $j['role'], 'storeId' => isset($j['storeId']) ? (string)$j['storeId'] : null, 'code' => (string)($j['code'] ?? '')];
    }

    public static function session(): ?array
    {
        if (self::$sessionLoaded) return self::$session;
        self::$sessionLoaded = true;
        $t = $_COOKIE[self::SESSION_COOKIE] ?? '';
        return self::$session = ($t !== '' ? self::verify($t) : null);
    }

    public static function setSessionCookie(array $s): void
    {
        setcookie(self::SESSION_COOKIE, self::sign($s), [
            'expires' => time() + self::MAX_AGE, 'path' => '/', 'httponly' => true, 'secure' => Http::isHttps(), 'samesite' => 'Lax',
        ]);
    }

    public static function clearSessionCookie(): void
    {
        setcookie(self::SESSION_COOKIE, '', ['expires' => time() - 3600, 'path' => '/', 'httponly' => true, 'secure' => Http::isHttps(), 'samesite' => 'Lax']);
    }

    public static function setStoreCookie(string $code): void
    {
        setcookie(self::STORE_COOKIE, $code, ['expires' => time() + 30 * 86400, 'path' => '/', 'httponly' => true, 'secure' => Http::isHttps(), 'samesite' => 'Lax']);
    }

    /** ログイン必須（API 用：未ログインは 401） */
    public static function requireSession(): array
    {
        $s = self::session();
        if (!$s) throw new HttpError(401, 'unauthorized');
        return $s;
    }

    public static function requireHq(): array
    {
        $s = self::requireSession();
        if ($s['role'] !== 'hq') throw new HttpError(403, 'forbidden');
        return $s;
    }

    /** 操作対象の店舗。本部は Cookie（店舗切替）で選んだ店舗、無ければ先頭の稼働店舗 */
    public static function resolveStore(array $session): ?array
    {
        if (self::$storeLoaded) return self::$store;
        self::$storeLoaded = true;
        if ($session['role'] === 'store') {
            return self::$store = ($session['storeId'] ? Db::one('SELECT * FROM store WHERE id = ?', [$session['storeId']]) : null);
        }
        $code = $_COOKIE[self::STORE_COOKIE] ?? '';
        if ($code !== '') {
            $s = Db::one('SELECT * FROM store WHERE code = ?', [$code]);
            if ($s) return self::$store = $s;
        }
        return self::$store = Db::one('SELECT * FROM store WHERE active = 1 ORDER BY code ASC LIMIT 1');
    }

    /** API 用：セッション＋店舗。店舗が無ければ 404 */
    public static function context(): array
    {
        $s = self::requireSession();
        $store = self::resolveStore($s);
        if (!$store) throw new HttpError(404, '店舗が登録されていません');
        return ['session' => $s, 'store' => $store];
    }
}
