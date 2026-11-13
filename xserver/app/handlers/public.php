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
    // ギフトカード（?via=card）・媒体や紹介元の QR（?ref=）から来たときは、その経路のキャンペーン（店舗向けメモは出さない）
    $today = Time::nowJst()['date'];
    $e = Campaign::entryOf(Http::query('via'), Http::query('ref'), Http::query('c'));
    $show = Campaign::showing($e, (string)$ctx['store']['code'], $today);
    Http::json(['code' => $ctx['store']['code'], 'name' => $ctx['store']['name'], 'phone' => $ctx['store']['phone'], 'smsEnabled' => Sms::enabled(), 'jibaiOnly' => (bool)(int)($ctx['store']['jibaiOnly'] ?? 0), 'closures' => PublicApi::closures($ctx['store'], $today), 'consultLineUrl' => Settings::global()['consultLineUrl'],
        'campaign' => $show ? Campaign::forCustomer(Campaign::snapshot($e, (string)$ctx['store']['code'], $today), (string)$e['presetKind']) : null]);
}

function pub_week(array $p): never
{
    $ctx = pub_load_store($p[1]);
    $startParam = Http::query('start');
    $start = ($startParam && Time::isValidDate($startParam)) ? Time::mondayOf($startParam) : Time::mondayOf(Time::nowJst()['date']);
    // お連れ様の区分（同じ日時でまとめて取るとき。最大 3 人）
    $group = array_slice(array_values(array_filter(explode(',', (string)Http::query('group', '')), fn($k) => in_array($k, PublicApi::KINDS, true))), 0, 3);
    Http::json(PublicApi::weekForCustomer($ctx['store'], $ctx['setting'], $start, PublicApi::parseKind(Http::query('kind')), $group));
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
    // 予約表で「休み」「×」などの印と同じ文字は、お名前として受けない（印として扱われ、人数に数えられなくなるため）
    if (Availability::isBlockMark($name) || !Availability::isPatientText($name)) Http::error('お名前を入力してください', 400);
    $phoneRaw = is_string($b['phone'] ?? null) ? trim($b['phone']) : '';
    if (strlen($phoneRaw) < 10) Http::error('電話番号を入力してください', 400);
    $cardNo = is_string($b['cardNo'] ?? null) ? mb_substr(trim($b['cardNo']), 0, 20) : '';
    $viaCard = ($b['via'] ?? '') === 'card'; // 紹介カード（店舗えらびページ）から来た予約
    // 紹介元（業者）の専用 QR から来た予約（登録済みで止めていない紹介元だけ）
    $refCode = is_string($b['ref'] ?? null) && preg_match('/^[a-z0-9]{4,16}$/', $b['ref']) && Db::one('SELECT id FROM referral WHERE code = ? AND active = 1', [$b['ref']]) ? $b['ref'] : null;
    // その経路のキャンペーン（予約したときの内容を予約に残す）
    // URL（集客経路）の印とキャンペーン（予約したときの内容を予約に残す。キャンペーンが無くても、新患継続率のきっかけのために印は残す）
    $entry = Campaign::entryOf($viaCard ? 'card' : null, $refCode, is_string($b['c'] ?? null) ? $b['c'] : null);
    $campJson = $entry ? json_encode(Campaign::snapshot($entry, (string)$store['code'], Time::nowJst()['date']), JSON_UNESCAPED_UNICODE) : null;
    if ($kind === 'RETURN' && $cardNo === '') Http::error('診察券番号を入力してください', 400); // 再来は無くても可
    $phone = Text::normalizeJpPhone($phoneRaw);
    if (!$phone) Http::error('電話番号の形式が正しくありません', 400);

    $today = Time::nowJst()['date'];
    $day = Settings::dayRow(Db::one('SELECT * FROM day_status WHERE storeId = ? AND date = ?', [$store['id'], $date]));
    if (!PublicApi::isPublished($store, $date, $today, $day['published'] ?? null)) Http::error('この日は現在WEB予約を受け付けていません', 409);
    if (PublicApi::beyondBookDays($store, $date, $today, $kind)) Http::error('WEB でのご予約は ' . (int)$store['bookDaysAhead'] . ' 日先までです。この日のご予約はお電話（' . $store['phone'] . '）で承ります', 409);

    $lockName = 'reserve:' . $store['id'] . ':' . $date;
    $got = Db::one('SELECT GET_LOCK(?, 10) AS ok', [$lockName]);
    if (!$got || (int)$got['ok'] !== 1) Http::error('混み合っています。しばらくしてからお試しください', 503);
    try {
        $result = Db::transaction(function () use ($store, $setting, $date, $time, $kind, $name, $phone, $cardNo, $day, $viaCard, $refCode, $campJson) {
            // 同じ電話番号＋同じ氏名の予約がその日にすでにあれば二重予約として断る（氏名が違えば親子などとして受け付ける）
            $same = Db::all('SELECT name, time FROM reservation WHERE storeId = ? AND date = ? AND phone = ? AND status = ?', [$store['id'], $date, $phone, 'BOOKED']);
            foreach ($same as $r) {
                if (Text::isSameName($r['name'], $name)) {
                    // 予約の時刻は出さない（名前と電話番号だけで、ほかの人の予約の時刻を調べられないように）
                    throw new HttpError(409, '同じお名前・電話番号でのご予約が ' . Time::formatDateJa($date, false) . ' にすでに入っています。ご予約の確認・変更はお電話（' . $store['phone'] . '）へお願いします。');
                }
            }
            // 1 人が WEB で持てる予約の件数（同じ店舗・同じ電話番号と氏名・まだ来ていない予約）
            if (($max = $store['maxActiveBookings'] ?? null) !== null) {
                // お連れ様として取った予約（2人目以降）は数えない
                $mine = array_filter(Db::all('SELECT name FROM reservation WHERE storeId = ? AND phone = ? AND status = ? AND date >= ? AND (groupId IS NULL OR groupId = id)', [$store['id'], $phone, 'BOOKED', Time::nowJst()['date']]), fn($r) => Text::isSameName($r['name'], $name));
                if (count($mine) >= (int)$max) throw new HttpError(409, 'WEB でお取りいただけるご予約は ' . (int)$max . ' 件までです。次のご予約は、今のご予約のあとでお取りください（お電話でも承ります：' . $store['phone'] . '）。');
            }
            $cells = Db::all('SELECT time, bed, text FROM cell WHERE storeId = ? AND date = ? AND bed > 0', [$store['id'], $date]);
            $in = PublicApi::buildInput($store, $setting, $date, $kind, Settings::closedOf($day), $cells);
            if (!Availability::onGrid($in, $time)) throw new HttpError(409, 'この時間はご予約いただけません。表から時間を選んでください');
            $free = Availability::freeBedsAt($in, $time);
            if (Availability::newByPhoneOnly($in)) {
                throw new HttpError(409, 'はじめての方のご予約はお電話（' . $store['phone'] . '）で承っております');
            }
            $status = Availability::statusFor($in, $time, Availability::remainingAt($in, $time));
            if ($status !== 'open' && $status !== 'few') {
                throw new HttpError(409, $status === 'phone' ? 'この時間はお電話でのみ受付しております' : '申し訳ありません。ご予約の手続き中に、この時間はほかの方のご予約で埋まりました。お手数ですが、別の時間をお選びください');
            }
            $bed = $free[0];
            $rid = Db::newId();
            $token = bin2hex(random_bytes(16)); // 確認ページの URL に使う（推測できない）
            Db::exec('INSERT INTO reservation (id, storeId, date, time, bed, kind, cardNo, name, phone, status, viewToken, viaCard, refCode, campaign, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [$rid, $store['id'], $date, $time, $bed, $kind, ($kind === 'RETURN' || $kind === 'REVISIT') && $cardNo !== '' ? $cardNo : null, $name, $phone, 'BOOKED', $token, $viaCard ? 1 : 0, $refCode, $campJson, Time::nowJstDateTime()]);
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
    Http::json(['ok' => true, 'id' => $result['id'], 'token' => $result['token'], 'date' => $date, 'time' => $time, 'smsStatus' => $smsStatus, 'campaign' => Campaign::forCustomer(Campaign::decode($campJson))]);
}

/** 確認だけ（dryRun）のときに、入れた予約を取り消すための印 */
final class GroupDryRun extends RuntimeException {}

/**
 * ご家族（お連れ様）と一緒の予約（2〜4 名）。{ people: [{ kind, date, time, name, cardNo }], phone, via, ref, c, dryRun }
 * 1人目から順に入れていき、1 人でも取れなければ全員取らない（途中までの予約も残さない）。
 * お連れ様（2人目以降）の予約は「WEB で持てる予約の件数」に数えない。SMS は送らない（確認ページは完了画面から）。
 * dryRun：同じ確認をして、最後に取り消す（日時を選んだときに「全員一緒に取れるか」を確かめる）
 */
function pub_reserve_group(array $p): never
{
    $b = Http::body();
    $dry = !empty($b['dryRun']);
    if (!RateLimit::allow(($dry ? 'reservecheck:' : 'reserve:') . Http::clientIp(), $dry ? 120 : 10, 10 * 60)) Http::error('短時間に多くの操作がありました。しばらくしてからお試しください。', 429);
    $ctx = pub_load_store($p[1]);
    $store = $ctx['store'];
    $setting = $ctx['setting'];
    Http::requireJson();
    $list = is_array($b['people'] ?? null) ? array_values($b['people']) : [];
    if (count($list) < 2 || count($list) > 4) Http::error('ご予約の人数は 2〜4 名です', 400);
    $phoneRaw = is_string($b['phone'] ?? null) ? trim($b['phone']) : '';
    if (!$dry && strlen($phoneRaw) < 10) Http::error('電話番号を入力してください', 400);
    // 確認だけ（dryRun）のときは、電話番号・お名前は使わない（ほかの方の予約があるかを調べられないように。空きだけを見る）
    $phone = $dry ? '' : Text::normalizeJpPhone($phoneRaw);
    if (!$dry && !$phone) Http::error('電話番号の形式が正しくありません', 400);
    $viaCard = ($b['via'] ?? '') === 'card';
    $refCode = is_string($b['ref'] ?? null) && preg_match('/^[a-z0-9]{4,16}$/', $b['ref']) && Db::one('SELECT id FROM referral WHERE code = ? AND active = 1', [$b['ref']]) ? $b['ref'] : null;
    $entry = Campaign::entryOf($viaCard ? 'card' : null, $refCode, is_string($b['c'] ?? null) ? $b['c'] : null);
    $campJson = $entry ? json_encode(Campaign::snapshot($entry, (string)$store['code'], Time::nowJst()['date']), JSON_UNESCAPED_UNICODE) : null;
    $today = Time::nowJst()['date'];
    $who = fn(int $i, string $name = '') => ($i === 0 ? '1人目（ご本人）' : ($i + 1) . '人目（お連れ様）') . ($name !== '' ? "・{$name} 様" : '');
    $people = [];
    foreach ($list as $i => $x) {
        if (!is_array($x)) Http::error('入力内容を確認してください', 400);
        $kind = $x['kind'] ?? '';
        if (!in_array($kind, PublicApi::KINDS, true)) Http::error($who($i) . 'の来院区分を選んでください', 400);
        $date = $x['date'] ?? '';
        if (!is_string($date) || !Time::isValidDate($date)) Http::error($who($i) . 'の日にちを選んでください', 400);
        $time = Http::int($x, 'time', 0, 24 * 60);
        $name = !$dry && is_string($x['name'] ?? null) ? trim(Text::dropHonorific(trim($x['name']))) : '';
        if (!$dry && $name === '') Http::error($who($i) . 'のお名前を入力してください', 400);
        if (mb_strlen($name) > 40) Http::error($who($i) . 'のお名前が長すぎます', 400);
        if ($name !== '' && (Availability::isBlockMark($name) || !Availability::isPatientText($name))) Http::error($who($i) . 'のお名前を入力してください', 400);
        $cardNo = is_string($x['cardNo'] ?? null) ? mb_substr(trim($x['cardNo']), 0, 20) : '';
        if (!$dry && $kind === 'RETURN' && $cardNo === '') Http::error($who($i, $name) . 'の診察券番号を入力してください', 400);
        foreach ($people as $q) if ($name !== '' && Text::isSameName($q['name'], $name)) Http::error('同じお名前の方が 2 人入っています。お名前をご確認ください', 400);
        $day = Settings::dayRow(Db::one('SELECT * FROM day_status WHERE storeId = ? AND date = ?', [$store['id'], $date]));
        if (!PublicApi::isPublished($store, $date, $today, $day['published'] ?? null)) Http::error($who($i, $name) . '：この日は現在WEB予約を受け付けていません', 409);
        if (PublicApi::beyondBookDays($store, $date, $today, $kind)) Http::error($who($i, $name) . '：WEB でのご予約は ' . (int)$store['bookDaysAhead'] . ' 日先までです。この日のご予約はお電話（' . $store['phone'] . '）で承ります', 409);
        $people[] = ['kind' => $kind, 'date' => $date, 'time' => $time, 'name' => $name, 'cardNo' => $cardNo, 'day' => $day];
    }
    // 日にちごとに鍵をかける（同じ順番でかけて、ほかの予約と取り合いにならないように）
    $dates = array_values(array_unique(array_column($people, 'date')));
    sort($dates);
    $locks = [];
    try {
        foreach ($dates as $d) {
            $lockName = 'reserve:' . $store['id'] . ':' . $d;
            $got = Db::one('SELECT GET_LOCK(?, 10) AS ok', [$lockName]);
            if (!$got || (int)$got['ok'] !== 1) Http::error('混み合っています。しばらくしてからお試しください', 503);
            $locks[] = $lockName;
        }
        try {
            $result = Db::transaction(function () use ($store, $setting, $people, $phone, $viaCard, $refCode, $campJson, $who, $dry) {
                $groupId = Db::newId();
                $out = [];
                foreach ($people as $i => $x) {
                    [$kind, $date, $time, $name] = [$x['kind'], $x['date'], $x['time'], $x['name']];
                    if ($phone !== '' && $name !== '') {
                        foreach (Db::all('SELECT name FROM reservation WHERE storeId = ? AND date = ? AND phone = ? AND status = ?', [$store['id'], $date, $phone, 'BOOKED']) as $r) {
                            if (Text::isSameName($r['name'], $name)) throw new HttpError(409, $who($i, $name) . '：同じお名前・電話番号でのご予約が ' . Time::formatDateJa($date, false) . ' にすでに入っています。ご予約の確認・変更はお電話（' . $store['phone'] . '）へお願いします。');
                        }
                    }
                    // WEB で持てる予約の件数は 1人目だけ数える（お連れ様の予約は数えない）
                    if ($i === 0 && $phone !== '' && $name !== '' && ($max = $store['maxActiveBookings'] ?? null) !== null) {
                        $mine = array_filter(Db::all('SELECT name FROM reservation WHERE storeId = ? AND phone = ? AND status = ? AND date >= ? AND (groupId IS NULL OR groupId = id)', [$store['id'], $phone, 'BOOKED', Time::nowJst()['date']]), fn($r) => Text::isSameName($r['name'], $name));
                        if (count($mine) >= (int)$max) throw new HttpError(409, 'WEB でお取りいただけるご予約は ' . (int)$max . ' 件までです。次のご予約は、今のご予約のあとでお取りください（お電話でも承ります：' . $store['phone'] . '）。');
                    }
                    // 前の人を入れたあとの予約表で空きを見る（同じ時間なら別のベッドに入る）
                    $cells = Db::all('SELECT time, bed, text FROM cell WHERE storeId = ? AND date = ? AND bed > 0', [$store['id'], $date]);
                    $in = PublicApi::buildInput($store, $setting, $date, $kind, Settings::closedOf($x['day']), $cells);
                    if (!Availability::onGrid($in, $time)) throw new HttpError(409, $who($i, $name) . '：この時間はご予約いただけません。表から時間を選んでください');
                    if (Availability::newByPhoneOnly($in)) throw new HttpError(409, $who($i, $name) . '：はじめての方のご予約はお電話（' . $store['phone'] . '）で承っております');
                    $status = Availability::statusFor($in, $time, Availability::remainingAt($in, $time));
                    if ($status !== 'open' && $status !== 'few') {
                        $n = count($people);
                        throw new HttpError(409, $status === 'phone' ? $who($i, $name) . '：この時間はお電話でのみ受付しております' : ($dry
                            ? "{$n}名様ご一緒には、この時間は取れません（{$who($i)}の分の空きがありません）。別の時間をお選びください"
                            : "申し訳ありません。ご予約の手続き中に、{$who($i, $name)}の時間がほかの方のご予約で埋まりました。全員分のご予約はまだ取れていません。お手数ですが、日時を選び直してください"));
                    }
                    $free = Availability::freeBedsAt($in, $time);
                    $bed = $free[0];
                    $rid = $i === 0 ? $groupId : Db::newId();
                    $token = bin2hex(random_bytes(16));
                    Db::exec('INSERT INTO reservation (id, storeId, date, time, bed, kind, cardNo, name, phone, status, viewToken, viaCard, refCode, campaign, groupId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        [$rid, $store['id'], $date, $time, $bed, $kind, ($kind === 'RETURN' || $kind === 'REVISIT') && $x['cardNo'] !== '' ? $x['cardNo'] : null, $name !== '' ? $name : '確認中', $phone !== '' ? $phone : '0', 'BOOKED', $token, $viaCard ? 1 : 0, $refCode, $campJson, $groupId, Time::nowJstDateTime()]);
                    for ($k = 0; $k < $in['neededSlots']; $k++) {
                        $text = $k === 0 ? PublicApi::cellName($kind, $name !== '' ? $name : '確認中') : PublicApi::contText($kind);
                        Db::exec('INSERT INTO cell (id, storeId, date, time, bed, text, reservationId) VALUES (?, ?, ?, ?, ?, ?, ?)',
                            [Db::newId(), $store['id'], $date, $time + $k * $setting['slotMinutes'], $bed, $text, $rid]);
                    }
                    $out[] = ['id' => $rid, 'token' => $token, 'kind' => $kind, 'date' => $date, 'time' => $time, 'name' => $name];
                }
                if ($dry) throw new GroupDryRun('ok');
                return ['groupId' => $groupId, 'people' => $out];
            });
        } catch (GroupDryRun) {
            $result = null; // 確認だけ：入れた予約は取り消し済み
        }
    } finally {
        foreach ($locks as $l) Db::one('SELECT RELEASE_LOCK(?) AS r', [$l]);
    }
    if ($dry) Http::json(['ok' => true, 'dryRun' => true]);
    // お客様への SMS は送らない（依頼者の決定）。店舗の携帯への知らせは 1 通にまとめる
    if (!empty($store['notifyPhone'])) {
        $to = Text::normalizeJpPhone($store['notifyPhone']);
        $lines = array_map(fn($x) => Time::formatDateJa($x['date'], false) . ' ' . Time::minToHm($x['time']) . ' ' . PublicApi::KIND_JA[$x['kind']] . ' ' . (preg_replace('#(https?://|www\.)\S*#i', '', $x['name']) ?? '') . ' 様', $result['people']);
        if ($to) Sms::send($to, '【WEB予約・' . count($lines) . "名】\n" . implode("\n", $lines));
    }
    Db::exec('UPDATE reservation SET smsStatus = ? WHERE groupId = ?', ['SKIPPED', $result['groupId']]);
    Http::json(['ok' => true, 'groupId' => $result['groupId'], 'people' => $result['people'], 'campaign' => Campaign::forCustomer(Campaign::decode($campJson))]);
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
    $r = Db::one('SELECT r.date, r.time, r.kind, r.name, r.status, r.campaign, s.code, s.name AS storeName, s.phone AS storePhone FROM reservation r JOIN store s ON s.id = r.storeId WHERE r.viewToken = ?', [$p[1]]);
    if (!$r) Http::error('ご予約が見つかりません', 404);
    $today = Time::nowJst()['date'];
    $store = ['code' => $r['code'], 'name' => $r['storeName'], 'phone' => $r['storePhone']];
    $daysLeft = (int)((strtotime($r['date'] . ' 00:00:00 UTC') - strtotime($today . ' 00:00:00 UTC')) / 86400);
    // 予約日の翌日を過ぎたら中身は出さない
    if ($daysLeft < -1) Http::json(['state' => 'ENDED', 'store' => $store]);
    $state = $r['status'] === 'CANCELLED' ? 'CANCELLED' : ($daysLeft < 0 ? 'PAST' : 'BOOKED');
    Http::json(['state' => $state, 'store' => $store, 'date' => $r['date'], 'time' => (int)$r['time'], 'kind' => $r['kind'], 'name' => $r['name'], 'daysLeft' => $daysLeft, 'today' => $today, 'campaign' => Campaign::forCustomer(Campaign::decode($r['campaign']))]);
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
    // URL（紹介カード用の QR・集客経路の URL）：キャンペーンを上に出し、URL の店舗だけを並べる
    $entry = Campaign::entryOf(Http::query('from') === 'card' ? 'card' : null, Http::query('ref'), Http::query('c'));
    $campStores = $entry ? (Campaign::stores($entry['stores'] ?? null) ?: null) : null; // null＝しぼらない
    $stores = [];
    foreach (Settings::pageSort(Settings::storesInOrder('active = 1 AND listed = 1', [], false)) as $row) {
        $st = Settings::storeRow($row);
        if ($campStores !== null && !in_array($st['code'], $campStores, true)) continue;
        $stores[] = [
            'code' => $st['code'], 'name' => $st['name'], 'phone' => $st['phone'], 'address' => (string)($row['address'] ?? ''),
            'lat' => $row['lat'] !== null ? (float)$row['lat'] : null, 'lng' => $row['lng'] !== null ? (float)$row['lng'] : null,
            'area' => $areaOf[$st['code']] ?? '', 'city' => (string)($row['pageCity'] ?? ''), 'quiet' => pub_quiet_times($st, $setting, $today), 'closures' => PublicApi::closures($st, $today),
        ];
    }
    Http::json(['open' => true, 'today' => $today, 'hours' => pub_hours_summary($setting, $today), 'areas' => $areaOrder, 'stores' => $stores, 'consultLineUrl' => $setting['consultLineUrl'],
        'campaign' => Campaign::showing($entry, null, $today) ? Campaign::forCustomer(Campaign::snapshot($entry, null, $today)) : null,
        'gift' => $entry !== null && Campaign::badgeOf($entry) === Campaign::GIFT]);
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
            $byHour[$p][$h] = ($byHour[$p][$h] ?? 0) + ($s['status'] === 'open' || $s['status'] === 'few' ? $s['remaining'] : 0);
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

/**
 * LINE 公式アカウントの Webhook（LINE のサーバーから届く。署名で本物か確かめる）
 * ・本部の画面で出した 6 桁の番号がトークに送られたら、その個人・グループを新自の通知の送り先に登録して返事をする
 * ・ブロック（unfollow）・グループから退出（leave）されたら、その送り先を止める
 */
function line_webhook(): never
{
    $raw = file_get_contents('php://input') ?: '';
    if (!Line::verify($raw, (string)($_SERVER['HTTP_X_LINE_SIGNATURE'] ?? ''))) Http::error('forbidden', 403);
    $j = json_decode($raw, true);
    foreach (is_array($j['events'] ?? null) ? $j['events'] : [] as $ev) {
        $src = is_array($ev['source'] ?? null) ? $ev['source'] : [];
        $kind = (string)($src['type'] ?? '');
        $id = (string)($kind === 'group' ? ($src['groupId'] ?? '') : ($kind === 'room' ? ($src['roomId'] ?? '') : ($src['userId'] ?? '')));
        if ($id === '' || strlen($id) > 64) continue;
        $type = (string)($ev['type'] ?? '');
        if ($type === 'unfollow' || $type === 'leave') { Db::exec('UPDATE line_target SET active = 0 WHERE targetId = ?', [$id]); continue; }
        if ($type !== 'message' || ($ev['message']['type'] ?? '') !== 'text') continue;
        $text = preg_replace('/\s+/u', '', mb_convert_kana((string)($ev['message']['text'] ?? ''), 'n'));
        if (!preg_match('/^\d{6}$/', (string)$text)) continue; // ふつうのトークには返事をしない
        $reply = (string)($ev['replyToken'] ?? '');
        $t = Db::one('SELECT id, label FROM line_target WHERE code = ? AND codeExpires > NOW()', [$text]);
        if (!$t) { if ($reply !== '') Line::reply($reply, 'その番号は見つかりませんでした。本部の画面で番号を出し直してください（番号は 24 時間で使えなくなります）。'); continue; }
        Db::exec("UPDATE line_target SET targetId = ?, kind = ?, code = NULL, codeExpires = NULL, active = 1 WHERE id = ?", [$id, $kind === 'user' ? 'user' : 'group', $t['id']]);
        if ($reply !== '') Line::reply($reply, "登録しました（{$t['label']}）。新自（交通事故）・新三（第三者行為）の患者様が来院したときに、ここへお知らせが届きます。");
    }
    Http::json(['ok' => true]);
}
