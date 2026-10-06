<?php
// 本部 API（/api/admin/hq/...）
declare(strict_types=1);

function hq_get(): never
{
    Auth::requireHq();
    $setting = Settings::global();
    $stores = array_map(fn($r) => ['code' => $r['code'], 'name' => $r['name'], 'phone' => $r['phone'], 'beds' => (int)$r['beds'], 'active' => (bool)$r['active']],
        Db::all('SELECT code, name, phone, beds, active FROM store ORDER BY code ASC'));
    Http::json([
        'stores' => $stores,
        'setting' => [
            'slotMinutes' => $setting['slotMinutes'], 'newVisitSlots' => $setting['newVisitSlots'], 'returnVisitSlots' => $setting['returnVisitSlots'],
            'webCutoffMinutes' => $setting['webCutoffMinutes'], 'phoneCutoffMinutes' => $setting['phoneCutoffMinutes'], 'phoneMarkRemaining' => $setting['phoneMarkRemaining'],
            'closeOnHolidays' => $setting['closeOnHolidays'], 'adminExtraSlots' => $setting['adminExtraSlots'], 'retentionDays' => $setting['retentionDays'],
            'hours' => json_encode($setting['hours'], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ],
    ]);
}

function hq_settings_put(): never
{
    Auth::requireHq();
    Http::requireJson();
    $b = Http::body();
    try {
        $v = [
            'slotMinutes' => Http::int($b, 'slotMinutes', 5, 60),
            'newVisitSlots' => Http::int($b, 'newVisitSlots', 1, 8),
            'returnVisitSlots' => Http::int($b, 'returnVisitSlots', 1, 8),
            'webCutoffMinutes' => Http::int($b, 'webCutoffMinutes', 0, 1440),
            'phoneCutoffMinutes' => Http::int($b, 'phoneCutoffMinutes', 0, 1440),
            'phoneMarkRemaining' => Http::int($b, 'phoneMarkRemaining', 0, 20),
            'closeOnHolidays' => Http::bool($b, 'closeOnHolidays'),
            'adminExtraSlots' => Http::int($b, 'adminExtraSlots', 0, 8),
            'retentionDays' => Http::int($b, 'retentionDays', 7, 3650),
        ];
    } catch (HttpError) {
        Http::error('入力内容を確認してください', 400);
    }
    $cfg = Hours::parseHoursConfig($b['hours'] ?? null);
    if (!$cfg) Http::error('営業時間の形式が正しくありません', 400);
    if ($v['phoneCutoffMinutes'] > $v['webCutoffMinutes']) Http::error('電話受付の締切はWEB予約の締切以下にしてください', 400);
    Settings::global();
    Db::exec('UPDATE global_setting SET slotMinutes = ?, newVisitSlots = ?, returnVisitSlots = ?, webCutoffMinutes = ?, phoneCutoffMinutes = ?, phoneMarkRemaining = ?, closeOnHolidays = ?, adminExtraSlots = ?, retentionDays = ?, hours = ? WHERE id = 1',
        [$v['slotMinutes'], $v['newVisitSlots'], $v['returnVisitSlots'], $v['webCutoffMinutes'], $v['phoneCutoffMinutes'], $v['phoneMarkRemaining'], $v['closeOnHolidays'] ? 1 : 0, $v['adminExtraSlots'], $v['retentionDays'], json_encode($cfg, JSON_UNESCAPED_UNICODE)]);
    Http::json(['ok' => true]);
}

function hq_stores_post(): never
{
    Auth::requireHq();
    Http::requireJson();
    $b = Http::body();
    $code = trim((string)($b['code'] ?? ''));
    if (!preg_match('/^[A-Za-z0-9_-]{2,20}$/', $code)) Http::error('店舗コードは英数字 2〜20 文字', 400);
    $name = trim((string)($b['name'] ?? ''));
    $phone = trim((string)($b['phone'] ?? ''));
    $password = (string)($b['password'] ?? '');
    if ($name === '' || mb_strlen($name) > 50 || $phone === '' || mb_strlen($phone) > 20) Http::error('入力内容を確認してください', 400);
    if (strlen($password) < 8) Http::error('パスワードは8文字以上', 400);
    if (Db::one('SELECT id FROM admin_account WHERE code = ?', [$code])) Http::error('この店舗コードは既に使われています', 409);
    Db::transaction(function () use ($code, $name, $phone, $password) {
        $id = Db::newId();
        Db::exec('INSERT INTO store (id, code, name, phone) VALUES (?, ?, ?, ?)', [$id, $code, $name, $phone]);
        Db::exec('INSERT INTO admin_account (id, code, passwordHash, role, storeId) VALUES (?, ?, ?, ?, ?)', [Db::newId(), $code, password_hash($password, PASSWORD_BCRYPT), 'store', $id]);
    });
    Http::json(['ok' => true]);
}

/**
 * 店舗の一括登録（SNS 投稿管理だけの設置で、予約システムの店舗一覧を写すため）。
 * body: {rows: [{code, name, phone, password?}]}。既にある店舗コードは名前・電話だけ更新
 */
function hq_stores_bulk(): never
{
    Auth::requireHq();
    Http::requireJson();
    $rows = Http::body()['rows'] ?? null;
    if (!is_array($rows) || !$rows || count($rows) > 200) Http::error('店舗の一覧を 1〜200 行で送ってください', 400);
    $added = 0; $updated = 0; $errors = [];
    foreach ($rows as $i => $r) {
        $code = trim((string)($r['code'] ?? ''));
        $name = trim((string)($r['name'] ?? ''));
        $phone = trim((string)($r['phone'] ?? ''));
        $password = (string)($r['password'] ?? '');
        if (!preg_match('/^[A-Za-z0-9_-]{2,20}$/', $code) || strtoupper($code) === 'HQ') { $errors[] = ($i + 1) . ' 行目：店舗コードは英数字 2〜20 文字'; continue; }
        if ($name === '' || mb_strlen($name) > 50 || mb_strlen($phone) > 20) { $errors[] = ($i + 1) . ' 行目：店舗名（50 文字まで）・電話（20 文字まで）を確認'; continue; }
        $cur = Settings::findStoreByCode($code);
        if ($cur) {
            Db::exec('UPDATE store SET name = ?, phone = ? WHERE id = ?', [$name, $phone !== '' ? $phone : $cur['phone'], $cur['id']]);
            if (strlen($password) >= 8) Db::exec('UPDATE admin_account SET passwordHash = ? WHERE storeId = ? AND role = ?', [password_hash($password, PASSWORD_BCRYPT), $cur['id'], 'store']);
            $updated++;
            continue;
        }
        if (strlen($password) < 8) { $errors[] = ($i + 1) . ' 行目（' . $code . '）：新しい店舗はパスワード 8 文字以上が必要'; continue; }
        if (Db::one('SELECT id FROM admin_account WHERE code = ?', [$code])) { $errors[] = ($i + 1) . ' 行目（' . $code . '）：このコードは使われています'; continue; }
        Db::transaction(function () use ($code, $name, $phone, $password) {
            $id = Db::newId();
            Db::exec('INSERT INTO store (id, code, name, phone) VALUES (?, ?, ?, ?)', [$id, $code, $name, $phone !== '' ? $phone : '-']);
            Db::exec('INSERT INTO admin_account (id, code, passwordHash, role, storeId) VALUES (?, ?, ?, ?, ?)', [Db::newId(), $code, password_hash($password, PASSWORD_BCRYPT), 'store', $id]);
        });
        $added++;
    }
    Http::json(['ok' => true, 'added' => $added, 'updated' => $updated, 'errors' => $errors]);
}

function hq_stores_put(): never
{
    Auth::requireHq();
    Http::requireJson();
    $b = Http::body();
    $code = (string)($b['code'] ?? '');
    $action = (string)($b['action'] ?? '');
    $store = Settings::findStoreByCode($code);
    if (!$store) Http::error('not found', 404);
    if ($action === 'toggle') {
        Db::exec('UPDATE store SET active = ? WHERE id = ?', [$store['active'] ? 0 : 1, $store['id']]);
    } elseif ($action === 'delete') {
        Db::exec('DELETE FROM store WHERE id = ?', [$store['id']]); // 予約表・予約・アカウントも外部キーで一緒に消える
    } elseif ($action === 'update') {
        $newCode = isset($b['newCode']) ? trim((string)$b['newCode']) : null;
        $name = isset($b['name']) ? trim((string)$b['name']) : null;
        $phone = isset($b['phone']) ? trim((string)$b['phone']) : null;
        if ($newCode !== null && !preg_match('/^[A-Za-z0-9_-]{2,20}$/', $newCode)) Http::error('bad request', 400);
        if (($name !== null && ($name === '' || mb_strlen($name) > 50)) || ($phone !== null && ($phone === '' || mb_strlen($phone) > 20))) Http::error('bad request', 400);
        if ($newCode !== null && $newCode !== $store['code']) {
            if (strtoupper($newCode) === 'HQ' || Db::one('SELECT id FROM admin_account WHERE code = ?', [$newCode])) Http::error('この店舗コードは既に使われています', 409);
        }
        Db::transaction(function () use ($store, $newCode, $name, $phone) {
            Db::exec('UPDATE store SET code = ?, name = ?, phone = ? WHERE id = ?', [$newCode ?? $store['code'], $name ?? $store['name'], $phone ?? $store['phone'], $store['id']]);
            if ($newCode !== null && $newCode !== $store['code']) Db::exec('UPDATE admin_account SET code = ? WHERE storeId = ? AND role = ?', [$newCode, $store['id'], 'store']);
        });
    } elseif ($action === 'reset') {
        $password = (string)($b['password'] ?? '');
        if (strlen($password) < 8) Http::error('パスワードは8文字以上', 400);
        Db::exec('UPDATE admin_account SET passwordHash = ? WHERE storeId = ? AND role = ?', [password_hash($password, PASSWORD_BCRYPT), $store['id'], 'store']);
    } else {
        Http::error('bad request', 400);
    }
    Http::json(['ok' => true]);
}

/** 全店状況：指定日の全店舗の予約・来院・WEB・内訳・キャンセル */
function hq_overview(): never
{
    Auth::requireHq();
    $today = Time::nowJst()['date'];
    $date = Http::query('date');
    if (!$date || !Time::isValidDate($date)) $date = $today;
    $setting = Settings::global();
    $stores = array_map([Settings::class, 'storeRow'], Db::all('SELECT * FROM store WHERE active = 1 ORDER BY code ASC'));
    $rows = [];
    $sum = ['rAm' => 0, 'rPm' => 0, 'vAm' => 0, 'vPm' => 0, 'web' => 0, 'nw' => 0, 're' => 0, 'jb' => 0, 'cancel' => 0, 'noshow' => 0];
    foreach ($stores as $store) {
        $d = DayData::load($store, $setting, $date);
        $r = ['code' => $store['code'], 'name' => $store['name'], 'closed' => $d['day']['closed'], 'published' => $d['day']['published'],
            'rAm' => 0, 'rPm' => 0, 'vAm' => 0, 'vPm' => 0, 'web' => 0, 'nw' => 0, 're' => 0, 'jb' => 0,
            'cancel' => count($d['cancels']), 'noshow' => count(array_filter($d['cancels'], fn($c) => $c['kind'] === 'NOSHOW'))];
        foreach ($d['cells'] as $c) {
            if (!Availability::isPatientText($c['text'])) continue;
            $a = Hours::isAm($d['sessions'], $c['time']);
            if ($a) $r['rAm']++; else $r['rPm']++;
            if ($c['visited']) { if ($a) $r['vAm']++; else $r['vPm']++; }
            if ($c['web'] && !Text::isContinuationText($c['text'])) $r['web']++;
            $cat = Text::categorize($c['text']);
            if ($cat['isNew']) $r['nw']++;
            if ($cat['isRevisit']) $r['re']++;
            if ($cat['isJibai']) $r['jb']++;
        }
        foreach (array_keys($sum) as $k) $sum[$k] += $r[$k];
        $rows[] = $r;
    }
    Http::json(['date' => $date, 'today' => $today, 'rows' => $rows, 'sum' => $sum, 'storeCount' => count($stores)]);
}
