import { describe, expect, it } from 'vitest';
import { addMonthsYm, complianceHits, describeSchedule, formatScheduled, monthGrid, pct, toInputDateTime } from './sns';

describe('sns helpers', () => {
  it('予定日時の表示', () => {
    expect(formatScheduled('2026-10-08 18:00')).toBe('10/8(木) 18:00');
    expect(formatScheduled('2026-10-08T18:00:00')).toBe('10/8(木) 18:00');
    expect(toInputDateTime('2026-10-08 18:00')).toBe('2026-10-08T18:00');
  });
  it('頻度の説明', () => {
    expect(describeSchedule({ type: 'weekly', weekdays: [1, 4], hour: 18, minute: 0 })).toBe('毎週 月・木 18:00');
    expect(describeSchedule({ type: 'monthly', nth: 2, weekday: 6, hour: 9, minute: 30 })).toBe('毎月 第2土曜 9:30');
  });
  it('禁止語チェックは出現順・重複なし・大文字小文字を区別しない', () => {
    expect(complianceHits('必ず治ると言えませんが、No.1 です', ['治る', '必ず', 'no.1', '絶対'])).toEqual(['必ず', '治る', 'no.1']);
    expect(complianceHits('温めて動かすことが大切です', ['治る'])).toEqual([]);
  });
  it('月のカレンダーは月曜始まりで 7 日ずつ', () => {
    const g = monthGrid('2026-10');
    expect(g[0]).toEqual([null, null, null, '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(g.every((w) => w.length === 7)).toBe(true);
    expect(g.flat().filter(Boolean).length).toBe(31);
    expect(addMonthsYm('2026-12', 1)).toBe('2027-01');
    expect(addMonthsYm('2026-01', -1)).toBe('2025-12');
  });
  it('増減率', () => {
    expect(pct(120, 100)).toBe(20);
    expect(pct(50, 0)).toBeNull();
  });
});
