<?php
// 離反者リスト（/api/admin/churn…）と 2 週間フォロー（/api/admin/follow…）。表示中の店舗。管轄MG は管轄外の店舗は見るだけ
declare(strict_types=1);

const CHURN_TEXT = ['cardNo' => 20, 'name' => 40, 'kind' => 10, 'visits' => 10, 'staff' => 30, 'symptom' => 100, 'treatment' => 10, 'manage' => 10, 'reason' => 200];

function churn_row(array $r): array
{
    return ['id' => $r['id'], 'churnDate' => $r['churnDate'], 'lastVisit' => $r['lastVisit'], 'cardNo' => $r['cardNo'], 'name' => $r['name'], 'sex' => $r['sex'], 'age' => $r['age'] === null ? null : (int)$r['age'],
        'kind' => $r['kind'], 'visits' => $r['visits'], 'staff' => $r['staff'], 'symptom' => $r['symptom'], 'treatment' => $r['treatment'], 'manage' => $r['manage'], 'reason' => $r['reason'],
        'source' => $r['source'], 'edited' => (bool)$r['edited']];
}

/** 入力値を検証して DB の値に（$auto＝自動で入る欄を直したか） */
function churn_clean(array $patch, bool &$auto): array
{
    $set = [];
    foreach ($patch as $k => $v) {
        if ($k === 'churnDate') { if (!Time::isValidDate((string)$v)) Http::error('日付が正しくありません', 400); $set[$k] = (string)$v; $auto = true; continue; }
        if ($k === 'sex') { if (!in_array($v, ['', '♂', '♀'], true)) Http::error('bad request', 400); $set[$k] = $v; $auto = true; continue; }
        if ($k === 'age') {
            if ($v === null || $v === '') { $set[$k] = null; $auto = true; continue; }
            if (!is_numeric($v) || (int)$v < 0 || (int)$v > 120) Http::error('年齢が正しくありません', 400);
            $set[$k] = (int)$v; $auto = true; continue;
        }
        if (!isset(CHURN_TEXT[$k])) Http::error('bad request', 400);
        $set[$k] = mb_substr(trim((string)$v), 0, CHURN_TEXT[$k]);
        if ($k !== 'manage' && $k !== 'reason') $auto = true;
    }
    return $set;
}

function churn_get(): never
{
    $ctx = Auth::context();
    $store = $ctx['store'];
    $ym = Http::query('month');
    if (!Time::isValidMonth($ym)) $ym = substr(Time::nowJst()['date'], 0, 7);
    Churn::sync($store, $ym);
    $d = Time::datesOfMonth($ym);
    $rows = array_map('churn_row', Db::all('SELECT * FROM churn WHERE storeId = ? AND churnDate BETWEEN ? AND ? ORDER BY churnDate ASC, createdAt ASC', [$store['id'], $d[0], end($d)]));
    // 離反率＝その月に離反した人数 ÷ 前月に来院した実人数（「除く」は中止・転院の方を分子・分母から外す）
    $active = Churn::activeCount($store, $ym);
    $ex = count(array_filter($rows, fn($r) => in_array($r['manage'], Churn::EXCLUDE, true)));
    $n = count($rows);
    Http::json([
        'month' => $ym, 'today' => Time::nowJst()['date'], 'rows' => $rows, 'canEdit' => Auth::canEditStore($ctx['session'], $store),
        'stats' => ['count' => $n, 'active' => $active, 'excluded' => $ex,
            'rate' => $active > 0 ? round($n / $active * 100, 1) : null,
            'rateEx' => $active - $ex > 0 ? round(($n - $ex) / ($active - $ex) * 100, 1) : null],
        'manage' => Churn::MANAGE, 'staff' => array_column(Db::all("SELECT name FROM staff_member WHERE storeId = ? AND role = 'THERAPIST' AND active = 1 ORDER BY sortOrder ASC", [$store['id']]), 'name'),
    ]);
}

function churn_post(): never
{
    $ctx = Auth::context();
    Http::requireJson();
    $date = Http::date(Http::body(), 'churnDate');
    $id = Db::newId();
    Db::exec("INSERT INTO churn (id, storeId, churnDate, source, edited) VALUES (?, ?, ?, 'manual', 1)", [$id, $ctx['store']['id'], $date]);
    Http::json(['ok' => true, 'row' => churn_row(Db::one('SELECT * FROM churn WHERE id = ?', [$id]))]);
}

function churn_patch(): never
{
    $ctx = Auth::context();
    Http::requireJson();
    $b = Http::body();
    $row = Db::one('SELECT id FROM churn WHERE id = ? AND storeId = ?', [(string)($b['id'] ?? ''), $ctx['store']['id']]);
    if (!$row) Http::error('not found', 404);
    $auto = false;
    $set = churn_clean(is_array($b['patch'] ?? null) ? $b['patch'] : [], $auto);
    if ($set) {
        $cols = implode(', ', array_map(fn($k) => "`$k` = ?", array_keys($set)));
        Db::exec("UPDATE churn SET $cols" . ($auto ? ', edited = 1' : '') . ' WHERE id = ?', array_merge(array_values($set), [$row['id']]));
    }
    Http::json(['ok' => true, 'row' => churn_row(Db::one('SELECT * FROM churn WHERE id = ?', [$row['id']]))]);
}

/** 手で足した行・取り込んだ行だけ消せる（自動の行は、来院の記録から出しているため） */
function churn_delete(): never
{
    $ctx = Auth::context();
    Http::requireJson();
    $row = Db::one('SELECT id, source FROM churn WHERE id = ? AND storeId = ?', [(string)(Http::body()['id'] ?? ''), $ctx['store']['id']]);
    if (!$row) Http::error('not found', 404);
    if ($row['source'] === 'auto') Http::error('来院の記録から自動で出した行です。消すことはできません（管理・理由を入れてください）', 400);
    Db::exec('DELETE FROM churn WHERE id = ?', [$row['id']]);
    Http::json(['ok' => true]);
}

/** スプレッドシートの離反者リストを取り込む（{ rows, dryRun }）。同じ日・同じカルテNo（なければ氏名）があれば上書き */
function churn_import(): never
{
    $ctx = Auth::context();
    $sid = $ctx['store']['id'];
    Http::requireJson();
    $b = Http::body();
    $list = $b['rows'] ?? null;
    if (!is_array($list) || !$list || count($list) > 3000) Http::error('取り込む行がありません', 400);
    $dry = !empty($b['dryRun']);
    $res = [];
    $n = ['new' => 0, 'update' => 0, 'error' => 0];
    foreach ($list as $r) {
        if (!is_array($r)) { $res[] = ['status' => 'error', 'error' => '行が読めません']; $n['error']++; continue; }
        try {
            $auto = false;
            $set = churn_clean(array_filter($r, fn($v, $k) => $k !== 'id' && $v !== null && $v !== '', ARRAY_FILTER_USE_BOTH), $auto);
            if (($set['churnDate'] ?? '') === '') throw new HttpError(400, '日付がありません');
            if (($set['name'] ?? '') === '' && ($set['cardNo'] ?? '') === '') throw new HttpError(400, '氏名もカルテNoもありません');
        } catch (HttpError $e) { $res[] = ['status' => 'error', 'error' => $e->getMessage()]; $n['error']++; continue; }
        $same = null;
        foreach (Db::all('SELECT id, cardNo, name FROM churn WHERE storeId = ? AND churnDate = ?', [$sid, $set['churnDate']]) as $x) {
            $c1 = Churn::cardKey($x['cardNo']); $c2 = Churn::cardKey($set['cardNo'] ?? '');
            if (($c1 !== '' && $c1 === $c2) || ($c2 === '' && Text::isSameName($x['name'], $set['name'] ?? ''))) { $same = $x; break; }
        }
        $st = $same ? 'update' : 'new';
        $res[] = ['status' => $st]; $n[$st]++;
        if ($dry) continue;
        if ($same) {
            Db::exec('UPDATE churn SET ' . implode(', ', array_map(fn($k) => "`$k` = ?", array_keys($set))) . ', edited = 1 WHERE id = ?', array_merge(array_values($set), [$same['id']]));
        } else {
            $set['patientKey'] = Churn::cardKey($set['cardNo'] ?? '') ?: 'n:' . Text::normalizeName($set['name'] ?? '');
            $cols = implode(', ', array_map(fn($k) => "`$k`", array_keys($set)));
            Db::exec("INSERT INTO churn (id, storeId, source, edited, $cols) VALUES (?, ?, 'import', 1, " . implode(', ', array_fill(0, count($set), '?')) . ')', array_merge([Db::newId(), $sid], array_values($set)));
        }
    }
    Http::json(['ok' => true, 'counts' => $n, 'rows' => $res]);
}

function churn_export(): never
{
    $ctx = Auth::context();
    $store = $ctx['store'];
    $ym = Http::query('month');
    if (!Time::isValidMonth($ym)) Http::error('bad request', 400);
    Churn::sync($store, $ym);
    $d = Time::datesOfMonth($ym);
    $md = fn(?string $x) => $x ? (int)substr($x, 5, 2) . '/' . (int)substr($x, 8, 2) : '';
    $rows = array_map(fn($r) => [$md($r['churnDate']), $r['cardNo'], $r['name'], $r['sex'], $r['age'], $r['kind'], $r['visits'], $r['staff'], $r['symptom'], $r['treatment'], $r['manage'], $r['reason'], $md($r['lastVisit'])],
        Db::all('SELECT * FROM churn WHERE storeId = ? AND churnDate BETWEEN ? AND ? ORDER BY churnDate ASC, createdAt ASC', [$store['id'], $d[0], end($d)]));
    $bytes = Xlsx::build('離反者リスト', "{$store['name']}　離反者リスト　{$ym}　（出力 " . Time::nowJst()['date'] . '）',
        ['離反した日付', 'カルテNo.', '患者氏名', '性', '年', '内訳（新・再・既）', '通院回数', '担当', '症状', '施術内容', '管理（治癒・転院）', '理由', '最終来院'], $rows);
    $ja = rawurlencode("離反者リスト_{$store['name']}_{$ym}");
    header('Cache-Control: no-store');
    header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    header("Content-Disposition: attachment; filename=\"churn_{$store['code']}_{$ym}.xlsx\"; filename*=UTF-8''$ja.xlsx");
    echo $bytes;
    exit;
}

// ---------- 2 週間フォロー ----------
function follow_get(): never
{
    $ctx = Auth::context();
    $store = $ctx['store'];
    $today = Time::nowJst()['date'];
    Churn::syncFollow($store, $today);
    $date = Http::query('date');
    if (!Time::isValidDate($date) || $date > $today) $date = $today;
    $pending = Http::query('pending') === '1';
    $rows = $pending
        ? Db::all("SELECT * FROM follow WHERE storeId = ? AND contactedAt IS NULL AND nextText = '' AND noBooking = 0 ORDER BY listDate DESC, lastVisit DESC", [$store['id']])
        : Db::all('SELECT * FROM follow WHERE storeId = ? AND listDate = ? ORDER BY lastVisit DESC, name ASC', [$store['id'], $date]);
    // 次の予約が予約表に入れば、日時を自動で出す
    $bookings = Churn::bookingsAfter($store, $rows ? min(array_column($rows, 'lastVisit')) : $today);
    $out = array_map(function ($r) use ($bookings) {
        $next = null;
        foreach ($bookings[$r['patientKey']] ?? [] as $b) if ($b['date'] > $r['lastVisit']) { $next = $b; break; }
        return ['id' => $r['id'], 'listDate' => $r['listDate'], 'lastVisit' => $r['lastVisit'], 'cardNo' => $r['cardNo'], 'name' => $r['name'], 'staff' => $r['staff'],
            'contactedAt' => $r['contactedAt'], 'nextText' => $r['nextText'], 'noBooking' => (bool)$r['noBooking'], 'note' => $r['note'],
            'autoNext' => $next ? ['date' => $next['date'], 'time' => $next['time']] : null];
    }, $rows);
    $pendingCount = (int)(Db::one("SELECT COUNT(*) AS n FROM follow WHERE storeId = ? AND contactedAt IS NULL AND nextText = '' AND noBooking = 0", [$store['id']])['n'] ?? 0);
    Http::json(['date' => $date, 'today' => $today, 'pending' => $pending, 'pendingCount' => $pendingCount, 'rows' => $out, 'canEdit' => Auth::canEditStore($ctx['session'], $store)]);
}

/** 連絡したか（{ id, patch: { contacted: true, nextText, noBooking, note } }） */
function follow_patch(): never
{
    $ctx = Auth::context();
    Http::requireJson();
    $b = Http::body();
    $row = Db::one('SELECT id FROM follow WHERE id = ? AND storeId = ?', [(string)($b['id'] ?? ''), $ctx['store']['id']]);
    if (!$row) Http::error('not found', 404);
    $p = is_array($b['patch'] ?? null) ? $b['patch'] : [];
    $set = [];
    if (array_key_exists('contacted', $p)) $set['contactedAt'] = $p['contacted'] ? Time::nowJst()['date'] : null;
    if (array_key_exists('nextText', $p)) $set['nextText'] = mb_substr(trim((string)$p['nextText']), 0, 40);
    if (array_key_exists('noBooking', $p)) $set['noBooking'] = $p['noBooking'] ? 1 : 0;
    if (array_key_exists('note', $p)) $set['note'] = mb_substr(trim((string)$p['note']), 0, 200);
    if ($set) Db::exec('UPDATE follow SET ' . implode(', ', array_map(fn($k) => "`$k` = ?", array_keys($set))) . ' WHERE id = ?', array_merge(array_values($set), [$row['id']]));
    Http::json(['ok' => true]);
}
