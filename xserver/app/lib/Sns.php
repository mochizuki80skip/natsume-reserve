<?php
// SNS 投稿管理の中心：設定・ネタ・文章の組み立て・広告規制チェック・予定枠の計算・下書きの自動生成
declare(strict_types=1);

final class Sns
{
    public const CHANNELS = ['ig', 'gbp'];
    public const CHANNEL_JA = ['ig' => 'Instagram', 'gbp' => 'Google'];
    public const STATUSES = ['draft', 'approved', 'publishing', 'posted', 'failed'];
    public const MAX_LEN = ['ig' => 2200, 'gbp' => 1500]; // Instagram のキャプション / Google の投稿本文の上限
    public const MEDIA_DIR = 'media/sns'; // public/ からの相対パス

    private static bool $ensured = false;
    private static ?array $setting = null;

    // ---------- テーブル ----------
    public static function ensureTables(bool $force = false): void
    {
        if (self::$ensured && !$force) return;
        self::$ensured = true;
        if (!$force) {
            $exists = Db::one("SELECT 1 AS x FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'sns_job'");
            if ($exists) { self::ensureColumns(); return; }
        }
        $sql = file_get_contents(dirname(__DIR__) . '/sql/sns.sql');
        $sql = preg_replace('/^\s*--.*$/m', '', $sql);
        $pdo = Db::pdo();
        foreach (array_filter(array_map('trim', explode(';', $sql))) as $stmt) {
            if ($stmt !== '') $pdo->exec($stmt);
        }
        self::ensureColumns();
    }

    /** 後から追加した列が無ければ足す */
    private static function ensureColumns(): void
    {
        $added = [
            ['sns_setting', 'customVars', 'ALTER TABLE `sns_setting` ADD COLUMN `customVars` LONGTEXT NULL'],
            ['sns_store_setting', 'vars', 'ALTER TABLE `sns_store_setting` ADD COLUMN `vars` LONGTEXT NULL'],
            ['sns_topic', 'standalone', 'ALTER TABLE `sns_topic` ADD COLUMN `standalone` TINYINT(1) NOT NULL DEFAULT 1 AFTER `body`'],
            ['sns_topic', 'imagePath', 'ALTER TABLE `sns_topic` ADD COLUMN `imagePath` VARCHAR(200) NULL AFTER `standalone`'],
            ['sns_post', 'standalone', 'ALTER TABLE `sns_post` ADD COLUMN `standalone` TINYINT(1) NOT NULL DEFAULT 0 AFTER `patternIdx`'],
        ];
        foreach ($added as [$table, $col, $ddl]) {
            $r = Db::one('SELECT 1 AS x FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?', [$table, $col]);
            if (!$r) Db::pdo()->exec($ddl);
        }
    }

    // ---------- 既定値 ----------
    /** 広告規制（柔道整復師法・あはき法の広告制限、景品表示法）で使わない語の初期値。本部画面で編集できる */
    public static function defaultForbiddenWords(): array
    {
        return ['治る', '治り', '治す', '治します', '完治', '根治', '必ず', '絶対', '確実に', '改善します', '改善する', '効果があります', '効きます', 'よく効く', '即効',
            '最高', '最先端', '日本一', 'No.1', 'NO.1', 'ナンバーワン', '唯一', '安全です', '副作用なし', '医学的に', '痛みが消え', '永久', '保証', '激安', '無料キャンペーン'];
    }

    public static function defaultPatterns(): array
    {
        return [
            'ig' => [
                'openings' => [
                    "こんにちは、{店舗名}です。",
                    "{地域}の{店舗名}より、{月}月のお知らせです。",
                    "いつもご覧いただきありがとうございます。{店舗名}です。",
                    "{店舗名}スタッフからひとことです。",
                ],
                'closings' => [
                    "お体のことで気になることがあれば、お気軽にご相談ください。\nご予約はプロフィールのリンク（WEB予約）からどうぞ。",
                    "WEB予約はプロフィールのリンクから。お電話（{電話}）でも承ります。",
                    "気になる方はこの投稿を保存して、来院の際にスタッフにお見せください。\nご予約はプロフィールのリンクから。",
                ],
            ],
            'gbp' => [
                'openings' => [
                    "{地域}の{店舗名}です。",
                    "こんにちは。{地域}で接骨院をお探しの方へ、{店舗名}からのお知らせです。",
                    "{店舗名}（{地域}）です。いつもご利用ありがとうございます。",
                ],
                'keywordLines' => [
                    "「{地域} {キーワード}」でお探しの方は、{店舗名}へお気軽にご相談ください。",
                    "{地域}で{キーワード}のことなら、{店舗名}までご相談ください。",
                ],
                'closings' => [
                    "ご予約はWEB予約ページ（{予約URL}）またはお電話（{電話}）で承ります。",
                    "WEB予約（{予約URL}）は24時間受付中です。お電話（{電話}）でもどうぞ。",
                ],
            ],
        ];
    }

    public static function defaultSchedule(string $channel): array
    {
        return $channel === 'ig'
            ? ['type' => 'weekly', 'weekdays' => [4], 'hour' => 18, 'minute' => 0]
            : ['type' => 'weekly', 'weekdays' => [1, 4], 'hour' => 18, 'minute' => 0];
    }

    // ---------- 全店共通設定 ----------
    public static function setting(): array
    {
        if (self::$setting) return self::$setting;
        self::ensureTables();
        $r = Db::one('SELECT * FROM sns_setting WHERE id = 1');
        if (!$r) {
            Db::exec('INSERT INTO sns_setting (id, forbiddenWords, patterns, defaultIgSchedule, defaultGbpSchedule, lineTargets) VALUES (1, ?, ?, ?, ?, ?)', [
                self::j(self::defaultForbiddenWords()), self::j(self::defaultPatterns()), self::j(self::defaultSchedule('ig')), self::j(self::defaultSchedule('gbp')), '[]']);
            $r = Db::one('SELECT * FROM sns_setting WHERE id = 1');
        }
        return self::$setting = [
            'forbiddenWords' => self::arr($r['forbiddenWords']),
            'patterns' => self::mergePatterns(json_decode($r['patterns'], true) ?: []),
            'defaultIgSchedule' => self::parseSchedule(json_decode($r['defaultIgSchedule'], true)) ?? self::defaultSchedule('ig'),
            'defaultGbpSchedule' => self::parseSchedule(json_decode($r['defaultGbpSchedule'], true)) ?? self::defaultSchedule('gbp'),
            'daysAhead' => (int)$r['daysAhead'],
            'remindHours' => (int)$r['remindHours'],
            'hashtagBase' => (string)$r['hashtagBase'],
            'lineTargets' => self::arr($r['lineTargets']),
            'customVars' => self::parseCustomVars(isset($r['customVars']) && is_string($r['customVars']) ? json_decode($r['customVars'], true) : null),
        ];
    }

    /** 差し込み語の定義（[{key, label, default}]）。key は {} の中に書く名前 */
    public static function parseCustomVars(mixed $v): array
    {
        if (!is_array($v)) return [];
        $out = [];
        foreach ($v as $x) {
            if (!is_array($x)) continue;
            $key = trim((string)($x['key'] ?? ''));
            if ($key === '' || mb_strlen($key) > 20 || preg_match('/[{}\s]/u', $key) || isset(self::BUILTIN_VARS[$key])) continue;
            $out[$key] = ['key' => $key, 'label' => mb_substr(trim((string)($x['label'] ?? $key)), 0, 40) ?: $key, 'default' => mb_substr(trim((string)($x['default'] ?? '')), 0, 200)];
        }
        return array_values($out);
    }

    /** 最初から使える差し込み語と説明 */
    public const BUILTIN_VARS = [
        '店舗名' => '店舗設定の店舗名', 'エリア' => 'SNS 設定の地域（例：沼津市）', '地域' => '「エリア」と同じ', '電話' => '店舗設定の電話番号', '予約URL' => 'この店舗の WEB 予約ページ',
        '月' => '投稿予定の月（数字）', 'キーワード' => 'SNS 設定の検索キーワード（毎回＋日替わり）', '営業時間' => 'SNS 設定の営業時間の表記', '住所' => 'SNS 設定の住所', 'ハッシュタグ' => 'SNS 設定のハッシュタグ（無ければ全店共通）',
    ];

    public static function saveSetting(array $v): void
    {
        self::setting();
        Db::exec('UPDATE sns_setting SET forbiddenWords = ?, patterns = ?, defaultIgSchedule = ?, defaultGbpSchedule = ?, daysAhead = ?, remindHours = ?, hashtagBase = ?, lineTargets = ?, customVars = ? WHERE id = 1', [
            self::j($v['forbiddenWords']), self::j($v['patterns']), self::j($v['defaultIgSchedule']), self::j($v['defaultGbpSchedule']), $v['daysAhead'], $v['remindHours'], $v['hashtagBase'], self::j($v['lineTargets']), self::j($v['customVars'] ?? [])]);
        self::$setting = null;
    }

    /** 保存された型に、足りない項目があれば既定値で補う */
    private static function mergePatterns(array $p): array
    {
        $d = self::defaultPatterns();
        foreach ($d as $ch => $groups) {
            foreach ($groups as $g => $list) {
                $cur = $p[$ch][$g] ?? null;
                $cur = is_array($cur) ? array_values(array_filter(array_map(fn($s) => is_string($s) ? trim($s) : '', $cur), fn($s) => $s !== '')) : [];
                $d[$ch][$g] = $cur ?: $list;
            }
        }
        return $d;
    }

    // ---------- 店舗ごとの設定 ----------
    public static function storeSetting(array $store): array
    {
        self::ensureTables();
        $g = self::setting();
        $r = Db::one('SELECT * FROM sns_store_setting WHERE storeId = ?', [$store['id']]) ?? [];
        $ig = self::parseSchedule(isset($r['igSchedule']) && is_string($r['igSchedule']) ? json_decode($r['igSchedule'], true) : null);
        $gbp = self::parseSchedule(isset($r['gbpSchedule']) && is_string($r['gbpSchedule']) ? json_decode($r['gbpSchedule'], true) : null);
        return [
            'igEnabled' => (bool)($r['igEnabled'] ?? 0),
            'igSchedule' => $ig,                 // NULL なら共通の既定を使う
            'gbpEnabled' => (bool)($r['gbpEnabled'] ?? 0),
            'gbpSchedule' => $gbp,
            'effectiveIgSchedule' => $ig ?? $g['defaultIgSchedule'],
            'effectiveGbpSchedule' => $gbp ?? $g['defaultGbpSchedule'],
            'area' => (string)($r['area'] ?? ''),
            'address' => (string)($r['address'] ?? ''),
            'hoursText' => (string)($r['hoursText'] ?? ''),
            'hashtags' => (string)($r['hashtags'] ?? ''),
            'keywordsFixed' => (string)($r['keywordsFixed'] ?? ''),
            'keywordsRotation' => (string)($r['keywordsRotation'] ?? ''),
            'memo' => (string)($r['memo'] ?? ''),
            'vars' => self::parseVars(isset($r['vars']) && is_string($r['vars']) ? json_decode($r['vars'], true) : null),
        ];
    }

    /** 店舗の差し込み語の値（{key: value}） */
    public static function parseVars(mixed $v): array
    {
        if (!is_array($v)) return [];
        $out = [];
        foreach ($v as $k => $val) {
            $k = trim((string)$k);
            if ($k === '' || mb_strlen($k) > 20 || !is_scalar($val)) continue;
            $out[$k] = mb_substr(trim((string)$val), 0, 200);
        }
        return $out;
    }

    public static function saveStoreSetting(string $storeId, array $v): void
    {
        self::ensureTables();
        Db::exec('INSERT INTO sns_store_setting (storeId, igEnabled, igSchedule, gbpEnabled, gbpSchedule, area, address, hoursText, hashtags, keywordsFixed, keywordsRotation, memo, vars)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE igEnabled = VALUES(igEnabled), igSchedule = VALUES(igSchedule), gbpEnabled = VALUES(gbpEnabled), gbpSchedule = VALUES(gbpSchedule), area = VALUES(area), address = VALUES(address),
            hoursText = VALUES(hoursText), hashtags = VALUES(hashtags), keywordsFixed = VALUES(keywordsFixed), keywordsRotation = VALUES(keywordsRotation), memo = VALUES(memo), vars = VALUES(vars)', [
            $storeId, $v['igEnabled'] ? 1 : 0, $v['igSchedule'] === null ? null : self::j($v['igSchedule']), $v['gbpEnabled'] ? 1 : 0, $v['gbpSchedule'] === null ? null : self::j($v['gbpSchedule']),
            $v['area'], $v['address'], $v['hoursText'], $v['hashtags'], $v['keywordsFixed'], $v['keywordsRotation'], $v['memo'], self::j($v['vars'] ?? [])]);
    }

    // ---------- 頻度（スケジュール） ----------
    /** {type:'weekly', weekdays:[0-6], hour, minute} / {type:'monthly', nth:1-5, weekday:0-6, hour, minute}。不正なら null */
    public static function parseSchedule(mixed $s): ?array
    {
        if (!is_array($s) || !isset($s['type'])) return null;
        $hour = $s['hour'] ?? null;
        $minute = $s['minute'] ?? 0;
        if (!is_numeric($hour) || !is_numeric($minute)) return null;
        $hour = (int)$hour; $minute = (int)$minute;
        if ($hour < 0 || $hour > 23 || $minute < 0 || $minute > 59) return null;
        if ($s['type'] === 'weekly') {
            $wd = $s['weekdays'] ?? null;
            if (!is_array($wd)) return null;
            $wd = array_values(array_unique(array_map('intval', array_filter($wd, 'is_numeric'))));
            $wd = array_values(array_filter($wd, fn($d) => $d >= 0 && $d <= 6));
            if (!$wd) return null;
            sort($wd);
            return ['type' => 'weekly', 'weekdays' => $wd, 'hour' => $hour, 'minute' => $minute];
        }
        if ($s['type'] === 'monthly') {
            $nth = $s['nth'] ?? null; $w = $s['weekday'] ?? null;
            if (!is_numeric($nth) || !is_numeric($w)) return null;
            $nth = (int)$nth; $w = (int)$w;
            if ($nth < 1 || $nth > 5 || $w < 0 || $w > 6) return null;
            return ['type' => 'monthly', 'nth' => $nth, 'weekday' => $w, 'hour' => $hour, 'minute' => $minute];
        }
        return null;
    }

    /** 期間内（from〜to、両端を含む日付）の投稿予定日時 "YYYY-MM-DD HH:MM:00" の一覧 */
    public static function slotsFor(array $schedule, string $from, string $to): array
    {
        $out = [];
        $hm = sprintf(' %02d:%02d:00', $schedule['hour'], $schedule['minute']);
        for ($d = $from; $d <= $to; $d = Time::addDays($d, 1)) {
            $w = Time::weekdayOf($d);
            if ($schedule['type'] === 'weekly') {
                if (in_array($w, $schedule['weekdays'], true)) $out[] = $d . $hm;
            } else {
                $day = (int)substr($d, 8, 2);
                if ($w === $schedule['weekday'] && intdiv($day - 1, 7) + 1 === $schedule['nth']) $out[] = $d . $hm;
            }
        }
        return $out;
    }

    public static function describeSchedule(array $s): string
    {
        $t = sprintf('%d:%02d', $s['hour'], $s['minute']);
        if ($s['type'] === 'weekly') return '毎週 ' . implode('・', array_map(fn($d) => Time::WEEKDAY_JA[$d], $s['weekdays'])) . ' ' . $t;
        return '毎月 第' . $s['nth'] . Time::WEEKDAY_JA[$s['weekday']] . '曜 ' . $t;
    }

    // ---------- 広告規制チェック ----------
    /** @return string[] 見つかった禁止語（重複なし、出現順） */
    public static function complianceHits(string $text, ?array $words = null): array
    {
        $words ??= self::setting()['forbiddenWords'];
        $hits = [];
        $lower = mb_strtolower($text);
        foreach ($words as $w) {
            $w = trim((string)$w);
            if ($w === '') continue;
            $pos = mb_strpos($lower, mb_strtolower($w));
            if ($pos !== false) $hits[$w] = $pos;
        }
        asort($hits);
        return array_keys($hits);
    }

    // ---------- 文章の組み立て ----------
    /** 差し込み語の一覧 */
    public static function placeholders(array $store, array $ss, string $scheduledAt, string $keyword = ''): array
    {
        $month = (int)substr($scheduledAt, 5, 2);
        $ph = [
            '{店舗名}' => $store['name'],
            '{地域}' => $ss['area'] !== '' ? $ss['area'] : '地域',
            '{エリア}' => $ss['area'] !== '' ? $ss['area'] : '地域',
            '{電話}' => Text::formatJpPhone($store['phone']),
            '{予約URL}' => self::bookingUrl($store),
            '{月}' => (string)$month,
            '{キーワード}' => $keyword,
            '{営業時間}' => $ss['hoursText'],
            '{住所}' => $ss['address'],
            '{ハッシュタグ}' => self::defaultHashtags($store, $ss),
        ];
        // 本部が定義した差し込み語：店舗の値 → 無ければ既定値
        foreach (self::setting()['customVars'] as $cv) {
            $val = $ss['vars'][$cv['key']] ?? '';
            $ph['{' . $cv['key'] . '}'] = $val !== '' ? $val : $cv['default'];
        }
        return $ph;
    }

    /** 文章の中の {…} で、差し込み語として定義されていないもの */
    public static function unknownPlaceholders(string $text, ?array $ph = null): array
    {
        $known = $ph !== null ? array_keys($ph) : array_merge(array_map(fn($k) => '{' . $k . '}', array_keys(self::BUILTIN_VARS)), array_map(fn($cv) => '{' . $cv['key'] . '}', self::setting()['customVars']));
        preg_match_all('/\{[^{}\s]{1,20}\}/u', $text, $m);
        return array_values(array_unique(array_filter($m[0], fn($x) => !in_array($x, $known, true))));
    }

    /** 店舗の値が空で既定値も無い差し込み語（投稿前の確認用） */
    public static function emptyPlaceholders(string $text, array $ph): array
    {
        $out = [];
        foreach ($ph as $k => $v) if ($v === '' && str_contains($text, $k)) $out[] = $k;
        return $out;
    }

    /** 差し込み語を置き換える。値が空のものは置き換えずに残す（確認する人が気づけるように） */
    public static function fill(string $tpl, array $ph): string
    {
        return strtr($tpl, array_filter($ph, fn($v) => $v !== ''));
    }

    public static function bookingUrl(array $store): string
    {
        return rtrim(self::baseUrl(), '/') . '/s/' . rawurlencode($store['code']);
    }

    /** 公開 URL のもと（config.php の APP_URL。無ければ今のリクエストのホスト） */
    public static function baseUrl(): string
    {
        $u = rtrim(Config::str('APP_URL'), '/');
        if ($u !== '') return $u;
        $host = $_SERVER['HTTP_HOST'] ?? '';
        if ($host === '') return '';
        return (Http::isHttps() ? 'https' : 'http') . '://' . $host;
    }

    /** 検索キーワード：毎回入れる語＋日替わりの語（patternIdx で巡回） */
    public static function keywordFor(array $ss, int $idx): string
    {
        $fixed = self::splitList($ss['keywordsFixed']);
        $rot = self::splitList($ss['keywordsRotation']);
        $parts = $fixed;
        if ($rot) $parts[] = $rot[$idx % count($rot)];
        return implode('・', array_unique($parts));
    }

    public static function splitList(string $s): array
    {
        return array_values(array_filter(array_map('trim', preg_split('/[、,\n]+/u', $s) ?: []), fn($x) => $x !== ''));
    }

    /**
     * 見出し・本文から投稿文を組み立てる。
     * @return array{fullText:string, closing:string, hashtags:string}
     */
    public static function compose(string $channel, array $store, array $ss, string $scheduledAt, string $title, string $body, int $idx, ?string $closingOverride = null, ?string $hashtagsOverride = null, bool $standalone = false): array
    {
        $p = self::setting()['patterns'][$channel];
        $idx = max(0, $idx);
        $kw = self::keywordFor($ss, $idx);
        $ph = self::placeholders($store, $ss, $scheduledAt, $kw);
        if ($standalone) {
            // 定型投稿：本文をそのまま投稿文にする（差し込み語だけ置き換える）
            return ['fullText' => trim(self::fill(trim($body), $ph)), 'closing' => '', 'hashtags' => ''];
        }
        if ($channel !== 'gbp') $kw = '';
        $opening = self::fill($p['openings'][$idx % count($p['openings'])], $ph);
        $closing = $closingOverride ?? self::fill($p['closings'][$idx % count($p['closings'])], $ph);
        $title = self::fill(trim($title), $ph); $body = self::fill(trim($body), $ph);
        if ($channel === 'ig') {
            $hashtags = $hashtagsOverride ?? self::defaultHashtags($store, $ss);
            $parts = [$opening, ($title !== '' ? "■{$title}\n" : '') . $body, $closing, $hashtags];
        } else {
            $hashtags = '';
            $kwLine = $kw !== '' ? self::fill($p['keywordLines'][$idx % count($p['keywordLines'])], $ph) : '';
            $fixed = [];
            if ($ss['hoursText'] !== '') $fixed[] = '■営業時間 ' . $ss['hoursText'];
            if ($ss['address'] !== '') $fixed[] = '■住所 ' . $ss['address'];
            $parts = [$opening, ($title !== '' ? "{$title}\n" : '') . $body, trim($kwLine . "\n" . $closing), implode("\n", $fixed)];
        }
        $full = implode("\n\n", array_filter(array_map('trim', $parts), fn($s) => $s !== ''));
        return ['fullText' => $full, 'closing' => $closing, 'hashtags' => $hashtags];
    }

    public static function defaultHashtags(array $store, array $ss): string
    {
        $tags = self::splitTags($ss['hashtags']);
        if (!$tags) $tags = self::splitTags(self::setting()['hashtagBase']);
        if (!$tags) {
            $tags = ['#' . preg_replace('/\s+/u', '', $store['name']), '#接骨院'];
            if ($ss['area'] !== '') $tags[] = '#' . $ss['area'];
        }
        return implode(' ', array_unique($tags));
    }

    private static function splitTags(string $s): array
    {
        $out = [];
        foreach (preg_split('/[\s、,]+/u', $s) ?: [] as $t) {
            $t = trim($t);
            if ($t === '') continue;
            $out[] = str_starts_with($t, '#') ? $t : '#' . $t;
        }
        return $out;
    }

    // ---------- ネタ ----------
    /** 次に使うネタ（使用回数が少ない → 最後に使ってから長い もの）。月の指定があればその月のものだけ */
    public static function pickTopic(string $storeId, string $channel, string $scheduledAt, array $excludeIds = []): ?array
    {
        $month = (int)substr($scheduledAt, 5, 2);
        $rows = Db::all('SELECT * FROM sns_topic WHERE active = 1 AND (storeId = ? OR storeId IS NULL) AND channel IN (?, ?) ORDER BY useCount ASC, lastUsedAt ASC, sortOrder ASC, createdAt ASC', [$storeId, $channel, 'both']);
        $seasonal = []; $any = [];
        foreach ($rows as $r) {
            if (in_array($r['id'], $excludeIds, true)) continue;
            $months = self::splitList($r['months']);
            if ($months) {
                if (in_array((string)$month, $months, true)) $seasonal[] = $r;
            } else {
                $any[] = $r;
            }
        }
        // 季節のネタは、その月に未使用のものを優先する
        return $seasonal[0] ?? $any[0] ?? null;
    }

    public static function topicRow(array $r): array
    {
        return ['id' => $r['id'], 'storeId' => $r['storeId'], 'shared' => $r['storeId'] === null, 'channel' => $r['channel'], 'title' => $r['title'], 'body' => $r['body'],
            'standalone' => (bool)($r['standalone'] ?? 1), 'imageUrl' => !empty($r['imagePath']) ? self::mediaUrl($r['imagePath']) : null,
            'months' => $r['months'], 'active' => (bool)$r['active'], 'useCount' => (int)$r['useCount'], 'lastUsedAt' => $r['lastUsedAt'], 'sortOrder' => (int)$r['sortOrder'],
            'unknownPlaceholders' => self::unknownPlaceholders($r['body'])];
    }

    // ---------- 下書きの自動生成 ----------
    /**
     * 予定枠に下書きが無ければ作る。
     * @return array{created:int, missingTopics:int, slots:int}
     */
    public static function generateDrafts(array $store, string $channel, ?int $daysAhead = null, int $limit = 10): array
    {
        self::ensureTables();
        $g = self::setting();
        $ss = self::storeSetting($store);
        if (!($channel === 'ig' ? $ss['igEnabled'] : $ss['gbpEnabled'])) return ['created' => 0, 'missingTopics' => 0, 'slots' => 0];
        $schedule = $channel === 'ig' ? $ss['effectiveIgSchedule'] : $ss['effectiveGbpSchedule'];
        $today = Time::nowJst()['date'];
        $from = Time::addDays($today, 1);
        $to = Time::addDays($today, $daysAhead ?? $g['daysAhead']);
        $slots = self::slotsFor($schedule, $from, $to);
        if (!$slots) return ['created' => 0, 'missingTopics' => 0, 'slots' => 0];
        $existing = array_column(Db::all('SELECT DATE(scheduledAt) AS d FROM sns_post WHERE storeId = ? AND channel = ? AND scheduledAt BETWEEN ? AND ?', [$store['id'], $channel, $from . ' 00:00:00', $to . ' 23:59:59']), 'd');
        $existing = array_flip($existing);
        $created = 0; $missing = 0;
        $usedNow = array_column(Db::all('SELECT topicId FROM sns_post WHERE storeId = ? AND channel = ? AND scheduledAt >= ? AND topicId IS NOT NULL ORDER BY scheduledAt DESC LIMIT 6', [$store['id'], $channel, Time::addDays($today, -60) . ' 00:00:00']), 'topicId');
        foreach ($slots as $at) {
            if ($created >= $limit) break;
            if (isset($existing[substr($at, 0, 10)])) continue;
            $topic = self::pickTopic($store['id'], $channel, $at, $usedNow) ?? self::pickTopic($store['id'], $channel, $at);
            if (!$topic) { $missing++; continue; }
            $idx = random_int(0, 9);
            self::createPost($store, $ss, $channel, $at, $topic, $idx, 'auto');
            Db::exec('UPDATE sns_topic SET useCount = useCount + 1, lastUsedAt = ? WHERE id = ?', [Time::nowJstDateTime(), $topic['id']]);
            $usedNow[] = $topic['id'];
            $created++;
        }
        return ['created' => $created, 'missingTopics' => $missing, 'slots' => count($slots)];
    }

    public static function createPost(array $store, array $ss, string $channel, string $scheduledAt, ?array $topic, int $idx, string $source, string $title = '', string $body = ''): string
    {
        $title = $topic ? $topic['title'] : $title;
        $body = $topic ? $topic['body'] : $body;
        $standalone = $topic ? (bool)($topic['standalone'] ?? 1) : false;
        $c = self::compose($channel, $store, $ss, $scheduledAt, $title, $body, $idx, null, null, $standalone);
        $id = Db::newId();
        [$imagePath, $imageKind] = self::copyTopicImage($topic, $id);
        Db::exec('INSERT INTO sns_post (id, storeId, channel, scheduledAt, status, topicId, title, body, closing, hashtags, postText, patternIdx, standalone, imagePath, imageKind, source, publishMode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
            $id, $store['id'], $channel, $scheduledAt, 'draft', $topic['id'] ?? null, $title, $body, $c['closing'], $c['hashtags'], $c['fullText'], $idx, $standalone ? 1 : 0, $imagePath, $imageKind, $source, self::publishModeFor($store, $channel)]);
        return $id;
    }

    /** 定型投稿の画像を下書き用にコピーする（下書きを消しても定型投稿の画像は残る）。@return array{0:?string,1:string} */
    public static function copyTopicImage(?array $topic, string $postId): array
    {
        if (!$topic || empty($topic['imagePath'])) return [null, 'none'];
        $src = self::mediaDir() . '/' . basename($topic['imagePath']);
        if (!is_file($src)) return [null, 'none'];
        $name = $postId . '-' . substr(bin2hex(random_bytes(4)), 0, 8) . '.jpg';
        return @copy($src, self::mediaDir() . '/' . $name) ? [$name, 'topic'] : [null, 'none'];
    }

    /** API で投稿できる状態なら api、そうでなければ manual（手動投稿の補助） */
    public static function publishModeFor(array $store, string $channel): string
    {
        $acc = self::account($store['id'], $channel);
        if ($channel === 'ig') return $acc && $acc['accessToken'] ? 'api' : 'manual';
        $hq = self::account(null, 'gbp');
        return $acc && $acc['locationName'] !== '' && $hq && $hq['refreshToken'] ? 'api' : 'manual';
    }

    // ---------- 連携アカウント ----------
    public static function account(?string $storeId, string $channel): ?array
    {
        self::ensureTables();
        return $storeId === null
            ? Db::one('SELECT * FROM sns_account WHERE storeId IS NULL AND channel = ?', [$channel])
            : Db::one('SELECT * FROM sns_account WHERE storeId = ? AND channel = ?', [$storeId, $channel]);
    }

    public static function saveAccount(?string $storeId, string $channel, array $v): void
    {
        self::ensureTables();
        $cur = self::account($storeId, $channel);
        $row = [
            'externalId' => $v['externalId'] ?? ($cur['externalId'] ?? ''),
            'username' => $v['username'] ?? ($cur['username'] ?? ''),
            'locationName' => $v['locationName'] ?? ($cur['locationName'] ?? ''),
            'accessToken' => array_key_exists('accessToken', $v) ? ($v['accessToken'] === null ? null : SnsCrypto::encrypt($v['accessToken'])) : ($cur['accessToken'] ?? null),
            'refreshToken' => array_key_exists('refreshToken', $v) ? ($v['refreshToken'] === null ? null : SnsCrypto::encrypt($v['refreshToken'])) : ($cur['refreshToken'] ?? null),
            'tokenExpiresAt' => array_key_exists('tokenExpiresAt', $v) ? $v['tokenExpiresAt'] : ($cur['tokenExpiresAt'] ?? null),
            'tokenRefreshedAt' => array_key_exists('tokenRefreshedAt', $v) ? $v['tokenRefreshedAt'] : ($cur['tokenRefreshedAt'] ?? null),
            'lastError' => array_key_exists('lastError', $v) ? $v['lastError'] : ($cur['lastError'] ?? null),
        ];
        if ($cur) {
            Db::exec('UPDATE sns_account SET externalId = ?, username = ?, locationName = ?, accessToken = ?, refreshToken = ?, tokenExpiresAt = ?, tokenRefreshedAt = ?, lastError = ? WHERE id = ?',
                [$row['externalId'], $row['username'], $row['locationName'], $row['accessToken'], $row['refreshToken'], $row['tokenExpiresAt'], $row['tokenRefreshedAt'], $row['lastError'], $cur['id']]);
        } else {
            Db::exec('INSERT INTO sns_account (id, storeId, channel, externalId, username, locationName, accessToken, refreshToken, tokenExpiresAt, tokenRefreshedAt, lastError) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [Db::newId(), $storeId, $channel, $row['externalId'], $row['username'], $row['locationName'], $row['accessToken'], $row['refreshToken'], $row['tokenExpiresAt'], $row['tokenRefreshedAt'], $row['lastError']]);
        }
    }

    public static function deleteAccount(?string $storeId, string $channel): void
    {
        $cur = self::account($storeId, $channel);
        if ($cur) Db::exec('DELETE FROM sns_account WHERE id = ?', [$cur['id']]);
    }

    /** 画面向け（トークンの値は出さない） */
    public static function accountRow(?array $a): ?array
    {
        if (!$a) return null;
        return ['channel' => $a['channel'], 'externalId' => $a['externalId'], 'username' => $a['username'], 'locationName' => $a['locationName'],
            'connected' => (bool)($a['accessToken'] || $a['refreshToken']), 'tokenExpiresAt' => $a['tokenExpiresAt'], 'tokenRefreshedAt' => $a['tokenRefreshedAt'], 'lastError' => $a['lastError'], 'updatedAt' => $a['updatedAt']];
    }

    // ---------- 投稿の行 ----------
    public static function postRow(array $r, ?array $stat = null): array
    {
        $hits = self::complianceHits($r['postText']);
        return [
            'id' => $r['id'], 'storeId' => $r['storeId'], 'storeCode' => $r['storeCode'] ?? null, 'storeName' => $r['storeName'] ?? null,
            'channel' => $r['channel'], 'scheduledAt' => substr($r['scheduledAt'], 0, 16), 'status' => $r['status'], 'topicId' => $r['topicId'],
            'title' => $r['title'], 'body' => $r['body'], 'closing' => $r['closing'], 'hashtags' => $r['hashtags'], 'fullText' => $r['postText'], 'patternIdx' => (int)$r['patternIdx'], 'standalone' => (bool)($r['standalone'] ?? 0),
            'unfilled' => self::unfilledIn($r['postText']),
            'imageUrl' => $r['imagePath'] ? self::mediaUrl($r['imagePath']) : null, 'imageKind' => $r['imageKind'], 'source' => $r['source'], 'publishMode' => $r['publishMode'],
            'approvedAt' => $r['approvedAt'], 'approvedBy' => $r['approvedBy'], 'postedAt' => $r['postedAt'], 'externalId' => $r['externalId'], 'permalink' => $r['permalink'], 'error' => $r['error'],
            'length' => mb_strlen($r['postText']), 'maxLength' => self::MAX_LEN[$r['channel']] ?? 2200,
            'compliance' => ['hits' => $hits, 'blocking' => $r['channel'] === 'gbp' && $hits !== []],
            'stat' => $stat ? ['reach' => $stat['reach'], 'likes' => $stat['likes'], 'comments' => $stat['comments'], 'saved' => $stat['saved'], 'shares' => $stat['shares'], 'views' => $stat['views'], 'fetchedAt' => $stat['fetchedAt']] : null,
            'createdAt' => $r['createdAt'], 'updatedAt' => $r['updatedAt'],
        ];
    }

    /** 投稿文に残っている {…}（値が空で埋まらなかった、または未定義の差し込み語） */
    public static function unfilledIn(string $text): array
    {
        preg_match_all('/\{[^{}\s]{1,20}\}/u', $text, $m);
        return array_values(array_unique($m[0]));
    }

    public static function mediaUrl(string $path): string
    {
        return rtrim(self::baseUrl(), '/') . '/' . self::MEDIA_DIR . '/' . $path;
    }

    public static function mediaDir(): string
    {
        $dir = self::publicDir() . '/' . self::MEDIA_DIR;
        if (!is_dir($dir)) @mkdir($dir, 0755, true);
        return $dir;
    }

    /** public フォルダ（index.php のある場所）。CLI の cron からは app の 1 つ上 */
    public static function publicDir(): string
    {
        $cands = [dirname(__DIR__, 2), dirname(__DIR__, 2) . '/public'];
        foreach ($cands as $c) if (is_file($c . '/index.php')) return $c;
        return dirname(__DIR__, 2) . '/public';
    }

    // ---------- 小道具 ----------
    public static function j(mixed $v): string
    {
        return json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    private static function arr(?string $json): array
    {
        $v = $json === null ? null : json_decode($json, true);
        return is_array($v) ? array_values($v) : [];
    }

    public static function isValidDateTime(?string $s): bool
    {
        if ($s === null || !preg_match('/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(:\d{2})?$/', $s, $m)) return false;
        return Time::isValidDate($m[1]) && (int)$m[2] <= 23 && (int)$m[3] <= 59;
    }

    /** "YYYY-MM-DDTHH:MM" / "YYYY-MM-DD HH:MM" → "YYYY-MM-DD HH:MM:00" */
    public static function normalizeDateTime(string $s): string
    {
        return substr(str_replace('T', ' ', $s), 0, 16) . ':00';
    }
}
