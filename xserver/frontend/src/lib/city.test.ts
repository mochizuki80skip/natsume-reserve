import { describe, expect, it } from 'vitest';
import { cityOf } from './city';

describe('cityOf', () => {
  it('市・政令市の区・郡の町', () => {
    expect(cityOf('静岡県静岡市葵区追手町9-6')).toBe('静岡市');
    expect(cityOf('静岡県浜松市中央区板屋町1')).toBe('浜松市');
    expect(cityOf('静岡県駿東郡長泉町下土狩1')).toBe('長泉町');
    expect(cityOf('静岡県富士市錦町1-1')).toBe('富士市');
    expect(cityOf('三島市一番町1')).toBe('三島市');
    expect(cityOf('東京都千代田区丸の内1')).toBe('');
    expect(cityOf('')).toBe('');
  });
});
