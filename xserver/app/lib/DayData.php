<?php
// 予約表 1 日分のデータ読込（管理画面・印刷・全店状況で共用）
declare(strict_types=1);

final class DayData
{
    public static function load(array $store, array $setting, string $date): array
    {
        $sid = $store['id'];
        $day = Settings::dayRow(Db::one('SELECT * FROM day_status WHERE storeId = ? AND date = ?', [$sid, $date]));
        $members = Db::all('SELECT id, name, role FROM staff_member WHERE storeId = ? AND active = 1 ORDER BY sortOrder ASC', [$sid]);
        $shifts = Db::all('SELECT staffId, status FROM shift WHERE storeId = ? AND date = ?', [$sid, $date]);
        $cells = Db::all('SELECT c.time, c.bed, c.text, c.visited, r.id AS rId, r.kind AS rKind, r.phone AS rPhone, r.cardNo AS rCardNo
            FROM cell c LEFT JOIN reservation r ON r.id = c.reservationId WHERE c.storeId = ? AND c.date = ? AND c.bed > 0', [$sid, $date]);
        $cancels = Db::all('SELECT * FROM cancel_log WHERE storeId = ? AND date = ? ORDER BY time ASC, createdAt ASC', [$sid, $date]);

        $closed = $day['closed'] ?? false;
        $sessions = Settings::storeSessions($store, $setting, $date, $closed);
        $statusByStaff = [];
        foreach ($shifts as $s) $statusByStaff[$s['staffId']] = $s['status'];
        $therapists = array_values(array_filter($members, fn($m) => $m['role'] === 'THERAPIST'));
        $reception = array_values(array_filter($members, fn($m) => $m['role'] === 'RECEPTION'));
        $cap = Settings::capacityFromShifts($store, $therapists, $statusByStaff, $day ? ['capacityAm' => $day['capacityAm'], 'capacityPm' => $day['capacityPm']] : null);

        return [
            'date' => $date,
            'day' => ['published' => $day['published'] ?? null, 'closed' => $closed, 'memo' => $day['memo'] ?? '', 'capacityAm' => $day['capacityAm'] ?? null, 'capacityPm' => $day['capacityPm'] ?? null],
            'sessions' => $sessions,
            'times' => Hours::slotTimes($sessions, $setting['slotMinutes'], true),
            'customerTimes' => Hours::slotTimes($sessions, $setting['slotMinutes']),
            'slotMinutes' => $setting['slotMinutes'],
            'beds' => Settings::allBeds($store),
            'capacity' => $cap,
            'hasStaff' => count($therapists) > 0,
            'receptionNames' => array_map(fn($m) => $m['name'], $reception),
            'shiftLabels' => array_map(fn($m) => ['name' => $m['name'], 'role' => $m['role'], 'status' => $statusByStaff[$m['id']] ?? 'WORK'], $members),
            'cells' => array_map(fn($c) => [
                'time' => (int)$c['time'], 'bed' => (int)$c['bed'], 'text' => $c['text'], 'visited' => (bool)$c['visited'],
                'web' => $c['rId'] ? ['id' => $c['rId'], 'kind' => $c['rKind'], 'phone' => $c['rPhone'], 'cardNo' => $c['rCardNo']] : null,
            ], $cells),
            'cancels' => array_map(fn($c) => [
                'id' => $c['id'], 'time' => (int)$c['time'], 'bed' => (int)$c['bed'], 'name' => $c['name'], 'contText' => $c['contText'], 'kind' => $c['kind'],
                'source' => $c['source'], 'byCode' => $c['byCode'], 'memo' => $c['memo'], 'nextDate' => $c['nextDate'], 'createdAt' => Time::formatDateTimeShort($c['createdAt']),
            ], $cancels),
        ];
    }
}
