<?php
// 自賠責請求の速報集計 API（店舗：/api/admin/jibai/...、本部：/api/admin/hq/jibai...）
declare(strict_types=1);

/** 店舗（本部が店舗切替中も含む）の対象月データ */
function jibai_get(): never
{
    $ctx = Auth::context();
    Jibai::ensureTables();
    $ym = Http::query('ym', '');
    if (!Jibai::isValidYm($ym)) $ym = Jibai::currentYm();
    $sid = $ctx['store']['id'];
    $claims = Jibai::claims($sid, $ym);
    Http::json([
        'ym' => $ym,
        'currentYm' => Jibai::currentYm(),
        'store' => ['code' => $ctx['store']['code'], 'name' => $ctx['store']['name']],
        'isHq' => $ctx['session']['role'] === 'hq',
        'month' => Jibai::month($sid, $ym),
        'claims' => $claims,
        'total' => array_sum(array_map(fn($c) => $c['amount'], $claims)),
        'verifiedTotal' => array_sum(array_map(fn($c) => $c['verifiedAmount'] ?? 0, $claims)),
        'months' => Jibai::monthsWithData($sid),
        'logs' => Jibai::logs($sid, $ym),
        'nameRetentionDays' => Jibai::setting()['nameRetentionDays'],
    ]);
}

/** 店舗は提出済みの月を編集できない（「提出を取り消す」で再開する） */
function jibai_assert_editable(array $ctx, string $ym): void
{
    if ($ctx['session']['role'] === 'hq') return;
    $m = Jibai::month($ctx['store']['id'], $ym);
    if ($m && $m['status'] === 'SUBMITTED') throw new HttpError(409, 'この月は提出済みです。修正するには「提出を取り消す」を押してください');
}

/** 明細の一括保存（id があれば更新、無ければ追加） */
function jibai_claims_put(): never
{
    $ctx = Auth::context();
    Jibai::ensureTables();
    Http::requireJson();
    $b = Http::body();
    $ym = (string)($b['ym'] ?? '');
    if (!Jibai::isValidYm($ym)) Http::error('対象月が不正です', 400);
    $rows = $b['claims'] ?? null;
    if (!is_array($rows) || count($rows) > 500) Http::error('bad request', 400);
    jibai_assert_editable($ctx, $ym);
    $sid = $ctx['store']['id'];
    $by = $ctx['session']['code'];
    $isHq = $ctx['session']['role'] === 'hq';
    $added = 0;
    $updated = 0;
    Db::transaction(function () use ($rows, $sid, $ym, $by, $isHq, &$added, &$updated) {
        $seq = (int)Db::one('SELECT COALESCE(MAX(seq), 0) AS m FROM jibai_claim WHERE storeId = ? AND ym = ? FOR UPDATE', [$sid, $ym])['m'];
        foreach ($rows as $r) {
            if (!is_array($r)) throw new HttpError(400, 'bad request');
            $patientNo = mb_substr(trim((string)($r['patientNo'] ?? '')), 0, 20);
            $patientName = isset($r['patientName']) && is_string($r['patientName']) ? mb_substr(trim($r['patientName']), 0, 40) : '';
            $days = ($r['days'] ?? null) === null || $r['days'] === '' ? null : Http::int($r, 'days', 0, 31);
            $amount = Http::int($r, 'amount', 0, Jibai::MAX_AMOUNT);
            $source = (($r['source'] ?? '') === 'OCR') ? 'OCR' : 'MANUAL';
            $id = isset($r['id']) && is_string($r['id']) && preg_match('/^[0-9a-f]{24}$/', $r['id']) ? $r['id'] : null;
            if ($id) {
                $old = Db::one('SELECT * FROM jibai_claim WHERE id = ? AND storeId = ? AND ym = ?', [$id, $sid, $ym]);
                if (!$old) throw new HttpError(404, '明細が見つかりません（他の端末で削除された可能性があります）');
                if ($old['verifiedAmount'] !== null && !$isHq && (int)$old['amount'] !== $amount) throw new HttpError(409, '経理確認済みの明細の金額は店舗では変更できません');
                Db::exec('UPDATE jibai_claim SET patientNo = ?, patientName = ?, days = ?, amount = ? WHERE id = ?', [$patientNo, $patientName === '' ? null : $patientName, $days, $amount, $id]);
                if ((int)$old['amount'] !== $amount || (string)$old['patientNo'] !== $patientNo || ($old['days'] === null ? null : (int)$old['days']) !== $days) {
                    Jibai::log($sid, $ym, $id, 'update', sprintf('%s %s円 → %s %s円', $old['patientNo'], number_format((int)$old['amount']), $patientNo, number_format($amount)), $by);
                }
                $updated++;
            } else {
                $id = Db::newId();
                Db::exec('INSERT INTO jibai_claim (id, storeId, ym, seq, patientNo, patientName, days, amount, source, createdBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [$id, $sid, $ym, ++$seq, $patientNo, $patientName === '' ? null : $patientName, $days, $amount, $source, $by]);
                Jibai::log($sid, $ym, $id, 'add', sprintf('%s %s円（%s）', $patientNo, number_format($amount), $source === 'OCR' ? '読み取り' : '手入力'), $by);
                $added++;
            }
        }
        // 提出済みの月を本部が直した場合も月の行は残す。未作成なら DRAFT で作る
        Db::exec('INSERT INTO jibai_month (id, storeId, ym, status) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE updatedAt = CURRENT_TIMESTAMP', [Db::newId(), $sid, $ym, 'DRAFT']);
    });
    $claims = Jibai::claims($sid, $ym);
    Http::json(['ok' => true, 'added' => $added, 'updated' => $updated, 'claims' => $claims, 'total' => array_sum(array_map(fn($c) => $c['amount'], $claims))]);
}

function jibai_claims_delete(): never
{
    $ctx = Auth::context();
    Jibai::ensureTables();
    Http::requireJson();
    $b = Http::body();
    $id = (string)($b['id'] ?? '');
    $old = Db::one('SELECT * FROM jibai_claim WHERE id = ? AND storeId = ?', [$id, $ctx['store']['id']]);
    if (!$old) Http::error('not found', 404);
    jibai_assert_editable($ctx, $old['ym']);
    if ($old['verifiedAmount'] !== null && $ctx['session']['role'] !== 'hq') Http::error('経理確認済みの明細は店舗では削除できません', 409);
    Db::exec('DELETE FROM jibai_claim WHERE id = ?', [$id]);
    Jibai::log($ctx['store']['id'], $old['ym'], $id, 'delete', sprintf('%s %s円', $old['patientNo'], number_format((int)$old['amount'])), $ctx['session']['code']);
    Http::json(['ok' => true]);
}

/** 月の提出（確定）と取り消し */
function jibai_submit(): never
{
    $ctx = Auth::context();
    Jibai::ensureTables();
    Http::requireJson();
    $b = Http::body();
    $ym = (string)($b['ym'] ?? '');
    if (!Jibai::isValidYm($ym)) Http::error('対象月が不正です', 400);
    $action = (string)($b['action'] ?? 'submit');
    $sid = $ctx['store']['id'];
    $by = $ctx['session']['code'];
    if ($action === 'submit') {
        $n = (int)Db::one('SELECT COUNT(*) AS n FROM jibai_claim WHERE storeId = ? AND ym = ?', [$sid, $ym])['n'];
        if ($n === 0) Http::error('明細が 1 件もありません。自賠請求が無い月は「0 件で提出」を押してください', 400);
        Db::exec('INSERT INTO jibai_month (id, storeId, ym, status, submittedAt, submittedBy) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE status = VALUES(status), submittedAt = VALUES(submittedAt), submittedBy = VALUES(submittedBy)',
            [Db::newId(), $sid, $ym, 'SUBMITTED', Time::nowJstDateTime(), $by]);
        $total = (int)Db::one('SELECT COALESCE(SUM(amount), 0) AS t FROM jibai_claim WHERE storeId = ? AND ym = ?', [$sid, $ym])['t'];
        Jibai::log($sid, $ym, null, 'submit', sprintf('%d 件 %s円', $n, number_format($total)), $by);
    } elseif ($action === 'submit_empty') {
        $n = (int)Db::one('SELECT COUNT(*) AS n FROM jibai_claim WHERE storeId = ? AND ym = ?', [$sid, $ym])['n'];
        if ($n > 0) Http::error('明細があるので通常の「提出」を押してください', 400);
        Db::exec('INSERT INTO jibai_month (id, storeId, ym, status, submittedAt, submittedBy) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE status = VALUES(status), submittedAt = VALUES(submittedAt), submittedBy = VALUES(submittedBy)',
            [Db::newId(), $sid, $ym, 'SUBMITTED', Time::nowJstDateTime(), $by]);
        Jibai::log($sid, $ym, null, 'submit', '0 件（自賠請求なし）', $by);
    } elseif ($action === 'reopen') {
        $m = Jibai::month($sid, $ym);
        if (!$m || $m['status'] !== 'SUBMITTED') Http::error('提出されていません', 400);
        Db::exec('UPDATE jibai_month SET status = ?, submittedAt = NULL, submittedBy = NULL WHERE storeId = ? AND ym = ?', ['DRAFT', $sid, $ym]);
        Jibai::log($sid, $ym, null, 'reopen', null, $by);
    } else {
        Http::error('bad request', 400);
    }
    Http::json(['ok' => true, 'month' => Jibai::month($sid, $ym)]);
}

/** 経理確認（本部のみ）：確定金額の登録・取り消し・メモ */
function jibai_verify(): never
{
    $ctx = Auth::context();
    Auth::requireHq();
    Jibai::ensureTables();
    Http::requireJson();
    $b = Http::body();
    $id = (string)($b['id'] ?? '');
    $old = Db::one('SELECT * FROM jibai_claim WHERE id = ? AND storeId = ?', [$id, $ctx['store']['id']]);
    if (!$old) Http::error('not found', 404);
    $by = $ctx['session']['code'];
    $note = array_key_exists('note', $b) ? mb_substr(trim((string)$b['note']), 0, 200) : ($old['note'] ?? '');
    if (array_key_exists('verifiedAmount', $b) && $b['verifiedAmount'] === null) {
        Db::exec('UPDATE jibai_claim SET verifiedAmount = NULL, verifiedAt = NULL, verifiedBy = NULL, note = ? WHERE id = ?', [$note === '' ? null : $note, $id]);
        if ($old['verifiedAmount'] !== null) Jibai::log($ctx['store']['id'], $old['ym'], $id, 'unverify', $old['patientNo'], $by);
    } elseif (array_key_exists('verifiedAmount', $b)) {
        $v = Http::int($b, 'verifiedAmount', 0, Jibai::MAX_AMOUNT);
        Db::exec('UPDATE jibai_claim SET verifiedAmount = ?, verifiedAt = ?, verifiedBy = ?, note = ? WHERE id = ?', [$v, Time::nowJstDateTime(), $by, $note === '' ? null : $note, $id]);
        $diff = $v - (int)$old['amount'];
        Jibai::log($ctx['store']['id'], $old['ym'], $id, 'verify', sprintf('%s 確定 %s円%s', $old['patientNo'], number_format($v), $diff === 0 ? '' : sprintf('（速報との差 %+s円）', number_format($diff))), $by);
    } else {
        Db::exec('UPDATE jibai_claim SET note = ? WHERE id = ?', [$note === '' ? null : $note, $id]);
    }
    Http::json(['ok' => true, 'claim' => Jibai::claimRow(Db::one('SELECT * FROM jibai_claim WHERE id = ?', [$id]))]);
}

/** 本部：指定月の店舗別合計と全社合計 */
function hq_jibai(): never
{
    Auth::requireHq();
    Jibai::ensureTables();
    $ym = Http::query('ym', '');
    if (!Jibai::isValidYm($ym)) $ym = Jibai::currentYm();
    $stores = Db::all('SELECT id, code, name, active FROM store WHERE active = 1 ORDER BY code ASC');
    $agg = [];
    foreach (Db::all('SELECT storeId, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total, SUM(CASE WHEN verifiedAmount IS NULL THEN 0 ELSE 1 END) AS vn, COALESCE(SUM(verifiedAmount), 0) AS vtotal, SUM(CASE WHEN source = ? THEN 1 ELSE 0 END) AS ocr FROM jibai_claim WHERE ym = ? GROUP BY storeId', ['OCR', $ym]) as $r) {
        $agg[$r['storeId']] = $r;
    }
    $months = [];
    foreach (Db::all('SELECT * FROM jibai_month WHERE ym = ?', [$ym]) as $r) $months[$r['storeId']] = $r;
    $rows = [];
    $sum = ['count' => 0, 'total' => 0, 'verifiedCount' => 0, 'verifiedTotal' => 0, 'submitted' => 0];
    foreach ($stores as $s) {
        $a = $agg[$s['id']] ?? null;
        $m = $months[$s['id']] ?? null;
        $row = [
            'code' => $s['code'], 'name' => $s['name'],
            'status' => $m ? (string)$m['status'] : 'NONE',
            'submittedAt' => $m ? $m['submittedAt'] : null,
            'submittedBy' => $m ? $m['submittedBy'] : null,
            'count' => $a ? (int)$a['n'] : 0,
            'total' => $a ? (int)$a['total'] : 0,
            'ocrCount' => $a ? (int)$a['ocr'] : 0,
            'verifiedCount' => $a ? (int)$a['vn'] : 0,
            'verifiedTotal' => $a ? (int)$a['vtotal'] : 0,
        ];
        $sum['count'] += $row['count'];
        $sum['total'] += $row['total'];
        $sum['verifiedCount'] += $row['verifiedCount'];
        $sum['verifiedTotal'] += $row['verifiedTotal'];
        if ($row['status'] === 'SUBMITTED') $sum['submitted']++;
        $rows[] = $row;
    }
    // 過去 12 か月の全社合計（推移）
    $trend = array_map(fn($r) => ['ym' => $r['ym'], 'count' => (int)$r['n'], 'total' => (int)$r['total'], 'verifiedTotal' => (int)$r['vtotal']],
        Db::all('SELECT ym, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total, COALESCE(SUM(verifiedAmount), 0) AS vtotal FROM jibai_claim GROUP BY ym ORDER BY ym DESC LIMIT 12'));
    Http::json([
        'ym' => $ym,
        'currentYm' => Jibai::currentYm(),
        'rows' => $rows,
        'sum' => $sum,
        'storeCount' => count($stores),
        'trend' => $trend,
        'setting' => Jibai::setting(),
    ]);
}

function hq_jibai_settings_put(): never
{
    Auth::requireHq();
    Jibai::ensureTables();
    Http::requireJson();
    $b = Http::body();
    try {
        $days = Http::int($b, 'nameRetentionDays', 7, 3650);
    } catch (HttpError) {
        Http::error('保持日数は 7〜3650 の範囲で入力してください', 400);
    }
    Jibai::setting();
    Db::exec('UPDATE jibai_setting SET nameRetentionDays = ? WHERE id = 1', [$days]);
    Http::json(['ok' => true, 'setting' => Jibai::setting()]);
}
