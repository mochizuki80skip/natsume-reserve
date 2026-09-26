// 自賠責請求書（レセコンの印刷前画面のスクショ）の OCR 結果から、患者番号・氏名・対象月・実日数・合計金額を取り出す純粋関数。
// 画面のレイアウト（左上に患者番号と氏名、右上に令和 年 月、右下に合計）を前提にした位置ベースの解析。

export interface OcrWord { text: string; x0: number; y0: number; x1: number; y1: number }
export interface OcrLine { words: OcrWord[]; x0: number; y0: number; x1: number; y1: number }
export interface Rect { x0: number; y0: number; x1: number; y1: number }

export interface ParsedInvoice {
  patientNo: string | null;
  patientName: string | null;
  ym: string | null;
  days: number | null;
  /** 1 段階目（画面全体の読み取り）で見つかった合計の候補 */
  amount: number | null;
  /** 合計金額の数字だけを読み直すための領域（画像座標）。無ければ右下の既定領域を使う */
  amountRect: Rect | null;
  /** 患者番号と氏名の範囲（確認用サムネイル。住所・生年月日は含めない） */
  headerRect: Rect | null;
  /** 患者番号の単語だけを英数字限定で読み直すための領域 */
  patientNoRect: Rect | null;
  /** 実日数の数字だけを読み直すための領域 */
  daysRect: Rect | null;
}

/** 全角英数字・全角空白を半角にそろえる */
export function toHalfWidth(s: string): string {
  return s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)).replace(/　/g, ' ').replace(/，/g, ',').replace(/．/g, '.');
}

/** "73,420" / "73.420" / "73 420" / "¥73,420" → 73420。数字が無ければ null */
export function parseAmountText(text: string | null | undefined): number | null {
  if (!text) return null;
  const t = toHalfWidth(text);
  // 数字と区切り（, . 空白）のかたまりのうち、最後のもの（右端＝合計欄）を採用
  const groups = t.match(/\d[\d,.\s]*\d|\d/g);
  if (!groups) return null;
  const last = groups[groups.length - 1].replace(/[^\d]/g, '');
  if (last === '' || last.length > 9) return null;
  return Number(last);
}

/** 患者番号らしい文字列（数字 5〜8 桁＋任意の英字 1 文字） */
export function normalizePatientNo(text: string): string | null {
  const t = toHalfWidth(text).replace(/\s/g, '');
  const m = t.match(/^(\d{5,8})([A-Za-z]{0,2})$/);
  if (!m) return null;
  return m[1] + m[2].toLowerCase();
}

/** 和暦 → "YYYY-MM"。era は 令和/平成/昭和（省略時は令和） */
export function eraToYm(era: string | null | undefined, y: number, m: number): string | null {
  if (!(m >= 1 && m <= 12) || !(y >= 1 && y <= 99)) return null;
  const base = era && /平成|H/.test(era) ? 1988 : era && /昭和|S/.test(era) ? 1925 : 2018;
  return `${base + y}-${String(m).padStart(2, '0')}`;
}

/** 行のテキスト（単語を空白でつなぐ） */
export function lineText(line: OcrLine): string {
  return toHalfWidth(line.words.map((w) => w.text).join(' '));
}

const ADDRESS_CHARS = /[都道府県市区町村郡丁目番地]/;
const NUMERIC_WORD = /^[\d,.\s|]*\d[\d,.\s|]*$/;

function lineHeight(line: OcrLine): number {
  return Math.max(8, line.y1 - line.y0);
}

/** 対象月：上部 20% にある「NN 年 NN 月」で、後ろに「日」が続かない行（生年月日を除く） */
export function findYm(lines: OcrLine[], imgH: number): string | null {
  const top = lines.filter((l) => l.y0 < imgH * 0.2).sort((a, b) => a.y0 - b.y0);
  for (const line of top) {
    const text = lineText(line).replace(/\s+/g, ' ');
    const m = text.match(/(令和|令|平成|昭和|R|H|S)?\s*(\d{1,2})\s*年\s*(\d{1,2})\s*月(.*)$/);
    if (!m) continue;
    if (/\d\s*日/.test(m[4]) || /生年/.test(text)) continue;
    const ym = eraToYm(m[1] ?? null, Number(m[2]), Number(m[3]));
    if (ym) return ym;
  }
  return null;
}

/** 患者番号と氏名：上部 25% で患者番号らしい単語のうち最も上のもの。氏名は同じ行でその右側、住所（都道府県…）や数字の手前まで */
export function findPatient(lines: OcrLine[], imgH: number): { patientNo: string | null; patientName: string | null; headerRect: Rect | null; patientNoRect: Rect | null } {
  let best: { line: OcrLine; idx: number; no: string } | null = null;
  for (const line of lines) {
    if (line.y0 > imgH * 0.25) continue;
    line.words.forEach((w, idx) => {
      const no = normalizePatientNo(w.text);
      if (no && (!best || line.y0 < best.line.y0)) best = { line, idx, no };
    });
  }
  if (!best) return { patientNo: null, patientName: null, headerRect: null, patientNoRect: null };
  const { line, idx, no } = best as { line: OcrLine; idx: number; no: string };
  const h = lineHeight(line);
  const parts: string[] = [];
  let prev = line.words[idx];
  for (const w of line.words.slice(idx + 1)) {
    const t = toHalfWidth(w.text).trim();
    if (t === '' || /[\d|]/.test(t) || ADDRESS_CHARS.test(t)) break;
    const gap = w.x0 - prev.x1;
    if (gap > h * 1.8) break; // 大きく離れたら住所などの別項目
    if (parts.length > 0 && gap > h * 0.5) {
      if (parts.includes(' ')) break; // 姓・名の 2 つまで。3 つ目のかたまりは住所とみなす
      parts.push(' ');
    }
    parts.push(t);
    prev = w;
    if (parts.join('').replace(/\s/g, '').length >= 10) break;
  }
  const name = parts.join('').replace(/\s+/g, ' ').trim();
  const w0 = line.words[idx];
  // 確認用の切り抜きは患者番号と氏名の範囲だけ（右隣の住所や、下の生年月日は含めない）
  const nameEnd = prev.x1;
  return {
    patientNo: no,
    patientName: name === '' ? null : name,
    headerRect: { x0: Math.max(0, w0.x0 - h * 0.5), y0: Math.max(0, line.y0 - h * 0.3), x1: nameEnd + h * 0.5, y1: line.y1 + h * 0.3 },
    patientNoRect: { x0: Math.max(0, w0.x0 - h * 0.5), y0: Math.max(0, w0.y0 - h * 0.4), x1: w0.x1 + h * 0.5, y1: w0.y1 + h * 0.4 },
  };
}

/** 実日数：ヘッダー「実日数」の下にある数字。見つからなければ「継続／治癒／中止」の直前の数字 */
export function findDays(lines: OcrLine[], imgH: number): { days: number | null; daysRect: Rect | null } {
  const sorted = [...lines].sort((a, b) => a.y0 - b.y0);
  let header: OcrWord | null = null;
  let headerLine: OcrLine | null = null;
  for (const line of sorted) {
    if (line.y0 > imgH * 0.4) break;
    for (let i = 0; i < line.words.length; i++) {
      const w = line.words[i];
      const t = w.text.replace(/\s/g, '');
      // 「実日数」がひとつの単語のとき／「実」「日」「数」に分かれたとき
      if (/実日数/.test(t) || (t === '実' && (line.words[i + 1]?.text ?? '').startsWith('日'))) {
        const last = t === '実' ? line.words[i + (line.words[i + 2]?.text === '数' ? 2 : 1)] : w;
        header = { text: '実日数', x0: w.x0, y0: w.y0, x1: last.x1, y1: last.y1 };
        headerLine = line;
        break;
      }
    }
    if (header) break;
  }
  if (header && headerLine) {
    const h = lineHeight(headerLine);
    const cx0 = header.x0 - h, cx1 = header.x1 + h;
    const rect: Rect = { x0: cx0, y0: header.y1, x1: cx1, y1: Math.min(imgH, header.y1 + h * 6) };
    for (const line of sorted) {
      if (line.y0 <= header.y1 || line.y0 > rect.y1) continue;
      for (const w of line.words) {
        const t = toHalfWidth(w.text).replace(/\s/g, '');
        const c = (w.x0 + w.x1) / 2;
        if (/^\d{1,2}$/.test(t) && c >= cx0 && c <= cx1) return { days: Number(t), daysRect: rect };
      }
    }
    return { days: null, daysRect: rect };
  }
  // 転帰（継続・治癒・中止）の直前の数字
  for (const line of sorted) {
    if (line.y0 > imgH * 0.4) break;
    const i = line.words.findIndex((w) => /継続|治癒|中止|継|癒/.test(w.text));
    if (i <= 0) continue;
    for (let j = i - 1; j >= 0; j--) {
      const raw = toHalfWidth(line.words[j].text).replace(/\s/g, '');
      const t = raw.replace(/[^\d]/g, ''); // 罫線が「13__」のように混ざることがある
      if (/^\d/.test(raw) && /^\d{1,2}$/.test(t)) return { days: Number(t), daysRect: null };
      if (raw !== '') break;
    }
  }
  return { days: null, daysRect: null };
}

/**
 * 合計：右側の列（画像幅の 60% より右）にある「計」を含む単語のうち最も下のものを合計のラベルとみなし、
 * その右側の数字を候補にする。ラベルが読めなければ右側の最も下の数字を候補にする。
 */
export function findAmount(lines: OcrLine[], imgW: number, imgH: number): { amount: number | null; amountRect: Rect | null } {
  const rightX = imgW * 0.6;
  let label: { word: OcrWord; line: OcrLine } | null = null;
  let bottom: { word: OcrWord; line: OcrLine } | null = null;
  for (const line of lines) {
    for (const w of line.words) {
      if (w.x0 < rightX) continue;
      if (/計/.test(w.text) && (!label || w.y0 > label.word.y0)) label = { word: w, line };
      const t = toHalfWidth(w.text);
      if (NUMERIC_WORD.test(t) && t.replace(/\D/g, '').length >= 3 && (!bottom || w.y0 > bottom.word.y0)) bottom = { word: w, line };
    }
  }
  // 「計」のラベルが読めていても、その下にさらに数字があれば（合計のラベルだけ読めなかった場合）下の数字を優先する
  if (label && !(bottom && bottom.line.y0 > label.line.y1 + lineHeight(label.line))) {
    const h = lineHeight(label.line);
    const rect: Rect = { x0: label.word.x1 + h * 0.3, y0: label.line.y0 - h * 0.35, x1: imgW, y1: label.line.y1 + h * 0.35 };
    const nums = label.line.words.filter((w) => w.x0 >= label!.word.x1 && NUMERIC_WORD.test(toHalfWidth(w.text)));
    return { amount: nums.length ? parseAmountText(nums.map((w) => w.text).join('')) : null, amountRect: rect };
  }
  if (bottom) {
    const h = lineHeight(bottom.line);
    return { amount: parseAmountText(bottom.word.text), amountRect: { x0: bottom.word.x0 - h, y0: bottom.line.y0 - h * 0.35, x1: imgW, y1: bottom.line.y1 + h * 0.35 } };
  }
  // 何も見つからないときは右下の既定領域
  return { amount: null, amountRect: { x0: imgW * 0.6, y0: imgH * 0.92, x1: imgW, y1: imgH } };
}

export function parseInvoice(lines: OcrLine[], imgW: number, imgH: number): ParsedInvoice {
  const { patientNo, patientName, headerRect, patientNoRect } = findPatient(lines, imgH);
  const { days, daysRect } = findDays(lines, imgH);
  const { amount, amountRect } = findAmount(lines, imgW, imgH);
  return { patientNo, patientName, ym: findYm(lines, imgH), days, amount, amountRect, headerRect, patientNoRect, daysRect };
}

/** 数字専用の読み直し結果（"13" や "1 3"）→ 実日数 */
export function parseDaysText(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = toHalfWidth(text).replace(/\s/g, '').match(/\d{1,2}/);
  if (!m) return null;
  const n = Number(m[0]);
  return n >= 0 && n <= 31 ? n : null;
}
