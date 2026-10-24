<?php
// 窓口集計 API（店舗：/api/admin/madoguchi…、経理・本部・管轄MG の一覧：/api/admin/acct/madoguchi…、物販の商品：/api/admin/hq/goods）
declare(strict_types=1);

/** 対象の店舗。?store= があれば（本部・経理・管轄MG）その店舗、なければ表示中の店舗 */
function mado_store(array $s, ?string $code): array
{
    if ($code !== null && $code !== '' && $s['role'] !== 'store') {
        $st = Db::one('SELECT * FROM store WHERE code = ?', [$code]);
        if (!$st || !Auth::canOpenStore($s, $st)) Http::error('not found', 404);
        return $st;
    }
    return Auth::context()['store'];
}

function mado_month_param(?string $v): string
{
    $ym = (string)$v;
    return Time::isValidMonth($ym) ? $ym : substr(Time::nowJst()['date'], 0, 7);
}

function mado_get(): never
{
    $s = Auth::requireSession();
    $store = mado_store($s, Http::query('store'));
    Http::json(Madoguchi::month($store, mado_month_param(Http::query('month'))) + [
        'canEdit' => $s['role'] !== 'acct', 'canCheck' => in_array($s['role'], ['hq', 'acct'], true), 'canTarget' => $s['role'] === 'hq',
        'today' => Time::nowJst()['date'],
    ]);
}

/** 日の入力（{ date, patch: { copay: 1200, goodsCount: { 商品id: 3 }, … } }）。経理は直せない */
function mado_day_put(): never
{
    $ctx = Auth::context();
    Http::requireJson();
    $b = Http::body();
    $date = Http::date($b, 'date');
    $patch = $b['patch'] ?? null;
    if (!is_array($patch) || !$patch) Http::error('bad request', 400);
    $sid = $ctx['store']['id'];
    $row = Db::one('SELECT vals FROM madoguchi_day WHERE storeId = ? AND date = ?', [$sid, $date]);
    $v = $row ? (json_decode((string)$row['vals'], true) ?: []) : [];
    foreach ($patch as $k => $val) {
        $c = Madoguchi::cleanDayValue((string)$k, $val);
        if ($k === 'goodsCount') {
            // 送られた商品だけ入れ替える（空は消す）
            $cur = $v['goodsCount'] ?? [];
            foreach ($val as $id => $n) { if ($n === null || $n === '') unset($cur[$id]); }
            $v['goodsCount'] = array_replace($cur, $c);
            if (!$v['goodsCount']) unset($v['goodsCount']);
        } elseif ($c === null || $c === '') unset($v[$k]);
        else $v[$k] = $c;
    }
    Db::exec('INSERT INTO madoguchi_day (storeId, date, vals) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE vals = VALUES(vals)', [$sid, $date, json_encode((object)$v, JSON_UNESCAPED_UNICODE)]);
    Madoguchi::touchMonth($sid, substr($date, 0, 7));
    $calc = Madoguchi::dayCalc($v);
    Http::json(['ok' => true, 'vals' => (object)$v, 'calc' => $calc]);
}

/** 月の欄（{ month, patch: { extra: { lateIns: 0 }, memo: '…', stockStart: { 商品id: 10 } } }） */
function mado_month_put(): never
{
    $ctx = Auth::context();
    Http::requireJson();
    $b = Http::body();
    $ym = (string)($b['month'] ?? '');
    if (!Time::isValidMonth($ym)) Http::error('bad request', 400);
    $patch = is_array($b['patch'] ?? null) ? $b['patch'] : [];
    $sid = $ctx['store']['id'];
    Madoguchi::touchMonth($sid, $ym);
    $m = Madoguchi::monthRow($sid, $ym);
    if (array_key_exists('extra', $patch)) {
        if (!is_array($patch['extra'])) Http::error('bad request', 400);
        $extra = $m['extra'] ? (json_decode((string)$m['extra'], true) ?: []) : [];
        foreach ($patch['extra'] as $k => $val) {
            if (!array_key_exists($k, Madoguchi::MONTH_KEYS)) Http::error('bad request', 400);
            if ($val === null || $val === '') { unset($extra[$k]); continue; }
            if (!is_numeric($val) || (int)$val != $val || abs((int)$val) > 999999999) Http::error('金額が正しくありません', 400);
            $extra[$k] = (int)$val;
        }
        Db::exec('UPDATE madoguchi_month SET extra = ? WHERE storeId = ? AND ym = ?', [json_encode((object)$extra), $sid, $ym]);
    }
    if (array_key_exists('memo', $patch)) Db::exec('UPDATE madoguchi_month SET memo = ? WHERE storeId = ? AND ym = ?', [mb_substr((string)$patch['memo'], 0, 3000), $sid, $ym]);
    if (array_key_exists('stockStart', $patch)) {
        $stock = $m['stockStart'] ? (json_decode((string)$m['stockStart'], true) ?: []) : [];
        foreach (Madoguchi::cleanDayValue('goodsCount', $patch['stockStart']) as $id => $n) $stock[$id] = $n;
        foreach ($patch['stockStart'] as $id => $n) if ($n === null || $n === '') unset($stock[$id]);
        Db::exec('UPDATE madoguchi_month SET stockStart = ? WHERE storeId = ? AND ym = ?', [json_encode((object)$stock), $sid, $ym]);
    }
    Http::json(['ok' => true]);
}

/** 返戻の行の追加・変更（{ month, special, id?, patch }） */
function mado_henrei_put(): never
{
    $ctx = Auth::context();
    Http::requireJson();
    $b = Http::body();
    $sid = $ctx['store']['id'];
    $patch = is_array($b['patch'] ?? null) ? $b['patch'] : [];
    $set = [];
    foreach ($patch as $k => $v) {
        if (isset(Madoguchi::HENREI_KEYS[$k])) $set[$k] = mb_substr(trim((string)$v), 0, Madoguchi::HENREI_KEYS[$k]);
        elseif ($k === 'amount' || $k === 'reamount') {
            if ($v === null || $v === '') $set[$k] = null;
            elseif (!is_numeric($v) || (int)$v != $v || abs((int)$v) > 99999999) Http::error('金額が正しくありません', 400);
            else $set[$k] = (int)$v;
        } else Http::error('bad request', 400);
    }
    $id = (string)($b['id'] ?? '');
    if ($id === '') {
        $ym = (string)($b['month'] ?? '');
        if (!Time::isValidMonth($ym)) Http::error('bad request', 400);
        $id = Db::newId();
        Db::exec('INSERT INTO madoguchi_henrei (id, storeId, ym, special, createdAt) VALUES (?, ?, ?, ?, ?)', [$id, $sid, $ym, !empty($b['special']) ? 1 : 0, Time::nowJstDateTime()]);
    }
    $row = Db::one('SELECT * FROM madoguchi_henrei WHERE id = ? AND storeId = ?', [$id, $sid]);
    if (!$row) Http::error('not found', 404);
    if ($set) Db::exec('UPDATE madoguchi_henrei SET ' . implode(', ', array_map(fn($k) => "`$k` = ?", array_keys($set))) . ' WHERE id = ?', array_merge(array_values($set), [$id]));
    Madoguchi::touchMonth($sid, $row['ym']);
    Http::json(['ok' => true, 'id' => $id]);
}

function mado_henrei_delete(): never
{
    $ctx = Auth::context();
    Http::requireJson();
    $row = Db::one('SELECT id, ym FROM madoguchi_henrei WHERE id = ? AND storeId = ?', [(string)(Http::body()['id'] ?? ''), $ctx['store']['id']]);
    if (!$row) Http::error('not found', 404);
    Db::exec('DELETE FROM madoguchi_henrei WHERE id = ?', [$row['id']]);
    Madoguchi::touchMonth($ctx['store']['id'], $row['ym']);
    Http::json(['ok' => true]);
}

/** 1 店舗・1 か月の Excel（月間窓口表・物販内訳・返戻を 1 枚に） */
function mado_export(): never
{
    $s = Auth::requireSession();
    $store = mado_store($s, Http::query('store'));
    $ym = mado_month_param(Http::query('month'));
    $x = Madoguchi::month($store, $ym);
    $wd = ['日', '月', '火', '水', '木', '金', '土'];
    $md = fn(string $d) => (int)substr($d, 5, 2) . '/' . (int)substr($d, 8, 2);
    $cols = ['copay', 'third', '=copayTotal', 'self', 'acu', '=selfAcu', '=total', 'goods', 'colCopay', 'colSelf', 'diffCopay', 'diffSelf', 'unknown', 'deposit', 'cert', '=match', 'mail', 'bank', 'insClaim', 'jibaiClaim'];
    $label = fn(string $k) => ['=copayTotal' => '一部負担金合計', '=selfAcu' => '自費＋鍼', '=total' => '合計', '=match' => '照合 合計'][$k] ?? Madoguchi::DAY_KEYS[$k];
    $header = array_merge(['日付', '曜日'], array_map($label, $cols));
    $rows = [];
    foreach ($x['days'] as $d) {
        $v = (array)$d['vals'];
        $line = [$md($d['date']), $wd[(int)date('w', strtotime($d['date']))] . ($d['closed'] ? '（休）' : '')];
        foreach ($cols as $k) $line[] = str_starts_with($k, '=') ? $d['calc'][substr($k, 1)] : ($v[$k] ?? null);
        $rows[] = $line;
    }
    $sumLine = ['計', ''];
    $taxLine = ['税抜', ''];
    foreach ($cols as $k) { $t = $x['sum'][ltrim($k, '=')]; $sumLine[] = $t; $taxLine[] = in_array($k, ['insClaim', 'jibaiClaim'], true) ? null : Madoguchi::exTax($t); }
    $rows[] = $sumLine;
    $rows[] = $taxLine;
    $rows[] = [];
    foreach (Madoguchi::MONTH_KEYS as $k => $l) $rows[] = [$l, null, ((array)$x['extra'])[$k] ?? null];
    $rows[] = ['売上目標', null, $x['target']];
    $rows[] = ['売上（窓口合計＋保険請求＋自賠責請求）', null, $x['sales']];
    $rows[] = ['自賠請求（速報）', null, $x['jibaiSokuhou']['total']];
    $rows[] = ['備考', null, $x['memo']];
    // 不明金の詳細（不明金がある日）
    foreach ($x['days'] as $d) {
        $v = (array)$d['vals'];
        if (!empty($v['unknown'])) $rows[] = ['不明金 ' . $md($d['date']), null, $v['unknown'], $v['unknownNote'] ?? ''];
    }
    $rows[] = [];
    // 物販内訳
    $rows[] = array_merge(['物販内訳', ''], array_column($x['goods'], 'name'), ['その他 金額', 'その他の内訳', '販売合計']);
    foreach ($x['days'] as $d) {
        $v = (array)$d['vals'];
        $gc = $v['goodsCount'] ?? [];
        if (!$gc && empty($v['otherAmt'])) continue;
        $rows[] = array_merge([$md($d['date']), ''], array_map(fn($g) => $gc[$g['id']] ?? null, $x['goods']), [$v['otherAmt'] ?? null, $v['otherNote'] ?? '', $d['calc']['goodsSales']]);
    }
    $gs = (array)$x['goodsSum'];
    $st = (array)$x['stockStart'];
    $rows[] = array_merge(['販売個数', ''], array_map(fn($g) => $gs[$g['id']] ?? 0, $x['goods']), [$x['sum']['otherAmt'], '', $x['sum']['goodsSales']]);
    $rows[] = array_merge(['販売価格', ''], array_column($x['goods'], 'price'));
    $rows[] = array_merge(['原価', ''], array_column($x['goods'], 'cost'));
    $rows[] = array_merge(['利益', ''], array_map(fn($g) => ($gs[$g['id']] ?? 0) * ($g['price'] - $g['cost']), $x['goods']));
    $rows[] = array_merge(['月初の在庫', ''], array_map(fn($g) => $st[$g['id']] ?? null, $x['goods']));
    $rows[] = array_merge(['月末の在庫', ''], array_map(fn($g) => isset($st[$g['id']]) ? $st[$g['id']] - ($gs[$g['id']] ?? 0) : null, $x['goods']));
    $rows[] = [];
    // 返戻
    foreach ([false => '返戻', true => '特殊返戻'] as $sp => $title) {
        $rows[] = [$title, '', '施術月', '請求月', '患者様名', '本人／家族', '保険者', '保険者コード', '請求額', '再請求額', '返戻場所', '取／再提出／保', '理由'];
        foreach (array_filter($x['henrei'], fn($r) => $r['special'] === (bool)$sp) as $r) {
            $rows[] = ['', '', $r['treatYm'], $r['claimMonth'], $r['patient'], $r['relation'], $r['insurer'], $r['insurerCode'], $r['amount'], $r['reamount'], $r['place'], $r['action'], $r['reason']];
        }
    }
    $title = "{$store['name']}　月間窓口表　{$ym}　（出力 " . Time::nowJst()['date'] . '）';
    $bytes = Xlsx::build('月間窓口表', $title, $header, $rows);
    $jaName = rawurlencode("月間窓口表_{$store['name']}_{$ym}");
    header('Cache-Control: no-store');
    header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    header("Content-Disposition: attachment; filename=\"madoguchi_{$store['code']}_{$ym}.xlsx\"; filename*=UTF-8''$jaName.xlsx");
    echo $bytes;
    exit;
}

// ---------- 経理・本部・管轄MG の一覧 ----------
function acct_stores(array $s): array
{
    return $s['role'] === 'mg' ? Auth::mgStores() : Settings::storesInOrder('hqOnly = 0', [], false);
}

function acct_mado_get(): never
{
    $s = Auth::requireSession();
    if ($s['role'] === 'store') Http::error('forbidden', 403);
    $ym = mado_month_param(Http::query('month'));
    Http::json([
        'month' => $ym, 'rows' => array_map(fn($st) => Madoguchi::summary($st, $ym), acct_stores($s)),
        'canCheck' => in_array($s['role'], ['hq', 'acct'], true), 'canTarget' => $s['role'] === 'hq',
    ]);
}

/** 経理確認（{ store, month, checked }）。経理・本部だけ */
function acct_mado_check(): never
{
    $s = Auth::requireHqOrAcct();
    Http::requireJson();
    $b = Http::body();
    $ym = (string)($b['month'] ?? '');
    $st = Settings::findStoreByCode((string)($b['store'] ?? ''));
    if (!$st || !Time::isValidMonth($ym)) Http::error('bad request', 400);
    if (!Madoguchi::monthRow($st['id'], $ym)) Db::exec('INSERT INTO madoguchi_month (storeId, ym) VALUES (?, ?)', [$st['id'], $ym]);
    $checked = Http::bool($b, 'checked');
    $by = (string)(Auth::account()['name'] ?? '') ?: $s['code'];
    Db::exec('UPDATE madoguchi_month SET checkedAt = ?, checkedBy = ?, editedAt = NULL WHERE storeId = ? AND ym = ?', [$checked ? Time::nowJstDateTime() : null, $checked ? mb_substr($by, 0, 60) : '', $st['id'], $ym]);
    Http::json(['ok' => true]);
}

/** 売上目標（{ store, month, target }）。本部だけ */
function acct_mado_target(): never
{
    Auth::requireHq();
    Http::requireJson();
    $b = Http::body();
    $ym = (string)($b['month'] ?? '');
    $st = Settings::findStoreByCode((string)($b['store'] ?? ''));
    if (!$st || !Time::isValidMonth($ym)) Http::error('bad request', 400);
    $t = $b['target'] ?? null;
    if ($t !== null && $t !== '' && (!is_numeric($t) || (int)$t != $t || (int)$t < 0 || (int)$t > 999999999)) Http::error('目標の金額が正しくありません', 400);
    if (!Madoguchi::monthRow($st['id'], $ym)) Db::exec('INSERT INTO madoguchi_month (storeId, ym) VALUES (?, ?)', [$st['id'], $ym]);
    Db::exec('UPDATE madoguchi_month SET target = ? WHERE storeId = ? AND ym = ?', [$t === null || $t === '' ? null : (int)$t, $st['id'], $ym]);
    Http::json(['ok' => true]);
}

/** 一覧の Excel（店舗ごとに 1 行） */
function acct_mado_export(): never
{
    $s = Auth::requireSession();
    if ($s['role'] === 'store') Http::error('forbidden', 403);
    $ym = mado_month_param(Http::query('month'));
    $header = ['店舗', '売上目標', '売上', '達成率', '窓口合計', '物販（窓口表）', '物販内訳 販売合計', '保険請求', '自賠責請求（日々）', '自賠請求（速報）', '合わない日', '返戻 件数', '返戻 請求額', '経理確認'];
    $rows = [];
    foreach (acct_stores($s) as $st) {
        $r = Madoguchi::summary($st, $ym);
        $rows[] = [$r['name'], $r['target'], $r['sales'], $r['target'] ? round($r['sales'] / $r['target'] * 100) . '%' : '', $r['total'], $r['goods'], $r['goodsSales'], $r['insClaim'], $r['jibaiClaim'], $r['jibaiSokuhou'], $r['mismatchDays'], $r['henreiCount'], $r['henreiTotal'],
            $r['checkedAt'] ? ('済 ' . substr($r['checkedAt'], 0, 16) . ' ' . $r['checkedBy'] . ($r['editedAfterCheck'] ? '（確認後に変更あり）' : '')) : '未'];
    }
    $bytes = Xlsx::build('窓口集計', "窓口集計（全店）　{$ym}　（出力 " . Time::nowJst()['date'] . '）', $header, $rows);
    $jaName = rawurlencode("窓口集計_全店_{$ym}");
    header('Cache-Control: no-store');
    header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    header("Content-Disposition: attachment; filename=\"madoguchi_all_{$ym}.xlsx\"; filename*=UTF-8''$jaName.xlsx");
    echo $bytes;
    exit;
}

// ---------- 物販の商品（本部） ----------
function hq_goods_get(): never
{
    Auth::requireHq();
    Http::json(['rows' => array_map(fn($g) => ['id' => $g['id'], 'name' => $g['name'], 'price' => (int)$g['price'], 'cost' => (int)$g['cost'], 'active' => (bool)$g['active']],
        Db::all('SELECT * FROM goods_item ORDER BY active DESC, sortOrder ASC, createdAt ASC'))]);
}

/** 追加（{ name, price, cost }）・変更（{ id, name?, price?, cost?, active?, move? }） */
function hq_goods_put(): never
{
    Auth::requireHq();
    Http::requireJson();
    $b = Http::body();
    $int = function (string $k) use ($b): ?int {
        if (!array_key_exists($k, $b)) return null;
        $v = $b[$k];
        if (!is_numeric($v) || (int)$v != $v || (int)$v < 0 || (int)$v > 9999999) Http::error('金額が正しくありません', 400);
        return (int)$v;
    };
    $name = array_key_exists('name', $b) ? mb_substr(trim((string)$b['name']), 0, 40) : null;
    if ($name === '') Http::error('商品名を入れてください', 400);
    $id = (string)($b['id'] ?? '');
    if ($id === '') {
        if ($name === null) Http::error('商品名を入れてください', 400);
        $max = (int)(Db::one('SELECT MAX(sortOrder) AS m FROM goods_item')['m'] ?? 0);
        Db::exec('INSERT INTO goods_item (id, name, price, cost, sortOrder, active, createdAt) VALUES (?, ?, ?, ?, ?, 1, ?)', [Db::newId(), $name, $int('price') ?? 0, $int('cost') ?? 0, $max + 1, Time::nowJstDateTime()]);
        Http::json(['ok' => true]);
    }
    $g = Db::one('SELECT * FROM goods_item WHERE id = ?', [$id]);
    if (!$g) Http::error('not found', 404);
    $set = [];
    if ($name !== null) $set['name'] = $name;
    foreach (['price', 'cost'] as $k) { $v = $int($k); if ($v !== null) $set[$k] = $v; }
    if (array_key_exists('active', $b)) $set['active'] = Http::bool($b, 'active') ? 1 : 0;
    if ($set) Db::exec('UPDATE goods_item SET ' . implode(', ', array_map(fn($k) => "`$k` = ?", array_keys($set))) . ' WHERE id = ?', array_merge(array_values($set), [$id]));
    $move = (int)($b['move'] ?? 0);
    if ($move === 1 || $move === -1) {
        $list = Db::all('SELECT id FROM goods_item WHERE active = 1 ORDER BY sortOrder ASC, createdAt ASC');
        $ids = array_column($list, 'id');
        $i = array_search($id, $ids, true);
        if ($i !== false && isset($ids[$i + $move])) { [$ids[$i], $ids[$i + $move]] = [$ids[$i + $move], $ids[$i]]; }
        foreach ($ids as $n => $gid) Db::exec('UPDATE goods_item SET sortOrder = ? WHERE id = ?', [$n + 1, $gid]);
    }
    Http::json(['ok' => true]);
}

// ---------- 人員の過不足（本部・管轄MG）：人員基準と、その月の在籍人数（施術者・受付）を店舗ごとに ----------
function staffing_get(): never
{
    $s = Auth::requireSession();
    if ($s['role'] !== 'hq' && $s['role'] !== 'mg') Http::error('forbidden', 403);
    $ym = mado_month_param(Http::query('month'));
    $dates = Time::datesOfMonth($ym);
    $first = $dates[0];
    $last = end($dates);
    $rows = [];
    foreach (acct_stores($s) as $st) {
        $members = Db::all('SELECT name, role, active, startDate, endDate, joinType FROM staff_member WHERE storeId = ? ORDER BY sortOrder ASC', [$st['id']]);
        $out = ['code' => $st['code'], 'name' => $st['name'], 'area' => $st['area'] ?? '', 'changes' => [], 'paused' => []];
        foreach (['THERAPIST' => 'therapist', 'RECEPTION' => 'reception'] as $role => $k) {
            $act = array_filter($members, fn($m) => $m['role'] === $role && (int)$m['active'] === 1);
            $count = fn(string $d) => count(array_filter($act, fn($m) => Settings::inPeriod($m, $d)));
            // 月の中でいちばん少ない日の人数（月の途中で辞める・入る人がいても「ひと月を通して」いるか）
            $min = PHP_INT_MAX;
            foreach ($dates as $d) $min = min($min, $count($d));
            $std = $st[$k === 'therapist' ? 'stdTherapists' : 'stdReception'];
            $out[$k] = ['std' => $std === null ? null : (int)$std, 'start' => $count($first), 'end' => $count($last), 'min' => $min];
            foreach ($act as $m) {
                if ($m['startDate'] && $m['startDate'] >= $first && $m['startDate'] <= $last) $out['changes'][] = ['name' => $m['name'], 'role' => $k, 'in' => true, 'date' => $m['startDate'], 'joinType' => $m['joinType']];
                if ($m['endDate'] && $m['endDate'] >= $first && $m['endDate'] <= $last) $out['changes'][] = ['name' => $m['name'], 'role' => $k, 'in' => false, 'date' => $m['endDate'], 'joinType' => null];
            }
            foreach ($members as $m) if ($m['role'] === $role && (int)$m['active'] === 0 && Settings::inPeriod($m, $last)) $out['paused'][] = ['name' => $m['name'], 'role' => $k];
        }
        usort($out['changes'], fn($a, $b) => strcmp($a['date'], $b['date']));
        $rows[] = $out;
    }
    Http::json(['month' => $ym, 'rows' => $rows]);
}

/** 人員基準（{ store, therapists, reception }）。本部・管轄MG（管轄の店舗だけ） */
function staffing_std_put(): never
{
    $s = Auth::requireSession();
    if ($s['role'] !== 'hq' && $s['role'] !== 'mg') Http::error('forbidden', 403);
    Http::requireJson();
    $b = Http::body();
    $st = Settings::findStoreByCode((string)($b['store'] ?? ''));
    if (!$st || !Auth::canOpenStore($s, $st)) Http::error('not found', 404);
    $set = [];
    foreach (['therapists' => 'stdTherapists', 'reception' => 'stdReception'] as $k => $col) {
        if (!array_key_exists($k, $b)) continue;
        $v = $b[$k];
        if ($v === null || $v === '') { $set[$col] = null; continue; }
        if (!is_numeric($v) || (int)$v != $v || (int)$v < 0 || (int)$v > 50) Http::error('人数が正しくありません', 400);
        $set[$col] = (int)$v;
    }
    if ($set) Db::exec('UPDATE store SET ' . implode(', ', array_map(fn($c) => "`$c` = ?", array_keys($set))) . ' WHERE id = ?', array_merge(array_values($set), [$st['id']]));
    Http::json(['ok' => true]);
}
