import { describe, expect, it } from 'vitest';
import { menuShort, toggleMenu } from './menus';

describe('予約表のメニュー', () => {
  it('短い印', () => {
    expect(menuShort('矯正')).toBe('矯');
    expect(menuShort('2回目')).toBe('2');
    expect(menuShort('12回目')).toBe('12');
    expect(menuShort('ワンコイン')).toBe('ワ');
  });
  it('付け外しと並び順', () => {
    const opts = ['矯正', '2回目', 'テープ'];
    expect(toggleMenu([], 'テープ', opts)).toEqual(['テープ']);
    expect(toggleMenu(['テープ'], '矯正', opts)).toEqual(['矯正', 'テープ']);
    expect(toggleMenu(['矯正', 'テープ'], '矯正', opts)).toEqual(['テープ']);
    expect(toggleMenu(['旧メニュー'], '矯正', opts)).toEqual(['矯正', '旧メニュー']);
  });
});
