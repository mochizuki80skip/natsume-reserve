<?php
// リクエスト／レスポンスの小さなヘルパー
declare(strict_types=1);

final class HttpError extends RuntimeException
{
    public function __construct(public readonly int $status, string $message)
    {
        parent::__construct($message);
    }
}

final class Http
{
    public static function json(mixed $data, int $status = 200, array $headers = []): never
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        foreach ($headers as $k => $v) header("$k: $v");
        echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }

    public static function error(string $message, int $status): never
    {
        self::json(['error' => $message], $status);
    }

    public static function redirect(string $to, int $status = 303): never
    {
        http_response_code($status);
        header('Location: ' . $to);
        exit;
    }

    /** JSON ボディ（不正なら []） */
    public static function body(): array
    {
        static $cached = null;
        if ($cached !== null) return $cached;
        $raw = file_get_contents('php://input') ?: '';
        $j = json_decode($raw, true);
        return $cached = (is_array($j) ? $j : []);
    }

    public static function query(string $k, ?string $default = null): ?string
    {
        $v = $_GET[$k] ?? null;
        return is_string($v) ? $v : $default;
    }

    public static function method(): string
    {
        return strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    }

    public static function clientIp(): string
    {
        $xf = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '';
        if ($xf !== '') return trim(explode(',', $xf)[0]);
        return $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    }

    public static function isHttps(): bool
    {
        return (($_SERVER['HTTPS'] ?? '') !== '' && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    }

    /** JSON を受け付ける更新系 API は Content-Type を確認する（CSRF 対策の一つ） */
    public static function requireJson(): void
    {
        $ct = $_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? '';
        if (!str_starts_with(strtolower($ct), 'application/json')) throw new HttpError(415, 'JSON で送信してください');
    }

    // ---- 入力検証の小道具 ----
    public static function int(array $b, string $k, int $min, int $max, ?int $default = null): int
    {
        if (!array_key_exists($k, $b) || $b[$k] === null || $b[$k] === '') {
            if ($default !== null) return $default;
            throw new HttpError(400, 'bad request');
        }
        $v = $b[$k];
        if (!is_int($v) && !(is_float($v) && floor($v) == $v) && !(is_string($v) && preg_match('/^-?\d+$/', $v))) throw new HttpError(400, 'bad request');
        $v = (int)$v;
        if ($v < $min || $v > $max) throw new HttpError(400, 'bad request');
        return $v;
    }

    public static function str(array $b, string $k, int $max, bool $required = true, string $default = ''): string
    {
        $v = $b[$k] ?? null;
        if ($v === null) { if ($required) throw new HttpError(400, 'bad request'); return $default; }
        if (!is_string($v)) throw new HttpError(400, 'bad request');
        $v = trim($v);
        if (mb_strlen($v) > $max) throw new HttpError(400, 'bad request');
        if ($required && $v === '') throw new HttpError(400, 'bad request');
        return $v;
    }

    public static function bool(array $b, string $k, ?bool $default = null): bool
    {
        if (!array_key_exists($k, $b)) { if ($default !== null) return $default; throw new HttpError(400, 'bad request'); }
        if (!is_bool($b[$k])) throw new HttpError(400, 'bad request');
        return $b[$k];
    }

    public static function date(array $b, string $k): string
    {
        $v = $b[$k] ?? null;
        if (!is_string($v) || !Time::isValidDate($v)) throw new HttpError(400, '日付が不正です');
        return $v;
    }
}
