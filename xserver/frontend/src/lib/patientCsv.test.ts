import { describe, expect, it } from 'vitest';
import { normalizeCardNo, parsePatientCsv } from './patientCsv';

describe('患者一覧 CSV', () => {
  it('番号・氏名・フリガナだけを取り出す（住所などは捨てる）', () => {
    const csv = [
      'ﾃｽﾄ ﾀﾛｳ,テスト　太郎,4200911,静岡市葵区1-2-3,,3380627,090-0000-0000,男,003842 ',
      'ﾃｽﾄ ﾀﾛｳ,テスト　太郎,4200911,静岡市葵区1-2-3,,3380627,090-0000-0000,男,003842x',
      'ﾐﾎﾝ ﾊﾅｺ,見本　花子,4200912,"静岡市,葵区",,4010101,,女,000005a',
    ].join('\r\n');
    const { rows, skipped } = parsePatientCsv(csv);
    expect(rows).toEqual([{ no: '3842', name: 'テスト 太郎', kana: 'ﾃｽﾄ ﾀﾛｳ' }, { no: '5', name: '見本 花子', kana: 'ﾐﾎﾝ ﾊﾅｺ' }]);
    expect(skipped).toBe(0);
    expect(JSON.stringify(rows)).not.toContain('090');
  });
  it('番号のそろえ方', () => {
    expect(normalizeCardNo('003842 ')).toBe('3842');
    expect(normalizeCardNo('3842')).toBe('3842');
    expect(normalizeCardNo('000123r')).toBe('123');
    expect(normalizeCardNo('静岡')).toBeNull();
  });
});
