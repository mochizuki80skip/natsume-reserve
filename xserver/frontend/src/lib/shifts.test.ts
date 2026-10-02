import { describe, expect, it } from 'vitest';
import { inPeriod, joinBadge, oneMonthLastDay } from './shifts';

describe('所属期間', () => {
  it('開始日・終了日の範囲内だけ所属', () => {
    const m = { startDate: '2026-10-21', endDate: '2026-11-20' };
    expect(inPeriod(m, '2026-10-20')).toBe(false);
    expect(inPeriod(m, '2026-10-21')).toBe(true);
    expect(inPeriod(m, '2026-11-20')).toBe(true);
    expect(inPeriod(m, '2026-11-21')).toBe(false);
    expect(inPeriod({}, '2026-01-01')).toBe(true);
  });
});

describe('新人・異動の印', () => {
  it('開始日から 1 か月間', () => {
    expect(oneMonthLastDay('2026-10-21')).toBe('2026-11-20');
    const m = { startDate: '2026-10-21', joinType: 'TRANSFER' };
    expect(joinBadge(m, '2026-09-01', '2026-09-30')).toBe('');
    expect(joinBadge(m, '2026-10-01', '2026-10-31')).toBe('異動');
    expect(joinBadge(m, '2026-11-01', '2026-11-30')).toBe('異動');
    expect(joinBadge(m, '2026-12-01', '2026-12-31')).toBe('');
    expect(joinBadge({ startDate: '2026-04-01', joinType: 'NEW' }, '2026-04-01', '2026-04-30')).toBe('新人');
    expect(joinBadge({ startDate: '2026-04-01', joinType: null }, '2026-04-01', '2026-04-30')).toBe('');
  });
});
