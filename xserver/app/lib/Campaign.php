<?php
// 経路（ギフトカード・媒体の QR・紹介元の QR）ごとのキャンペーン。
// 予約ページに内容と「保険のご負担の目安」（全経路で共通の表）を出し、予約にはその時の内容を残す（店舗の会計用に店舗向けメモも残す）
declare(strict_types=1);

final class Campaign
{
    /** はじめから選んでおける来院区分 */
    public const KINDS = ['NEW', 'ACCIDENT', 'RETURN', 'REVISIT'];
    /** 保険のご負担の目安（本部が直すまでの、はじめの内容） */
    public const DEFAULT_INSURANCE = [['label' => '3割負担', 'amount' => 2000], ['label' => '2割負担', 'amount' => 1500], ['label' => '1割負担', 'amount' => 1200]];

    /** 予約ページの via・ref から経路を決める（紹介元・媒体の QR が先） */
    public static function routeOf(?string $via, ?string $ref): ?string
    {
        if (is_string($ref) && preg_match('/^[a-z0-9]{4,16}$/', $ref) && Db::one('SELECT id FROM referral WHERE code = ? AND active = 1', [$ref])) return 'ref:' . $ref;
        if ($via === 'card') return 'card';
        return null;
    }

    public static function insurance(): array
    {
        $r = Db::one('SELECT insuranceTable FROM global_setting WHERE id = 1');
        $rows = json_decode((string)($r['insuranceTable'] ?? ''), true);
        return is_array($rows) ? $rows : self::DEFAULT_INSURANCE;
    }

    /** 保険のご負担の目安の行を整える（ラベル 20 文字・金額は 0 以上の整数。10 行まで） */
    public static function cleanInsurance(mixed $rows): array
    {
        if (!is_array($rows) || count($rows) > 10) throw new HttpError(400, '保険のご負担の目安は 10 行までです');
        $out = [];
        foreach ($rows as $x) {
            $label = mb_substr(trim((string)($x['label'] ?? '')), 0, 20);
            $amt = $x['amount'] ?? null;
            if ($label === '' && ($amt === null || $amt === '')) continue;
            if ($label === '') throw new HttpError(400, '負担割合（例：3割負担）を入れてください');
            if (!is_numeric($amt) || (int)$amt < 0 || (int)$amt > 1000000) throw new HttpError(400, "{$label} の金額を数字で入れてください");
            $out[] = ['label' => $label, 'amount' => (int)$amt];
        }
        return $out;
    }

    public static function stores(?string $csv): array
    {
        return array_values(array_filter(explode(',', (string)$csv), fn($c) => $c !== ''));
    }

    /** その経路・店舗・日に使うキャンペーン（止めていない・期間内・店舗が合う。複数あれば先に作ったもの） */
    public static function activeFor(?string $route, string $storeCode, string $date): ?array
    {
        if ($route === null) return null;
        foreach (Db::all('SELECT * FROM campaign WHERE route = ? AND active = 1 ORDER BY createdAt ASC, id ASC', [$route]) as $c) {
            if ($c['fromDate'] !== '' && $c['fromDate'] > $date) continue;
            if ($c['toDate'] !== '' && $c['toDate'] < $date) continue;
            $st = self::stores($c['stores'] ?? null);
            if ($st && !in_array($storeCode, $st, true)) continue;
            return $c;
        }
        return null;
    }

    /** 経路の名前（ギフトカード・媒体や紹介元の名前） */
    public static function routeLabel(string $route): string
    {
        if ($route === 'card') return 'ギフトカード';
        $r = str_starts_with($route, 'ref:') ? Db::one('SELECT name FROM referral WHERE code = ?', [substr($route, 4)]) : null;
        return $r ? (string)$r['name'] : $route;
    }

    /** 予約に残す内容（店舗向けメモも入れる） */
    public static function snapshot(array $c): array
    {
        return [
            'id' => $c['id'],
            'route' => self::routeLabel((string)$c['route']),
            'name' => (string)$c['name'],
            'description' => (string)($c['description'] ?? ''),
            'insurance' => (int)$c['showInsurance'] ? self::insurance() : [],
            'memo' => (string)($c['storeMemo'] ?? ''),
        ];
    }

    /** 患者様に見せる内容（店舗向けメモは出さない） */
    public static function forCustomer(?array $snap, string $presetKind = ''): ?array
    {
        if (!$snap) return null;
        $out = ['route' => $snap['route'] ?? '', 'name' => $snap['name'] ?? '', 'description' => $snap['description'] ?? '', 'insurance' => $snap['insurance'] ?? []];
        if ($presetKind !== '') $out['kind'] = $presetKind;
        return $out;
    }

    /** 予約に残した JSON を読む */
    public static function decode(?string $json): ?array
    {
        if ($json === null || $json === '') return null;
        $d = json_decode($json, true);
        return is_array($d) ? $d : null;
    }
}
