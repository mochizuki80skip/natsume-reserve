<?php
// 窓口集計（月間窓口表・物販内訳・返戻）：日ごとの入力値の検証と、合計・照合の計算
declare(strict_types=1);

final class Madoguchi
{
    /** 日ごとに入れる金額（今の月間窓口表の白い欄。物販内訳の個数は goods、その他は otherAmt・otherNote） */
    public const DAY_KEYS = [
        'copay' => '一部負担金', 'third' => '第三者', 'self' => '自費', 'acu' => '鍼', 'goods' => '物販',
        'colCopay' => '未収回収 一部負担金', 'colSelf' => '未収回収 自費', 'diffCopay' => '差額 一部負担金', 'diffSelf' => '差額 自費',
        'unknown' => '不明金', 'deposit' => '保証金', 'cert' => '証明書代', 'mail' => '報告メール合計', 'bank' => '通帳入金額',
        'insClaim' => '保険請求金額', 'jibaiClaim' => '自賠責請求金額',
    ];
    /** 月末に入れる欄 */
    public const MONTH_KEYS = ['lateIns' => '保険請求 月遅れ請求', 'lateJibai' => '自賠責 月遅れ請求', 'rousai' => '労災', 'curClaim' => '当月請求'];
    public const HENREI_KEYS = ['treatYm' => 20, 'claimMonth' => 20, 'patient' => 40, 'relation' => 10, 'insurer' => 60, 'insurerCode' => 20, 'place' => 60, 'action' => 20, 'reason' => 100];

    public static function ensureTables(): void
    {
        $pdo = Db::pdo();
        $pdo->exec(Migrate::MADOGUCHI_DAY_DDL);
        $pdo->exec(Migrate::MADOGUCHI_MONTH_DDL);
        $pdo->exec(Migrate::MADOGUCHI_HENREI_DDL);
        $pdo->exec(Migrate::GOODS_ITEM_DDL);
    }

    /** 日の入力 1 つを検証して直す。金額は整数（マイナス可）、物販は {商品id: 個数} */
    public static function cleanDayValue(string $key, mixed $v): mixed
    {
        if ($key === 'otherNote' || $key === 'unknownNote') return mb_substr(trim((string)$v), 0, 200); // 物販のその他の内訳・不明金の詳細
        if ($key === 'goodsCount') {
            if (!is_array($v)) throw new HttpError(400, 'bad request');
            $out = [];
            foreach ($v as $id => $n) {
                if (!is_string($id) || !preg_match('/^[0-9a-f]{24}$/', $id)) throw new HttpError(400, 'bad request');
                if ($n === null || $n === '') continue;
                if (!is_numeric($n) || (int)$n != $n || (int)$n < 0 || (int)$n > 9999) throw new HttpError(400, '個数が正しくありません');
                $out[$id] = (int)$n;
            }
            return $out;
        }
        if (!array_key_exists($key, self::DAY_KEYS) && $key !== 'otherAmt') throw new HttpError(400, 'bad request');
        if ($v === null || $v === '') return null;
        if (!is_numeric($v) || (int)$v != $v || abs((int)$v) > 99999999) throw new HttpError(400, '金額が正しくありません');
        return (int)$v;
    }

    /** その日の計算（一部負担金合計・自費＋鍼・合計・照合の合計）と、報告メール・通帳入金が合っているか */
    public static function dayCalc(array $v): array
    {
        $n = fn(string $k) => (int)($v[$k] ?? 0);
        $copayTotal = $n('copay') + $n('third');
        $selfAcu = $n('self') + $n('acu');
        $total = $copayTotal + $selfAcu;
        $match = $total + $n('goods') + $n('colCopay') + $n('colSelf') + $n('diffCopay') + $n('diffSelf') + $n('unknown') + $n('deposit') + $n('cert');
        // 合計・報告メール合計・通帳入金額の 3 つがそろっていない（入っていないものも含む）。何も入れていない日は見ない
        $entered = (bool)array_intersect_key($v, self::DAY_KEYS);
        $bad = $entered && (!isset($v['mail']) || !isset($v['bank']) || (int)$v['mail'] !== $match || (int)$v['bank'] !== $match);
        return ['copayTotal' => $copayTotal, 'selfAcu' => $selfAcu, 'total' => $total, 'match' => $match, 'mismatch' => $bad];
    }

    /** 物販の商品（月の写し。まだ無ければ今の商品） */
    public static function goodsOf(?array $month): array
    {
        if ($month && $month['goods'] !== null) return json_decode((string)$month['goods'], true) ?: [];
        return array_map(fn($g) => ['id' => $g['id'], 'name' => $g['name'], 'price' => (int)$g['price'], 'cost' => (int)$g['cost']],
            Db::all('SELECT * FROM goods_item WHERE active = 1 ORDER BY sortOrder ASC, createdAt ASC'));
    }

    public static function monthRow(string $storeId, string $ym): ?array
    {
        return Db::one('SELECT * FROM madoguchi_month WHERE storeId = ? AND ym = ?', [$storeId, $ym]);
    }

    /** 店舗が何かを入れたとき：月の行を作り（商品の写しも）、最後に直した日時を残す */
    public static function touchMonth(string $storeId, string $ym): void
    {
        $m = self::monthRow($storeId, $ym);
        $now = Time::nowJstDateTime();
        if (!$m) {
            Db::exec('INSERT INTO madoguchi_month (storeId, ym, goods, editedAt) VALUES (?, ?, ?, ?)', [$storeId, $ym, json_encode(self::goodsOf(null), JSON_UNESCAPED_UNICODE), $now]);
        } else {
            if ($m['goods'] === null) Db::exec('UPDATE madoguchi_month SET goods = ? WHERE storeId = ? AND ym = ?', [json_encode(self::goodsOf(null), JSON_UNESCAPED_UNICODE), $storeId, $ym]);
            Db::exec('UPDATE madoguchi_month SET editedAt = ? WHERE storeId = ? AND ym = ?', [$now, $storeId, $ym]);
        }
    }

    /** 1 か月ぶん（日ごとの値・計算・合計・物販・返戻・月末の欄） */
    public static function month(array $store, string $ym): array
    {
        $setting = Settings::global();
        $dates = Time::datesOfMonth($ym);
        $closedSet = array_column(Db::all('SELECT date FROM day_status WHERE storeId = ? AND date BETWEEN ? AND ? AND closed = 1', [$store['id'], $dates[0], end($dates)]), 'date', 'date');
        $vals = [];
        foreach (Db::all('SELECT date, vals FROM madoguchi_day WHERE storeId = ? AND date BETWEEN ? AND ?', [$store['id'], $dates[0], end($dates)]) as $r) $vals[$r['date']] = json_decode((string)$r['vals'], true) ?: [];
        $m = self::monthRow($store['id'], $ym);
        $goods = self::goodsOf($m);
        $price = array_column($goods, 'price', 'id');
        $days = [];
        $sum = array_fill_keys(array_merge(array_keys(self::DAY_KEYS), ['otherAmt', 'copayTotal', 'selfAcu', 'total', 'match', 'goodsSales']), 0);
        $goodsSum = array_fill_keys(array_keys($price), 0);
        $mismatchDays = 0;
        foreach ($dates as $d) {
            $v = $vals[$d] ?? [];
            $c = self::dayCalc($v);
            $gs = (int)($v['otherAmt'] ?? 0);
            foreach (($v['goodsCount'] ?? []) as $id => $n) { if (isset($price[$id])) { $gs += $n * $price[$id]; $goodsSum[$id] += $n; } }
            $c['goodsSales'] = $gs;
            if ($c['mismatch']) $mismatchDays++;
            foreach (array_keys(self::DAY_KEYS) as $k) $sum[$k] += (int)($v[$k] ?? 0);
            $sum['otherAmt'] += (int)($v['otherAmt'] ?? 0);
            foreach (['copayTotal', 'selfAcu', 'total', 'match', 'goodsSales'] as $k) $sum[$k] += $c[$k];
            $closed = isset($closedSet[$d]) || !Settings::storeSessions($store, $setting, $d, isset($closedSet[$d]));
            $days[] = ['date' => $d, 'closed' => $closed, 'vals' => (object)$v, 'calc' => $c];
        }
        $henrei = array_map(fn($r) => ['id' => $r['id'], 'special' => (bool)$r['special'], 'amount' => $r['amount'] === null ? null : (int)$r['amount'], 'reamount' => $r['reamount'] === null ? null : (int)$r['reamount']]
            + array_intersect_key($r, self::HENREI_KEYS), Db::all('SELECT * FROM madoguchi_henrei WHERE storeId = ? AND ym = ? ORDER BY special ASC, createdAt ASC', [$store['id'], $ym]));
        $extra = $m && $m['extra'] ? (json_decode((string)$m['extra'], true) ?: []) : [];
        $stock = $m && $m['stockStart'] ? (json_decode((string)$m['stockStart'], true) ?: []) : [];
        $jibai = Db::one('SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM jibai_claim WHERE storeId = ? AND COALESCE(invoiceYm, ym) = ?', [$store['id'], $ym]);
        return [
            'month' => $ym, 'store' => ['code' => $store['code'], 'name' => $store['name']],
            // 売上（目標と比べる数字）＝窓口の合計＋保険請求＋自賠責請求（日々の入力）
            'sales' => $sum['total'] + $sum['insClaim'] + $sum['jibaiClaim'],
            'target' => $m && $m['target'] !== null ? (int)$m['target'] : null,
            'days' => $days, 'sum' => $sum, 'mismatchDays' => $mismatchDays,
            'goods' => $goods, 'goodsSum' => (object)$goodsSum, 'stockStart' => (object)$stock,
            'extra' => (object)$extra, 'memo' => (string)($m['memo'] ?? ''),
            'henrei' => $henrei,
            'jibaiSokuhou' => ['count' => (int)($jibai['n'] ?? 0), 'total' => (int)($jibai['total'] ?? 0)],
            'checkedAt' => $m['checkedAt'] ?? null, 'checkedBy' => (string)($m['checkedBy'] ?? ''),
            // 経理確認のときに editedAt を空にするので、確認のあとに店舗が直すと入る
            'editedAfterCheck' => $m && $m['checkedAt'] && $m['editedAt'],
        ];
    }

    /** 経理の一覧の 1 行 */
    public static function summary(array $store, string $ym): array
    {
        $x = self::month($store, $ym);
        $hn = array_filter($x['henrei'], fn($r) => true);
        return [
            'code' => $store['code'], 'name' => $store['name'], 'target' => $x['target'], 'sales' => $x['sales'],
            'total' => $x['sum']['total'], 'goods' => $x['sum']['goods'], 'goodsSales' => $x['sum']['goodsSales'], 'insClaim' => $x['sum']['insClaim'], 'jibaiClaim' => $x['sum']['jibaiClaim'],
            'jibaiSokuhou' => $x['jibaiSokuhou']['total'], 'mismatchDays' => $x['mismatchDays'],
            'henreiCount' => count($hn), 'henreiTotal' => array_sum(array_map(fn($r) => (int)($r['amount'] ?? 0), $hn)),
            'checkedAt' => $x['checkedAt'], 'checkedBy' => $x['checkedBy'], 'editedAfterCheck' => $x['editedAfterCheck'],
            'entered' => count(array_filter($x['days'], fn($d) => count((array)$d['vals']) > 0)),
        ];
    }

    /** 税抜（スプレッドシートと同じく ÷1.1 を四捨五入） */
    public static function exTax(int $v): int
    {
        return (int)round($v / 1.1, 0, PHP_ROUND_HALF_UP);
    }
}
