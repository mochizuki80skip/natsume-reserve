<?php
// 外部 API 呼び出しの小さな HTTP クライアント（curl）
declare(strict_types=1);

final class SnsApiError extends RuntimeException
{
    public function __construct(string $message, public readonly int $status = 0, public readonly ?array $json = null)
    {
        parent::__construct($message);
    }
}

final class SnsHttp
{
    /**
     * @param array{query?:array, form?:array, json?:mixed, headers?:string[], timeout?:int} $opt
     * @return array{status:int, body:string, json:?array}
     */
    public static function request(string $method, string $url, array $opt = []): array
    {
        if (!empty($opt['query'])) $url .= (str_contains($url, '?') ? '&' : '?') . http_build_query($opt['query']);
        $headers = $opt['headers'] ?? [];
        $ch = curl_init($url);
        $o = [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => $opt['timeout'] ?? 30, CURLOPT_CUSTOMREQUEST => $method, CURLOPT_FOLLOWLOCATION => false];
        if (array_key_exists('json', $opt)) {
            $o[CURLOPT_POSTFIELDS] = json_encode($opt['json'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            $headers[] = 'Content-Type: application/json';
        } elseif (!empty($opt['form'])) {
            $o[CURLOPT_POSTFIELDS] = http_build_query($opt['form']);
            $headers[] = 'Content-Type: application/x-www-form-urlencoded';
        }
        if ($headers) $o[CURLOPT_HTTPHEADER] = $headers;
        curl_setopt_array($ch, $o);
        $body = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        if ($body === false) throw new SnsApiError('通信に失敗しました: ' . $err);
        $json = json_decode($body, true);
        return ['status' => $status, 'body' => $body, 'json' => is_array($json) ? $json : null];
    }

    /** 2xx 以外は例外。エラー本文から読める説明を取り出す */
    public static function requestOk(string $method, string $url, array $opt = []): array
    {
        $r = self::request($method, $url, $opt);
        if ($r['status'] < 200 || $r['status'] >= 300) {
            $j = $r['json'];
            $msg = $j['error']['message'] ?? $j['error_message'] ?? $j['error']['error_user_msg'] ?? $j['error_description'] ?? $j['message'] ?? (is_string($j['error'] ?? null) ? $j['error'] : null) ?? mb_substr($r['body'], 0, 200);
            throw new SnsApiError("HTTP {$r['status']}: {$msg}", $r['status'], $j);
        }
        return $r['json'] ?? [];
    }
}
