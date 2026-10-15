import { describe, expect, it } from 'vitest';
import { cellColor, KYOSEI_BG, STAFF_PALETTE, staffColorMap } from './cellColor';

const colors = staffColorMap([{ name: '山本', color: '' }, { name: '中島', color: '' }, { name: '室塚', color: '#a5f3fc' }]);

describe('セルの色', () => {
  it('初診・再来・新自は担当が無くても色', () => {
    expect(cellColor('山田（初診）', [])!.bg).toBe('#fca5a5');
    expect(cellColor('山田（再来）', ['2回目'], '山本', colors)!.bg).toBe('#93c5fd');
    expect(cellColor('山田（新自）', [])!.bg).toBe('#fdba74');
  });
  it('n回目は担当の色（自動の色・店舗設定の色）', () => {
    expect(cellColor('鈴木', ['2回目'], '山本', colors)!.bg).toBe(STAFF_PALETTE[0].color);
    expect(cellColor('鈴木', ['12回目'], '中島', colors)!.bg).toBe(STAFF_PALETTE[1].color);
    expect(cellColor('鈴木', ['6回目'], '室塚', colors)!.bg).toBe('#a5f3fc');
  });
  it('担当に色が無ければ矯正の斜線、何も無ければ色なし', () => {
    expect(cellColor('鈴木', ['3回目', '矯正'], 'だれか', colors)!.bg).toBe(KYOSEI_BG);
    expect(cellColor('鈴木', ['矯正'])!.bg).toBe(KYOSEI_BG);
    expect(cellColor('鈴木', ['2回目'])).toBeNull();
    expect(cellColor('鈴木', ['パイオ'], '山本', colors)).toBeNull();
  });
  it('担当の色は初診・再来・新自の色と重ならない', () => {
    for (const p of STAFF_PALETTE) expect(['#fca5a5', '#93c5fd', '#fdba74']).not.toContain(p.color);
  });
});
