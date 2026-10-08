import { describe, expect, it } from 'vitest';
import { categorizeCell, cellState, isContinuationText, isTwoSlotName } from './attendance';

describe('attendance', () => {
  it('当日：時刻前は none、過ぎたら pending、+30分で noshow、チェック済みは visited', () => {
    expect(cellState(false, 600, 590)).toBe('none');
    expect(cellState(false, 600, 601)).toBe('pending');
    expect(cellState(false, 600, 629)).toBe('pending');
    expect(cellState(false, 600, 630)).toBe('noshow');
    expect(cellState(true, 600, 700)).toBe('visited');
  });
  it('未来日は none、過去日は未チェックなら noshow', () => {
    expect(cellState(false, 600, null)).toBe('none');
    expect(cellState(false, 600, Infinity)).toBe('noshow');
  });
  it('2枠目の判定', () => {
    expect(isContinuationText('上記初診対応')).toBe(true);
    expect(isContinuationText('上記再来対応')).toBe(true);
    expect(isContinuationText('山田')).toBe(false);
    expect(isTwoSlotName('山田（初）')).toBe(true);
    expect(isTwoSlotName('山田（再）')).toBe(true);
    expect(isTwoSlotName('山田')).toBe(false);
    expect(isTwoSlotName('山田（初診）')).toBe(true);
    expect(isTwoSlotName('山田（初自）')).toBe(true);
  });
  it('内訳（初診・再来・自賠）の判定', () => {
    expect(categorizeCell('山田（初）')).toEqual({ isNew: true, isRevisit: false, isJibai: false });
    expect(categorizeCell('山田(初)')).toEqual({ isNew: true, isRevisit: false, isJibai: false });
    expect(categorizeCell('佐藤（再）')).toEqual({ isNew: false, isRevisit: true, isJibai: false });
    expect(categorizeCell('鈴木 自賠')).toEqual({ isNew: false, isRevisit: false, isJibai: true });
    expect(categorizeCell('鈴木（事故）')).toEqual({ isNew: false, isRevisit: false, isJibai: true });
    expect(categorizeCell('高橋（初）自賠')).toEqual({ isNew: true, isRevisit: false, isJibai: true });
    expect(categorizeCell('山田（初診）')).toEqual({ isNew: true, isRevisit: false, isJibai: false });
    expect(categorizeCell('山田（初自）')).toEqual({ isNew: true, isRevisit: false, isJibai: true });
    expect(categorizeCell('田中')).toEqual({ isNew: false, isRevisit: false, isJibai: false });
    expect(categorizeCell('')).toEqual({ isNew: false, isRevisit: false, isJibai: false });
  });
  it('括弧なしの「初診」「初自」「再来」「再診」も数える。1文字の「初」「再」とお名前は数えない', () => {
    expect(categorizeCell('山田 初診')).toEqual({ isNew: true, isRevisit: false, isJibai: false });
    expect(categorizeCell('山田初診')).toEqual({ isNew: true, isRevisit: false, isJibai: false });
    expect(categorizeCell('初診 山田')).toEqual({ isNew: true, isRevisit: false, isJibai: false });
    expect(categorizeCell('山田 初自')).toEqual({ isNew: true, isRevisit: false, isJibai: true });
    expect(categorizeCell('佐藤 再来')).toEqual({ isNew: false, isRevisit: true, isJibai: false });
    expect(categorizeCell('佐藤 再診')).toEqual({ isNew: false, isRevisit: true, isJibai: false });
    expect(categorizeCell('山田 初')).toEqual({ isNew: false, isRevisit: false, isJibai: false });
    expect(categorizeCell('佐藤 再')).toEqual({ isNew: false, isRevisit: false, isJibai: false });
    expect(categorizeCell('初美')).toEqual({ isNew: false, isRevisit: false, isJibai: false });
    expect(categorizeCell('上記初診対応')).toEqual({ isNew: false, isRevisit: false, isJibai: false });
    expect(categorizeCell('上記再来対応')).toEqual({ isNew: false, isRevisit: false, isJibai: false });
    expect(isTwoSlotName('山田 初診')).toBe(true);
    expect(isTwoSlotName('佐藤 再来')).toBe(true);
    expect(isTwoSlotName('上記初診対応')).toBe(false);
    expect(isTwoSlotName('初美')).toBe(false);
  });
});
