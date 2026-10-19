<?php
// 予約表 1 日分のデータ読込（管理画面・印刷・全店状況で共用）
declare(strict_types=1);

final class DayData
{
    public static function load(array $store, array $setting, string $date): array
    {
        $sid = $store['id'];
        $day = Settings::dayRow(Db::one('SELECT * FROM day_status WHERE storeId = ? AND date = ?', [$sid, $date]));
        $allMembers = Db::all('SELECT id, name, role, startDate, endDate, canFirst, canRevisit, color FROM staff_member WHERE storeId = ? AND active = 1 ORDER BY sortOrder ASC', [$sid]);
        $members = array_values(array_filter($allMembers, fn($m) => Settings::inPeriod($m, $date))); // 入社前・異動後の人は出さない
        $helpIn = Db::one('SELECT status, name FROM help_in WHERE storeId = ? AND date = ?', [$sid, $date]);
        $shifts = Db::all('SELECT staffId, status FROM shift WHERE storeId = ? AND date = ?', [$sid, $date]);
        $cells = Db::all('SELECT c.time, c.bed, c.text, c.visited, c.menus, c.staff, r.id AS rId, r.kind AS rKind, r.phone AS rPhone, r.cardNo AS rCardNo
            FROM cell c LEFT JOIN reservation r ON r.id = c.reservationId WHERE c.storeId = ? AND c.date = ? AND c.bed > 0', [$sid, $date]);
        $blocks = Db::all('SELECT id, startTime, endTime, beds, label FROM slot_block WHERE storeId = ? AND date = ? ORDER BY startTime ASC', [$sid, $date]);
        $cancels = Db::all('SELECT * FROM cancel_log WHERE storeId = ? AND date = ? ORDER BY time ASC, createdAt ASC', [$sid, $date]);

        $closed = $day['closed'] ?? false;
        $sessions = Settings::storeSessions($store, $setting, $date, $closed);
        $statusByStaff = [];
        foreach ($shifts as $s) $statusByStaff[$s['staffId']] = $s['status'];
        $reception = array_values(array_filter($members, fn($m) => $m['role'] === 'RECEPTION'));
        $allTherapists = array_values(array_filter($allMembers, fn($m) => $m['role'] === 'THERAPIST'));
        $cap = Settings::capacityFromShifts($store, $allTherapists, $statusByStaff, $day ? ['capacityAm' => $day['capacityAm'], 'capacityPm' => $day['capacityPm']] : null, $date, $helpIn);
        // 担当に選べる施術者：その日に出勤している人を先に、ほかの在籍の施術者を後ろに
        $working = array_values(array_unique(array_merge($cap['namesAm'], $cap['namesPm'])));
        $others = array_values(array_filter(array_map(fn($m) => $m['name'], array_filter($members, fn($m) => $m['role'] === 'THERAPIST')), fn($n) => !in_array($n, $working, true)));
        // 回数（2回目など）のセルで担当が空のもの：初回の担当が同姓同名で決められないときは「担当を確認」を出す
        $staffCheck = [];
        foreach ($cells as $c) {
            if ((string)($c['staff'] ?? '') !== '' || !Karte::hasCountMenu(self::menusOf((string)($c['menus'] ?? '')))) continue;
            if (Karte::firstVisitOf($store, (string)$c['text'], $date)['ambiguous']) $staffCheck[(int)$c['time'] . ':' . (int)$c['bed']] = true;
        }

        return [
            'date' => $date,
            // 特別な営業日（プレオープン・イベントなど）なら { sessions, memo }
            'special' => Settings::specialDay((string)$store['id'], $date),
            'day' => ['published' => $day['published'] ?? null, 'closed' => $closed, 'memo' => $day['memo'] ?? '', 'capacityAm' => $day['capacityAm'] ?? null, 'capacityPm' => $day['capacityPm'] ?? null],
            'sessions' => $sessions,
            'times' => Hours::slotTimes($sessions, $setting['slotMinutes'], true),
            'customerTimes' => Hours::slotTimes($sessions, $setting['slotMinutes']),
            'slotMinutes' => $setting['slotMinutes'],
            'beds' => Settings::allBeds($store),
            'capacity' => $cap,
            'hasStaff' => count($allTherapists) > 0,
            'receptionNames' => array_map(fn($m) => $m['name'], $reception),
            'shiftLabels' => array_map(fn($m) => ['name' => $m['name'], 'role' => $m['role'], 'status' => $statusByStaff[$m['id']] ?? 'WORK'], $members),
            'staffOptions' => array_merge($working, $others),
            // 予約表の色を持つ施術者（初回・再来を担当する人。並び順のとおり。color が空なら画面で自動の色）
            'colorStaff' => array_values(array_map(fn($m) => ['name' => $m['name'], 'color' => (string)$m['color']], array_filter($allTherapists, fn($m) => (int)$m['canFirst'] || (int)$m['canRevisit']))),
            'cells' => array_map(fn($c) => [
                'time' => (int)$c['time'], 'bed' => (int)$c['bed'], 'text' => $c['text'], 'visited' => (bool)$c['visited'], 'menus' => self::menusOf((string)($c['menus'] ?? '')),
                'staff' => (string)($c['staff'] ?? ''), 'staffCheck' => isset($staffCheck[(int)$c['time'] . ':' . (int)$c['bed']]),
                'web' => $c['rId'] ? ['id' => $c['rId'], 'kind' => $c['rKind'], 'phone' => $c['rPhone'], 'cardNo' => $c['rCardNo']] : null,
            ], $cells),
            // メニューと物販はセルには同じように付く（色・印・人数はまとめて扱う）。予約表の帯では物販を別の段に出す
            'menuOptions' => array_values(array_unique(array_merge(Karte::options()['menu'] ?? [], Karte::options()['goods'] ?? []))),
            'goodsOptions' => Karte::options()['goods'] ?? [],
            'blocks' => array_map(fn($b) => ['id' => $b['id'], 'start' => (int)$b['startTime'], 'end' => (int)$b['endTime'], 'beds' => PublicApi::blockBeds((string)$b['beds'], Settings::allBeds($store)), 'label' => $b['label']], $blocks),
            'cancels' => array_map(fn($c) => [
                'id' => $c['id'], 'time' => (int)$c['time'], 'bed' => (int)$c['bed'], 'name' => $c['name'], 'contText' => $c['contText'], 'kind' => $c['kind'],
                'source' => $c['source'], 'byCode' => $c['byCode'], 'memo' => $c['memo'], 'nextDate' => $c['nextDate'], 'nextTime' => isset($c['nextTime']) ? (int)$c['nextTime'] : null, 'createdAt' => Time::formatDateTimeShort($c['createdAt']),
            ], $cancels),
        ];
    }

    /** セルのメニュー（JSON の配列）→ 文字の配列 */
    public static function menusOf(string $json): array
    {
        $a = $json === '' ? [] : json_decode($json, true);
        return is_array($a) ? array_values(array_filter($a, 'is_string')) : [];
    }
}
