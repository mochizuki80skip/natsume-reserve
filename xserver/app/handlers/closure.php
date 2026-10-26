<?php
// 臨時休業をまとめて入れる（本部＝全店、管轄MG＝管轄エリアの店舗）と、店舗への通知
declare(strict_types=1);

/** まとめて入れられる店舗（本部＝全店、管轄MG＝管轄エリア。自賠だけの店舗は除く） */
function closure_stores(): array
{
    $s = Auth::requireSession();
    if (!in_array($s['role'], ['hq', 'mg'], true)) throw new HttpError(403, 'forbidden');
    $list = $s['role'] === 'hq' ? Settings::storesInOrder('active = 1') : array_values(array_filter(Auth::mgStores(), fn($r) => (int)$r['active'] === 1));
    return array_values(array_filter(array_map([Settings::class, 'storeRow'], $list), fn($st) => !($st['jibaiOnly'] ?? false)));
}

/** 臨時休業の時間に入っている予約の件数（2 枠目などの続きは数えない） */
function closure_booked(array $d, bool|string $closed): int
{
    $n = 0;
    foreach ($d['cells'] as $c) {
        if (!Availability::isPatientText($c['text']) || Text::isContinuationText($c['text'])) continue;
        if (is_string($closed) && Hours::isAm($d['sessions'], $c['time']) !== ($closed === 'AM')) continue;
        $n++;
    }
    return $n;
}

/** その日の各店舗の臨時休業と、休みの時間に入っている予約の件数 */
function closure_get(): never
{
    $date = Http::query('date');
    if (!$date || !Time::isValidDate($date)) $date = Time::nowJst()['date'];
    $setting = Settings::global();
    $rows = [];
    $areaOf = [];
    foreach (Db::all('SELECT name, storeCodes FROM area ORDER BY sortOrder ASC, name ASC') as $a) foreach (array_filter(explode(',', (string)$a['storeCodes'])) as $code) $areaOf[$code] ??= $a['name'];
    foreach (closure_stores() as $st) {
        $day = Settings::dayRow(Db::one('SELECT * FROM day_status WHERE storeId = ? AND date = ?', [$st['id'], $date]));
        $closed = Settings::closedOf($day);
        $d = $closed ? DayData::load($st, $setting, $date) : null;
        $rows[] = [
            'code' => $st['code'], 'name' => $st['name'], 'area' => $areaOf[$st['code']] ?? '',
            'part' => $closed === true ? 'ALL' : ($closed ?: null), 'note' => $day['closedNote'] ?? '', 'by' => $day['closedBy'] ?? null,
            'booked' => $d ? closure_booked($d, $closed) : 0,
        ];
    }
    Http::json(['date' => $date, 'today' => Time::nowJst()['date'], 'stores' => $rows]);
}

/** まとめて入れる・取り消す：{ date, codes: [...], part: 'ALL'|'AM'|'PM'|null, note } */
function closure_put(): never
{
    Http::requireJson();
    $b = Http::body();
    $date = Http::date($b, 'date');
    $part = $b['part'] ?? null;
    if (!in_array($part, [null, 'ALL', 'AM', 'PM'], true) || !is_array($b['codes'] ?? null)) Http::error('bad request', 400);
    $note = mb_substr(trim((string)($b['note'] ?? '')), 0, 100);
    $allowed = [];
    foreach (closure_stores() as $st) $allowed[$st['code']] = $st;
    $s = Auth::session();
    $by = $s['role'] === 'hq' ? '本部' : 'MG（' . (string)(Auth::account()['area'] ?? '') . '）';
    $n = 0;
    foreach (array_unique(array_map('strval', $b['codes'])) as $code) {
        if (!isset($allowed[$code])) Http::error("この店舗は変えられません：$code", 403);
        $sid = $allowed[$code]['id'];
        if (!Db::one('SELECT id FROM day_status WHERE storeId = ? AND date = ?', [$sid, $date])) Db::exec('INSERT INTO day_status (id, storeId, date) VALUES (?, ?, ?)', [Db::newId(), $sid, $date]);
        if ($part === null) {
            // 取り消し：店舗にも「取り消した」ことを知らせる
            Db::exec('UPDATE day_status SET closed = 0, closedPart = NULL, closedNote = NULL, closedBy = ?, closedAck = 0 WHERE storeId = ? AND date = ?', [$by, $sid, $date]);
        } else {
            Db::exec('UPDATE day_status SET closed = ?, closedPart = ?, closedNote = ?, closedBy = ?, closedAck = 0 WHERE storeId = ? AND date = ?',
                [$part === 'ALL' ? 1 : 0, $part === 'ALL' ? null : $part, $note, $by, $sid, $date]);
        }
        $n++;
    }
    Http::json(['ok' => true, 'count' => $n]);
}

/** 店舗の画面に出す通知：本部・管轄MG が入れた（取り消した）臨時休業で、まだ「確認しました」を押していないもの */
function closure_notices(): never
{
    $ctx = Auth::context();
    $store = $ctx['store'];
    $today = Time::nowJst()['date'];
    $setting = Settings::global();
    $out = [];
    foreach (Db::all('SELECT * FROM day_status WHERE storeId = ? AND date >= ? AND closedAck = 0 AND closedBy IS NOT NULL ORDER BY date ASC', [$store['id'], $today]) as $r) {
        $day = Settings::dayRow($r);
        $closed = Settings::closedOf($day);
        $out[] = ['date' => $day['date'], 'part' => $closed === true ? 'ALL' : ($closed ?: null), 'note' => $day['closedNote'], 'by' => $r['closedBy'],
            'booked' => $closed ? closure_booked(DayData::load($store, $setting, $day['date']), $closed) : 0];
    }
    Http::json(['notices' => $out]);
}

/** 店舗が「確認しました」を押す */
function closure_ack(): never
{
    $ctx = Auth::context();
    Http::requireJson();
    $date = Http::date(Http::body(), 'date');
    Db::exec('UPDATE day_status SET closedAck = 1 WHERE storeId = ? AND date = ?', [$ctx['store']['id'], $date]);
    Http::json(['ok' => true]);
}
