<?php
// 自賠責請求の速報集計：テーブルの自動作成・行の整形・操作記録・氏名の自動削除
declare(strict_types=1);

final class Jibai
{
    public const DEFAULT_NAME_RETENTION_DAYS = 180;
    public const MAX_AMOUNT = 99999999;
    private static bool $ensured = false;

    /** テーブルが無ければ作る（初期設定を再実行しなくても使えるようにする） */
    public static function ensureTables(bool $force = false): void
    {
        if (self::$ensured && !$force) return;
        self::$ensured = true;
        if (!$force) {
            $exists = Db::one("SELECT 1 AS x FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'jibai_log'");
            if ($exists) { self::ensureColumns(); return; }
        }
        $sql = file_get_contents(dirname(__DIR__) . '/sql/jibai.sql');
        $sql = preg_replace('/^\s*--.*$/m', '', $sql);
        $pdo = Db::pdo();
        foreach (array_filter(array_map('trim', explode(';', $sql))) as $stmt) {
            if ($stmt !== '') $pdo->exec($stmt);
        }
        self::ensureColumns();
    }

    /** 後から追加した列が無ければ足す（MySQL 8 は ADD COLUMN IF NOT EXISTS が使えないため自前で確認） */
    private static function ensureColumns(): void
    {
        $added = [['jibai_claim', 'invoiceYm', 'ALTER TABLE `jibai_claim` ADD COLUMN `invoiceYm` CHAR(7) NULL AFTER `seq`']];
        foreach ($added as [$table, $col, $ddl]) {
            $r = Db::one('SELECT 1 AS x FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?', [$table, $col]);
            if (!$r) Db::pdo()->exec($ddl);
        }
    }

    /** 全社設定（氏名の保持日数）。無ければ既定値で作成 */
    public static function setting(): array
    {
        self::ensureTables();
        $r = Db::one('SELECT * FROM jibai_setting WHERE id = 1');
        if (!$r) {
            Db::exec('INSERT INTO jibai_setting (id, nameRetentionDays) VALUES (1, ?)', [self::DEFAULT_NAME_RETENTION_DAYS]);
            $r = Db::one('SELECT * FROM jibai_setting WHERE id = 1');
        }
        return ['nameRetentionDays' => (int)$r['nameRetentionDays']];
    }

    /** "YYYY-MM" の妥当性（2020-01 〜 2099-12） */
    public static function isValidYm(?string $ym): bool
    {
        return Time::isValidMonth($ym) && $ym >= '2020-01' && $ym <= '2099-12';
    }

    /** "2026-09" に n か月を足す */
    public static function addMonths(string $ym, int $n): string
    {
        [$y, $m] = array_map('intval', explode('-', $ym));
        $t = $y * 12 + ($m - 1) + $n;
        return sprintf('%04d-%02d', intdiv($t, 12), $t % 12 + 1);
    }

    /** 1 枚あたりの平均（円、四捨五入）。0 枚なら null */
    public static function avg(int $total, int $count): ?int
    {
        return $count > 0 ? (int)round($total / $count) : null;
    }

    /**
     * from から 12 か月の月別の枚数・合計・1 枚あたり平均（請求月で集計）。storeId が null なら全店
     * @return array{from:string,to:string,months:array,year:array}
     */
    public static function yearStats(?string $storeId, string $from): array
    {
        $to = self::addMonths($from, 11);
        $sql = 'SELECT COALESCE(invoiceYm, ym) AS m, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS t FROM jibai_claim WHERE COALESCE(invoiceYm, ym) BETWEEN ? AND ?';
        $params = [$from, $to];
        if ($storeId !== null) { $sql .= ' AND storeId = ?'; $params[] = $storeId; }
        $by = [];
        foreach (Db::all($sql . ' GROUP BY COALESCE(invoiceYm, ym)', $params) as $r) $by[$r['m']] = ['n' => (int)$r['n'], 't' => (int)$r['t']];
        $months = [];
        $yn = 0; $yt = 0;
        for ($i = 0; $i < 12; $i++) {
            $m = self::addMonths($from, $i);
            $n = $by[$m]['n'] ?? 0; $t = $by[$m]['t'] ?? 0;
            $months[] = ['ym' => $m, 'count' => $n, 'total' => $t, 'avg' => self::avg($t, $n)];
            $yn += $n; $yt += $t;
        }
        return ['from' => $from, 'to' => $to, 'months' => $months, 'year' => ['count' => $yn, 'total' => $yt, 'avg' => self::avg($yt, $yn)]];
    }

    /** 今月の "YYYY-MM" */
    public static function currentYm(): string
    {
        return substr(Time::nowJst()['date'], 0, 7);
    }

    public static function claimRow(array $r): array
    {
        return [
            'id' => $r['id'],
            'ym' => $r['ym'],
            'patientNo' => (string)$r['patientNo'],
            'patientName' => $r['patientName'] === null ? null : (string)$r['patientName'],
            'days' => $r['days'] === null ? null : (int)$r['days'],
            'amount' => (int)$r['amount'],
            'source' => (string)$r['source'],
            'invoiceYm' => $r['invoiceYm'] === null ? null : (string)$r['invoiceYm'],
            'verifiedAmount' => $r['verifiedAmount'] === null ? null : (int)$r['verifiedAmount'],
            'verifiedAt' => $r['verifiedAt'],
            'verifiedBy' => $r['verifiedBy'],
            'note' => $r['note'] === null ? '' : (string)$r['note'],
            'createdBy' => (string)$r['createdBy'],
            'createdAt' => $r['createdAt'],
            'updatedAt' => $r['updatedAt'],
        ];
    }

    public static function monthRow(?array $r): ?array
    {
        if (!$r) return null;
        return ['status' => (string)$r['status'], 'submittedAt' => $r['submittedAt'], 'submittedBy' => $r['submittedBy']];
    }

    public static function claims(string $storeId, string $ym): array
    {
        return array_map([self::class, 'claimRow'], Db::all('SELECT * FROM jibai_claim WHERE storeId = ? AND ym = ? ORDER BY seq ASC, createdAt ASC, id ASC', [$storeId, $ym]));
    }

    public static function month(string $storeId, string $ym): ?array
    {
        return self::monthRow(Db::one('SELECT * FROM jibai_month WHERE storeId = ? AND ym = ?', [$storeId, $ym]));
    }

    /** 操作記録（氏名は残さない） */
    public static function log(string $storeId, string $ym, ?string $claimId, string $action, ?string $detail, string $byCode): void
    {
        Db::exec('INSERT INTO jibai_log (id, storeId, ym, claimId, action, detail, byCode) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [Db::newId(), $storeId, $ym, $claimId, $action, $detail === null ? null : mb_substr($detail, 0, 300), $byCode]);
    }

    public static function logs(string $storeId, string $ym, int $limit = 50): array
    {
        return array_map(fn($r) => ['id' => $r['id'], 'claimId' => $r['claimId'], 'action' => $r['action'], 'detail' => $r['detail'], 'byCode' => $r['byCode'], 'createdAt' => $r['createdAt']],
            Db::all('SELECT * FROM jibai_log WHERE storeId = ? AND ym = ? ORDER BY createdAt DESC, id DESC LIMIT ' . $limit, [$storeId, $ym]));
    }

    /** データがある月の一覧（新しい順） */
    public static function monthsWithData(?string $storeId = null, int $limit = 24): array
    {
        $where = $storeId === null ? '' : 'WHERE storeId = ?';
        $params = $storeId === null ? [] : [$storeId, $storeId];
        $rows = Db::all("SELECT ym FROM jibai_claim $where UNION SELECT ym FROM jibai_month $where UNION SELECT invoiceYm AS ym FROM jibai_claim " . ($storeId === null ? 'WHERE invoiceYm IS NOT NULL' : 'WHERE storeId = ? AND invoiceYm IS NOT NULL') . " ORDER BY ym DESC LIMIT $limit", $storeId === null ? [] : [$storeId, $storeId, $storeId]);
        return array_values(array_unique(array_map(fn($r) => $r['ym'], $rows)));
    }

    /**
     * 保持期間を過ぎた月の氏名を消す（金額などの集計値は残す）。
     * 対象月の翌月 1 日から nameRetentionDays 日を過ぎた月が対象
     */
    public static function cleanupNames(): array
    {
        self::ensureTables();
        $days = self::setting()['nameRetentionDays'];
        $limitYm = substr(Time::addDays(Time::nowJst()['date'], -$days), 0, 7);
        $n = Db::exec('UPDATE jibai_claim SET patientName = NULL WHERE ym < ? AND patientName IS NOT NULL', [$limitYm]);
        return ['beforeMonth' => $limitYm, 'namesCleared' => $n];
    }
}
