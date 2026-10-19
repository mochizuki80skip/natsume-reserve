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
            $ss = Sns::storeSetting($s);
            $row = ['code' => $s['code'], 'name' => $s['name'], 'areaGroup' => Sns::areaGroupOf($ss), 'ig' => [], 'gbp' => [], 'posts' => ['ig' => 0, 'gbp' => 0], 'postStats' => null, 'mainKw' => self::mainKeywordSearches($s['id'], $ss)];
            foreach (['reach'] as $m) $row['ig'][$m] = ['now' => self::sum($s['id'], 'ig', $m, $from, $to), 'prev' => self::sum($s['id'], 'ig', $m, $prevFrom, $from)];
            $row['ig']['followers'] = ['now' => self::latest($s['id'], 'ig', 'followers', $to), 'prev' => self::latest($s['id'], 'ig', 'followers', $from)];
            foreach (self::GBP_METRICS as $m) $row['gbp'][$m] = ['now' => self::sum($s['id'], 'gbp', $m, $from, $to), 'prev' => self::sum($s['id'], 'gbp', $m, $prevFrom, $from)];
            foreach (Db::all('SELECT channel, COUNT(*) AS n FROM sns_post WHERE storeId = ? AND status = ? AND postedAt >= ? AND postedAt < ? GROUP BY channel', [$s['id'], 'posted', $from . ' 00:00:00', $to . ' 00:00:00']) as $p) $row['posts'][$p['channel']] = (int)$p['n'];
            $st = Db::one('SELECT COUNT(*) AS n, AVG(st.reach) AS reach, AVG(st.likes) AS likes, AVG(st.saved) AS saved, AVG(st.shares) AS shares FROM sns_post p JOIN sns_post_stat st ON st.postId = p.id WHERE p.storeId = ? AND p.channel = ? AND p.postedAt >= ? AND p.postedAt < ?', [$s['id'], 'ig', $from . ' 00:00:00', $to . ' 00:00:00']);
            if ($st && (int)$st['n'] > 0) $row['postStats'] = ['n' => (int)$st['n'], 'reach' => round((float)$st['reach']), 'likes' => round((float)$st['likes']), 'saved' => round((float)$st['saved']), 'shares' => round((float)$st['shares'])];
            $row['kwTop'] = self::keywordTop($s['id'], 3);
            $rv = Db::one('SELECT COUNT(*) AS n, AVG(rating) AS avg, SUM(CASE WHEN replyComment IS NULL THEN 1 ELSE 0 END) AS noReply, SUM(CASE WHEN createTime >= ? THEN 1 ELSE 0 END) AS recent FROM sns_review WHERE storeId = ?', [$from . ' 00:00:00', $s['id']]);
            $row['reviews'] = $rv && (int)$rv['n'] > 0 ? ['n' => (int)$rv['n'], 'avg' => round((float)$rv['avg'], 1), 'noReply' => (int)$rv['noReply'], 'recent' => (int)$rv['recent']] : null;
            $rows[] = $row;
        }
        return ['from' => $from, 'to' => $to, 'days' => $days, 'prevFrom' => $prevFrom, 'rows' => $rows, 'areas' => self::areas($rows)];
    }

    /** エリア分けごとの合計（店舗の行を足し合わせる。クチコミの評価は件数で重み付けした平均） */
    public static function areas(array $rows): array
    {
        $out = [];
        foreach ($rows as $r) {
            $g = $r['areaGroup'];
            $a = $out[$g] ?? ['name' => $g, 'stores' => 0, 'posts' => ['ig' => 0, 'gbp' => 0], 'gbp' => [], 'reviews' => ['n' => 0, 'sum' => 0.0, 'noReply' => 0], 'mainKw' => ['now' => 0, 'prev' => 0, 'hasPrev' => false, 'stores' => 0]];
            $a['stores']++;
            $a['posts']['ig'] += $r['posts']['ig']; $a['posts']['gbp'] += $r['posts']['gbp'];
            foreach (self::GBP_METRICS as $m) {
                $a['gbp'][$m]['now'] = ($a['gbp'][$m]['now'] ?? 0) + (int)$r['gbp'][$m]['now'];
                $a['gbp'][$m]['prev'] = ($a['gbp'][$m]['prev'] ?? 0) + (int)$r['gbp'][$m]['prev'];
            }
            if ($r['reviews']) { $a['reviews']['n'] += $r['reviews']['n']; $a['reviews']['sum'] += $r['reviews']['avg'] * $r['reviews']['n']; $a['reviews']['noReply'] += $r['reviews']['noReply']; }
            if ($r['mainKw']['month']) {
                $a['mainKw']['now'] += $r['mainKw']['now']; $a['mainKw']['stores']++;
                if ($r['mainKw']['prev'] !== null) { $a['mainKw']['prev'] += $r['mainKw']['prev']; $a['mainKw']['hasPrev'] = true; }
            }
            $out[$g] = $a;
        }
        $list = [];
        foreach ($out as $a) {
            $n = $a['reviews']['n'];
            $a['reviews'] = $n ? ['n' => $n, 'avg' => round($a['reviews']['sum'] / $n, 1), 'noReply' => $a['reviews']['noReply']] : null;
            $a['mainKw'] = ['now' => $a['mainKw']['now'], 'prev' => $a['mainKw']['hasPrev'] ? $a['mainKw']['prev'] : null, 'stores' => $a['mainKw']['stores']];
            $list[] = $a;
        }
        usort($list, fn($x, $y) => ($x['name'] === Sns::NO_AREA_GROUP) <=> ($y['name'] === Sns::NO_AREA_GROUP));
        return $list;
    }

    /** メインキーワード（例：接骨院）を含む検索の回数（最新の月と前月）。MEO で一番狙う語の伸びを見る */
    public static function mainKeywordSearches(string $storeId, array $ss): array
    {
        $word = Sns::mainKeyword($ss);
        $ym = self::latestKeywordMonth($storeId);
        if ($word === '' || !$ym) return ['word' => $word, 'month' => $ym, 'now' => 0, 'prev' => null];
        $prev = date('Y-m', strtotime($ym . '-01 -1 month'));
        $norm = fn(string $x) => mb_strtolower(mb_convert_kana(preg_replace('/\s+/u', '', $x), 'cKV', 'UTF-8'));
        $nw = $norm($word);
        $sum = function (string $m) use ($storeId, $norm, $nw): ?int {
            $rows = Db::all('SELECT keyword, value FROM sns_search_keyword WHERE storeId = ? AND ym = ?', [$storeId, $m]);
            if (!$rows) return null;
            $t = 0;
            foreach ($rows as $r) if (str_contains($norm($r['keyword']), $nw)) $t += (int)$r['value'];
            return $t;
        };
        return ['word' => $word, 'month' => $ym, 'now' => $sum($ym) ?? 0, 'prev' => $sum($prev)];
    }

    /**
     * 週ごとの投稿数と Google の数字（直近 $weeks 週。月曜はじまり）。
     * 投稿した週と、しなかった週の表示回数の平均も返す（投稿の効果の目安）
     */
    public static function weekly(string $storeId, string $to, int $weeks = 12): array
    {
        $end = Time::addDays($to, -1);
        $start = Time::addDays($end, -((Time::weekdayOf($end) + 6) % 7));     // 最後の週の月曜
        $first = Time::addDays($start, -7 * ($weeks - 1));
        $rows = [];
        for ($i = 0; $i < $weeks; $i++) {
            $ws = Time::addDays($first, 7 * $i); $we = Time::addDays($ws, 7);
            $m = [];
            foreach (Db::all('SELECT metric, SUM(value) AS v FROM sns_insight_daily WHERE storeId = ? AND channel = ? AND date >= ? AND date < ? GROUP BY metric', [$storeId, 'gbp', $ws, $we]) as $r) $m[$r['metric']] = (int)$r['v'];
            $posts = [];
            foreach (Db::all('SELECT channel, COUNT(*) AS n FROM sns_post WHERE storeId = ? AND status = ? AND postedAt >= ? AND postedAt < ? GROUP BY channel', [$storeId, 'posted', $ws . ' 00:00:00', $we . ' 00:00:00']) as $r) $posts[$r['channel']] = (int)$r['n'];
            $rows[] = ['week' => $ws, 'postsGbp' => $posts['gbp'] ?? 0, 'postsIg' => $posts['ig'] ?? 0, 'hasData' => $m !== [],
                'impressions' => ($m['impressions_maps'] ?? 0) + ($m['impressions_search'] ?? 0),
                'actions' => ($m['calls'] ?? 0) + ($m['directions'] ?? 0) + ($m['website_clicks'] ?? 0) + ($m['bookings'] ?? 0) + ($m['conversations'] ?? 0),
                'calls' => $m['calls'] ?? 0, 'directions' => $m['directions'] ?? 0];
        }
        $withData = array_values(array_filter($rows, fn($r) => $r['hasData']));
        $avg = fn(array $list) => $list ? (int)round(array_sum(array_column($list, 'impressions')) / count($list)) : null;
        $posted = array_values(array_filter($withData, fn($r) => $r['postsGbp'] > 0));
        $notPosted = array_values(array_filter($withData, fn($r) => $r['postsGbp'] === 0));
        return ['rows' => $rows, 'postedWeeks' => count($posted), 'quietWeeks' => count($notPosted), 'avgPosted' => $avg($posted), 'avgQuiet' => $avg($notPosted)];
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
        $weekly = self::weekly($store['id'], $to);
        return ['daily' => $daily, 'posts' => $posts, 'reviews' => $reviews, 'keywords' => self::keywords($store), 'weekly' => $weekly, 'findings' => self::findings($store, $from, $to, $posts, $weekly)];
    }

    /** 検索キーワードの最新の月（無ければ null） */
    public static function latestKeywordMonth(string $storeId): ?string
    {
        $r = Db::one('SELECT MAX(ym) AS ym FROM sns_search_keyword WHERE storeId = ?', [$storeId]);
        return $r && $r['ym'] ? (string)$r['ym'] : null;
    }

    /** 最新の月の検索キーワード上位（一覧の列用） */
    public static function keywordTop(string $storeId, int $n): array
    {
        $ym = self::latestKeywordMonth($storeId);
        if (!$ym) return [];
        return array_map(fn($r) => ['keyword' => $r['keyword'], 'value' => (int)$r['value'], 'threshold' => (bool)$r['threshold']],
            Db::all('SELECT keyword, value, threshold FROM sns_search_keyword WHERE storeId = ? AND ym = ? ORDER BY value DESC, keyword ASC LIMIT ' . max(1, $n), [$storeId, $ym]));
    }

    /**
     * 1 店舗の検索キーワード：最新の月の上位 50 語（前月の回数つき）と、
     * 店舗で設定した語（メインキーワード・エリア・症状）を含む検索の合計（MEO で狙った語がどれだけ検索されているか）
     */
    public static function keywords(array $store): array
    {
        $ym = self::latestKeywordMonth($store['id']);
        if (!$ym) return ['month' => null, 'prevMonth' => null, 'rows' => [], 'tracked' => [], 'total' => 0];
        $prev = date('Y-m', strtotime($ym . '-01 -1 month'));
        $prevMap = [];
        foreach (Db::all('SELECT keyword, value FROM sns_search_keyword WHERE storeId = ? AND ym = ?', [$store['id'], $prev]) as $r) $prevMap[$r['keyword']] = (int)$r['value'];
        $all = Db::all('SELECT keyword, value, threshold FROM sns_search_keyword WHERE storeId = ? AND ym = ? ORDER BY value DESC, keyword ASC', [$store['id'], $ym]);
        $rows = array_map(fn($r) => ['keyword' => $r['keyword'], 'value' => (int)$r['value'], 'threshold' => (bool)$r['threshold'], 'prev' => $prevMap[$r['keyword']] ?? null], array_slice($all, 0, 50));
        $ss = Sns::storeSetting($store);
        $words = array_values(array_unique(array_filter(array_merge(Sns::splitList($ss['keywordsFixed']), $ss['area'] !== '' ? [$ss['area']] : [], Sns::splitList($ss['keywordsRotation'])))));
        $norm = fn(string $x) => mb_strtolower(mb_convert_kana(preg_replace('/\s+/u', '', $x), 'cKV', 'UTF-8'));
        $tracked = [];
        foreach ($words as $w) {
            $nw = $norm($w); $now = 0; $before = 0; $n = 0;
            foreach ($all as $r) if (str_contains($norm($r['keyword']), $nw)) { $now += (int)$r['value']; $n++; }
            foreach ($prevMap as $k => $v) if (str_contains($norm($k), $nw)) $before += $v;
            $tracked[] = ['word' => $w, 'value' => $now, 'prev' => $prevMap ? $before : null, 'count' => $n];
        }
        return ['month' => $ym, 'prevMonth' => $prevMap ? $prev : null, 'rows' => $rows, 'tracked' => $tracked, 'total' => array_sum(array_map(fn($r) => (int)$r['value'], $all))];
    }

    /** ルールに基づく気づき（根拠の数字つき。件数が少ないときは断定しない） */
    public static function findings(array $store, string $from, string $to, array $posts, ?array $weekly = null): array
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
        // Google：表示から行動（電話・ルート・サイト・予約・メッセージ）につながった割合
        $act = fn(string $f, string $t) => array_sum(array_map(fn($m) => self::sum($store['id'], 'gbp', $m, $f, $t), ['calls', 'directions', 'website_clicks', 'bookings', 'conversations']));
        $imp = fn(string $f, string $t) => self::sum($store['id'], 'gbp', 'impressions_maps', $f, $t) + self::sum($store['id'], 'gbp', 'impressions_search', $f, $t);
        $iNow = $imp($from, $to); $iPrev = $imp($prevFrom, $from);
        if ($iNow >= 100) {
            $rate = $act($from, $to) / $iNow * 100;
            $line = sprintf('Google で表示されたうち、電話・ルート検索などの行動につながった割合は %.1f%%', $rate);
            if ($iPrev >= 100) $line .= sprintf('（前の期間 %.1f%%）', $act($prevFrom, $from) / $iPrev * 100);
            $out[] = $line . '。下がっている場合は、写真・クチコミ・投稿の「予約ボタンから」などの案内を見直す目安です';
        }
        // 同じエリアの店舗の平均と比べる
        $ss = Sns::storeSetting($store);
        $group = trim($ss['areaGroup']);
        if ($group !== '' && $iNow > 0) {
            $others = Db::all('SELECT s.* FROM store s JOIN sns_store_setting x ON x.storeId = s.id WHERE s.active = 1 AND x.areaGroup = ? AND s.id <> ?', [$group, $store['id']]);
            $vals = array_values(array_filter(array_map(fn($o) => self::sum($o['id'], 'gbp', 'impressions_maps', $from, $to) + self::sum($o['id'], 'gbp', 'impressions_search', $from, $to), $others)));
            if (count($vals) >= 1) {
                $avg = array_sum($vals) / count($vals);
                $pct = round(($iNow - $avg) / max(1, $avg) * 100);
                if (abs($pct) >= 30) $out[] = sprintf('Google の表示回数は、同じエリア（%s）のほかの %d 店舗の平均より %s%d%%（%s と平均 %s）', $group, count($vals), $pct > 0 ? '+' : '', $pct, number_format($iNow), number_format(round($avg)));
            }
        }
        // 投稿した週としなかった週の表示回数
        if ($weekly && $weekly['postedWeeks'] >= 2 && $weekly['quietWeeks'] >= 2 && $weekly['avgQuiet'] > 0) {
            $pct = round(($weekly['avgPosted'] - $weekly['avgQuiet']) / $weekly['avgQuiet'] * 100);
            $out[] = sprintf('直近 12 週で、Google に投稿した週（%d 週）の表示回数の平均は %s、投稿しなかった週（%d 週）は %s（%s%d%%）。季節などの影響もあるため目安です',
                $weekly['postedWeeks'], number_format($weekly['avgPosted']), $weekly['quietWeeks'], number_format($weekly['avgQuiet']), $pct >= 0 ? '+' : '', $pct);
        } elseif ($weekly && $weekly['quietWeeks'] >= 2 && $weekly['postedWeeks'] === 0) {
            $out[] = '直近 12 週に「投稿した」と記録された Google の投稿がありません。手動投稿のあとは「投稿した」を押すと、投稿の効果を比べられます';
        }
        // メインキーワードを含む検索
        $kw = self::mainKeywordSearches($store['id'], $ss);
        if ($kw['month'] && $kw['word'] !== '') {
            $line = sprintf('「%s」を含む検索で表示された回数（%s）：%s', $kw['word'], $kw['month'], number_format($kw['now']));
            if ($kw['prev'] !== null) $line .= sprintf('（前月 %s）', number_format($kw['prev']));
            $out[] = $line;
        }
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
        $head = ['店舗コード', '店舗名', 'エリア分け', 'メインキーワード', 'メインKW検索(最新月)', 'メインKW検索(前月)', 'IG投稿数', 'G投稿数', 'IGフォロワー', 'IGリーチ', 'IGリーチ(前期間)', 'Gマップ表示', 'G検索表示', 'G電話', 'Gサイトクリック', 'Gルート検索', 'Gメッセージ', 'G予約', 'クチコミ件数', '平均評価', '未返信'];
        $lines = ["\xEF\xBB\xBF" . implode(',', $head)];
        foreach ($ov['rows'] as $r) {
            $v = [$r['code'], $r['name'], $r['areaGroup'], $r['mainKw']['word'], $r['mainKw']['month'] ? $r['mainKw']['now'] : '', $r['mainKw']['prev'] ?? '', $r['posts']['ig'], $r['posts']['gbp'], $r['ig']['followers']['now'] ?? '', $r['ig']['reach']['now'], $r['ig']['reach']['prev']];
            foreach (self::GBP_METRICS as $m) $v[] = $r['gbp'][$m]['now'];
            $v[] = $r['reviews']['n'] ?? ''; $v[] = $r['reviews']['avg'] ?? ''; $v[] = $r['reviews']['noReply'] ?? '';
            $lines[] = implode(',', array_map(fn($x) => '"' . str_replace('"', '""', (string)$x) . '"', $v));
        }
        return implode("\r\n", $lines) . "\r\n";
    }
}
