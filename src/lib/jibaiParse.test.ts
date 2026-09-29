import { describe, expect, it } from 'vitest';
import { eraToYm, findAmount, findDays, findPatient, findYm, normalizePatientNo, parseAmountText, parseDaysText, parseInvoice, type OcrLine } from './jibaiParse';

/** "text@x0" を並べた文字列から行を作るテスト用ヘルパー（高さ 14px、幅は文字数×14） */
function line(y0: number, spec: string): OcrLine {
  const words = spec.split('|').map((s) => {
    const [text, x] = s.trim().split('@');
    const x0 = Number(x);
    return { text, x0, y0, x1: x0 + Math.max(1, text.length) * 14, y1: y0 + 14 };
  });
  return { words, x0: words[0].x0, y0, x1: words[words.length - 1].x1, y1: y0 + 14 };
}

// 実際のスクショ（656×940）の 1 段階目の読み取り結果を模したもの
const W = 656, H = 940;
const sample: OcrLine[] = [
  line(9, '自@263|賠@278|責@297|保@314|険@335|人@502|省@512|和@522|08@535|年@554|09@575|月@596'),
  line(33, '003862a@21|池谷@113|能@162|疹@182|葬@241|岡@260|市@274|芸@287|区@296|名@312'),
  line(64, '生年@18|月@56|日@64|半@80|剛@88|01@108|年@127|03@149|月@170|15@188|日@209'),
  line(87, '負傷名@28|負傷日@192|初検日@275|開始日@351|終了日@420|実日数@490|転帰@548'),
  line(119, 'また@38|さこ@62|に@84|8@199|7@224|10@241|8@276|722@300|8@355|722@378|13@506|維@548|続@566'),
  line(244, '再@16|検@41|料@47|2@198|単価@229|590@321|小計@527|180@581'),
  line(401, '小計@531|15,990@575'),
  line(872, '施術@15|証明@45|者@69|料@81|回@161|1@230|回@244|の@256|料金@263|2.000@306|小計@530|22000@580'),
  line(904, 'その@17|他@41|の@54|人@60|金額@69|小計@531'),
  line(921, 'し@11|人@528|計@543|73.420@568'),
];

describe('parseAmountText', () => {
  it('区切り文字の違いを吸収して整数にする', () => {
    expect(parseAmountText('73,420')).toBe(73420);
    expect(parseAmountText('73.420')).toBe(73420);
    expect(parseAmountText('73 420')).toBe(73420);
    expect(parseAmountText('７３，４２０')).toBe(73420);
    expect(parseAmountText('合計 73,420|')).toBe(73420);
    expect(parseAmountText('0')).toBe(0);
  });
  it('数字が無ければ null', () => {
    expect(parseAmountText('')).toBeNull();
    expect(parseAmountText('計')).toBeNull();
    expect(parseAmountText(null)).toBeNull();
  });
  it('複数のかたまりがあれば右端（最後）を採用', () => {
    expect(parseAmountText('2,000 小計 73,420')).toBe(73420);
  });
});

describe('normalizePatientNo / eraToYm', () => {
  it('患者番号は数字 5〜8 桁＋任意の英字', () => {
    expect(normalizePatientNo('003862a')).toBe('003862a');
    expect(normalizePatientNo('００３８６２Ａ')).toBe('003862a');
    expect(normalizePatientNo('003862')).toBe('003862');
    expect(normalizePatientNo('003862as')).toBe('003862as'); // 罫線の誤読が付くことがあるので 2 文字まで許し、読み直しで確定する
    expect(normalizePatientNo('池谷')).toBeNull();
    expect(normalizePatientNo('1234')).toBeNull();
    expect(normalizePatientNo('15,990')).toBeNull();
  });
  it('和暦を西暦の年月にする', () => {
    expect(eraToYm('令和', 8, 9)).toBe('2026-09');
    expect(eraToYm(null, 8, 9)).toBe('2026-09');
    expect(eraToYm('平成', 31, 4)).toBe('2019-04');
    expect(eraToYm('令和', 8, 13)).toBeNull();
  });
});

describe('parseInvoice（スクショの読み取り結果）', () => {
  it('患者番号・氏名・対象月・実日数・合計を取り出す', () => {
    const r = parseInvoice(sample, W, H);
    expect(r.patientNo).toBe('003862a');
    expect(r.patientName).toBe('池谷 能疹'); // 氏名は誤読されうるので確認画面で直す前提
    expect(r.ym).toBe('2026-09');
    expect(r.days).toBe(13);
    expect(r.amount).toBe(73420);
    // 合計の読み直し領域は「計」の右側から右端まで
    expect(r.amountRect).not.toBeNull();
    expect(r.amountRect!.x0).toBeGreaterThan(543);
    expect(r.amountRect!.x1).toBe(W);
    expect(r.headerRect).not.toBeNull();
    expect(r.patientNoRect).not.toBeNull();
    // 確認用の切り抜きは氏名の終わり（疹@182〜196）までで、住所（葬@241 以降）や生年月日の行（y=64）は含めない
    expect(r.headerRect!.x1).toBeLessThan(241);
    expect(r.headerRect!.y1).toBeLessThan(64);
  });
  it('生年月日の行を対象月と間違えない', () => {
    expect(findYm([sample[2]], H)).toBeNull();
    expect(findYm([sample[0]], H)).toBe('2026-09');
  });
  it('「令和」が読めなくても年月を取れる', () => {
    expect(findYm([line(9, '自賠責保険@263|08@535|年@554|09@575|月@596')], H)).toBe('2026-09');
  });
  it('住所が氏名の直後に続いても住所を氏名に含めない', () => {
    expect(findPatient([line(33, '003862a@21|池谷@113|麗花@162|静岡市葵区@241')], H).patientName).toBe('池谷 麗花');
    // 住所の先頭が住所らしくない字に誤読されても、3 つ目のかたまりは氏名に含めない
    expect(findPatient([line(33, '003862a@21|池谷@113|臣@162|花@176|坦@241|財@255')], H).patientName).toBe('池谷 臣花');
  });
  it('実日数の見出しが無ければ転帰の直前の数字を使う', () => {
    expect(findDays([line(119, '頚部捻挫@15|8@199|7@224|10@241|13@506|継続@548')], H).days).toBe(13);
    expect(findDays([line(119, '頚部捻挫@15|8_@199|7@224|10@241|13__@506|継@548')], H).days).toBe(13); // 罫線が混ざった場合
    expect(findDays([line(119, '頚部捻挫@15|8@199|7@224|10@241|__13@506|継@548')], H).days).toBeNull(); // 数字で始まらなければ採用しない
  });
  it('合計の「計」が読めず小計の行しか無くても、より下にある数字を合計の候補にする', () => {
    const { amount, amountRect } = findAmount([sample[6], line(921, 'ロー@11|73420@580')], W, H);
    expect(amount).toBe(73420);
    expect(amountRect!.y0).toBeGreaterThan(900);
  });
  it('候補が何も無ければ右下の既定領域を返す', () => {
    const { amount, amountRect } = findAmount([sample[1]], W, H);
    expect(amount).toBeNull();
    expect(amountRect).toEqual({ x0: W * 0.6, y0: H * 0.92, x1: W, y1: H });
  });
  it('小計の行ではなく最も下の「計」を合計とみなす', () => {
    const { amountRect } = findAmount(sample, W, H);
    expect(amountRect!.y0).toBeGreaterThan(910);
  });
});

describe('parseDaysText', () => {
  it('数字専用の読み直し結果から実日数を取る', () => {
    expect(parseDaysText('13')).toBe(13);
    expect(parseDaysText(' 1 3 ')).toBe(13);
    expect(parseDaysText('')).toBeNull();
    expect(parseDaysText('99')).toBeNull();
  });
});
