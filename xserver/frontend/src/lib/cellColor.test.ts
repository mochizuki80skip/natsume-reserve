import { describe, expect, it } from 'vitest';
import { cellColor } from './cellColor';
import { menuColor } from './menus';

describe('セルの色', () => {
  it('初診・再来・新自が回数より優先', () => {
    expect(cellColor('山田（初診）', ['2回目'])).toEqual({ bg: '#fde0de', dark: false });
    expect(cellColor('山田（再来）', [])).toEqual({ bg: '#d9e7fb', dark: false });
    expect(cellColor('山田（新自）', ['3回目'])).toEqual({ bg: '#fde9c4', dark: false });
  });
  it('回数は濃い色（2・3・6 で違う色）', () => {
    const a = cellColor('鈴木', ['矯正', '3回目'])!, b = cellColor('鈴木', ['2回目'])!, c = cellColor('鈴木', ['6回目'])!;
    expect(a.dark && b.dark && c.dark).toBe(true);
    expect(new Set([a.bg, b.bg, c.bg]).size).toBe(3);
  });
  it('矯正は回数の次（薄い色）', () => {
    expect(cellColor('鈴木', ['矯正', 'パイオ'])).toEqual({ bg: '#d9f99d', dark: false });
    expect(cellColor('鈴木', ['矯正', '2回目'])!.dark).toBe(true);
    expect(cellColor('鈴木（初診）', ['矯正'])!.bg).toBe('#fde0de');
  });
  it('ほかのメニューだけなら色なし', () => {
    expect(cellColor('鈴木', ['パイオ', 'テープ'])).toBeNull();
  });
  it('メニューの印も同じ色', () => {
    expect(menuColor('2回目', ['矯正', '2回目'])).toBe(cellColor('a', ['2回目'])!.bg);
  });
});
