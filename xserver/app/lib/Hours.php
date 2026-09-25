<?php
// 営業時間の設定と、ある日付の営業セッション（時間帯）の解決
declare(strict_types=1);

final class Hours
{
    public const NOON = 12 * 60;

    private const WEEKDAY_SESSIONS = [['09:00', '11:45'], ['15:00', '19:15']];
    private const SATURDAY_SESSIONS = [['09:00', '11:45'], ['14:00', '18:15']];

    /** 2026-10-21 から全店統一の営業時間。木・日は休診 */
    public const UNIFIED_BY_WEEKDAY = [
        '1' => self::WEEKDAY_SESSIONS,
        '2' => self::WEEKDAY_SESSIONS,
        '3' => self::WEEKDAY_SESSIONS,
        '5' => self::WEEKDAY_SESSIONS,
        '6' => self::SATURDAY_SESSIONS,
    ];

    public static function defaultHours(): array
    {
        return ['periods' => [
            ['to' => '2026-10-20', 'byWeekday' => self::UNIFIED_BY_WEEKDAY],
            ['from' => '2026-10-21', 'byWeekday' => self::UNIFIED_BY_WEEKDAY],
        ]];
    }

    /** 設定を検証して正規化した配列を返す（不正なら null） */
    public static function parseHoursConfig(mixed $v): ?array
    {
        if (!is_array($v) || !isset($v['periods']) || !is_array($v['periods'])) return null;
        $out = [];
        foreach ($v['periods'] as $p) {
            if (!is_array($p)) return null;
            $from = $p['from'] ?? null;
            $to = $p['to'] ?? null;
            if ($from !== null && !preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$from)) return null;
            if ($to !== null && !preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$to)) return null;
            if (!isset($p['byWeekday']) || !is_array($p['byWeekday'])) return null;
            $bw = [];
            foreach ($p['byWeekday'] as $k => $sessions) {
                if (!preg_match('/^[0-6]$/', (string)$k) || !is_array($sessions)) return null;
                $ss = [];
                foreach ($sessions as $s) {
                    if (!is_array($s) || count($s) !== 2) return null;
                    foreach ($s as $x) if (!is_string($x) || !preg_match('/^\d{1,2}:\d{2}$/', $x)) return null;
                    if (Time::hmToMin($s[0]) > Time::hmToMin($s[1])) return null;
                    $ss[] = [$s[0], $s[1]];
                }
                $bw[(string)$k] = $ss;
            }
            $np = ['byWeekday' => $bw];
            if ($from !== null) $np['from'] = $from;
            if ($to !== null) $np['to'] = $to;
            $out[] = $np;
        }
        return ['periods' => $out];
    }

    /** 日付に適用する期間（複数該当なら後ろ優先） */
    public static function periodForDate(array $config, string $date): ?array
    {
        $found = null;
        foreach ($config['periods'] as $p) {
            if (isset($p['from']) && $date < $p['from']) continue;
            if (isset($p['to']) && $date > $p['to']) continue;
            $found = $p;
        }
        return $found;
    }

    /**
     * 日付の営業セッション。休診なら []。
     * @return array<int, array{start:int,lastStart:int,lastAdmin:int}>
     */
    public static function sessionsForDate(array $config, string $date, bool $closeOnHolidays, bool $closed = false, int $adminExtraSlots = 0, int $slotMinutes = 15): array
    {
        if ($closed) return [];
        if ($closeOnHolidays && Holidays::isHoliday($date)) return [];
        $p = self::periodForDate($config, $date);
        if (!$p) return [];
        $sessions = $p['byWeekday'][(string)Time::weekdayOf($date)] ?? [];
        $extra = $adminExtraSlots * $slotMinutes;
        $out = [];
        foreach ($sessions as [$a, $b]) {
            $out[] = ['start' => Time::hmToMin($a), 'lastStart' => Time::hmToMin($b), 'lastAdmin' => Time::hmToMin($b) + $extra];
        }
        usort($out, fn($x, $y) => $x['start'] <=> $y['start']);
        return $out;
    }

    /** 枠の開始時刻一覧。admin なら管理側の追加枠（12:00 など）も含む */
    public static function slotTimes(array $sessions, int $slotMinutes, bool $admin = false): array
    {
        $out = [];
        foreach ($sessions as $s) {
            $end = $admin ? $s['lastAdmin'] : $s['lastStart'];
            for ($t = $s['start']; $t <= $end; $t += $slotMinutes) $out[] = $t;
        }
        return $out;
    }

    /** その時刻が午前ブロックか（12:00 の追加枠も午前セッションに属すれば午前） */
    public static function isAm(array $sessions, int $t): bool
    {
        foreach ($sessions as $s) {
            if ($t >= $s['start'] && $t <= $s['lastAdmin']) return $s['start'] < self::NOON;
        }
        return $t < self::NOON;
    }
}
