<?php
// SNS 投稿管理の API（/api/admin/sns/...、/api/admin/hq/sns/...、OAuth の戻り先、LINE Webhook、cron）
declare(strict_types=1);

// ---------- 共通 ----------
/** 操作対象の店舗（店舗アカウントは自店舗、本部は切替中の店舗）。本部が ?store=コード を付けた場合はその店舗 */
function sns_ctx(): array
{
    Sns::ensureTables();
    $s = Auth::requireSession();
    $code = Http::query('store');
    if ($s['role'] === 'hq' && $code) {
        $store = Settings::findStoreByCode($code);
        if (!$store) throw new HttpError(404, '店舗が見つかりません');
        return ['session' => $s, 'store' => $store];
    }
    $store = Auth::resolveStore($s);
    if (!$store) throw new HttpError(404, '店舗が登録されていません');
    return ['session' => $s, 'store' => Settings::storeRow($store)];
}

function sns_channel(?string $ch, bool $allowAll = false): ?string
{
    if ($allowAll && ($ch === null || $ch === '' || $ch === 'all')) return null;
    if (!in_array($ch, Sns::CHANNELS, true)) throw new HttpError(400, '媒体の指定が正しくありません');
    return $ch;
}

/** 投稿 1 件（店舗アカウントは自店舗のものだけ） */
function sns_post_or_404(array $s, string $id): array
{
    $p = Db::one('SELECT p.*, s.code AS storeCode, s.name AS storeName FROM sns_post p JOIN store s ON s.id = p.storeId WHERE p.id = ?', [$id]);
    if (!$p) throw new HttpError(404, '投稿が見つかりません');
    if ($s['role'] !== 'hq' && $p['storeId'] !== $s['storeId']) throw new HttpError(403, 'forbidden');
    return $p;
}

function sns_post_with_stat(string $id): array
{
    $r = Db::one('SELECT p.*, s.code AS storeCode, s.name AS storeName, st.postId, st.reach, st.likes, st.comments, st.saved, st.shares, st.views, st.fetchedAt FROM sns_post p JOIN store s ON s.id = p.storeId LEFT JOIN sns_post_stat st ON st.postId = p.id WHERE p.id = ?', [$id]);
    return Sns::postRow($r, $r['postId'] ? $r : null);
}

/** 本文を直したときに投稿文を組み立て直す */
function sns_recompose(array $p, array $store, array $patch): array
{
    $ss = Sns::storeSetting($store);
    $title = $patch['title'] ?? $p['title'];
    $body = $patch['body'] ?? $p['body'];
    $idx = (int)($patch['patternIdx'] ?? $p['patternIdx']);
    $scheduledAt = $patch['scheduledAt'] ?? $p['scheduledAt'];
    $closing = array_key_exists('closing', $patch) ? $patch['closing'] : null;
    $hashtags = array_key_exists('hashtags', $patch) ? $patch['hashtags'] : null;
    $standalone = (bool)($patch['standalone'] ?? $p['standalone'] ?? 0);
    $c = Sns::compose($p['channel'], $store, $ss, $scheduledAt, $title, $body, $idx, $closing, $hashtags, $standalone);
    return ['title' => $title, 'body' => $body, 'patternIdx' => $idx, 'scheduledAt' => $scheduledAt, 'closing' => $c['closing'], 'hashtags' => $c['hashtags'], 'fullText' => $c['fullText'], 'standalone' => $standalone];
}

/** 内容を変えたときに承認を外す SQL 断片 */
const SNS_RESET_CHECKS = "status = 'draft', checkedAt = NULL, checkedBy = NULL, approvedAt = NULL, approvedBy = NULL";

/** 承認の前に、投稿できる内容かを確かめる（問題があれば例外） */
function sns_assert_ready(array $p, array $store): void
{
    if (mb_strlen(trim($p['postText'])) === 0) throw new HttpError(400, '本文が空です');
    $hits = Sns::complianceHits($p['postText']);
    if ($p['channel'] === 'gbp' && $hits) throw new HttpError(400, 'Google の投稿に広告規制の語が含まれています: ' . implode('、', $hits));
    $unfilled = Sns::unfilledIn($p['postText']);
    if ($unfilled) throw new HttpError(400, '埋まっていない差し込み語があります: ' . implode(' ', $unfilled) . '（この店舗の SNS 設定で値を入れるか、本文を直してください）');
    if ($p['channel'] === 'gbp') {
        $g = Sns::gbpInfoHits($p['postText'], $store, Sns::storeSetting($store));
        if ($g) throw new HttpError(400, 'Google の投稿文には GBP に載っている情報を入れません: ' . implode('、', $g) . '。本文から外してください（予約は「予約」ボタンが自動で付きます）');
    }
    if ($p['channel'] === 'ig' && !$p['imagePath'] && Sns::publishModeFor($store, 'ig') === 'api') throw new HttpError(400, 'Instagram の投稿には画像が必要です。画像ライブラリから選ぶか、写真をアップロードしてください');
}

// ---------- ホーム ----------
/** 確認待ち・手動投稿・件数のまとめ。本部は全店、店舗は自店舗 */
function sns_home(): never
{
    Sns::ensureTables();
    $s = Auth::requireSession();
    $where = $s['role'] === 'hq' ? '' : ' AND p.storeId = ' . Db::pdo()->quote($s['storeId']);
    $now = Time::nowJstDateTime();
    $pending = Db::all("SELECT p.*, s.code AS storeCode, s.name AS storeName FROM sns_post p JOIN store s ON s.id = p.storeId WHERE p.status = 'draft' $where ORDER BY p.scheduledAt ASC LIMIT 80");
    $manual = Db::all("SELECT p.*, s.code AS storeCode, s.name AS storeName FROM sns_post p JOIN store s ON s.id = p.storeId WHERE p.status IN ('draft', 'approved') AND p.publishMode = 'manual' AND p.scheduledAt <= ? $where ORDER BY p.scheduledAt ASC LIMIT 60", [Time::nowJst()['date'] . ' 23:59:59']);
    $failed = Db::all("SELECT p.*, s.code AS storeCode, s.name AS storeName FROM sns_post p JOIN store s ON s.id = p.storeId WHERE p.status = 'failed' $where ORDER BY p.scheduledAt DESC LIMIT 30");
    $counts = Db::all("SELECT s.code, s.name, p.channel, p.status, COUNT(*) AS n FROM sns_post p JOIN store s ON s.id = p.storeId WHERE s.active = 1 AND (p.status IN ('draft', 'approved', 'failed') OR p.scheduledAt >= ?) $where GROUP BY s.code, s.name, p.channel, p.status ORDER BY s.code", [Time::addDays(Time::nowJst()['date'], -30) . ' 00:00:00']);
    $byStore = [];
    foreach ($counts as $c) {
        $byStore[$c['code']] ??= ['code' => $c['code'], 'name' => $c['name'], 'ig' => ['draft' => 0, 'approved' => 0, 'posted' => 0, 'failed' => 0], 'gbp' => ['draft' => 0, 'approved' => 0, 'posted' => 0, 'failed' => 0]];
        if (isset($byStore[$c['code']][$c['channel']][$c['status']])) $byStore[$c['code']][$c['channel']][$c['status']] += (int)$c['n'];
    }
    $g = Sns::setting();
    $job = Db::one('SELECT k, ranAt FROM sns_job ORDER BY ranAt DESC LIMIT 1');
    // 接続状況のまとめ（左メニュー下とホームのカード用）
    $igEnabledStores = (int)Db::one("SELECT COUNT(*) AS n FROM sns_store_setting ss JOIN store s ON s.id = ss.storeId WHERE ss.igEnabled = 1 AND s.active = 1")['n'];
    $igConnected = (int)Db::one("SELECT COUNT(*) AS n FROM sns_account a JOIN store s ON s.id = a.storeId WHERE a.channel = 'ig' AND a.accessToken IS NOT NULL AND s.active = 1")['n'];
    $gbpMapped = (int)Db::one("SELECT COUNT(*) AS n FROM sns_account a JOIN store s ON s.id = a.storeId WHERE a.channel = 'gbp' AND a.locationName <> '' AND s.active = 1")['n'];
    $googleHq = Sns::account(null, 'gbp');
    $approvedCount = (int)Db::one("SELECT COUNT(*) AS n FROM sns_post p WHERE p.status = 'approved' $where")['n'];
    $failedCount = (int)Db::one("SELECT COUNT(*) AS n FROM sns_post p WHERE p.status = 'failed' $where")['n'];
    $pendingCount = (int)Db::one("SELECT COUNT(*) AS n FROM sns_post p WHERE p.status = 'draft' $where")['n'];
    Http::json([
        'status' => [
            'pending' => $pendingCount, 'approved' => $approvedCount, 'failed' => $failedCount,
            'ig' => ['enabled' => $igEnabledStores, 'connected' => $igConnected],
            'google' => $g['gbpManual'] ? 'manual' : (($googleHq && $googleHq['refreshToken']) ? ($gbpMapped > 0 ? 'ok' : 'nolocation') : 'none'),
            'googleMapped' => $gbpMapped,
            'line' => Notify::lineEnabled() ? 'ok' : (Notify::mailEnabled() ? 'mail' : 'none'),
        ],
        'pending' => array_map([Sns::class, 'postRow'], $pending),
        'manual' => array_map([Sns::class, 'postRow'], $manual),
        'failed' => array_map([Sns::class, 'postRow'], $failed),
        'byStore' => array_values($byStore),
        'now' => substr($now, 0, 16),
        'daysAhead' => $g['daysAhead'],
        'lastJob' => $job ? ['k' => $job['k'], 'ranAt' => $job['ranAt']] : null,
        'baseUrlOk' => Config::str('APP_URL') !== '',
        'notify' => Notify::lineEnabled() ? 'LINE' : (Notify::mailEnabled() ? 'メール' : 'なし'),
        'me' => $s['code'],
    ]);
}

// ---------- 投稿一覧・詳細・編集 ----------
function sns_posts_get(): never
{
    $ctx = sns_ctx();
    $ch = sns_channel(Http::query('channel'), true);
    $from = Http::query('from'); $to = Http::query('to');
    $today = Time::nowJst()['date'];
    if (!$from || !Time::isValidDate($from)) $from = Time::addDays($today, -14);
    if (!$to || !Time::isValidDate($to)) $to = Time::addDays($today, 70);
    $params = [$ctx['store']['id'], $from . ' 00:00:00', $to . ' 23:59:59'];
    $sql = 'SELECT p.*, s.code AS storeCode, s.name AS storeName, st.postId, st.reach, st.likes, st.comments, st.saved, st.shares, st.views, st.fetchedAt FROM sns_post p JOIN store s ON s.id = p.storeId LEFT JOIN sns_post_stat st ON st.postId = p.id WHERE p.storeId = ? AND p.scheduledAt BETWEEN ? AND ?';
    if ($ch) { $sql .= ' AND p.channel = ?'; $params[] = $ch; }
    $status = Http::query('status');
    if ($status && in_array($status, Sns::STATUSES, true)) { $sql .= ' AND p.status = ?'; $params[] = $status; }
    $rows = Db::all($sql . ' ORDER BY p.scheduledAt ASC', $params);
    $ss = Sns::storeSetting($ctx['store']);
    Http::json([
        'store' => ['code' => $ctx['store']['code'], 'name' => $ctx['store']['name']],
        'from' => $from, 'to' => $to, 'today' => $today,
        'posts' => array_map(fn($r) => Sns::postRow($r, $r['postId'] ? $r : null), $rows),
        'setting' => ['igEnabled' => $ss['igEnabled'], 'gbpEnabled' => $ss['gbpEnabled'], 'igSchedule' => Sns::describeSchedule($ss['effectiveIgSchedule']), 'gbpSchedule' => Sns::describeSchedule($ss['effectiveGbpSchedule']), 'memo' => $ss['memo']],
        'publishMode' => ['ig' => Sns::publishModeFor($ctx['store'], 'ig'), 'gbp' => Sns::publishModeFor($ctx['store'], 'gbp')],
    ]);
}

/** 手で下書きを作る */
function sns_posts_post(): never
{
    $ctx = sns_ctx();
    Http::requireJson();
    $b = Http::body();
    $ch = sns_channel($b['channel'] ?? null);
    $at = (string)($b['scheduledAt'] ?? '');
    if (!Sns::isValidDateTime($at)) Http::error('予定日時を入力してください', 400);
    $at = Sns::normalizeDateTime($at);
    $title = Http::str($b, 'title', 100, false);
    $body = Http::str($b, 'body', 1500, false);
    $topicId = isset($b['topicId']) && is_string($b['topicId']) ? $b['topicId'] : null;
    $topic = null;
    if ($topicId) {
        $topic = Db::one('SELECT * FROM sns_topic WHERE id = ? AND (storeId IS NULL OR storeId = ?)', [$topicId, $ctx['store']['id']]);
        if (!$topic) Http::error('ネタが見つかりません', 404);
    } elseif ($body === '') {
        Http::error('本文を入力するか、ネタを選んでください', 400);
    }
    $ss = Sns::storeSetting($ctx['store']);
    $id = Sns::createPost($ctx['store'], $ss, $ch, $at, $topic, random_int(0, 9), 'manual', $title, $body);
    if ($topic) Db::exec('UPDATE sns_topic SET useCount = useCount + 1, lastUsedAt = ? WHERE id = ?', [Time::nowJstDateTime(), $topic['id']]);
    Http::json(['ok' => true, 'id' => $id, 'post' => sns_post_with_stat($id)]);
}

function sns_post_get(array $mm): never
{
    Sns::ensureTables();
    $s = Auth::requireSession();
    $p = sns_post_or_404($s, $mm[1]);
    $store = Settings::findStoreById($p['storeId']);
    $ss = Sns::storeSetting($store);
    // 前後の投稿（入れ替え用）
    $prev = Db::one('SELECT id, scheduledAt FROM sns_post WHERE storeId = ? AND channel = ? AND scheduledAt < ? AND status IN (?, ?) ORDER BY scheduledAt DESC LIMIT 1', [$p['storeId'], $p['channel'], $p['scheduledAt'], 'draft', 'approved']);
    $next = Db::one('SELECT id, scheduledAt FROM sns_post WHERE storeId = ? AND channel = ? AND scheduledAt > ? AND status IN (?, ?) ORDER BY scheduledAt ASC LIMIT 1', [$p['storeId'], $p['channel'], $p['scheduledAt'], 'draft', 'approved']);
    Http::json([
        'post' => sns_post_with_stat($p['id']),
        'store' => ['code' => $store['code'], 'name' => $store['name'], 'phone' => Text::formatJpPhone($store['phone']), 'area' => $ss['area'], 'bookingUrl' => Sns::bookingUrl($store), 'memo' => $ss['memo']],
        'neighbors' => ['prev' => $prev ? ['id' => $prev['id'], 'scheduledAt' => substr($prev['scheduledAt'], 0, 16)] : null, 'next' => $next ? ['id' => $next['id'], 'scheduledAt' => substr($next['scheduledAt'], 0, 16)] : null],
        'publishMode' => Sns::publishModeFor($store, $p['channel']),
        'forbiddenWords' => Sns::setting()['forbiddenWords'],
        'me' => $s['code'],
        'gbpInfo' => $p['channel'] === 'gbp' ? Sns::gbpInfoHits($p['postText'], $store, $ss) : [],
        'openUrl' => Sns::manualOpenUrl($p['channel'], $store, $ss),
    ]);
}

/** 本文・見出し・締め・タグ・日時の編集（承認済みは下書きに戻る） */
function sns_post_put(array $mm): never
{
    Sns::ensureTables();
    $s = Auth::requireSession();
    Http::requireJson();
    $p = sns_post_or_404($s, $mm[1]);
    if (!in_array($p['status'], Sns::EDITABLE, true)) Http::error('投稿済みの内容は変更できません', 409);
    $b = Http::body();
    $patch = [];
    if (array_key_exists('title', $b)) $patch['title'] = Http::str($b, 'title', 100, false);
    if (array_key_exists('body', $b)) $patch['body'] = Http::str($b, 'body', 1800, false);
    if (array_key_exists('closing', $b)) $patch['closing'] = Http::str($b, 'closing', 300, false);
    if (array_key_exists('hashtags', $b)) $patch['hashtags'] = Http::str($b, 'hashtags', 500, false);
    if (array_key_exists('scheduledAt', $b)) {
        if (!Sns::isValidDateTime((string)$b['scheduledAt'])) Http::error('予定日時が正しくありません', 400);
        $patch['scheduledAt'] = Sns::normalizeDateTime((string)$b['scheduledAt']);
    }
    if (array_key_exists('fullText', $b)) {
        // 投稿文を直接書き換える（組み立てをやめて、その文章をそのまま使う）
        $full = Http::str($b, 'fullText', 2200, false);
        if (mb_strlen($full) > Sns::MAX_LEN[$p['channel']]) Http::error(Sns::CHANNEL_JA[$p['channel']] . ' の文字数の上限（' . Sns::MAX_LEN[$p['channel']] . ' 文字）を超えています', 400);
        Db::exec('UPDATE sns_post SET postText = ?, scheduledAt = ?, ' . SNS_RESET_CHECKS . ', error = NULL WHERE id = ?', [$full, $patch['scheduledAt'] ?? $p['scheduledAt'], $p['id']]);
        Http::json(['ok' => true, 'post' => sns_post_with_stat($p['id'])]);
    }
    $store = Settings::findStoreById($p['storeId']);
    $n = sns_recompose($p, $store, $patch);
    if (mb_strlen($n['fullText']) > Sns::MAX_LEN[$p['channel']]) Http::error(Sns::CHANNEL_JA[$p['channel']] . ' の文字数の上限（' . Sns::MAX_LEN[$p['channel']] . ' 文字）を超えています。本文を短くしてください', 400);
    Db::exec('UPDATE sns_post SET title = ?, body = ?, closing = ?, hashtags = ?, postText = ?, patternIdx = ?, scheduledAt = ?, ' . SNS_RESET_CHECKS . ', error = NULL WHERE id = ?',
        [$n['title'], $n['body'], $n['closing'], $n['hashtags'], $n['fullText'], $n['patternIdx'], $n['scheduledAt'], $p['id']]);
    Http::json(['ok' => true, 'post' => sns_post_with_stat($p['id'])]);
}

/** 承認・承認取消・削除・別のパターン・別のネタ・今すぐ投稿・投稿した（手動）・前後と入れ替え */
function sns_post_action(array $mm): never
{
    Sns::ensureTables();
    $s = Auth::requireSession();
    Http::requireJson();
    $p = sns_post_or_404($s, $mm[1]);
    $b = Http::body();
    $action = (string)($b['action'] ?? '');
    $store = Settings::findStoreById($p['storeId']);
    $now = Time::nowJstDateTime();
    switch ($action) {
        case 'approve':
            if (!in_array($p['status'], ['draft', 'failed'], true)) Http::error($p['status'] === 'approved' ? '承認済みです' : '承認できる状態ではありません', 409);
            sns_assert_ready($p, $store);
            Db::exec('UPDATE sns_post SET status = ?, approvedAt = ?, approvedBy = ?, error = NULL, manualNotifiedAt = NULL, publishMode = ? WHERE id = ?', ['approved', $now, $s['code'], Sns::publishModeFor($store, $p['channel']), $p['id']]);
            break;
        case 'unapprove':
            if ($p['status'] !== 'approved') Http::error('承認済みではありません', 409);
            Db::exec('UPDATE sns_post SET status = ?, approvedAt = NULL, approvedBy = NULL WHERE id = ?', ['draft', $p['id']]);
            break;
        case 'delete':
            if (in_array($p['status'], ['publishing'], true)) Http::error('投稿中のため削除できません', 409);
            if ($p['imagePath']) @unlink(Sns::mediaDir() . '/' . basename($p['imagePath']));
            Db::exec('DELETE FROM sns_post WHERE id = ?', [$p['id']]);
            Http::json(['ok' => true, 'deleted' => true]);
        case 'regenerate': // 別のパターン（文章の型を次へ）
            if (!in_array($p['status'], Sns::EDITABLE, true)) Http::error('投稿済みの内容は変更できません', 409);
            $n = sns_recompose($p, $store, ['patternIdx' => (int)$p['patternIdx'] + 1]);
            Db::exec('UPDATE sns_post SET closing = ?, hashtags = ?, postText = ?, patternIdx = ?, ' . SNS_RESET_CHECKS . ' WHERE id = ?', [$n['closing'], $n['hashtags'], $n['fullText'], $n['patternIdx'], $p['id']]);
            break;
        case 'retopic': // 別の定型投稿
            if (!in_array($p['status'], Sns::EDITABLE, true)) Http::error('投稿済みの内容は変更できません', 409);
            $topicId = isset($b['topicId']) && is_string($b['topicId']) ? $b['topicId'] : null;
            $topic = $topicId
                ? Db::one('SELECT * FROM sns_topic WHERE id = ? AND (storeId IS NULL OR storeId = ?)', [$topicId, $p['storeId']])
                : Sns::pickTopic($p['storeId'], $p['channel'], $p['scheduledAt'], $p['topicId'] ? [$p['topicId']] : []);
            if (!$topic) Http::error('使えるネタがありません。「ネタ」から追加してください', 404);
            $n = sns_recompose($p, $store, ['title' => $topic['title'], 'body' => $topic['body'], 'standalone' => (bool)($topic['standalone'] ?? 1)]);
            Db::exec('UPDATE sns_post SET topicId = ?, title = ?, body = ?, closing = ?, hashtags = ?, postText = ?, standalone = ?, ' . SNS_RESET_CHECKS . ' WHERE id = ?', [$topic['id'], $n['title'], $n['body'], $n['closing'], $n['hashtags'], $n['fullText'], $n['standalone'] ? 1 : 0, $p['id']]);
            if (!empty($topic['imagePath']) && ($p['imageKind'] === 'none' || $p['imageKind'] === 'topic')) {
                [$img, $kind] = Sns::copyTopicImage($topic, $p['id']);
                if ($img) { if ($p['imagePath']) @unlink(Sns::mediaDir() . '/' . basename($p['imagePath'])); Db::exec('UPDATE sns_post SET imagePath = ?, imageKind = ? WHERE id = ?', [$img, $kind, $p['id']]); }
            }
            Db::exec('UPDATE sns_topic SET useCount = useCount + 1, lastUsedAt = ? WHERE id = ?', [$now, $topic['id']]);
            break;
        case 'publish_now':
            if ($p['status'] !== 'approved') Http::error('承認してから投稿してください', 409);
            $r = SnsCron::publishPost($p, true);
            if ($r === 'manual') Http::error('この媒体は API で投稿できる設定になっていません（手動投稿）。本文をコピーして投稿し、「投稿した」を押してください', 409);
            $after = sns_post_with_stat($p['id']);
            if ($r !== 'posted') Http::error($after['error'] ?? '投稿に失敗しました', 502);
            Http::json(['ok' => true, 'post' => $after]);
        case 'mark_posted': // 手動で投稿したことを記録（承認済みのもの。未承認なら内容の確認を通してから記録する）
            if (!in_array($p['status'], ['approved', 'draft', 'failed'], true)) Http::error('この状態では記録できません', 409);
            if ($p['status'] !== 'approved') sns_assert_ready($p, $store);
            $link = isset($b['permalink']) && is_string($b['permalink']) ? mb_substr(trim($b['permalink']), 0, 300) : null;
            Db::exec('UPDATE sns_post SET status = ?, postedAt = ?, publishMode = ?, permalink = ?, error = NULL, approvedAt = COALESCE(approvedAt, ?), approvedBy = COALESCE(approvedBy, ?) WHERE id = ?', ['posted', $now, 'manual', $link ?: null, $now, $s['code'], $p['id']]);
            break;
        case 'swap': // 前後の投稿と中身を入れ替える（日時はそのまま）
            if (!in_array($p['status'], Sns::EDITABLE, true)) Http::error('投稿済みの内容は入れ替えられません', 409);
            $otherId = (string)($b['withId'] ?? '');
            $o = Db::one('SELECT * FROM sns_post WHERE id = ? AND storeId = ? AND channel = ? AND status IN (?, ?)', [$otherId, $p['storeId'], $p['channel'], 'draft', 'approved']);
            if (!$o) Http::error('入れ替え先が見つかりません', 404);
            Db::transaction(function () use ($p, $o, $store) {
                foreach ([[$p, $o], [$o, $p]] as [$dst, $src]) {
                    $n = sns_recompose($src, $store, ['scheduledAt' => $dst['scheduledAt']]);
                    Db::exec('UPDATE sns_post SET topicId = ?, title = ?, body = ?, closing = ?, hashtags = ?, postText = ?, patternIdx = ?, standalone = ?, imagePath = ?, imageKind = ?, ' . SNS_RESET_CHECKS . ' WHERE id = ?',
                        [$src['topicId'], $n['title'], $n['body'], $n['closing'], $n['hashtags'], $n['fullText'], $n['patternIdx'], $n['standalone'] ? 1 : 0, $src['imagePath'], $src['imageKind'], $dst['id']]);
                }
            });
            break;
        default:
            Http::error('bad request', 400);
    }
    Http::json(['ok' => true, 'post' => sns_post_with_stat($p['id'])]);
}

/** 画像の保存（ブラウザで描いた PNG／選んだ写真を JPEG にして送る。JSON の dataUrl） */
function sns_post_image(array $mm): never
{
    Sns::ensureTables();
    $s = Auth::requireSession();
    Http::requireJson();
    $p = sns_post_or_404($s, $mm[1]);
    if (!in_array($p['status'], Sns::EDITABLE, true)) Http::error('投稿済みの画像は変更できません', 409);
    $b = Http::body();
    if (($b['remove'] ?? false) === true) {
        if ($p['imagePath']) @unlink(Sns::mediaDir() . '/' . basename($p['imagePath']));
        Db::exec('UPDATE sns_post SET imagePath = NULL, imageKind = ?, ' . SNS_RESET_CHECKS . ' WHERE id = ?', ['none', $p['id']]);
        Http::json(['ok' => true, 'post' => sns_post_with_stat($p['id'])]);
    }
    if (isset($b['mediaId']) && is_string($b['mediaId'])) { // 画像ライブラリから選ぶ
        [$img, $kind] = Sns::assignLibraryImage($p['storeId'], $p['channel'], $p['id'], $b['mediaId']);
        if (!$img) Http::error('画像が見つかりません', 404);
        if ($p['imagePath']) @unlink(Sns::mediaDir() . '/' . basename($p['imagePath']));
        Db::exec('UPDATE sns_post SET imagePath = ?, imageKind = ?, ' . SNS_RESET_CHECKS . ' WHERE id = ?', [$img, $kind, $p['id']]);
        Http::json(['ok' => true, 'post' => sns_post_with_stat($p['id'])]);
    }
    $bin = sns_decode_jpeg((string)($b['dataUrl'] ?? ''));
    $kind = in_array($b['kind'] ?? '', ['template', 'upload'], true) ? $b['kind'] : 'upload';
    $name = $p['id'] . '-' . substr(bin2hex(random_bytes(4)), 0, 8) . '.jpg';
    $dir = Sns::mediaDir();
    if (!is_dir($dir) || !is_writable($dir)) Http::error('画像の保存先（public/media/sns）に書き込めません。フォルダの権限を確認してください', 500);
    if (file_put_contents($dir . '/' . $name, $bin) === false) Http::error('画像を保存できませんでした', 500);
    if ($p['imagePath']) @unlink($dir . '/' . basename($p['imagePath']));
    Db::exec('UPDATE sns_post SET imagePath = ?, imageKind = ?, ' . SNS_RESET_CHECKS . ' WHERE id = ?', [$name, $kind, $p['id']]);
    Http::json(['ok' => true, 'post' => sns_post_with_stat($p['id'])]);
}

/** 先の下書きを今すぐ作る（店舗：自店舗、本部：?store=all で全店） */
function sns_generate(): never
{
    Sns::ensureTables();
    $s = Auth::requireSession();
    Http::requireJson();
    $days = Http::query('days');
    $days = $days !== null && is_numeric($days) ? max(1, min(120, (int)$days)) : null;
    if ($s['role'] === 'hq' && Http::query('store') === 'all') {
        Http::json(['ok' => true] + SnsCron::generateAll($days));
    }
    $ctx = sns_ctx();
    $res = ['created' => 0, 'missingTopics' => 0];
    foreach (Sns::CHANNELS as $ch) {
        $r = Sns::generateDrafts($ctx['store'], $ch, $days, 30);
        $res['created'] += $r['created']; $res['missingTopics'] += $r['missingTopics'];
    }
    Http::json(['ok' => true] + $res);
}

// ---------- ネタ ----------
function sns_topics_get(): never
{
    $ctx = sns_ctx();
    $rows = Db::all('SELECT * FROM sns_topic WHERE storeId = ? OR storeId IS NULL ORDER BY (storeId IS NULL) ASC, sortOrder ASC, createdAt ASC', [$ctx['store']['id']]);
    $g = Sns::setting();
    $vars = [];
    foreach (Sns::BUILTIN_VARS as $k => $desc) $vars[] = ['key' => $k, 'label' => $desc, 'builtin' => true];
    foreach ($g['customVars'] as $cv) $vars[] = ['key' => $cv['key'], 'label' => $cv['label'] . ($cv['default'] !== '' ? '（既定：' . $cv['default'] . '）' : ''), 'builtin' => false];
    $storeCount = (int)Db::one('SELECT COUNT(*) AS n FROM store WHERE active = 1')['n'];
    Http::json(['store' => ['code' => $ctx['store']['code'], 'name' => $ctx['store']['name']], 'isHq' => $ctx['session']['role'] === 'hq', 'topics' => array_map([Sns::class, 'topicRow'], $rows), 'vars' => $vars, 'storeCount' => $storeCount]);
}

function sns_topics_post(): never
{
    $ctx = sns_ctx();
    Http::requireJson();
    $b = Http::body();
    $shared = ($b['shared'] ?? false) === true;
    if ($shared && $ctx['session']['role'] !== 'hq') Http::error('全店共通のネタは本部だけが追加できます', 403);
    $ch = $b['channel'] ?? 'both';
    if (!in_array($ch, ['ig', 'gbp', 'both'], true)) $ch = 'both';
    $title = Http::str($b, 'title', 100, false);
    $body = Http::str($b, 'body', 1500);
    $months = sns_months($b['months'] ?? '');
    $standalone = array_key_exists('standalone', $b) ? Http::bool($b, 'standalone') : true;
    sns_assert_topic_gbp($ch, $body);
    $id = Db::newId();
    $max = Db::one('SELECT COALESCE(MAX(sortOrder), 0) AS m FROM sns_topic WHERE ' . ($shared ? 'storeId IS NULL' : 'storeId = ?'), $shared ? [] : [$ctx['store']['id']]);
    Db::exec('INSERT INTO sns_topic (id, storeId, channel, title, body, standalone, months, sortOrder) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [$id, $shared ? null : $ctx['store']['id'], $ch, $title, $body, $standalone ? 1 : 0, $months, (int)$max['m'] + 1]);
    Http::json(['ok' => true, 'id' => $id, 'unknownPlaceholders' => Sns::unknownPlaceholders($body)]);
}

function sns_months(mixed $v): string
{
    $list = is_array($v) ? $v : Sns::splitList((string)$v);
    $out = [];
    foreach ($list as $m) { $m = (int)$m; if ($m >= 1 && $m <= 12) $out[] = $m; }
    return implode(',', array_unique($out));
}

function sns_topics_put(): never
{
    $ctx = sns_ctx();
    Http::requireJson();
    $b = Http::body();
    $t = Db::one('SELECT * FROM sns_topic WHERE id = ?', [(string)($b['id'] ?? '')]);
    if (!$t) Http::error('ネタが見つかりません', 404);
    if ($t['storeId'] === null ? $ctx['session']['role'] !== 'hq' : $t['storeId'] !== $ctx['store']['id']) Http::error('forbidden', 403);
    $action = (string)($b['action'] ?? 'update');
    if ($action === 'delete') {
        Db::exec('DELETE FROM sns_topic WHERE id = ?', [$t['id']]);
        Http::json(['ok' => true]);
    }
    if ($action === 'bulk_delete') {
        $ids = array_values(array_filter($b['ids'] ?? [], 'is_string'));
        if ($ids) Db::exec('DELETE FROM sns_topic WHERE id IN (' . Db::inList($ids) . ') AND ' . ($ctx['session']['role'] === 'hq' ? '(storeId IS NULL OR storeId = ?)' : 'storeId = ?'), array_merge($ids, [$ctx['store']['id']]));
        Http::json(['ok' => true]);
    }
    $ch = in_array($b['channel'] ?? $t['channel'], ['ig', 'gbp', 'both'], true) ? ($b['channel'] ?? $t['channel']) : $t['channel'];
    $title = array_key_exists('title', $b) ? Http::str($b, 'title', 100, false) : $t['title'];
    $body = array_key_exists('body', $b) ? Http::str($b, 'body', 1500) : $t['body'];
    $months = array_key_exists('months', $b) ? sns_months($b['months']) : $t['months'];
    $active = array_key_exists('active', $b) ? Http::bool($b, 'active') : (bool)$t['active'];
    $standalone = array_key_exists('standalone', $b) ? Http::bool($b, 'standalone') : (bool)($t['standalone'] ?? 1);
    sns_assert_topic_gbp($ch, $body);
    Db::exec('UPDATE sns_topic SET channel = ?, title = ?, body = ?, months = ?, active = ?, standalone = ? WHERE id = ?', [$ch, $title, $body, $months, $active ? 1 : 0, $standalone ? 1 : 0, $t['id']]);
    Http::json(['ok' => true, 'unknownPlaceholders' => Sns::unknownPlaceholders($body)]);
}

/** Google 用（または両方）の定型投稿に、GBP に載っている情報（電話・住所・営業時間・URL）が無いか */
function sns_assert_topic_gbp(string $channel, string $body): void
{
    if ($channel === 'ig') return;
    $vars = Sns::gbpForbiddenVarsIn($body);
    if ($vars) throw new HttpError(400, 'Google 用の定型投稿に ' . implode(' ', $vars) . ' は使えません（GBP に載っている情報は投稿文に入れないルール）。Instagram 専用の定型投稿にするか、外してください');
    $hits = Sns::gbpInfoHits($body);
    if ($hits) throw new HttpError(400, 'Google 用の定型投稿に GBP に載っている情報が含まれています: ' . implode('、', $hits) . '。外してください');
}

/** 定型投稿 1 件（権限確認つき） */
function sns_topic_or_404(array $ctx, string $id): array
{
    $t = Db::one('SELECT * FROM sns_topic WHERE id = ?', [$id]);
    if (!$t) throw new HttpError(404, '定型投稿が見つかりません');
    if ($t['storeId'] === null ? $ctx['session']['role'] !== 'hq' : $t['storeId'] !== $ctx['store']['id']) throw new HttpError(403, 'forbidden');
    return $t;
}

/** 定型投稿の画像（JPEG の dataUrl を保存／remove で外す） */
function sns_topic_image(array $mm): never
{
    $ctx = sns_ctx();
    Http::requireJson();
    $t = sns_topic_or_404($ctx, $mm[1]);
    $b = Http::body();
    $dir = Sns::mediaDir();
    if (($b['remove'] ?? false) === true) {
        if ($t['imagePath']) @unlink($dir . '/' . basename($t['imagePath']));
        Db::exec('UPDATE sns_topic SET imagePath = NULL WHERE id = ?', [$t['id']]);
        Http::json(['ok' => true]);
    }
    if (isset($b['mediaId']) && is_string($b['mediaId'])) { // 画像ライブラリから選ぶ（コピーして持つ）
        $m = Db::one('SELECT * FROM sns_media WHERE id = ? AND (storeId IS NULL OR storeId = ?)', [$b['mediaId'], $ctx['store']['id']]);
        $src = $m ? $dir . '/' . basename($m['path']) : '';
        if (!$m || !is_file($src)) Http::error('画像が見つかりません', 404);
        $name = 'topic-' . $t['id'] . '-' . substr(bin2hex(random_bytes(4)), 0, 8) . '.jpg';
        if (!@copy($src, $dir . '/' . $name)) Http::error('画像をコピーできませんでした', 500);
        if ($t['imagePath']) @unlink($dir . '/' . basename($t['imagePath']));
        Db::exec('UPDATE sns_topic SET imagePath = ? WHERE id = ?', [$name, $t['id']]);
        Http::json(['ok' => true, 'imageUrl' => Sns::mediaUrl($name)]);
    }
    $bin = sns_decode_jpeg((string)($b['dataUrl'] ?? ''));
    $name = 'topic-' . $t['id'] . '-' . substr(bin2hex(random_bytes(4)), 0, 8) . '.jpg';
    if (!is_dir($dir) || !is_writable($dir)) Http::error('画像の保存先（public/media/sns）に書き込めません。フォルダの権限を確認してください', 500);
    if (file_put_contents($dir . '/' . $name, $bin) === false) Http::error('画像を保存できませんでした', 500);
    if ($t['imagePath']) @unlink($dir . '/' . basename($t['imagePath']));
    Db::exec('UPDATE sns_topic SET imagePath = ? WHERE id = ?', [$name, $t['id']]);
    Http::json(['ok' => true, 'imageUrl' => Sns::mediaUrl($name)]);
}

/** data:image/jpeg;base64 を検証して中身を返す */
function sns_decode_jpeg(string $data): string
{
    if (!preg_match('#^data:image/jpeg;base64,([A-Za-z0-9+/=]+)$#', $data, $m)) throw new HttpError(400, 'JPEG 画像を送ってください');
    $bin = base64_decode($m[1], true);
    if ($bin === false || strlen($bin) < 1000) throw new HttpError(400, '画像を読めませんでした');
    if (strlen($bin) > 8 * 1024 * 1024) throw new HttpError(400, '画像は 8MB までにしてください');
    $info = @getimagesizefromstring($bin);
    if (!$info || $info[2] !== IMAGETYPE_JPEG) throw new HttpError(400, 'JPEG 画像を送ってください');
    if ($info[0] < 320 || $info[1] < 320) throw new HttpError(400, '画像が小さすぎます（320px 以上）');
    return $bin;
}

/**
 * 定型投稿を複数店舗に一斉に下書き化する（本部）。各店舗の差し込み語で置き換わった下書きができ、店舗（または本部）が承認して投稿される
 * body: {channel, scheduledAt, stores: 'all' | [店舗コード...]}。各店舗（または本部）が承認すると投稿される
 */
function hq_sns_topic_broadcast(array $mm): never
{
    Sns::ensureTables();
    $s = Auth::requireHq();
    Http::requireJson();
    $t = Db::one('SELECT * FROM sns_topic WHERE id = ?', [$mm[1]]);
    if (!$t) Http::error('定型投稿が見つかりません', 404);
    $b = Http::body();
    $ch = sns_channel($b['channel'] ?? null);
    if ($t['channel'] !== 'both' && $t['channel'] !== $ch) Http::error('この定型投稿は ' . Sns::CHANNEL_JA[$t['channel']] . ' 用です', 400);
    $at = (string)($b['scheduledAt'] ?? '');
    if (!Sns::isValidDateTime($at)) Http::error('予定日時を入力してください', 400);
    $at = Sns::normalizeDateTime($at);
    if ($at < Time::nowJstDateTime()) Http::error('予定日時は今より後にしてください', 400);
    $codes = $b['stores'] ?? 'all';
    $stores = $codes === 'all'
        ? Db::all('SELECT * FROM store WHERE active = 1 ORDER BY code ASC')
        : (is_array($codes) && $codes ? Db::all('SELECT * FROM store WHERE active = 1 AND code IN (' . Db::inList($codes) . ') ORDER BY code ASC', array_values(array_filter($codes, 'is_string'))) : []);
    if ($t['storeId'] !== null) $stores = array_values(array_filter($stores, fn($st) => $st['id'] === $t['storeId']));
    $created = []; $skipped = []; $unfilled = [];
    foreach ($stores as $st) {
        $st = Settings::storeRow($st);
        $ss = Sns::storeSetting($st);
        if (!($ch === 'ig' ? $ss['igEnabled'] : $ss['gbpEnabled'])) { $skipped[] = $st['name'] . '（' . Sns::CHANNEL_JA[$ch] . ' を使わない設定）'; continue; }
        if (Db::one('SELECT id FROM sns_post WHERE storeId = ? AND channel = ? AND topicId = ? AND scheduledAt = ?', [$st['id'], $ch, $t['id'], $at])) { $skipped[] = $st['name'] . '（同じ日時に作成済み）'; continue; }
        $id = Sns::createPost($st, $ss, $ch, $at, $t, random_int(0, 9), 'manual');
        $row = Db::one('SELECT postText, imagePath FROM sns_post WHERE id = ?', [$id]);
        $miss = Sns::unfilledIn($row['postText']);
        if ($miss) $unfilled[] = $st['name'] . '：' . implode(' ', $miss);
        $created[] = $st['name'];
    }
    if ($created) Db::exec('UPDATE sns_topic SET useCount = useCount + ?, lastUsedAt = ? WHERE id = ?', [count($created), Time::nowJstDateTime(), $t['id']]);
    Http::json(['ok' => true, 'created' => count($created), 'skipped' => $skipped, 'unfilled' => $unfilled]);
}

// ---------- 画像ライブラリ ----------
function sns_media_get(): never
{
    $ctx = sns_ctx();
    $rows = Db::all('SELECT * FROM sns_media WHERE storeId = ? OR storeId IS NULL ORDER BY (storeId IS NULL) ASC, createdAt DESC', [$ctx['store']['id']]);
    Http::json(['store' => ['code' => $ctx['store']['code'], 'name' => $ctx['store']['name']], 'isHq' => $ctx['session']['role'] === 'hq', 'media' => array_map([Sns::class, 'mediaRow'], $rows)]);
}

/** 1 枚ずつアップロード（画面側で複数ファイルを順に送る）。{dataUrl, label?, channel?, shared?} */
function sns_media_post(): never
{
    $ctx = sns_ctx();
    Http::requireJson();
    $b = Http::body();
    $shared = ($b['shared'] ?? false) === true;
    if ($shared && $ctx['session']['role'] !== 'hq') Http::error('全店共通の画像は本部だけが追加できます', 403);
    $bin = sns_decode_jpeg((string)($b['dataUrl'] ?? ''));
    $info = getimagesizefromstring($bin);
    $dir = Sns::mediaDir();
    if (!is_dir($dir) || !is_writable($dir)) Http::error('画像の保存先（public/media/sns）に書き込めません。フォルダの権限を確認してください', 500);
    $id = Db::newId();
    $name = 'lib-' . $id . '.jpg';
    if (file_put_contents($dir . '/' . $name, $bin) === false) Http::error('画像を保存できませんでした', 500);
    $ch = $b['channel'] ?? 'both';
    if (!in_array($ch, ['ig', 'gbp', 'both'], true)) $ch = 'both';
    Db::exec('INSERT INTO sns_media (id, storeId, path, label, channel, width, height) VALUES (?, ?, ?, ?, ?, ?, ?)', [$id, $shared ? null : $ctx['store']['id'], $name, Http::str($b, 'label', 100, false), $ch, (int)$info[0], (int)$info[1]]);
    Http::json(['ok' => true, 'media' => Sns::mediaRow(Db::one('SELECT * FROM sns_media WHERE id = ?', [$id]))]);
}

/** メモ・媒体・使う／使わない・削除（まとめて削除は ids） */
function sns_media_put(): never
{
    $ctx = sns_ctx();
    Http::requireJson();
    $b = Http::body();
    $own = fn(array $m) => $m['storeId'] === null ? $ctx['session']['role'] === 'hq' : $m['storeId'] === $ctx['store']['id'];
    $action = (string)($b['action'] ?? 'update');
    if ($action === 'bulk_delete') {
        $ids = array_values(array_filter($b['ids'] ?? [], 'is_string'));
        $n = 0;
        foreach ($ids ? Db::all('SELECT * FROM sns_media WHERE id IN (' . Db::inList($ids) . ')', $ids) : [] as $m) {
            if (!$own($m)) continue;
            @unlink(Sns::mediaDir() . '/' . basename($m['path']));
            Db::exec('DELETE FROM sns_media WHERE id = ?', [$m['id']]);
            $n++;
        }
        Http::json(['ok' => true, 'deleted' => $n]);
    }
    $m = Db::one('SELECT * FROM sns_media WHERE id = ?', [(string)($b['id'] ?? '')]);
    if (!$m) Http::error('画像が見つかりません', 404);
    if (!$own($m)) Http::error('forbidden', 403);
    if ($action === 'delete') {
        @unlink(Sns::mediaDir() . '/' . basename($m['path']));
        Db::exec('DELETE FROM sns_media WHERE id = ?', [$m['id']]);
        Http::json(['ok' => true]);
    }
    $label = array_key_exists('label', $b) ? Http::str($b, 'label', 100, false) : $m['label'];
    $ch = in_array($b['channel'] ?? $m['channel'], ['ig', 'gbp', 'both'], true) ? ($b['channel'] ?? $m['channel']) : $m['channel'];
    $active = array_key_exists('active', $b) ? Http::bool($b, 'active') : (bool)$m['active'];
    Db::exec('UPDATE sns_media SET label = ?, channel = ?, active = ? WHERE id = ?', [$label, $ch, $active ? 1 : 0, $m['id']]);
    Http::json(['ok' => true]);
}

/** https:// で始まる URL だけ受け付ける（空は可） */
function sns_url_or_empty(string $u): string
{
    if ($u === '') return '';
    if (!preg_match('#^https://[^\s]+$#u', $u)) throw new HttpError(400, 'URL は https:// から始めてください');
    return $u;
}

// ---------- 手動投稿（API を使わずに人が投稿する分） ----------
/** 期限が来た／今日／今後 7 日の手動投稿を店舗ごとにまとめる。本文・画像・開く URL を付けて、コピー → 投稿 → 記録 の流れを 1 画面で済ませる */
function sns_manual_get(): never
{
    Sns::ensureTables();
    $s = Auth::requireSession();
    $where = $s['role'] === 'hq' ? '' : ' AND p.storeId = ' . Db::pdo()->quote($s['storeId']);
    $today = Time::nowJst()['date'];
    $until = Time::addDays($today, 7) . ' 23:59:59';
    $g = Sns::setting();
    // 手動扱い：publishMode = manual のもの、または Google 手動運用のときの Google 投稿すべて（未投稿）
    $rows = Db::all("SELECT p.*, s.code AS storeCode, s.name AS storeName FROM sns_post p JOIN store s ON s.id = p.storeId
        WHERE p.status IN ('draft', 'approved', 'failed') AND p.scheduledAt <= ? AND (p.publishMode = 'manual'" . ($g['gbpManual'] ? " OR p.channel = 'gbp'" : '') . ") $where ORDER BY p.scheduledAt ASC", [$until]);
    $ssCache = []; $out = [];
    foreach ($rows as $r) {
        $store = $ssCache[$r['storeId']]['store'] ?? null;
        if (!$store) { $store = Settings::findStoreById($r['storeId']); $ssCache[$r['storeId']] = ['store' => $store, 'ss' => Sns::storeSetting($store)]; }
        $ss = $ssCache[$r['storeId']]['ss'];
        $row = Sns::postRow($r);
        $row['openUrl'] = Sns::manualOpenUrl($r['channel'], $store, $ss);
        $row['openUrlIsSearch'] = $r['channel'] === 'gbp' && $ss['gbpPostUrl'] === '';
        $row['ready'] = true; $row['issues'] = [];
        try { sns_assert_ready($r, $store); } catch (HttpError $e) { $row['ready'] = false; $row['issues'][] = $e->getMessage(); }
        $d = substr($r['scheduledAt'], 0, 10);
        $row['bucket'] = $d < $today ? 'overdue' : ($d === $today ? 'today' : 'upcoming');
        $out[] = $row;
    }
    Http::json(['today' => $today, 'now' => substr(Time::nowJstDateTime(), 0, 16), 'posts' => $out, 'gbpManual' => $g['gbpManual'],
        'counts' => ['overdue' => count(array_filter($out, fn($x) => $x['bucket'] === 'overdue')), 'today' => count(array_filter($out, fn($x) => $x['bucket'] === 'today')), 'upcoming' => count(array_filter($out, fn($x) => $x['bucket'] === 'upcoming'))]]);
}

// ---------- 店舗の設定 ----------
function sns_settings_get(): never
{
    $ctx = sns_ctx();
    $ss = Sns::storeSetting($ctx['store']);
    $g = Sns::setting();
    $ig = Sns::account($ctx['store']['id'], 'ig');
    $gbp = Sns::account($ctx['store']['id'], 'gbp');
    Http::json([
        'store' => ['code' => $ctx['store']['code'], 'name' => $ctx['store']['name'], 'phone' => $ctx['store']['phone'], 'bookingUrl' => Sns::bookingUrl($ctx['store'])],
        'setting' => $ss,
        'defaults' => ['igSchedule' => $g['defaultIgSchedule'], 'gbpSchedule' => $g['defaultGbpSchedule'], 'hashtagBase' => $g['hashtagBase'], 'daysAhead' => $g['daysAhead']],
        'customVars' => $g['customVars'],
        'patterns' => $g['patterns'],
        'accounts' => ['ig' => Sns::accountRow($ig), 'gbp' => Sns::accountRow($gbp)],
        'igConfigured' => Instagram::configured(),
        'googleConnected' => (bool)(Sns::account(null, 'gbp')['refreshToken'] ?? null),
        'gbpManual' => $g['gbpManual'],
        'isHq' => $ctx['session']['role'] === 'hq',
        'baseUrl' => Sns::baseUrl(),
        'appUrlSet' => Config::str('APP_URL') !== '',
    ]);
}

function sns_settings_put(): never
{
    $ctx = sns_ctx();
    Http::requireJson();
    $b = Http::body();
    $cur = Sns::storeSetting($ctx['store']);
    $sched = function (string $k) use ($b, $cur) {
        if (!array_key_exists($k, $b)) return $cur[$k];
        if ($b[$k] === null) return null;
        $s = Sns::parseSchedule($b[$k]);
        if (!$s) throw new HttpError(400, '頻度の指定が正しくありません');
        return $s;
    };
    $v = [
        'igEnabled' => array_key_exists('igEnabled', $b) ? Http::bool($b, 'igEnabled') : $cur['igEnabled'],
        'gbpEnabled' => array_key_exists('gbpEnabled', $b) ? Http::bool($b, 'gbpEnabled') : $cur['gbpEnabled'],
        'igSchedule' => $sched('igSchedule'),
        'gbpSchedule' => $sched('gbpSchedule'),
        'area' => array_key_exists('area', $b) ? Http::str($b, 'area', 50, false) : $cur['area'],
        'address' => array_key_exists('address', $b) ? Http::str($b, 'address', 100, false) : $cur['address'],
        'hoursText' => array_key_exists('hoursText', $b) ? Http::str($b, 'hoursText', 200, false) : $cur['hoursText'],
        'hashtags' => array_key_exists('hashtags', $b) ? Http::str($b, 'hashtags', 500, false) : $cur['hashtags'],
        'keywordsFixed' => array_key_exists('keywordsFixed', $b) ? Http::str($b, 'keywordsFixed', 300, false) : $cur['keywordsFixed'],
        'keywordsRotation' => array_key_exists('keywordsRotation', $b) ? Http::str($b, 'keywordsRotation', 500, false) : $cur['keywordsRotation'],
        'memo' => array_key_exists('memo', $b) ? Http::str($b, 'memo', 2000, false) : $cur['memo'],
        'vars' => array_key_exists('vars', $b) ? Sns::parseVars($b['vars']) : $cur['vars'],
        'gbpPostUrl' => array_key_exists('gbpPostUrl', $b) ? sns_url_or_empty(Http::str($b, 'gbpPostUrl', 300, false)) : $cur['gbpPostUrl'],
        'igProfileUrl' => array_key_exists('igProfileUrl', $b) ? sns_url_or_empty(Http::str($b, 'igProfileUrl', 300, false)) : $cur['igProfileUrl'],
    ];
    Sns::saveStoreSetting($ctx['store']['id'], $v);
    Http::json(['ok' => true, 'refilled' => Sns::refillDrafts($ctx['store']['id'])]);
}

/** 投稿文の見本（設定画面でパターンを確かめる） */
function sns_preview(): never
{
    $ctx = sns_ctx();
    Http::requireJson();
    $b = Http::body();
    $ch = sns_channel($b['channel'] ?? null);
    $ss = Sns::storeSetting($ctx['store']);
    foreach (['area', 'address', 'hoursText', 'hashtags', 'keywordsFixed', 'keywordsRotation'] as $k) if (isset($b[$k]) && is_string($b[$k])) $ss[$k] = trim($b[$k]);
    if (isset($b['vars']) && is_array($b['vars'])) $ss['vars'] = Sns::parseVars($b['vars']);
    $standalone = ($b['standalone'] ?? false) === true;
    $c = Sns::compose($ch, $ctx['store'], $ss, Time::nowJst()['date'] . ' 18:00:00', (string)($b['title'] ?? '見出しの例'), (string)($b['body'] ?? '本文の例です。'), (int)($b['patternIdx'] ?? 0), null, null, $standalone);
    Http::json(['fullText' => $c['fullText'], 'length' => mb_strlen($c['fullText']), 'compliance' => Sns::complianceHits($c['fullText']), 'unfilled' => Sns::unfilledIn($c['fullText']), 'unknown' => Sns::unknownPlaceholders((string)($b['body'] ?? ''))]);
}

// ---------- 分析 ----------
function sns_insights(): never
{
    Sns::ensureTables();
    $s = Auth::requireSession();
    $today = Time::nowJst()['date'];
    $to = Http::query('to'); $from = Http::query('from');
    if (!$to || !Time::isValidDate($to)) $to = Time::addDays($today, 1); // to は含まない（既定は今日まで）
    if (!$from || !Time::isValidDate($from) || $from >= $to) $from = Time::addDays($to, -28);
    $stores = $s['role'] === 'hq' && Http::query('store') !== 'me'
        ? Db::all('SELECT * FROM store WHERE active = 1 ORDER BY code ASC')
        : [Auth::resolveStore($s)];
    $stores = array_values(array_filter($stores));
    $out = SnsInsights::overview($stores, $from, $to);
    $code = Http::query('detail');
    if ($code) {
        $st = Settings::findStoreByCode($code);
        if (!$st || ($s['role'] !== 'hq' && $st['id'] !== $s['storeId'])) Http::error('店舗が見つかりません', 404);
        $out['detail'] = ['store' => ['code' => $st['code'], 'name' => $st['name']]] + SnsInsights::detail($st, $from, $to);
    }
    $out['today'] = $today;
    Http::json($out);
}

function sns_insights_export(): never
{
    Sns::ensureTables();
    $s = Auth::requireHq();
    $today = Time::nowJst()['date'];
    $to = Http::query('to'); $from = Http::query('from');
    if (!$to || !Time::isValidDate($to)) $to = Time::addDays($today, 1);
    if (!$from || !Time::isValidDate($from) || $from >= $to) $from = Time::addDays($to, -28);
    $csv = SnsInsights::csv(Db::all('SELECT * FROM store WHERE active = 1 ORDER BY code ASC'), $from, $to);
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="sns_' . $from . '_' . Time::addDays($to, -1) . '.csv"');
    header('Cache-Control: no-store');
    echo $csv;
    exit;
}

/** クチコミへの返信（Google） */
function sns_review_reply(): never
{
    Sns::ensureTables();
    $s = Auth::requireSession();
    Http::requireJson();
    $b = Http::body();
    $r = Db::one('SELECT * FROM sns_review WHERE id = ?', [(string)($b['id'] ?? '')]);
    if (!$r) Http::error('クチコミが見つかりません', 404);
    if ($s['role'] !== 'hq' && $r['storeId'] !== $s['storeId']) Http::error('forbidden', 403);
    $comment = Http::str($b, 'comment', 4000);
    $hits = Sns::complianceHits($comment);
    if ($hits) Http::error('返信に広告規制の語が含まれています: ' . implode('、', $hits), 400);
    try {
        Gbp::replyReview($r['reviewName'], $comment);
    } catch (Throwable $e) {
        Http::error('返信できませんでした: ' . $e->getMessage(), 502);
    }
    Db::exec('UPDATE sns_review SET replyComment = ?, replyTime = ? WHERE id = ?', [$comment, Time::nowJstDateTime(), $r['id']]);
    Http::json(['ok' => true]);
}

// ---------- 本部：全店の設定・連携 ----------
function hq_sns_get(): never
{
    Sns::ensureTables();
    Auth::requireHq();
    $g = Sns::setting();
    $stores = [];
    foreach (Db::all('SELECT * FROM store ORDER BY code ASC') as $st) {
        $st = Settings::storeRow($st);
        $ss = Sns::storeSetting($st);
        $stores[] = ['code' => $st['code'], 'name' => $st['name'], 'active' => $st['active'], 'igEnabled' => $ss['igEnabled'], 'gbpEnabled' => $ss['gbpEnabled'],
            'igSchedule' => Sns::describeSchedule($ss['effectiveIgSchedule']), 'gbpSchedule' => Sns::describeSchedule($ss['effectiveGbpSchedule']), 'area' => $ss['area'],
            'ig' => Sns::accountRow(Sns::account($st['id'], 'ig')), 'gbp' => Sns::accountRow(Sns::account($st['id'], 'gbp')),
            'topics' => (int)Db::one('SELECT COUNT(*) AS n FROM sns_topic WHERE storeId = ? AND active = 1', [$st['id']])['n']];
    }
    $lineUsers = Db::all('SELECT userId, displayName, createdAt FROM sns_line_user ORDER BY createdAt DESC LIMIT 50');
    Http::json([
        'setting' => $g,
        'stores' => $stores,
        'sharedTopics' => (int)Db::one('SELECT COUNT(*) AS n FROM sns_topic WHERE storeId IS NULL AND active = 1')['n'],
        'google' => Sns::accountRow(Sns::account(null, 'gbp')),
        'configured' => ['ig' => Instagram::configured(), 'google' => Gbp::configured(), 'line' => Notify::lineEnabled(), 'lineWebhook' => Config::str('LINE_CHANNEL_SECRET') !== '', 'mail' => Notify::mailEnabled(), 'appUrl' => Config::str('APP_URL') !== '', 'cronSecret' => Config::str('CRON_SECRET') !== ''],
        'lineUsers' => $lineUsers,
        'baseUrl' => Sns::baseUrl(),
        'redirectUris' => ['ig' => Instagram::redirectUri(), 'google' => Gbp::redirectUri(), 'lineWebhook' => rtrim(Sns::baseUrl(), '/') . '/api/sns/line-webhook', 'cron' => rtrim(Sns::baseUrl(), '/') . '/api/cron/sns?token=CRON_SECRET'],
        'jobs' => Db::all('SELECT k, ranAt, note FROM sns_job ORDER BY ranAt DESC LIMIT 12'),
        'mediaWritable' => is_writable(Sns::mediaDir()),
    ]);
}

/** 全店舗の SNS 設定をまとめて返す（設定画面で店舗ごとのカードを並べる） */
function hq_sns_stores_get(): never
{
    Sns::ensureTables();
    Auth::requireHq();
    $g = Sns::setting();
    $out = [];
    // ?all=1 なら停止中の店舗も含める（店舗管理の画面用）
    $all = Http::query('all', '') === '1';
    foreach (Db::all('SELECT * FROM store' . ($all ? '' : ' WHERE active = 1') . ' ORDER BY code ASC') as $st) {
        $st = Settings::storeRow($st);
        $ss = Sns::storeSetting($st);
        $ig = Db::one("SELECT username, externalId, accessToken, lastError FROM sns_account WHERE storeId = ? AND channel = 'ig'", [$st['id']]);
        $cred = [];
        foreach (Db::all('SELECT channel, loginId, passwordEnc FROM sns_credential WHERE storeId = ?', [$st['id']]) as $c) $cred[$c['channel']] = ['loginId' => $c['loginId'], 'hasPassword' => !empty($c['passwordEnc'])];
        $varsMissing = [];
        foreach ($g['customVars'] as $cv) {
            if (trim((string)($ss['vars'][$cv['key']] ?? '')) === '' && trim((string)$cv['default']) === '') $varsMissing[] = $cv['label'] !== '' ? $cv['label'] : $cv['key'];
        }
        $out[] = ['code' => $st['code'], 'name' => $st['name'], 'phone' => $st['phone'], 'active' => (bool)$st['active'], 'setting' => $ss,
            'draftCount' => (int)Db::one("SELECT COUNT(*) AS n FROM sns_post WHERE storeId = ? AND status = 'draft'", [$st['id']])['n'],
            'ig' => $ig && !empty($ig['accessToken']) ? ['connected' => true, 'username' => (string)($ig['username'] ?: $ig['externalId']), 'error' => $ig['lastError']] : ['connected' => false, 'username' => '', 'error' => null],
            'varsMissing' => $varsMissing, 'cred' => ['ig' => $cred['ig'] ?? null, 'gbp' => $cred['gbp'] ?? null],
            'gbpOpenUrl' => Sns::manualOpenUrl('gbp', $st, $ss), 'igOpenUrl' => Sns::manualOpenUrl('ig', $st, $ss)];
    }
    Http::json(['stores' => $out, 'defaults' => ['igSchedule' => $g['defaultIgSchedule'], 'gbpSchedule' => $g['defaultGbpSchedule']], 'customVars' => $g['customVars'], 'gbpManual' => $g['gbpManual']]);
}

function hq_sns_settings_put(): never
{
    Sns::ensureTables();
    Auth::requireHq();
    Http::requireJson();
    $b = Http::body();
    $cur = Sns::setting();
    $words = array_key_exists('forbiddenWords', $b) ? (is_array($b['forbiddenWords']) ? $b['forbiddenWords'] : Sns::splitList((string)$b['forbiddenWords'])) : $cur['forbiddenWords'];
    $words = array_values(array_unique(array_filter(array_map(fn($w) => mb_substr(trim((string)$w), 0, 40), $words), fn($w) => $w !== '')));
    $patterns = $cur['patterns'];
    if (isset($b['patterns']) && is_array($b['patterns'])) {
        foreach (Sns::defaultPatterns() as $ch => $groups) {
            foreach ($groups as $g => $_) {
                if (!isset($b['patterns'][$ch][$g]) || !is_array($b['patterns'][$ch][$g])) continue;
                $list = array_values(array_filter(array_map(fn($s) => is_string($s) ? mb_substr(trim($s), 0, 400) : '', $b['patterns'][$ch][$g]), fn($s) => $s !== ''));
                if ($ch === 'gbp') foreach ($list as $tpl) {
                    $bad = array_merge(Sns::gbpForbiddenVarsIn($tpl), Sns::gbpInfoHits($tpl));
                    if ($bad) Http::error('Google の文章の型に GBP に載っている情報（' . implode(' ', $bad) . '）は入れられません', 400);
                }
                if ($list) $patterns[$ch][$g] = $list;
            }
        }
    }
    $sched = function (string $k) use ($b, $cur) {
        if (!array_key_exists($k, $b)) return $cur[$k];
        $s = Sns::parseSchedule($b[$k]);
        if (!$s) throw new HttpError(400, '頻度の指定が正しくありません');
        return $s;
    };
    $targets = array_key_exists('lineTargets', $b) && is_array($b['lineTargets']) ? array_values(array_unique(array_filter(array_map(fn($x) => is_string($x) ? trim($x) : '', $b['lineTargets']), fn($x) => preg_match('/^U[0-9a-f]{32}$/', $x)))) : $cur['lineTargets'];
    Sns::saveSetting([
        'forbiddenWords' => $words, 'patterns' => $patterns,
        'defaultIgSchedule' => $sched('defaultIgSchedule'), 'defaultGbpSchedule' => $sched('defaultGbpSchedule'),
        'daysAhead' => array_key_exists('daysAhead', $b) ? Http::int($b, 'daysAhead', 7, 120) : $cur['daysAhead'],
        'remindHours' => array_key_exists('remindHours', $b) ? Http::int($b, 'remindHours', 1, 168) : $cur['remindHours'],
        'hashtagBase' => array_key_exists('hashtagBase', $b) ? Http::str($b, 'hashtagBase', 300, false) : $cur['hashtagBase'],
        'lineTargets' => $targets,
        'customVars' => array_key_exists('customVars', $b) ? Sns::parseCustomVars($b['customVars']) : $cur['customVars'],
        'gbpManual' => array_key_exists('gbpManual', $b) ? Http::bool($b, 'gbpManual') : $cur['gbpManual'],
    ]);
    // Google を手動運用にしたら、承認済みの Google 投稿も手動扱いにそろえる（自動処理が送らないように）
    if (Sns::setting()['gbpManual']) Db::exec("UPDATE sns_post SET publishMode = 'manual' WHERE channel = 'gbp' AND status IN ('draft', 'approved', 'failed')");
    // 差し込み語の既定値を変えたときに、作成済みの下書きにも反映する
    foreach (Db::all('SELECT id FROM store WHERE active = 1') as $st) Sns::refillDrafts($st['id']);
    Http::json(['ok' => true]);
}

/** 通知のテスト送信 */
function hq_sns_notify_test(): never
{
    Auth::requireHq();
    Http::requireJson();
    $r = Notify::send("【テスト】SNS 投稿管理からの通知です。" . Time::nowJstDateTime());
    Http::json(['ok' => $r !== 'FAILED', 'result' => $r]);
}

/** 定期処理を今すぐ動かす（確認用） */
function hq_sns_run_cron(): never
{
    Auth::requireHq();
    Http::requireJson();
    Http::json(['ok' => true, 'result' => SnsCron::run()]);
}

// ---------- Instagram 連携 ----------
/** 連携開始（店舗の設定画面から。Instagram のログイン画面へ転送） */
function sns_ig_connect(): never
{
    $ctx = sns_ctx();
    $back = '/admin/sns/settings' . (Http::query('store') ? '?store=' . rawurlencode(Http::query('store')) . '&' : '?');
    if (!Instagram::configured()) Http::redirect($back . 'error=' . rawurlencode('config.php に IG_APP_ID / IG_APP_SECRET を設定してください'));
    if (Config::str('APP_URL') === '') Http::redirect($back . 'error=' . rawurlencode('config.php の APP_URL を設定してください（連携の戻り先 URL に使います）'));
    $state = SnsCrypto::signState(['storeId' => $ctx['store']['id'], 'code' => $ctx['store']['code']]);
    Http::redirect(Instagram::authorizeUrl($state), 302);
}

/** Instagram からの戻り先 */
function sns_ig_callback(): never
{
    Sns::ensureTables();
    $st = SnsCrypto::verifyState((string)Http::query('state', ''));
    $back = '/admin/sns/settings';
    if (!$st) Http::redirect($back . '?error=' . rawurlencode('連携の有効期限が切れました。もう一度お試しください'));
    if (Http::query('error')) Http::redirect($back . '?error=' . rawurlencode('Instagram の連携が許可されませんでした: ' . (Http::query('error_description') ?: Http::query('error'))));
    try {
        $r = Instagram::exchangeCode((string)Http::query('code', ''));
        $me = Instagram::me($r['accessToken']);
        Sns::saveAccount($st['storeId'], 'ig', ['externalId' => $me['userId'] !== '' ? $me['userId'] : $r['userId'], 'username' => $me['username'], 'accessToken' => $r['accessToken'], 'tokenExpiresAt' => $r['expiresAt'], 'tokenRefreshedAt' => null, 'lastError' => null]);
        if ($me['followers'] !== null) SnsCron::upsertDaily($st['storeId'], 'ig', Time::nowJst()['date'], 'followers', $me['followers']);
    } catch (Throwable $e) {
        Http::redirect($back . '?error=' . rawurlencode('Instagram の連携に失敗しました: ' . $e->getMessage()));
    }
    Http::redirect($back . '?connected=ig');
}

/** トークンを直接登録（Meta のアプリ画面で発行した長期トークンを貼る。本部のみ） */
function sns_ig_token_post(): never
{
    $ctx = sns_ctx();
    if ($ctx['session']['role'] !== 'hq') Http::error('本部だけが行えます', 403);
    Http::requireJson();
    $b = Http::body();
    if (($b['disconnect'] ?? false) === true) {
        Sns::deleteAccount($ctx['store']['id'], 'ig');
        Http::json(['ok' => true]);
    }
    $token = trim((string)($b['token'] ?? ''));
    if (strlen($token) < 20) Http::error('トークンを貼り付けてください', 400);
    try {
        $me = Instagram::me($token);
    } catch (Throwable $e) {
        Http::error('トークンを確認できませんでした: ' . $e->getMessage(), 400);
    }
    if ($me['userId'] === '') Http::error('このトークンではアカウント情報を取得できません', 400);
    Sns::saveAccount($ctx['store']['id'], 'ig', ['externalId' => $me['userId'], 'username' => $me['username'], 'accessToken' => $token, 'tokenExpiresAt' => date('Y-m-d H:i:s', time() + 55 * 86400), 'tokenRefreshedAt' => null, 'lastError' => null]);
    if ($me['followers'] !== null) SnsCron::upsertDaily($ctx['store']['id'], 'ig', Time::nowJst()['date'], 'followers', $me['followers']);
    Http::json(['ok' => true, 'account' => Sns::accountRow(Sns::account($ctx['store']['id'], 'ig'))]);
}

// ---------- Google 連携（本部） ----------
function sns_google_connect(): never
{
    Auth::requireHq();
    if (!Gbp::configured()) Http::redirect('/admin/hq/sns?error=' . rawurlencode('config.php に GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET を設定してください'));
    if (Config::str('APP_URL') === '') Http::redirect('/admin/hq/sns?error=' . rawurlencode('config.php の APP_URL を設定してください'));
    Http::redirect(Gbp::authorizeUrl(SnsCrypto::signState(['hq' => true])), 302);
}

function sns_google_callback(): never
{
    Sns::ensureTables();
    $st = SnsCrypto::verifyState((string)Http::query('state', ''));
    $back = '/admin/hq/sns';
    if (!$st || empty($st['hq'])) Http::redirect($back . '?error=' . rawurlencode('連携の有効期限が切れました。もう一度お試しください'));
    if (Http::query('error')) Http::redirect($back . '?error=' . rawurlencode('Google の連携が許可されませんでした: ' . Http::query('error')));
    try {
        $r = Gbp::exchangeCode((string)Http::query('code', ''));
        $cur = Sns::account(null, 'gbp');
        $refresh = $r['refreshToken'] ?? ($cur ? SnsCrypto::decrypt($cur['refreshToken']) : null);
        if (!$refresh) throw new RuntimeException('更新トークンを受け取れませんでした。Google アカウントの「アクセス権を持つアプリ」から一度削除して、やり直してください');
        Sns::saveAccount(null, 'gbp', ['accessToken' => $r['accessToken'], 'refreshToken' => $refresh, 'tokenExpiresAt' => $r['expiresAt'], 'tokenRefreshedAt' => Time::nowJstDateTime(), 'lastError' => null, 'username' => 'Google']);
    } catch (Throwable $e) {
        Http::redirect($back . '?error=' . rawurlencode('Google の連携に失敗しました: ' . $e->getMessage()));
    }
    Http::redirect($back . '?connected=google');
}

/** 連携した Google アカウントの拠点一覧 */
function hq_sns_google_locations(): never
{
    Sns::ensureTables();
    Auth::requireHq();
    try {
        $out = [];
        foreach (Gbp::accounts() as $a) {
            foreach (Gbp::locations($a['name']) as $l) $out[] = ['account' => $a['name'], 'accountName' => $a['accountName'], 'location' => $l['name'], 'title' => $l['title'], 'address' => $l['address']];
        }
        Http::json(['locations' => $out]);
    } catch (Throwable $e) {
        Http::error('拠点を取得できませんでした: ' . $e->getMessage(), 502);
    }
}

/** 店舗と Google の拠点の対応づけ／解除、Google 連携の解除 */
function hq_sns_google_map(): never
{
    Sns::ensureTables();
    Auth::requireHq();
    Http::requireJson();
    $b = Http::body();
    if (($b['disconnect'] ?? false) === true) {
        Sns::deleteAccount(null, 'gbp');
        Http::json(['ok' => true]);
    }
    $store = Settings::findStoreByCode((string)($b['store'] ?? ''));
    if (!$store) Http::error('店舗が見つかりません', 404);
    if (($b['clear'] ?? false) === true) {
        Sns::deleteAccount($store['id'], 'gbp');
        Http::json(['ok' => true]);
    }
    $account = trim((string)($b['account'] ?? ''));
    $location = trim((string)($b['location'] ?? ''));
    if (!preg_match('#^accounts/[\w-]+$#', $account) || !preg_match('#^locations/[\w-]+$#', $location)) Http::error('拠点の指定が正しくありません', 400);
    Sns::saveAccount($store['id'], 'gbp', ['externalId' => $account, 'locationName' => $location, 'username' => mb_substr((string)($b['title'] ?? ''), 0, 100)]);
    Http::json(['ok' => true]);
}

// ---------- LINE Webhook ----------
/** 通知を受けたい人が LINE 公式アカウントに話しかけると userId を記録する */
function sns_line_webhook(): never
{
    Sns::ensureTables();
    $raw = file_get_contents('php://input') ?: '';
    if (!Notify::verifyLineSignature($raw, $_SERVER['HTTP_X_LINE_SIGNATURE'] ?? '')) Http::error('bad signature', 403);
    $j = json_decode($raw, true);
    foreach ($j['events'] ?? [] as $ev) {
        $uid = $ev['source']['userId'] ?? null;
        if (!$uid || !in_array($ev['type'] ?? '', ['message', 'follow'], true)) continue;
        $name = Notify::lineProfileName($uid);
        Db::exec('INSERT INTO sns_line_user (userId, displayName) VALUES (?, ?) ON DUPLICATE KEY UPDATE displayName = IF(VALUES(displayName) = \'\', displayName, VALUES(displayName))', [$uid, mb_substr($name, 0, 100)]);
    }
    Http::json(['ok' => true]);
}

// ---------- cron ----------
/** /api/cron/sns?token=CRON_SECRET（5〜10 分おき） */
function cron_sns(): never
{
    $secret = Config::str('CRON_SECRET');
    $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    $token = Http::query('token', '');
    if ($secret === '' || !(hash_equals("Bearer $secret", $auth) || hash_equals($secret, $token))) Http::error('unauthorized', 401);
    Http::json(['ok' => true] + SnsCron::run());
}

// ---------- ログイン情報（本部だけ）：Instagram・Google のログイン ID・パスワードなどを店舗ごとに保管 ----------
function sns_cred_ctx(): array
{
    $ctx = sns_ctx();
    if ($ctx['session']['role'] !== 'hq') throw new HttpError(403, 'ログイン情報は本部だけが見られます');
    return $ctx;
}

function sns_cred_row(?array $r, string $channel): array
{
    return [
        'channel' => $channel,
        'loginId' => (string)($r['loginId'] ?? ''),
        'hasPassword' => !empty($r['passwordEnc']),
        'email' => (string)($r['email'] ?? ''),
        'phone' => (string)($r['phone'] ?? ''),
        'note' => (string)($r['note'] ?? ''),
        'updatedAt' => $r['updatedAt'] ?? null,
        'updatedBy' => $r['updatedBy'] ?? null,
        'revealedAt' => $r['revealedAt'] ?? null,
        'revealedBy' => $r['revealedBy'] ?? null,
    ];
}

/** GET /api/admin/sns/credentials?store=：パスワードそのものは返さない（「表示」で別に取る） */
function sns_credentials_get(): never
{
    $ctx = sns_cred_ctx();
    $out = [];
    foreach (Sns::CHANNELS as $ch) {
        $out[$ch] = sns_cred_row(Db::one('SELECT * FROM sns_credential WHERE storeId = ? AND channel = ?', [$ctx['store']['id'], $ch]), $ch);
    }
    Http::json(['store' => ['code' => $ctx['store']['code'], 'name' => $ctx['store']['name']], 'credentials' => $out]);
}

/** PUT /api/admin/sns/credentials?store=  {channel, loginId, email, phone, note, password?（空なら変えない）, clearPassword?} */
function sns_credentials_put(): never
{
    $ctx = sns_cred_ctx();
    Http::requireJson();
    $b = Http::body();
    $ch = sns_channel($b['channel'] ?? null);
    $cur = Db::one('SELECT * FROM sns_credential WHERE storeId = ? AND channel = ?', [$ctx['store']['id'], $ch]);
    $loginId = Http::str($b, 'loginId', 200, false);
    $email = Http::str($b, 'email', 200, false);
    $phone = Http::str($b, 'phone', 50, false);
    $note = Http::str($b, 'note', 2000, false);
    $pw = isset($b['password']) && is_string($b['password']) ? $b['password'] : '';
    if (mb_strlen($pw) > 200) throw new HttpError(400, 'パスワードが長すぎます');
    $enc = $cur['passwordEnc'] ?? null;
    if (!empty($b['clearPassword'])) $enc = null;
    elseif ($pw !== '') $enc = SnsCrypto::encrypt($pw);
    Db::exec('INSERT INTO sns_credential (storeId, channel, loginId, passwordEnc, email, phone, note, updatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE loginId = VALUES(loginId), passwordEnc = VALUES(passwordEnc), email = VALUES(email), phone = VALUES(phone), note = VALUES(note), updatedBy = VALUES(updatedBy), updatedAt = CURRENT_TIMESTAMP',
        [$ctx['store']['id'], $ch, $loginId, $enc, $email, $phone, $note, $ctx['session']['code']]);
    Http::json(['ok' => true, 'credential' => sns_cred_row(Db::one('SELECT * FROM sns_credential WHERE storeId = ? AND channel = ?', [$ctx['store']['id'], $ch]), $ch)]);
}

/** POST /api/admin/sns/credentials/reveal?store=  {channel}：パスワードを表示する（誰がいつ見たかを残す） */
function sns_credentials_reveal(): never
{
    $ctx = sns_cred_ctx();
    if (!RateLimit::allow('cred-reveal:' . $ctx['session']['code'], 60, 10 * 60)) Http::error('しばらくしてからお試しください', 429);
    Http::requireJson();
    $b = Http::body();
    $ch = sns_channel($b['channel'] ?? null);
    $r = Db::one('SELECT passwordEnc FROM sns_credential WHERE storeId = ? AND channel = ?', [$ctx['store']['id'], $ch]);
    if (!$r || empty($r['passwordEnc'])) Http::error('パスワードは登録されていません', 404);
    $plain = SnsCrypto::decrypt($r['passwordEnc']);
    if ($plain === null) Http::error('パスワードを読み出せません。config.php の SNS_SECRET が登録したときと変わっている可能性があります。もう一度登録してください', 409);
    Db::exec('UPDATE sns_credential SET revealedBy = ?, revealedAt = NOW(), updatedAt = updatedAt WHERE storeId = ? AND channel = ?', [$ctx['session']['code'], $ctx['store']['id'], $ch]);
    header('Cache-Control: no-store');
    Http::json(['password' => $plain]);
}

// ---------- 下書き（全店を 1 ページで）と差し込み語の一括入力 ----------
/** 見られる店舗（本部は稼働中の全店、店舗アカウントは自店舗） */
function sns_visible_stores(array $s): array
{
    if ($s['role'] === 'hq') return array_map([Settings::class, 'storeRow'], Db::all('SELECT * FROM store WHERE active = 1 ORDER BY code ASC'));
    $st = Auth::resolveStore($s);
    if (!$st) throw new HttpError(404, '店舗が登録されていません');
    return [Settings::storeRow($st)];
}

/** 差し込み語の入力欄に出す店舗の値 */
function sns_store_vars_row(array $st, array $ss): array
{
    return ['code' => $st['code'], 'name' => $st['name'], 'area' => $ss['area'], 'keywordsFixed' => $ss['keywordsFixed'], 'keywordsRotation' => $ss['keywordsRotation'], 'vars' => (object)$ss['vars'],
        'igEnabled' => $ss['igEnabled'], 'gbpEnabled' => $ss['gbpEnabled']];
}

/** GET /api/admin/sns/drafts?channel=&store=：確認待ち・失敗の下書きを全店まとめて */
function sns_drafts_get(): never
{
    Sns::ensureTables();
    $s = Auth::requireSession();
    $stores = sns_visible_stores($s);
    $code = Http::query('store');
    if ($code) $stores = array_values(array_filter($stores, fn($st) => $st['code'] === $code));
    $ch = sns_channel(Http::query('channel'), true);
    $from = Time::addDays(Time::nowJst()['date'], -30) . ' 00:00:00';
    $ssBy = []; $storeRows = [];
    foreach ($stores as $st) { $ssBy[$st['id']] = Sns::storeSetting($st); $storeRows[] = sns_store_vars_row($st, $ssBy[$st['id']]); }
    $posts = [];
    if ($stores) {
        $in = implode(',', array_fill(0, count($stores), '?'));
        $params = array_merge(array_column($stores, 'id'), [$from]);
        $sql = "SELECT p.*, s.code AS storeCode, s.name AS storeName FROM sns_post p JOIN store s ON s.id = p.storeId WHERE p.storeId IN ($in) AND p.status IN ('draft', 'failed') AND p.scheduledAt >= ?";
        if ($ch) { $sql .= ' AND p.channel = ?'; $params[] = $ch; }
        foreach (Db::all($sql . ' ORDER BY s.code ASC, p.scheduledAt ASC LIMIT 2000', $params) as $r) {
            $r['_ss'] = $ssBy[$r['storeId']] ?? null;
            $posts[] = Sns::postRow($r);
        }
    }
    Http::json(['today' => Time::nowJst()['date'], 'isHq' => $s['role'] === 'hq', 'stores' => $storeRows, 'customVars' => Sns::setting()['customVars'], 'posts' => $posts]);
}

/** GET /api/admin/sns/vars：差し込み語の一括入力用（店舗ごとの値） */
function sns_vars_get(): never
{
    Sns::ensureTables();
    $s = Auth::requireSession();
    $rows = [];
    foreach (sns_visible_stores($s) as $st) {
        $row = sns_store_vars_row($st, Sns::storeSetting($st));
        $row['unfilled'] = (int)Db::one("SELECT COUNT(*) AS n FROM sns_post WHERE storeId = ? AND status IN ('draft', 'failed') AND postText LIKE ?", [$st['id'], '%{%'])['n'];
        $rows[] = $row;
    }
    Http::json(['stores' => $rows, 'customVars' => Sns::setting()['customVars'], 'isHq' => $s['role'] === 'hq']);
}

/** PUT /api/admin/sns/vars {rows:[{code, name?, area?, keywordsFixed?, keywordsRotation?, vars?}]}：保存して、作成済みの下書きも埋め直す */
function sns_vars_put(): never
{
    Sns::ensureTables();
    $s = Auth::requireSession();
    Http::requireJson();
    $b = Http::body();
    $rows = $b['rows'] ?? null;
    if (!is_array($rows) || count($rows) > 200) Http::error('bad request', 400);
    $allowed = [];
    foreach (sns_visible_stores($s) as $st) $allowed[$st['code']] = $st;
    $saved = 0; $refilled = 0;
    Db::transaction(function () use ($rows, $allowed, &$saved, &$refilled) {
        foreach ($rows as $row) {
            if (!is_array($row)) continue;
            $st = $allowed[(string)($row['code'] ?? '')] ?? null;
            if (!$st) throw new HttpError(403, '店舗 ' . (string)($row['code'] ?? '') . ' は変更できません');
            if (array_key_exists('name', $row)) {
                $name = Http::str($row, 'name', 50, false);
                if ($name === '') throw new HttpError(400, $st['code'] . ' の店舗名が空です');
                if ($name !== $st['name']) Db::exec('UPDATE store SET name = ? WHERE id = ?', [$name, $st['id']]);
            }
            $cur = Sns::storeSetting($st);
            $v = $cur;
            if (array_key_exists('area', $row)) $v['area'] = Http::str($row, 'area', 50, false);
            if (array_key_exists('keywordsFixed', $row)) $v['keywordsFixed'] = Http::str($row, 'keywordsFixed', 300, false);
            if (array_key_exists('keywordsRotation', $row)) $v['keywordsRotation'] = Http::str($row, 'keywordsRotation', 500, false);
            if (array_key_exists('vars', $row)) $v['vars'] = array_merge($cur['vars'], Sns::parseVars($row['vars']));
            Sns::saveStoreSetting($st['id'], $v);
            $saved++;
            $refilled += Sns::refillDrafts($st['id']);
        }
    });
    Http::json(['ok' => true, 'saved' => $saved, 'refilled' => $refilled]);
}
