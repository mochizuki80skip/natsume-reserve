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
     * 括弧なしの「初」「再」1文字はお名前（初美など）と区別できないので数えない。2枠目の「上記初診対応」「上記再来対応」は対象外
     */
    public static function categorize(?string $text): array
    {
        $t = trim($text ?? '');
        if (self::isContinuationText($t)) return ['isNew' => false, 'isRevisit' => false, 'isJibai' => false];
        return [
            'isNew' => (bool)preg_match('/[（(]初(診|自)?[）)]|初診|初自/u', $t),
            'isRevisit' => (bool)preg_match('/[（(]再[）)]|再来|再診/u', $t),
            'isJibai' => (bool)preg_match('/自賠|事故|初自/u', $t),
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
}
