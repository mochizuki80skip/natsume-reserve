import { describe, expect, it } from 'vitest';
import { missingFields, parseAccidentDate, parseMd, retentionOf, type KarteRow } from './karte';

const base: KarteRow = { id: 'x', date: '2026-09-28', auto: true, karteNo: '1', kind: 'NEW', trig: 'Google', trigDetail: '', name: '山田', age: 30, sex: '♂', symptomCat: '腰', symptom: '腰部捻挫', staff: '佐藤', treatment: '矯正', visits: [] };
const det = { 紹介他事業: 'otherBiz', キャンペーン: 'campaign', イベント: null } as const;

describe('カルテの未入力', () => {
  it('全部入っていれば無し', () => expect(missingFields(base, det).size).toBe(0));
  it('内訳が必要なきっかけで内訳が空なら未入力', () => expect([...missingFields({ ...base, trig: 'イベント' }, det)]).toEqual(['trigDetail']));
  it('再はきっかけ空でもよい', () => expect(missingFields({ ...base, kind: 'REVISIT', trig: '' }, det).size).toBe(0));
  it('新患はきっかけ必須・年齢必須', () => expect([...missingFields({ ...base, trig: '', age: null }, det)].sort()).toEqual(['age', 'trig']));
});

describe('日付の入力', () => {
  it('M/D を年つきに', () => expect(parseMd('10/2', '2026-09-28')).toBe('2026-10-02'));
  it('4 桁や全角も読む', () => { expect(parseMd('1003', '2026-09-28')).toBe('2026-10-03'); expect(parseMd('１０／５', '2026-09-28')).toBe('2026-10-05'); });
  it('月が戻れば翌年', () => expect(parseMd('1/5', '2026-12-20')).toBe('2027-01-05'));
  it('空は空、読めなければ null', () => { expect(parseMd('', '2026-09-28')).toBe(''); expect(parseMd('2/30', '2026-09-28')).toBeNull(); expect(parseMd('abc', '2026-09-28')).toBeNull(); });
});

describe('継続', () => {
  it('回ごとの人数', () => {
    const r = retentionOf([{ visits: [{ d: '2026-10-01', s: '', t: '' }, { d: '', s: '', t: '' }] }, { reached: [true, true, false, false, false] }]);
    expect(r).toEqual({ first: 2, reached: [2, 1, 0, 0, 0] });
  });
});

describe('parseAccidentDate（事故日）', () => {
  it('月/日は初診日より前の日になる', () => {
    expect(parseAccidentDate('9/18', '2026-10-27')).toBe('2026-09-18');
    expect(parseAccidentDate('0918', '2026-10-27')).toBe('2026-09-18');
    expect(parseAccidentDate('12/20', '2027-01-05')).toBe('2026-12-20');
    expect(parseAccidentDate('10/27', '2026-10-27')).toBe('2026-10-27');
    expect(parseAccidentDate('11/1', '2026-10-27')).toBe('2025-11-01');
  });
  it('年つき・全角・空・読めない', () => {
    expect(parseAccidentDate('2026/7/26', '2026-10-05')).toBe('2026-07-26');
    expect(parseAccidentDate('２０２６年７月２６日', '2026-10-05')).toBe('2026-07-26');
    expect(parseAccidentDate('', '2026-10-05')).toBe('');
    expect(parseAccidentDate('2026/2/30', '2026-10-05')).toBeNull();
    expect(parseAccidentDate('きのう', '2026-10-05')).toBeNull();
  });
});
