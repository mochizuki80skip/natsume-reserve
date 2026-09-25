import { describe, expect, it } from 'vitest';
import { formatJpPhone, isSameName, normalizeName } from './format';

describe('format', () => {
  it('電話番号の整形', () => {
    expect(formatJpPhone('+819012345678')).toBe('090-1234-5678');
    expect(formatJpPhone('09012345678')).toBe('090-1234-5678');
    expect(formatJpPhone('0559608181')).toBe('055-960-8181');
    expect(formatJpPhone('abc')).toBe('abc');
    expect(formatJpPhone(null)).toBe('');
  });
  it('氏名の比較（空白・全角半角の違いは無視、別人は区別）', () => {
    expect(normalizeName('山田　太郎')).toBe('山田太郎');
    expect(isSameName('山田 太郎', '山田太郎')).toBe(true);
    expect(isSameName('ＹＡＭＡＤＡ', 'yamada')).toBe(true);
    expect(isSameName('山田 太郎', '山田 花子')).toBe(false); // 親子（同じ電話番号でも別人）
    expect(isSameName('', '')).toBe(false);
  });
});
