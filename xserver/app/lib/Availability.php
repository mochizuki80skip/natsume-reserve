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
//   'newLimit' => null|int,             新規（初診・初自）を同じ時間に WEB で受ける上限（null＝制限なし、0＝WEB では受けない）
//   'newCount' => ['time' => int],      その時間に入っている新規の人数
//   'countsAsNew' => bool,              今回の予約が新規か（新規のときだけ newLimit を見る）
//   'newCap' => ['am' => ?int, 'pm' => ?int],      シフトで「初回を担当する」にチェックのある人数（新規の同時上限。null＝上限なし）
//   'revisitLimit' => null|int,         再来（1ヶ月以上ご来院の無い方）を同じ時間に WEB で受ける上限（店舗設定。null＝制限なし）
//   'revisitCap' => ['am' => ?int, 'pm' => ?int],  シフトで「再来を担当する」にチェックのある人数
//   'revisitCount' => ['time' => int],  その時間に入っている再来の人数
//   'countsAsRevisit' => bool,          今回の予約が再来か
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
        $half = Hours::isAm($in['sessions'], $time) ? 'am' : 'pm';
        for ($k = 0; $k < $in['neededSlots']; $k++) {
            $t = $time + $k * $in['slotMinutes'];
            $byCapacity = min($byCapacity, self::capacityAt($in, $time) - self::occupiedCountAt($in, $t));
            // 新規の同時対応数：新規の予約は、その時間にすでに入っている新規の人数が上限に達していたら受けない
            // （上限に達するまでは通常どおり。残り 1 人でも「残りわずか」の電話マークにはしない）
            if (!empty($in['countsAsNew']) && ($lim = self::kindLimit($in['newLimit'] ?? null, $in['newCap'] ?? null, $half)) !== null && (int)($in['newCount'][$t] ?? 0) >= $lim) {
                return 0;
            }
            // 再来の同時対応数：店舗設定とシフトの「再来を担当する」人数の小さいほう
            if (!empty($in['countsAsRevisit']) && ($lim = self::kindLimit($in['revisitLimit'] ?? null, $in['revisitCap'] ?? null, $half)) !== null && (int)($in['revisitCount'][$t] ?? 0) >= $lim) {
                return 0;
            }
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
            if ($lead <= $in['webCutoffMinutes']) return 'phone'; // 開始 30 分前（ちょうどを含む）からは電話マーク
        }
        if ($remaining <= 0) return 'closed';
        if ($remaining <= $in['phoneMarkRemaining']) return 'phone';
        return 'open';
    }

    /** @return array<int, array{time:int,status:string,remaining:int}> */
    public static function compute(array $in): array
    {
        $out = [];
        // 新規を WEB で受けない店舗（0）：空いている時間は電話マークにして、電話での予約に案内する
        $phoneOnly = self::newByPhoneOnly($in);
        $free = $phoneOnly ? ['newLimit' => null] + $in : $in;
        foreach ($in['sessions'] as $s) {
            for ($t = $s['start']; $t <= $s['lastStart']; $t += $in['slotMinutes']) {
                if ($phoneOnly) {
                    $base = self::remainingAt($free, $t);
                    $out[] = ['time' => $t, 'status' => self::statusFor($free, $t, $base) === 'closed' ? 'closed' : 'phone', 'remaining' => 0];
                    continue;
                }
                $r = self::remainingAt($in, $t);
                $out[] = ['time' => $t, 'status' => self::statusFor($in, $t, $r), 'remaining' => $r];
            }
        }
        return $out;
    }

    /** 店舗設定の上限とシフトから決まる上限の小さいほう（どちらも無ければ null＝上限なし） */
    private static function kindLimit(?int $storeLimit, ?array $cap, string $half): ?int
    {
        $byShift = $cap[$half] ?? null;
        if ($storeLimit === null) return $byShift === null ? null : (int)$byShift;
        return $byShift === null ? $storeLimit : min($storeLimit, (int)$byShift);
    }

    /** 新規の予約で、店舗が新規を WEB では受けない設定（0）か */
    public static function newByPhoneOnly(array $in): bool
    {
        return !empty($in['countsAsNew']) && ($in['newLimit'] ?? null) !== null && (int)$in['newLimit'] === 0;
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
