import { describe, expect, it } from 'vitest';
import { parseTsv, planPaste } from './paste';

// 予約表の行（9:00〜12:00, 15:00〜19:30）
const times = [...Array.from({ length: 13 }, (_, i) => 540 + i * 15), ...Array.from({ length: 19 }, (_, i) => 900 + i * 15)];

describe('paste', () => {
  it('Excel の結合セル（2列=1ベッド）を 1 列にまとめる', () => {
    const text = '山田\t\t鈴木\t\t\t\t✖\t\t✖\t\n\t\t佐藤\t\t\t\t✖\t\t✖\t\n';
    const p = planPaste(text, times, 0);
    expect(p.mergedCollapsed).toBe(true);
    expect(p.timeAligned).toBe(false);
    expect(p.cells).toEqual([
      { row: 0, col: 0, text: '山田' }, { row: 0, col: 1, text: '鈴木' }, { row: 0, col: 2, text: '' }, { row: 0, col: 3, text: '✖' }, { row: 0, col: 4, text: '✖' },
      { row: 1, col: 0, text: '' }, { row: 1, col: 1, text: '佐藤' }, { row: 1, col: 2, text: '' }, { row: 1, col: 3, text: '✖' }, { row: 1, col: 4, text: '✖' },
    ]);
  });
  it('時間列を含めて貼ると 12:00 の行があってもずれない', () => {
    // Excel の 11:45 の次は 15:00（12:00 行なし）
    const text = '11:30\t山田\t\n11:45\t鈴木\t\n15:00\t佐藤\t\n15:15\t田中\t\n';
    const p = planPaste(text, times, 5);
    expect(p.timeAligned).toBe(true);
    expect(p.cells.map((c) => [times[c.row], c.text])).toEqual([[690, '山田'], [705, '鈴木'], [900, '佐藤'], [915, '田中']]);
  });
  it('予約表に無い時刻（土曜に 19:15 など）は飛ばして報告する', () => {
    const satTimes = times.filter((t) => t <= 1110);
    const p = planPaste('18:30\tA\n19:00\tB\n19:15\tC\n', satTimes, 0);
    expect(p.skippedTimes).toEqual(['19:00', '19:15']);
    expect(p.cells).toEqual([{ row: satTimes.indexOf(1110), col: 0, text: 'A' }]);
  });
  it('時刻列が無い普通の貼り付けは貼り付け位置から順に', () => {
    const p = planPaste('A\tB\nC\tD', times, 3);
    expect(p.timeAligned).toBe(false);
    expect(p.mergedCollapsed).toBe(false);
    expect(p.cells).toEqual([{ row: 3, col: 0, text: 'A' }, { row: 3, col: 1, text: 'B' }, { row: 4, col: 0, text: 'C' }, { row: 4, col: 1, text: 'D' }]);
  });
  it('Google スプレッドシートの改行入りセル（"..."）と Excel の 9:00:00 表記', () => {
    expect(parseTsv('"山田\n090-1234"\t鈴木\n')).toEqual([['山田\n090-1234', '鈴木']]);
    const p = planPaste('9:00:00\t山田\n09:15\t鈴木\n', times, 0);
    expect(p.cells.map((c) => [times[c.row], c.text])).toEqual([[540, '山田'], [555, '鈴木']]);
  });
  it('末尾の空列は既存入力を消さない（列数の違いを吸収）', () => {
    const p = planPaste('A\t\t\t\n', times, 0);
    expect(p.cells).toEqual([{ row: 0, col: 0, text: 'A' }]);
  });
});
