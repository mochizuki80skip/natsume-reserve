import { describe, expect, it } from 'vitest';
import { parseChurnSheet } from './churnImport';

describe('parseChurnSheet', () => {
  const head = ['離反した日付', 'カルテNo.', '患者氏名', '性', '年', '内訳(新・再・既)', '通院回数', '担当', '症状', '施術内容', '管理(治癒・転院)', '理由'].join('\t');
  const r1 = ['4/2', '1322', '見本 一郎', '♂', '53', '再来', '2', '見本A', '肩', 'マッサージ', '治癒', ''].join('\t');
  const r2 = ['4/3', '584', '見本 花子', '♀', '42', '既存', '既存', '見本A', '肩', 'マッサージ', '', '予約で埋まって当日お断り'].join('\t');
  it('見出しありで読む', () => {
    const l = parseChurnSheet([head, r1, r2].join('\n'), 2026).lines;
    expect(l[0].row).toMatchObject({ churnDate: '2026-04-02', cardNo: '1322', name: '見本 一郎', sex: '♂', age: 53, kind: '再来', visits: '2', treatment: 'マッサ', manage: '治癒' });
    expect(l[1].row).toMatchObject({ kind: '既存', visits: '既存', reason: '予約で埋まって当日お断り' });
  });
  it('見出しなし・7~12', () => {
    const l = parseChurnSheet(['4/6', '1428', '見本 三郎', '♂', '41', '既存', '7~12', '見本B', '腰', 'マッサージ'].join('\t'), 2026).lines;
    expect(l[0].row).toMatchObject({ churnDate: '2026-04-06', visits: '7〜12' });
  });
});
