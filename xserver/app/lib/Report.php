<?php
// 日報：本部が決めた項目（report_item）を、店舗のその日の数字（予約表・窓口集計・シフトなど）と店舗の手入力で埋める
declare(strict_types=1);

final class Report
{
    /** 項目の種類：value＝名前と値、perf＝目標・実績・差分の行、text＝文章、staff＝出勤状況（施術者・受付・離反率） */
    public const KINDS = ['value', 'perf', 'text', 'staff'];

    /** 自動で入る数字（どこから取るか）。fmt：num 人数など / yen 金額 / dec 小数 / pct 割合 / time 時間 */
    public const AUTO = [
        'visit.am' => ['予約表：午前の来院数', 'num'], 'visit.pm' => ['予約表：午後の来院数', 'num'], 'visit.total' => ['予約表：来院数の合計', 'num'],
        'visit.jibai' => ['予約表：自賠の来院数', 'num'], 'visit.self' => ['予約表：自費（メニュー）の来院数', 'num'],
        'new.new' => ['予約表：初診の人数', 'num'], 'new.revisit' => ['予約表：再来の人数', 'num'], 'new.jibai' => ['予約表：新患（自賠）の人数', 'num'], 'new.total' => ['予約表：初診・再来・新患（自賠）の合計', 'num'],
        'mado.copay' => ['窓口集計：一部負担金', 'yen'], 'mado.third' => ['窓口集計：第三者', 'yen'], 'mado.self' => ['窓口集計：自費', 'yen'], 'mado.acu' => ['窓口集計：鍼', 'yen'],
        'mado.goods' => ['窓口集計：物販', 'yen'], 'mado.colCopay' => ['窓口集計：未収回収 一部負担金', 'yen'], 'mado.colSelf' => ['窓口集計：未収回収 自費', 'yen'],
        'mado.diffCopay' => ['窓口集計：差額 一部負担金', 'yen'], 'mado.diffSelf' => ['窓口集計：差額 自費', 'yen'], 'mado.unknown' => ['窓口集計：不明金', 'yen'],
        'mado.deposit' => ['窓口集計：保証金', 'yen'], 'mado.cert' => ['窓口集計：証明書代', 'yen'], 'mado.total' => ['窓口集計：本日の窓口計（一部負担金＋第三者＋自費＋鍼）', 'yen'],
        'mado.mail' => ['窓口集計：報告メール合計', 'yen'], 'mado.bank' => ['窓口集計：通帳入金額', 'yen'], 'mado.insClaim' => ['窓口集計：保険請求金額', 'yen'], 'mado.jibaiClaim' => ['窓口集計：自賠責請求金額', 'yen'],
        'workdays' => ['稼働日数（今月、今日までの営業日）', 'num'],
        'month.visits' => ['今月の来院数（今日まで）', 'num'], 'month.avg' => ['現在の平均（今月の来院数 ÷ 稼働日数）', 'dec'], 'month.achieve' => ['目標達成率（現在の平均 ÷ 平均来院数目標）', 'pct'],
        'month.new' => ['今月の初診の人数', 'num'], 'month.revisit' => ['今月の再来の人数', 'num'], 'month.jibaiNew' => ['今月の新患（自賠）の人数', 'num'], 'month.goods' => ['今月の物販（窓口集計）', 'yen'],
    ];
    /** 店舗で入力する項目 */
    public const MANUAL = ['manual:num' => ['店舗で入力（数）', 'num'], 'manual:yen' => ['店舗で入力（金額）', 'yen'], 'manual:time' => ['店舗で入力（時間 例 1:05）', 'time'], 'manual:text' => ['店舗で入力（文章・毎日）', 'text'], 'manual:monthtext' => ['店舗で入力（文章・月に 1 回）', 'text']];

    /** 初めて開いたときの項目（今のスプレッドシートの日報と同じ並び） */
    public const DEFAULT_ITEMS = [
        ['id' => 'target-avg', 'section' => '概要', 'kind' => 'value', 'label' => '平均来院数目標', 'source' => 'target:month.avg'],
        ['id' => 'workdays', 'section' => '概要', 'kind' => 'value', 'label' => '稼働日数', 'source' => 'workdays'],
        ['id' => 'am', 'section' => '本日の来院数', 'kind' => 'value', 'label' => 'AM', 'source' => 'visit.am'],
        ['id' => 'new', 'section' => '本日の来院数', 'kind' => 'value', 'label' => '新患', 'source' => 'new.new'],
        ['id' => 'pm', 'section' => '本日の来院数', 'kind' => 'value', 'label' => 'PM', 'source' => 'visit.pm'],
        ['id' => 'revisit', 'section' => '本日の来院数', 'kind' => 'value', 'label' => '再来', 'source' => 'new.revisit'],
        ['id' => 'jibai', 'section' => '本日の来院数', 'kind' => 'value', 'label' => '自賠', 'source' => 'visit.jibai'],
        ['id' => 'new-jibai', 'section' => '本日の来院数', 'kind' => 'value', 'label' => '新患（自賠）', 'source' => 'new.jibai'],
        ['id' => 'self', 'section' => '本日の来院数', 'kind' => 'value', 'label' => '自費', 'source' => 'visit.self'],
        ['id' => 'third', 'section' => '本日の来院数', 'kind' => 'value', 'label' => '第三者', 'source' => 'manual:num'],
        ['id' => 'total', 'section' => '本日の来院数', 'kind' => 'value', 'label' => '合計', 'source' => 'visit.total'],
        ['id' => 'new-total', 'section' => '本日の来院数', 'kind' => 'value', 'label' => '新患 合計', 'source' => 'new.total'],
        ['id' => 'ot-today', 'section' => '時間外', 'kind' => 'value', 'label' => '本日の時間外', 'source' => 'manual:time'],
        ['id' => 'ot-month', 'section' => '時間外', 'kind' => 'value', 'label' => '今月の時間外', 'source' => 'sum:ot-today'],
        ['id' => 'review-today', 'section' => '時間外', 'kind' => 'value', 'label' => '本日の口コミ', 'source' => 'manual:num'],
        ['id' => 'm-copay', 'section' => '入金額詳細', 'kind' => 'value', 'label' => '窓口合計', 'source' => 'mado.copay'],
        ['id' => 'm-colcopay', 'section' => '入金額詳細', 'kind' => 'value', 'label' => '未回収（負）', 'source' => 'mado.colCopay'],
        ['id' => 'm-third', 'section' => '入金額詳細', 'kind' => 'value', 'label' => '第三者', 'source' => 'mado.third'],
        ['id' => 'm-colself', 'section' => '入金額詳細', 'kind' => 'value', 'label' => '未回収（自）', 'source' => 'mado.colSelf'],
        ['id' => 'm-self', 'section' => '入金額詳細', 'kind' => 'value', 'label' => '自費', 'source' => 'mado.self'],
        ['id' => 'm-diffcopay', 'section' => '入金額詳細', 'kind' => 'value', 'label' => '差額（負）', 'source' => 'mado.diffCopay'],
        ['id' => 'm-acu', 'section' => '入金額詳細', 'kind' => 'value', 'label' => '鍼', 'source' => 'mado.acu'],
        ['id' => 'm-diffself', 'section' => '入金額詳細', 'kind' => 'value', 'label' => '差額（自）', 'source' => 'mado.diffSelf'],
        ['id' => 'm-goods', 'section' => '入金額詳細', 'kind' => 'value', 'label' => '販売', 'source' => 'mado.goods'],
        ['id' => 'm-deposit', 'section' => '入金額詳細', 'kind' => 'value', 'label' => '保証金', 'source' => 'mado.deposit'],
        ['id' => 'm-unknown', 'section' => '入金額詳細', 'kind' => 'value', 'label' => '不明金', 'source' => 'mado.unknown'],
        ['id' => 'm-cert', 'section' => '入金額詳細', 'kind' => 'value', 'label' => '証明書代', 'source' => 'mado.cert'],
        ['id' => 'm-total', 'section' => '入金額詳細', 'kind' => 'value', 'label' => '本日の窓口計', 'source' => 'mado.total'],
        ['id' => 'bank-1', 'section' => '入金額詳細', 'kind' => 'value', 'label' => '通帳入金額 ①', 'source' => 'manual:yen'],
        ['id' => 'ins-claim', 'section' => '入金額詳細', 'kind' => 'value', 'label' => '保険請求額', 'source' => 'mado.insClaim'],
        ['id' => 'bank-2', 'section' => '入金額詳細', 'kind' => 'value', 'label' => '通帳入金額 ②', 'source' => 'manual:yen'],
        ['id' => 'jibai-claim', 'section' => '入金額詳細', 'kind' => 'value', 'label' => '自賠請求額', 'source' => 'mado.jibaiClaim'],
        ['id' => 'p-new', 'section' => '月間成績', 'kind' => 'perf', 'label' => '新規', 'source' => 'month.new'],
        ['id' => 'p-revisit', 'section' => '月間成績', 'kind' => 'perf', 'label' => '再来', 'source' => 'month.revisit'],
        ['id' => 'p-goods', 'section' => '月間成績', 'kind' => 'perf', 'label' => '物販', 'source' => 'month.goods'],
        ['id' => 'p-review', 'section' => '月間成績', 'kind' => 'perf', 'label' => '口コミ', 'source' => 'sum:review-today'],
        ['id' => 'avg', 'section' => '月間成績', 'kind' => 'value', 'label' => '現在の平均', 'source' => 'month.avg'],
        ['id' => 'achieve', 'section' => '月間成績', 'kind' => 'value', 'label' => '目標達成率', 'source' => 'month.achieve'],
        ['id' => 'goal', 'section' => '今月の目標：数値ではなく志や想いの目標【月末時手入力】', 'kind' => 'text', 'label' => '今月の目標', 'source' => 'manual:monthtext'],
        ['id' => 'staff', 'section' => '出勤状況', 'kind' => 'staff', 'label' => '出勤状況', 'source' => 'staff'],
    ];

    /** 本部が決めた項目（まだ無ければ初めの項目） */
    public static function items(): array
    {
        $rows = Db::all('SELECT id, section, kind, label, source FROM report_item ORDER BY sortOrder ASC');
        return $rows ?: self::DEFAULT_ITEMS;
    }

    /** source の数字の形 */
    public static function fmtOf(string $src, ?array $items = null): string
    {
        if (isset(self::AUTO[$src])) return self::AUTO[$src][1];
        if (isset(self::MANUAL[$src])) return self::MANUAL[$src][1];
        if (str_starts_with($src, 'target:')) return self::fmtOf(substr($src, 7), $items);
        if (str_starts_with($src, 'sum:')) {
            // 今月の合計：もとの手入力の項目の形（時間なら時間）
            foreach ($items ?? self::items() as $it) if ($it['id'] === substr($src, 4)) return self::fmtOf((string)$it['source']);
        }
        return $src === 'staff' ? 'staff' : 'num';
    }

    public static function validSource(string $src, array $ids): bool
    {
        if (isset(self::AUTO[$src]) || isset(self::MANUAL[$src]) || $src === 'staff') return true;
        if (str_starts_with($src, 'target:')) return isset(self::AUTO[substr($src, 7)]) || self::validSum(substr($src, 7), $ids);
        return self::validSum($src, $ids);
    }

    private static function validSum(string $src, array $ids): bool
    {
        return str_starts_with($src, 'sum:') && in_array(substr($src, 4), $ids, true);
    }

    /** 店舗のその日の日報（各項目の値・目標・差分と、出勤状況） */
    public static function build(array $store, array $setting, string $date): array
    {
        $sid = $store['id'];
        $ym = substr($date, 0, 7);
        $first = $ym . '-01';
        $items = self::items();
        // 手入力の値（その日の分・月の分）と、今月の手入力の合計
        $manual = [];
        foreach (Db::all('SELECT itemId, value FROM report_value WHERE storeId = ? AND date = ?', [$sid, $date]) as $r) $manual[$r['itemId']] = $r['value'];
        foreach (Db::all('SELECT itemId, value FROM report_value WHERE storeId = ? AND date = ?', [$sid, $ym]) as $r) $manual['m:' . $r['itemId']] = $r['value'];
        $sums = [];
        foreach (Db::all('SELECT itemId, SUM(CAST(value AS SIGNED)) AS s FROM report_value WHERE storeId = ? AND date BETWEEN ? AND ? GROUP BY itemId', [$sid, $first, $date]) as $r) $sums[$r['itemId']] = (int)$r['s'];
        $targets = [];
        foreach (Db::all('SELECT src, value FROM report_target WHERE storeId = ? AND ym = ?', [$sid, $ym]) as $r) $targets[$r['src']] = (float)$r['value'];

        // 予約表：今月（今日まで）の来院
        $byDate = [];
        foreach (Db::all('SELECT date, time, text, menus FROM cell WHERE storeId = ? AND date BETWEEN ? AND ? AND bed > 0 AND visited = 1', [$sid, $first, $date]) as $c) {
            if (!Availability::isPatientText($c['text']) || Text::isContinuationText($c['text'])) continue;
            $byDate[$c['date']][] = $c;
        }
        $count = function (array $cells) use ($store, $setting, $date): array {
            $n = ['am' => 0, 'pm' => 0, 'jibai' => 0, 'self' => 0, 'new' => 0, 'revisit' => 0, 'jibaiNew' => 0];
            $sessions = $cells ? Settings::storeSessions($store, $setting, $cells[0]['date']) : [];
            foreach ($cells as $c) {
                if (Hours::isAm($sessions, (int)$c['time'])) $n['am']++; else $n['pm']++;
                $cat = Text::categorize($c['text']);
                if ($cat['isJibai']) $n['jibai']++;
                if (in_array('自費', DayData::menusOf((string)($c['menus'] ?? '')), true)) $n['self']++;
                if ($cat['isNew'] && $cat['isJibai']) $n['jibaiNew']++;
                elseif ($cat['isNew']) $n['new']++;
                elseif ($cat['isRevisit']) $n['revisit']++;
            }
            return $n;
        };
        $today = $count($byDate[$date] ?? []);
        $month = ['visits' => 0, 'new' => 0, 'revisit' => 0, 'jibaiNew' => 0];
        foreach ($byDate as $cells) { $x = $count($cells); $month['visits'] += $x['am'] + $x['pm']; $month['new'] += $x['new']; $month['revisit'] += $x['revisit']; $month['jibaiNew'] += $x['jibaiNew']; }
        // 稼働日数：今月の今日までで、営業している日（定休日・祝日・臨時休業を除く）
        $closed = [];
        foreach (Db::all('SELECT * FROM day_status WHERE storeId = ? AND date BETWEEN ? AND ?', [$sid, $first, $date]) as $r) $closed[$r['date']] = Settings::closedOf(Settings::dayRow($r));
        $workdays = 0;
        for ($d = $first; $d <= $date; $d = Time::addDays($d, 1)) if (Settings::storeSessions($store, $setting, $d, $closed[$d] ?? false)) $workdays++;
        // 窓口集計：その日と、今月の物販
        $mado = Db::one('SELECT vals FROM madoguchi_day WHERE storeId = ? AND date = ?', [$sid, $date]);
        $mv = $mado ? (json_decode((string)$mado['vals'], true) ?: []) : [];
        $goodsMonth = 0;
        foreach (Db::all('SELECT vals FROM madoguchi_day WHERE storeId = ? AND date BETWEEN ? AND ?', [$sid, $first, $date]) as $r) $goodsMonth += (int)((json_decode((string)$r['vals'], true) ?: [])['goods'] ?? 0);

        $avg = $workdays ? round($month['visits'] / $workdays, 1) : 0.0;
        $auto = [
            'visit.am' => $today['am'], 'visit.pm' => $today['pm'], 'visit.total' => $today['am'] + $today['pm'], 'visit.jibai' => $today['jibai'], 'visit.self' => $today['self'],
            'new.new' => $today['new'], 'new.revisit' => $today['revisit'], 'new.jibai' => $today['jibaiNew'], 'new.total' => $today['new'] + $today['revisit'] + $today['jibaiNew'],
            'mado.total' => (int)($mv['copay'] ?? 0) + (int)($mv['third'] ?? 0) + (int)($mv['self'] ?? 0) + (int)($mv['acu'] ?? 0),
            'workdays' => $workdays, 'month.visits' => $month['visits'], 'month.avg' => $avg,
            'month.achieve' => isset($targets['month.avg']) && $targets['month.avg'] > 0 ? round($avg / $targets['month.avg'] * 100) : null,
            'month.new' => $month['new'], 'month.revisit' => $month['revisit'], 'month.jibaiNew' => $month['jibaiNew'], 'month.goods' => $goodsMonth,
        ];
        foreach (array_keys(Madoguchi::DAY_KEYS) as $k) if (!isset($auto["mado.$k"])) $auto["mado.$k"] = isset($mv[$k]) ? (int)$mv[$k] : null;

        $valueOf = function (string $src, string $id) use ($auto, $manual, $sums, $targets) {
            if (array_key_exists($src, $auto)) return $auto[$src];
            if (str_starts_with($src, 'target:')) return $targets[substr($src, 7)] ?? null;
            if (str_starts_with($src, 'sum:')) return $sums[substr($src, 4)] ?? 0;
            if ($src === 'manual:monthtext') return $manual['m:' . $id] ?? null;
            if (str_starts_with($src, 'manual:')) return $manual[$id] ?? null;
            return null;
        };
        $out = [];
        foreach ($items as $it) {
            $src = (string)$it['source'];
            $row = ['id' => $it['id'], 'section' => $it['section'], 'kind' => $it['kind'], 'label' => $it['label'], 'source' => $src, 'fmt' => self::fmtOf($src, $items),
                'editable' => str_starts_with($src, 'manual:'), 'value' => $it['kind'] === 'staff' ? null : $valueOf($src, (string)$it['id'])];
            if ($it['kind'] === 'perf') {
                $row['target'] = $targets[$src] ?? null;
                $row['diff'] = $row['target'] === null || $row['value'] === null ? null : $row['value'] - $row['target'];
            }
            $out[] = $row;
        }
        return ['date' => $date, 'store' => ['code' => $store['code'], 'name' => $store['name']], 'items' => $out, 'staff' => self::staff($store, $date)];
    }

    /** 出勤状況：施術者（院長が先・離反率）と受付、その日のシフト、他店からのヘルプ */
    public static function staff(array $store, string $date): array
    {
        $sid = $store['id'];
        $members = array_values(array_filter(Db::all('SELECT id, name, role, active, startDate, endDate, isHead FROM staff_member WHERE storeId = ? AND active = 1 ORDER BY isHead DESC, sortOrder ASC', [$sid]), fn($m) => Settings::inPeriod($m, $date)));
        $shift = [];
        foreach (Db::all('SELECT staffId, status FROM shift WHERE storeId = ? AND date = ?', [$sid, $date]) as $r) $shift[$r['staffId']] = $r['status'];
        // 離反率（今月）：前の月にその人が最後に担当した患者様のうち、今月の離反者リストに入った人の割合
        $ym = substr($date, 0, 7);
        $prevFirst = date('Y-m-01', strtotime($ym . '-01 -1 month'));
        $prevLast = date('Y-m-t', strtotime($prevFirst));
        $last = [];
        foreach (Churn::visits($store, $prevFirst, $prevLast) as $v) $last[$v['key']] = $v['staff'];
        $base = array_count_values(array_filter($last, fn($x) => $x !== ''));
        $churned = [];
        foreach (Db::all('SELECT staff FROM churn WHERE storeId = ? AND churnDate BETWEEN ? AND ?', [$sid, $ym . '-01', $ym . '-31']) as $r) if ($r['staff'] !== '') $churned[$r['staff']] = ($churned[$r['staff']] ?? 0) + 1;
        $help = Db::one('SELECT status, name FROM help_in WHERE storeId = ? AND date = ?', [$sid, $date]);
        $person = fn($m) => ['name' => $m['name'], 'head' => (bool)(int)$m['isHead'], 'shift' => $shift[$m['id']] ?? 'WORK'];
        return [
            'therapists' => array_map(fn($m) => $person($m) + ['churnRate' => ($base[$m['name']] ?? 0) ? round(($churned[$m['name']] ?? 0) / $base[$m['name']] * 100, 1) : null],
                array_values(array_filter($members, fn($m) => $m['role'] === 'THERAPIST'))),
            'reception' => array_map($person, array_values(array_filter($members, fn($m) => $m['role'] === 'RECEPTION'))),
            'help' => $help && $help['status'] !== '' ? ['status' => $help['status'], 'name' => (string)$help['name']] : null,
        ];
    }
}
