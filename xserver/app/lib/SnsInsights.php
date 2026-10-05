<?php
// 分析：店舗 × 媒体 × 期間の集計と、ルールに基づく気づき（生成 AI は使わない）
declare(strict_types=1);

final class SnsInsights
{
    public const IG_METRICS = ['followers', 'reach'];
    public const GBP_METRICS = ['impressions_maps', 'impressions_search', 'calls', 'website_clicks', 'directions', 'conversations', 'bookings'];
    public const METRIC_JA = ['followers' => 'フォロワー', 'reach' => 'リーチ', 'impressions_maps' => 'マップ表示', 'impressions_search' => '検索表示', 'calls' => '電話', 'website_clicks' => 'サイトクリック', 'directions' => 'ルート検索', 'conversations' => 'メッセージ', 'bookings' => '予約'];

    public static function sum(string $storeId, string $channel, string $metric, string $from, string $to): int
    {
        $r = Db::one('SELECT COALESCE(SUM(value), 0) AS v FROM sns_insight_daily WHERE storeId = ? AND channel = ? AND metric = ? AND date >= ? AND date < ?', [$storeId, $channel, $metric, $from, $to]);
        return (int)($r['v'] ?? 0);
    }

    /** 最新の値（フォロワー数など） */
    public static function latest(string $storeId, string $channel, string $metric, string $to): ?int
    {
        $r = Db::one('SELECT value FROM sns_insight_daily WHERE storeId = ? AND channel = ? AND metric = ? AND date <= ? ORDER BY date DESC LIMIT 1', [$storeId, $channel, $metric, $to]);
        return $r ? (int)$r['value'] : null;
    }

    /**
     * 店舗一覧の集計（期間と、その直前の同じ長さの期間との比較）
     * @param array<int, array> $stores store の行
     */
    public static function overview(array $stores, string $from, string $to): array
    {
        $days = max(1, Time::diffDays($from, $to));
        $prevFrom = Time::addDays($from, -$days);
        $rows = [];
        foreach ($stores as $s) {
            $row = ['code' => $s['code'], 'name' => $s['name'], 'ig' => [], 'gbp' => [], 'posts' => ['ig' => 0, 'gbp' => 0], 'postStats' => null];
            foreach (['reach'] as $m) $row['ig'][$m] = ['now' => self::sum($s['id'], 'ig', $m, $from, $to), 'prev' => self::sum($s['id'], 'ig', $m, $prevFrom, $from)];
            $row['ig']['followers'] = ['now' => self::latest($s['id'], 'ig', 'followers', $to), 'prev' => self::latest($s['id'], 'ig', 'followers', $from)];
            foreach (self::GBP_METRICS as $m) $row['gbp'][$m] = ['now' => self::sum($s['id'], 'gbp', $m, $from, $to), 'prev' => self::sum($s['id'], 'gbp', $m, $prevFrom, $from)];
            foreach (Db::all('SELECT channel, COUNT(*) AS n FROM sns_post WHERE storeId = ? AND status = ? AND postedAt >= ? AND postedAt < ? GROUP BY channel', [$s['id'], 'posted', $from . ' 00:00:00', $to . ' 00:00:00']) as $p) $row['posts'][$p['channel']] = (int)$p['n'];
            $st = Db::one('SELECT COUNT(*) AS n, AVG(st.reach) AS reach, AVG(st.likes) AS likes, AVG(st.saved) AS saved, AVG(st.shares) AS shares FROM sns_post p JOIN sns_post_stat st ON st.postId = p.id WHERE p.storeId = ? AND p.channel = ? AND p.postedAt >= ? AND p.postedAt < ?', [$s['id'], 'ig', $from . ' 00:00:00', $to . ' 00:00:00']);
            if ($st && (int)$st['n'] > 0) $row['postStats'] = ['n' => (int)$st['n'], 'reach' => round((float)$st['reach']), 'likes' => round((float)$st['likes']), 'saved' => round((float)$st['saved']), 'shares' => round((float)$st['shares'])];
            $rv = Db::one('SELECT COUNT(*) AS n, AVG(rating) AS avg, SUM(CASE WHEN replyComment IS NULL THEN 1 ELSE 0 END) AS noReply, SUM(CASE WHEN createTime >= ? THEN 1 ELSE 0 END) AS recent FROM sns_review WHERE storeId = ?', [$from . ' 00:00:00', $s['id']]);
            $row['reviews'] = $rv && (int)$rv['n'] > 0 ? ['n' => (int)$rv['n'], 'avg' => round((float)$rv['avg'], 1), 'noReply' => (int)$rv['noReply'], 'recent' => (int)$rv['recent']] : null;
            $rows[] = $row;
        }
        return ['from' => $from, 'to' => $to, 'days' => $days, 'prevFrom' => $prevFrom, 'rows' => $rows];
    }

    /** 1 店舗の詳しい分析：日別推移・投稿ごとの数字・気づき */
    public static function detail(array $store, string $from, string $to): array
    {
        $daily = [];
        foreach (Db::all('SELECT channel, date, metric, value FROM sns_insight_daily WHERE storeId = ? AND date >= ? AND date < ? ORDER BY date ASC', [$store['id'], $from, $to]) as $r) $daily[$r['date']][$r['channel'] . ':' . $r['metric']] = (int)$r['value'];
        $posts = array_map(fn($r) => Sns::postRow($r, $r['postId'] ? $r : null),
            Db::all('SELECT p.*, st.postId, st.reach, st.likes, st.comments, st.saved, st.shares, st.views, st.fetchedAt FROM sns_post p LEFT JOIN sns_post_stat st ON st.postId = p.id WHERE p.storeId = ? AND p.status = ? AND p.postedAt >= ? AND p.postedAt < ? ORDER BY p.postedAt DESC', [$store['id'], 'posted', $from . ' 00:00:00', $to . ' 00:00:00']));
        $reviews = array_map(fn($r) => ['id' => $r['id'], 'reviewer' => $r['reviewer'], 'rating' => (int)$r['rating'], 'comment' => $r['comment'], 'createTime' => $r['createTime'], 'replyComment' => $r['replyComment'], 'replyTime' => $r['replyTime']],
            Db::all('SELECT * FROM sns_review WHERE storeId = ? ORDER BY createTime DESC LIMIT 50', [$store['id']]));
        return ['daily' => $daily, 'posts' => $posts, 'reviews' => $reviews, 'findings' => self::findings($store, $from, $to, $posts)];
    }

    /** ルールに基づく気づき（根拠の数字つき。件数が少ないときは断定しない） */
    public static function findings(array $store, string $from, string $to, array $posts): array
    {
        $out = [];
        $days = max(1, Time::diffDays($from, $to));
        $prevFrom = Time::addDays($from, -$days);
        $cmp = function (string $label, int $now, int $prev) use (&$out) {
            if ($prev === 0 && $now === 0) return;
            if ($prev === 0) { $out[] = "{$label}は {$now}（前の期間はデータなし）"; return; }
            $pct = round(($now - $prev) / $prev * 100);
            if (abs($pct) >= 20) $out[] = sprintf('%sが前の期間より %s%d%%（%s → %s）', $label, $pct > 0 ? '+' : '', $pct, number_format($prev), number_format($now));
        };
        $cmp('Instagram のリーチ', self::sum($store['id'], 'ig', 'reach', $from, $to), self::sum($store['id'], 'ig', 'reach', $prevFrom, $from));
        $cmp('Google の表示回数', self::sum($store['id'], 'gbp', 'impressions_maps', $from, $to) + self::sum($store['id'], 'gbp', 'impressions_search', $from, $to), self::sum($store['id'], 'gbp', 'impressions_maps', $prevFrom, $from) + self::sum($store['id'], 'gbp', 'impressions_search', $prevFrom, $from));
        $cmp('Google からの電話', self::sum($store['id'], 'gbp', 'calls', $from, $to), self::sum($store['id'], 'gbp', 'calls', $prevFrom, $from));
        $cmp('Google のルート検索', self::sum($store['id'], 'gbp', 'directions', $from, $to), self::sum($store['id'], 'gbp', 'directions', $prevFrom, $from));
        $ig = array_values(array_filter($posts, fn($p) => $p['channel'] === 'ig' && $p['stat'] && $p['stat']['reach'] !== null));
        if (count($ig) >= 3) {
            usort($ig, fn($a, $b) => ($b['stat']['saved'] ?? 0) <=> ($a['stat']['saved'] ?? 0));
            $best = $ig[0];
            $out[] = sprintf('保存が最も多かった投稿：「%s」（保存 %d・リーチ %d）。同じ切り口のネタを増やす候補です', mb_substr($best['title'] !== '' ? $best['title'] : $best['body'], 0, 24), $best['stat']['saved'] ?? 0, $best['stat']['reach'] ?? 0);
            $byWd = [];
            foreach ($ig as $p) { $w = Time::weekdayOf(substr($p['scheduledAt'], 0, 10)); $byWd[$w][] = (int)$p['stat']['reach']; }
            if (count($byWd) >= 2) {
                $avg = array_map(fn($v) => array_sum($v) / count($v), $byWd);
                arsort($avg);
                $top = array_key_first($avg);
                if (count($byWd[$top]) >= 2) $out[] = sprintf('リーチの平均が高い曜日：%s曜（%d 件の平均 %s）', Time::WEEKDAY_JA[$top], count($byWd[$top]), number_format(round($avg[$top])));
            }
        } elseif (count($ig) > 0) {
            $out[] = 'Instagram の数字がある投稿が ' . count($ig) . ' 件のため、傾向はまだ判断できません（3 件以上で比較します）';
        }
        $noReply = Db::one('SELECT COUNT(*) AS n FROM sns_review WHERE storeId = ? AND replyComment IS NULL AND createTime >= ?', [$store['id'], Time::addDays($to, -90) . ' 00:00:00']);
        if ($noReply && (int)$noReply['n'] > 0) $out[] = '返信していないクチコミが ' . (int)$noReply['n'] . ' 件あります（直近 90 日）。返信は Google 検索での印象に影響します';
        return $out;
    }

    /** CSV（Excel で開ける BOM 付き） */
    public static function csv(array $stores, string $from, string $to): string
    {
        $ov = self::overview($stores, $from, $to);
        $head = ['店舗コード', '店舗名', 'IG投稿数', 'G投稿数', 'IGフォロワー', 'IGリーチ', 'IGリーチ(前期間)', 'Gマップ表示', 'G検索表示', 'G電話', 'Gサイトクリック', 'Gルート検索', 'Gメッセージ', 'G予約', 'クチコミ件数', '平均評価', '未返信'];
        $lines = ["\xEF\xBB\xBF" . implode(',', $head)];
        foreach ($ov['rows'] as $r) {
            $v = [$r['code'], $r['name'], $r['posts']['ig'], $r['posts']['gbp'], $r['ig']['followers']['now'] ?? '', $r['ig']['reach']['now'], $r['ig']['reach']['prev']];
            foreach (self::GBP_METRICS as $m) $v[] = $r['gbp'][$m]['now'];
            $v[] = $r['reviews']['n'] ?? ''; $v[] = $r['reviews']['avg'] ?? ''; $v[] = $r['reviews']['noReply'] ?? '';
            $lines[] = implode(',', array_map(fn($x) => '"' . str_replace('"', '""', (string)$x) . '"', $v));
        }
        return implode("\r\n", $lines) . "\r\n";
    }
}
