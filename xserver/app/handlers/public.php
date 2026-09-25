<?php
// 顧客向け API（/api/public/{店舗コード}/...）。個人情報は返さない
declare(strict_types=1);

function pub_load_store(string $code): array
{
    $store = Settings::findStoreByCode($code);
    if (!$store || !$store['active']) throw new HttpError(404, '店舗が見つかりません');
    return ['store' => $store, 'setting' => Settings::global()];
}

/** 店舗の公開情報（名前・電話番号のみ） */
function pub_store(array $p): never
{
    $ctx = pub_load_store($p[1]);
    Http::json(['code' => $ctx['store']['code'], 'name' => $ctx['store']['name'], 'phone' => $ctx['store']['phone'], 'smsEnabled' => Sms::enabled()]);
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
    if (!in_array($kind, ['NEW', 'REVISIT', 'RETURN'], true)) Http::error('入力内容を確認してください', 400);
    $date = $b['date'] ?? '';
    if (!is_string($date) || !Time::isValidDate($date)) Http::error('日付が不正です', 400);
    $time = Http::int($b, 'time', 0, 24 * 60);
    $name = is_string($b['name'] ?? null) ? trim($b['name']) : '';
    if ($name === '') Http::error('お名前を入力してください', 400);
    if (mb_strlen($name) > 40) Http::error('お名前が長すぎます', 400);
    $phoneRaw = is_string($b['phone'] ?? null) ? trim($b['phone']) : '';
    if (strlen($phoneRaw) < 10) Http::error('電話番号を入力してください', 400);
    $cardNo = is_string($b['cardNo'] ?? null) ? mb_substr(trim($b['cardNo']), 0, 20) : '';
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
        $result = Db::transaction(function () use ($store, $setting, $date, $time, $kind, $name, $phone, $cardNo, $day) {
            // 同じ電話番号＋同じ氏名の予約がその日にすでにあれば二重予約として断る（氏名が違えば親子などとして受け付ける）
            $same = Db::all('SELECT name, time FROM reservation WHERE storeId = ? AND date = ? AND phone = ? AND status = ?', [$store['id'], $date, $phone, 'BOOKED']);
            foreach ($same as $r) {
                if (Text::isSameName($r['name'], $name)) {
                    throw new HttpError(409, '同じお名前・電話番号でのご予約が ' . Time::formatDateJa($date, false) . ' ' . Time::minToHm((int)$r['time']) . '〜 にすでに入っています。変更はお電話（' . $store['phone'] . '）へお願いします。');
                }
            }
            $cells = Db::all('SELECT time, bed, text FROM cell WHERE storeId = ? AND date = ? AND bed > 0', [$store['id'], $date]);
            $in = PublicApi::buildInput($store, $setting, $date, $kind, $day['closed'] ?? false, $cells);
            $free = Availability::freeBedsAt($in, $time);
            $status = Availability::statusFor($in, $time, Availability::remainingAt($in, $time));
            if ($status !== 'open') {
                throw new HttpError(409, $status === 'phone' ? 'この時間はお電話でのみ受付しております' : 'この時間は空きがなくなりました。別の時間をお選びください');
            }
            $bed = $free[0];
            $rid = Db::newId();
            Db::exec('INSERT INTO reservation (id, storeId, date, time, bed, kind, cardNo, name, phone, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [$rid, $store['id'], $date, $time, $bed, $kind, $kind !== 'NEW' && $cardNo !== '' ? $cardNo : null, $name, $phone, 'BOOKED', Time::nowJstDateTime()]);
            for ($k = 0; $k < $in['neededSlots']; $k++) {
                $text = $k === 0
                    ? ($kind === 'NEW' ? "{$name}（初）" : ($kind === 'REVISIT' ? "{$name}（再）" : $name))
                    : ($kind === 'REVISIT' ? '上記再来対応' : '上記初診対応');
                Db::exec('INSERT INTO cell (id, storeId, date, time, bed, text, reservationId) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [Db::newId(), $store['id'], $date, $time + $k * $setting['slotMinutes'], $bed, $text, $rid]);
            }
            return ['id' => $rid, 'bed' => $bed];
        });
    } finally {
        Db::one('SELECT RELEASE_LOCK(?) AS r', [$lockName]);
    }

    $smsBody = "【{$store['name']}】ご予約を承りました。\n" . Time::formatDateJa($date, false) . ' ' . Time::minToHm($time) . "〜\n"
        . ($kind !== 'RETURN' ? "初めての方・久しぶりの方は10分前にお越しください。\n" : '')
        . "変更・キャンセルはお電話（{$store['phone']}）へお願いします。";
    $smsStatus = Sms::send($phone, $smsBody);
    Db::exec('UPDATE reservation SET smsStatus = ? WHERE id = ?', [$smsStatus, $result['id']]);
    if (!empty($store['notifyPhone'])) {
        $to = Text::normalizeJpPhone($store['notifyPhone']);
        if ($to) Sms::send($to, '【WEB予約】' . Time::formatDateJa($date, false) . ' ' . Time::minToHm($time) . ' ' . ($kind === 'NEW' ? '初診' : ($kind === 'REVISIT' ? '再来' : '通院中')) . " {$name} 様");
    }
    Http::json(['ok' => true, 'id' => $result['id'], 'date' => $date, 'time' => $time, 'smsStatus' => $smsStatus]);
}
