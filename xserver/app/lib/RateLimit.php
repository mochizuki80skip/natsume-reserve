<?php
// 簡易レート制限（DB のテーブルで数える。共用サーバーでも複数プロセスで共有できる）
declare(strict_types=1);

final class RateLimit
{
    /** limit 回 / windowSec 秒を超えたら false */
    public static function allow(string $key, int $limit, int $windowSec): bool
    {
        $now = time();
        try {
            $row = Db::one('SELECT cnt, resetAt FROM rate_limit WHERE k = ?', [$key]);
            if (!$row || (int)$row['resetAt'] < $now) {
                Db::exec('REPLACE INTO rate_limit (k, cnt, resetAt) VALUES (?, 1, ?)', [$key, $now + $windowSec]);
                if (random_int(1, 50) === 1) Db::exec('DELETE FROM rate_limit WHERE resetAt < ?', [$now]);
                return true;
            }
            Db::exec('UPDATE rate_limit SET cnt = cnt + 1 WHERE k = ?', [$key]);
            return (int)$row['cnt'] + 1 <= $limit;
        } catch (Throwable) {
            return true; // テーブルが無いなどの場合は制限しない
        }
    }

    /** 数えずに、すでに limit 回に達しているかだけを見る（失敗したときだけ hit で数える使い方） */
    public static function blocked(string $key, int $limit): bool
    {
        try {
            $row = Db::one('SELECT cnt, resetAt FROM rate_limit WHERE k = ?', [$key]);
            return $row && (int)$row['resetAt'] >= time() && (int)$row['cnt'] >= $limit;
        } catch (Throwable) {
            return false;
        }
    }

    public static function hit(string $key, int $windowSec): void
    {
        self::allow($key, PHP_INT_MAX, $windowSec);
    }
}
