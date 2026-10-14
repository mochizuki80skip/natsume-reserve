import { describe, expect, it } from 'vitest';
import { applyKindTag, kindTagOf } from './kindTag';
import { categorizeCell } from './attendance';

describe('新患・再来・新自ボタン', () => {
  it('付ける・付け替える・外す', () => {
    expect(applyKindTag('山田 太郎', '新患')).toEqual({ text: '山田 太郎（初診）', cont: '上記初診対応' });
    expect(applyKindTag('山田 太郎（初診）', '再来')).toEqual({ text: '山田 太郎（再来）', cont: '上記再来対応' });
    expect(applyKindTag('山田 太郎（再来）', '再来')).toEqual({ text: '山田 太郎', cont: null });
    expect(applyKindTag('鈴木（初自）', '新自')).toEqual({ text: '鈴木', cont: null }); // WEB予約の（初自）も新自として外せる
  });
  it('今付いている区分を読む', () => {
    expect(kindTagOf('佐藤（再）')).toBe('再来');
    expect(kindTagOf('佐藤 (初)')).toBe('新患');
    expect(kindTagOf('佐藤')).toBeNull();
  });
  it('付けた文字は集計で数えられる', () => {
    expect(categorizeCell('山田（初診）').isNew).toBe(true);
    expect(categorizeCell('山田（再来）').isRevisit).toBe(true);
    const j = categorizeCell('山田（新自）');
    expect(j.isNew && j.isJibai).toBe(true);
  });
});
