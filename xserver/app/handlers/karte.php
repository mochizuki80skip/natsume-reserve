<?php
// 初回カルテ集計 API（店舗：/api/admin/karte、本部：/api/admin/hq/karte...）
declare(strict_types=1);

function karte_get(): never
{
    $ctx = Auth::context();
    $store = $ctx['store'];
    $today = Time::nowJst()['date'];
    $ym = Http::query('month');
    if (!Time::isValidMonth($ym)) $ym = substr($today, 0, 7);
    Karte::sync($store, $ym);
    $dates = Time::datesOfMonth($ym);
    $rows = Db::all('SELECT * FROM karte WHERE storeId = ? AND date BETWEEN ? AND ? ORDER BY date ASC, srcTime IS NULL, srcTime ASC, createdAt ASC', [$store['id'], $dates[0], $dates[count($dates) - 1]]);
    $staff = array_column(Db::all("SELECT name FROM staff_member WHERE storeId = ? AND role = 'THERAPIST' AND active = 1 ORDER BY sortOrder ASC", [$store['id']]), 'name');
    Http::json([
        'month' => $ym, 'today' => $today, 'storeName' => $store['name'],
        'rows' => array_map([Karte::class, 'rowOut'], $rows),
        // 新自（交通事故）で事故日・事故内容が空の、ほかの月の行（この月の分は rows にある）
        'accidentPending' => array_map([Karte::class, 'rowOut'], Db::all("SELECT * FROM karte WHERE storeId = ? AND kind IN ('ACCIDENT', 'THIRD') AND (accidentDate IS NULL OR accidentNote = '') AND (date < ? OR date > ?) ORDER BY date DESC LIMIT 200", [$store['id'], $dates[0], $dates[count($dates) - 1]])),
        'options' => Karte::options(), 'detailFor' => Karte::DETAIL_FOR, 'staff' => $staff,
    ]);
}

/** 行を手で追加 */
function karte_post(): never
{
    $ctx = Auth::context();
    Http::requireJson();
    $date = Http::date(Http::body(), 'date');
    $id = Db::newId();
    Db::exec('INSERT INTO karte (id, storeId, date, auto, edited, visits) VALUES (?, ?, ?, 0, 1, ?)', [$id, $ctx['store']['id'], $date, Karte::emptyVisits()]);
    Http::json(['ok' => true, 'row' => Karte::rowOut(Db::one('SELECT * FROM karte WHERE id = ?', [$id]))]);
}

/** 項目の更新（{ id, patch: { name: '…', … } }） */
function karte_patch(): never
{
    $ctx = Auth::context();
    Http::requireJson();
    $b = Http::body();
    $row = Db::one('SELECT id FROM karte WHERE id = ? AND storeId = ?', [(string)($b['id'] ?? ''), $ctx['store']['id']]);
    if (!$row) Http::error('not found', 404);
    $set = Karte::cleanPatch(is_array($b['patch'] ?? null) ? $b['patch'] : []);
    // 空白なしで入れた氏名は、患者一覧から名字の文字数を探す
    if (array_key_exists('surnameLen', $set) && $set['surnameLen'] === null) $set['surnameLen'] = Karte::surnameLenFromCards($ctx['store']['id'], (string)$set['name']);
    if ($set) {
        $cols = implode(', ', array_map(fn($k) => "`$k` = ?", array_keys($set)));
        Db::exec("UPDATE karte SET $cols, edited = 1 WHERE id = ?", array_merge(array_values($set), [$row['id']]));
    }
    Http::json(['ok' => true, 'row' => Karte::rowOut(Db::one('SELECT * FROM karte WHERE id = ?', [$row['id']]))]);
}

/** 行の削除。自動で入った行は、予約表の来院チェックを外さない限り次に開いたとき戻るため「手を加えていない」状態にはしない */
function karte_delete(): never
{
    $ctx = Auth::context();
    Http::requireJson();
    $b = Http::body();
    $row = Db::one('SELECT id, auto, date, srcTime, srcBed FROM karte WHERE id = ? AND storeId = ?', [(string)($b['id'] ?? ''), $ctx['store']['id']]);
    if (!$row) Http::error('not found', 404);
    $sid = $ctx['store']['id'];
    $removed = false;
    // 予約表から自動で入った行：予約表の予約（2 枠目も）も一緒に消す（残すと、来院チェックからまた行ができるため）
    if ((int)$row['auto']) {
        if (empty($b['uncheck'])) Http::error('予約表から自動で入った行です。予約表の予約も一緒に消してください', 400);
        if ($row['srcTime'] !== null && $row['srcBed'] !== null) {
            $time = (int)$row['srcTime'];
            $bed = (int)$row['srcBed'];
            $cell = Db::one('SELECT * FROM cell WHERE storeId = ? AND date = ? AND time = ? AND bed = ?', [$sid, $row['date'], $time, $bed]);
            // 元の枠に、いまは別の方の予約が入っていたら消さない（予約を動かしたあとなど）
            if ($cell && trim((string)$cell['text']) !== '' && Text::normalizeName(Karte::karteName(Karte::nameOfText((string)$cell['text']))) === Text::normalizeName((string)$row['name'])) {
                $step = Settings::global()['slotMinutes'];
                $next = Text::isTwoSlotName($cell['text']) ? Db::one('SELECT * FROM cell WHERE storeId = ? AND date = ? AND time = ? AND bed = ?', [$sid, $row['date'], $time + $step, $bed]) : null;
                $cont = ($next && Text::isContinuationText($next['text'])) ? $next : null;
                $by = (string)($ctx['session']['code'] ?? '');
                Db::transaction(function () use ($sid, $row, $time, $bed, $cell, $cont, $by) {
                    // 予約表の「消した入力を元に戻す」から戻せるように記録する
                    Db::exec('INSERT INTO cell_log (id, storeId, date, time, bed, `before`, `after`, byCode, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [Db::newId(), $sid, $row['date'], $time, $bed, trim((string)$cell['text']), '', $by, Time::nowJstDateTime()]);
                    Db::exec('DELETE FROM cell WHERE id = ?', [$cell['id']]);
                    if ($cont) Db::exec('DELETE FROM cell WHERE id = ?', [$cont['id']]);
                    if ($cell['reservationId']) Db::exec('UPDATE reservation SET status = ? WHERE id = ?', ['CANCELLED', $cell['reservationId']]);
                });
                $removed = true;
            }
        }
    }
    Db::exec('DELETE FROM karte WHERE id = ?', [$row['id']]);
    Http::json(['ok' => true, 'removedCell' => $removed]);
}

/**
 * スプレッドシートから貼り付けた行を取り込む（{ rows: [{ date, name, kind, … }], dryRun }）。
 * 同じ日付・同じ氏名の行があれば、貼り付けた内容で上書き（空の欄は今の値のまま）。なければ手で入れた行として足す。
 * dryRun のときは書き込まずに、行ごとの結果（new / update / error）だけ返す
 */
function karte_import(): never
{
    $ctx = Auth::context();
    $sid = $ctx['store']['id'];
    Http::requireJson();
    $b = Http::body();
    $list = $b['rows'] ?? null;
    if (!is_array($list) || count($list) === 0 || count($list) > 3000) Http::error('取り込む行がありません（一度に 3000 行まで）', 400);
    $dry = !empty($b['dryRun']);
    $result = [];
    $n = ['new' => 0, 'update' => 0, 'error' => 0];
    if (!$dry) Db::pdo()->beginTransaction();
    try {
        foreach ($list as $i => $r) {
            if (!is_array($r)) { $result[] = ['status' => 'error', 'error' => '行が読めません']; $n['error']++; continue; }
            // 空の欄は上書きしない（visits は日付が 1 つでもあるときだけ）
            $patch = array_filter($r, fn($v, $k) => in_array($k, Karte::EDITABLE, true) && $k !== 'nameOk' && $v !== null && $v !== '' && $k !== 'visits', ARRAY_FILTER_USE_BOTH);
            try {
                $set = Karte::cleanPatch($patch);
                unset($set['nameOk']);
                if (($set['date'] ?? '') === '') throw new HttpError(400, '日付がありません');
                if (($set['name'] ?? '') === '') throw new HttpError(400, '氏名がありません');
                if ($set['surnameLen'] === null) $set['surnameLen'] = Karte::surnameLenFromCards($sid, (string)$set['name']);
                $visits = is_array($r['visits'] ?? null) ? Karte::cleanPatch(['visits' => $r['visits']])['visits'] : null;
            } catch (HttpError $e) {
                $result[] = ['status' => 'error', 'error' => $e->getMessage()]; $n['error']++; continue;
            }
            $same = null;
            foreach (Db::all('SELECT id, name, visits FROM karte WHERE storeId = ? AND date = ?', [$sid, $set['date']]) as $x) {
                if (Text::isSameName($x['name'], $set['name'])) { $same = $x; break; }
            }
            $status = $same ? 'update' : 'new';
            $result[] = ['status' => $status];
            $n[$status]++;
            if ($dry) continue;
            if ($visits !== null) {
                // 回ごとに、貼り付けた側に日付があればその回を上書き
                $old = $same ? (json_decode((string)$same['visits'], true) ?: []) : [];
                $new = json_decode($visits, true);
                foreach ($new as $k => $v) if ($v['d'] === '' && isset($old[$k])) $new[$k] = $old[$k] + ['d' => '', 's' => '', 't' => ''];
                $set['visits'] = json_encode($new, JSON_UNESCAPED_UNICODE);
            }
            if ($same) {
                $cols = implode(', ', array_map(fn($k) => "`$k` = ?", array_keys($set)));
                Db::exec("UPDATE karte SET $cols, edited = 1 WHERE id = ?", array_merge(array_values($set), [$same['id']]));
            } else {
                $set += ['visits' => Karte::emptyVisits()];
                $id = Db::newId();
                $cols = implode(', ', array_map(fn($k) => "`$k`", array_keys($set)));
                Db::exec("INSERT INTO karte (id, storeId, auto, edited, $cols) VALUES (?, ?, 0, 1, " . implode(', ', array_fill(0, count($set), '?')) . ')', array_merge([$id, $sid], array_values($set)));
            }
        }
        if (!$dry) Db::pdo()->commit();
    } catch (Throwable $e) {
        if (!$dry && Db::pdo()->inTransaction()) Db::pdo()->rollBack();
        throw $e;
    }
    Http::json(['ok' => true, 'dryRun' => $dry, 'counts' => $n, 'rows' => $result]);
}

// ---------- 本部 ----------
/** 集計用の行（氏名は返さない）。期間 from〜to。本部は全店、店舗アカウントは自店舗だけ */
function hq_karte_get(): never
{
    $s = Auth::requireSession();
    $from = Http::query('from');
    $to = Http::query('to');
    if (!Time::isValidDate($from) || !Time::isValidDate($to) || $from > $to) Http::error('期間が正しくありません', 400);
    if ($s['role'] === 'hq') {
        $stores = Settings::storesInOrder('1 = 1', [], false);
        $rows = Db::all('SELECT storeId, date, kind, trig, trigDetail, staff, visits, karteNo, age, sex, symptomCat, symptom, treatment, stopped, transferred FROM karte WHERE date BETWEEN ? AND ?', [$from, $to]);
    } elseif ($s['role'] === 'mg') {
        // 管轄MG：全店を見られる（本部専用の店舗は除く）
        $stores = Settings::storesInOrder('hqOnly = 0', [], false);
        $ids = array_column($stores, 'id') ?: [''];
        $rows = Db::all('SELECT storeId, date, kind, trig, trigDetail, staff, visits, karteNo, age, sex, symptomCat, symptom, treatment, stopped, transferred FROM karte WHERE storeId IN (' . Db::inList($ids) . ') AND date BETWEEN ? AND ?', array_merge($ids, [$from, $to]));
    } else {
        $own = Auth::context()['store'];
        $stores = [['id' => $own['id'], 'code' => $own['code'], 'name' => $own['name'], 'active' => $own['active']]];
        $rows = Db::all('SELECT storeId, date, kind, trig, trigDetail, staff, visits, karteNo, age, sex, symptomCat, symptom, treatment, stopped, transferred FROM karte WHERE storeId = ? AND date BETWEEN ? AND ?', [$own['id'], $from, $to]);
    }
    $codeOf = array_column($stores, 'code', 'id');
    $out = [];
    foreach ($rows as $r) {
        $v = json_decode((string)$r['visits'], true) ?: [];
        $reached = [];
        for ($i = 0; $i < Karte::VISITS; $i++) $reached[] = !empty($v[$i]['d']);
        $missing = $r['karteNo'] === '' || $r['age'] === null || $r['sex'] === '' || $r['symptomCat'] === '' || $r['symptom'] === '' || $r['staff'] === '' || $r['treatment'] === ''
            || ($r['kind'] !== 'REVISIT' && ($r['trig'] === '' || (array_key_exists($r['trig'], Karte::DETAIL_FOR) && $r['trigDetail'] === '')));
        $out[] = ['store' => $codeOf[$r['storeId']] ?? '', 'date' => $r['date'], 'kind' => $r['kind'], 'trig' => $r['trig'], 'trigDetail' => $r['trigDetail'], 'staff' => $r['staff'], 'reached' => $reached, 'missing' => $missing, 'stopped' => (bool)(int)$r['stopped'], 'transferred' => (bool)(int)$r['transferred']];
    }
    $areas = $s['role'] !== 'hq' && $s['role'] !== 'mg' ? [] : array_map(fn($a) => ['id' => $a['id'], 'name' => $a['name'], 'stores' => array_values(array_filter(explode(',', $a['storeCodes'])))], Db::all('SELECT * FROM area ORDER BY sortOrder ASC, name ASC'));
    Http::json([
        'rows' => $out, 'areas' => $areas,
        'stores' => array_map(fn($s) => ['code' => $s['code'], 'name' => $s['name'], 'active' => (bool)$s['active']], $stores),
        'today' => Time::nowJst()['date'],
    ]);
}

function hq_karte_options_get(): never
{
    // 選択肢は店舗の集計画面でも使う（店舗にはエリア・店舗一覧は返さない）
    if (Auth::requireSession()['role'] !== 'hq') Http::json(['options' => Karte::options(), 'detailFor' => Karte::DETAIL_FOR, 'areas' => [], 'stores' => []]);
    $areas = array_map(fn($a) => ['id' => $a['id'], 'name' => $a['name'], 'stores' => array_values(array_filter(explode(',', $a['storeCodes'])))], Db::all('SELECT * FROM area ORDER BY sortOrder ASC, name ASC'));
    Http::json(['options' => Karte::options(), 'detailFor' => Karte::DETAIL_FOR, 'areas' => $areas, 'stores' => array_map(fn($s) => ['code' => $s['code'], 'name' => $s['name']], Settings::storesInOrder('1 = 1', [], false))]);
}

/** 選択肢の保存（{ category, labels: [...] }） */
function hq_karte_options_put(): never
{
    Auth::requireHq();
    Http::requireJson();
    $b = Http::body();
    Karte::setOptions((string)($b['category'] ?? ''), is_array($b['labels'] ?? null) ? $b['labels'] : []);
    Http::json(['ok' => true, 'options' => Karte::options()]);
}

/** エリアの保存（{ areas: [{ name, stores: [code...] }] } で全部置き換え） */
function hq_areas_put(): never
{
    Auth::requireHq();
    Http::requireJson();
    $areas = Http::body()['areas'] ?? null;
    if (!is_array($areas)) Http::error('bad request', 400);
    $codes = array_column(Db::all('SELECT code FROM store'), 'code');
    $oldNames = array_column(Db::all('SELECT id, name FROM area'), 'name', 'id');
    Db::transaction(function () use ($areas, $codes, $oldNames) {
        // エリアの名前を変えたら、管轄MG のアカウント・新自のお知らせ・自賠のお知らせの送り先のエリア名もそろえる（名前でつないでいるため）
        foreach (array_values($areas) as $a) {
            $id = (string)($a['id'] ?? '');
            $new = mb_substr(trim((string)($a['name'] ?? '')), 0, 30);
            $old = $oldNames[$id] ?? null;
            if ($old === null || $new === '' || $new === $old) continue;
            Db::exec("UPDATE admin_account SET area = ? WHERE role = 'mg' AND area = ?", [$new, $old]);
            foreach (['jibai_notify', 'line_target', 'accident_notify'] as $t) {
                if (Db::one('SELECT 1 AS x FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?', [$t, 'area'])) Db::exec("UPDATE `$t` SET area = ? WHERE area = ?", [$new, $old]);
            }
        }
        Db::exec('DELETE FROM area');
        foreach (array_values($areas) as $i => $a) {
            $name = mb_substr(trim((string)($a['name'] ?? '')), 0, 30);
            if ($name === '') continue;
            $stores = array_values(array_intersect($codes, is_array($a['stores'] ?? null) ? $a['stores'] : []));
            Db::exec('INSERT INTO area (id, name, storeCodes, sortOrder) VALUES (?, ?, ?, ?)', [Db::newId(), $name, implode(',', $stores), $i]);
        }
    });
    Http::json(['ok' => true]);
}

/** Excel 出力（その月の表をスプレッドシートと同じ並びで） */
function karte_export(): never
{
    $ctx = Auth::context();
    $store = $ctx['store'];
    $ym = Http::query('month');
    if (!Time::isValidMonth($ym)) Http::error('bad request', 400);
    Karte::sync($store, $ym);
    $dates = Time::datesOfMonth($ym);
    $rows = Db::all('SELECT * FROM karte WHERE storeId = ? AND date BETWEEN ? AND ? ORDER BY date ASC, srcTime IS NULL, srcTime ASC, createdAt ASC', [$store['id'], $dates[0], $dates[count($dates) - 1]]);
    $kindJa = ['NEW' => '新患', 'ACCIDENT' => '初自', 'THIRD' => '新三', 'REVISIT' => '再'];
    $md = fn(string $d) => $d === '' ? '' : (int)substr($d, 5, 2) . '/' . (int)substr($d, 8, 2);
    $header = ['日付', 'カルテNo', 'きっかけ／再来アクション', '内訳', '氏名', '新・再', '年齢', '性別', '症状カテゴリー', '症状', '担当', '施術内容'];
    for ($i = 2; $i <= 6; $i++) array_push($header, "{$i}回目 日付", "{$i}回目 担当", "{$i}回目 施術");
    array_push($header, '予後 中止', '予後 転院', 'アンケート');
    $out = [];
    foreach ($rows as $r) {
        $o = Karte::rowOut($r);
        $line = [$md($o['date']), $o['karteNo'], $o['trig'], $o['trigDetail'], $o['name'], $kindJa[$o['kind']] ?? $o['kind'], $o['age'] ?? '', $o['sex'], $o['symptomCat'], $o['symptom'], $o['staff'], $o['treatment']];
        foreach ($o['visits'] as $v) array_push($line, $md($v['d']), $v['s'], $v['t']);
        array_push($line, $o['stopped'] ? '✓' : '', $o['transferred'] ? '✓' : '', $o['survey'] ? '✓' : '');
        $out[] = $line;
    }
    $label = '新患継続率';
    $bytes = Xlsx::build($label, "{$store['name']}　{$label}　{$ym}　（出力 " . Time::nowJst()['date'] . '）', $header, $out);
    $jaName = rawurlencode("{$store['name']}_{$label}_{$ym}");
    header('Cache-Control: no-store');
    header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    header("Content-Disposition: attachment; filename=\"karte_{$store['code']}_{$ym}.xlsx\"; filename*=UTF-8''$jaName.xlsx");
    echo $bytes;
    exit;
}

// ---------- 新自・新三（全店）：本部・管轄MG（全店）が、事故日・事故内容を見るだけ ----------

/** 本部・管轄MG だけ（管轄MG も全店を見る） */
function accidents_auth(): void
{
    $s = Auth::requireSession();
    if ($s['role'] !== 'hq' && $s['role'] !== 'mg') throw new HttpError(403, 'forbidden');
}

/** その月の新自・新三と、前の月までの未入力（事故日・事故内容のどちらかが空） */
function accidents_rows(string $ym): array
{
    $first = $ym . '-01';
    $last = date('Y-m-t', strtotime($first . ' 00:00:00 UTC'));
    $stores = [];
    foreach (Settings::storesInOrder('active = 1 AND hqOnly = 0 AND jibaiOnly = 0', [], false) as $s) $stores[$s['id']] = $s;
    $areaOf = [];
    foreach (Db::all('SELECT name, storeCodes FROM area ORDER BY sortOrder ASC, name ASC') as $a) foreach (array_filter(explode(',', (string)$a['storeCodes'])) as $c) $areaOf[$c] ??= $a['name'];
    $out = [];
    foreach (Db::all("SELECT * FROM karte WHERE kind IN ('ACCIDENT', 'THIRD') AND (date BETWEEN ? AND ? OR (date < ? AND (accidentDate IS NULL OR accidentNote = ''))) ORDER BY date ASC, srcTime ASC", [$first, $last, $first]) as $k) {
        $s = $stores[$k['storeId']] ?? null;
        if (!$s) continue;
        $out[] = [
            'id' => $k['id'], 'store' => $s['code'], 'storeName' => $s['name'], 'area' => $areaOf[$s['code']] ?? '',
            'date' => $k['date'], 'kind' => $k['kind'], 'karteNo' => (string)$k['karteNo'], 'name' => (string)$k['name'],
            'trig' => (string)$k['trig'], 'trigDetail' => (string)$k['trigDetail'], 'staff' => (string)$k['staff'],
            'accidentDate' => $k['accidentDate'], 'accidentNote' => (string)($k['accidentNote'] ?? ''),
            'missing' => $k['accidentDate'] === null || trim((string)$k['accidentNote']) === '', 'earlier' => $k['date'] < $first,
        ];
    }
    return [$out, array_map(fn($s) => ['code' => $s['code'], 'name' => $s['name'], 'area' => $areaOf[$s['code']] ?? ''], array_values($stores))];
}

function hq_accidents(): never
{
    accidents_auth();
    $ym = Http::query('month', substr(Time::nowJst()['date'], 0, 7));
    if (!Time::isValidMonth($ym)) Http::error('bad month', 400);
    [$rows, $stores] = accidents_rows($ym);
    $areas = array_map(fn($a) => $a['name'], Db::all('SELECT name FROM area ORDER BY sortOrder ASC, name ASC'));
    Http::json(['month' => $ym, 'rows' => $rows, 'stores' => $stores, 'areas' => $areas]);
}

function hq_accidents_export(): never
{
    accidents_auth();
    $ym = Http::query('month', substr(Time::nowJst()['date'], 0, 7));
    if (!Time::isValidMonth($ym)) Http::error('bad month', 400);
    [$rows] = accidents_rows($ym);
    $list = array_map(fn($r) => [$r['area'], $r['storeName'], $r['date'], $r['kind'] === 'THIRD' ? '新三' : '新自', $r['karteNo'], $r['name'], $r['trig'] . ($r['trigDetail'] !== '' ? "（{$r['trigDetail']}）" : ''), $r['accidentDate'] ?? '', $r['accidentNote'], $r['staff'], $r['missing'] ? '未入力あり' : ''], $rows);
    $bytes = Xlsx::build('新自・新三', '新自・新三（全店）' . $ym . '　（出力 ' . Time::nowJst()['date'] . '。前の月までの未入力も含む）', ['エリア', '店舗', '初診日', '区分', 'カルテNo', '氏名', 'きっかけ', '事故日', '事故内容', '担当', '未入力'], $list);
    header('Cache-Control: no-store');
    header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    header("Content-Disposition: attachment; filename=\"accidents.xlsx\"; filename*=UTF-8''" . rawurlencode('新自新三_' . $ym) . '.xlsx');
    echo $bytes;
    exit;
}
