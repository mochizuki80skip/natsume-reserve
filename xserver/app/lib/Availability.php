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
//   'eitherCap' => ['am' => ?int, 'pm' => ?int],   新規と再来を合わせた上限（初回か再来を担当できる人数。1 人が 1 人を受ける）
//   'kindBedStop' => ['time:bed' => true], WEB の受付を止めたベッド（ベッドを選んだとき。今回の予約の区分だけ）
//   'kindStop' => ['time' => true],     新規・再来を止める時間（予約表の「新規・再来を止める」。今回の予約が初診・再来のとき）
//   'webFar' => bool,                   WEB で予約できる日数より先の日（空いていても電話マーク）
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

    /** その時刻が、その日の予約サイトの枠の時刻か（枠の始まりから slotMinutes きざみ。WEB 予約は枠の時刻だけ受ける） */
    public static function onGrid(array $in, int $time): bool
    {
        foreach ($in['sessions'] as $s) {
            if ($time >= $s['start'] && $time <= $s['lastStart'] && ($time - $s['start']) % $in['slotMinutes'] === 0) return true;
        }
        return false;
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
            if (isset($in['kindBedStop'][self::key($t, $bed)])) return false; // WEB の受付を止めたベッド（この区分だけ）
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

    /**
     * WEB の受付を止めたベッド（今回の区分）のうち、顧客に見せる枠の中で、まだ患者様の入っていないベッドの数。
     * 従来のブロックと同じく、枠の中のベッドならその区分の枠を 1 つ減らす
     */
    public static function kindBedCutAt(array $in, int $time): int
    {
        if (empty($in['kindBedStop'])) return 0;
        $cap = self::capacityAt($in, $time);
        $n = 0;
        foreach ($in['beds'] as $b) {
            $k = self::key($time, $b);
            if ($b <= $cap && isset($in['kindBedStop'][$k]) && !(isset($in['occupied'][$k]) && !isset($in['blocked'][$k]))) $n++;
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
            $byCapacity = min($byCapacity, self::capacityAt($in, $time) - self::occupiedCountAt($in, $t) - self::kindBedCutAt($in, $t));
            // 新規の同時対応数：新規の予約は、その時間にすでに入っている新規の人数が上限に達していたら受けない
            // （上限に達するまでは通常どおり。残り 1 人でも「残りわずか」の電話マークにはしない）
            if (!empty($in['countsAsNew']) && ($lim = self::kindLimit($in['newLimit'] ?? null, $in['newCap'] ?? null, $half)) !== null && (int)($in['newCount'][$t] ?? 0) >= $lim) {
                return 0;
            }
            // 再来の同時対応数：店舗設定とシフトの「再来を担当する」人数の小さいほう
            if (!empty($in['countsAsRevisit']) && ($lim = self::kindLimit($in['revisitLimit'] ?? null, $in['revisitCap'] ?? null, $half)) !== null && (int)($in['revisitCount'][$t] ?? 0) >= $lim) {
                return 0;
            }
            // 新規と再来を合わせて、初回か再来を担当できる人数まで（1 人が 1 人の患者様を受ける）
            if ((!empty($in['countsAsNew']) || !empty($in['countsAsRevisit'])) && ($lim = $in['eitherCap'][$half] ?? null) !== null
                && (int)($in['newCount'][$t] ?? 0) + (int)($in['revisitCount'][$t] ?? 0) >= $lim) {
                return 0;
            }
            // 新規・再来を止めている時間
            if (isset($in['kindStop'][$t])) return 0;
        }
        return max(0, min($free, $byCapacity));
    }

    /** 'open'（〇）| 'few'（△：残りわずか。WEB で予約できる）| 'phone'（📞：直前・WEB で予約できる日数より先）| 'closed'（×） */
    public static function statusFor(array $in, int $time, int $remaining): string
    {
        if ($in['nowMinutes'] !== null) {
            $lead = $time - $in['nowMinutes'];
            if ($lead < $in['phoneCutoffMinutes']) return 'closed';
            if ($remaining <= 0) return 'closed';
            if ($lead <= $in['webCutoffMinutes']) return 'phone'; // 開始 30 分前（ちょうどを含む）からは電話マーク
        }
        if ($remaining <= 0) return 'closed';
        if ($remaining <= $in['phoneMarkRemaining']) return 'few';
        return 'open';
    }

    /** @return array<int, array{time:int,status:string,remaining:int}> */
    public static function compute(array $in): array
    {
        $out = [];
        // 新規を WEB で受けない店舗（0）：空いている時間は電話マークにして、電話での予約に案内する
        $phoneOnly = self::newByPhoneOnly($in) || !empty($in['webFar']);
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

    /**
     * ご家族（お連れ様）と同じ時間に予約できるか。inputs は区分ごとの入力（buildInput）、kinds は 1人目から順の区分。
     * 1 人ずつ空いているベッドに仮に入れて（同じ時間・別のベッド）、次の人の空きを見る。全員入れば open（残りわずかがあれば few）
     */
    public static function groupStatusAt(array $inputs, array $kinds, int $time): string
    {
        $virtual = [];
        $worst = 'open';
        foreach ($kinds as $k) {
            $in = $inputs[$k];
            foreach ($virtual as $v) self::addVirtual($in, ...$v);
            if (self::newByPhoneOnly($in) || !empty($in['webFar'])) return 'phone';
            $st = self::statusFor($in, $time, self::remainingAt($in, $time));
            if ($st !== 'open' && $st !== 'few') return $st === 'phone' ? 'phone' : 'closed';
            if ($st === 'few') $worst = 'few';
            $free = self::freeBedsAt($in, $time);
            if (!$free) return 'closed';
            $virtual[] = [$time, $free[0], $k, (int)$in['neededSlots']];
        }
        return $worst;
    }

    /** 仮に 1 人入れる（そのベッドを必要な枠ぶん埋め、新規・再来の人数にも足す。予約表のセルと同じ数え方） */
    private static function addVirtual(array &$in, int $time, int $bed, string $kind, int $needed): void
    {
        for ($k = 0; $k < $needed; $k++) {
            $t = $time + $k * $in['slotMinutes'];
            $in['occupied'][self::key($t, $bed)] = true;
            if ($kind === 'NEW' || $kind === 'ACCIDENT') $in['newCount'][$t] = ($in['newCount'][$t] ?? 0) + 1;
            elseif ($kind === 'REVISIT') $in['revisitCount'][$t] = ($in['revisitCount'][$t] ?? 0) + 1;
        }
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
