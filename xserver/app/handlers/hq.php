<?php
// 本部 API（/api/admin/hq/...）
declare(strict_types=1);

function hq_get(): never
{
    Auth::requireHq();
    $setting = Settings::global();
    $stores = array_map(fn($r) => ['code' => $r['code'], 'name' => $r['name'], 'phone' => $r['phone'], 'beds' => (int)$r['beds'], 'active' => (bool)$r['active'],
        'address' => (string)$r['address'], 'lat' => $r['lat'] !== null ? (float)$r['lat'] : null, 'lng' => $r['lng'] !== null ? (float)$r['lng'] : null, 'listed' => (bool)$r['listed'],
        'pageCity' => (string)($r['pageCity'] ?? ''), 'pageOrder' => $r['pageOrder'] === null ? null : (int)$r['pageOrder'],
        'area' => $r['area'], 'hqOnly' => (bool)$r['hqOnly'], 'jibaiOnly' => (bool)$r['jibaiOnly']],
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
    // 新患継続率の数：紹介元は「業者紹介」、媒体は決めたきっかけで、内訳が名前の行
    $rows = Db::all("SELECT f.id, f.code, f.name, f.active, f.kind, f.trig, f.createdAt, (SELECT COUNT(*) FROM reservation r WHERE r.refCode = f.code) AS reservations, (SELECT COUNT(*) FROM karte k WHERE k.trig = IF(f.kind = 'media', f.trig, ?) AND k.trigDetail = f.name) AS kartes FROM referral f ORDER BY f.createdAt ASC, f.name ASC", ['業者紹介']);
    Http::json(['rows' => array_map(fn($r) => ['id' => $r['id'], 'code' => $r['code'], 'name' => $r['name'], 'active' => (bool)$r['active'], 'kind' => $r['kind'], 'trig' => $r['trig'], 'createdAt' => $r['createdAt'], 'reservations' => (int)$r['reservations'], 'kartes' => (int)$r['kartes']], $rows)]);
}

/** 紹介元・媒体の追加（{ name, kind?, trig? }）・名前やきっかけの変更・止める／再開（{ id, name?, trig?, active? }） */
function hq_referrals_put(): never
{
    Auth::requireHq();
    Http::requireJson();
    $b = Http::body();
    $name = isset($b['name']) ? mb_substr(trim((string)$b['name']), 0, 40) : null;
    if ($name !== null && $name === '') Http::error('紹介元の名前を入れてください', 400);
    $id = (string)($b['id'] ?? '');
    // 媒体のきっかけは、新患継続率のきっかけの選択肢から（業者紹介・紹介他事業などの内訳つきのものとギフトカードは使わない）
    $trig = isset($b['trig']) ? (string)$b['trig'] : null;
    if ($trig !== null && (!in_array($trig, Karte::options()['trigger'], true) || array_key_exists($trig, Karte::DETAIL_FOR) || $trig === 'ギフトカード')) Http::error('きっかけを選んでください', 400);
    if ($id === '') {
        if ($name === null) Http::error('紹介元の名前を入れてください', 400);
        $kind = ($b['kind'] ?? 'partner') === 'media' ? 'media' : 'partner';
        if ($kind === 'media' && $trig === null) Http::error('きっかけを選んでください', 400);
        if (Db::one('SELECT id FROM referral WHERE name = ?', [$name])) Http::error('同じ名前の紹介元があります', 409);
        // QR の URL に使う短い文字（読み間違えやすい 0・o・1・l・i は使わない）
        $chars = 'abcdefghjkmnpqrstuvwxyz23456789';
        do {
            $code = '';
            for ($i = 0; $i < 6; $i++) $code .= $chars[random_int(0, strlen($chars) - 1)];
        } while (Db::one('SELECT id FROM referral WHERE code = ?', [$code]));
        Db::exec('INSERT INTO referral (id, code, name, active, kind, trig, createdAt) VALUES (?, ?, ?, 1, ?, ?, ?)', [Db::newId(), $code, $name, $kind, $kind === 'media' ? $trig : '', Time::nowJstDateTime()]);
        Http::json(['ok' => true]);
    }
    $row = Db::one('SELECT * FROM referral WHERE id = ?', [$id]);
    if (!$row) Http::error('not found', 404);
    if ($name !== null && $name !== $row['name']) {
        if (Db::one('SELECT id FROM referral WHERE name = ? AND id <> ?', [$name, $id])) Http::error('同じ名前の紹介元があります', 409);
        // 名前を変えたら、初回カルテの内訳もそろえる
        Db::transaction(function () use ($id, $name, $row) {
            Db::exec('UPDATE referral SET name = ? WHERE id = ?', [$name, $id]);
            Db::exec('UPDATE karte SET trigDetail = ? WHERE trig = ? AND trigDetail = ?', [$name, $row['kind'] === 'media' ? $row['trig'] : '業者紹介', $row['name']]);
        });
        $row['name'] = $name;
    }
    if ($trig !== null && $row['kind'] === 'media' && $trig !== $row['trig']) {
        // 媒体のきっかけを変えたら、その媒体から入った新患継続率の行もそろえる
        Db::transaction(function () use ($id, $trig, $row) {
            Db::exec('UPDATE referral SET trig = ? WHERE id = ?', [$trig, $id]);
            Db::exec('UPDATE karte SET trig = ? WHERE trig = ? AND trigDetail = ?', [$trig, $row['trig'], $row['name']]);
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
        $jibaiOnly = array_key_exists('jibaiOnly', $b) ? (Http::bool($b, 'jibaiOnly') ? 1 : 0) : (int)($store['jibaiOnly'] ?? 0);
        Db::transaction(function () use ($store, $newCode, $name, $phone, $hqOnly, $jibaiOnly) {
            Db::exec('UPDATE store SET code = ?, name = ?, phone = ?, hqOnly = ?, jibaiOnly = ? WHERE id = ?', [$newCode ?? $store['code'], $name ?? $store['name'], $phone ?? $store['phone'], $hqOnly, $jibaiOnly, $store['id']]);
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
        $group = fn($r) => (int)$r['jibaiOnly'] ? '#jibai' : ((int)$r['hqOnly'] ? '#hq' : $r['area']);
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
        $pageCity = mb_substr(trim((string)($b['pageCity'] ?? '')), 0, 30);
        Db::exec('UPDATE store SET address = ?, lat = ?, lng = ?, listed = ?, pageCity = ? WHERE id = ?', [$address, $lat, $lng, !empty($b['listed']) ? 1 : 0, $pageCity !== '' ? $pageCity : null, $store['id']]);
    } elseif ($action === 'pageMove') {
        // 店舗えらびページの並びで 1 つ上・下へ（全店に 1 から番号を振り直す）
        $dir = (int)($b['dir'] ?? 0) < 0 ? -1 : 1;
        $list = array_values(Settings::pageSort(Settings::storesInOrder('1 = 1', [], false)));
        $idx = array_search($store['id'], array_column($list, 'id'), true);
        if ($idx !== false && isset($list[$idx + $dir])) [$list[$idx], $list[$idx + $dir]] = [$list[$idx + $dir], $list[$idx]];
        foreach ($list as $n => $r) Db::exec('UPDATE store SET pageOrder = ? WHERE id = ?', [$n + 1, $r['id']]);
    } elseif ($action === 'reset') {
        $password = (string)($b['password'] ?? '');
        if (strlen($password) < 8) Http::error('パスワードは8文字以上', 400);
        Db::exec('UPDATE admin_account SET passwordHash = ? WHERE storeId = ? AND role = ?', [password_hash($password, PASSWORD_BCRYPT), $store['id'], 'store']);
        Auth::revoke('storeId = ? AND role = ?', [$store['id'], 'store']); // 今ログインしている画面も使えなくする
    } else {
        Http::error('bad request', 400);
    }
    Http::json(['ok' => true]);
}

/** 全店状況：指定日の全店舗の予約・来院・WEB・内訳・キャンセル */
function hq_overview(): never
{
    $s = Auth::requireViewAll();
    if ($s['role'] === 'acct') throw new HttpError(403, 'forbidden'); // 管轄MG は見るだけ。経理は使わない
    $today = Time::nowJst()['date'];
    $date = Http::query('date');
    if (!$date || !Time::isValidDate($date)) $date = $today;
    $setting = Settings::global();
    $stores = array_map([Settings::class, 'storeRow'], Settings::storesInOrder('active = 1', [], false));
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

/** プライバシーポリシーの文章（まだなければ body は空。画面が下書きを出す） */
function hq_privacy_get(): never
{
    Auth::requireHq();
    $r = Db::one("SELECT body, published, updatedAt, updatedBy FROM site_page WHERE k = 'privacy'");
    Http::json(['body' => $r['body'] ?? '', 'published' => (bool)(int)($r['published'] ?? 0), 'updatedAt' => $r['updatedAt'] ?? null, 'updatedBy' => $r['updatedBy'] ?? '']);
}

/** 保存・公開（{ body, published }）。【 】（まだ埋めていない所）が残っているうちは公開しない */
function hq_privacy_put(): never
{
    Auth::requireHq();
    Http::requireJson();
    $b = Http::body();
    $body = str_replace("\r\n", "\n", (string)($b['body'] ?? ''));
    if (mb_strlen($body) > 30000) Http::error('文章が長すぎます', 400);
    $published = Http::bool($b, 'published');
    if ($published && trim($body) === '') Http::error('文章を入れてください', 400);
    if ($published && str_contains($body, '【')) Http::error('【 】の所（まだ決まっていない所）が残っています。埋めてから公開してください', 400);
    $s = Auth::requireSession();
    $by = $s['role'] === 'hq' ? (string)((Auth::account()['name'] ?? '') ?: $s['code']) : $s['code'];
    Db::exec('INSERT INTO site_page (k, body, published, updatedAt, updatedBy) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE body = VALUES(body), published = VALUES(published), updatedAt = VALUES(updatedAt), updatedBy = VALUES(updatedBy)',
        ['privacy', $body, $published ? 1 : 0, Time::nowJstDateTime(), mb_substr($by, 0, 60)]);
    Http::json(['ok' => true]);
}

/** 新自の通知（メール）の送り先と、交通事故の相談 LINE の URL */
function hq_jibai_notify_get(): never
{
    Auth::requireHq();
    Http::json([
        'rows' => array_map(fn($r) => ['id' => $r['id'], 'area' => $r['area'], 'email' => $r['email'], 'label' => $r['label']], Db::all('SELECT * FROM jibai_notify ORDER BY sortOrder ASC')),
        'areas' => array_column(Db::all('SELECT name FROM area ORDER BY sortOrder ASC, name ASC'), 'name'),
        'consultLineUrl' => Settings::global()['consultLineUrl'],
        'mailFrom' => Mail::from(),
    ]);
}

/** 送り先をまとめて保存（{ rows: [{ area, email, label }] }） */
function hq_jibai_notify_put(): never
{
    Auth::requireHq();
    Http::requireJson();
    $rows = Http::body()['rows'] ?? null;
    if (!is_array($rows) || count($rows) > 50) Http::error('bad request', 400);
    $areas = array_column(Db::all('SELECT name FROM area'), 'name');
    $clean = [];
    foreach ($rows as $r) {
        $email = trim((string)($r['email'] ?? ''));
        if ($email === '') continue;
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || mb_strlen($email) > 200) Http::error("メールアドレスが正しくありません：{$email}", 400);
        $area = (string)($r['area'] ?? '');
        if ($area !== '' && !in_array($area, $areas, true)) Http::error('エリアを選び直してください', 400);
        $clean[] = [$area, $email, mb_substr(trim((string)($r['label'] ?? '')), 0, 30)];
    }
    Db::transaction(function () use ($clean) {
        Db::exec('DELETE FROM jibai_notify');
        foreach ($clean as $i => [$area, $email, $label]) Db::exec('INSERT INTO jibai_notify (id, area, email, label, sortOrder) VALUES (?, ?, ?, ?, ?)', [Db::newId(), $area, $email, $label, $i]);
    });
    Http::json(['ok' => true]);
}

/** 送り先全員に試しのメールを送る */
function hq_jibai_notify_test(): never
{
    Auth::requireHq();
    Http::requireSameOrigin();
    $to = array_column(Db::all('SELECT email FROM jibai_notify'), 'email');
    if (!$to) Http::error('送り先がありません', 400);
    $n = Mail::send($to, '【試し】新自の通知メール', "新自（交通事故）の通知メールの試しです。\nこのメールが届いていれば、新自が来院したときにお知らせが届きます。\n\n※このメールは送信専用です。");
    Http::json(['ok' => true, 'sent' => $n, 'total' => count(array_unique($to))]);
}

/** 交通事故の相談 LINE の URL（{ url }。空＝バナーを出さない） */
function hq_consult_line_put(): never
{
    Auth::requireHq();
    Http::requireJson();
    $url = trim((string)(Http::body()['url'] ?? ''));
    if ($url !== '' && (!preg_match('#^https://[^\s<>"]+$#', $url) || strlen($url) > 300)) Http::error('URL は https:// から始まる形で入れてください', 400);
    Settings::global();
    Db::exec('UPDATE global_setting SET consultLineUrl = ? WHERE id = 1', [$url]);
    Http::json(['ok' => true]);
}

/** LINE 公式アカウント（新自の通知）：合言葉が入っているか・送り先・今月の通数（合言葉そのものは返さない） */
function hq_line_get(): never
{
    Auth::requireHq();
    $base = rtrim(Config::str('APP_URL'), '/');
    if ($base === '') $base = (Http::isHttps() ? 'https://' : 'http://') . ($_SERVER['HTTP_HOST'] ?? '');
    Http::json([
        'hasToken' => Line::token() !== '', 'hasSecret' => Line::secret() !== '',
        'webhookUrl' => $base . '/api/line/webhook',
        'targets' => array_map(fn($r) => [
            'id' => $r['id'], 'area' => $r['area'], 'label' => $r['label'], 'kind' => $r['kind'], 'linked' => $r['targetId'] !== null, 'active' => (bool)$r['active'],
            'code' => $r['targetId'] === null ? $r['code'] : null, 'codeExpires' => $r['targetId'] === null ? $r['codeExpires'] : null,
        ], Db::all('SELECT * FROM line_target ORDER BY sortOrder ASC, createdAt ASC')),
        'areas' => array_column(Db::all('SELECT name FROM area ORDER BY sortOrder ASC, name ASC'), 'name'),
        'quota' => Line::quota(),
    ]);
}

/** 合言葉を入れる（{ token?, secret? }。空の文字は「消す」） */
function hq_line_put(): never
{
    Auth::requireHq();
    Http::requireJson();
    $b = Http::body();
    Settings::global();
    foreach (['token' => ['lineToken', 400], 'secret' => ['lineSecret', 100]] as $k => [$col, $max]) {
        if (!array_key_exists($k, $b)) continue;
        $v = trim((string)$b[$k]);
        if (strlen($v) > $max || ($v !== '' && !preg_match('#^[A-Za-z0-9+/=._-]+$#', $v))) Http::error($k === 'token' ? 'チャネルアクセストークンが正しくありません' : 'チャネルシークレットが正しくありません', 400);
        Db::exec("UPDATE global_setting SET `$col` = ? WHERE id = 1", [$v]);
    }
    Http::json(['ok' => true]);
}

/** 送り先を足す（{ area, label }）：6 桁の番号を出す。24 時間のうちに公式アカウントへ送ってもらうと登録される */
function hq_line_target_post(): never
{
    Auth::requireHq();
    Http::requireJson();
    $b = Http::body();
    $area = (string)($b['area'] ?? '');
    if ($area !== '' && !in_array($area, array_column(Db::all('SELECT name FROM area'), 'name'), true)) Http::error('エリアを選び直してください', 400);
    $label = mb_substr(trim((string)($b['label'] ?? '')), 0, 30);
    if ($label === '') Http::error('名前を入れてください（例：静岡エリアMG）', 400);
    if ((int)Db::one('SELECT COUNT(*) AS n FROM line_target')['n'] >= 50) Http::error('送り先は 50 までです', 400);
    do { $code = sprintf('%06d', random_int(0, 999999)); } while (Db::one('SELECT id FROM line_target WHERE code = ?', [$code]));
    $id = Db::newId();
    Db::exec('INSERT INTO line_target (id, area, label, code, codeExpires, sortOrder) VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR), (SELECT n FROM (SELECT COUNT(*) AS n FROM line_target) t))', [$id, $area, $label, $code]);
    Http::json(['ok' => true, 'id' => $id, 'code' => $code]);
}

/** 送り先を消す（{ id }）・止める／再開（{ id, active }）・番号を出し直す（{ id, newCode: true }） */
function hq_line_target_put(): never
{
    Auth::requireHq();
    Http::requireJson();
    $b = Http::body();
    $r = Db::one('SELECT * FROM line_target WHERE id = ?', [(string)($b['id'] ?? '')]);
    if (!$r) Http::error('not found', 404);
    if (!empty($b['delete'])) { Db::exec('DELETE FROM line_target WHERE id = ?', [$r['id']]); Http::json(['ok' => true]); }
    if (array_key_exists('active', $b)) Db::exec('UPDATE line_target SET active = ? WHERE id = ?', [Http::bool($b, 'active') ? 1 : 0, $r['id']]);
    if (!empty($b['newCode'])) {
        do { $code = sprintf('%06d', random_int(0, 999999)); } while (Db::one('SELECT id FROM line_target WHERE code = ?', [$code]));
        Db::exec('UPDATE line_target SET code = ?, codeExpires = DATE_ADD(NOW(), INTERVAL 24 HOUR), targetId = NULL, kind = \'\' WHERE id = ?', [$code, $r['id']]);
        Http::json(['ok' => true, 'code' => $code]);
    }
    Http::json(['ok' => true]);
}

/** 登録済みの LINE 全部に試しの通知を送る */
function hq_line_test(): never
{
    Auth::requireHq();
    Http::requireSameOrigin();
    if (Line::token() === '') Http::error('チャネルアクセストークンを先に入れてください', 400);
    $to = array_column(Db::all('SELECT targetId FROM line_target WHERE active = 1 AND targetId IS NOT NULL'), 'targetId');
    if (!$to) Http::error('登録の済んだ送り先がありません', 400);
    $n = 0;
    foreach (array_unique($to) as $t) if (Line::push($t, "【試し】新自の通知の試しです。\nこれが届いていれば、新自が来院したときにここへお知らせが届きます。")) $n++;
    Http::json(['ok' => true, 'sent' => $n, 'total' => count(array_unique($to))]);
}
