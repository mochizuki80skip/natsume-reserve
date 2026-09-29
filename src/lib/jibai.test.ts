import { describe, expect, it } from 'vitest';
import { MIN_INVOICE_HEIGHT_PX, requiredScreenFraction, wari } from './jibai';

describe('スクショの大きさの目安（画面の縦の何割）', () => {
  it('一般的なモニター（縦 1080）なら 8 割、縦 1440 なら 6 割', () => {
    expect(wari(requiredScreenFraction(1080)!)).toBe('8割');
    expect(wari(requiredScreenFraction(1440)!)).toBe('6割');
    expect(wari(requiredScreenFraction(2160)!)).toBe('4割');
  });
  it('小さいノートパソコン（縦 768）では画面いっぱいでも足りない', () => {
    expect(requiredScreenFraction(768)!).toBeGreaterThan(1);
    expect(wari(requiredScreenFraction(768)!)).toBe('10割');
  });
  it('目安は縦 860px（検証で全項目が読めた横 590px 以上に余裕をみた値）', () => {
    expect(MIN_INVOICE_HEIGHT_PX).toBe(860);
    expect(requiredScreenFraction(null)).toBeNull();
  });
});
