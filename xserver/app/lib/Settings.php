<?php
// 全店共通設定・店舗・シフトからの枠数計算
declare(strict_types=1);

final class Settings
{
    private static ?array $global = null;

    /** DB の行を型のそろった配列にする（MySQL は真偽値が 0/1 で返るため） */
    public static function storeRow(array $r): array
    {
        foreach (['beds', 'defaultActiveBeds', 'maxTherapists', 'maxReception', 'publishDaysAhead'] as $k) $r[$k] = (int)$r[$k];
        // 新規の同時対応数：null＝制限なし、0＝WEB では受けない
        $r['maxNewConcurrent'] = ($r['maxNewConcurrent'] ?? null) === null ? null : (int)$r['maxNewConcurrent'];
        $r['maxRevisitConcurrent'] = ($r['maxRevisitConcurrent'] ?? null) === null ? null : (int)$r['maxRevisitConcurrent'];
        $r['active'] = (bool)$r['active'];
        $r['hoursOverride'] = is_string($r['hoursOverride'] ?? null) ? json_decode($r['hoursOverride'], true) : null;
        return $r;
    }

    public static function settingRow(array $r): array
    {
        foreach (['slotMinutes', 'newVisitSlots', 'returnVisitSlots', 'webCutoffMinutes', 'phoneCutoffMinutes', 'phoneMarkRemaining', 'adminExtraSlots', 'retentionDays'] as $k) $r[$k] = (int)$r[$k];
        $r['closeOnHolidays'] = (bool)$r['closeOnHolidays'];
        $r['storesPageOpen'] = (bool)($r['storesPageOpen'] ?? false);
        $r['hours'] = is_string($r['hours']) ? json_decode($r['hours'], true) : $r['hours'];
        return $r;
    }

    /** 全店共通設定（無ければ既定値で作成）。1 リクエスト内は 1 回だけ読む */
    public static function global(): array
    {
        if (self::$global) return self::$global;
        $r = Db::one('SELECT * FROM global_setting WHERE id = 1');
        if (!$r) {
            Db::exec('INSERT INTO global_setting (id, hours) VALUES (1, ?)', [json_encode(Hours::defaultHours(), JSON_UNESCAPED_UNICODE)]);
            $r = Db::one('SELECT * FROM global_setting WHERE id = 1');
        }
        return self::$global = self::settingRow($r);
    }

    public static function findStoreByCode(string $code): ?array
    {
        $r = Db::one('SELECT * FROM store WHERE code = ?', [$code]);
        return $r ? self::storeRow($r) : null;
    }

    public static function findStoreById(string $id): ?array
    {
        $r = Db::one('SELECT * FROM store WHERE id = ?', [$id]);
        return $r ? self::storeRow($r) : null;
    }

    /** 店舗に適用する営業時間設定（個別設定があればそちら） */
    /**
     * その日に使う営業時間の設定。店舗の個別設定に、その日を含む期間があればそれを使い、
     * 無ければ全店共通の営業時間を使う（例：個別設定は「〜10/20」だけ → 10/21 からは全店共通）
     */
    public static function hoursForStore(array $store, array $setting, ?string $date = null): array
    {
        $global = Hours::parseHoursConfig($setting['hours'] ?? null) ?? Hours::defaultHours();
        $ov = $store['hoursOverride'] ?? null;
        if (is_string($ov)) $ov = json_decode($ov, true); // 管理画面ではデータベースの文字列のまま渡ってくる
        $own = Hours::parseHoursConfig($ov);
        if (!$own) return $global;
        if ($date === null) return $own;
        return Hours::periodForDate($own, $date) ? $own : $global;
    }

    public static function storeSessions(array $store, array $setting, string $date, bool $closed = false): array
    {
        // 特別な営業日（プレオープン・イベントなど）：その日だけ決めた時間で営業（定休日・祝日でも）。臨時休診にした日は休み
        if (!$closed && isset($store['id']) && ($sp = self::specialDay((string)$store['id'], $date))) {
            $extra = (int)$setting['adminExtraSlots'] * (int)$setting['slotMinutes'];
            $out = [];
            foreach ($sp['sessions'] as [$a, $b]) $out[] = ['start' => Time::hmToMin($a), 'lastStart' => Time::hmToMin($b), 'lastAdmin' => Time::hmToMin($b) + $extra];
            usort($out, fn($x, $y) => $x['start'] <=> $y['start']);
            return $out;
        }
        return Hours::sessionsForDate(self::hoursForStore($store, $setting, $date), $date, $setting['closeOnHolidays'], $closed, $setting['adminExtraSlots'], $setting['slotMinutes']);
    }

    /** @var array<string, array<string, array>> 店舗 ID → 日付 → 特別な営業日 */
    private static array $specialCache = [];

    /** その店舗のその日が特別な営業日なら { date, sessions: [["10:00","12:30"], ...], memo }、違えば null */
    public static function specialDay(string $storeId, string $date): ?array
    {
        if (!isset(self::$specialCache[$storeId])) {
            $m = [];
            foreach (Db::all('SELECT date, sessions, memo FROM special_day WHERE storeId = ?', [$storeId]) as $r) {
                $ss = json_decode((string)$r['sessions'], true);
                $m[$r['date']] = ['date' => $r['date'], 'sessions' => is_array($ss) ? $ss : [], 'memo' => (string)$r['memo']];
            }
            self::$specialCache[$storeId] = $m;
        }
        return self::$specialCache[$storeId][$date] ?? null;
    }

    public static function clearSpecialCache(): void
    {
        self::$specialCache = [];
    }

    /** 特別な営業日の時間（[["10:00","12:30"],["13:30","16:00"]]）を確かめて整える。おかしければ null */
    public static function parseSpecialSessions(mixed $v): ?array
    {
        if (!is_array($v) || count($v) < 1 || count($v) > 3) return null;
        $out = [];
        foreach ($v as $s) {
            if (!is_array($s) || count($s) !== 2) return null;
            [$a, $b] = array_values($s);
            if (!is_string($a) || !is_string($b) || !preg_match('/^\d{1,2}:\d{2}$/', $a) || !preg_match('/^\d{1,2}:\d{2}$/', $b)) return null;
            $am = Time::hmToMin($a); $bm = Time::hmToMin($b);
            if ($am > $bm || $bm >= 24 * 60) return null;
            $out[] = [sprintf('%d:%02d', intdiv($am, 60), $am % 60), sprintf('%d:%02d', intdiv($bm, 60), $bm % 60)];
        }
        usort($out, fn($x, $y) => Time::hmToMin($x[0]) <=> Time::hmToMin($y[0]));
        for ($i = 1; $i < count($out); $i++) if (Time::hmToMin($out[$i][0]) <= Time::hmToMin($out[$i - 1][1])) return null;
        return $out;
    }

    /**
     * 店舗を並び順で返す：本部専用 → エリア（エリアの設定の順。未設定は最後）→ エリアの中の並び順 → 店舗コード。
     * 各行に area（エリア名。未設定は ''）を付ける。自賠請求だけに使う店舗は最後（$withJibaiOnly=false なら除く）
     */
    public static function storesInOrder(string $where = '1 = 1', array $params = [], bool $withJibaiOnly = true): array
    {
        if (!$withJibaiOnly) $where = "($where) AND jibaiOnly = 0";
        $areaOf = [];
        $areaIdx = [];
        foreach (Db::all('SELECT name, storeCodes FROM area ORDER BY sortOrder ASC, name ASC') as $i => $a) {
            $areaIdx[$a['name']] = $i;
            foreach (array_filter(explode(',', (string)$a['storeCodes'])) as $c) $areaOf[$c] ??= $a['name'];
        }
        $rows = Db::all("SELECT * FROM store WHERE $where", $params);
        foreach ($rows as &$r) $r['area'] = $areaOf[$r['code']] ?? '';
        unset($r);
        $key = fn($r) => [(int)($r['jibaiOnly'] ?? 0), (int)($r['hqOnly'] ?? 0) ? 0 : 1, $r['area'] === '' ? PHP_INT_MAX : $areaIdx[$r['area']], (int)($r['sortOrder'] ?? 0), (string)$r['code']];
        usort($rows, fn($a, $b) => $key($a) <=> $key($b));
        return $rows;
    }

    public static function allBeds(array $store): array
    {
        return range(1, max(1, (int)$store['beds']));
    }

    public const SHIFT_STATUSES = ['WORK', 'OFF', 'AM_OFF', 'PM_OFF', 'PAID', 'AM_PAID', 'PM_PAID', 'HELP', 'AM_HELP', 'PM_HELP']; // HELP＝他店へ応援（この店舗の枠に数えない）

    /** 他店からの応援（help_in.status） */
    public const HELP_IN_STATUSES = ['HELP_IN', 'AM_HELP_IN', 'PM_HELP_IN'];

    /** その日にこの店舗に所属しているか（所属開始日・終了日。空なら制限なし） */
    public static function inPeriod(array $m, string $date): bool
    {
        $s = $m['startDate'] ?? null;
        $e = $m['endDate'] ?? null;
        return (!$s || $date >= $s) && (!$e || $date <= $e);
    }

    public static function worksAm(?string $status): bool
    {
        return !$status || $status === 'WORK' || $status === 'PM_OFF' || $status === 'PM_PAID' || $status === 'PM_HELP';
    }

    public static function worksPm(?string $status): bool
    {
        return !$status || $status === 'WORK' || $status === 'AM_OFF' || $status === 'AM_PAID' || $status === 'AM_HELP';
    }

    /**
     * シフトから午前/午後の施術者数を求める。
     * @param array<int, array{id:string,name:string}> $members 稼働中の施術者
     * @param array<string,string> $statusByStaff その日のシフト（無い人は〇）
     * @param array{capacityAm:?int,capacityPm:?int}|null $override 手動上書き
     * @param string|null $date 指定すると、その日に所属していない人（入社前・異動後）を数えない
     * @param array{status:string,name:string}|null $helpIn その日の他店からの応援（枠を 1 増やす）
     */
    public static function capacityFromShifts(array $store, array $members, array $statusByStaff, ?array $override = null, ?string $date = null, ?array $helpIn = null): array
    {
        $registered = count($members); // 登録が 1 人もいなければ既定の枠数を使う（期間外で 0 人の日は 0 枠）
        // 店舗設定の「初回を担当する」「再来を担当する」に 1 人でもチェックがあれば、その日のシフトに入っているチェックのある人数を
        // WEB の新規・再来の同時上限にする（チェックが 1 人も無い店舗は今までどおり上限なし）
        $useFirst = (bool)array_filter($members, fn($m) => (int)($m['canFirst'] ?? 0) === 1);
        $useRevisit = (bool)array_filter($members, fn($m) => (int)($m['canRevisit'] ?? 0) === 1);
        $firstAm = $firstPm = $revisitAm = $revisitPm = 0;
        if ($date !== null) $members = array_values(array_filter($members, fn($m) => self::inPeriod($m, $date)));
        $beds = (int)$store['beds'];
        $namesAm = [];
        $namesPm = [];
        if ($registered === 0) {
            $autoAm = $autoPm = min((int)$store['defaultActiveBeds'], $beds);
        } else {
            foreach ($members as $m) {
                $st = $statusByStaff[$m['id']] ?? null;
                if (self::worksAm($st)) { $namesAm[] = $m['name']; $firstAm += (int)($m['canFirst'] ?? 0); $revisitAm += (int)($m['canRevisit'] ?? 0); }
                if (self::worksPm($st)) { $namesPm[] = $m['name']; $firstPm += (int)($m['canFirst'] ?? 0); $revisitPm += (int)($m['canRevisit'] ?? 0); }
            }
            $autoAm = min(count($namesAm), $beds);
            $autoPm = min(count($namesPm), $beds);
        }
        if ($helpIn) {
            $label = 'ヘルプ' . ($helpIn['name'] !== '' ? '（' . $helpIn['name'] . '）' : '（他店から）');
            // ヘルプの人は合計の人数には入れるが、担当できるかは人によるので新規・再来の人数には数えない
            if ($helpIn['status'] !== 'PM_HELP_IN') { $namesAm[] = $label; $autoAm = min($autoAm + 1, $beds); }
            if ($helpIn['status'] !== 'AM_HELP_IN') { $namesPm[] = $label; $autoPm = min($autoPm + 1, $beds); }
        }
        $am = $override['capacityAm'] ?? $autoAm;
        $pm = $override['capacityPm'] ?? $autoPm;
        return [
            'am' => min((int)$am, $beds), 'pm' => min((int)$pm, $beds), 'autoAm' => $autoAm, 'autoPm' => $autoPm, 'namesAm' => $namesAm, 'namesPm' => $namesPm,
            // シフトから決まる WEB の新規・再来の同時上限（null＝チェックを使っていないので上限なし）
            'firstAm' => $useFirst ? $firstAm : null, 'firstPm' => $useFirst ? $firstPm : null,
            'revisitAm' => $useRevisit ? $revisitAm : null, 'revisitPm' => $useRevisit ? $revisitPm : null,
        ];
    }

    /**
     * 複数日分の枠数をまとめて計算。
     * @param array<string, array{capacityAm:?int,capacityPm:?int}> $overrides 日付 → 手動上書き
     * @return array<string, array> 日付 → 枠数
     */
    public static function capacitiesFor(array $store, array $dates, array $overrides): array
    {
        $members = Db::all('SELECT id, name, startDate, endDate, canFirst, canRevisit FROM staff_member WHERE storeId = ? AND role = ? AND active = 1 ORDER BY sortOrder ASC', [$store['id'], 'THERAPIST']);
        $byDate = [];
        $help = [];
        if ($dates) {
            $params = array_merge([$store['id']], $dates);
            if ($members) {
                $rows = Db::all('SELECT staffId, date, status FROM shift WHERE storeId = ? AND date IN (' . Db::inList($dates) . ')', $params);
                foreach ($rows as $r) $byDate[$r['date']][$r['staffId']] = $r['status'];
            }
            foreach (Db::all('SELECT date, status, name FROM help_in WHERE storeId = ? AND date IN (' . Db::inList($dates) . ')', $params) as $r) $help[$r['date']] = $r;
        }
        $out = [];
        foreach ($dates as $d) $out[$d] = self::capacityFromShifts($store, $members, $byDate[$d] ?? [], $overrides[$d] ?? null, $d, $help[$d] ?? null);
        return $out;
    }

    public static function capacityFor(array $store, string $date): array
    {
        $day = Db::one('SELECT capacityAm, capacityPm FROM day_status WHERE storeId = ? AND date = ?', [$store['id'], $date]);
        $ov = $day ? [$date => ['capacityAm' => $day['capacityAm'] === null ? null : (int)$day['capacityAm'], 'capacityPm' => $day['capacityPm'] === null ? null : (int)$day['capacityPm']]] : [];
        return self::capacitiesFor($store, [$date], $ov)[$date];
    }

    /** day_status の行を型をそろえて返す */
    public static function dayRow(?array $r): ?array
    {
        if (!$r) return null;
        $r['published'] = $r['published'] === null ? null : (bool)$r['published'];
        $r['closed'] = (bool)$r['closed'];
        $r['capacityAm'] = $r['capacityAm'] === null ? null : (int)$r['capacityAm'];
        $r['capacityPm'] = $r['capacityPm'] === null ? null : (int)$r['capacityPm'];
        return $r;
    }
}
