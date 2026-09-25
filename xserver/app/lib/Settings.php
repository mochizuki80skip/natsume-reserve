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
        $r['active'] = (bool)$r['active'];
        $r['hoursOverride'] = is_string($r['hoursOverride'] ?? null) ? json_decode($r['hoursOverride'], true) : null;
        return $r;
    }

    public static function settingRow(array $r): array
    {
        foreach (['slotMinutes', 'newVisitSlots', 'returnVisitSlots', 'webCutoffMinutes', 'phoneCutoffMinutes', 'phoneMarkRemaining', 'adminExtraSlots', 'retentionDays'] as $k) $r[$k] = (int)$r[$k];
        $r['closeOnHolidays'] = (bool)$r['closeOnHolidays'];
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
    public static function hoursForStore(array $store, array $setting): array
    {
        return Hours::parseHoursConfig($store['hoursOverride'] ?? null)
            ?? Hours::parseHoursConfig($setting['hours'] ?? null)
            ?? Hours::defaultHours();
    }

    public static function storeSessions(array $store, array $setting, string $date, bool $closed = false): array
    {
        return Hours::sessionsForDate(self::hoursForStore($store, $setting), $date, $setting['closeOnHolidays'], $closed, $setting['adminExtraSlots'], $setting['slotMinutes']);
    }

    public static function allBeds(array $store): array
    {
        return range(1, max(1, (int)$store['beds']));
    }

    public const SHIFT_STATUSES = ['WORK', 'OFF', 'AM_OFF', 'PM_OFF', 'PAID', 'AM_PAID', 'PM_PAID'];

    public static function worksAm(?string $status): bool
    {
        return !$status || $status === 'WORK' || $status === 'PM_OFF' || $status === 'PM_PAID';
    }

    public static function worksPm(?string $status): bool
    {
        return !$status || $status === 'WORK' || $status === 'AM_OFF' || $status === 'AM_PAID';
    }

    /**
     * シフトから午前/午後の施術者数を求める。
     * @param array<int, array{id:string,name:string}> $members 稼働中の施術者
     * @param array<string,string> $statusByStaff その日のシフト（無い人は〇）
     * @param array{capacityAm:?int,capacityPm:?int}|null $override 手動上書き
     */
    public static function capacityFromShifts(array $store, array $members, array $statusByStaff, ?array $override = null): array
    {
        $beds = (int)$store['beds'];
        $namesAm = [];
        $namesPm = [];
        if (count($members) === 0) {
            $autoAm = $autoPm = min((int)$store['defaultActiveBeds'], $beds);
        } else {
            foreach ($members as $m) {
                $st = $statusByStaff[$m['id']] ?? null;
                if (self::worksAm($st)) $namesAm[] = $m['name'];
                if (self::worksPm($st)) $namesPm[] = $m['name'];
            }
            $autoAm = min(count($namesAm), $beds);
            $autoPm = min(count($namesPm), $beds);
        }
        $am = $override['capacityAm'] ?? $autoAm;
        $pm = $override['capacityPm'] ?? $autoPm;
        return ['am' => min((int)$am, $beds), 'pm' => min((int)$pm, $beds), 'autoAm' => $autoAm, 'autoPm' => $autoPm, 'namesAm' => $namesAm, 'namesPm' => $namesPm];
    }

    /**
     * 複数日分の枠数をまとめて計算。
     * @param array<string, array{capacityAm:?int,capacityPm:?int}> $overrides 日付 → 手動上書き
     * @return array<string, array> 日付 → 枠数
     */
    public static function capacitiesFor(array $store, array $dates, array $overrides): array
    {
        $members = Db::all('SELECT id, name FROM staff_member WHERE storeId = ? AND role = ? AND active = 1 ORDER BY sortOrder ASC', [$store['id'], 'THERAPIST']);
        $byDate = [];
        if ($members && $dates) {
            $rows = Db::all('SELECT staffId, date, status FROM shift WHERE storeId = ? AND date IN (' . Db::inList($dates) . ')', array_merge([$store['id']], $dates));
            foreach ($rows as $r) $byDate[$r['date']][$r['staffId']] = $r['status'];
        }
        $out = [];
        foreach ($dates as $d) $out[$d] = self::capacityFromShifts($store, $members, $byDate[$d] ?? [], $overrides[$d] ?? null);
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
