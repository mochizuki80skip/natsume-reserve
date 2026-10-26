<?php
// 日報（店舗：その日の日報と手入力、本部：項目の設定、本部・管轄MG：月ごとの目標）
declare(strict_types=1);

/** その日の日報（店舗の画面。本部・管轄MG は切り替えた店舗） */
function report_get(): never
{
    $ctx = Auth::context();
    $date = Http::query('date');
    if (!$date || !Time::isValidDate($date)) $date = Time::nowJst()['date'];
    Http::json(Report::build($ctx['store'], Settings::global(), $date) + ['canEdit' => Auth::canEditStore($ctx['session'], $ctx['store'])]);
}

/** 手入力の欄を保存（{ date, item, value }。月に 1 回の文章は、その月の分として残す） */
function report_value_put(): never
{
    $ctx = Auth::context();
    Http::requireJson();
    $b = Http::body();
    $date = Http::date($b, 'date');
    $item = null;
    foreach (Report::items() as $it) if ($it['id'] === (string)($b['item'] ?? '')) $item = $it;
    if (!$item || !str_starts_with((string)$item['source'], 'manual:')) Http::error('この欄は入力できません', 400);
    $fmt = Report::fmtOf((string)$item['source']);
    $raw = trim((string)($b['value'] ?? ''));
    if ($fmt === 'time' && $raw !== '') {
        // 「1:05」「1.5」「65」（分）を分に直して残す
        if (preg_match('/^(\d{1,3})[:：](\d{1,2})$/u', mb_convert_kana($raw, 'a'), $m)) $raw = (string)((int)$m[1] * 60 + (int)$m[2]);
        elseif (preg_match('/^\d{1,4}$/', mb_convert_kana($raw, 'a'))) $raw = (string)(int)mb_convert_kana($raw, 'a');
        else Http::error('時間は「1:05」のように入れてください', 400);
    } elseif (($fmt === 'num' || $fmt === 'yen') && $raw !== '') {
        $raw = str_replace([',', '，', '¥', '￥'], '', mb_convert_kana($raw, 'a'));
        if (!preg_match('/^-?\d{1,10}$/', $raw)) Http::error('数字を入れてください', 400);
    } else {
        $raw = mb_substr($raw, 0, 500);
    }
    $key = $item['source'] === 'manual:monthtext' ? substr($date, 0, 7) : $date;
    if ($raw === '') Db::exec('DELETE FROM report_value WHERE storeId = ? AND date = ? AND itemId = ?', [$ctx['store']['id'], $key, $item['id']]);
    else Db::exec('REPLACE INTO report_value (storeId, date, itemId, value) VALUES (?, ?, ?, ?)', [$ctx['store']['id'], $key, $item['id'], $raw]);
    Http::json(['ok' => true]);
}

/** 本部：日報の項目と、選べる「どこから取るか」 */
function hq_report_items_get(): never
{
    Auth::requireHq();
    Http::json([
        'items' => Report::items(),
        'auto' => array_map(fn($k, $v) => ['key' => $k, 'label' => $v[0]], array_keys(Report::AUTO), Report::AUTO),
        'manual' => array_map(fn($k, $v) => ['key' => $k, 'label' => $v[0]], array_keys(Report::MANUAL), Report::MANUAL),
    ]);
}

/** 本部：日報の項目をまとめて保存（{ items: [{ id?, section, kind, label, source }] }。並びは送った順） */
function hq_report_items_put(): never
{
    Auth::requireHq();
    Http::requireJson();
    $list = Http::body()['items'] ?? null;
    if (!is_array($list) || count($list) > 200) Http::error('bad request', 400);
    $rows = [];
    foreach ($list as $it) {
        if (!is_array($it)) Http::error('bad request', 400);
        $id = (string)($it['id'] ?? '');
        if (!preg_match('/^[a-z0-9-]{1,40}$/', $id)) $id = 'i' . bin2hex(random_bytes(6));
        $kind = (string)($it['kind'] ?? 'value');
        if (!in_array($kind, Report::KINDS, true)) Http::error('項目の種類が正しくありません', 400);
        $label = mb_substr(trim((string)($it['label'] ?? '')), 0, 30);
        $section = mb_substr(trim((string)($it['section'] ?? '')), 0, 60);
        if ($label === '' && $kind !== 'staff') Http::error('項目の名前を入れてください', 400);
        $rows[$id] = ['id' => $id, 'section' => $section, 'kind' => $kind, 'label' => $label, 'source' => $kind === 'staff' ? 'staff' : (string)($it['source'] ?? '')];
    }
    $ids = array_keys($rows);
    foreach ($rows as $r) if (!Report::validSource($r['source'], $ids) || ($r['kind'] !== 'staff' && $r['source'] === 'staff')) Http::error("「{$r['label']}」のどこから取るかが正しくありません", 400);
    Db::transaction(function () use ($rows) {
        Db::exec('DELETE FROM report_item');
        $n = 0;
        foreach ($rows as $r) Db::exec('INSERT INTO report_item (id, sortOrder, section, kind, label, source) VALUES (?, ?, ?, ?, ?, ?)', [$r['id'], ++$n, $r['section'], $r['kind'], $r['label'], $r['source']]);
    });
    Http::json(['ok' => true]);
}

/** 目標を入れる数字（実績と目標をくらべる項目と「目標」の項目から） */
function report_target_sources(): array
{
    $out = [];
    foreach (Report::items() as $it) {
        $src = (string)$it['source'];
        if ($it['kind'] === 'perf') $out[$src] ??= $it['label'];
        if (str_starts_with($src, 'target:')) $out[substr($src, 7)] ??= $it['label'];
    }
    return $out;
}

/** 本部・管轄MG：月ごとの日報の目標（売上目標と同じ画面） */
function report_targets_get(): never
{
    $s = Auth::requireSession();
    if ($s['role'] !== 'hq' && $s['role'] !== 'mg') Http::error('forbidden', 403);
    $ym = mado_month_param(Http::query('month'));
    $srcs = report_target_sources();
    $rows = [];
    foreach (acct_stores($s) as $st) {
        $vals = [];
        foreach (Db::all('SELECT src, value FROM report_target WHERE storeId = ? AND ym = ?', [$st['id'], $ym]) as $r) $vals[$r['src']] = (float)$r['value'];
        $rows[] = ['code' => $st['code'], 'name' => $st['name'], 'canEdit' => Auth::canEditStore($s, $st), 'values' => (object)$vals];
    }
    Http::json(['month' => $ym, 'sources' => array_map(fn($k, $v) => ['src' => $k, 'label' => $v, 'fmt' => Report::fmtOf($k)], array_keys($srcs), $srcs), 'rows' => $rows]);
}

function report_target_put(): never
{
    $s = Auth::requireSession();
    if ($s['role'] !== 'hq' && $s['role'] !== 'mg') Http::error('forbidden', 403);
    Http::requireJson();
    $b = Http::body();
    $ym = (string)($b['month'] ?? '');
    $st = Settings::findStoreByCode((string)($b['store'] ?? ''));
    $src = (string)($b['src'] ?? '');
    if (!$st || !Time::isValidMonth($ym) || !isset(report_target_sources()[$src])) Http::error('bad request', 400);
    if (!Auth::canEditStore($s, $st)) Http::error('管轄外の店舗の目標は入れられません', 403);
    $v = $b['value'] ?? null;
    if ($v === null || $v === '') { Db::exec('DELETE FROM report_target WHERE storeId = ? AND ym = ? AND src = ?', [$st['id'], $ym, $src]); Http::json(['ok' => true]); }
    if (!is_numeric($v) || (float)$v < 0 || (float)$v > 999999999) Http::error('目標の数字が正しくありません', 400);
    Db::exec('REPLACE INTO report_target (storeId, ym, src, value) VALUES (?, ?, ?, ?)', [$st['id'], $ym, $src, round((float)$v, 1)]);
    Http::json(['ok' => true]);
}
