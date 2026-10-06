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
    $row = Db::one('SELECT id, auto FROM karte WHERE id = ? AND storeId = ?', [(string)(Http::body()['id'] ?? ''), $ctx['store']['id']]);
    if (!$row) Http::error('not found', 404);
    if ((int)$row['auto']) Http::error('予約表から自動で入った行です。予約表の来院チェックを外すと消えます', 400);
    Db::exec('DELETE FROM karte WHERE id = ?', [$row['id']]);
    Http::json(['ok' => true]);
}

// ---------- 本部 ----------
/** 集計用の行（氏名は返さない）。期間 from〜to、全店 */
function hq_karte_get(): never
{
    Auth::requireHq();
    $from = Http::query('from');
    $to = Http::query('to');
    if (!Time::isValidDate($from) || !Time::isValidDate($to) || $from > $to) Http::error('期間が正しくありません', 400);
    $stores = Db::all('SELECT id, code, name, active FROM store ORDER BY code ASC');
    $codeOf = array_column($stores, 'code', 'id');
    $rows = Db::all('SELECT storeId, date, kind, trig, trigDetail, staff, visits, karteNo, age, sex, symptomCat, symptom, treatment FROM karte WHERE date BETWEEN ? AND ?', [$from, $to]);
    $out = [];
    foreach ($rows as $r) {
        $v = json_decode((string)$r['visits'], true) ?: [];
        $reached = [];
        for ($i = 0; $i < Karte::VISITS; $i++) $reached[] = !empty($v[$i]['d']);
        $missing = $r['karteNo'] === '' || $r['age'] === null || $r['sex'] === '' || $r['symptomCat'] === '' || $r['symptom'] === '' || $r['staff'] === '' || $r['treatment'] === ''
            || ($r['kind'] !== 'REVISIT' && ($r['trig'] === '' || (array_key_exists($r['trig'], Karte::DETAIL_FOR) && $r['trigDetail'] === '')));
        $out[] = ['store' => $codeOf[$r['storeId']] ?? '', 'date' => $r['date'], 'kind' => $r['kind'], 'trig' => $r['trig'], 'trigDetail' => $r['trigDetail'], 'staff' => $r['staff'], 'reached' => $reached, 'missing' => $missing];
    }
    $areas = array_map(fn($a) => ['id' => $a['id'], 'name' => $a['name'], 'stores' => array_values(array_filter(explode(',', $a['storeCodes'])))], Db::all('SELECT * FROM area ORDER BY sortOrder ASC, name ASC'));
    Http::json([
        'rows' => $out, 'areas' => $areas,
        'stores' => array_map(fn($s) => ['code' => $s['code'], 'name' => $s['name'], 'active' => (bool)$s['active']], $stores),
        'today' => Time::nowJst()['date'],
    ]);
}

function hq_karte_options_get(): never
{
    Auth::requireHq();
    $areas = array_map(fn($a) => ['id' => $a['id'], 'name' => $a['name'], 'stores' => array_values(array_filter(explode(',', $a['storeCodes'])))], Db::all('SELECT * FROM area ORDER BY sortOrder ASC, name ASC'));
    Http::json(['options' => Karte::options(), 'detailFor' => Karte::DETAIL_FOR, 'areas' => $areas, 'stores' => array_map(fn($s) => ['code' => $s['code'], 'name' => $s['name']], Db::all('SELECT code, name FROM store ORDER BY code ASC'))]);
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
    Db::transaction(function () use ($areas, $codes) {
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
    $kindJa = ['NEW' => '新患', 'ACCIDENT' => '初自', 'REVISIT' => '再'];
    $md = fn(string $d) => $d === '' ? '' : (int)substr($d, 5, 2) . '/' . (int)substr($d, 8, 2);
    $header = ['日付', 'カルテNo', 'きっかけ／再来アクション', '内訳', '氏名', '新・再', '年齢', '性別', '症状カテゴリー', '症状', '担当', '施術内容'];
    for ($i = 2; $i <= 6; $i++) array_push($header, "{$i}回目 日付", "{$i}回目 担当", "{$i}回目 施術");
    $out = [];
    foreach ($rows as $r) {
        $o = Karte::rowOut($r);
        $line = [$md($o['date']), $o['karteNo'], $o['trig'], $o['trigDetail'], $o['name'], $kindJa[$o['kind']] ?? $o['kind'], $o['age'] ?? '', $o['sex'], $o['symptomCat'], $o['symptom'], $o['staff'], $o['treatment']];
        foreach ($o['visits'] as $v) array_push($line, $md($v['d']), $v['s'], $v['t']);
        $out[] = $line;
    }
    $label = '初回カルテ集計';
    $bytes = Xlsx::build($label, "{$store['name']}　{$label}　{$ym}　（出力 " . Time::nowJst()['date'] . '）', $header, $out);
    $jaName = rawurlencode("{$store['name']}_{$label}_{$ym}");
    header('Cache-Control: no-store');
    header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    header("Content-Disposition: attachment; filename=\"karte_{$store['code']}_{$ym}.xlsx\"; filename*=UTF-8''$jaName.xlsx");
    echo $bytes;
    exit;
}
