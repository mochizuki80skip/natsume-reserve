<?php
// 顧客向け API（/api/public/{店舗コード}/...）。個人情報は返さない
declare(strict_types=1);

function pub_load_store(string $code, bool $allowJibaiOnly = false): array
{
    $store = Settings::findStoreByCode($code);
    // 自賠請求だけに使う店舗は WEB 予約のページを出さない（店舗のログイン画面の名前だけは出す）
    if (!$store || !$store['active'] || (!$allowJibaiOnly && (int)($store['jibaiOnly'] ?? 0))) throw new HttpError(404, '店舗が見つかりません');
    return ['store' => $store, 'setting' => Settings::global()];
}

/** 店舗の公開情報（名前・電話番号のみ） */
function pub_store(array $p): never
{
    $ctx = pub_load_store($p[1], true);
    Http::json(['code' => $ctx['store']['code'], 'name' => $ctx['store']['name'], 'phone' => $ctx['store']['phone'], 'smsEnabled' => Sms::enabled(), 'jibaiOnly' => (bool)(int)($ctx['store']['jibaiOnly'] ?? 0), 'closures' => PublicApi::closures($ctx['store'], Time::nowJst()['date'])]);
}

function pub_week(array $p): never
{
    $ctx = pub_load_store($p[1]);
    $startParam = Http::query('start');
    $start = ($startParam && Time::isValidDate($startParam)) ? Time::mondayOf($startParam) : Time::mondayOf(Time::nowJst()['date']);
    Http::json(PublicApi::weekForCustomer($ctx['store'], $ctx['setting'], $start, PublicApi::parseKind(Http::query('kind'))));
}

function pub_slots(array $p): never
{
    $ctx = pub_load_store($p[1]);
    $date = Http::query('date', '');
    if (!Time::isValidDate($date)) Http::error('bad date', 400);
    Http::json(['date' => $date] + PublicApi::slotsForCustomer($ctx['store'], $ctx['setting'], $date, PublicApi::parseKind(Http::query('kind'))));
}

function pub_calendar(array $p): never
{
    $ctx = pub_load_store($p[1]);
    $ym = Http::query('month', substr(Time::nowJst()['date'], 0, 7));
    if (!Time::isValidMonth($ym)) Http::error('bad month', 400);
    Http::json(['month' => $ym, 'today' => Time::nowJst()['date'], 'days' => PublicApi::calendarForCustomer($ctx['store'], $ctx['setting'], $ym, PublicApi::parseKind(Http::query('kind')))]);
}

/** 予約の確定 */
function pub_reserve(array $p): never
{
    if (!RateLimit::allow('reserve:' . Http::clientIp(), 10, 10 * 60)) Http::error('短時間に多くの操作がありました。しばらくしてからお試しください。', 429);
    $ctx = pub_load_store($p[1]);
    $store = $ctx['store'];
    $setting = $ctx['setting'];
    Http::requireJson();
    $b = Http::body();
    $kind = $b['kind'] ?? '';
    if (!in_array($kind, PublicApi::KINDS, true)) Http::error('入力内容を確認してください', 400);
    $date = $b['date'] ?? '';
    if (!is_string($date) || !Time::isValidDate($date)) Http::error('日付が不正です', 400);
    $time = Http::int($b, 'time', 0, 24 * 60);
    $name = is_string($b['name'] ?? null) ? trim(Text::dropHonorific(trim($b['name']))) : '';
    if ($name === '') Http::error('お名前を入力してください', 400);
    if (mb_strlen($name) > 40) Http::error('お名前が長すぎます', 400);
    $phoneRaw = is_string($b['phone'] ?? null) ? trim($b['phone']) : '';
    if (strlen($phoneRaw) < 10) Http::error('電話番号を入力してください', 400);
    $cardNo = is_string($b['cardNo'] ?? null) ? mb_substr(trim($b['cardNo']), 0, 20) : '';
    $viaCard = ($b['via'] ?? '') === 'card'; // 紹介カード（店舗えらびページ）から来た予約
    // 紹介元（業者）の専用 QR から来た予約（登録済みで止めていない紹介元だけ）
    $refCode = is_string($b['ref'] ?? null) && preg_match('/^[a-z0-9]{4,16}$/', $b['ref']) && Db::one('SELECT id FROM referral WHERE code = ? AND active = 1', [$b['ref']]) ? $b['ref'] : null;
    if ($kind === 'RETURN' && $cardNo === '') Http::error('診察券番号を入力してください', 400); // 再来は無くても可
    $phone = Text::normalizeJpPhone($phoneRaw);
    if (!$phone) Http::error('電話番号の形式が正しくありません', 400);

    $today = Time::nowJst()['date'];
    $day = Settings::dayRow(Db::one('SELECT * FROM day_status WHERE storeId = ? AND date = ?', [$store['id'], $date]));
    if (!PublicApi::isPublished($store, $date, $today, $day['published'] ?? null)) Http::error('この日は現在WEB予約を受け付けていません', 409);

    $lockName = 'reserve:' . $store['id'] . ':' . $date;
    $got = Db::one('SELECT GET_LOCK(?, 10) AS ok', [$lockName]);
    if (!$got || (int)$got['ok'] !== 1) Http::error('混み合っています。しばらくしてからお試しください', 503);
    try {
        $result = Db::transaction(function () use ($store, $setting, $date, $time, $kind, $name, $phone, $cardNo, $day, $viaCard, $refCode) {
            // 同じ電話番号＋同じ氏名の予約がその日にすでにあれば二重予約として断る（氏名が違えば親子などとして受け付ける）
            $same = Db::all('SELECT name, time FROM reservation WHERE storeId = ? AND date = ? AND phone = ? AND status = ?', [$store['id'], $date, $phone, 'BOOKED']);
            foreach ($same as $r) {
                if (Text::isSameName($r['name'], $name)) {
                    // 予約の時刻は出さない（名前と電話番号だけで、ほかの人の予約の時刻を調べられないように）
                    throw new HttpError(409, '同じお名前・電話番号でのご予約が ' . Time::formatDateJa($date, false) . ' にすでに入っています。ご予約の確認・変更はお電話（' . $store['phone'] . '）へお願いします。');
                }
            }
            $cells = Db::all('SELECT time, bed, text FROM cell WHERE storeId = ? AND date = ? AND bed > 0', [$store['id'], $date]);
            $in = PublicApi::buildInput($store, $setting, $date, $kind, Settings::closedOf($day), $cells);
            $free = Availability::freeBedsAt($in, $time);
            if (Availability::newByPhoneOnly($in)) {
                throw new HttpError(409, 'はじめての方のご予約はお電話（' . $store['phone'] . '）で承っております');
            }
            $status = Availability::statusFor($in, $time, Availability::remainingAt($in, $time));
            if ($status !== 'open') {
                throw new HttpError(409, $status === 'phone' ? 'この時間はお電話でのみ受付しております' : 'この時間は空きがなくなりました。別の時間をお選びください');
            }
            $bed = $free[0];
            $rid = Db::newId();
            $token = bin2hex(random_bytes(16)); // 確認ページの URL に使う（推測できない）
            Db::exec('INSERT INTO reservation (id, storeId, date, time, bed, kind, cardNo, name, phone, status, viewToken, viaCard, refCode, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [$rid, $store['id'], $date, $time, $bed, $kind, ($kind === 'RETURN' || $kind === 'REVISIT') && $cardNo !== '' ? $cardNo : null, $name, $phone, 'BOOKED', $token, $viaCard ? 1 : 0, $refCode, Time::nowJstDateTime()]);
            for ($k = 0; $k < $in['neededSlots']; $k++) {
                $text = $k === 0 ? PublicApi::cellName($kind, $name) : PublicApi::contText($kind);
                Db::exec('INSERT INTO cell (id, storeId, date, time, bed, text, reservationId) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [Db::newId(), $store['id'], $date, $time + $k * $setting['slotMinutes'], $bed, $text, $rid]);
            }
            return ['id' => $rid, 'bed' => $bed, 'token' => $token];
        });
    } finally {
        Db::one('SELECT RELEASE_LOCK(?) AS r', [$lockName]);
    }

    $viewUrl = pub_base_url() . '/r/' . $result['token'];
    $smsBody = "【{$store['name']}】ご予約を承りました。\n" . Time::formatDateJa($date, false) . ' ' . Time::minToHm($time) . "〜\n"
        . ($kind !== 'RETURN' ? "初めての方・久しぶりの方は10分前にお越しください。\n" : '')
        . "お支払いは現金のみです。マイナンバーカード・受給者証をお持ちください。\n"
        . "ご予約の確認：{$viewUrl}\n"
        . "変更・キャンセルはお電話（{$store['phone']}）へお願いします。";
    $smsStatus = Sms::send($phone, $smsBody);
    Db::exec('UPDATE reservation SET smsStatus = ? WHERE id = ?', [$smsStatus, $result['id']]);
    if (!empty($store['notifyPhone'])) {
        $to = Text::normalizeJpPhone($store['notifyPhone']);
        // 氏名に URL を書かれても、店舗の携帯にリンクとして届かないようにする
        $safeName = preg_replace('#(https?://|www\.)\S*#i', '', $name) ?? '';
        if ($to) Sms::send($to, '【WEB予約】' . Time::formatDateJa($date, false) . ' ' . Time::minToHm($time) . ' ' . PublicApi::KIND_JA[$kind] . " {$safeName} 様");
    }
    Http::json(['ok' => true, 'id' => $result['id'], 'token' => $result['token'], 'date' => $date, 'time' => $time, 'smsStatus' => $smsStatus]);
}

/** SMS に載せる URL の頭（APP_URL が空なら開かれている URL から作る） */
function pub_base_url(): string
{
    $u = rtrim(Config::str('APP_URL'), '/');
    if ($u !== '') return $u;
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
    return ($https ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost');
}

/** 患者様の「ご予約の確認ページ」。予約日の翌日まで見られる。変更・キャンセルは電話のみ */
function pub_reservation_view(array $p): never
{
    if (!RateLimit::allow('rview:' . Http::clientIp(), 60, 10 * 60)) Http::error('短時間に多くの操作がありました。しばらくしてからお試しください。', 429);
    $r = Db::one('SELECT r.date, r.time, r.kind, r.name, r.status, s.code, s.name AS storeName, s.phone AS storePhone FROM reservation r JOIN store s ON s.id = r.storeId WHERE r.viewToken = ?', [$p[1]]);
    if (!$r) Http::error('ご予約が見つかりません', 404);
    $today = Time::nowJst()['date'];
    $store = ['code' => $r['code'], 'name' => $r['storeName'], 'phone' => $r['storePhone']];
    $daysLeft = (int)((strtotime($r['date'] . ' 00:00:00 UTC') - strtotime($today . ' 00:00:00 UTC')) / 86400);
    // 予約日の翌日を過ぎたら中身は出さない
    if ($daysLeft < -1) Http::json(['state' => 'ENDED', 'store' => $store]);
    $state = $r['status'] === 'CANCELLED' ? 'CANCELLED' : ($daysLeft < 0 ? 'PAST' : 'BOOKED');
    Http::json(['state' => $state, 'store' => $store, 'date' => $r['date'], 'time' => (int)$r['time'], 'kind' => $r['kind'], 'name' => $r['name'], 'daysLeft' => $daysLeft, 'today' => $today]);
}

/**
 * 店舗えらびページ（/stores。紹介カードの QR の行き先）。本部が「公開する」にするまでは open: false（準備中）
 * 全店共通の営業時間・店舗ごとの住所と地図の位置・今日（休診日は次の営業日）の空いている時間帯（午前・午後 1 つずつ）
 */
function pub_stores(): never
{
    if (!RateLimit::allow('stores:' . Http::clientIp(), 120, 10 * 60)) Http::error('短時間に多くの操作がありました。しばらくしてからお試しください。', 429);
    $setting = Settings::global();
    // 公開前でも、本部でログインしている人は ?preview=1 で見られる（入力した内容の確認用）
    $preview = Http::query('preview') === '1' && (Auth::session()['role'] ?? '') === 'hq';
    if (!$setting['storesPageOpen'] && !$preview) Http::json(['open' => false]);
    $today = Time::nowJst()['date'];
    $areaOf = [];
    $areaOrder = [];
    foreach (Db::all('SELECT name, storeCodes FROM area ORDER BY sortOrder ASC, name ASC') as $i => $a) {
        $areaOrder[] = $a['name'];
        foreach (array_filter(explode(',', (string)$a['storeCodes'])) as $code) $areaOf[$code] ??= $a['name'];
    }
    $stores = [];
    foreach (Settings::storesInOrder('active = 1 AND listed = 1', [], false) as $row) {
        $st = Settings::storeRow($row);
        $stores[] = [
            'code' => $st['code'], 'name' => $st['name'], 'phone' => $st['phone'], 'address' => (string)($row['address'] ?? ''),
            'lat' => $row['lat'] !== null ? (float)$row['lat'] : null, 'lng' => $row['lng'] !== null ? (float)$row['lng'] : null,
            'area' => $areaOf[$st['code']] ?? '', 'quiet' => pub_quiet_times($st, $setting, $today), 'closures' => PublicApi::closures($st, $today),
        ];
    }
    Http::json(['open' => true, 'today' => $today, 'hours' => pub_hours_summary($setting, $today), 'areas' => $areaOrder, 'stores' => $stores]);
}

/** 全店共通の営業時間の表示（同じ時間の曜日をまとめる）と休診日 */
function pub_hours_summary(array $setting, string $date): array
{
    $cfg = Hours::parseHoursConfig($setting['hours'] ?? null) ?? Hours::defaultHours();
    $p = Hours::periodForDate($cfg, $date) ?? ['byWeekday' => []];
    $ja = ['日', '月', '火', '水', '木', '金', '土'];
    $groups = [];
    $closed = [];
    foreach ([1, 2, 3, 4, 5, 6, 0] as $w) {
        $ss = $p['byWeekday'][(string)$w] ?? [];
        if (!$ss) { $closed[] = $ja[$w] . '曜'; continue; }
        $text = implode(' ／ ', array_map(fn($s) => Time::minToHm(Time::hmToMin($s[0])) . '–' . Time::minToHm(Time::hmToMin($s[1]) + $setting['slotMinutes']), $ss));
        $groups[$text][] = $ja[$w];
    }
    $rows = [];
    foreach ($groups as $text => $days) $rows[] = ['days' => count($days) === 1 ? $days[0] . '曜' : implode('・', $days), 'text' => $text];
    if ($setting['closeOnHolidays']) $closed[] = '祝日';
    return ['rows' => $rows, 'closed' => implode('・', $closed)];
}

/**
 * 空いている時間帯の目安：今日（休診日・受付が終わった日は次の営業日）の、午前・午後それぞれで残り枠がいちばん多い 1 時間。
 * @return array{date:string,isToday:bool,closedToday:bool,am:?string,pm:?string}|null
 */
function pub_quiet_times(array $store, array $setting, string $today): ?array
{
    $closedToday = false;
    for ($i = 0; $i < 8; $i++) {
        $date = Time::addDays($today, $i);
        $day = Settings::dayRow(Db::one('SELECT * FROM day_status WHERE storeId = ? AND date = ?', [$store['id'], $date]));
        if (!Settings::storeSessions($store, $setting, $date, Settings::closedOf($day))) { if ($i === 0) $closedToday = true; continue; }
        if (!PublicApi::isPublished($store, $date, $today, $day['published'] ?? null)) continue;
        $in = PublicApi::buildInput($store, $setting, $date, 'RETURN', Settings::closedOf($day));
        $byHour = ['AM' => [], 'PM' => []];
        $any = false;
        foreach (Availability::compute($in) as $s) {
            if ($s['status'] === 'closed') continue;
            $any = true;
            $h = intdiv($s['time'], 60);
            $p = Hours::isAm($in['sessions'], $s['time']) ? 'AM' : 'PM';
            $byHour[$p][$h] = ($byHour[$p][$h] ?? 0) + ($s['status'] === 'open' ? $s['remaining'] : 0);
        }
        if (!$any) continue; // 今日の受付が終わっていたら次の営業日
        $best = function (array $hours): ?string {
            if (!$hours || max($hours) <= 0) return null;
            $h = array_search(max($hours), $hours, true);
            return sprintf('%d:00〜%d:00', $h, $h + 1);
        };
        return ['date' => $date, 'isToday' => $i === 0, 'closedToday' => $closedToday, 'am' => $best($byHour['AM']), 'pm' => $best($byHour['PM'])];
    }
    return null;
}

/** プライバシーポリシー（全店共通）。本部が公開したときだけ中身を返す */
function pub_privacy(): never
{
    $r = Db::one("SELECT body, published, updatedAt FROM site_page WHERE k = 'privacy'");
    if (!$r || !(int)$r['published']) Http::json(['published' => false]);
    Http::json(['published' => true, 'body' => $r['body'], 'updatedAt' => $r['updatedAt']]);
}
