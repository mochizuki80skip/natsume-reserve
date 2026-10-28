<?php
// セルの文字の判定・整形（純粋関数）
declare(strict_types=1);

final class Text
{
    /** 2枠目（初診・再来の対応欄）の文字か */
    public static function isContinuationText(?string $text): bool
    {
        $t = trim($text ?? '');
        return $t === '上記初診対応' || $t === '上記再来対応' || $t === '〃';
    }

    /** 1枠目の文字が初診・再来（2枠使う予約）か */
    public static function isTwoSlotName(?string $text): bool
    {
        $c = self::categorize($text);
        return $c['isNew'] || $c['isRevisit'];
    }

    /**
     * 内訳判定。初診＝「（初診）（初自）（初）」または括弧なしの「初診」「初自」、
     * 再来＝「（再）」または括弧なしの「再来」「再診」、自賠＝「初自」「自賠」「事故」。
     * 新三（新・第三者行為）＝「（新三）」または前後に空白のある「新三」（新三郎さんなどのお名前と区別するため）。新三は初診にも数える。
     * 括弧なしの「初」「再」1文字はお名前（初美など）と区別できないので数えない。2枠目の「上記初診対応」「上記再来対応」は対象外
     */
    public const THIRD_RE = '/[（(]新三[）)]|(?:^|\s)新三(?:\s|$)/u';

    public static function categorize(?string $text): array
    {
        $t = trim($text ?? '');
        if (self::isContinuationText($t)) return ['isNew' => false, 'isRevisit' => false, 'isJibai' => false, 'isThird' => false];
        $third = (bool)preg_match(self::THIRD_RE, $t);
        return [
            'isNew' => $third || (bool)preg_match('/[（(]初(診|自)?[）)]|初診|初自|新自/u', $t),
            'isRevisit' => (bool)preg_match('/[（(]再[）)]|再来|再診/u', $t),
            'isJibai' => !$third && (bool)preg_match('/自賠|事故|初自|新自/u', $t),
            'isThird' => $third,
        ];
    }

    /** +819012345678 / 09012345678 → 090-1234-5678 */
    public static function formatJpPhone(?string $p): string
    {
        $raw = trim($p ?? '');
        $d = str_starts_with($raw, '+81') ? '0' . substr($raw, 3) : $raw;
        if (preg_match('/^0\d{10}$/', $d)) return substr($d, 0, 3) . '-' . substr($d, 3, 4) . '-' . substr($d, 7);
        if (preg_match('/^0\d{9}$/', $d)) return substr($d, 0, 3) . '-' . substr($d, 3, 3) . '-' . substr($d, 6);
        return $raw;
    }

    /** 日本の電話番号を E.164 (+81...) に正規化。無効なら null */
    public static function normalizeJpPhone(string $raw): ?string
    {
        $digits = preg_replace('/[^\d+]/', '', $raw);
        if (preg_match('/^\+81\d{9,10}$/', $digits)) return $digits;
        if (preg_match('/^0\d{9,10}$/', $digits)) return '+81' . substr($digits, 1);
        return null;
    }

    /** 氏名の比較用：空白を除き、全角英数字を半角に、小文字に */
    public static function normalizeName(?string $name): string
    {
        $s = preg_replace('/[\s\x{3000}]+/u', '', $name ?? '');
        $s = mb_convert_kana($s, 'a', 'UTF-8'); // 全角英数字→半角
        return mb_strtolower($s, 'UTF-8');
    }

    public static function isSameName(?string $a, ?string $b): bool
    {
        $x = self::normalizeName($a);
        $y = self::normalizeName($b);
        return $x !== '' && $x === $y;
    }

    /** 氏名の後ろの「様」を外す（予測変換で付いてしまうため）。後ろに（初診）などの印があっても外す */
    public static function dropHonorific(string $text): string
    {
        return preg_replace('/[\s\x{3000}]*様(?=[\s\x{3000}]*(?:[（(][^）)]*[）)][\s\x{3000}]*)*$)/u', '', $text) ?? $text;
    }

    /**
     * 電話番号（090-1234-5678、0551234567、ＴＥＬ：０９０…など）を外す。予約表のセルに氏名と一緒に書かれた電話番号を、
     * 新患継続率（初回カルテ）の氏名に入れないため。全角の数字・ハイフンも見る
     */
    public static function dropPhone(string $text): string
    {
        $t = mb_convert_kana($text, 'n', 'UTF-8'); // 全角の数字 → 半角
        $t = preg_replace('/(?<=\d)[ー－‐−―]|[ー－‐−―](?=\d)/u', '-', $t) ?? $t;
        $t = preg_replace('/(?:TEL|Tel|tel|ＴＥＬ|℡|☎|電話)?\s*[:：]?\s*\+?\d[\d\-\s()（）]{7,}\d/u', ' ', $t) ?? $t;
        return trim(preg_replace('/\s+/u', ' ', $t) ?? $t);
    }
}
