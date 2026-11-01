<?php
// WEB 予約の URL・QR（集客経路）とキャンペーン。表は campaign（1 行＝1 つの URL）。
// - URL は /stores?c=コード（店舗えらび用）と /s/店舗?c=コード（店舗別）。そこから予約した初診の新患継続率は、きっかけ＝trig・内訳＝label
// - キャンペーン（hasContent）は付けても付けなくてもよい。付けて止めていない・期間内・店舗が合うときだけ、予約ページ・店舗えらびページに出す
// - 予約には予約したときの内容を残す（reservation.campaign。店舗向けメモつき。患者様には店舗向けメモを出さない）
// - 古い形（route = 'card'：紹介カード用の QR /stores?from=card、'ref:<code>'：紹介元の QR）も読める
declare(strict_types=1);

final class Campaign
{
    /** はじめから選んでおける来院区分 */
    public const KINDS = ['NEW', 'ACCIDENT', 'RETURN', 'REVISIT'];
    /** 保険のご負担の目安（本部が直すまでの、はじめの内容） */
    public const DEFAULT_INSURANCE = [['label' => '3割負担', 'amount' => 2000], ['label' => '2割負担', 'amount' => 1500], ['label' => '1割負担', 'amount' => 1200]];
    public const GIFT = 'ギフトカード';

    /** 予約ページ・店舗えらびページの ?c= ・?from=card（via）・?ref= から、その URL の行を決める */
    public static function entryOf(?string $via, ?string $ref, ?string $c = null): ?array
    {
        if (is_string($c) && preg_match('/^[a-z0-9]{4,16}$/', $c)) {
            $r = Db::one('SELECT * FROM campaign WHERE code = ?', [$c]);
            if ($r) return $r;
        }
        if (is_string($ref) && preg_match('/^[a-z0-9]{4,16}$/', $ref) && Db::one('SELECT id FROM referral WHERE code = ? AND active = 1', [$ref])) {
            return self::firstActive('ref:' . $ref);
        }
        if ($via === 'card') {
            // 紹介カード用の QR（/stores?from=card）：きっかけ「ギフトカード」の URL の行（なければ古い形の行）
            return Db::one("SELECT * FROM campaign WHERE code IS NOT NULL AND trig = ? ORDER BY active DESC, createdAt ASC, id ASC LIMIT 1", [self::GIFT]) ?? self::firstActive('card');
        }
        return null;
    }

    private static function firstActive(string $route): ?array
    {
        return Db::one('SELECT * FROM campaign WHERE route = ? ORDER BY active DESC, createdAt ASC, id ASC LIMIT 1', [$route]);
    }

    /** キャンペーンを出すか（付けている・止めていない・期間内・店舗が合う。店舗 null＝店舗えらびページ） */
    public static function showing(?array $e, ?string $storeCode, string $date): bool
    {
        if (!$e || !(int)($e['hasContent'] ?? 1) || !(int)$e['active'] || trim((string)$e['name']) === '') return false;
        if ($e['fromDate'] !== '' && $e['fromDate'] > $date) return false;
        if ($e['toDate'] !== '' && $e['toDate'] < $date) return false;
        $st = self::stores($e['stores'] ?? null);
        return $storeCode === null || !$st || in_array($storeCode, $st, true);
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

    /** 札の名前（「○○特典」の○○）：ギフトカードはギフトカード、ほかはキャンペーン（古い紹介元の形は紹介元の名前） */
    public static function badgeOf(array $e): string
    {
        if (($e['trig'] ?? '') === self::GIFT || $e['route'] === 'card') return self::GIFT;
        if (str_starts_with((string)$e['route'], 'ref:')) {
            $r = Db::one('SELECT name FROM referral WHERE code = ?', [substr((string)$e['route'], 4)]);
            if ($r) return (string)$r['name'];
        }
        return 'キャンペーン';
    }

    /**
     * 予約に残す内容。キャンペーンを出さないとき（付けていない・止めている・期間外・店舗が違う）は name を空にする
     * （URL の行の印・新患継続率のきっかけだけ残す）
     */
    public static function snapshot(array $e, ?string $storeCode, string $date): array
    {
        $show = self::showing($e, $storeCode, $date);
        $own = (string)($e['code'] ?? '') !== '';
        return [
            'id' => $e['id'],
            'route' => self::badgeOf($e),
            'label' => (string)($e['label'] ?? ''),
            'name' => $show ? (string)$e['name'] : '',
            'description' => $show ? (string)($e['description'] ?? '') : '',
            'insurance' => $show && (int)$e['showInsurance'] ? self::insurance() : [],
            'memo' => $show ? (string)($e['storeMemo'] ?? '') : '',
            // URL から来た初診の新患継続率（きっかけ・内訳＝URL の名前）
            'trig' => $own ? (string)($e['trig'] ?? '') : '',
            'detail' => $own ? (string)($e['label'] ?? '') : '',
        ];
    }

    /** 患者様に見せる内容（店舗向けメモは出さない）。キャンペーンを出さないときは null */
    public static function forCustomer(?array $snap, string $presetKind = ''): ?array
    {
        if (!$snap || ($snap['name'] ?? '') === '') return null;
        $out = ['route' => $snap['route'] ?? '', 'name' => $snap['name'], 'description' => $snap['description'] ?? '', 'insurance' => $snap['insurance'] ?? []];
        if ($presetKind !== '') $out['kind'] = $presetKind;
        return $out;
    }

    /** URL（店舗えらび用・店舗別） */
    public static function url(string $code, ?string $storeCode = null): string
    {
        $base = rtrim(Config::str('APP_URL'), '/');
        if ($base === '') $base = (Http::isHttps() ? 'https://' : 'http://') . (string)($_SERVER['HTTP_HOST'] ?? '');
        return $base . ($storeCode === null ? '/stores' : '/s/' . rawurlencode($storeCode)) . '?c=' . rawurlencode($code);
    }

    /** 予約に残した JSON を読む */
    public static function decode(?string $json): ?array
    {
        if ($json === null || $json === '') return null;
        $d = json_decode($json, true);
        return is_array($d) ? $d : null;
    }

    /** 予約表・ログに出すキャンペーン（キャンペーンを出していない予約は null） */
    public static function forStore(?string $json): ?array
    {
        $d = self::decode($json);
        return $d && ($d['name'] ?? '') !== '' ? $d : null;
    }

    /** 短い印（読み間違えやすい 0・o・1・l・i は使わない。紹介元の QR とも重ならない） */
    public static function newCode(): string
    {
        $chars = 'abcdefghjkmnpqrstuvwxyz23456789';
        do {
            $code = '';
            for ($i = 0; $i < 6; $i++) $code .= $chars[random_int(0, strlen($chars) - 1)];
        } while (Db::one('SELECT id FROM campaign WHERE code = ?', [$code]) || Db::one('SELECT id FROM referral WHERE code = ?', [$code]));
        return $code;
    }
}
