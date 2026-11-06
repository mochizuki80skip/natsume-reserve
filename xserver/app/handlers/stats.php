<?php
// 集計API（/api/stats/...・統合ダッシュボード用・読み取り専用）と、本部画面での API キーの発行・停止（/api/admin/hq/api-keys）
declare(strict_types=1);

const STATS_RATE_LIMIT = 60; // 1 キーあたり 1 分に 60 回

final class StatsFail extends RuntimeException
{
    public function __construct(public readonly int $status, public readonly string $codeName, string $message)
    {
        parent::__construct($message);
    }
}

function stats_now_iso(): string
{
    return (new DateTimeImmutable('now', new DateTimeZone('Asia/Tokyo')))->format('Y-m-d\TH:i:sP');
}

/** 送られてきたキー（Authorization: Bearer、届かないサーバー用に X-API-Key も） */
function stats_key_from_request(): string
{
    $auth = (string)($_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
    if ($auth === '' && function_exists('getallheaders')) {
        foreach ((array)getallheaders() as $k => $v) if (strcasecmp((string)$k, 'Authorization') === 0) $auth = (string)$v;
    }
    if (preg_match('/^Bearer\s+(\S+)$/i', trim($auth), $m)) return $m[1];
    return trim((string)($_SERVER['HTTP_X_API_KEY'] ?? ''));
}

function stats_ip_allowed(string $list, string $ip): bool
{
    $items = array_filter(array_map('trim', preg_split('/[\s,]+/', $list) ?: []));
    if (!$items) return true;
    return in_array($ip, $items, true);
}

/** キーを確かめる。だめなら StatsFail（401・403・429） */
function stats_auth(): array
{
    $ip = Http::clientIp();
    $loopback = in_array($ip, ['127.0.0.1', '::1'], true);
    if (!Http::isHttps() && !$loopback) throw new StatsFail(403, 'https_required', 'HTTPS で接続してください');
    if (RateLimit::blocked('statsfail:' . $ip, 20)) throw new StatsFail(429, 'rate_limited', 'キーの間違いが続いたため、しばらく受け付けません');
    $key = stats_key_from_request();
    $row = $key !== '' && strlen($key) <= 200 ? Db::one('SELECT * FROM api_key WHERE keyHash = ?', [hash('sha256', $key)]) : null;
    if (!$row || !(int)$row['active']) {
        RateLimit::hit('statsfail:' . $ip, 600);
        throw new StatsFail(401, 'unauthorized', $row ? 'この API キーは停止されています' : 'API キーがないか、正しくありません');
    }
    if (!stats_ip_allowed((string)$row['allowedIps'], $ip)) throw new StatsFail(403, 'forbidden', 'この接続元（IP）からは使えません');
    if (!RateLimit::allow('stats:' . $row['id'], STATS_RATE_LIMIT, 60)) throw new StatsFail(429, 'rate_limited', '1 分間に ' . STATS_RATE_LIMIT . ' 回までです。少し待ってから呼んでください');
    Db::exec('UPDATE api_key SET lastUsedAt = ?, lastIp = ? WHERE id = ?', [Time::nowJstDateTime(), mb_substr($ip, 0, 45), $row['id']]);
    return $row;
}

function stats_log(?array $key, string $action, string $detail, int $status): void
{
    try {
        Db::exec('INSERT INTO audit_log (accountId, actor, storeCode, action, detail, status) VALUES (?, ?, ?, ?, ?, ?)', [
            $key ? 'api:' . $key['id'] : '', mb_substr($key ? '集計API（' . $key['name'] . '）' : '集計API（キーなし・誤り）', 0, 60), '', $action, mb_substr($detail, 0, 120), $status,
        ]);
    } catch (Throwable $e) {
        error_log('[stats] ' . $e->getMessage());
    }
}

/** 店舗コードの指定（stores=RN,SN。省略は全店舗） */
function stats_stores_param(): array
{
    $raw = trim((string)Http::query('stores', ''));
    $codes = $raw === '' ? [] : array_values(array_unique(array_filter(array_map('trim', explode(',', $raw)))));
    if (count($codes) > 200) throw new HttpError(400, '店舗の指定が多すぎます');
    return StatsApi::stores($codes);
}

function stats_ym_param(): string
{
    $ym = (string)Http::query('ym', '');
    if (!Time::isValidMonth($ym)) throw new HttpError(400, 'ym の形式が正しくありません（例：2026-11）');
    return $ym;
}

/** 共通：キーの確認 → 計算 → { ok, apiVersion, generatedAt, period, definitions, data }。エラーは { ok:false, error:{code,message} } */
function stats_run(string $name, callable $fn): never
{
    $action = 'api.stats.' . $name;
    $key = null;
    $detail = '';
    try {
        $key = stats_auth();
        [$period, $data, $detail] = $fn();
        stats_log($key, $action, $detail, 200);
        Http::json(['ok' => true, 'apiVersion' => StatsApi::VERSION, 'generatedAt' => stats_now_iso(), 'period' => $period, 'definitions' => StatsApi::definitions(), 'data' => $data]);
    } catch (StatsFail $e) {
        if ($e->status !== 429 || $key) stats_log($key, $action, $detail, $e->status);
        Http::json(['ok' => false, 'error' => ['code' => $e->codeName, 'message' => $e->getMessage()]], $e->status);
    } catch (HttpError $e) {
        stats_log($key, $action, $detail, $e->status);
        Http::json(['ok' => false, 'error' => ['code' => $e->status === 400 ? 'invalid_param' : 'error', 'message' => $e->getMessage()]], $e->status);
    }
}

function stats_meta(): never
{
    stats_run('meta', fn() => [null, StatsApi::meta(), '']);
}

function stats_daily(): never
{
    stats_run('daily', function () {
        $from = (string)Http::query('from', '');
        $to = (string)Http::query('to', '');
        if (!Time::isValidDate($from)) throw new HttpError(400, 'from の形式が正しくありません（例：2026-11-01）');
        if (!Time::isValidDate($to)) throw new HttpError(400, 'to の形式が正しくありません（例：2026-11-30）');
        if ($to < $from) throw new HttpError(400, 'to は from 以降にしてください');
        if (Time::addDays($from, StatsApi::MAX_DAYS - 1) < $to) throw new HttpError(400, '期間は ' . StatsApi::MAX_DAYS . ' 日までです');
        $stores = stats_stores_param();
        return [['from' => $from, 'to' => $to], StatsApi::daily($stores, $from, $to), "{$from}〜{$to}"];
    });
}

function stats_month_endpoint(string $name, callable $calc): never
{
    stats_run($name, function () use ($calc) {
        $ym = stats_ym_param();
        $stores = stats_stores_param();
        $d = Time::datesOfMonth($ym);
        return [['from' => $d[0], 'to' => end($d), 'ym' => $ym], $calc($stores, $ym), $ym];
    });
}

function stats_monthly(): never { stats_month_endpoint('monthly', [StatsApi::class, 'monthly']); }
function stats_retention(): never { stats_month_endpoint('retention', [StatsApi::class, 'retention']); }
function stats_churn(): never { stats_month_endpoint('churn', [StatsApi::class, 'churn']); }
function stats_staff(): never { stats_month_endpoint('staff', [StatsApi::class, 'staff']); }

// ---------- 本部画面：API キーの発行・停止（アカウント管理の権限がある人だけ） ----------

function api_key_row(array $r): array
{
    return ['id' => $r['id'], 'name' => $r['name'], 'prefix' => $r['prefix'], 'allowedIps' => $r['allowedIps'], 'active' => (bool)$r['active'],
        'lastUsedAt' => $r['lastUsedAt'] ? Time::formatDateTimeShort($r['lastUsedAt']) : '', 'lastIp' => $r['lastIp'],
        'createdAt' => Time::formatDateTimeShort($r['createdAt']), 'createdBy' => $r['createdBy']];
}

function api_key_clean_ips(mixed $v): string
{
    $items = array_values(array_unique(array_filter(array_map('trim', preg_split('/[\s,、]+/u', (string)$v) ?: []))));
    foreach ($items as $ip) if (!filter_var($ip, FILTER_VALIDATE_IP)) throw new HttpError(400, "IP アドレス「{$ip}」が正しくありません");
    $s = implode(',', $items);
    if (strlen($s) > 500) throw new HttpError(400, 'IP アドレスが多すぎます');
    return $s;
}

function hq_api_keys_get(): never
{
    Auth::requireManager();
    Http::json(['keys' => array_map('api_key_row', Db::all('SELECT * FROM api_key ORDER BY active DESC, createdAt DESC')), 'base' => rtrim(Config::str('APP_URL'), '/') . '/api/stats/']);
}

function hq_api_keys_post(): never
{
    Auth::requireManager();
    Http::requireJson();
    $b = Http::body();
    $name = mb_substr(trim((string)($b['name'] ?? '')), 0, 40);
    if ($name === '') Http::error('名前を入れてください（例：統合ダッシュボード）', 400);
    $ips = api_key_clean_ips($b['allowedIps'] ?? '');
    $key = 'nsk_' . bin2hex(random_bytes(24));
    $acc = Auth::account();
    Db::exec('INSERT INTO api_key (id, name, keyHash, prefix, allowedIps, createdBy) VALUES (?, ?, ?, ?, ?, ?)',
        [Db::newId(), $name, hash('sha256', $key), substr($key, 0, 10), $ips, mb_substr((string)($acc['name'] ?? ''), 0, 60)]);
    // キーそのものはこのとき 1 回だけ返す（保存しているのはハッシュだけ）
    Http::json(['ok' => true, 'key' => $key]);
}

function hq_api_keys_put(): never
{
    Auth::requireManager();
    Http::requireJson();
    $b = Http::body();
    $r = Db::one('SELECT * FROM api_key WHERE id = ?', [(string)($b['id'] ?? '')]);
    if (!$r) Http::error('not found', 404);
    if (array_key_exists('active', $b)) Db::exec('UPDATE api_key SET active = ? WHERE id = ?', [Http::bool($b, 'active') ? 1 : 0, $r['id']]);
    if (array_key_exists('allowedIps', $b)) Db::exec('UPDATE api_key SET allowedIps = ? WHERE id = ?', [api_key_clean_ips($b['allowedIps']), $r['id']]);
    if (array_key_exists('name', $b)) {
        $name = mb_substr(trim((string)$b['name']), 0, 40);
        if ($name === '') Http::error('名前を入れてください', 400);
        Db::exec('UPDATE api_key SET name = ? WHERE id = ?', [$name, $r['id']]);
    }
    Http::json(['ok' => true]);
}

function hq_api_keys_delete(): never
{
    Auth::requireManager();
    Http::requireJson();
    $r = Db::one('SELECT id, active FROM api_key WHERE id = ?', [(string)(Http::body()['id'] ?? '')]);
    if (!$r) Http::error('not found', 404);
    if ((int)$r['active']) Http::error('先に停止してから削除してください', 400);
    Db::exec('DELETE FROM api_key WHERE id = ?', [$r['id']]);
    Http::json(['ok' => true]);
}
