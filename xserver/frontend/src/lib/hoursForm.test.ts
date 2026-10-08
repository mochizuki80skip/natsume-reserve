import { describe, expect, it } from 'vitest';
import { emptyDays, toForm, toJson } from './hoursForm';

describe('営業時間の入力', () => {
  it('終了時刻で入力 → 最終枠の開始に直して保存', () => {
    const days = emptyDays();
    days['1'] = { closed: false, am: ['09:00', '12:00'], pm: ['15:00', '19:30'] };
    const r = toJson([{ from: '', to: '2026-10-20', days }], 15);
    const cfg = JSON.parse(r.json);
    expect(cfg.periods[0]).toEqual(expect.objectContaining({ to: '2026-10-20' }));
    expect(cfg.periods[0].byWeekday['1']).toEqual([['09:00', '11:45'], ['15:00', '19:15']]);
    expect(cfg.periods[0].byWeekday['0']).toEqual([]);
  });
  it('保存した設定を画面に戻すと同じ', () => {
    const days = emptyDays();
    days['6'] = { closed: false, am: ['08:30', '12:00'], pm: null };
    const json = toJson([{ from: '2026-10-01', to: '', days }], 15).json;
    expect(toForm(json, 15)).toEqual([{ from: '2026-10-01', to: '', days }]);
  });
  it('入力の誤り', () => {
    const days = emptyDays();
    days['1'] = { closed: false, am: ['12:00', '09:00'], pm: null };
    expect(toJson([{ from: '', to: '', days }], 15).error).toContain('月曜');
    expect(toJson([{ from: '2026-11-01', to: '2026-10-01', days: emptyDays() }], 15).error).toContain('開始日');
  });
  it('空は個別設定なし', () => expect(toForm('', 15)).toEqual([]));
});
