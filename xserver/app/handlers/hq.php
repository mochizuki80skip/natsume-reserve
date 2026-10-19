<?php
// 本部 API（/api/admin/hq/...）
declare(strict_types=1);

function hq_get(): never
{
    Auth::requireHq();
    $setting = Settings::global();
    $stores = array_map(fn($r) => ['code' => $r['code'], 'name' => $r['name'], 'phone' => $r['phone'], 'beds' => (int)$r['beds'], 'active' => (bool)$r['active'],
        'address' => (string)$r['address'], 'lat' => $r['lat'] !== null ? (float)$r['lat'] : null, 'lng' => $r['lng'] !== null ? (float)$r['lng'] : null, 'listed' => (bool)$r['listed'],
        'area' => $r['area'], 'hqOnly' => (bool)$r['hqOnly']],
        Settings::storesInOrder());
    Http::json([
        'stores' => $stores,
        'areas' => array_column(Db::all('SELECT name FROM area ORDER BY sortOrder ASC, name ASC'), 'name'),
        'setting' => [
            'slotMinutes' => $setting['slotMinutes'], 'newVisitSlots' => $setting['newVisitSlots'], 'returnVisitSlots' => $setting['returnVisitSlots'],
            'webCutoffMinutes' => $setting['webCutoffMinutes'], 'phoneCutoffMinutes' => $setting['phoneCutoffMinutes'], 'phoneMarkRemaining' => $setting['phoneMarkRemaining'],
            'closeOnHolidays' => $setting['closeOnHolidays'], 'adminExtraSlots' => $setting['adminExtraSlots'], 'retentionDays' => $setting['retentionDays'],
            'hours' => json_encode($setting['hours'], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ],
        'storesPageOpen' => $setting['storesPageOpen'],
    ]);
}

/** 店舗えらびページの公開・非公開（{ open: true|false }） */
function hq_stores_page_put(): never
{
    Auth::requireHq();
    Http::requireJson();
    Settings::global();
    Db::exec('UPDATE global_setting SET storesPageOpen = ? WHERE id = 1', [Http::bool(Http::body(), 'open') ? 1 : 0]);
    Http::json(['ok' => true]);
}

/** 紹介元（業者）の一覧：専用 QR の code・名前・止めているか・この QR から入った WEB 予約の数と初回カルテの数 */
function hq_referrals_get(): never
{
    Auth::requireHq();
    $rows = Db::all('SELECT f.id, f.code, f.name, f.active, f.createdAt, (SELECT COUNT(*) FROM reservation r WHERE r.refCode = f.code) AS reservations, (SELECT COUNT(*) FROM karte k WHERE k.trig = ? AND k.trigDetail = f.name) AS kartes FROM referral f ORDER BY f.createdAt ASC, f.name ASC', ['業者紹介']);
    Http::json(['rows' => array_map(fn($r) => ['id' => $r['id'], 'code' => $r['code'], 'name' => $r['name'], 'active' => (bool)$r['active'], 'createdAt' => $r['createdAt'], 'reservations' => (int)$r['reservations'], 'kartes' => (int)$r['kartes']], $rows)]);
}

/** 紹介元の追加（{ name }）・名前の変更・止める／再開（{ id, name?, active? }） */
function hq_referrals_put(): never
{
    Auth::requireHq();
    Http::requireJson();
    $b = Http::body();
    $name = isset($b['name']) ? mb_substr(trim((string)$b['name']), 0, 40) : null;
    if ($name !== null && $name === '') Http::error('紹介元の名前を入れてください', 400);
    $id = (string)($b['id'] ?? '');
    if ($id === '') {
        if ($name === null) Http::error('紹介元の名前を入れてください', 400);
        if (Db::one('SELECT id FROM referral WHERE name = ?', [$name])) Http::error('同じ名前の紹介元があります', 409);
        // QR の URL に使う短い文字（読み間違えやすい 0・o・1・l・i は使わない）
        $chars = 'abcdefghjkmnpqrstuvwxyz23456789';
        do {
            $code = '';
            for ($i = 0; $i < 6; $i++) $code .= $chars[random_int(0, strlen($chars) - 1)];
        } while (Db::one('SELECT id FROM referral WHERE code = ?', [$code]));
        Db::exec('INSERT INTO referral (id, code, name, active, createdAt) VALUES (?, ?, ?, 1, ?)', [Db::newId(), $code, $name, Time::nowJstDateTime()]);
        Http::json(['ok' => true]);
    }
    $row = Db::one('SELECT * FROM referral WHERE id = ?', [$id]);
    if (!$row) Http::error('not found', 404);
    if ($name !== null && $name !== $row['name']) {
        if (Db::one('SELECT id FROM referral WHERE name = ? AND id <> ?', [$name, $id])) Http::error('同じ名前の紹介元があります', 409);
        // 名前を変えたら、初回カルテの内訳もそろえる
        Db::transaction(function () use ($id, $name, $row) {
            Db::exec('UPDATE referral SET name = ? WHERE id = ?', [$name, $id]);
            Db::exec('UPDATE karte SET trigDetail = ? WHERE trig = ? AND trigDetail = ?', [$name, '業者紹介', $row['name']]);
        });
    }
    if (array_key_exists('active', $b)) Db::exec('UPDATE referral SET active = ? WHERE id = ?', [Http::bool($b, 'active') ? 1 : 0, $id]);
    Http::json(['ok' => true]);
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
        $next = (int)(Db::one('SELECT COALESCE(MAX(sortOrder), 0) + 1 AS n FROM store')['n'] ?? 1);
        Db::exec('INSERT INTO store (id, code, name, phone, sortOrder) VALUES (?, ?, ?, ?, ?)', [$id, $code, $name, $phone, $next]);
        Db::exec('INSERT INTO admin_account (id, code, passwordHash, role, storeId) VALUES (?, ?, ?, ?, ?)', [Db::newId(), $code, password_hash($password, PASSWORD_BCRYPT), 'store', $id]);
    });
    Http::json(['ok' => true]);
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
        $hqOnly = array_key_exists('hqOnly', $b) ? (Http::bool($b, 'hqOnly') ? 1 : 0) : (int)($store['hqOnly'] ?? 0);
        Db::transaction(function () use ($store, $newCode, $name, $phone, $hqOnly) {
            Db::exec('UPDATE store SET code = ?, name = ?, phone = ?, hqOnly = ? WHERE id = ?', [$newCode ?? $store['code'], $name ?? $store['name'], $phone ?? $store['phone'], $hqOnly, $store['id']]);
            if ($newCode !== null && $newCode !== $store['code']) {
                Db::exec('UPDATE admin_account SET code = ? WHERE storeId = ? AND role = ?', [$newCode, $store['id'], 'store']);
                // エリアの設定に入っている店舗コードもそろえる
                foreach (Db::all('SELECT id, storeCodes FROM area') as $a) {
                    $codes = array_filter(explode(',', (string)$a['storeCodes']));
                    if (!in_array($store['code'], $codes, true)) continue;
                    Db::exec('UPDATE area SET storeCodes = ? WHERE id = ?', [implode(',', array_map(fn($c) => $c === $store['code'] ? $newCode : $c, $codes)), $a['id']]);
                }
            }
        });
    } elseif ($action === 'move') {
        // 同じまとまり（本部専用／同じエリア）の中で 1 つ上（dir=-1）か下（dir=1）と入れ替える
        $dir = (int)($b['dir'] ?? 0) < 0 ? -1 : 1;
        $all = Settings::storesInOrder();
        foreach ($all as $i => $r) Db::exec('UPDATE store SET sortOrder = ? WHERE id = ?', [$i + 1, $r['id']]);
        $group = fn($r) => (int)$r['hqOnly'] ? '#hq' : $r['area'];
        $idx = array_search($store['id'], array_column($all, 'id'), true);
        $j = $idx === false ? false : $idx + $dir;
        if ($j !== false && isset($all[$j]) && $group($all[$j]) === $group($all[$idx])) {
            Db::exec('UPDATE store SET sortOrder = ? WHERE id = ?', [$j + 1, $all[$idx]['id']]);
            Db::exec('UPDATE store SET sortOrder = ? WHERE id = ?', [$idx + 1, $all[$j]['id']]);
        }
    } elseif ($action === 'area') {
        // エリアを付け替える（エリアの設定の店舗一覧から外して、選んだエリアの最後に足す。'' はエリア未設定）
        $areaName = trim((string)($b['area'] ?? ''));
        $target = $areaName === '' ? null : Db::one('SELECT id, storeCodes FROM area WHERE name = ?', [$areaName]);
        if ($areaName !== '' && !$target) Http::error('そのエリアはありません', 404);
        Db::transaction(function () use ($store, $target) {
            foreach (Db::all('SELECT id, storeCodes FROM area') as $a) {
                $codes = array_values(array_filter(explode(',', (string)$a['storeCodes']), fn($c) => $c !== '' && $c !== $store['code']));
                if ($target && $a['id'] === $target['id']) $codes[] = $store['code'];
                Db::exec('UPDATE area SET storeCodes = ? WHERE id = ?', [implode(',', $codes), $a['id']]);
            }
            $next = (int)(Db::one('SELECT COALESCE(MAX(sortOrder), 0) + 1 AS n FROM store')['n'] ?? 1);
            Db::exec('UPDATE store SET sortOrder = ? WHERE id = ?', [$next, $store['id']]);
        });
    } elseif ($action === 'listing') {
        // 店舗えらびページの情報（住所・地図の位置・載せるか）
        $address = mb_substr(trim((string)($b['address'] ?? '')), 0, 200);
        $lat = ($b['lat'] ?? '') === '' || ($b['lat'] ?? null) === null ? null : (float)$b['lat'];
        $lng = ($b['lng'] ?? '') === '' || ($b['lng'] ?? null) === null ? null : (float)$b['lng'];
        if (($lat !== null && ($lat < 20 || $lat > 46)) || ($lng !== null && ($lng < 122 || $lng > 154)) || (($lat === null) !== ($lng === null))) Http::error('地図の位置（緯度・経度）が正しくありません', 400);
        Db::exec('UPDATE store SET address = ?, lat = ?, lng = ?, listed = ? WHERE id = ?', [$address, $lat, $lng, !empty($b['listed']) ? 1 : 0, $store['id']]);
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
    $stores = array_map([Settings::class, 'storeRow'], Settings::storesInOrder('active = 1'));
    $rows = [];
    $sum = ['rAm' => 0, 'rPm' => 0, 'vAm' => 0, 'vPm' => 0, 'web' => 0, 'nw' => 0, 're' => 0, 'jb' => 0, 'cancel' => 0, 'noshow' => 0];
    foreach ($stores as $store) {
        $d = DayData::load($store, $setting, $date);
        $r = ['code' => $store['code'], 'name' => $store['name'], 'closed' => $d['day']['closed'], 'published' => $d['day']['published'],
            'rAm' => 0, 'rPm' => 0, 'vAm' => 0, 'vPm' => 0, 'web' => 0, 'nw' => 0, 're' => 0, 'jb' => 0,
            'cancel' => count(array_filter($d['cancels'], fn($c) => $c['kind'] !== 'CHANGE')), 'noshow' => count(array_filter($d['cancels'], fn($c) => $c['kind'] === 'NOSHOW'))];
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
