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
    $acc = Db::one('SELECT a.*, s.active AS storeActive, s.hqOnly AS storeHqOnly FROM admin_account a LEFT JOIN store s ON s.id = a.storeId WHERE a.code = ?', [$code]);
    $ok = $acc && password_verify($password, $acc['passwordHash']);
    if (!$ok || ($acc['role'] === 'store' && !(int)$acc['storeActive']) || !(int)($acc['active'] ?? 1)) Http::error('店舗コード（ID）またはパスワードが違います', 401);
    // 本部専用の店舗は、店舗のアカウントではログインできない（本部のアカウントで切り替えて使う）
    if ($acc['role'] === 'store' && (int)($acc['storeHqOnly'] ?? 0)) Http::error('この店舗は本部専用です。本部のアカウントでログインしてください', 403);
    Db::exec('UPDATE admin_account SET lastLoginAt = ? WHERE id = ?', [Time::nowJstDateTime(), $acc['id']]);
    Auth::setSessionCookie(['accountId' => $acc['id'], 'role' => in_array($acc['role'], ['hq', 'mg', 'acct'], true) ? $acc['role'] : 'store', 'storeId' => $acc['storeId'], 'code' => $acc['code']]);
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
    $s = Auth::requireSession();
    if ($s['role'] !== 'hq' && $s['role'] !== 'mg') Http::error('forbidden', 403);
    $code = (string)($_POST['store'] ?? '');
    $st = Settings::findStoreByCode($code);
    if (!$st || !Auth::canOpenStore($s, $st)) Http::error('not found', 404);
    Auth::setStoreCookie($code);
    $back = (string)($_POST['back'] ?? '/admin');
    Http::redirect(str_starts_with($back, '/admin') ? $back : '/admin');
}

/** 画面の共通情報（ログイン状態・表示中の店舗・本部なら店舗一覧） */
function adm_me(): never
{
    $s = Auth::requireSession();
    $store = Auth::resolveStore($s);
    // 店舗切り替えに出す店舗：本部＝全店、管轄MG＝管轄エリアの店舗
    $list = $s['role'] === 'hq' ? Settings::storesInOrder() : ($s['role'] === 'mg' ? Auth::mgStores() : []);
    $stores = array_map(fn($r) => ['code' => $r['code'], 'name' => $r['name'], 'active' => (bool)$r['active'], 'area' => $r['area'] ?? '', 'hqOnly' => (bool)($r['hqOnly'] ?? 0), 'jibaiOnly' => (bool)($r['jibaiOnly'] ?? 0)], $list);
    Http::json([
        'session' => ['code' => $s['code'], 'role' => $s['role'], 'name' => $s['role'] !== 'store' ? (Auth::account()['name'] ?? '') : '', 'canManage' => $s['role'] === 'hq' && (int)(Auth::account()['canManage'] ?? 0) === 1, 'area' => $s['role'] === 'mg' ? (string)(Auth::account()['area'] ?? '') : ''],
        'store' => $store ? ['id' => $store['id'], 'code' => $store['code'], 'name' => $store['name'], 'active' => (bool)$store['active'], 'jibaiOnly' => (bool)($store['jibaiOnly'] ?? 0)] : null,
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
    $conflicts = [];
    $by = (string)($ctx['session']['code'] ?? '');
    Db::transaction(function () use ($cells, $sid, $beds, $date, &$conflicts, $by) {
        $touched = [];
        foreach ($cells as $c) {
            if (!is_array($c)) throw new HttpError(400, 'bad request');
            $time = Http::int($c, 'time', 0, 1440);
            $bed = Http::int($c, 'bed', 0, 20);
            $text = mb_substr(trim((string)($c['text'] ?? '')), 0, 100);
            if ($bed > $beds) continue;
            // 画面が古いまま WEB予約のセルを上書きしないようにする（prev＝画面が最後に知っていた内容）
            if (array_key_exists('prev', $c)) {
                $cur = Db::one('SELECT text, reservationId FROM cell WHERE storeId = ? AND date = ? AND time = ? AND bed = ?', [$sid, $date, $time, $bed]);
                if ($cur && $cur['reservationId'] && trim((string)$cur['text']) !== trim((string)$c['prev']) && trim((string)$cur['text']) !== $text) {
                    $conflicts[] = ['time' => $time, 'bed' => $bed, 'text' => (string)$cur['text']];
                    continue;
                }
            }
            // 消した・別の名前に書き換えた入力を記録する（「元に戻す」用。1 文字ずつの打ち直しは記録しない）
            $was = Db::one('SELECT text FROM cell WHERE storeId = ? AND date = ? AND time = ? AND bed = ?', [$sid, $date, $time, $bed]);
            $wasText = trim((string)($was['text'] ?? ''));
            if ($wasText !== '' && !Text::isContinuationText($wasText) && $wasText !== $text && ($text === '' || (!str_starts_with($text, $wasText) && !str_starts_with($wasText, $text)))) {
                Db::exec('INSERT INTO cell_log (id, storeId, date, time, bed, `before`, `after`, byCode, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [Db::newId(), $sid, $date, $time, $bed, $wasText, $text, $by, Time::nowJstDateTime()]);
            }
            if ($text === '') {
                $old = Db::one('SELECT reservationId FROM cell WHERE storeId = ? AND date = ? AND time = ? AND bed = ?', [$sid, $date, $time, $bed]);
                if ($old && $old['reservationId']) $touched[$old['reservationId']] = true;
                Db::exec('DELETE FROM cell WHERE storeId = ? AND date = ? AND time = ? AND bed = ?', [$sid, $date, $time, $bed]);
            } else {
                Db::exec('INSERT INTO cell (id, storeId, date, time, bed, text) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE text = VALUES(text)', [Db::newId(), $sid, $date, $time, $bed, $text]);
                // 別の人の名前に書き換えたら、前の人の電話番号は外す（（初診）を付けた・外しただけなら残す）
                if ($wasText !== '' && Karte::nameOfText($wasText) !== Karte::nameOfText($text)) Db::exec('UPDATE cell SET phone = NULL WHERE storeId = ? AND date = ? AND time = ? AND bed = ?', [$sid, $date, $time, $bed]);
            }
        }
        // WEB予約のセルがすべて消えたら、その予約は取消扱いにする
        foreach (array_keys($touched) as $rid) {
            $n = (int)Db::one('SELECT COUNT(*) AS n FROM cell WHERE reservationId = ?', [$rid])['n'];
            if ($n === 0) Db::exec('UPDATE reservation SET status = ? WHERE id = ?', ['CANCELLED', $rid]);
        }
    });
    Http::json(['ok' => true, 'conflicts' => $conflicts]);
}

/** 予約表のセルのメニュー（{ date, time, bed, menus: ["矯正", ...] }）。氏名の入ったセルだけ */
function adm_cell_menus_put(): never
{
    $ctx = Auth::context();
    Http::requireJson();
    $b = Http::body();
    $date = Http::date($b, 'date');
    $time = Http::int($b, 'time', 0, 1440);
    $bed = Http::int($b, 'bed', 1, 20);
    $list = $b['menus'] ?? null;
    if (!is_array($list) || count($list) > 10) Http::error('bad request', 400);
    $menus = [];
    foreach ($list as $m) {
        $m = mb_substr(trim((string)$m), 0, 20);
        if ($m !== '' && !in_array($m, $menus, true)) $menus[] = $m;
    }
    $cell = Db::one('SELECT id, text, staff FROM cell WHERE storeId = ? AND date = ? AND time = ? AND bed = ?', [$ctx['store']['id'], $date, $time, $bed]);
    if (!$cell || trim((string)$cell['text']) === '') Http::error('先に氏名を入力してください', 404);
    Db::exec('UPDATE cell SET menus = ? WHERE id = ?', [$menus ? json_encode($menus, JSON_UNESCAPED_UNICODE) : '', $cell['id']]);
    // 2回目・3回目などを付けたら、担当が空なら初回を担当したスタッフを入れる（同姓同名で決められないときは「担当を確認」）
    $staff = (string)$cell['staff'];
    $check = false;
    if ($staff === '' && Karte::hasCountMenu($menus)) {
        $fv = Karte::firstVisitOf($ctx['store'], (string)$cell['text'], $date);
        if ($fv['ambiguous']) $check = true;
        elseif ($fv['row'] && $fv['row']['staff'] !== '') { $staff = $fv['row']['staff']; Db::exec('UPDATE cell SET staff = ? WHERE id = ?', [$staff, $cell['id']]); }
    }
    Karte::reflectCell($ctx['store'], $date, $time, $bed);
    Http::json(['ok' => true, 'menus' => $menus, 'staff' => $staff, 'staffCheck' => $check]);
}

/** 担当者をまとめて付ける・外す（{ date, cells: [{time, bed}], staff: "名前" | "" }）。氏名の入ったセルだけ */
function adm_cell_staff_put(): never
{
    $ctx = Auth::context();
    Http::requireJson();
    $b = Http::body();
    $date = Http::date($b, 'date');
    $list = $b['cells'] ?? null;
    if (!is_array($list) || count($list) === 0 || count($list) > 200) Http::error('bad request', 400);
    $staff = mb_substr(trim((string)($b['staff'] ?? '')), 0, 30);
    $n = 0;
    foreach ($list as $c) {
        if (!is_array($c)) Http::error('bad request', 400);
        $time = Http::int($c, 'time', 0, 1440);
        $bed = Http::int($c, 'bed', 1, 20);
        $cell = Db::one('SELECT id, text FROM cell WHERE storeId = ? AND date = ? AND time = ? AND bed = ?', [$ctx['store']['id'], $date, $time, $bed]);
        if (!$cell || trim((string)$cell['text']) === '' || Text::isContinuationText((string)$cell['text']) || Availability::isBlockMark((string)$cell['text'])) continue;
        Db::exec('UPDATE cell SET staff = ? WHERE id = ?', [$staff, $cell['id']]);
        Karte::reflectCell($ctx['store'], $date, $time, $bed);
        $n++;
    }
    Http::json(['ok' => true, 'updated' => $n]);
}

/** 担当者ごとの数（{ month: YYYY-MM }）。来院チェック済みの予約だけ数える */
function adm_staff_counts(): never
{
    $ctx = Auth::context();
    $store = $ctx['store'];
    $ym = Http::query('month', '');
    if (!preg_match('/^\d{4}-\d{2}$/', $ym)) Http::error('月が正しくありません', 400);
    $dates = Time::datesOfMonth($ym);
    $cells = Db::all('SELECT date, text, menus, staff FROM cell WHERE storeId = ? AND date BETWEEN ? AND ? AND bed > 0 AND visited = 1', [$store['id'], $dates[0], $dates[count($dates) - 1]]);
    $out = [];
    $row = fn() => ['total' => 0, 'new' => 0, 'revisit' => 0, 'jibai' => 0, 'counts' => [], 'firsts' => 0, 'reached2' => 0, 'days' => []];
    foreach ($cells as $c) {
        $text = (string)$c['text'];
        if (!Availability::isPatientText($text)) continue;
        $s = (string)$c['staff'];
        $out[$s] ??= $row();
        $out[$s]['total']++;
        $out[$s]['days'][$c['date']] = ($out[$s]['days'][$c['date']] ?? 0) + 1; // 日ごとの人数
        $cat = Text::categorize($text);
        if ($cat['isNew'] && !$cat['isJibai']) $out[$s]['new']++;
        if ($cat['isNew'] && $cat['isJibai']) $out[$s]['jibai']++;
        if ($cat['isRevisit']) $out[$s]['revisit']++;
        foreach (DayData::menusOf((string)$c['menus']) as $m) if (preg_match('/^\d+回目$/u', $m)) $out[$s]['counts'][$m] = ($out[$s]['counts'][$m] ?? 0) + 1;
    }
    // 2回目到達率：その月に初回（初診・再来）を担当した患者様のうち、2回目に来た割合（初回カルテ集計から）
    Karte::sync($store, $ym);
    foreach (Db::all('SELECT staff, visits FROM karte WHERE storeId = ? AND date BETWEEN ? AND ?', [$store['id'], $dates[0], $dates[count($dates) - 1]]) as $k) {
        $s = (string)$k['staff'];
        $out[$s] ??= $row();
        $out[$s]['firsts']++;
        $v = json_decode((string)$k['visits'], true);
        if (is_array($v) && !empty($v[0]['d'])) $out[$s]['reached2']++;
    }
    $rows = [];
    foreach ($out as $name => $r) $rows[] = ['staff' => $name] + $r;
    usort($rows, fn($a, $b) => ($a['staff'] === '') <=> ($b['staff'] === '') ?: $b['total'] <=> $a['total']);
    $oldest = Time::addDays(Time::nowJst()['date'], -Settings::global()['retentionDays']);
    Http::json(['month' => $ym, 'dates' => $dates, 'rows' => array_map(fn($r) => ['days' => (object)$r['days']] + $r, $rows), 'partial' => $dates[0] < $oldest]);
}

/** 新しく入った WEB予約（管理画面のお知らせ用）。since より後に受け付けた分を返す。since が無ければ今の時刻だけ返す */
function adm_web_new_get(): never
{
    $ctx = Auth::context();
    $sid = $ctx['store']['id'];
    $now = Time::nowJstDateTime();
    $since = (string)($_GET['since'] ?? '');
    if (!preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $since)) Http::json(['now' => $now, 'items' => []]);
    $rows = Db::all('SELECT id, date, time, bed, kind, name FROM reservation WHERE storeId = ? AND status = ? AND createdAt >= ? ORDER BY createdAt ASC LIMIT 20', [$sid, 'BOOKED', $since]);
    $items = array_map(fn($r) => ['id' => $r['id'], 'date' => $r['date'], 'time' => (int)$r['time'], 'bed' => (int)$r['bed'], 'kind' => $r['kind'], 'name' => $r['name']], $rows);
    Http::json(['now' => $now, 'items' => $items]);
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
    Karte::reflectCell($ctx['store'], $date, $time, $bed);
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

/**
 * 予約を別の日・時間に移動（{ date, time, bed, toDate, toTime }）。ベッドは空いているところを自動で選ぶ。
 * 予約表でセルをマウスで動かしたときは toBed（置いたベッド）が付く。そのベッドが空いていなければ動かさない。
 * 「元に戻す」のときは revertLogId（動かしたときの予約変更の記録）が付き、記録を消して元の場所へ戻す。
 * 氏名・2 枠目（上記初診対応など）・WEB 予約の情報（電話番号など）・予約ログの日時をまとめて移す
 */
function adm_move_post(): never
{
    $ctx = Auth::context();
    Http::requireJson();
    $b = Http::body();
    $date = Http::date($b, 'date');
    $toDate = Http::date($b, 'toDate');
    try {
        $time = Http::int($b, 'time', 0, 1440);
        $bed = Http::int($b, 'bed', 1, 20);
        $toTime = Http::int($b, 'toTime', 0, 1440);
        $wantBed = isset($b['toBed']) ? Http::int($b, 'toBed', 1, 20) : null;
    } catch (HttpError) {
        Http::error('入力内容を確認してください', 400);
    }
    $allowOver = !empty($b['allowOver']); // 予約サイトの枠がいっぱいでも、空いているベッド（管理側だけのベッド）に入れる
    $memo = mb_substr(trim((string)($b['memo'] ?? '')), 0, 200);
    $revertLogId = (string)($b['revertLogId'] ?? '');
    $store = $ctx['store'];
    $sid = $store['id'];
    $setting = Settings::global();
    $step = $setting['slotMinutes'];
    $cell = Db::one('SELECT * FROM cell WHERE storeId = ? AND date = ? AND time = ? AND bed = ?', [$sid, $date, $time, $bed]);
    if (!$cell || trim($cell['text']) === '') Http::error('セルが空です', 404);
    $next = Text::isTwoSlotName($cell['text']) ? Db::one('SELECT * FROM cell WHERE storeId = ? AND date = ? AND time = ? AND bed = ?', [$sid, $date, $time + $step, $bed]) : null;
    $cont = ($next && Text::isContinuationText($next['text'])) ? $next : null;
    $need = $cont ? 2 : 1;

    // 移動先の時間が、その日の予約表にあるか（管理側だけの枠も可）
    $day = Settings::dayRow(Db::one('SELECT * FROM day_status WHERE storeId = ? AND date = ?', [$sid, $toDate]));
    $times = Hours::slotTimes(Settings::storeSessions($store, $setting, $toDate, $day['closed'] ?? false), $step, true);
    for ($k = 0; $k < $need; $k++) {
        if (!in_array($toTime + $k * $step, $times, true)) Http::error($k === 0 ? 'その日のその時間は予約表にありません（休診日・営業時間外）' : '2 枠目の時間が営業時間外になるため移動できません', 409);
    }

    $locks = array_values(array_unique(["reserve:$sid:$date", "reserve:$sid:$toDate"]));
    sort($locks);
    foreach ($locks as $l) {
        $g = Db::one('SELECT GET_LOCK(?, 10) AS ok', [$l]);
        if (!$g || (int)$g['ok'] !== 1) Http::error('混み合っています。もう一度お試しください', 503);
    }
    try {
        $moved = Db::transaction(function () use ($sid, $store, $setting, $date, $toDate, $toTime, $need, $step, $cell, $cont, $allowOver, $memo, $ctx, $wantBed, $revertLogId) {
            // 予約サイトに出している枠（施術者の人数）がいっぱいなら、確認なしでは入れない
            if (!$allowOver) {
                $left = adm_slot_left($store, $setting, $toDate, $toTime, $need, [$cell['id'], $cont['id'] ?? '']);
                if ($left !== null && $left <= 0) throw new HttpError(409, 'この時間は予約サイトの枠（施術者の人数）がいっぱいです。枠を超えて入れる場合は「枠を超えて入れる」にチェックしてください。');
            }
            // 空いているベッド：移動先の枠がすべて空で、ブロックもかかっていないベッド（番号の小さい順）
            $targetTimes = [];
            for ($k = 0; $k < $need; $k++) $targetTimes[] = $toTime + $k * $step;
            $busy = [];
            foreach (Db::all('SELECT time, bed, text, id FROM cell WHERE storeId = ? AND date = ? AND time IN (' . Db::inList($targetTimes) . ')', array_merge([$sid, $toDate], $targetTimes)) as $c) {
                // 移動元そのもの（同じ日に少しずらす場合）は空きとして扱う
                if ($c['id'] === $cell['id'] || ($cont && $c['id'] === $cont['id'])) continue;
                if (trim($c['text']) !== '') $busy[(int)$c['bed']] = true;
            }
            foreach (Db::all('SELECT startTime, endTime, beds FROM slot_block WHERE storeId = ? AND date = ?', [$sid, $toDate]) as $bk) {
                foreach ($targetTimes as $t) {
                    if ($t < (int)$bk['startTime'] || $t >= (int)$bk['endTime']) continue;
                    foreach (PublicApi::blockBeds((string)$bk['beds'], Settings::allBeds($store)) as $bb) $busy[$bb] = true;
                }
            }
            $free = array_values(array_filter(Settings::allBeds($store), fn($x) => !isset($busy[$x])));
            if ($wantBed !== null) {
                if (!in_array($wantBed, Settings::allBeds($store), true)) throw new HttpError(409, 'そのベッドは予約表にありません');
                if (!in_array($wantBed, $free, true)) throw new HttpError(409, $need === 2 ? '置いた場所（2 枠ぶん）に別の予約・ブロックがあるため動かせません' : '置いた場所に別の予約・ブロックがあるため動かせません');
                $toBed = $wantBed;
            } else {
                if (!$free) throw new HttpError(409, '移動先の時間は空いていません。別の時間を選んでください。');
                $toBed = $free[0];
            }
            // 同じ日の中で動かしたときは来院チェックもそのまま移す
            $visited = $toDate === $date ? (int)($cell['visited'] ?? 0) : 0;
            Db::exec('DELETE FROM cell WHERE id = ?', [$cell['id']]);
            if ($cont) Db::exec('DELETE FROM cell WHERE id = ?', [$cont['id']]);
            // 移動先に空文字のセルが残っていれば消してから入れる
            Db::exec('DELETE FROM cell WHERE storeId = ? AND date = ? AND bed = ? AND time IN (' . Db::inList($targetTimes) . ')', array_merge([$sid, $toDate, $toBed], $targetTimes));
            Db::exec('INSERT INTO cell (id, storeId, date, time, bed, text, reservationId, menus, staff, visited, phone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [Db::newId(), $sid, $toDate, $toTime, $toBed, $cell['text'], $cell['reservationId'], (string)($cell['menus'] ?? ''), (string)($cell['staff'] ?? ''), $visited, $cell['phone'] ?? null]);
            if ($cont) Db::exec('INSERT INTO cell (id, storeId, date, time, bed, text, reservationId) VALUES (?, ?, ?, ?, ?, ?, ?)', [Db::newId(), $sid, $toDate, $toTime + $step, $toBed, $cont['text'], $cont['reservationId']]);
            if ($cell['reservationId']) Db::exec('UPDATE reservation SET date = ?, time = ?, bed = ? WHERE id = ?', [$toDate, $toTime, $toBed, $cell['reservationId']]);
            // 元に戻す：動かしたときの「予約変更」の記録を消すだけ（新しい記録は作らない）
            if ($revertLogId !== '') {
                Db::exec("DELETE FROM cancel_log WHERE id = ? AND storeId = ? AND kind = 'CHANGE'", [$revertLogId, $sid]);
                return ['date' => $toDate, 'time' => $toTime, 'bed' => $toBed, 'slots' => $need, 'logId' => null];
            }
            // キャンセル・変更名簿に「予約変更」として残す（元の日の名簿に出る。予約表には戻せない）
            $logId = Db::newId();
            Db::exec('INSERT INTO cancel_log (id, storeId, date, time, bed, name, contText, kind, source, reservationId, byCode, memo, nextDate, nextTime, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
                $logId, $sid, $date, (int)$cell['time'], (int)$cell['bed'], $cell['text'], $cont['text'] ?? null, 'CHANGE', $cell['reservationId'] ? 'WEB' : 'MANUAL', $cell['reservationId'], $ctx['session']['code'], $memo !== '' ? $memo : null, $toDate, $toTime, Time::nowJstDateTime(),
            ]);
            return ['date' => $toDate, 'time' => $toTime, 'bed' => $toBed, 'slots' => $need, 'logId' => $logId];
        });
    } finally {
        foreach ($locks as $l) Db::one('SELECT RELEASE_LOCK(?) AS r', [$l]);
    }
    Http::json(['ok' => true, 'moved' => $moved]);
}

/**
 * その時間に予約サイトの枠（施術者の人数）があと何人分残っているか。$exclude のセル（動かす予約そのもの）は数えない。
 * 営業時間外は null
 */
function adm_slot_left(array $store, array $setting, string $date, int $time, int $need, array $exclude): ?int
{
    $day = Settings::dayRow(Db::one('SELECT * FROM day_status WHERE storeId = ? AND date = ?', [$store['id'], $date]));
    $cells = array_values(array_filter(Db::all('SELECT id, time, bed, text FROM cell WHERE storeId = ? AND date = ? AND bed > 0', [$store['id'], $date]), fn($c) => !in_array($c['id'], $exclude, true)));
    $in = PublicApi::buildInput($store, $setting, $date, $need >= 2 ? 'NEW' : 'RETURN', $day['closed'] ?? false, $cells, null);
    $left = PHP_INT_MAX;
    for ($k = 0; $k < $need; $k++) {
        $t = $time + $k * $setting['slotMinutes'];
        $left = min($left, Availability::capacityAt($in, $time) - Availability::occupiedCountAt($in, $t));
    }
    return $left === PHP_INT_MAX ? null : $left;
}

/** 予約変更ダイアログ用：その日の時間ごとの「枠の残り」と「空いているベッド」（{ date, slots: 1|2, from: {date,time,bed} }） */
function adm_move_slots(): never
{
    $ctx = Auth::context();
    $store = $ctx['store'];
    $setting = Settings::global();
    $date = Http::query('date', '');
    if (!Time::isValidDate($date)) Http::error('日付が正しくありません', 400);
    $need = Http::query('slots') === '2' ? 2 : 1;
    $exclude = [];
    $fd = Http::query('fromDate', '');
    if ($fd === $date) {
        $ft = (int)Http::query('fromTime', '0');
        $fb = (int)Http::query('fromBed', '0');
        foreach (Db::all('SELECT id FROM cell WHERE storeId = ? AND date = ? AND bed = ? AND time IN (?, ?)', [$store['id'], $date, $fb, $ft, $ft + $setting['slotMinutes']]) as $c) $exclude[] = $c['id'];
    }
    $day = Settings::dayRow(Db::one('SELECT * FROM day_status WHERE storeId = ? AND date = ?', [$store['id'], $date]));
    $times = Hours::slotTimes(Settings::storeSessions($store, $setting, $date, $day['closed'] ?? false), $setting['slotMinutes'], true);
    $cells = array_values(array_filter(Db::all('SELECT id, time, bed, text FROM cell WHERE storeId = ? AND date = ? AND bed > 0', [$store['id'], $date]), fn($c) => !in_array($c['id'], $exclude, true)));
    $in = PublicApi::buildInput($store, $setting, $date, $need >= 2 ? 'NEW' : 'RETURN', $day['closed'] ?? false, $cells, null);
    $out = [];
    foreach ($times as $t) {
        $ok = true;
        for ($k = 0; $k < $need; $k++) if (!in_array($t + $k * $setting['slotMinutes'], $times, true)) $ok = false;
        if (!$ok) continue;
        $left = PHP_INT_MAX;
        $beds = 0;
        foreach (Settings::allBeds($store) as $bb) {
            $free = true;
            for ($k = 0; $k < $need; $k++) if (isset($in['occupied'][Availability::key($t + $k * $setting['slotMinutes'], $bb)])) $free = false;
            if ($free) $beds++;
        }
        for ($k = 0; $k < $need; $k++) $left = min($left, Availability::capacityAt($in, $t) - Availability::occupiedCountAt($in, $t + $k * $setting['slotMinutes']));
        $out[] = ['time' => $t, 'left' => max(0, $left), 'beds' => $beds];
    }
    Http::json(['date' => $date, 'slots' => $out]);
}

/** その日に消した・書き換えた入力（新しい順。元に戻す用） */
function adm_cell_log_get(): never
{
    $ctx = Auth::context();
    $date = Http::query('date', '');
    if (!Time::isValidDate($date)) Http::error('日付が正しくありません', 400);
    $rows = Db::all('SELECT id, time, bed, `before`, `after`, byCode, createdAt FROM cell_log WHERE storeId = ? AND date = ? ORDER BY createdAt DESC LIMIT 50', [$ctx['store']['id'], $date]);
    Http::json(['rows' => array_map(fn($r) => ['id' => $r['id'], 'time' => (int)$r['time'], 'bed' => (int)$r['bed'], 'before' => $r['before'], 'after' => $r['after'], 'byCode' => $r['byCode'], 'createdAt' => $r['createdAt']], $rows)]);
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
    if ($log['kind'] === 'CHANGE') Http::error('予約変更の記録は予約表に戻せません（変更先の日に予約があります）', 409);
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

const ADM_KIND_JA = PublicApi::KIND_JA;
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
        $rows = array_map(fn($c) => [$c['date'], Time::minToHm((int)$c['time']), (int)$c['bed'], $c['name'], ($c['kind'] === 'ADVANCE' ? '事前連絡' : ($c['kind'] === 'CHANGE' ? '予約変更' : '無断')), $c['source'] === 'WEB' ? 'WEB予約' : '電話・窓口', $c['createdAt'], $c['byCode'], trim(($c['nextDate'] ?? '') . ($c['nextTime'] !== null ? ' ' . Time::minToHm((int)$c['nextTime']) : '')), $c['memo'] ?? ''], $list);
        $label = 'キャンセル・変更名簿';
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
    // その月に 1 日でも所属している人だけ出す（入社前・異動後の月には出さない）
    $first = $dates[0];
    $last = $dates[count($dates) - 1];
    $members = Db::all('SELECT id, name, role, startDate, endDate, joinType FROM staff_member WHERE storeId = ? AND active = 1
        AND (startDate IS NULL OR startDate <= ?) AND (endDate IS NULL OR endDate >= ?) ORDER BY sortOrder ASC', [$store['id'], $last, $first]);
    $shifts = Db::all("SELECT staffId, date, status FROM shift WHERE storeId = ? AND date IN ($in)", array_merge([$store['id']], $dates));
    $helpIn = Db::all("SELECT date, status, name FROM help_in WHERE storeId = ? AND date IN ($in)", array_merge([$store['id']], $dates));
    $days = Db::all("SELECT date, closed FROM day_status WHERE storeId = ? AND date IN ($in)", array_merge([$store['id']], $dates));
    $closedMap = [];
    foreach ($days as $d) $closedMap[$d['date']] = (bool)$d['closed'];
    $closedDates = array_values(array_filter($dates, fn($d) => count(Settings::storeSessions($store, $setting, $d, $closedMap[$d] ?? false)) === 0));
    Http::json(['month' => $ym, 'dates' => $dates, 'closedDates' => $closedDates, 'members' => $members, 'shifts' => $shifts, 'helpIn' => $helpIn,
        'hasTherapists' => (bool)Db::one('SELECT 1 AS x FROM staff_member WHERE storeId = ? AND role = ? AND active = 1 LIMIT 1', [$store['id'], 'THERAPIST']),
        'defaultActiveBeds' => min((int)$store['defaultActiveBeds'], (int)$store['beds']), 'beds' => (int)$store['beds']]);
}

/** 予約表のブロック（打合せ・ミーティングなど）を追加。start〜end（end は含まない）の間、指定したベッドを使えなくする */
function adm_block_post(): never
{
    $ctx = Auth::context();
    Http::requireJson();
    $b = Http::body();
    $date = Http::date($b, 'date');
    try {
        $start = Http::int($b, 'start', 0, 24 * 60);
        $end = Http::int($b, 'end', 0, 24 * 60);
    } catch (HttpError) {
        Http::error('入力内容を確認してください', 400);
    }
    if ($end <= $start) Http::error('終了時刻は開始時刻より後にしてください', 400);
    $label = mb_substr(trim((string)($b['label'] ?? '')), 0, 30);
    $all = Settings::allBeds($ctx['store']);
    $beds = is_array($b['beds'] ?? null) ? array_values(array_unique(array_map('intval', $b['beds']))) : [];
    sort($beds);
    if (!$beds || array_diff($beds, $all)) Http::error('ベッドを選んでください', 400);
    Db::exec('INSERT INTO slot_block (id, storeId, date, startTime, endTime, count, beds, label) VALUES (?, ?, ?, ?, ?, 0, ?, ?)', [Db::newId(), $ctx['store']['id'], $date, $start, $end, implode(',', $beds), $label]);
    Http::json(['ok' => true]);
}

function adm_block_delete(): never
{
    $ctx = Auth::context();
    Http::requireJson();
    $n = Db::exec('DELETE FROM slot_block WHERE id = ? AND storeId = ?', [(string)(Http::body()['id'] ?? ''), $ctx['store']['id']]);
    if ($n === 0) Http::error('not found', 404);
    Http::json(['ok' => true]);
}

/** 他店からの応援（1 日 1 行）の保存。status が空なら削除 */
function adm_help_in_put(): never
{
    $ctx = Auth::context();
    Http::requireJson();
    $b = Http::body();
    $date = Http::date($b, 'date');
    $status = (string)($b['status'] ?? '');
    $name = mb_substr(trim((string)($b['name'] ?? '')), 0, 30);
    if ($status !== '' && !in_array($status, Settings::HELP_IN_STATUSES, true)) Http::error('bad request', 400);
    $sid = $ctx['store']['id'];
    if ($status === '') {
        Db::exec('DELETE FROM help_in WHERE storeId = ? AND date = ?', [$sid, $date]);
    } else {
        Db::exec('INSERT INTO help_in (id, storeId, date, status, name) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE status = VALUES(status), name = VALUES(name)', [Db::newId(), $sid, $date, $status, $name]);
    }
    Http::json(['ok' => true]);
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
    // 異動などで所属が終わった人は数えない
    $count = (int)Db::one('SELECT COUNT(*) AS n FROM staff_member WHERE storeId = ? AND role = ? AND active = 1 AND (endDate IS NULL OR endDate >= ?)', [$store['id'], $role, Time::nowJst()['date']])['n'];
    if ($count >= $max) Http::error(($role === 'THERAPIST' ? '施術者' : '受付') . "は最大 {$max} 名です（店舗設定で変更できます）", 400);
    $last = Db::one('SELECT MAX(sortOrder) AS m FROM staff_member WHERE storeId = ?', [$store['id']]);
    $id = Db::newId();
    [$startDate, $endDate, $joinType] = staff_period_from($b, null);
    Db::exec('INSERT INTO staff_member (id, storeId, name, role, sortOrder, startDate, endDate, joinType) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [$id, $store['id'], $name, $role, (int)($last['m'] ?? 0) + 1, $startDate, $endDate, $joinType]);
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
    if (array_key_exists('canFirst', $b)) { $set[] = 'canFirst = ?'; $params[] = Http::bool($b, 'canFirst') ? 1 : 0; }
    if (array_key_exists('canRevisit', $b)) { $set[] = 'canRevisit = ?'; $params[] = Http::bool($b, 'canRevisit') ? 1 : 0; }
    if (array_key_exists('color', $b)) {
        $c = (string)$b['color'];
        if ($c !== '' && !preg_match('/^#[0-9a-fA-F]{6}$/', $c)) Http::error('bad request', 400);
        $set[] = 'color = ?'; $params[] = strtolower($c);
    }
    if (array_key_exists('startDate', $b) || array_key_exists('endDate', $b) || array_key_exists('joinType', $b)) {
        [$sd, $ed, $jt] = staff_period_from($b, $m);
        array_push($set, 'startDate = ?', 'endDate = ?', 'joinType = ?');
        array_push($params, $sd, $ed, $jt);
    }
    if ($set) Db::exec('UPDATE staff_member SET ' . implode(', ', $set) . ' WHERE id = ?', array_merge($params, [$m['id']]));
    Http::json(['ok' => true]);
}

/**
 * 所属開始日・終了日・区分（新入社員／異動）を入力から取り出す。送られなかった項目は今の値のまま。
 * @return array{0:?string,1:?string,2:?string}
 */
function staff_period_from(array $b, ?array $cur): array
{
    $date = function (string $k) use ($b, $cur): ?string {
        if (!array_key_exists($k, $b)) return $cur[$k] ?? null;
        $v = trim((string)($b[$k] ?? ''));
        if ($v === '') return null;
        if (!Time::isValidDate($v)) Http::error('日付が正しくありません', 400);
        return $v;
    };
    $start = $date('startDate');
    $end = $date('endDate');
    if ($start && $end && $end < $start) Http::error('終了日は開始日より後にしてください', 400);
    $jt = array_key_exists('joinType', $b) ? (string)($b['joinType'] ?? '') : (string)($cur['joinType'] ?? '');
    if (!in_array($jt, ['', 'NEW', 'TRANSFER'], true)) Http::error('bad request', 400);
    return [$start, $end, $jt === '' ? null : $jt];
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
    $members = Db::all('SELECT id, name, role, active, startDate, endDate, joinType, canFirst, canRevisit, color FROM staff_member WHERE storeId = ? ORDER BY sortOrder ASC', [$store['id']]);
    Http::json([
        'store' => [
            'code' => $store['code'], 'name' => $store['name'], 'phone' => $store['phone'], 'beds' => $store['beds'], 'defaultActiveBeds' => $store['defaultActiveBeds'],
            'maxTherapists' => $store['maxTherapists'], 'maxReception' => $store['maxReception'], 'publishDaysAhead' => $store['publishDaysAhead'],
            'notifyPhone' => $store['notifyPhone'] ?? '', 'maxNewConcurrent' => ($store['maxNewConcurrent'] ?? null) === null ? null : (int)$store['maxNewConcurrent'], 'maxRevisitConcurrent' => ($store['maxRevisitConcurrent'] ?? null) === null ? null : (int)$store['maxRevisitConcurrent'], 'hoursOverride' => ($ho = is_string($store['hoursOverride'] ?? null) ? json_decode($store['hoursOverride'], true) : ($store['hoursOverride'] ?? null)) ? json_encode($ho, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : '',
        ],
        'globalHours' => json_encode($setting['hours'], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        'slotMinutes' => $setting['slotMinutes'],
        'canChangePassword' => true,
        'smsEnabled' => Sms::enabled(),
        'members' => array_map(fn($m) => ['id' => $m['id'], 'name' => $m['name'], 'role' => $m['role'], 'active' => (bool)$m['active'], 'startDate' => $m['startDate'], 'endDate' => $m['endDate'], 'joinType' => $m['joinType'],
            'canFirst' => (bool)$m['canFirst'], 'canRevisit' => (bool)$m['canRevisit'], 'color' => (string)$m['color']], $members),
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
        // 空欄（null）＝制限なし、0＝WEB では受けない
        $maxNew = !array_key_exists('maxNewConcurrent', $b) ? ($ctx['store']['maxNewConcurrent'] ?? null)
            : (($b['maxNewConcurrent'] === null || $b['maxNewConcurrent'] === '') ? null : Http::int($b, 'maxNewConcurrent', 0, 20));
        $maxRe = !array_key_exists('maxRevisitConcurrent', $b) ? ($ctx['store']['maxRevisitConcurrent'] ?? null)
            : (($b['maxRevisitConcurrent'] === null || $b['maxRevisitConcurrent'] === '') ? null : Http::int($b, 'maxRevisitConcurrent', 0, 20));
    } catch (HttpError) {
        Http::error('入力内容を確認してください', 400);
    }
    $hoursOverride = null;
    if (isset($b['hoursOverride']) && $b['hoursOverride'] !== null) {
        $cfg = Hours::parseHoursConfig($b['hoursOverride']);
        if (!$cfg) Http::error('営業時間の個別設定の形式が正しくありません（docs/SPEC.md 参照）', 400);
        $hoursOverride = json_encode($cfg, JSON_UNESCAPED_UNICODE);
    }
    Db::exec('UPDATE store SET name = ?, phone = ?, beds = ?, defaultActiveBeds = ?, maxTherapists = ?, maxReception = ?, publishDaysAhead = ?, notifyPhone = ?, maxNewConcurrent = ?, maxRevisitConcurrent = ?, hoursOverride = ? WHERE id = ?',
        [$name, $phone, $beds, min($dab, $beds), $maxT, $maxR, $pub, $notify !== '' ? $notify : null, $maxNew, $maxRe, $hoursOverride, $ctx['store']['id']]);
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

// ---------- 患者一覧（診察券番号 → 氏名） ----------
/** 診察券番号をそろえる（数字だけ・頭の 0 を取る。末尾の x（自費）・a（自賠）・r（労災）などの印は無視） */
function patient_no(string $v): string
{
    $d = preg_replace('/\D/', '', $v) ?? '';
    if ($d === '') return '';
    $d = ltrim($d, '0');
    return $d === '' ? '0' : substr($d, 0, 12);
}

/** 取り込み済みの件数と日時 */
function adm_patients_get(): never
{
    $ctx = Auth::context();
    $n = (int)Db::one('SELECT COUNT(*) AS n FROM patient_card WHERE storeId = ?', [$ctx['store']['id']])['n'];
    $at = Db::one('SELECT patientsImportedAt FROM store WHERE id = ?', [$ctx['store']['id']])['patientsImportedAt'] ?? null;
    Http::json(['count' => $n, 'importedAt' => $at]);
}

/**
 * 患者一覧の取り込み（{ rows: [{ no, name, kana }] }）。この店舗の一覧を置き換える。
 * CSV は画面（ブラウザ）で読み、診察券番号・氏名・フリガナだけを送る（住所・電話・生年月日はサーバーに来ない）
 */
function adm_patients_post(): never
{
    $ctx = Auth::context();
    Http::requireJson();
    $rows = Http::body()['rows'] ?? null;
    if (!is_array($rows) || count($rows) > 100000) Http::error('一覧が大きすぎるか、形式が正しくありません', 400);
    $sid = $ctx['store']['id'];
    $seen = [];
    $list = [];
    foreach ($rows as $r) {
        if (!is_array($r)) continue;
        $no = patient_no((string)($r['no'] ?? ''));
        $name = trim(preg_replace('/[\s\x{3000}]+/u', ' ', (string)($r['name'] ?? '')) ?? '');
        if ($no === '' || $name === '' || isset($seen[$no])) continue; // 同じ番号（自費・自賠などの別の行）は最初の行だけ
        $seen[$no] = true;
        $list[] = [$no, mb_substr($name, 0, 40), mb_substr(trim((string)($r['kana'] ?? '')), 0, 60)];
    }
    if (!$list) Http::error('診察券番号と氏名が読み取れませんでした。レセコンから出した CSV を選んでください。', 400);
    Db::transaction(function () use ($sid, $list) {
        Db::exec('DELETE FROM patient_card WHERE storeId = ?', [$sid]);
        foreach (array_chunk($list, 500) as $chunk) {
            $ph = implode(',', array_fill(0, count($chunk), '(?, ?, ?, ?)'));
            $params = [];
            foreach ($chunk as [$no, $name, $kana]) array_push($params, $sid, $no, $name, $kana);
            Db::exec("INSERT INTO patient_card (storeId, cardNo, name, kana) VALUES $ph", $params);
        }
        Db::exec('UPDATE store SET patientsImportedAt = ? WHERE id = ?', [Time::nowJstDateTime(), $sid]);
    });
    Http::json(['ok' => true, 'count' => count($list), 'skipped' => count($rows) - count($list)]);
}

/** 診察券番号から氏名（{ no } → { name: "…" | null }） */
function adm_patients_lookup(): never
{
    $ctx = Auth::context();
    $no = patient_no(Http::query('no', ''));
    if ($no === '') Http::json(['name' => null]);
    $r = Db::one('SELECT name FROM patient_card WHERE storeId = ? AND cardNo = ?', [$ctx['store']['id'], $no]);
    Http::json(['no' => $no, 'name' => $r['name'] ?? null]);
}

// ---------- 特別な営業日（プレオープン・イベントなど） ----------
/** この店舗の特別な営業日の一覧（日付順） */
function adm_special_days_get(): never
{
    $ctx = Auth::context();
    $rows = Db::all('SELECT date, sessions, memo FROM special_day WHERE storeId = ? ORDER BY date ASC', [$ctx['store']['id']]);
    Http::json(['rows' => array_map(fn($r) => ['date' => $r['date'], 'sessions' => json_decode((string)$r['sessions'], true) ?: [], 'memo' => (string)$r['memo']], $rows)]);
}

/** 特別な営業日の追加・変更（{ date, sessions: [["10:00","12:30"], ...], memo }） */
function adm_special_days_put(): never
{
    $ctx = Auth::context();
    Http::requireJson();
    $b = Http::body();
    $date = Http::date($b, 'date');
    $sessions = Settings::parseSpecialSessions($b['sessions'] ?? null);
    if ($sessions === null) Http::error('時間を確認してください（「始め〜受付の最後」を 1〜3 つ。時間が重ならないように）', 400);
    $memo = mb_substr(trim((string)($b['memo'] ?? '')), 0, 40);
    Db::exec('INSERT INTO special_day (storeId, date, sessions, memo) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE sessions = VALUES(sessions), memo = VALUES(memo)',
        [$ctx['store']['id'], $date, json_encode($sessions), $memo]);
    Settings::clearSpecialCache();
    Http::json(['ok' => true]);
}

/** 特別な営業日を消す（{ date }）。その日は通常の営業時間に戻る */
function adm_special_days_delete(): never
{
    $ctx = Auth::context();
    Http::requireJson();
    $date = Http::date(Http::body(), 'date');
    Db::exec('DELETE FROM special_day WHERE storeId = ? AND date = ?', [$ctx['store']['id'], $date]);
    Settings::clearSpecialCache();
    Http::json(['ok' => true]);
}

// ---------- 電話で取った予約の電話番号 ----------
/** セルに電話番号を付ける・直す・外す（{ date, time, bed, phone }。phone が空なら外す）。氏名の入ったセルだけ */
function adm_cell_phone_put(): never
{
    $ctx = Auth::context();
    Http::requireJson();
    $b = Http::body();
    $date = Http::date($b, 'date');
    $time = Http::int($b, 'time', 0, 1440);
    $bed = Http::int($b, 'bed', 1, 20);
    $raw = trim(mb_convert_kana((string)($b['phone'] ?? ''), 'n', 'UTF-8'));
    $phone = null;
    if ($raw !== '') {
        $phone = Text::normalizeJpPhone($raw);
        if (!$phone) Http::error('電話番号の形式が正しくありません（例：090-1234-5678）', 400);
    }
    $cell = Db::one('SELECT id, text FROM cell WHERE storeId = ? AND date = ? AND time = ? AND bed = ?', [$ctx['store']['id'], $date, $time, $bed]);
    if (!$cell || !Availability::isPatientText($cell['text']) || Text::isContinuationText((string)$cell['text'])) Http::error('氏名の入ったセルにだけ付けられます', 404);
    Db::exec('UPDATE cell SET phone = ? WHERE id = ?', [$phone, $cell['id']]);
    Http::json(['ok' => true, 'phone' => $phone]);
}

// ---------- 予約を探す（氏名・診察券番号） ----------
/**
 * 氏名または診察券番号で、この店舗の予約（予約表のセル・WEB 予約）を探す（{ q }）。
 * 診察券番号は、店舗設定で取り込んだ患者一覧で氏名に直し、WEB 予約に書かれた診察券番号とも合わせる。
 * 期間は 30 日前から 1 年先まで（予約表は保存期間を過ぎると消えるため、それより前は出ない）
 */
function adm_find_get(): never
{
    $ctx = Auth::context();
    $sid = $ctx['store']['id'];
    $q = trim(mb_convert_kana((string)Http::query('q', ''), 'asn', 'UTF-8'));
    if (mb_strlen($q) < 1) Http::json(['rows' => [], 'names' => []]);
    $today = Time::nowJst()['date'];
    $from = Time::addDays($today, -30);
    $to = Time::addDays($today, 366);
    $names = [];
    $cardNos = [];
    if (preg_match('/^\d{1,12}[a-z]?$/i', $q)) {
        // 診察券番号 → 氏名（頭の 0 は付けても付けなくても同じ）
        $no = (string)(int)preg_replace('/[a-z]$/i', '', $q);
        foreach (Db::all('SELECT cardNo, name FROM patient_card WHERE storeId = ?', [$sid]) as $p) {
            if ((string)(int)preg_replace('/[a-z]$/i', '', (string)$p['cardNo']) === $no) $names[] = (string)$p['name'];
        }
        $names = array_values(array_unique($names));
        $cardNos = [$q, $no];
    } else {
        $names = [$q];
    }
    $flat = fn(string $s) => str_replace([' ', '　'], '', $s);
    $rows = [];
    $seenRes = [];
    // 予約表のセル（電話・窓口・WEB）
    if ($names) {
        $conds = implode(' OR ', array_fill(0, count($names), "REPLACE(REPLACE(c.text, ' ', ''), '　', '') LIKE ?"));
        $params = array_merge([$sid, $from, $to], array_map(fn($n) => '%' . $flat($n) . '%', $names));
        foreach (Db::all("SELECT c.date, c.time, c.bed, c.text, c.phone, c.visited, r.id AS rId, r.phone AS rPhone FROM cell c LEFT JOIN reservation r ON r.id = c.reservationId
            WHERE c.storeId = ? AND c.date BETWEEN ? AND ? AND c.bed > 0 AND ($conds) ORDER BY c.date ASC, c.time ASC LIMIT 200", $params) as $c) {
            if (Text::isContinuationText((string)$c['text']) || !Availability::isPatientText($c['text'])) continue;
            if ($c['rId']) $seenRes[$c['rId']] = true;
            $rows[] = ['date' => $c['date'], 'time' => (int)$c['time'], 'bed' => (int)$c['bed'], 'text' => $c['text'], 'source' => $c['rId'] ? 'WEB' : ($c['phone'] ? 'PHONE' : 'GRID'),
                'phone' => Text::formatJpPhone($c['rPhone'] ?? $c['phone'] ?? ''), 'status' => 'BOOKED', 'visited' => (bool)$c['visited']];
        }
    }
    // WEB 予約（取り消し済みも。診察券番号で入れた WEB 予約も）
    $wc = [];
    $wp = [$sid, $from, $to];
    foreach ($names as $n) { $wc[] = "REPLACE(REPLACE(name, ' ', ''), '　', '') LIKE ?"; $wp[] = '%' . $flat($n) . '%'; }
    foreach ($cardNos as $cn) { $wc[] = 'cardNo = ?'; $wp[] = $cn; }
    if ($wc) {
        foreach (Db::all('SELECT id, date, time, bed, name, kind, phone, status FROM reservation WHERE storeId = ? AND date BETWEEN ? AND ? AND (' . implode(' OR ', $wc) . ') ORDER BY date ASC, time ASC LIMIT 200', $wp) as $r) {
            if (isset($seenRes[$r['id']])) continue;
            $rows[] = ['date' => $r['date'], 'time' => (int)$r['time'], 'bed' => (int)$r['bed'], 'text' => PublicApi::cellName($r['kind'], $r['name']), 'source' => 'WEB',
                'phone' => Text::formatJpPhone($r['phone']), 'status' => $r['status'] === 'CANCELLED' ? 'CANCELLED' : 'MISSING', 'visited' => false];
        }
    }
    usort($rows, fn($a, $b) => [$a['date'], $a['time']] <=> [$b['date'], $b['time']]);
    Http::json(['rows' => $rows, 'names' => $names, 'today' => $today]);
}

