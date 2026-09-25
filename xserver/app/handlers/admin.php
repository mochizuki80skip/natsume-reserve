<?php
// 管理画面 API（店舗・本部共通）。/api/admin/...
declare(strict_types=1);

// ---------- ログイン ----------
function adm_login(): never
{
    if (!RateLimit::allow('login:' . Http::clientIp(), 20, 10 * 60)) Http::error('しばらくしてからお試しください', 429);
    Http::requireJson();
    $b = Http::body();
    $code = trim((string)($b['code'] ?? ''));
    $password = (string)($b['password'] ?? '');
    $acc = Db::one('SELECT a.*, s.active AS storeActive FROM admin_account a LEFT JOIN store s ON s.id = a.storeId WHERE a.code = ?', [$code]);
    $ok = $acc && password_verify($password, $acc['passwordHash']);
    if (!$ok || ($acc['role'] === 'store' && !(int)$acc['storeActive'])) Http::error('店舗コードまたはパスワードが違います', 401);
    Auth::setSessionCookie(['accountId' => $acc['id'], 'role' => $acc['role'] === 'hq' ? 'hq' : 'store', 'storeId' => $acc['storeId'], 'code' => $acc['code']]);
    Http::json(['ok' => true]);
}

function adm_logout(): never
{
    $s = Auth::session();
    Auth::clearSessionCookie();
    $to = ($s && $s['role'] === 'store') ? '/admin/login/' . rawurlencode($s['code']) : '/admin/login';
    Http::redirect($to);
}

/** 本部の店舗切替（フォーム POST） */
function adm_switch(): never
{
    $s = Auth::session();
    if (!$s || $s['role'] !== 'hq') Http::error('forbidden', 403);
    $code = (string)($_POST['store'] ?? '');
    if (!Settings::findStoreByCode($code)) Http::error('not found', 404);
    Auth::setStoreCookie($code);
    $back = (string)($_POST['back'] ?? '/admin');
    Http::redirect(str_starts_with($back, '/admin') ? $back : '/admin');
}

/** 画面の共通情報（ログイン状態・表示中の店舗・本部なら店舗一覧） */
function adm_me(): never
{
    $s = Auth::requireSession();
    $store = Auth::resolveStore($s);
    $stores = $s['role'] === 'hq' ? array_map(fn($r) => ['code' => $r['code'], 'name' => $r['name'], 'active' => (bool)$r['active']], Db::all('SELECT code, name, active FROM store ORDER BY code ASC')) : [];
    Http::json([
        'session' => ['code' => $s['code'], 'role' => $s['role']],
        'store' => $store ? ['id' => $store['id'], 'code' => $store['code'], 'name' => $store['name'], 'active' => (bool)$store['active']] : null,
        'stores' => $stores,
        'today' => Time::nowJst()['date'],
        'smsEnabled' => Sms::enabled(),
    ]);
}

// ---------- 予約表 ----------
function adm_day(): never
{
    $ctx = Auth::context();
    $date = Http::query('date', '');
    if (!Time::isValidDate($date)) Http::error('bad date', 400);
    $setting = Settings::global();
    $d = DayData::load($ctx['store'], $setting, $date);
    $today = Time::nowJst()['date'];
    Http::json(['data' => $d, 'storeName' => $ctx['store']['name'], 'storeCode' => $ctx['store']['code'], 'published' => PublicApi::isPublished($ctx['store'], $date, $today, $d['day']['published']), 'today' => $today]);
}

/** セルの一括保存。text が空なら削除 */
function adm_cells_put(): never
{
    $ctx = Auth::context();
    Http::requireJson();
    $b = Http::body();
    $date = Http::date($b, 'date');
    $cells = $b['cells'] ?? null;
    if (!is_array($cells) || count($cells) > 500) Http::error('bad request', 400);
    $sid = $ctx['store']['id'];
    $beds = (int)$ctx['store']['beds'];
    Db::transaction(function () use ($cells, $sid, $beds, $date) {
        $touched = [];
        foreach ($cells as $c) {
            if (!is_array($c)) throw new HttpError(400, 'bad request');
            $time = Http::int($c, 'time', 0, 1440);
            $bed = Http::int($c, 'bed', 0, 20);
            $text = mb_substr(trim((string)($c['text'] ?? '')), 0, 100);
            if ($bed > $beds) continue;
            if ($text === '') {
                $old = Db::one('SELECT reservationId FROM cell WHERE storeId = ? AND date = ? AND time = ? AND bed = ?', [$sid, $date, $time, $bed]);
                if ($old && $old['reservationId']) $touched[$old['reservationId']] = true;
                Db::exec('DELETE FROM cell WHERE storeId = ? AND date = ? AND time = ? AND bed = ?', [$sid, $date, $time, $bed]);
            } else {
                Db::exec('INSERT INTO cell (id, storeId, date, time, bed, text) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE text = VALUES(text)', [Db::newId(), $sid, $date, $time, $bed, $text]);
            }
        }
        // WEB予約のセルがすべて消えたら、その予約は取消扱いにする
        foreach (array_keys($touched) as $rid) {
            $n = (int)Db::one('SELECT COUNT(*) AS n FROM cell WHERE reservationId = ?', [$rid])['n'];
            if ($n === 0) Db::exec('UPDATE reservation SET status = ? WHERE id = ?', ['CANCELLED', $rid]);
        }
    });
    Http::json(['ok' => true]);
}

/** 日付の公開/非公開・臨時休診・メモ・枠数の上書き */
function adm_days_put(): never
{
    $ctx = Auth::context();
    Http::requireJson();
    $b = Http::body();
    $date = Http::date($b, 'date');
    $sid = $ctx['store']['id'];
    $row = Db::one('SELECT * FROM day_status WHERE storeId = ? AND date = ?', [$sid, $date]);
    $set = [];
    $params = [];
    if (array_key_exists('published', $b)) { if ($b['published'] !== null && !is_bool($b['published'])) Http::error('bad request', 400); $set[] = 'published = ?'; $params[] = $b['published'] === null ? null : ($b['published'] ? 1 : 0); }
    if (array_key_exists('closed', $b)) { $set[] = 'closed = ?'; $params[] = Http::bool($b, 'closed') ? 1 : 0; }
    if (array_key_exists('memo', $b)) { $set[] = 'memo = ?'; $params[] = mb_substr((string)$b['memo'], 0, 500); }
    foreach (['capacityAm', 'capacityPm'] as $k) {
        if (array_key_exists($k, $b)) { $set[] = "$k = ?"; $params[] = $b[$k] === null ? null : Http::int($b, $k, 0, 20); }
    }
    if (!$row) {
        Db::exec('INSERT INTO day_status (id, storeId, date) VALUES (?, ?, ?)', [Db::newId(), $sid, $date]);
    }
    if ($set) Db::exec('UPDATE day_status SET ' . implode(', ', $set) . ' WHERE storeId = ? AND date = ?', array_merge($params, [$sid, $date]));
    $day = Settings::dayRow(Db::one('SELECT * FROM day_status WHERE storeId = ? AND date = ?', [$sid, $date]));
    Http::json(['ok' => true, 'day' => $day]);
}

/** 来院チェックの ON/OFF */
function adm_visit_put(): never
{
    $ctx = Auth::context();
    Http::requireJson();
    $b = Http::body();
    $date = Http::date($b, 'date');
    $time = Http::int($b, 'time', 0, 1440);
    $bed = Http::int($b, 'bed', 1, 20);
    $visited = Http::bool($b, 'visited');
    $n = Db::exec('UPDATE cell SET visited = ? WHERE storeId = ? AND date = ? AND time = ? AND bed = ?', [$visited ? 1 : 0, $ctx['store']['id'], $date, $time, $bed]);
    $exists = Db::one('SELECT id FROM cell WHERE storeId = ? AND date = ? AND time = ? AND bed = ?', [$ctx['store']['id'], $date, $time, $bed]);
    if (!$exists) Http::error('セルが空です', 404);
    Http::json(['ok' => true, 'updated' => $n]);
}

// ---------- キャンセル名簿 ----------
function adm_cancel_post(): never
{
    $ctx = Auth::context();
    Http::requireJson();
    $b = Http::body();
    $date = Http::date($b, 'date');
    $time = Http::int($b, 'time', 0, 1440);
    $bed = Http::int($b, 'bed', 1, 20);
    $kind = $b['kind'] ?? '';
    if (!in_array($kind, ['ADVANCE', 'NOSHOW'], true)) Http::error('bad request', 400);
    $memo = mb_substr(trim((string)($b['memo'] ?? '')), 0, 200);
    $nextDate = trim((string)($b['nextDate'] ?? ''));
    if ($nextDate !== '' && !Time::isValidDate($nextDate)) Http::error('日付の形式が正しくありません', 400);
    $sid = $ctx['store']['id'];
    $step = Settings::global()['slotMinutes'];
    $cell = Db::one('SELECT * FROM cell WHERE storeId = ? AND date = ? AND time = ? AND bed = ?', [$sid, $date, $time, $bed]);
    if (!$cell || trim($cell['text']) === '') Http::error('セルが空です', 404);
    $next = Text::isTwoSlotName($cell['text']) ? Db::one('SELECT * FROM cell WHERE storeId = ? AND date = ? AND time = ? AND bed = ?', [$sid, $date, $time + $step, $bed]) : null;
    $cont = ($next && Text::isContinuationText($next['text'])) ? $next : null;
    $logId = Db::newId();
    Db::transaction(function () use ($logId, $sid, $date, $time, $bed, $cell, $cont, $kind, $ctx, $memo, $nextDate) {
        Db::exec('INSERT INTO cancel_log (id, storeId, date, time, bed, name, contText, kind, source, reservationId, byCode, memo, nextDate, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
            $logId, $sid, $date, $time, $bed, $cell['text'], $cont['text'] ?? null, $kind, $cell['reservationId'] ? 'WEB' : 'MANUAL', $cell['reservationId'], $ctx['session']['code'], $memo !== '' ? $memo : null, $nextDate !== '' ? $nextDate : null, Time::nowJstDateTime(),
        ]);
        Db::exec('DELETE FROM cell WHERE id = ?', [$cell['id']]);
        if ($cont) Db::exec('DELETE FROM cell WHERE id = ?', [$cont['id']]);
        if ($cell['reservationId']) Db::exec('UPDATE reservation SET status = ? WHERE id = ?', ['CANCELLED', $cell['reservationId']]);
    });
    Http::json(['ok' => true, 'log' => Db::one('SELECT * FROM cancel_log WHERE id = ?', [$logId])]);
}

/** 名簿から予約表に戻す */
function adm_cancel_delete(): never
{
    $ctx = Auth::context();
    Http::requireJson();
    $id = (string)(Http::body()['id'] ?? '');
    $sid = $ctx['store']['id'];
    $log = Db::one('SELECT * FROM cancel_log WHERE id = ? AND storeId = ?', [$id, $sid]);
    if (!$log) Http::error('not found', 404);
    $step = Settings::global()['slotMinutes'];
    $times = $log['contText'] ? [(int)$log['time'], (int)$log['time'] + $step] : [(int)$log['time']];
    $busy = Db::all('SELECT text FROM cell WHERE storeId = ? AND date = ? AND bed = ? AND time IN (' . Db::inList($times) . ')', array_merge([$sid, $log['date'], $log['bed']], $times));
    foreach ($busy as $c) if (trim($c['text']) !== '') Http::error('元の枠に別の予約が入っているため戻せません。空けてから戻してください。', 409);
    Db::transaction(function () use ($sid, $log, $times, $step) {
        Db::exec('DELETE FROM cell WHERE storeId = ? AND date = ? AND bed = ? AND time IN (' . Db::inList($times) . ')', array_merge([$sid, $log['date'], $log['bed']], $times));
        $rid = $log['reservationId'] && Db::one('SELECT id FROM reservation WHERE id = ?', [$log['reservationId']]) ? $log['reservationId'] : null;
        Db::exec('INSERT INTO cell (id, storeId, date, time, bed, text, reservationId) VALUES (?, ?, ?, ?, ?, ?, ?)', [Db::newId(), $sid, $log['date'], $log['time'], $log['bed'], $log['name'], $rid]);
        if ($log['contText']) Db::exec('INSERT INTO cell (id, storeId, date, time, bed, text, reservationId) VALUES (?, ?, ?, ?, ?, ?, ?)', [Db::newId(), $sid, $log['date'], (int)$log['time'] + $step, $log['bed'], $log['contText'], $rid]);
        if ($rid) Db::exec('UPDATE reservation SET status = ? WHERE id = ?', ['BOOKED', $rid]);
        Db::exec('DELETE FROM cancel_log WHERE id = ?', [$log['id']]);
    });
    Http::json(['ok' => true]);
}

/** 名簿のメモ・次回予約日の更新 */
function adm_cancel_patch(): never
{
    $ctx = Auth::context();
    Http::requireJson();
    $b = Http::body();
    $log = Db::one('SELECT * FROM cancel_log WHERE id = ? AND storeId = ?', [(string)($b['id'] ?? ''), $ctx['store']['id']]);
    if (!$log) Http::error('not found', 404);
    if (array_key_exists('memo', $b)) {
        $memo = mb_substr(trim((string)($b['memo'] ?? '')), 0, 200);
        Db::exec('UPDATE cancel_log SET memo = ? WHERE id = ?', [$memo !== '' ? $memo : null, $log['id']]);
    }
    if (array_key_exists('nextDate', $b)) {
        $v = trim((string)($b['nextDate'] ?? ''));
        if ($v !== '' && !Time::isValidDate($v)) Http::error('日付の形式が正しくありません', 400);
        Db::exec('UPDATE cancel_log SET nextDate = ? WHERE id = ?', [$v !== '' ? $v : null, $log['id']]);
    }
    Http::json(['ok' => true]);
}

// ---------- 予約・来院ログ ----------
function adm_log_filter(): array
{
    $today = Time::nowJst()['date'];
    $from = Http::query('from');
    $to = Http::query('to');
    $status = Http::query('status', '');
    return [
        'tab' => Http::query('tab') === 'cancel' ? 'cancel' : 'web',
        'from' => ($from && Time::isValidDate($from)) ? $from : Time::addDays($today, -7),
        'to' => ($to && Time::isValidDate($to)) ? $to : Time::addDays($today, 60),
        'status' => in_array($status, ['BOOKED', 'CANCELLED'], true) ? $status : '',
        'q' => trim((string)Http::query('q', '')),
    ];
}

function adm_log_rows(array $store, array $f, int $take): array
{
    $sid = $store['id'];
    if ($f['tab'] === 'cancel') {
        $sql = 'SELECT * FROM cancel_log WHERE storeId = ? AND date BETWEEN ? AND ?';
        $params = [$sid, $f['from'], $f['to']];
        if ($f['q'] !== '') { $sql .= ' AND name LIKE ?'; $params[] = '%' . $f['q'] . '%'; }
        $sql .= " ORDER BY date DESC, time ASC LIMIT $take";
        return Db::all($sql, $params);
    }
    $sql = 'SELECT * FROM reservation WHERE storeId = ? AND date BETWEEN ? AND ?';
    $params = [$sid, $f['from'], $f['to']];
    if ($f['status'] !== '') { $sql .= ' AND status = ?'; $params[] = $f['status']; }
    if ($f['q'] !== '') {
        $digits = preg_replace('/[^\d+]/', '', $f['q']);
        $sql .= ' AND (name LIKE ? OR phone LIKE ? OR cardNo LIKE ?)';
        $params[] = '%' . $f['q'] . '%';
        $params[] = '%' . ($digits !== '' ? $digits : $f['q']) . '%';
        $params[] = '%' . $f['q'] . '%';
    }
    $sql .= " ORDER BY createdAt DESC LIMIT $take";
    return Db::all($sql, $params);
}

function adm_reservations_get(): never
{
    $ctx = Auth::context();
    $f = adm_log_filter();
    $rows = adm_log_rows($ctx['store'], $f, 500);
    $out = array_map(function ($r) use ($f) {
        $r['time'] = (int)$r['time'];
        $r['bed'] = (int)$r['bed'];
        $r['createdAtText'] = Time::formatDateTimeShort($r['createdAt']);
        if ($f['tab'] === 'web') $r['phoneText'] = Text::formatJpPhone($r['phone']);
        return $r;
    }, $rows);
    Http::json(['filter' => $f, 'rows' => $out]);
}

/** WEB予約を取り消す（セルを消して CANCELLED に） */
function adm_reservations_delete(): never
{
    $ctx = Auth::context();
    Http::requireJson();
    $id = (string)(Http::body()['id'] ?? '');
    $r = Db::one('SELECT * FROM reservation WHERE id = ? AND storeId = ?', [$id, $ctx['store']['id']]);
    if (!$r) Http::error('not found', 404);
    Db::transaction(function () use ($r) {
        Db::exec('DELETE FROM cell WHERE reservationId = ?', [$r['id']]);
        Db::exec('UPDATE reservation SET status = ? WHERE id = ?', ['CANCELLED', $r['id']]);
    });
    Http::json(['ok' => true]);
}

const ADM_KIND_JA = ['NEW' => '初診', 'REVISIT' => '再来', 'RETURN' => '通院中'];
const ADM_STATUS_JA = ['BOOKED' => '予約中', 'CANCELLED' => '取消'];

/** CSV / Excel 書き出し */
function adm_reservations_export(): never
{
    $ctx = Auth::context();
    $store = $ctx['store'];
    $f = adm_log_filter();
    $format = Http::query('format') === 'xlsx' ? 'xlsx' : 'csv';
    $list = adm_log_rows($store, $f, 5000);
    if ($f['tab'] === 'cancel') {
        $header = ['予約日', '時刻', 'ベッド', '氏名', '区分', '種別', '登録日時', '登録者', '次回予約', 'メモ'];
        $rows = array_map(fn($c) => [$c['date'], Time::minToHm((int)$c['time']), (int)$c['bed'], $c['name'], $c['kind'] === 'ADVANCE' ? '事前連絡' : '無断', $c['source'] === 'WEB' ? 'WEB予約' : '電話・窓口', $c['createdAt'], $c['byCode'], $c['nextDate'] ?? '', $c['memo'] ?? ''], $list);
        $label = 'キャンセル名簿';
    } else {
        $header = ['受付日時', '予約日', '時刻', 'ベッド', '区分', '氏名', '診察券番号', '電話番号', '状態'];
        $rows = array_map(fn($r) => [$r['createdAt'], $r['date'], Time::minToHm((int)$r['time']), (int)$r['bed'], ADM_KIND_JA[$r['kind']] ?? $r['kind'], $r['name'], $r['cardNo'] ?? '', Text::formatJpPhone($r['phone']), ADM_STATUS_JA[$r['status']] ?? $r['status']], $list);
        $label = 'WEB予約一覧';
    }
    $base = "{$store['code']}_{$f['tab']}_{$f['from']}_{$f['to']}";
    $jaName = rawurlencode("{$store['name']}_{$label}_{$f['from']}_{$f['to']}");
    header('Cache-Control: no-store');
    if ($format === 'xlsx') {
        $bytes = Xlsx::build($label, "{$store['name']}　{$label}　{$f['from']} 〜 {$f['to']}　（出力 " . Time::nowJst()['date'] . '）', $header, $rows);
        header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        header("Content-Disposition: attachment; filename=\"$base.xlsx\"; filename*=UTF-8''$jaName.xlsx");
        echo $bytes;
        exit;
    }
    $esc = fn($v) => preg_match('/[",\r\n]/', (string)$v) ? '"' . str_replace('"', '""', (string)$v) . '"' : (string)$v;
    $lines = [implode(',', array_map($esc, $header))];
    foreach ($rows as $r) $lines[] = implode(',', array_map($esc, $r));
    header('Content-Type: text/csv; charset=utf-8');
    header("Content-Disposition: attachment; filename=\"$base.csv\"; filename*=UTF-8''$jaName.csv");
    echo "\xEF\xBB\xBF" . implode("\r\n", $lines) . "\r\n";
    exit;
}

// ---------- カレンダー・シフト ----------
function adm_calendar_get(): never
{
    $ctx = Auth::context();
    $store = $ctx['store'];
    $today = Time::nowJst()['date'];
    $ym = Http::query('month');
    if (!Time::isValidMonth($ym)) $ym = substr($today, 0, 7);
    $setting = Settings::global();
    $dates = Time::datesOfMonth($ym);
    $rows = Db::all('SELECT * FROM day_status WHERE storeId = ? AND date IN (' . Db::inList($dates) . ')', array_merge([$store['id']], $dates));
    $map = [];
    foreach ($rows as $r) $map[$r['date']] = Settings::dayRow($r);
    $days = [];
    foreach ($dates as $date) {
        $r = $map[$date] ?? null;
        $open = count(Settings::storeSessions($store, $setting, $date, $r['closed'] ?? false)) > 0;
        $days[] = [
            'date' => $date, 'published' => $r['published'] ?? null, 'closed' => $r['closed'] ?? false,
            'businessDay' => $open || ($r['closed'] ?? false),
            'effectivePublished' => PublicApi::isPublished($store, $date, $today, $r['published'] ?? null),
        ];
    }
    Http::json(['month' => $ym, 'today' => $today, 'days' => $days, 'publishDaysAhead' => (int)$store['publishDaysAhead']]);
}

function adm_shifts_get(): never
{
    $ctx = Auth::context();
    $store = $ctx['store'];
    $today = Time::nowJst()['date'];
    $ym = Http::query('month');
    if (!Time::isValidMonth($ym)) $ym = substr($today, 0, 7);
    $setting = Settings::global();
    $dates = Time::datesOfMonth($ym);
    $in = Db::inList($dates);
    $members = Db::all('SELECT id, name, role FROM staff_member WHERE storeId = ? AND active = 1 ORDER BY sortOrder ASC', [$store['id']]);
    $shifts = Db::all("SELECT staffId, date, status FROM shift WHERE storeId = ? AND date IN ($in)", array_merge([$store['id']], $dates));
    $days = Db::all("SELECT date, closed FROM day_status WHERE storeId = ? AND date IN ($in)", array_merge([$store['id']], $dates));
    $closedMap = [];
    foreach ($days as $d) $closedMap[$d['date']] = (bool)$d['closed'];
    $closedDates = array_values(array_filter($dates, fn($d) => count(Settings::storeSessions($store, $setting, $d, $closedMap[$d] ?? false)) === 0));
    Http::json(['month' => $ym, 'dates' => $dates, 'closedDates' => $closedDates, 'members' => $members, 'shifts' => $shifts]);
}

/** シフト 1 セルの保存。空または WORK なら行を削除 */
function adm_shifts_put(): never
{
    $ctx = Auth::context();
    Http::requireJson();
    $b = Http::body();
    $staffId = (string)($b['staffId'] ?? '');
    $date = Http::date($b, 'date');
    $status = (string)($b['status'] ?? '');
    if ($status !== '' && !in_array($status, Settings::SHIFT_STATUSES, true)) Http::error('bad request', 400);
    $m = Db::one('SELECT id FROM staff_member WHERE id = ? AND storeId = ?', [$staffId, $ctx['store']['id']]);
    if (!$m) Http::error('not found', 404);
    if ($status === '' || $status === 'WORK') {
        Db::exec('DELETE FROM shift WHERE staffId = ? AND date = ?', [$staffId, $date]);
    } else {
        Db::exec('INSERT INTO shift (id, storeId, staffId, date, status) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE status = VALUES(status)', [Db::newId(), $ctx['store']['id'], $staffId, $date, $status]);
    }
    Http::json(['ok' => true]);
}

// ---------- スタッフ ----------
function adm_staff_post(): never
{
    $ctx = Auth::context();
    Http::requireJson();
    $b = Http::body();
    $name = trim((string)($b['name'] ?? ''));
    $role = (string)($b['role'] ?? '');
    if ($name === '' || mb_strlen($name) > 30 || !in_array($role, ['THERAPIST', 'RECEPTION'], true)) Http::error('氏名を入力してください', 400);
    $store = $ctx['store'];
    $max = $role === 'THERAPIST' ? (int)$store['maxTherapists'] : (int)$store['maxReception'];
    $count = (int)Db::one('SELECT COUNT(*) AS n FROM staff_member WHERE storeId = ? AND role = ? AND active = 1', [$store['id'], $role])['n'];
    if ($count >= $max) Http::error(($role === 'THERAPIST' ? '施術者' : '受付') . "は最大 {$max} 名です（店舗設定で変更できます）", 400);
    $last = Db::one('SELECT MAX(sortOrder) AS m FROM staff_member WHERE storeId = ?', [$store['id']]);
    $id = Db::newId();
    Db::exec('INSERT INTO staff_member (id, storeId, name, role, sortOrder) VALUES (?, ?, ?, ?, ?)', [$id, $store['id'], $name, $role, (int)($last['m'] ?? 0) + 1]);
    Http::json(['ok' => true, 'member' => Db::one('SELECT * FROM staff_member WHERE id = ?', [$id])]);
}

function adm_staff_put(): never
{
    $ctx = Auth::context();
    Http::requireJson();
    $b = Http::body();
    $sid = $ctx['store']['id'];
    $m = Db::one('SELECT * FROM staff_member WHERE id = ? AND storeId = ?', [(string)($b['id'] ?? ''), $sid]);
    if (!$m) Http::error('not found', 404);
    $move = $b['move'] ?? null;
    if ($move === 'up' || $move === 'down') {
        $all = Db::all('SELECT id, sortOrder FROM staff_member WHERE storeId = ? ORDER BY sortOrder ASC', [$sid]);
        $i = array_search($m['id'], array_column($all, 'id'), true);
        $j = $move === 'up' ? $i - 1 : $i + 1;
        if ($i !== false && $j >= 0 && $j < count($all)) {
            Db::transaction(function () use ($all, $i, $j) {
                Db::exec('UPDATE staff_member SET sortOrder = ? WHERE id = ?', [$all[$j]['sortOrder'], $all[$i]['id']]);
                Db::exec('UPDATE staff_member SET sortOrder = ? WHERE id = ?', [$all[$i]['sortOrder'], $all[$j]['id']]);
            });
        }
    }
    $set = [];
    $params = [];
    if (isset($b['name'])) { $n = trim((string)$b['name']); if ($n === '' || mb_strlen($n) > 30) Http::error('bad request', 400); $set[] = 'name = ?'; $params[] = $n; }
    if (isset($b['role'])) { if (!in_array($b['role'], ['THERAPIST', 'RECEPTION'], true)) Http::error('bad request', 400); $set[] = 'role = ?'; $params[] = $b['role']; }
    if (array_key_exists('active', $b)) { $set[] = 'active = ?'; $params[] = Http::bool($b, 'active') ? 1 : 0; }
    if ($set) Db::exec('UPDATE staff_member SET ' . implode(', ', $set) . ' WHERE id = ?', array_merge($params, [$m['id']]));
    Http::json(['ok' => true]);
}

function adm_staff_delete(): never
{
    $ctx = Auth::context();
    Http::requireJson();
    $m = Db::one('SELECT id FROM staff_member WHERE id = ? AND storeId = ?', [(string)(Http::body()['id'] ?? ''), $ctx['store']['id']]);
    if (!$m) Http::error('not found', 404);
    Db::exec('DELETE FROM staff_member WHERE id = ?', [$m['id']]); // シフトは外部キーで一緒に消える
    Http::json(['ok' => true]);
}

// ---------- 店舗設定 ----------
function adm_settings_get(): never
{
    $ctx = Auth::context();
    $store = $ctx['store'];
    $setting = Settings::global();
    $members = Db::all('SELECT id, name, role, active FROM staff_member WHERE storeId = ? ORDER BY sortOrder ASC', [$store['id']]);
    Http::json([
        'store' => [
            'code' => $store['code'], 'name' => $store['name'], 'phone' => $store['phone'], 'beds' => $store['beds'], 'defaultActiveBeds' => $store['defaultActiveBeds'],
            'maxTherapists' => $store['maxTherapists'], 'maxReception' => $store['maxReception'], 'publishDaysAhead' => $store['publishDaysAhead'],
            'notifyPhone' => $store['notifyPhone'] ?? '', 'hoursOverride' => $store['hoursOverride'] ? json_encode($store['hoursOverride'], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : '',
        ],
        'globalHours' => json_encode($setting['hours'], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        'canChangePassword' => $ctx['session']['role'] === 'store',
        'smsEnabled' => Sms::enabled(),
        'members' => array_map(fn($m) => ['id' => $m['id'], 'name' => $m['name'], 'role' => $m['role'], 'active' => (bool)$m['active']], $members),
    ]);
}

function adm_store_put(): never
{
    $ctx = Auth::context();
    Http::requireJson();
    $b = Http::body();
    try {
        $name = Http::str($b, 'name', 50);
        $phone = Http::str($b, 'phone', 20);
        $beds = Http::int($b, 'beds', 1, 20);
        $dab = Http::int($b, 'defaultActiveBeds', 0, 20);
        $maxT = Http::int($b, 'maxTherapists', 1, 20);
        $maxR = Http::int($b, 'maxReception', 0, 20);
        $pub = Http::int($b, 'publishDaysAhead', 0, 365);
        $notify = Http::str($b, 'notifyPhone', 20, false);
    } catch (HttpError) {
        Http::error('入力内容を確認してください', 400);
    }
    $hoursOverride = null;
    if (isset($b['hoursOverride']) && $b['hoursOverride'] !== null) {
        $cfg = Hours::parseHoursConfig($b['hoursOverride']);
        if (!$cfg) Http::error('営業時間の個別設定の形式が正しくありません（docs/SPEC.md 参照）', 400);
        $hoursOverride = json_encode($cfg, JSON_UNESCAPED_UNICODE);
    }
    Db::exec('UPDATE store SET name = ?, phone = ?, beds = ?, defaultActiveBeds = ?, maxTherapists = ?, maxReception = ?, publishDaysAhead = ?, notifyPhone = ?, hoursOverride = ? WHERE id = ?',
        [$name, $phone, $beds, min($dab, $beds), $maxT, $maxR, $pub, $notify !== '' ? $notify : null, $hoursOverride, $ctx['store']['id']]);
    Http::json(['ok' => true]);
}

/** 自分のパスワード変更 */
function adm_store_patch(): never
{
    $ctx = Auth::context();
    Http::requireJson();
    $b = Http::body();
    $current = (string)($b['current'] ?? '');
    $next = (string)($b['next'] ?? '');
    if (strlen($next) < 8) Http::error('8文字以上にしてください', 400);
    $acc = Db::one('SELECT * FROM admin_account WHERE id = ?', [$ctx['session']['accountId']]);
    if (!$acc || !password_verify($current, $acc['passwordHash'])) Http::error('現在のパスワードが違います', 400);
    Db::exec('UPDATE admin_account SET passwordHash = ? WHERE id = ?', [password_hash($next, PASSWORD_BCRYPT), $acc['id']]);
    Http::json(['ok' => true]);
}
