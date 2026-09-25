<?php
// 日本の祝日判定（内閣府の祝日法に基づく計算。2000 年以降を対象）
declare(strict_types=1);

final class Holidays
{
    /** @var array<int, array<string, string>> 年 → [日付 => 名称] */
    private static array $cache = [];

    public static function isHoliday(string $date): bool
    {
        $y = (int)substr($date, 0, 4);
        return isset(self::forYear($y)[$date]);
    }

    /** @return array<string, string> 日付 => 名称 */
    public static function forYear(int $y): array
    {
        if (isset(self::$cache[$y])) return self::$cache[$y];
        $h = [];
        $d = fn(int $m, int $day) => sprintf('%04d-%02d-%02d', $y, $m, $day);
        $h[$d(1, 1)] = '元日';
        $h[self::nthMonday($y, 1, 2)] = '成人の日';
        $h[$d(2, 11)] = '建国記念の日';
        if ($y >= 2020) $h[$d(2, 23)] = '天皇誕生日';
        $h[$d(3, self::equinox($y, true))] = '春分の日';
        $h[$d(4, 29)] = '昭和の日';
        $h[$d(5, 3)] = '憲法記念日';
        $h[$d(5, 4)] = 'みどりの日';
        $h[$d(5, 5)] = 'こどもの日';
        // 海の日・スポーツの日・山の日（2020・2021 年はオリンピック特例）
        if ($y === 2020) { $h[$d(7, 23)] = '海の日'; $h[$d(7, 24)] = 'スポーツの日'; $h[$d(8, 10)] = '山の日'; }
        elseif ($y === 2021) { $h[$d(7, 22)] = '海の日'; $h[$d(7, 23)] = 'スポーツの日'; $h[$d(8, 8)] = '山の日'; }
        else {
            $h[self::nthMonday($y, 7, 3)] = '海の日';
            if ($y >= 2016) $h[$d(8, 11)] = '山の日';
            $h[self::nthMonday($y, 10, 2)] = $y >= 2020 ? 'スポーツの日' : '体育の日';
        }
        $h[self::nthMonday($y, 9, 3)] = '敬老の日';
        $h[$d(9, self::equinox($y, false))] = '秋分の日';
        $h[$d(11, 3)] = '文化の日';
        $h[$d(11, 23)] = '勤労感謝の日';

        // 振替休日：祝日が日曜なら、その後の最初の「祝日でない日」が休日
        $subs = [];
        foreach (array_keys($h) as $date) {
            if (Time::weekdayOf($date) !== 0) continue;
            $n = Time::addDays($date, 1);
            while (isset($h[$n]) || isset($subs[$n])) $n = Time::addDays($n, 1);
            $subs[$n] = '振替休日';
        }
        $h += $subs;

        // 国民の休日：前日と翌日が祝日の平日（日曜・振替休日を除く）
        $all = array_keys($h);
        $extra = [];
        foreach ($all as $date) {
            $mid = Time::addDays($date, 1);
            $next = Time::addDays($date, 2);
            if (isset($h[$next]) && !isset($h[$mid]) && Time::weekdayOf($mid) !== 0) $extra[$mid] = '国民の休日';
        }
        $h += $extra;
        ksort($h);
        return self::$cache[$y] = $h;
    }

    /** 第 n 月曜日 */
    private static function nthMonday(int $y, int $m, int $n): string
    {
        $first = sprintf('%04d-%02d-01', $y, $m);
        $w = Time::weekdayOf($first); // 0=日
        $offset = (8 - $w) % 7; // 最初の月曜までの日数
        return Time::addDays($first, $offset + 7 * ($n - 1));
    }

    /** 春分・秋分の日（1980〜2099 年の近似式） */
    private static function equinox(int $y, bool $spring): int
    {
        $base = $spring ? 20.8431 : 23.2488;
        return (int)floor($base + 0.242194 * ($y - 1980) - floor(($y - 1980) / 4));
    }
}
