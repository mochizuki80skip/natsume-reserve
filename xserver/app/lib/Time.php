<?php
// 日付・時刻ユーティリティ。日本時間で扱う（bootstrap で date_default_timezone_set('Asia/Tokyo') 済み）
declare(strict_types=1);

final class Time
{
    public const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];

    /** "09:00" → 540 */
    public static function hmToMin(string $hm): int
    {
        [$h, $m] = array_map('intval', explode(':', $hm));
        return $h * 60 + $m;
    }

    /** 540 → "9:00" */
    public static function minToHm(int $min, bool $pad = false): string
    {
        $h = intdiv($min, 60);
        $m = $min % 60;
        return ($pad ? sprintf('%02d', $h) : (string)$h) . ':' . sprintf('%02d', $m);
    }

    /** YYYY-MM-DD の妥当性 */
    public static function isValidDate(?string $s): bool
    {
        if ($s === null || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $s)) return false;
        [$y, $m, $d] = array_map('intval', explode('-', $s));
        return checkdate($m, $d, $y);
    }

    /** 0=日 … 6=土 */
    public static function weekdayOf(string $date): int
    {
        return (int)(new DateTimeImmutable($date . ' 00:00:00', new DateTimeZone('UTC')))->format('w');
    }

    public static function addDays(string $date, int $n): string
    {
        $d = new DateTimeImmutable($date . ' 00:00:00', new DateTimeZone('UTC'));
        return $d->modify(($n >= 0 ? '+' : '') . $n . ' days')->format('Y-m-d');
    }

    /** b - a（日数） */
    public static function diffDays(string $a, string $b): int
    {
        $da = new DateTimeImmutable($a . ' 00:00:00', new DateTimeZone('UTC'));
        $db = new DateTimeImmutable($b . ' 00:00:00', new DateTimeZone('UTC'));
        return (int)round(($db->getTimestamp() - $da->getTimestamp()) / 86400);
    }

    /** 日本時間の現在 ['date' => 'YYYY-MM-DD', 'minutes' => 0:00 からの分] */
    public static function nowJst(): array
    {
        $now = new DateTimeImmutable('now', new DateTimeZone('Asia/Tokyo'));
        return ['date' => $now->format('Y-m-d'), 'minutes' => (int)$now->format('G') * 60 + (int)$now->format('i')];
    }

    /** 日本時間の現在日時 "YYYY-MM-DD HH:MM:SS"（DB の createdAt 用） */
    public static function nowJstDateTime(): string
    {
        return (new DateTimeImmutable('now', new DateTimeZone('Asia/Tokyo')))->format('Y-m-d H:i:s');
    }

    /** "2026年10月21日（水）" */
    public static function formatDateJa(string $date, bool $withYear = true): string
    {
        [$y, $m, $d] = array_map('intval', explode('-', $date));
        $w = self::WEEKDAY_JA[self::weekdayOf($date)];
        return ($withYear ? "{$y}年" : '') . "{$m}月{$d}日（{$w}）";
    }

    /** "10/21(水)" */
    public static function formatDateShort(string $date): string
    {
        [, $m, $d] = array_map('intval', explode('-', $date));
        return "{$m}/{$d}(" . self::WEEKDAY_JA[self::weekdayOf($date)] . ')';
    }

    /** "YYYY-MM" → その月の日付一覧 */
    public static function datesOfMonth(string $ym): array
    {
        [$y, $m] = array_map('intval', explode('-', $ym));
        $last = (int)(new DateTimeImmutable(sprintf('%04d-%02d-01', $y, $m)))->format('t');
        $out = [];
        for ($i = 1; $i <= $last; $i++) $out[] = sprintf('%s-%02d', $ym, $i);
        return $out;
    }

    public static function isValidMonth(?string $s): bool
    {
        return $s !== null && (bool)preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $s);
    }

    /** その週の月曜日 */
    public static function mondayOf(string $date): string
    {
        return self::addDays($date, -((self::weekdayOf($date) + 6) % 7));
    }

    /** "YYYY-MM-DD HH:MM:SS" → "M/D HH:MM"（ログ表示用） */
    public static function formatDateTimeShort(string $dt): string
    {
        $d = new DateTimeImmutable($dt, new DateTimeZone('Asia/Tokyo'));
        return $d->format('n/j H:i');
    }
}
