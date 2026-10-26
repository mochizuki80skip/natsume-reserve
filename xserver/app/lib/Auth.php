<?php
// ログインセッション（署名付き Cookie）と操作対象店舗の解決
declare(strict_types=1);

final class Auth
{
    public const SESSION_COOKIE = 'bk_session';
    public const STORE_COOKIE = 'bk_store'; // 本部アカウントが表示中の店舗コード
    private const MAX_AGE = 12 * 60 * 60;
    private const MAX_LIFETIME = 30 * 86400; // 使っていても、ログインから 30 日たったらログインし直す

    private static ?array $session = null;
    private static bool $sessionLoaded = false;
    private static ?array $account = null;
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
        if (!in_array($j['role'], ['store', 'hq', 'mg', 'acct'], true)) return null;
        $iat = (int)($j['iat'] ?? ((int)$j['exp'] - self::MAX_AGE));
        if ($iat + self::MAX_LIFETIME < time()) return null;
        return ['accountId' => (string)$j['accountId'], 'role' => $j['role'], 'storeId' => isset($j['storeId']) ? (string)$j['storeId'] : null, 'code' => (string)($j['code'] ?? ''), 'exp' => (int)$j['exp'], 'iat' => $iat, 'sv' => (int)($j['sv'] ?? 0)];
    }

    public static function session(): ?array
    {
        if (self::$sessionLoaded) return self::$session;
        self::$sessionLoaded = true;
        $t = $_COOKIE[self::SESSION_COOKIE] ?? '';
        return self::$session = ($t !== '' ? self::verify($t) : null);
    }

    /** ログイン時：アカウントの sessVer（パスワードを変えたら増える）を入れて発行する */
    public static function setSessionCookie(array $s): void
    {
        $s += ['iat' => time()];
        if (!isset($s['sv'])) $s['sv'] = (int)(Db::one('SELECT sessVer FROM admin_account WHERE id = ?', [$s['accountId']])['sessVer'] ?? 0);
        setcookie(self::SESSION_COOKIE, self::sign($s), [
            'expires' => time() + self::MAX_AGE, 'path' => '/', 'httponly' => true, 'secure' => Http::secureCookie(), 'samesite' => 'Lax',
        ]);
    }

    public static function clearSessionCookie(): void
    {
        setcookie(self::SESSION_COOKIE, '', ['expires' => time() - 3600, 'path' => '/', 'httponly' => true, 'secure' => Http::secureCookie(), 'samesite' => 'Lax']);
    }

    public static function setStoreCookie(string $code): void
    {
        setcookie(self::STORE_COOKIE, $code, ['expires' => time() + 30 * 86400, 'path' => '/', 'httponly' => true, 'secure' => Http::secureCookie(), 'samesite' => 'Lax']);
    }

    /** ログイン必須（API 用：未ログインは 401） */
    public static function requireSession(): array
    {
        $s = self::session();
        if (!$s) throw new HttpError(401, 'unauthorized');
        // 毎回、アカウントが使えるか確かめる：停止・種類の変更・パスワードの変更（sessVer が増える）・店舗の停止で、次の操作から使えなくする
        if (!self::alive($s)) throw new HttpError(401, 'unauthorized');
        if ($s['role'] !== 'store' && !self::account()) throw new HttpError(401, 'unauthorized');
        // 使っている間はログインを延長する（最後の延長から 1 時間たったら有効期限を 12 時間先に延ばす。ログインした時刻は変えない）
        if (($s['exp'] ?? 0) - time() < self::MAX_AGE - 3600 && !headers_sent()) {
            self::setSessionCookie(['accountId' => $s['accountId'], 'role' => $s['role'], 'storeId' => $s['storeId'], 'code' => $s['code'], 'iat' => $s['iat'], 'sv' => $s['sv']]);
        }
        return $s;
    }

    private static ?bool $alive = null;

    /** セッションのアカウントが今も使えるか（店舗のアカウントは店舗が稼働中か、どのアカウントもパスワードを変えていないか） */
    private static function alive(array $s): bool
    {
        if (self::$alive !== null) return self::$alive;
        $a = Db::one('SELECT a.active, a.role, a.storeId, a.sessVer, s.active AS storeActive FROM admin_account a LEFT JOIN store s ON s.id = a.storeId WHERE a.id = ?', [$s['accountId']]);
        $ok = $a && (int)$a['active'] === 1 && (int)$a['sessVer'] === (int)($s['sv'] ?? 0)
            && ($s['role'] !== 'store' || ($a['role'] === 'store' && (string)$a['storeId'] === (string)$s['storeId'] && (int)$a['storeActive'] === 1));
        return self::$alive = $ok;
    }

    /** パスワードを変えた・停止したときに、そのアカウントのログインをすべて無効にする */
    public static function revoke(string $where, array $params): void
    {
        Db::exec("UPDATE admin_account SET sessVer = sessVer + 1 WHERE $where", $params);
    }

    /** ログイン中の本部・管轄MG・経理のアカウント（停止中・存在しないときは null） */
    public static function account(): ?array
    {
        if (self::$account !== null) return self::$account ?: null;
        $s = self::session();
        $a = $s ? Db::one('SELECT id, code, name, role, active, canManage, area FROM admin_account WHERE id = ?', [$s['accountId']]) : null;
        $ok = $a && (int)$a['active'] === 1 && $a['role'] !== 'store' && $a['role'] === $s['role'];
        self::$account = $ok ? $a : [];
        return $ok ? $a : null;
    }

    /** 本部アカウントの発行・停止ができる人だけ */
    public static function requireManager(): array
    {
        $s = self::requireHq();
        if (!(int)(self::account()['canManage'] ?? 0)) throw new HttpError(403, 'この操作はアカウント管理の権限がある人だけができます');
        return $s;
    }

    public static function requireHq(): array
    {
        $s = self::requireSession();
        if ($s['role'] !== 'hq') throw new HttpError(403, 'forbidden');
        return $s;
    }

    /** 本部か経理（自賠集計・窓口集計の全店の確認） */
    public static function requireHqOrAcct(): array
    {
        $s = self::requireSession();
        if ($s['role'] !== 'hq' && $s['role'] !== 'acct') throw new HttpError(403, 'forbidden');
        return $s;
    }

    /** 全店を見られる人（本部・経理・管轄MG）。全店状況・自賠集計など、見るだけの画面 */
    public static function requireViewAll(): array
    {
        $s = self::requireSession();
        if (!in_array($s['role'], ['hq', 'acct', 'mg'], true)) throw new HttpError(403, 'forbidden');
        return $s;
    }

    /** 管轄MG が開ける店舗（管轄エリアの店舗。エリアの店舗が増えれば自動で増える） */
    public static function mgStores(): array
    {
        $area = (string)(self::account()['area'] ?? '');
        $a = $area !== '' ? Db::one('SELECT storeCodes FROM area WHERE name = ?', [$area]) : null;
        $codes = $a ? array_values(array_filter(explode(',', (string)$a['storeCodes']))) : [];
        if (!$codes) return [];
        return Settings::storesInOrder('code IN (' . Db::inList($codes) . ') AND hqOnly = 0', $codes);
    }

    /** そのアカウントが見られる店舗（本部・経理・管轄MG＝全店、店舗＝自店舗） */
    public static function canOpenStore(array $session, array $store): bool
    {
        // 本部専用の店舗は本部だけ（経理・管轄MG には見せない）
        if ((int)($store['hqOnly'] ?? 0) && $session['role'] !== 'hq') return false;
        return in_array($session['role'], ['hq', 'acct', 'mg'], true) || $store['id'] === $session['storeId'];
    }

    /** そのアカウントが直せる店舗（本部＝全店、管轄MG＝管轄エリアの店舗、店舗＝自店舗、経理＝なし） */
    public static function canEditStore(array $session, array $store): bool
    {
        return match ($session['role']) {
            'hq' => true,
            'mg' => in_array($store['code'], array_column(self::mgStores(), 'code'), true),
            'acct' => false,
            default => $store['id'] === $session['storeId'],
        };
    }

    /** 操作対象の店舗。本部は Cookie（店舗切替）で選んだ店舗、無ければ先頭の稼働店舗 */
    public static function resolveStore(array $session): ?array
    {
        if (self::$storeLoaded) return self::$store;
        self::$storeLoaded = true;
        if ($session['role'] === 'store') {
            $st = $session['storeId'] ? Db::one('SELECT * FROM store WHERE id = ?', [$session['storeId']]) : null;
            // 本部専用にした店舗は、店舗のアカウントでは開けない
            return self::$store = ($st && (int)($st['hqOnly'] ?? 0)) ? null : $st;
        }
        $code = $_COOKIE[self::STORE_COOKIE] ?? '';
        if ($session['role'] === 'acct') return self::$store = null; // 経理は店舗の画面を使わない
        if ($session['role'] === 'mg') {
            // 管轄MG：切り替えた店舗（管轄外も見るだけで開ける）。まだ選んでいなければエリアの先頭の店舗
            if ($code !== '' && ($s = Db::one('SELECT * FROM store WHERE code = ? AND hqOnly = 0', [$code]))) return self::$store = $s;
            $mine = self::mgStores();
            return self::$store = $mine ? Db::one('SELECT * FROM store WHERE id = ?', [$mine[0]['id']]) : (Settings::storesInOrder('active = 1 AND hqOnly = 0', [], false)[0] ?? null);
        }
        if ($code !== '') {
            $s = Db::one('SELECT * FROM store WHERE code = ?', [$code]);
            if ($s) return self::$store = $s;
        }
        return self::$store = (Settings::storesInOrder('active = 1', [], false)[0] ?? null);
    }

    /** API 用：セッション＋店舗。店舗が無ければ 404 */
    public static function context(): array
    {
        $s = self::requireSession();
        if ($s['role'] === 'acct') throw new HttpError(403, 'この画面は経理アカウントでは使えません');
        $store = self::resolveStore($s);
        if (!$store) throw new HttpError(404, '店舗が登録されていません');
        // 管轄MG：管轄外の店舗は見るだけ（書き込みの操作は止める）
        if ($s['role'] === 'mg' && ($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET' && !self::canEditStore($s, $store)) throw new HttpError(403, '管轄外の店舗は見るだけです（直すことはできません）');
        return ['session' => $s, 'store' => $store];
    }
}
