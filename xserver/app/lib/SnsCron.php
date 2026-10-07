<?php
// SNS の定期処理：承認済みの投稿を予定時刻に送る／先の下書きを作る／承認待ちの通知／トークン更新／数字の取り込み／週まとめ
declare(strict_types=1);

final class SnsCron
{
    public const OVERDUE_DAYS = 2;   // 予定をこれ以上過ぎた承認済み投稿は送らない（cron が止まっていた場合など）

    /** 全部まとめて実行（/api/cron/sns と cron/sns.php から）。@return array 実行結果 */
    public static function run(): array
    {
        Sns::ensureTables();
        $out = ['publish' => self::publishDue(), 'manual' => self::notifyManualDue()];
        $now = Time::nowJst();
        $today = $now['date'];
        $hour = intdiv($now['minutes'], 60);
        // 1 日 1 回の処理（時刻を過ぎていて、今日まだ動いていなければ）
        if ($hour >= 5) $out['insights'] = self::daily("insights:$today", fn() => self::fetchInsights());
        if ($hour >= 6) $out['generate'] = self::daily("generate:$today", fn() => self::generateAll());
        if ($hour >= 6) $out['tokens'] = self::daily("tokens:$today", fn() => self::refreshTokens());
        if ($hour >= 8) $out['manualToday'] = self::daily("manual-today:$today", fn() => self::notifyManualToday());
        if ($hour >= 9) $out['remind'] = self::daily("remind:$today", fn() => self::remind());
        if ($hour >= 9 && Time::weekdayOf($today) === 1) $out['weekly'] = self::daily("weekly:$today", fn() => self::weeklySummary());
        return $out;
    }

    private static function daily(string $key, callable $fn): mixed
    {
        if (Db::one('SELECT k FROM sns_job WHERE k = ?', [$key])) return 'done';
        // 先に記録してから実行（同時に 2 つ動かない）
        try {
            Db::exec('INSERT INTO sns_job (k, ranAt) VALUES (?, ?)', [$key, Time::nowJstDateTime()]);
        } catch (Throwable) {
            return 'done';
        }
        try {
            $r = $fn();
            Db::exec('UPDATE sns_job SET note = ? WHERE k = ?', [mb_substr(Sns::j($r), 0, 300), $key]);
            if (random_int(1, 20) === 1) Db::exec('DELETE FROM sns_job WHERE ranAt < ?', [Time::addDays(Time::nowJst()['date'], -30) . ' 00:00:00']);
            return $r;
        } catch (Throwable $e) {
            error_log("[sns:$key] " . $e->getMessage());
            Db::exec('UPDATE sns_job SET note = ? WHERE k = ?', ['error: ' . mb_substr($e->getMessage(), 0, 280), $key]);
            return 'error: ' . $e->getMessage();
        }
    }

    // ---------- 投稿 ----------
    /** 承認済みで予定時刻を過ぎたものを投稿する */
    public static function publishDue(int $limit = 10): array
    {
        $now = Time::nowJstDateTime();
        $rows = Db::all('SELECT p.*, s.code AS storeCode, s.name AS storeName FROM sns_post p JOIN store s ON s.id = p.storeId WHERE p.status = ? AND p.scheduledAt <= ? ORDER BY p.scheduledAt ASC LIMIT ' . $limit, ['approved', $now]);
        $res = ['posted' => 0, 'failed' => 0, 'manual' => 0, 'expired' => 0];
        foreach ($rows as $p) {
            $r = self::publishPost($p);
            $res[$r] = ($res[$r] ?? 0) + 1;
        }
        return $res;
    }

    /** 1 件を投稿する。@return 'posted'|'failed'|'manual'|'expired'|'skipped' */
    public static function publishPost(array $p, bool $force = false): string
    {
        $store = Settings::findStoreById($p['storeId']);
        if (!$store) return 'skipped';
        $mode = Sns::publishModeFor($store, $p['channel']);
        if ($mode !== $p['publishMode']) Db::exec('UPDATE sns_post SET publishMode = ? WHERE id = ?', [$mode, $p['id']]);
        if ($mode === 'manual') return 'manual'; // 手動投稿（notifyManualDue で知らせる）
        if (!$force && strtotime($p['scheduledAt']) < time() - self::OVERDUE_DAYS * 86400) {
            Db::exec('UPDATE sns_post SET status = ?, error = ? WHERE id = ? AND status = ?', ['failed', '予定日時を ' . self::OVERDUE_DAYS . ' 日以上過ぎていたため投稿しませんでした。日時を変えて承認し直してください', $p['id'], 'approved']);
            Notify::send("【投稿されませんでした】{$store['name']} " . Sns::CHANNEL_JA[$p['channel']] . " " . substr($p['scheduledAt'], 0, 16) . "\n予定を過ぎていたため見送りました。管理画面で日時を直して承認し直してください。");
            return 'expired';
        }
        // 二重送信を防ぐ：approved → publishing に変えられた 1 プロセスだけが送る
        if (Db::exec('UPDATE sns_post SET status = ? WHERE id = ? AND status = ?', ['publishing', $p['id'], 'approved']) !== 1) return 'skipped';
        try {
            $hits = Sns::complianceHits($p['postText']);
            if ($p['channel'] === 'gbp' && $hits) throw new RuntimeException('広告規制の語が含まれています: ' . implode('、', $hits));
            if ($p['channel'] === 'gbp' && ($g = Sns::gbpInfoHits($p['postText'], $store, Sns::storeSetting($store)))) throw new RuntimeException('GBP に載っている情報が投稿文に含まれています: ' . implode('、', $g));
            if (Sns::unfilledIn($p['postText'])) throw new RuntimeException('埋まっていない差し込み語があります: ' . implode(' ', Sns::unfilledIn($p['postText'])));
            $imageUrl = $p['imagePath'] ? Sns::mediaUrl($p['imagePath']) : null;
            if ($imageUrl !== null && !str_starts_with($imageUrl, 'http')) throw new RuntimeException('config.php の APP_URL が設定されていないため、画像の公開 URL を作れません');
            if ($p['channel'] === 'ig') {
                if (!$imageUrl) throw new RuntimeException('Instagram の投稿には画像が必要です');
                $acc = Sns::account($store['id'], 'ig');
                $token = $acc ? SnsCrypto::decrypt($acc['accessToken']) : null;
                if (!$token) throw new RuntimeException('Instagram が連携されていません');
                $r = Instagram::publishImage($acc['externalId'], $token, $imageUrl, $p['postText']);
                $externalId = $r['id']; $permalink = $r['permalink'];
            } else {
                $acc = Sns::account($store['id'], 'gbp');
                $r = Gbp::createLocalPost($acc['externalId'], $acc['locationName'], $p['postText'], $imageUrl, Sns::bookingUrl($store));
                $externalId = $r['name']; $permalink = $r['url'];
            }
            Db::exec('UPDATE sns_post SET status = ?, postedAt = ?, externalId = ?, permalink = ?, error = NULL WHERE id = ?', ['posted', Time::nowJstDateTime(), mb_substr($externalId, 0, 200), $permalink ? mb_substr($permalink, 0, 300) : null, $p['id']]);
            return 'posted';
        } catch (Throwable $e) {
            $msg = mb_substr($e->getMessage(), 0, 500);
            Db::exec('UPDATE sns_post SET status = ?, error = ? WHERE id = ?', ['failed', $msg, $p['id']]);
            error_log("[sns:publish] {$p['id']} $msg");
            Notify::send("【投稿に失敗しました】{$store['name']} " . Sns::CHANNEL_JA[$p['channel']] . " " . substr($p['scheduledAt'], 0, 16) . "\n{$msg}\n管理画面で内容を確認して、承認し直してください。");
            return 'failed';
        }
    }

    /** 朝に「今日の手動投稿」の一覧を知らせる（店舗・媒体・時刻） */
    public static function notifyManualToday(): int
    {
        $today = Time::nowJst()['date'];
        $g = Sns::setting();
        $rows = Db::all("SELECT p.channel, p.scheduledAt, p.title, p.body, s.name AS storeName FROM sns_post p JOIN store s ON s.id = p.storeId
            WHERE p.status IN ('draft', 'approved', 'failed') AND p.scheduledAt <= ? AND (p.publishMode = 'manual'" . ($g['gbpManual'] ? " OR p.channel = 'gbp'" : '') . ") ORDER BY p.scheduledAt ASC", [$today . ' 23:59:59']);
        if (!$rows) return 0;
        $lines = ['【今日の手動投稿】' . count($rows) . ' 件（期限切れを含む）'];
        foreach (array_slice($rows, 0, 20) as $r) $lines[] = '・' . substr($r['scheduledAt'], 11, 5) . ' ' . $r['storeName'] . ' ' . Sns::CHANNEL_JA[$r['channel']] . ' ' . mb_substr($r['title'] !== '' ? $r['title'] : $r['body'], 0, 16);
        if (count($rows) > 20) $lines[] = '…ほか ' . (count($rows) - 20) . ' 件';
        $lines[] = '管理画面「SNS投稿」→「手動投稿」で、コピー → 投稿 → 「投稿した」の順に進めてください。';
        Notify::send(implode("\n", $lines));
        return count($rows);
    }

    /** 手動投稿（Google の API 許可待ちなど）の予定時刻が来たら 1 回だけ知らせる */
    public static function notifyManualDue(): int
    {
        $now = Time::nowJstDateTime();
        $rows = Db::all('SELECT p.*, s.name AS storeName FROM sns_post p JOIN store s ON s.id = p.storeId WHERE p.status = ? AND p.publishMode = ? AND p.scheduledAt <= ? AND p.manualNotifiedAt IS NULL ORDER BY p.scheduledAt ASC LIMIT 30', ['approved', 'manual', $now]);
        if (!$rows) return 0;
        $lines = ["【手動で投稿してください】予定時刻になりました（" . count($rows) . " 件）"];
        foreach ($rows as $p) {
            $lines[] = '・' . $p['storeName'] . ' ' . Sns::CHANNEL_JA[$p['channel']] . ' ' . substr($p['scheduledAt'], 0, 16) . ' ' . mb_substr($p['title'] !== '' ? $p['title'] : $p['body'], 0, 20);
            Db::exec('UPDATE sns_post SET manualNotifiedAt = ? WHERE id = ?', [$now, $p['id']]);
        }
        $lines[] = '管理画面「SNS投稿」→「手動投稿」で本文をコピーして投稿し、「投稿した」を押してください。';
        Notify::send(implode("\n", $lines));
        return count($rows);
    }

    // ---------- 下書きの生成 ----------
    public static function generateAll(?int $daysAhead = null): array
    {
        $res = ['created' => 0, 'missingTopics' => 0];
        $missingStores = [];
        foreach (Db::all('SELECT * FROM store WHERE active = 1 ORDER BY code ASC') as $store) {
            $store = Settings::storeRow($store);
            foreach (Sns::CHANNELS as $ch) {
                $r = Sns::generateDrafts($store, $ch, $daysAhead, $daysAhead ? 60 : 10);
                $res['created'] += $r['created'];
                $res['missingTopics'] += $r['missingTopics'];
                if ($r['missingTopics'] > 0) $missingStores[] = $store['name'] . '（' . Sns::CHANNEL_JA[$ch] . '）';
            }
        }
        if ($res['created'] > 0) Notify::send("【下書きができました】{$res['created']} 件の下書きを作りました。管理画面「SNS投稿」で内容を確認して承認してください。");
        if ($missingStores) Notify::send("【ネタが足りません】" . implode('、', array_unique($missingStores)) . " の予定枠に使えるネタがありません。管理画面「SNS投稿」→「ネタ」から追加してください。");
        return $res;
    }

    // ---------- 承認待ちの通知 ----------
    public static function remind(): array
    {
        $g = Sns::setting();
        $until = date('Y-m-d H:i:s', time() + $g['remindHours'] * 3600);
        $rows = Db::all('SELECT p.channel, p.status, p.scheduledAt, s.name AS storeName FROM sns_post p JOIN store s ON s.id = p.storeId WHERE p.status = ? AND p.scheduledAt <= ? ORDER BY p.scheduledAt ASC', ['draft', $until]);
        $failed = Db::all('SELECT p.channel, p.scheduledAt, s.name AS storeName FROM sns_post p JOIN store s ON s.id = p.storeId WHERE p.status = ? AND p.updatedAt >= ? ORDER BY p.scheduledAt ASC', ['failed', Time::addDays(Time::nowJst()['date'], -7) . ' 00:00:00']);
        if (!$rows && !$failed) return ['pending' => 0, 'failed' => 0];
        $lines = [];
        if ($rows) {
            $lines[] = "【承認待ちがあります】{$g['remindHours']} 時間以内に予定の下書き " . count($rows) . " 件が未承認です。";
            foreach (array_slice($rows, 0, 15) as $r) $lines[] = '・' . $r['storeName'] . ' ' . Sns::CHANNEL_JA[$r['channel']] . ' ' . substr($r['scheduledAt'], 0, 16);
            if (count($rows) > 15) $lines[] = '…ほか ' . (count($rows) - 15) . ' 件';
            $lines[] = '承認していない下書きは投稿されません。管理画面「SNS投稿」で確認してください。';
        }
        if ($failed) {
            $lines[] = "【失敗した投稿】" . count($failed) . " 件が「失敗」のままです。内容を直して承認し直してください。";
        }
        Notify::send(implode("\n", $lines));
        return ['pending' => count($rows), 'failed' => count($failed)];
    }

    // ---------- トークン更新 ----------
    public static function refreshTokens(): array
    {
        $res = ['refreshed' => 0, 'failed' => 0];
        $limit = date('Y-m-d H:i:s', time() - 30 * 86400);
        foreach (Db::all('SELECT a.*, s.name AS storeName FROM sns_account a LEFT JOIN store s ON s.id = a.storeId WHERE a.channel = ? AND a.accessToken IS NOT NULL AND (a.tokenRefreshedAt IS NULL OR a.tokenRefreshedAt <= ?)', ['ig', $limit]) as $a) {
            // 取得から 24 時間以上たったトークンだけ更新できる
            if ($a['tokenRefreshedAt'] === null && strtotime($a['createdAt']) > time() - 86400) continue;
            $token = SnsCrypto::decrypt($a['accessToken']);
            if (!$token) continue;
            try {
                $r = Instagram::refresh($token);
                Sns::saveAccount($a['storeId'], 'ig', ['accessToken' => $r['accessToken'], 'tokenExpiresAt' => $r['expiresAt'], 'tokenRefreshedAt' => Time::nowJstDateTime(), 'lastError' => null]);
                $res['refreshed']++;
            } catch (Throwable $e) {
                $res['failed']++;
                Sns::saveAccount($a['storeId'], 'ig', ['lastError' => mb_substr($e->getMessage(), 0, 300)]);
                Notify::send("【Instagram の連携を確認してください】{$a['storeName']} のトークン更新に失敗しました。\n{$e->getMessage()}\n管理画面「本部」→「SNS管理」から再連携してください。");
            }
        }
        return $res;
    }

    // ---------- 数字の取り込み ----------
    public static function fetchInsights(): array
    {
        $res = ['ig' => 0, 'gbp' => 0, 'posts' => 0, 'reviews' => 0, 'errors' => []];
        $today = Time::nowJst()['date'];
        $yesterday = Time::addDays($today, -1);
        $now = Time::nowJstDateTime();
        foreach (Db::all('SELECT a.*, s.name AS storeName FROM sns_account a JOIN store s ON s.id = a.storeId WHERE a.channel = ? AND a.accessToken IS NOT NULL AND s.active = 1', ['ig']) as $a) {
            $token = SnsCrypto::decrypt($a['accessToken']);
            if (!$token) continue;
            try {
                $me = Instagram::me($token);
                if ($me['followers'] !== null) self::upsertDaily($a['storeId'], 'ig', $today, 'followers', $me['followers']);
                foreach (Instagram::dailyReach($a['externalId'], $token, Time::addDays($today, -7), $yesterday) as $d => $v) self::upsertDaily($a['storeId'], 'ig', $d, 'reach', $v);
                $posts = Db::all('SELECT id, externalId FROM sns_post WHERE storeId = ? AND channel = ? AND status = ? AND externalId IS NOT NULL AND postedAt >= ?', [$a['storeId'], 'ig', 'posted', Time::addDays($today, -30) . ' 00:00:00']);
                foreach ($posts as $p) {
                    $m = Instagram::mediaInsights($p['externalId'], $token);
                    Db::exec('INSERT INTO sns_post_stat (postId, reach, likes, comments, saved, shares, views, fetchedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE reach = VALUES(reach), likes = VALUES(likes), comments = VALUES(comments), saved = VALUES(saved), shares = VALUES(shares), views = VALUES(views), fetchedAt = VALUES(fetchedAt)',
                        [$p['id'], $m['reach'], $m['likes'], $m['comments'], $m['saved'], $m['shares'], $m['views'], $now]);
                    $res['posts']++;
                }
                $res['ig']++;
                if ($a['lastError']) Sns::saveAccount($a['storeId'], 'ig', ['lastError' => null]);
            } catch (Throwable $e) {
                $res['errors'][] = "{$a['storeName']} Instagram: " . $e->getMessage();
                Sns::saveAccount($a['storeId'], 'ig', ['lastError' => mb_substr($e->getMessage(), 0, 300)]);
            }
        }
        $hq = Sns::account(null, 'gbp');
        if ($hq && $hq['refreshToken']) {
            foreach (Db::all('SELECT a.*, s.name AS storeName FROM sns_account a JOIN store s ON s.id = a.storeId WHERE a.channel = ? AND a.locationName <> ? AND s.active = 1', ['gbp', '']) as $a) {
                try {
                    // パフォーマンスの数字は数日遅れて確定するため、直近 10 日分を毎日取り直す
                    foreach (Gbp::dailyMetrics($a['locationName'], Time::addDays($today, -10), $yesterday) as $d => $byMetric) {
                        foreach (Gbp::summarizeMetrics($byMetric) as $k => $v) self::upsertDaily($a['storeId'], 'gbp', $d, $k, $v);
                    }
                    foreach (Gbp::reviews($a['externalId'], $a['locationName']) as $rv) {
                        Db::exec('INSERT INTO sns_review (id, storeId, reviewName, reviewer, rating, comment, createTime, replyComment, replyTime, fetchedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            ON DUPLICATE KEY UPDATE reviewer = VALUES(reviewer), rating = VALUES(rating), comment = VALUES(comment), replyComment = VALUES(replyComment), replyTime = VALUES(replyTime), fetchedAt = VALUES(fetchedAt)',
                            [substr(hash('sha256', $rv['name']), 0, 32), $a['storeId'], mb_substr($rv['name'], 0, 200), mb_substr($rv['reviewer'], 0, 100), $rv['rating'], $rv['comment'], $rv['createTime'], $rv['replyComment'], $rv['replyTime'], $now]);
                        $res['reviews']++;
                    }
                    $res['gbp']++;
                    if ($a['lastError']) Sns::saveAccount($a['storeId'], 'gbp', ['lastError' => null]);
                } catch (Throwable $e) {
                    $res['errors'][] = "{$a['storeName']} Google: " . $e->getMessage();
                    Sns::saveAccount($a['storeId'], 'gbp', ['lastError' => mb_substr($e->getMessage(), 0, 300)]);
                }
            }
        }
        return $res;
    }

    public static function upsertDaily(string $storeId, string $channel, string $date, string $metric, int $value): void
    {
        Db::exec('INSERT INTO sns_insight_daily (storeId, channel, date, metric, value) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)', [$storeId, $channel, $date, $metric, $value]);
    }

    // ---------- 週まとめ ----------
    public static function weeklySummary(): array
    {
        $today = Time::nowJst()['date'];
        $from = Time::addDays($today, -7);
        $lines = ['【先週のまとめ】' . Time::formatDateShort($from) . '〜' . Time::formatDateShort(Time::addDays($today, -1))];
        $stores = Db::all('SELECT * FROM store WHERE active = 1 ORDER BY code ASC');
        $total = 0;
        foreach ($stores as $s) {
            $posts = Db::all('SELECT channel, COUNT(*) AS n FROM sns_post WHERE storeId = ? AND status = ? AND postedAt >= ? GROUP BY channel', [$s['id'], 'posted', $from . ' 00:00:00']);
            $byCh = [];
            foreach ($posts as $p) $byCh[$p['channel']] = (int)$p['n'];
            $ig = SnsInsights::sum($s['id'], 'ig', 'reach', $from, $today);
            $g = SnsInsights::sum($s['id'], 'gbp', 'impressions_maps', $from, $today) + SnsInsights::sum($s['id'], 'gbp', 'impressions_search', $from, $today);
            $calls = SnsInsights::sum($s['id'], 'gbp', 'calls', $from, $today);
            $n = array_sum($byCh);
            $total += $n;
            if ($n === 0 && $ig === 0 && $g === 0) continue;
            $lines[] = sprintf('・%s 投稿 IG%d/G%d　IGリーチ %s　G表示 %s　電話 %d', $s['name'], $byCh['ig'] ?? 0, $byCh['gbp'] ?? 0, number_format($ig), number_format($g), $calls);
        }
        if (count($lines) === 1) $lines[] = '投稿・数字はありませんでした。';
        $lines[] = '詳しくは管理画面「SNS投稿」→「分析」で。';
        Notify::send(implode("\n", $lines));
        return ['stores' => count($stores), 'posts' => $total];
    }
}
