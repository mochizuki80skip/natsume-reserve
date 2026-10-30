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

// ---------- 特別な営業日（年末年始の時短など）を、選んだ店舗にまとめて入れる（本部＝全店、管轄MG＝管轄エリア） ----------

/** その日の時間の外に入っている予約（2 枠目などの続きは数えない） */
function special_outside(array $store, array $setting, string $date): int
{
    $sessions = Settings::storeSessions($store, $setting, $date);
    $n = 0;
    foreach (Db::all('SELECT time, text FROM cell WHERE storeId = ? AND date = ? AND bed > 0', [$store['id'], $date]) as $c) {
        if (!Availability::isPatientText($c['text']) || Text::isContinuationText($c['text'])) continue;
        $in = false;
        foreach ($sessions as $ss) if ((int)$c['time'] >= $ss['start'] && (int)$c['time'] <= $ss['lastAdmin']) { $in = true; break; }
        if (!$in) $n++;
    }
    return $n;
}

/** 今日から先の特別な営業日（同じ日・時間・メモをまとめて、どの店舗に入っているか） */
function hq_special_bulk_get(): never
{
    $stores = closure_stores();
    $byId = [];
    foreach ($stores as $st) $byId[$st['id']] = $st;
    $groups = [];
    if ($byId) {
        foreach (Db::all('SELECT storeId, date, sessions, memo FROM special_day WHERE date >= ? AND storeId IN (' . implode(',', array_fill(0, count($byId), '?')) . ') ORDER BY date ASC', array_merge([Time::nowJst()['date']], array_keys($byId))) as $r) {
            $k = $r['date'] . '|' . $r['sessions'] . '|' . $r['memo'];
            $groups[$k] ??= ['date' => $r['date'], 'sessions' => json_decode((string)$r['sessions'], true) ?: [], 'memo' => (string)$r['memo'], 'stores' => []];
            $groups[$k]['stores'][] = $byId[$r['storeId']]['code'];
        }
    }
    Http::json(['stores' => array_map(fn($st) => ['code' => $st['code'], 'name' => $st['name'], 'area' => $st['area'] ?? ''], $stores), 'rows' => array_values($groups)]);
}

/** まとめて入れる（{ from, to, sessions: [["9:00","11:45"],…], memo, stores: [code…] }）。店舗がすでに入れていた日は上書きする */
function hq_special_bulk_put(): never
{
    $stores = closure_stores();
    Http::requireJson();
    $b = Http::body();
    $from = Http::date($b, 'from');
    $to = isset($b['to']) && $b['to'] !== '' ? Http::date($b, 'to') : $from;
    if ($to < $from) Http::error('終わりの日は始めの日より後にしてください', 400);
    if (Time::diffDays($from, $to) > 30) Http::error('一度に入れられるのは 31 日分までです', 400);
    $sessions = Settings::parseSpecialSessions($b['sessions'] ?? null);
    if ($sessions === null) Http::error('時間を確認してください（「始め〜受付の最後」を 1〜3 つ。時間が重ならないように）', 400);
    $memo = mb_substr(trim((string)($b['memo'] ?? '')), 0, 40);
    $want = is_array($b['stores'] ?? null) ? array_map('strval', $b['stores']) : [];
    $pick = array_values(array_filter($stores, fn($st) => in_array($st['code'], $want, true)));
    if (!$pick) Http::error('店舗を選んでください', 400);
    $dates = [];
    for ($d = $from; $d <= $to; $d = Time::addDays($d, 1)) $dates[] = $d;
    Db::transaction(function () use ($pick, $dates, $sessions, $memo) {
        foreach ($pick as $st) foreach ($dates as $d) {
            Db::exec('INSERT INTO special_day (storeId, date, sessions, memo) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE sessions = VALUES(sessions), memo = VALUES(memo)', [$st['id'], $d, json_encode($sessions), $memo]);
        }
    });
    Settings::clearSpecialCache();
    // 新しい時間の外に入っている予約（予約は消さない。店舗が電話で調整する）
    $setting = Settings::global();
    $outside = [];
    foreach ($pick as $st) foreach ($dates as $d) {
        $n = special_outside($st, $setting, $d);
        if ($n > 0) $outside[] = ['store' => $st['code'], 'name' => $st['name'], 'date' => $d, 'count' => $n];
    }
    Http::json(['ok' => true, 'count' => count($pick) * count($dates), 'outside' => $outside]);
}

/** まとめて消す（{ date, stores: [code…] }）→ その日は通常の営業時間に戻る */
function hq_special_bulk_delete(): never
{
    $stores = closure_stores();
    Http::requireJson();
    $b = Http::body();
    $date = Http::date($b, 'date');
    $want = is_array($b['stores'] ?? null) ? array_map('strval', $b['stores']) : [];
    $n = 0;
    foreach ($stores as $st) if (in_array($st['code'], $want, true)) $n += Db::exec('DELETE FROM special_day WHERE storeId = ? AND date = ?', [$st['id'], $date]);
    Settings::clearSpecialCache();
    Http::json(['ok' => true, 'deleted' => $n]);
}
