<?php
// 顧客向けの空き状況計算（氏名などの個人情報は一切返さない）
declare(strict_types=1);

final class PublicApi
{
    /** 来院区分：NEW=はじめて（ケガ・痛み・不調）/ ACCIDENT=はじめて（交通事故）/ RETURN=現在通院中 / REVISIT=1ヶ月以上ご来院の無い方 */
    public const KINDS = ['NEW', 'ACCIDENT', 'RETURN', 'REVISIT'];

    /** 予約表の 1 枠目に書く文字 */
    public static function cellName(string $kind, string $name): string
    {
        return match ($kind) {
            'NEW' => "{$name}（初診）",
            'ACCIDENT' => "{$name}（初自）",
            'REVISIT' => "{$name}（再）",
            default => $name,
        };
    }

    /** 予約表の 2 枠目に書く文字 */
    public static function contText(string $kind): string
    {
        return $kind === 'REVISIT' ? '上記再来対応' : '上記初診対応';
    }

    public const KIND_JA = ['NEW' => '初診', 'ACCIDENT' => '初診（交通事故）', 'REVISIT' => '再来', 'RETURN' => '通院中'];

    public static function parseKind(?string $v): string
    {
        return in_array($v, self::KINDS, true) ? $v : 'RETURN';
    }

    public static function neededSlots(array $setting, string $kind): int
    {
        return $kind === 'RETURN' ? $setting['returnVisitSlots'] : $setting['newVisitSlots'];
    }

    /** 日付を顧客に公開するか */
    /**
     * 予約ページ・店舗えらびに出す臨時休業のお知らせ（今日から、予約を受け付けている期間の分）
     * @return array<int, array{date:string, part:?string, note:string}>
     */
    public static function closures(array $store, string $today): array
    {
        $rows = Db::all('SELECT * FROM day_status WHERE storeId = ? AND date >= ? AND (closed = 1 OR closedPart IS NOT NULL) ORDER BY date ASC', [$store['id'], $today]);
        $out = [];
        foreach ($rows as $r) {
            $d = Settings::dayRow($r);
            if (!self::isPublished($store, $d['date'], $today, $d['published'] ?: null)) continue;
            $part = $d['closed'] ? null : $d['closedPart'];
            if (!$d['closed'] && !$part) continue;
            $out[] = ['date' => $d['date'], 'part' => $part, 'note' => $d['closedNote']];
        }
        return $out;
    }

    /** WEB で予約できる日数（店舗設定）より先の日か */
    public static function beyondBookDays(array $store, string $date, string $today): bool
    {
        $n = $store['bookDaysAhead'] ?? null;
        return $n !== null && $date > Time::addDays($today, (int)$n);
    }

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
    /** @param array<int, array{startTime:int,endTime:int,beds:string}>|null $blocks */
    public static function buildInput(array $store, array $setting, string $date, string $kind, bool|string $closed = false, ?array $cells = null, ?array $capacity = null, ?array $blocks = null): array
    {
        $now = Time::nowJst();
        $sessions = Settings::storeSessions($store, $setting, $date, $closed);
        $cells ??= Db::all('SELECT time, bed, text FROM cell WHERE storeId = ? AND date = ? AND bed > 0', [$store['id'], $date]);
        $occupied = [];
        $blocked = [];
        $newCount = [];
        $revisitCount = [];
        foreach ($cells as $c) {
            if ((int)$c['bed'] > 0 && Availability::isOccupiedText($c['text'])) {
                $k = Availability::key((int)$c['time'], (int)$c['bed']);
                $occupied[$k] = true;
                if (Availability::isBlockMark($c['text'])) $blocked[$k] = true;
                // 新規（初診・初・初自）の人と、その 2 枠目（上記初診対応）を時間ごとに数える
                $t = trim((string)$c['text']);
                $cat = Text::categorize($t);
                if ($cat['isNew'] || $t === '上記初診対応') $newCount[(int)$c['time']] = ($newCount[(int)$c['time']] ?? 0) + 1;
                // 再来（（再）・再来・再診）の人と、その 2 枠目（上記再来対応）
                elseif ($cat['isRevisit'] || $t === '上記再来対応') $revisitCount[(int)$c['time']] = ($revisitCount[(int)$c['time']] ?? 0) + 1;
            }
        }
        $capacity ??= Settings::capacityFor($store, $date);
        // 予約表のブロック（打合せなど）：指定ベッドをその時間使えなくする。
        // 顧客に見せる枠の中のベッドなら枠も 1 つ減らし、枠の外のベッドならベッドが埋まるだけ（✖ と同じ扱い）
        $blocks ??= Db::all('SELECT startTime, endTime, beds FROM slot_block WHERE storeId = ? AND date = ?', [$store['id'], $date]);
        $allBeds = Settings::allBeds($store);
        foreach ($blocks as $bk) {
            $beds = self::blockBeds((string)($bk['beds'] ?? ''), $allBeds);
            for ($t = (int)$bk['startTime']; $t < (int)$bk['endTime']; $t += $setting['slotMinutes']) {
                $cap = Hours::isAm($sessions, $t) ? $capacity['am'] : $capacity['pm'];
                foreach ($beds as $b) {
                    $k = Availability::key($t, $b);
                    if (isset($occupied[$k]) && !isset($blocked[$k])) continue; // すでに患者が入っている
                    $occupied[$k] = true;
                    if ($b > $cap) $blocked[$k] = true; else unset($blocked[$k]);
                }
            }
        }
        // 新規・再来を止める時間帯（初診・再来の予約だけ。新自・通院中は取れる）
        $kindStop = [];
        if ($kind === 'NEW' || $kind === 'REVISIT') {
            foreach (Db::all('SELECT startTime, endTime FROM kind_block WHERE storeId = ? AND date = ?', [$store['id'], $date]) as $kb) {
                for ($t = (int)$kb['startTime']; $t < (int)$kb['endTime']; $t += $setting['slotMinutes']) $kindStop[$t] = true;
            }
        }
        return [
            'sessions' => $sessions,
            'slotMinutes' => $setting['slotMinutes'],
            'kindStop' => $kindStop,
            // WEB で予約できる日数より先の日：空いていても電話マーク（電話で受ける）
            'webFar' => self::beyondBookDays($store, $date, $now['date']),
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
            // 店舗設定の同時対応数は使わない（シフトのスタッフの人数で決める）
            'newLimit' => null,
            'newCount' => $newCount,
            'countsAsNew' => $kind === 'NEW' || $kind === 'ACCIDENT',
            // シフトの「初回を担当する」「再来を担当する」にチェックのある人数（午前・午後）。null＝上限なし
            'newCap' => ['am' => $capacity['firstAm'] ?? null, 'pm' => $capacity['firstPm'] ?? null],
            'revisitLimit' => null,
            'eitherCap' => ['am' => $capacity['eitherAm'] ?? null, 'pm' => $capacity['eitherPm'] ?? null],
            'revisitCap' => ['am' => $capacity['revisitAm'] ?? null, 'pm' => $capacity['revisitPm'] ?? null],
            'revisitCount' => $revisitCount,
            'countsAsRevisit' => $kind === 'REVISIT',
        ];
    }

    /** ブロックのベッド指定（"1,2"。空なら全ベッド） @return int[] */
    public static function blockBeds(string $beds, array $allBeds): array
    {
        if (trim($beds) === '') return $allBeds;
        return array_values(array_intersect($allBeds, array_map('intval', explode(',', $beds))));
    }

    /** 1 日分の枠ごとの状態 */
    public static function slotsForCustomer(array $store, array $setting, string $date, string $kind): array
    {
        $today = Time::nowJst()['date'];
        $day = Settings::dayRow(Db::one('SELECT * FROM day_status WHERE storeId = ? AND date = ?', [$store['id'], $date]));
        if (!self::isPublished($store, $date, $today, $day['published'] ?? null)) return ['published' => false, 'slots' => []];
        $in = self::buildInput($store, $setting, $date, $kind, Settings::closedOf($day));
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
        $blocksByDate = [];
        foreach (Db::all("SELECT date, startTime, endTime, beds FROM slot_block WHERE storeId = ? AND date IN ($in)", $params) as $b) $blocksByDate[$b['date']][] = $b;
        return ['days' => $days, 'cellsByDate' => $cellsByDate, 'blocksByDate' => $blocksByDate, 'caps' => Settings::capacitiesFor($store, $dates, $ov)];
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
            $in = self::buildInput($store, $setting, $date, $kind, Settings::closedOf($day), $r['cellsByDate'][$date] ?? [], $r['caps'][$date], $r['blocksByDate'][$date] ?? []);
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
            $sessions = Settings::storeSessions($store, $setting, $date, Settings::closedOf($day));
            $label = null;
            if (count($sessions) === 0) $label = ($day['closed'] ?? false) ? '臨時休業' : (($setting['closeOnHolidays'] && Holidays::isHoliday($date)) ? '祝日' : '定休日');
            elseif ($date < $today) $label = '受付終了';
            elseif (!self::isPublished($store, $date, $today, $day['published'] ?? null)) $label = '受付期間外';
            if ($label) { $out[] = ['date' => $date, 'label' => $label, 'slots' => []]; continue; }
            $in = self::buildInput($store, $setting, $date, $kind, Settings::closedOf($day), $r['cellsByDate'][$date] ?? [], $r['caps'][$date], $r['blocksByDate'][$date] ?? []);
            $slots = [];
            foreach (Availability::compute($in) as $s) $slots[] = ['time' => $s['time'], 'status' => $s['status']];
            $out[] = ['date' => $date, 'label' => null, 'slots' => $slots];
        }
        return ['today' => $today, 'weekStart' => $weekStart, 'publishDaysAhead' => (int)$store['publishDaysAhead'], 'days' => $out];
    }
}
