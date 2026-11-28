<?php
// 本部メニュー・MG メニューの「マーケ」：店舗ごとの入件（日ごと）・きっかけ別（店舗ごと）・URL・QR の月別・広告費の配分。
// 本部・管轄MG（全店を見られる。広告費の配分を入れられるのは、本部＝全店・管轄MG＝管轄の店舗）。患者様の氏名は返さない
declare(strict_types=1);

const MARKE_KINDS = ['NEW', 'REVISIT', 'ACCIDENT', 'THIRD', 'VISIT'];

/** 見られる店舗（稼働中・自賠だけの店舗は除く）とエリア */
function marke_scope(): array
{
    $s = Auth::requireSession();
    if ($s['role'] !== 'hq' && $s['role'] !== 'mg') Http::error('forbidden', 403);
    $stores = Settings::storesInOrder($s['role'] === 'hq' ? 'active = 1 AND jibaiOnly = 0' : 'active = 1 AND jibaiOnly = 0 AND hqOnly = 0', [], false);
    $areas = [];
    foreach (Db::all('SELECT name, storeCodes FROM area ORDER BY sortOrder ASC, name ASC') as $a) $areas[] = ['name' => $a['name'], 'stores' => array_values(array_filter(explode(',', (string)$a['storeCodes'])))];
    $areaOf = [];
    foreach ($areas as $a) foreach ($a['stores'] as $c) $areaOf[$c] ??= $a['name'];
    $mine = $s['role'] === 'mg' ? array_column(Auth::mgStores(), 'code') : null;
    return [$s, array_map(fn($st) => ['id' => $st['id'], 'code' => $st['code'], 'name' => $st['name'], 'area' => $areaOf[$st['code']] ?? '', 'canEdit' => Auth::canEditStore($s, $st), 'row' => $st], $stores), $areas, $mine];
}

function marke_out_stores(array $stores): array
{
    return array_map(fn($x) => ['code' => $x['code'], 'name' => $x['name'], 'area' => $x['area'], 'canEdit' => $x['canEdit']], $stores);
}

/** 店舗ごと・日ごとの数（kind：NEW＝新規（新患）・REVISIT＝再来・ACCIDENT＝新自・THIRD＝新三・VISIT＝来院数） */
function marke_daily_counts(array $stores, string $from, string $to, string $kind): array
{
    $out = [];
    if ($kind === 'VISIT') {
        foreach ($stores as $st) foreach (Churn::visits($st['row'], $from, $to) as $v) $out[$st['code']][$v['date']] = ($out[$st['code']][$v['date']] ?? 0) + 1;
        return $out;
    }
    $codeOf = array_column($stores, 'code', 'id');
    $ids = array_keys($codeOf) ?: [''];
    foreach (Db::all('SELECT storeId, date, COUNT(*) AS n FROM karte WHERE kind = ? AND date BETWEEN ? AND ? AND storeId IN (' . Db::inList($ids) . ') GROUP BY storeId, date', array_merge([$kind, $from, $to], $ids)) as $r) {
        $out[$codeOf[$r['storeId']]][$r['date']] = (int)$r['n'];
    }
    return $out;
}

/** ① 店舗ごとの入件（日ごと）（?month=YYYY-MM&kind=NEW|REVISIT|ACCIDENT|THIRD|VISIT） */
function marke_daily(): never
{
    [$s, $stores, $areas, $mine] = marke_scope();
    $ym = (string)Http::query('month', substr(Time::nowJst()['date'], 0, 7));
    if (!Time::isValidMonth($ym)) Http::error('月が正しくありません', 400);
    $kind = (string)Http::query('kind', 'NEW');
    if (!in_array($kind, MARKE_KINDS, true)) Http::error('bad request', 400);
    $d = Time::datesOfMonth($ym);
    $counts = marke_daily_counts($stores, $d[0], end($d), $kind);
    // 前年同月の合計
    $ly = (string)((int)substr($ym, 0, 4) - 1) . substr($ym, 4);
    $ld = Time::datesOfMonth($ly);
    $last = [];
    foreach (marke_daily_counts($stores, $ld[0], end($ld), $kind) as $code => $byDate) $last[$code] = array_sum($byDate);
    // 広告費の配分（その月）
    $budget = [];
    foreach (Db::all('SELECT s.code, b.amount FROM marke_budget b JOIN store s ON s.id = b.storeId WHERE b.ym = ?', [$ym]) as $r) $budget[$r['code']] = (float)$r['amount'];
    Http::json(['month' => $ym, 'kind' => $kind, 'dates' => $d, 'stores' => marke_out_stores($stores), 'areas' => $areas, 'mine' => $mine,
        'counts' => (object)array_map(fn($x) => (object)$x, $counts), 'lastYear' => (object)$last, 'budget' => (object)$budget, 'canBudget' => true]);
}

/** 広告費の配分を入れる（{ month, store, amount|null }）。本部＝全店、管轄MG＝管轄の店舗 */
function marke_budget_put(): never
{
    [$s, $stores] = marke_scope();
    Http::requireJson();
    $b = Http::body();
    $ym = (string)($b['month'] ?? '');
    if (!Time::isValidMonth($ym)) Http::error('月が正しくありません', 400);
    $st = null;
    foreach ($stores as $x) if ($x['code'] === (string)($b['store'] ?? '')) $st = $x;
    if (!$st) Http::error('店舗が見つかりません', 404);
    if (!$st['canEdit']) Http::error('管轄外の店舗の配分は入れられません', 403);
    $a = $b['amount'] ?? null;
    if ($a === null || $a === '') { Db::exec('DELETE FROM marke_budget WHERE storeId = ? AND ym = ?', [$st['id'], $ym]); Http::json(['ok' => true]); }
    if (!is_numeric($a) || (float)$a < 0 || (float)$a > 99999999) Http::error('数字で入れてください', 400);
    Db::exec('INSERT INTO marke_budget (storeId, ym, amount) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE amount = VALUES(amount)', [$st['id'], $ym, round((float)$a, 1)]);
    Http::json(['ok' => true]);
}

/** 期間：?period=month&month=YYYY-MM ／ ?period=fy&fy=2026（4 月〜翌 3 月）／ ?period=range&from&to */
function marke_period(): array
{
    $today = Time::nowJst()['date'];
    $p = (string)Http::query('period', 'month');
    if ($p === 'fy') {
        $fy = (int)Http::query('fy', (string)((int)substr($today, 5, 2) >= 4 ? (int)substr($today, 0, 4) : (int)substr($today, 0, 4) - 1));
        if ($fy < 2000 || $fy > 2100) Http::error('年度が正しくありません', 400);
        return ['fy', "$fy-04-01", ($fy + 1) . '-03-31', ['fy' => $fy]];
    }
    if ($p === 'range') {
        $from = (string)Http::query('from', ''); $to = (string)Http::query('to', '');
        if (!Time::isValidDate($from) || !Time::isValidDate($to) || $to < $from) Http::error('期間が正しくありません', 400);
        return ['range', $from, $to, []];
    }
    $ym = (string)Http::query('month', substr($today, 0, 7));
    if (!Time::isValidMonth($ym)) Http::error('月が正しくありません', 400);
    $d = Time::datesOfMonth($ym);
    return ['month', $d[0], end($d), ['month' => $ym]];
}

/** ② きっかけ別（店舗ごと）。新規（新患）。?withInjury=1 で新自・新三も含める */
function marke_trig(): never
{
    [$s, $stores, $areas, $mine] = marke_scope();
    [$p, $from, $to, $extra] = marke_period();
    $kinds = Http::query('withInjury') === '1' ? ['NEW', 'ACCIDENT', 'THIRD'] : ['NEW'];
    $codeOf = array_column($stores, 'code', 'id');
    $ids = array_keys($codeOf) ?: [''];
    $counts = []; $details = [];
    foreach (Db::all('SELECT storeId, trig, trigDetail, COUNT(*) AS n FROM karte WHERE kind IN (' . Db::inList($kinds) . ') AND date BETWEEN ? AND ? AND storeId IN (' . Db::inList($ids) . ') GROUP BY storeId, trig, trigDetail', array_merge($kinds, [$from, $to], $ids)) as $r) {
        $code = $codeOf[$r['storeId']];
        $t = (string)$r['trig'] !== '' ? (string)$r['trig'] : '（未入力）';
        $counts[$code][$t] = ($counts[$code][$t] ?? 0) + (int)$r['n'];
        if (trim((string)$r['trigDetail']) !== '') $details[$code][$t][(string)$r['trigDetail']] = ($details[$code][$t][(string)$r['trigDetail']] ?? 0) + (int)$r['n'];
    }
    $trigs = Karte::options()['trigger'] ?? [];
    foreach ($counts as $byT) foreach (array_keys($byT) as $t) if (!in_array($t, $trigs, true)) $trigs[] = $t;
    Http::json(['period' => $p, 'from' => $from, 'to' => $to] + $extra + ['stores' => marke_out_stores($stores), 'areas' => $areas, 'mine' => $mine, 'triggers' => $trigs,
        'counts' => (object)array_map(fn($x) => (object)$x, $counts), 'details' => (object)array_map(fn($x) => (object)array_map(fn($y) => (object)$y, $x), $details)]);
}

/** ③ URL・QR の月別（年度）。WEB 予約・新規（新患の WEB 予約）・来院・来院した新規。?store=CODE や ?area=名前 で絞る */
function marke_urls(): never
{
    [$s, $stores, $areas, $mine] = marke_scope();
    $today = Time::nowJst()['date'];
    $fy = (int)Http::query('fy', (string)((int)substr($today, 5, 2) >= 4 ? (int)substr($today, 0, 4) : (int)substr($today, 0, 4) - 1));
    if ($fy < 2000 || $fy > 2100) Http::error('年度が正しくありません', 400);
    $pick = $stores;
    if (($c = (string)Http::query('store', '')) !== '') $pick = array_values(array_filter($stores, fn($x) => $x['code'] === $c));
    elseif (($a = (string)Http::query('area', '')) !== '') $pick = array_values(array_filter($stores, fn($x) => $x['area'] === $a));
    $ids = array_column($pick, 'id') ?: [''];
    $urls = [];
    foreach (Db::all('SELECT id, label, trig, trigDetail, route FROM campaign WHERE code IS NOT NULL ORDER BY createdAt ASC, id ASC') as $c) $urls[$c['id']] = ['id' => $c['id'], 'label' => $c['label'], 'trig' => (string)$c['trig'], 'detail' => (string)$c['trigDetail'], 'months' => []];
    foreach (Db::all("SELECT date, kind, status, visited, campaign FROM reservation WHERE campaign IS NOT NULL AND campaign <> '' AND date BETWEEN ? AND ? AND storeId IN (" . Db::inList($ids) . ')', array_merge(["$fy-04-01", ($fy + 1) . '-03-31'], $ids)) as $r) {
        $cid = (string)(Campaign::decode($r['campaign'])['id'] ?? '');
        if (!isset($urls[$cid])) continue;
        $m = substr($r['date'], 0, 7);
        $isNew = in_array($r['kind'], ['NEW', 'ACCIDENT'], true);
        $o = &$urls[$cid]['months'][$m];
        $o ??= ['res' => 0, 'resNew' => 0, 'came' => 0, 'cameNew' => 0];
        if ($r['status'] !== 'CANCELLED') { $o['res']++; if ($isNew) $o['resNew']++; }
        if ((int)$r['visited']) { $o['came']++; if ($isNew) $o['cameNew']++; }
        unset($o);
    }
    $months = [];
    for ($i = 0; $i < 12; $i++) $months[] = substr(Time::addMonths("$fy-04-01", $i), 0, 7);
    Http::json(['fy' => $fy, 'months' => $months, 'stores' => marke_out_stores($stores), 'areas' => $areas, 'mine' => $mine, 'triggers' => Karte::options()['trigger'] ?? [],
        'urls' => array_values(array_map(fn($u) => array_merge($u, ['months' => (object)$u['months']]), $urls))]);
}
