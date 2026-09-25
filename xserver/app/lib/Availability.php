<?php
// 空き状況の判定（純粋関数。DB に依存しない）
//
// $input = [
//   'sessions' => Hours::sessionsForDate(...),
//   'slotMinutes' => 15,
//   'beds' => [1,2,...],               物理ベッド番号
//   'capacityAm' => int, 'capacityPm' => int,   顧客に見せる枠数（午前/午後）
//   'occupied' => ['time:bed' => true, ...],   埋まっているセル（✖ などの閉鎖印も含む）
//   'blocked' => ['time:bed' => true, ...],    ✖ などの閉鎖印（施術者数は消費しない）
//   'neededSlots' => int,               必要な連続枠数
//   'phoneMarkRemaining' => int,
//   'nowMinutes' => null|int|INF,       今日なら現在時刻、未来日は null、過去日は INF
//   'webCutoffMinutes' => int, 'phoneCutoffMinutes' => int,
// ]
declare(strict_types=1);

final class Availability
{
    public static function key(int $time, int $bed): string
    {
        return "{$time}:{$bed}";
    }

    public static function capacityAt(array $in, int $time): int
    {
        return Hours::isAm($in['sessions'], $time) ? $in['capacityAm'] : $in['capacityPm'];
    }

    /** そのベッドが time から neededSlots 枠連続で空いているか */
    public static function bedFreeAt(array $in, int $time, int $bed): bool
    {
        $session = null;
        foreach ($in['sessions'] as $s) if ($time >= $s['start'] && $time <= $s['lastStart']) { $session = $s; break; }
        if (!$session) return false;
        for ($k = 0; $k < $in['neededSlots']; $k++) {
            $t = $time + $k * $in['slotMinutes'];
            if ($t > $session['lastAdmin']) return false; // 2枠目以降は管理側の追加枠まで使える
            if (isset($in['occupied'][self::key($t, $bed)])) return false;
        }
        return true;
    }

    /** 必要枠数ぶん連続で空いている物理ベッド番号（小さい順） */
    public static function freeBedsAt(array $in, int $time): array
    {
        $out = [];
        foreach ($in['beds'] as $b) if (self::bedFreeAt($in, $time, $b)) $out[] = $b;
        sort($out);
        return $out;
    }

    /** 指定時刻に患者が入っているベッド数（閉鎖印は数えない） */
    public static function occupiedCountAt(array $in, int $time): int
    {
        $n = 0;
        foreach ($in['beds'] as $b) {
            $k = self::key($time, $b);
            if (isset($in['occupied'][$k]) && !isset($in['blocked'][$k])) $n++;
        }
        return $n;
    }

    /** 顧客に見せる残り枠数 */
    public static function remainingAt(array $in, int $time): int
    {
        $free = count(self::freeBedsAt($in, $time));
        if ($free === 0) return 0;
        $byCapacity = PHP_INT_MAX;
        for ($k = 0; $k < $in['neededSlots']; $k++) {
            $t = $time + $k * $in['slotMinutes'];
            $byCapacity = min($byCapacity, self::capacityAt($in, $time) - self::occupiedCountAt($in, $t));
        }
        return max(0, min($free, $byCapacity));
    }

    /** 'open' | 'phone' | 'closed' */
    public static function statusFor(array $in, int $time, int $remaining): string
    {
        if ($in['nowMinutes'] !== null) {
            $lead = $time - $in['nowMinutes'];
            if ($lead < $in['phoneCutoffMinutes']) return 'closed';
            if ($remaining <= 0) return 'closed';
            if ($lead < $in['webCutoffMinutes']) return 'phone';
        }
        if ($remaining <= 0) return 'closed';
        if ($remaining <= $in['phoneMarkRemaining']) return 'phone';
        return 'open';
    }

    /** @return array<int, array{time:int,status:string,remaining:int}> */
    public static function compute(array $in): array
    {
        $out = [];
        foreach ($in['sessions'] as $s) {
            for ($t = $s['start']; $t <= $s['lastStart']; $t += $in['slotMinutes']) {
                $r = self::remainingAt($in, $t);
                $out[] = ['time' => $t, 'status' => self::statusFor($in, $t, $r), 'remaining' => $r];
            }
        }
        return $out;
    }

    private const NOT_A_PATIENT = ['〃', '"', '✖', '×', 'X', 'x', '-', 'ー', '－', '休', '休み', '上記初診対応', '上記再来対応'];
    private const BLOCK_MARKS = ['✖', '×', 'X', 'x', '-', 'ー', '－', '休', '休み'];

    /** 予約表の氏名セルとして数えるか */
    public static function isPatientText(?string $text): bool
    {
        $t = trim($text ?? '');
        return $t !== '' && !in_array($t, self::NOT_A_PATIENT, true);
    }

    public static function isOccupiedText(?string $text): bool
    {
        return trim($text ?? '') !== '';
    }

    /** ベッド閉鎖の印か */
    public static function isBlockMark(?string $text): bool
    {
        return in_array(trim($text ?? ''), self::BLOCK_MARKS, true);
    }
}
