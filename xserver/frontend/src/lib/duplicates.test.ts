import { describe, expect, it } from 'vitest';
import { findDuplicates, patientKey } from './duplicates';

describe('予約表の重複', () => {
  it('お名前だけで比べる（印・様・空白は外す）', () => {
    expect(patientKey('見本 太郎（初診）')).toBe(patientKey('見本太郎様'));
    expect(patientKey('上記初診対応')).toBe('');
    expect(patientKey('✖')).toBe('');
  });
  it('同じ日に 2 か所以上', () => {
    const cells = new Map([['540:1', '見本 太郎（初診）'], ['555:1', '上記初診対応'], ['660:2', '見本太郎'], ['600:3', '試験 花子'], ['720:1', '']]);
    const d = findDuplicates(cells);
    expect(d.length).toBe(1);
    expect(d[0].places).toEqual([{ time: 540, bed: 1 }, { time: 660, bed: 2 }]);
  });
  it('重複なし', () => {
    expect(findDuplicates(new Map([['540:1', '見本 太郎'], ['600:1', '見本 次郎']]))).toEqual([]);
  });
});
