<?php
// 顧客向けの空き状況計算（氏名などの個人情報は一切返さない）
declare(strict_types=1);

final class PublicApi
{
    public static function parseKind(?string $v): string
    {
        return $v === 'NEW' ? 'NEW' : ($v === 'REVISIT' ? 'REVISIT' : 'RETURN');
    }

    public static function neededSlots(array $setting, string $kind): int
    {
        return $kind === 'RETURN' ? $setting['returnVisitSlots'] : $setting['newVisitSlots'];
    }

    /** 日付を顧客に公開するか */
    public static function isPublished(array $store, string $date, string $today, ?bool $published): bool
    {
        if ($published === true) return true;
        if ($published === false) return false;
        return $date >= $today && $date <= Time::addDays($today, (int)$store['publishDaysAhead']);
    }

    private static function nowMinutesFor(string $date, string $today, int $minutes): int|float|null
    {
        if ($date < $today) return INF;
        if ($date === $today) return $minutes;
        return null;
    }

    /** @param array<int, array{time:int,bed:int,text:string}>|null $cells */
    public static function buildInput(array $store, array $setting, string $date, string $kind, bool $closed = false, ?array $cells = null, ?array $capacity = null): array
    {
        $now = Time::nowJst();
        $sessions = Settings::storeSessions($store, $setting, $date, $closed);
        $cells ??= Db::all('SELECT time, bed, text FROM cell WHERE storeId = ? AND date = ? AND bed > 0', [$store['id'], $date]);
        $occupied = [];
        $blocked = [];
        foreach ($cells as $c) {
            if ((int)$c['bed'] > 0 && Availability::isOccupiedText($c['text'])) {
                $k = Availability::key((int)$c['time'], (int)$c['bed']);
                $occupied[$k] = true;
                if (Availability::isBlockMark($c['text'])) $blocked[$k] = true;
            }
        }
        $capacity ??= Settings::capacityFor($store, $date);
        return [
            'sessions' => $sessions,
            'slotMinutes' => $setting['slotMinutes'],
            'beds' => Settings::allBeds($store),
            'capacityAm' => $capacity['am'],
            'capacityPm' => $capacity['pm'],
            'occupied' => $occupied,
            'blocked' => $blocked,
            'neededSlots' => self::neededSlots($setting, $kind),
            'phoneMarkRemaining' => $setting['phoneMarkRemaining'],
            'nowMinutes' => self::nowMinutesFor($date, $now['date'], $now['minutes']),
            'webCutoffMinutes' => $setting['webCutoffMinutes'],
            'phoneCutoffMinutes' => $setting['phoneCutoffMinutes'],
        ];
    }

    /** 1 日分の枠ごとの状態 */
    public static function slotsForCustomer(array $store, array $setting, string $date, string $kind): array
    {
        $today = Time::nowJst()['date'];
        $day = Settings::dayRow(Db::one('SELECT * FROM day_status WHERE storeId = ? AND date = ?', [$store['id'], $date]));
        if (!self::isPublished($store, $date, $today, $day['published'] ?? null)) return ['published' => false, 'slots' => []];
        $in = self::buildInput($store, $setting, $date, $kind, $day['closed'] ?? false);
        $slots = [];
        foreach (Availability::compute($in) as $s) {
            $slots[] = ['time' => $s['time'], 'status' => $s['status'], 'period' => Hours::isAm($in['sessions'], $s['time']) ? 'AM' : 'PM'];
        }
        return ['published' => true, 'slots' => $slots];
    }

    /** @return array{days:array, cellsByDate:array, caps:array} */
    private static function loadRange(array $store, array $dates): array
    {
        $in = Db::inList($dates);
        $params = array_merge([$store['id']], $dates);
        $dayRows = Db::all("SELECT * FROM day_status WHERE storeId = ? AND date IN ($in)", $params);
        $days = [];
        $ov = [];
        foreach ($dayRows as $r) {
            $r = Settings::dayRow($r);
            $days[$r['date']] = $r;
            $ov[$r['date']] = ['capacityAm' => $r['capacityAm'], 'capacityPm' => $r['capacityPm']];
        }
        $cellsByDate = [];
        foreach (Db::all("SELECT date, time, bed, text FROM cell WHERE storeId = ? AND date IN ($in) AND bed > 0", $params) as $c) $cellsByDate[$c['date']][] = $c;
        return ['days' => $days, 'cellsByDate' => $cellsByDate, 'caps' => Settings::capacitiesFor($store, $dates, $ov)];
    }

    /** 月ごとの日単位マーク（open / full / closed / unpublished） */
    public static function calendarForCustomer(array $store, array $setting, string $ym, string $kind): array
    {
        $today = Time::nowJst()['date'];
        $dates = Time::datesOfMonth($ym);
        $r = self::loadRange($store, $dates);
        $out = [];
        foreach ($dates as $date) {
            $day = $r['days'][$date] ?? null;
            if (!self::isPublished($store, $date, $today, $day['published'] ?? null)) { $out[] = ['date' => $date, 'mark' => 'unpublished']; continue; }
            $in = self::buildInput($store, $setting, $date, $kind, $day['closed'] ?? false, $r['cellsByDate'][$date] ?? [], $r['caps'][$date]);
            if (count($in['sessions']) === 0) { $out[] = ['date' => $date, 'mark' => 'closed']; continue; }
            $any = false;
            foreach (Availability::compute($in) as $s) if ($s['status'] !== 'closed') { $any = true; break; }
            $out[] = ['date' => $date, 'mark' => $any ? 'open' : 'full'];
        }
        return $out;
    }

    /** 1 週間分（weekStart から 7 日）の枠状態。氏名は含まない */
    public static function weekForCustomer(array $store, array $setting, string $weekStart, string $kind): array
    {
        $today = Time::nowJst()['date'];
        $dates = [];
        for ($i = 0; $i < 7; $i++) $dates[] = Time::addDays($weekStart, $i);
        $r = self::loadRange($store, $dates);
        $out = [];
        foreach ($dates as $date) {
            $day = $r['days'][$date] ?? null;
            $sessions = Settings::storeSessions($store, $setting, $date, $day['closed'] ?? false);
            $label = null;
            if (count($sessions) === 0) $label = ($day['closed'] ?? false) ? '休診' : (($setting['closeOnHolidays'] && Holidays::isHoliday($date)) ? '祝日' : '定休日');
            elseif ($date < $today) $label = '受付終了';
            elseif (!self::isPublished($store, $date, $today, $day['published'] ?? null)) $label = '受付期間外';
            if ($label) { $out[] = ['date' => $date, 'label' => $label, 'slots' => []]; continue; }
            $in = self::buildInput($store, $setting, $date, $kind, $day['closed'] ?? false, $r['cellsByDate'][$date] ?? [], $r['caps'][$date]);
            $slots = [];
            foreach (Availability::compute($in) as $s) $slots[] = ['time' => $s['time'], 'status' => $s['status']];
            $out[] = ['date' => $date, 'label' => null, 'slots' => $slots];
        }
        return ['today' => $today, 'weekStart' => $weekStart, 'publishDaysAhead' => (int)$store['publishDaysAhead'], 'days' => $out];
    }
}
