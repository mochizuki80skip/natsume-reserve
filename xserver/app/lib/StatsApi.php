<?php
// 集計API（統合ダッシュボード用・読み取り専用）：店舗ごとの件数・金額だけを、今の画面と同じ数え方で出す。
// 患者様の氏名・電話番号・カルテ番号・患者番号、スタッフの名前・ID は返さない。データは書き換えない
declare(strict_types=1);

final class StatsApi
{
    public const VERSION = '1.0';
    public const MAX_DAYS = 93;
    public const RETENTION_MAX_VISIT = 6; // 新患継続率は 2〜6 回目まで（7 回目以降は数えない仕様）
    public const CHURN_RULE = '最終来院の翌月の同じ日（その日がない月は月末）までに来院がない患者様を、その日に離反とする（月によって 28〜31 日）';
    private const KIND_OUT = ['NEW' => 'NEW', 'ACCIDENT' => 'ACCIDENT', 'THIRD' => 'THIRD_PARTY', 'REVISIT' => 'REVISIT'];
    /** 窓口集計の列 → API のキー（画面の並びと同じ） */
    private const SALES_KEYS = [
        'copay' => 'copay', 'third' => 'thirdParty', 'copayTotal' => 'copayTotal', 'self' => 'selfPay', 'acu' => 'acupuncture', 'selfAcu' => 'selfPayAcuTotal',
        'total' => 'windowTotal', 'goods' => 'goods', 'colCopay' => 'uncollectedCopay', 'colSelf' => 'uncollectedSelfPay', 'diffCopay' => 'diffCopay', 'diffSelf' => 'diffSelfPay',
        'unknown' => 'unknown', 'deposit' => 'deposit', 'cert' => 'certificate', 'match' => 'reconcileTotal', 'mail' => 'reportMailTotal', 'bank' => 'bankDeposit',
        'insClaim' => 'insuranceClaim', 'jibaiClaim' => 'jibaiClaim',
    ];
    private const CALC_KEYS = ['copayTotal', 'selfAcu', 'total', 'match'];
    private const NO_TAX = ['insClaim', 'jibaiClaim']; // 税抜の行が空の列（画面と同じ）

    public static function definitions(): array
    {
        return [
            'churnRule' => self::CHURN_RULE,
            'churnBase' => '前の月に来院した患者様の実人数（離反者リストの画面の「離反率」の分母）',
            'retentionMaxVisit' => self::RETENTION_MAX_VISIT,
            'retentionRule' => '初回来院月の初回カルテ（新患継続率）の行のうち、N 回目（2〜6）の来院日が入っている人数',
            'newKinds' => ['NEW', 'ACCIDENT', 'THIRD_PARTY'],
            'visitsRule' => '予約表で来院チェック済みの患者様の枠（日報の「来院」と同じ数え方）。新規・再来はセルの印（新患・新自・新三・再来）',
            'salesTaxNote' => '税抜は窓口集計の『税抜』行と同じ計算（÷1.1 を四捨五入）。保険請求・自賠請求は税抜なし（null）',
            'achievementRateRule' => '売上 ÷ 売上目標 × 100 を小数第1位で四捨五入（画面は整数で表示）',
        ];
    }

    /** API の対象の店舗（自賠請求だけの店舗は除く）。codes が空なら全店舗 */
    public static function stores(array $codes = []): array
    {
        $rows = Settings::storesInOrder('1 = 1', [], false);
        if (!$codes) return $rows;
        $by = array_column($rows, null, 'code');
        $out = [];
        foreach ($codes as $c) {
            if (!isset($by[$c])) throw new HttpError(400, "店舗コード {$c} がありません");
            $out[] = $by[$c];
        }
        return $out;
    }

    public static function meta(): array
    {
        $stores = array_map(fn($s) => ['code' => (string)$s['code'], 'name' => (string)$s['name'], 'active' => (bool)$s['active'], 'beds' => (int)$s['beds']], self::stores());
        $areas = [];
        foreach (Db::all('SELECT name, storeCodes, sortOrder FROM area ORDER BY sortOrder ASC, name ASC') as $a) {
            $areas[] = ['name' => (string)$a['name'], 'storeCodes' => array_values(array_filter(array_map('trim', explode(',', (string)$a['storeCodes'])))), 'sortOrder' => (int)$a['sortOrder']];
        }
        return ['stores' => $stores, 'areas' => $areas, 'definitions' => self::definitions()];
    }

    // ---------- 来院・新規（日報と同じ数え方） ----------

    /** @return array<string, array{visits:int,newGeneral:int,newJibai:int,newThirdParty:int,revisit:int}> 日付 → 件数 */
    private static function visitCounts(array $store, string $from, string $to): array
    {
        $out = [];
        foreach (Db::all('SELECT date, text FROM cell WHERE storeId = ? AND date BETWEEN ? AND ? AND bed > 0 AND visited = 1', [$store['id'], $from, $to]) as $c) {
            $text = (string)$c['text'];
            if (!Availability::isPatientText($text) || Text::isContinuationText($text)) continue;
            $n = &$out[$c['date']];
            $n ??= self::zeroVisits();
            $n['visits']++;
            $cat = Text::categorize($text);
            if ($cat['isThird']) $n['newThirdParty']++;
            elseif ($cat['isNew'] && $cat['isJibai']) $n['newJibai']++;
            elseif ($cat['isNew']) $n['newGeneral']++;
            elseif ($cat['isRevisit']) $n['revisit']++;
            unset($n);
        }
        return $out;
    }

    private static function zeroVisits(): array
    {
        return ['visits' => 0, 'newGeneral' => 0, 'newJibai' => 0, 'newThirdParty' => 0, 'revisit' => 0];
    }

    /** 窓口集計の 1 日分（画面の列と 1 対 1） */
    private static function salesOf(array $v): array
    {
        $c = Madoguchi::dayCalc($v);
        $out = [];
        foreach (self::SALES_KEYS as $k => $api) $out[$api] = in_array($k, self::CALC_KEYS, true) ? $c[$k] : (isset($v[$k]) ? (int)$v[$k] : null);
        $out['entered'] = (bool)array_intersect_key($v, Madoguchi::DAY_KEYS);
        return $out;
    }

    public static function daily(array $stores, string $from, string $to): array
    {
        $data = [];
        foreach ($stores as $s) {
            $visits = self::visitCounts($s, $from, $to);
            $cancels = [];
            foreach (Db::all('SELECT date, COUNT(*) AS n FROM cancel_log WHERE storeId = ? AND date BETWEEN ? AND ? GROUP BY date', [$s['id'], $from, $to]) as $r) $cancels[$r['date']] = (int)$r['n'];
            $vals = [];
            foreach (Db::all('SELECT date, vals FROM madoguchi_day WHERE storeId = ? AND date BETWEEN ? AND ?', [$s['id'], $from, $to]) as $r) $vals[$r['date']] = json_decode((string)$r['vals'], true) ?: [];
            for ($d = $from; $d <= $to; $d = Time::addDays($d, 1)) {
                $data[] = ['store' => (string)$s['code'], 'date' => $d] + ($visits[$d] ?? self::zeroVisits()) + ['cancels' => $cancels[$d] ?? 0, 'sales' => self::salesOf($vals[$d] ?? [])];
            }
        }
        return $data;
    }

    // ---------- 月（窓口集計） ----------

    public static function monthly(array $stores, string $ym): array
    {
        $dates = Time::datesOfMonth($ym);
        $data = [];
        foreach ($stores as $s) {
            $x = Madoguchi::month($s, $ym);
            $inc = [];
            $ex = [];
            foreach (self::SALES_KEYS as $k => $api) {
                $v = (int)($x['sum'][$k] ?? 0);
                $inc[$api] = $v;
                $ex[$api] = in_array($k, self::NO_TAX, true) ? null : Madoguchi::exTax($v);
            }
            $goods = [];
            $price = [];
            foreach ($x['goods'] as $g) $price[$g['id']] = (int)$g['price'];
            foreach ($x['goods'] as $g) {
                $qty = (int)(((array)$x['goodsSum'])[$g['id']] ?? 0);
                $goods[] = ['name' => (string)$g['name'], 'qty' => $qty, 'amount' => $qty * $price[$g['id']]];
            }
            $goods[] = ['name' => 'その他', 'qty' => null, 'amount' => (int)$x['sum']['otherAmt']];
            $visits = self::zeroVisits();
            foreach (self::visitCounts($s, $dates[0], end($dates)) as $n) foreach ($n as $k => $v) $visits[$k] += $v;
            $target = $x['target'];
            $data[] = [
                'store' => (string)$s['code'], 'ym' => $ym,
                'salesTarget' => $target, 'salesTotal' => (int)$x['sales'],
                'achievementRate' => $target ? round($x['sales'] / $target * 100, 1) : null,
                'windowTotal' => (int)$x['sum']['total'], 'insuranceClaim' => (int)$x['sum']['insClaim'],
                'jibaiDaily' => (int)$x['sum']['jibaiClaim'], 'jibaiReport' => (int)$x['jibaiSokuhou']['total'],
                'sumsTaxIncluded' => $inc, 'sumsTaxExcluded' => $ex,
                'mismatchDays' => (int)$x['mismatchDays'],
                'accountingConfirmed' => ['confirmed' => $x['checkedAt'] !== null, 'checkedAt' => $x['checkedAt'] ? self::iso((string)$x['checkedAt']) : null, 'editedAfterCheck' => (bool)$x['editedAfterCheck']],
                'goodsBreakdown' => $goods,
                'refunds' => ['count' => count($x['henrei']), 'amount' => array_sum(array_map(fn($r) => (int)($r['amount'] ?? 0), $x['henrei']))],
            ] + $visits;
        }
        return $data;
    }

    // ---------- 新患継続率（初回来院月のコホート） ----------

    private static function retentionOf(array $rows): array
    {
        $reached = [];
        for ($i = 0; $i < self::RETENTION_MAX_VISIT - 1; $i++) {
            $reached[(string)($i + 2)] = count(array_filter($rows, fn($r) => !empty($r['visits'][$i]['d'])));
        }
        return ['firstCount' => count($rows), 'reached' => $reached];
    }

    public static function retention(array $stores, string $ym): array
    {
        $data = [];
        $today = Time::nowJst()['date'];
        foreach ($stores as $s) {
            $rows = Karte::rowsView($s, $ym);
            $byKind = [];
            foreach (self::KIND_OUT as $k => $out) {
                $list = array_values(array_filter($rows, fn($r) => $r['kind'] === $k));
                $kept = array_values(array_filter($list, fn($r) => !$r['stopped'] && !$r['transferred']));
                $byKind[] = ['kind' => $out] + self::retentionOf($list) + ['dropped' => count($list) - count($kept), 'excludingDropped' => self::retentionOf($kept)];
            }
            $data[] = ['store' => (string)$s['code'], 'cohortYm' => $ym, 'byKind' => $byKind, 'asOf' => $today];
        }
        return $data;
    }

    // ---------- 離反（離反者リストと同じ） ----------

    public static function churn(array $stores, string $ym): array
    {
        $data = [];
        foreach ($stores as $s) {
            $rows = Churn::rowsView($s, $ym);
            $base = Churn::activeCount($s, $ym);
            $n = count($rows);
            $ex = count(array_filter($rows, fn($r) => in_array($r['manage'], Churn::EXCLUDE, true)));
            $byKind = [];
            foreach (['新患' => 'NEW', '再来' => 'REVISIT', '既存' => 'EXISTING'] as $label => $key) $byKind[] = ['kind' => $key, 'label' => $label, 'churned' => count(array_filter($rows, fn($r) => $r['kind'] === $label))];
            $other = $n - array_sum(array_column($byKind, 'churned'));
            if ($other > 0) $byKind[] = ['kind' => 'OTHER', 'label' => 'その他', 'churned' => $other]; // 取り込んだ行で区分が空など
            $data[] = [
                'store' => (string)$s['code'], 'ym' => $ym, 'base' => $base, 'churned' => $n,
                'churnRate' => $base > 0 ? round($n / $base * 100, 1) : null,
                'excluded' => $ex, 'churnRateEx' => $base - $ex > 0 ? round(($n - $ex) / ($base - $ex) * 100, 1) : null,
                'byKind' => $byKind,
            ];
        }
        return $data;
    }

    // ---------- スタッフ（名前・ID は返さない） ----------

    public static function staff(array $stores, string $ym): array
    {
        $setting = Settings::global();
        $dates = Time::datesOfMonth($ym);
        $first = $dates[0];
        $last = end($dates);
        $data = [];
        foreach ($stores as $s) {
            $sid = $s['id'];
            $closed = [];
            foreach (Db::all('SELECT * FROM day_status WHERE storeId = ? AND date BETWEEN ? AND ?', [$sid, $first, $last]) as $r) $closed[$r['date']] = Settings::closedOf(Settings::dayRow($r));
            $open = array_values(array_filter($dates, fn($d) => (bool)Settings::storeSessions($s, $setting, $d, $closed[$d] ?? false)));
            $shift = [];
            foreach (Db::all('SELECT staffId, date, status FROM shift WHERE storeId = ? AND date BETWEEN ? AND ?', [$sid, $first, $last]) as $r) $shift[$r['staffId']][$r['date']] = (string)$r['status'];
            $members = [];
            $count = ['THERAPIST' => 0, 'RECEPTION' => 0];
            $hires = ['total' => 0, 'NEW' => 0, 'TRANSFER' => 0, 'none' => 0];
            $leaves = $hires;
            foreach (Db::all('SELECT * FROM staff_member WHERE storeId = ? ORDER BY sortOrder ASC, id ASC', [$sid]) as $m) {
                $inMonth = array_values(array_filter($dates, fn($d) => Settings::inPeriod($m, $d)));
                if (!$inMonth || (!(int)$m['active'] && !$m['endDate'])) continue; // この月に所属していない・停止した人
                $role = (string)$m['role'] === 'RECEPTION' ? 'RECEPTION' : 'THERAPIST';
                $count[$role]++;
                $jt = in_array($m['joinType'], ['NEW', 'TRANSFER'], true) ? (string)$m['joinType'] : 'none';
                if ($m['startDate'] && $m['startDate'] >= $first && $m['startDate'] <= $last) { $hires['total']++; $hires[$jt]++; }
                if ($m['endDate'] && $m['endDate'] >= $first && $m['endDate'] <= $last) { $leaves['total']++; $leaves[$jt]++; }
                $work = 0.0;
                $byStatus = [];
                $leaveDays = 0;
                foreach ($open as $d) {
                    if (!Settings::inPeriod($m, $d)) continue;
                    if ($m['leaveStart'] && $d >= $m['leaveStart'] && (!$m['leaveEnd'] || $d <= $m['leaveEnd'])) { $leaveDays++; continue; }
                    $st = $shift[$m['id']][$d] ?? null;
                    $byStatus[$st ?? 'WORK'] = ($byStatus[$st ?? 'WORK'] ?? 0) + 1;
                    $work += (Settings::worksAm($st) ? 0.5 : 0) + (Settings::worksPm($st) ? 0.5 : 0);
                }
                $off = 0.0;
                foreach ($byStatus as $st => $n) $off += $n * (in_array($st, ['OFF', 'PAID'], true) ? 1 : (in_array($st, ['AM_OFF', 'PM_OFF', 'AM_PAID', 'PM_PAID'], true) ? 0.5 : 0));
                ksort($byStatus);
                $members[] = [
                    'role' => $role, 'startDate' => $m['startDate'] ?: null, 'endDate' => $m['endDate'] ?: null, 'joinType' => $jt === 'none' ? null : $jt,
                    'shiftDays' => $work, 'offDays' => $off, 'leaveDays' => $leaveDays, 'shiftByStatus' => (object)$byStatus,
                ];
            }
            $help = 0.0;
            foreach (Db::all('SELECT status FROM help_in WHERE storeId = ? AND date BETWEEN ? AND ?', [$sid, $first, $last]) as $r) $help += $r['status'] === 'HELP_IN' ? 1 : 0.5;
            $data[] = [
                'store' => (string)$s['code'], 'ym' => $ym, 'openDays' => count($open),
                'therapists' => $count['THERAPIST'], 'reception' => $count['RECEPTION'],
                'hires' => $hires, 'leaves' => $leaves, 'helpInDays' => $help, 'members' => $members,
            ];
        }
        return $data;
    }

    /** DB の日時（日本時間）→ ISO 8601（+09:00） */
    public static function iso(string $dt): string
    {
        return str_replace(' ', 'T', substr($dt, 0, 19)) . '+09:00';
    }
}
