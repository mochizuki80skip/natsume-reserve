<?php
// 交通事故患者様の終了報告（Google フォーム「事故患者終了報告」の代わり）。店舗が何件でも入れて「申請」。
// 本部・管轄MG は月・年ごとに全店をまとめて見る（Excel も）。店舗は自店舗の分を見る。申請した方は 2ヶ月経過のリストから外す
declare(strict_types=1);

const AE_SEX = ['男性', '女性'];
const AE_PARTS = ['首', '肩', '背中', '腕', '手', '腰', '股関節', '足'];
const AE_PHOTO = ['撮影済み（顔出しOK）', '撮影済み（顔出しNG）', '撮影不可'];
const AE_SURVEY = ['回答済み', '不可'];

/** 見られる店舗（店舗＝自店舗、本部・管轄MG＝全店） */
function ae_stores(array $s): array
{
    if ($s['role'] === 'store') { $st = Auth::context()['store']; return [$st['id'] => $st]; }
    if ($s['role'] !== 'hq' && $s['role'] !== 'mg') throw new HttpError(403, 'forbidden');
    $out = [];
    foreach (Settings::storesInOrder($s['role'] === 'hq' ? '1 = 1' : 'hqOnly = 0', [], false) as $st) $out[$st['id']] = $st;
    return $out;
}

/** 1 件を確かめて整える（必須はフォームと同じ） */
function ae_clean(array $r, int $no): array
{
    $t = fn(string $k, int $max) => mb_substr(trim((string)($r[$k] ?? '')), 0, $max);
    $miss = [];
    $out = [
        'karteId' => preg_match('/^[0-9a-f]{24,32}$/', (string)($r['karteId'] ?? '')) ? (string)$r['karteId'] : null,
        'patientName' => $t('patientName', 40), 'sex' => $t('sex', 4), 'age' => $t('age', 20), 'job' => $t('job', 60),
        'accidentDate' => (string)($r['accidentDate'] ?? ''), 'place' => $t('place', 200), 'mechanism' => $t('mechanism', 2000),
        'fault' => $t('fault', 60), 'period' => $t('period', 30), 'photo' => $t('photo', 30), 'survey' => $t('survey', 100), 'note' => $t('note', 2000),
    ];
    $parts = [];
    foreach ((array)($r['parts'] ?? []) as $p) { $p = mb_substr(trim((string)$p), 0, 30); if ($p !== '' && !in_array($p, $parts, true)) $parts[] = $p; }
    $out['parts'] = implode('・', array_slice($parts, 0, 10));
    $months = [];
    for ($i = 0; $i < 12; $i++) $months[] = mb_substr(trim((string)(($r['months'] ?? [])[$i] ?? '')), 0, 1000);
    $out['months'] = $months;
    if (!in_array($out['sex'], AE_SEX, true)) $out['sex'] = '';
    if (!Time::isValidDate($out['accidentDate'])) $out['accidentDate'] = '';
    if (!in_array($out['photo'], AE_PHOTO, true)) $out['photo'] = '';
    foreach (['patientName' => '患者氏名', 'sex' => '性別', 'age' => '年齢', 'job' => '職業', 'accidentDate' => '事故日', 'place' => '事故発生地域', 'mechanism' => '発生機序', 'fault' => '過失割合', 'parts' => '診断部位', 'period' => '通院期間', 'photo' => '写真', 'survey' => 'アンケート'] as $k => $label) if ($out[$k] === '') $miss[] = $label;
    if ($months[0] === '') $miss[] = '1ヶ月目の施術内容';
    if ($miss) throw new HttpError(400, "{$no}件目（" . ($out['patientName'] ?: '氏名なし') . "）の未入力：" . implode('・', $miss));
    return $out;
}

/** 申請（{ reports: [...] }）。全部そろっているときだけ、まとめて入れる */
function ae_post(): never
{
    $ctx = Auth::context();
    Http::requireJson();
    $list = Http::body()['reports'] ?? null;
    if (!is_array($list) || !$list || count($list) > 30) Http::error('報告がありません', 400);
    $clean = [];
    foreach (array_values($list) as $i => $r) $clean[] = ae_clean(is_array($r) ? $r : [], $i + 1);
    $sid = $ctx['store']['id'];
    $now = Time::nowJstDateTime();
    $ids = [];
    Db::transaction(function () use ($clean, $sid, $now, $ctx, &$ids) {
        foreach ($clean as $c) {
            $id = Db::newId();
            Db::exec('INSERT INTO accident_end (id, storeId, karteId, patientName, sex, age, job, accidentDate, place, mechanism, fault, parts, period, months, photo, survey, note, byCode, submittedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [$id, $sid, $c['karteId'], $c['patientName'], $c['sex'], $c['age'], $c['job'], $c['accidentDate'], $c['place'], $c['mechanism'], $c['fault'], $c['parts'], $c['period'], json_encode($c['months'], JSON_UNESCAPED_UNICODE), $c['photo'], $c['survey'], $c['note'], (string)($ctx['session']['code'] ?? ''), $now]);
            // 申請した方は、2ヶ月経過のリストから外す（終了）
            if ($c['karteId']) Db::exec("UPDATE karte SET accidentStatus = 'END', accidentStatusAt = ? WHERE id = ? AND storeId = ? AND kind IN ('ACCIDENT', 'THIRD')", [$now, $c['karteId'], $sid]);
            $ids[] = $id;
        }
    });
    Http::json(['ok' => true, 'count' => count($ids)]);
}

/** 期間（unit=month&period=YYYY-MM／unit=year&period=YYYY） */
function ae_range(): array
{
    $unit = Http::query('unit', 'month') === 'year' ? 'year' : 'month';
    $period = (string)Http::query('period', '');
    $today = Time::nowJst()['date'];
    if ($unit === 'year') {
        if (!preg_match('/^\d{4}$/', $period)) $period = substr($today, 0, 4);
        return [$unit, $period, "$period-01-01 00:00:00", "$period-12-31 23:59:59"];
    }
    if (!Time::isValidMonth($period)) $period = substr($today, 0, 7);
    return [$unit, $period, "$period-01 00:00:00", date('Y-m-t', strtotime("$period-01")) . ' 23:59:59'];
}

function ae_rows(array $s): array
{
    $stores = ae_stores($s);
    [$unit, $period, $from, $to] = ae_range();
    $areaOf = [];
    foreach (Db::all('SELECT name, storeCodes FROM area ORDER BY sortOrder ASC, name ASC') as $a) foreach (array_filter(explode(',', (string)$a['storeCodes'])) as $c) $areaOf[$c] ??= $a['name'];
    $rows = [];
    foreach (Db::all('SELECT * FROM accident_end WHERE storeId IN (' . Db::inList(array_keys($stores) ?: ['']) . ') AND submittedAt BETWEEN ? AND ? ORDER BY submittedAt ASC', array_merge(array_keys($stores) ?: [''], [$from, $to])) as $r) {
        $st = $stores[$r['storeId']];
        $rows[] = [
            'id' => $r['id'], 'store' => $st['code'], 'storeName' => $st['name'], 'area' => $areaOf[$st['code']] ?? '',
            'submittedAt' => substr((string)$r['submittedAt'], 0, 16), 'patientName' => $r['patientName'], 'sex' => $r['sex'], 'age' => $r['age'], 'job' => $r['job'],
            'accidentDate' => $r['accidentDate'], 'place' => $r['place'], 'mechanism' => (string)$r['mechanism'], 'fault' => $r['fault'], 'parts' => $r['parts'], 'period' => $r['period'],
            'months' => json_decode((string)$r['months'], true) ?: [], 'photo' => $r['photo'], 'survey' => $r['survey'], 'note' => (string)$r['note'],
            'canDelete' => Auth::canEditStore($s, $st),
        ];
    }
    return [$unit, $period, $rows, $stores, $areaOf];
}

function ae_get(): never
{
    $s = Auth::requireSession();
    [$unit, $period, $rows, $stores, $areaOf] = ae_rows($s);
    Http::json(['unit' => $unit, 'period' => $period, 'rows' => $rows,
        'stores' => array_map(fn($st) => ['code' => $st['code'], 'name' => $st['name'], 'area' => $areaOf[$st['code']] ?? ''], array_values($stores)),
        'options' => ['sex' => AE_SEX, 'parts' => AE_PARTS, 'photo' => AE_PHOTO, 'survey' => AE_SURVEY]]);
}

function ae_export(): never
{
    $s = Auth::requireSession();
    [$unit, $period, $rows] = ae_rows($s);
    $header = ['申請日時', 'エリア', '店舗名', '患者氏名', '性別', '年齢', '職業', '事故日', '事故発生地域', '発生機序', '過失割合', '診断部位', '通院期間'];
    for ($i = 1; $i <= 12; $i++) $header[] = "{$i}ヶ月目";
    array_push($header, '写真', 'アンケート', '備考欄');
    $out = array_map(fn($r) => array_merge([$r['submittedAt'], $r['area'], $r['storeName'], $r['patientName'], $r['sex'], $r['age'], $r['job'], $r['accidentDate'], $r['place'], $r['mechanism'], $r['fault'], $r['parts'], $r['period']],
        array_map(fn($i) => (string)($r['months'][$i] ?? ''), range(0, 11)), [$r['photo'], $r['survey'], $r['note']]), $rows);
    $label = $unit === 'year' ? "{$period}年" : (int)substr($period, 0, 4) . '年' . (int)substr($period, 5) . '月';
    $bytes = Xlsx::build('終了報告', "事故患者 終了報告　{$label}　（出力 " . Time::nowJst()['date'] . '）', $header, $out);
    header('Cache-Control: no-store');
    header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    header("Content-Disposition: attachment; filename=\"accident_end_{$period}.xlsx\"; filename*=UTF-8''" . rawurlencode("事故患者終了報告_{$label}") . '.xlsx');
    echo $bytes;
    exit;
}

/** 取り消し（{ id }）。店舗＝自店舗、管轄MG＝管轄の店舗、本部＝全店 */
function ae_delete(): never
{
    $s = Auth::requireSession();
    Http::requireJson();
    $r = Db::one('SELECT id, storeId, karteId FROM accident_end WHERE id = ?', [(string)(Http::body()['id'] ?? '')]);
    $stores = ae_stores($s);
    if (!$r || !isset($stores[$r['storeId']])) Http::error('見つかりません', 404);
    if (!Auth::canEditStore($s, $stores[$r['storeId']])) Http::error('この店舗は見るだけです', 403);
    Db::exec('DELETE FROM accident_end WHERE id = ?', [$r['id']]);
    Http::json(['ok' => true]);
}
