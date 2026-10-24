import { describe, expect, it } from 'vitest';
import { parseSheet, parseSheetDate, parseTsv } from './karteImport';

const T = '\t';
// 新患継続率の画面と同じ 2 段の見出し（上の段は結合セル）。名前は見本
const head1 = ['初回入力', '', '', '', '', '', '', '', '', '', '', '', '2回目', '', '', '3回目', '', '', '4回目', '', '', '5回目', '', '', '6回目', '', ''].join(T);
const head2 = ['日付', 'カルテNo', 'きっかけ', '内訳', '氏名', '新・再', '年齢', '性別', '症状ｶﾃｺﾞﾘｰ', '症状', '担当', '施術', ...Array(5).fill(['日付', '担当', '施術']).flat()].join(T);
const r1 = ['4/3', '1203', 'チラシ', '', '見本 一郎様', '新患', '45歳', '男', '腰', '腰痛', '見本A', '矯正', '4/6', '見本A', '矯正', '4/10', '見本B', 'マッサージ', '', '', '', '', '', '', '', '', ''].join(T);
const r2 = ['2027/1/5', '', '', '', '見本 花子', '再', '', '♀', '', '', '', '', '1/30', '', '', '2/2', '', '', '', '', '', '', '', '', '', '', ''].join(T);

describe('parseSheet', () => {
  it('2 段の見出しから 2〜6 回目を読む', () => {
    const r = parseSheet([head1, head2, r1, r2, '', 'x\t\t', '4/9', '4/31\t\t\t\t見本 三郎'].join('\n'), 2026);
    expect(r.error).toBeUndefined();
    const ok = r.lines.filter((l) => l.row);
    expect(ok).toHaveLength(2);
    const a = ok[0].row!;
    expect(a).toMatchObject({ date: '2026-04-03', karteNo: '1203', name: '見本 一郎', kind: 'NEW', age: 45, sex: '♂', symptomCat: '腰', staff: '見本A', treatment: '矯正' });
    expect(a.visits[0]).toEqual({ d: '2026-04-06', s: '見本A', t: '矯正' });
    expect(a.visits[1]).toEqual({ d: '2026-04-10', s: '見本B', t: 'マッサ' });
    expect(ok[1].row).toMatchObject({ date: '2027-01-05', kind: 'REVISIT', sex: '♀' });
    expect(ok[1].row!.visits[1].d).toBe('2027-02-02');
    expect(r.lines.filter((l) => l.error).map((l) => l.error)).toEqual(['日付「4/31」が読めません']);
  });
  it('上の段がなくても、2 つ目以降の「日付」で回を見分ける', () => {
    const r = parseSheet([head2, r1].join('\n'), 2026);
    expect(r.lines[0].row!.visits[0].d).toBe('2026-04-06');
    expect(r.lines[0].row!.visits[1].s).toBe('見本B');
  });
  it('見出しがなくても、画面と同じ並びなら読む', () => {
    expect(parseSheet(r1, 2026).lines[0].row?.name).toBe('見本 一郎');
  });
  it('年度で年を決める・読めない日付', () => {
    expect(parseSheetDate('3/31', 2026)).toBe('2027-03-31');
    expect(parseSheetDate('４月１日', 2026)).toBe('2026-04-01');
    expect(parseSheetDate('2026-04-31', 2026)).toBeNull();
    expect(parseSheetDate('46115', 2026)).toBe('2026-04-03');
  });
  it('セルの中の改行（"…" で囲まれる）', () => {
    expect(parseTsv('a\t"b\nc"\td\n1\t2\t3')).toEqual([['a', 'b\nc', 'd'], ['1', '2', '3']]);
  });
});

describe('見出しなし', () => {
  it('画面と同じ並びとして読む', () => {
    const r1 = ['4/3', '1203', 'チラシ', '', '見本 一郎', '新患', '45', '男', '腰', '腰痛', '見本A', '矯正', '4/6', '見本A', '矯正'].join('\t');
    const r = parseSheet(r1 + '\n', 2026);
    expect(r.error).toBeUndefined();
    expect(r.lines[0].row).toMatchObject({ date: '2026-04-03', name: '見本 一郎', karteNo: '1203' });
    expect(r.lines[0].row!.visits[0]).toEqual({ d: '2026-04-06', s: '見本A', t: '矯正' });
  });
  it('日付でない表は読まない', () => {
    expect(parseSheet('a\tb\nc\td', 2026).error).toContain('読めませんでした');
  });
});

describe('店舗のスプレッドシートの並び（内訳なし・予後・アンケートあり）', () => {
  const sheet = (a: string[]) => [...a, ...Array(29 - a.length).fill('')].join('\t');
  const row = sheet(['10/2', '1,611', 'チラシ', '見本 一郎', '新患', '77', '♀', '腰', '腰', '見本A', 'マッサージ', '10/3', '見本A', 'マッサージ', '10/10', '見本B', '矯正', '', '', '', '', '', '', '', '', '', 'FALSE', 'TRUE', 'FALSE']);
  it('見出しありで読む（中止・転院・アンケートは読まない）', () => {
    const h1 = ['初回入力 ※初回入力欄はすべて埋めてください 再来のきっかけは入力不要', ...Array(10).fill(''), '2回目', '', '', '3回目', '', '', '4回目', '', '', '5回目', '', '', '6回目', '', '', '予後', '', ''].join('\t');
    const h2 = ['日付', 'カルテNo', 'きっかけ', '氏名', '新・再', '年齢', '性別', '症状カテゴリー', '症状', '担当', '施術内容', ...Array(5).fill(['日付', '担当', '施術内容']).flat(), '中止', '転院', 'アンケート'].join('\t');
    const r = parseSheet([h1, h2, row].join('\n'), 2026).lines[0].row!;
    expect(r).toMatchObject({ date: '2026-10-02', karteNo: '1611', trig: 'チラシ', trigDetail: '', name: '見本 一郎', kind: 'NEW', age: 77, sex: '♀', symptomCat: '腰', staff: '見本A', treatment: 'マッサ' });
    expect(r.visits[1]).toEqual({ d: '2026-10-10', s: '見本B', t: '矯正' });
  });
  it('見出しなしでも、内訳のない並びを見分ける', () => {
    const r = parseSheet(row + '\n' + sheet(['10/3', '327', '', '見本 花子', '再来', '42', '♀', '肩', '肩', '見本A', '矯正']), 2026).lines.map((l) => l.row!);
    expect(r[0]).toMatchObject({ name: '見本 一郎', kind: 'NEW', age: 77, treatment: 'マッサ' });
    expect(r[0].visits[0].d).toBe('2026-10-03');
    expect(r[1]).toMatchObject({ name: '見本 花子', kind: 'REVISIT', symptomCat: '肩' });
  });
});

describe('予後（中止・転院）・アンケート', () => {
  const sheet = (a: string[]) => [...a, ...Array(29 - a.length).fill('')].join('\t');
  it('見出しなしでも 6回目の後ろの TRUE/FALSE を読む', () => {
    const r = parseSheet(sheet(['10/2', '1', 'チラシ', '見本 一郎', '新患', '40', '♂', '腰', '腰', '見本A', '矯正', '10/3', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'TRUE', 'FALSE', 'TRUE']), 2026).lines[0].row!;
    expect([r.stopped, r.transferred, r.survey]).toEqual([true, false, true]);
    expect(r.visits[0].d).toBe('2026-10-03');
  });
  it('列がない並び（画面と同じ）なら送らない', () => {
    const r = parseSheet(['4/3', '1', 'チラシ', '', '見本 一郎', '新患'].join('\t'), 2026).lines[0].row!;
    expect('stopped' in r).toBe(false);
  });
});
