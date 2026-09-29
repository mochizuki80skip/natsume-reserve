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
  const col = findSubtotalColumn(lines);
  const limit = col ? col.words[0].word.y0 : imgH * 0.2; // 見出し部分（小計の列より上）
  const top = lines.filter((l) => l.y0 < limit).sort((a, b) => a.y0 - b.y0);
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
  const col = findSubtotalColumn(lines);
  const patientLimit = col ? col.words[0].word.y0 : imgH * 0.25; // 見出し部分（小計の列より上）
  let best: { line: OcrLine; idx: number; no: string } | null = null;
  for (const line of lines) {
    if (line.y0 > patientLimit) continue;
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

/** 本文の文字の高さ（単語の高さの中央値）。行の高さはレイアウトの誤認識で極端な値になることがあるため単語で測る */
export function medianLineHeight(lines: OcrLine[]): number | null {
  const hs = lines.flatMap((l) => l.words).map((w) => w.y1 - w.y0).filter((h) => h > 3).sort((a, b) => a - b);
  if (hs.length === 0) return null;
  return hs[Math.floor(hs.length / 2)];
}

function median(xs: number[]): number {
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
}

/**
 * 小計・合計の列：「計」を含む単語は右端の列に縦に並ぶ（小計 × 十数行、最後が合計）。
 * x 位置が近いもの同士をまとめ、3 個以上ある最大のまとまりを列とみなす
 */
export function findSubtotalColumn(lines: OcrLine[]): { x0: number; x1: number; lh: number; words: { word: OcrWord; line: OcrLine }[] } | null {
  const items: { word: OcrWord; line: OcrLine }[] = [];
  for (const line of lines) for (const w of line.words) if (/計/.test(w.text)) items.push({ word: w, line });
  if (items.length < 3) return null;
  // 行の高さは tesseract が複数行をまとめてしまうと大きく出るため、「計」の単語そのものの高さで測る
  const lh = Math.max(8, median(items.map((i) => i.word.y1 - i.word.y0)));
  let best: { word: OcrWord; line: OcrLine }[] = [];
  for (const a of items) {
    const group = items.filter((b) => Math.abs(b.word.x1 - a.word.x1) <= lh * 1.2);
    if (group.length > best.length) best = group;
  }
  if (best.length < 3) return null;
  return { x0: median(best.map((b) => b.word.x0)), x1: median(best.map((b) => b.word.x1)), lh, words: best.sort((a, b) => a.word.y0 - b.word.y0) };
}

/**
 * 金額の列：「1,180」「15,990」…「73,420」のような 3 桁以上の金額は、右端をそろえて縦に並ぶ。
 * 右端の x が近い金額のまとまりのうち、3 個以上で最も多いものを金額の列とみなす（最も下が合計）。
 * 項目名（小計・合計）の読み取りに頼らずに合計の位置を知るための手がかり
 */
export function findAmountColumn(lines: OcrLine[]): { x1: number; lh: number; items: { word: OcrWord; line: OcrLine; value: number }[] } | null {
  const items: { word: OcrWord; line: OcrLine; value: number }[] = [];
  for (const line of lines) for (const w of line.words) {
    const t = toHalfWidth(w.text).replace(/[|]/g, '');
    if (!/^\d{1,3}([,.]\d{3})+$|^\d{4,7}$/.test(t)) continue;
    const v = parseAmountText(t);
    if (v !== null && v >= 100) items.push({ word: w, line, value: v });
  }
  if (items.length < 3) return null;
  const lh = Math.max(8, median(items.map((i) => i.word.y1 - i.word.y0)));
  let best: typeof items = [];
  for (const a of items) {
    const g = items.filter((b) => Math.abs(b.word.x1 - a.word.x1) <= lh * 1.2);
    if (g.length > best.length || (g.length === best.length && median(g.map((x) => x.word.x1)) > median(best.map((x) => x.word.x1)))) best = g;
  }
  if (best.length < 3) return null;
  return { x1: median(best.map((b) => b.word.x1)), lh, items: best.sort((a, b) => a.word.y0 - b.word.y0) };
}

/**
 * 請求書の範囲（画面全体を撮ったスクショから請求書の部分だけを切り出すため）。
 * 上端＝患者番号・対象月の行、下端＝合計の行、右端＝合計欄、左端＝項目名（〜料）の列
 */
export function findInvoiceRect(lines: OcrLine[], imgW: number, imgH: number): Rect | null {
  const col = findSubtotalColumn(lines);
  if (!col) return null;
  const lh = col.lh;
  const top = col.words[0].word.y0;
  const bottom = col.words[col.words.length - 1].word.y1;
  // 左端：小計の列より左にある「〜料」の単語（初検料・後療料など）の最も左
  const lefts = lines.flatMap((l) => l.words).filter((w) => /料/.test(w.text) && w.x1 < col.x0 && w.y0 >= top - lh * 2 && w.y1 <= bottom + lh);
  let x0 = lefts.length ? Math.min(...lefts.map((w) => w.x0)) : Math.max(0, col.x0 - lh * 45);
  // 上端：列の上にある患者番号・対象月（令和 年 月）・「自賠責保険」の行のうち最も上。列の上 45 行ぶんまで探す
  let y0 = Math.max(0, top - lh * 45);
  const above = lines.filter((l) => l.y1 <= top && l.y0 >= y0 && l.x1 >= x0 - lh * 2 && l.x0 <= col.x1 + lh * 8);
  const anchor = above.filter((l) => l.words.some((w) => normalizePatientNo(w.text)) || (/年.*月/.test(lineText(l)) && !/生年|日/.test(lineText(l))) || /自賠|保険/.test(lineText(l)));
  if (anchor.length) {
    y0 = Math.min(...anchor.map((l) => l.y0));
    x0 = Math.min(x0, ...anchor.flatMap((l) => l.words.filter((w) => normalizePatientNo(w.text)).map((w) => w.x0)));
  }
  const x1 = Math.max(col.x1 + lh * 7, ...anchor.filter((l) => /年.*月/.test(lineText(l))).map((l) => l.x1 + lh));
  // 下端：小計の列の最後、または金額の列の最後（合計の行のラベルが読めていなくても金額が読めていればそこまで）
  const amtCol = findAmountColumn(lines);
  const amtBottom = amtCol && Math.abs(amtCol.x1 - col.x1) < lh * 10 ? amtCol.items[amtCol.items.length - 1].word.y1 : 0;
  return {
    x0: Math.max(0, x0 - lh * 2), y0: Math.max(0, y0 - lh * 2.5),
    x1: Math.min(imgW, Math.max(x1, amtCol ? amtCol.x1 + lh * 2 : 0)), y1: Math.min(imgH, Math.max(bottom, amtBottom) + lh * 3),
  };
}

/** 実日数の候補（出どころ別）。column＝実日数の列、outcome＝転帰（継続など）の直前、counts＝「×13回」などの施術回数 */
export interface DaysCandidates { column: number[]; outcome: number[]; counts: number[]; columnRect: Rect | null }

/** 1〜2 桁の数字だけを取り出す（罫線の「_」「|」が混ざっても可。数字で始まらないものは除く） */
function smallNumber(text: string): number | null {
  const raw = toHalfWidth(text).replace(/\s/g, '');
  if (!/^\d/.test(raw)) return null;
  const t = raw.replace(/[_|。.]/g, '');
  if (!/^\d{1,2}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= 31 ? n : null;
}

export function findDaysCandidates(lines: OcrLine[], imgH: number): DaysCandidates {
  const sorted = [...lines].sort((a, b) => a.y0 - b.y0);
  const col = findSubtotalColumn(lines);
  // 見出しの行は小計の列より上にある。列が無ければ上 40%
  const headerLimit = col ? col.words[0].word.y0 : imgH * 0.4;
  const out: DaysCandidates = { column: [], outcome: [], counts: [], columnRect: null };

  // 見出し「実日数」（または右隣の「転帰」）から実日数の列の x 範囲を決める
  let range: { x0: number; x1: number; y: number; h: number } | null = null;
  for (const line of sorted) {
    if (line.y0 > headerLimit) break;
    const h = lineHeight(line);
    for (let i = 0; i < line.words.length && !range; i++) {
      const t = line.words[i].text.replace(/\s/g, '');
      const next = (line.words[i + 1]?.text ?? '').replace(/\s/g, '');
      if (/実日数|日数/.test(t) || (/^[実表]$/.test(t) && next.startsWith('日'))) {
        const last = /^[実表]$/.test(t) ? line.words[Math.min(line.words.length - 1, i + 2)] : line.words[i];
        const x1 = /^[実表]$/.test(t) && !/^(数|雪|教|救)/.test(line.words[i + 2]?.text ?? '') ? line.words[i + 1].x1 + h : last.x1;
        range = { x0: line.words[i].x0 - h * 0.8, x1: x1 + h * 0.8, y: line.y1, h };
      } else if (/^転/.test(t) && i > 0) {
        range = { x0: line.words[i].x0 - h * 4, x1: line.words[i].x0 - h * 0.2, y: line.y1, h };
      }
    }
    if (range) break;
  }
  if (range) {
    const r = range;
    out.columnRect = { x0: r.x0, y0: r.y, x1: r.x1, y1: Math.min(imgH, r.y + r.h * 6) };
    for (const line of sorted) {
      if (line.y0 < r.y - r.h * 0.3 || line.y0 > r.y + r.h * 6) continue;
      for (const w of line.words) {
        const c = (w.x0 + w.x1) / 2;
        const n = smallNumber(w.text);
        if (n !== null && c >= r.x0 && c <= r.x1) out.column.push(n);
      }
    }
  }
  // 転帰（継続・治癒・中止・転医）の直前の数字
  for (const line of sorted) {
    if (line.y0 > headerLimit) break;
    const i = line.words.findIndex((w, k) => k > 0 && /^[継維]|続$|治癒|癒|中止|転医/.test(w.text));
    if (i <= 0) continue;
    for (let j = i - 1; j >= 0; j--) {
      const raw = toHalfWidth(line.words[j].text).replace(/\s/g, '');
      if (raw === '' || /^[_|]+$/.test(raw)) continue; // 罫線だけの単語は飛ばす
      const n = smallNumber(raw);
      if (n !== null) out.outcome.push(n);
      break;
    }
  }
  // 施術回数：「1110円×13回」「x13」、後療料の「13 1,230」
  for (const line of sorted) {
    const text = lineText(line);
    for (const m of text.matchAll(/[x×X]\s?(\d{1,2})(?!\d)/g)) { const n = Number(m[1]); if (n >= 1 && n <= 31) out.counts.push(n); }
    if (/後療|後\s*[療擦岩]/.test(text)) {
      const w = line.words.find((x, k) => k > 0 && smallNumber(x.text) !== null && /^\d{1,2}$/.test(toHalfWidth(x.text).trim()));
      if (w) out.counts.push(smallNumber(w.text)!);
    }
  }
  return out;
}

/**
 * 実日数を多数決で決める。列の数字（重み 3）・転帰の直前（重み 2）・施術回数（重み 1）。
 * 列や転帰から 1 つも取れず施術回数だけのときは推定扱い（confident = false）
 */
export function chooseDays(c: DaysCandidates, extraColumn: number[] = []): { days: number | null; confident: boolean } {
  const score = new Map<number, number>();
  const add = (n: number, w: number) => score.set(n, (score.get(n) ?? 0) + w);
  // 複数の傷病がある場合、列の数字は傷病ごとに並ぶ。患者の実日数はその最大値
  const col = [...c.column, ...extraColumn];
  for (const n of col) add(n, 3);
  for (const n of c.outcome) add(n, 2);
  for (const n of c.counts) add(n, 1);
  if (score.size === 0) return { days: null, confident: false };
  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const [best, bestScore] = ranked[0];
  const second = ranked[1]?.[1] ?? 0;
  const direct = col.length + c.outcome.length > 0;
  return { days: best, confident: direct && bestScore >= 3 && bestScore - second >= 3 };
}

/** 後方互換：実日数（多数決の結果）と、数字だけを読み直すための列の領域 */
export function findDays(lines: OcrLine[], imgH: number): { days: number | null; daysRect: Rect | null } {
  const c = findDaysCandidates(lines, imgH);
  return { days: chooseDays(c).days, daysRect: c.columnRect };
}

/**
 * 合計：小計の列（「計」が縦に並ぶ列）の最も下のラベルを合計とみなし、その右の数字を候補にする。
 * 列が見つからないときは、画像の右側（幅の 60% より右）で「計」を含む最も下の単語、または最も下の数字を使う。
 * maxSubtotal は小計欄の数字の最大値（合計はこれ以上になるはず。読み直し結果の妥当性チェックに使う）
 */
export function findAmount(lines: OcrLine[], imgW: number, imgH: number): { amount: number | null; amountRect: Rect | null; maxSubtotal: number; subtotals: number[]; labelFound: boolean } {
  const col = findSubtotalColumn(lines);
  const numsRightOf = (line: OcrLine, x: number) => line.words.filter((w) => w.x0 >= x && NUMERIC_WORD.test(toHalfWidth(w.text)));
  if (col) {
    const lh = col.lh;
    const label = col.words[col.words.length - 1];
    const right = Math.min(imgW, col.x1 + lh * 6.5);
    // 最も下のラベルが「小計」なら、合計の行は読み落とされている（合計はその 1 行下）
    const labelFound = !/小/.test(label.word.text);
    const subtotals: number[] = [];
    for (const it of labelFound ? col.words.slice(0, -1) : col.words) {
      const v = parseAmountText(numsRightOf(it.line, it.word.x1).map((w) => w.text).join(''));
      if (v !== null && v <= 9999999) subtotals.push(v);
    }
    const maxSubtotal = subtotals.length ? Math.max(...subtotals) : 0;
    // 合計の行の下にさらに右側の数字があれば（合計のラベルだけ読めなかった場合）そちらを使う
    const below = lines.filter((l) => l.y0 > label.line.y1 + lh * 0.5 && l.y0 < label.line.y1 + lh * 4)
      .flatMap((l) => l.words.filter((w) => w.x0 >= col.x0 - lh && w.x1 <= right + lh && NUMERIC_WORD.test(toHalfWidth(w.text)) && toHalfWidth(w.text).replace(/\D/g, '').length >= 3).map((w) => ({ w, l })));
    if (below.length) {
      const b = below.sort((p, q) => q.w.y0 - p.w.y0)[0];
      return { amount: parseAmountText(b.w.text), amountRect: { x0: col.x1 + lh * 0.2, y0: b.l.y0 - lh * 0.4, x1: right, y1: b.l.y1 + lh * 0.4 }, maxSubtotal, subtotals, labelFound: true };
    }
    const amtCol = findAmountColumn(lines);
    const lastAmt = amtCol ? amtCol.items[amtCol.items.length - 1] : null;
    if (lastAmt && lastAmt.line.y0 > label.word.y1 + lh * 0.3 && Math.abs(amtCol!.x1 - col.x1) < lh * 10) {
      // 合計のラベルは読めなかったが、金額の列の最も下（最後の小計より下）に数字がある → それが合計
      const w = lastAmt.word;
      return { amount: lastAmt.value, amountRect: { x0: col.x1 + lh * 0.2, y0: w.y0 - lh * 0.5, x1: right, y1: w.y1 + lh * 0.5 }, maxSubtotal, subtotals, labelFound: true };
    }
    if (!labelFound) {
      // 合計の行（最後の小計の 1 行下）を読み直し用の範囲にする。全体の読みには数字が無いので amount は null
      const rect: Rect = { x0: col.x1 + lh * 0.2, y0: label.word.y1 + lh * 0.15, x1: right, y1: Math.min(imgH, label.word.y1 + lh * 2) };
      return { amount: null, amountRect: rect, maxSubtotal, subtotals, labelFound: false };
    }
    const nums = numsRightOf(label.line, label.word.x1);
    const rect: Rect = { x0: label.word.x1 + lh * 0.2, y0: label.word.y0 - lh * 0.5, x1: right, y1: label.word.y1 + lh * 0.5 };
    return { amount: nums.length ? parseAmountText(nums.map((w) => w.text).join('')) : null, amountRect: rect, maxSubtotal, subtotals, labelFound: true };
  }
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
  if (label && !(bottom && bottom.line.y0 > label.line.y1 + lineHeight(label.line))) {
    const h = lineHeight(label.line);
    const rect: Rect = { x0: label.word.x1 + h * 0.3, y0: label.line.y0 - h * 0.35, x1: imgW, y1: label.line.y1 + h * 0.35 };
    const nums = numsRightOf(label.line, label.word.x1);
    return { amount: nums.length ? parseAmountText(nums.map((w) => w.text).join('')) : null, amountRect: rect, maxSubtotal: 0, subtotals: [], labelFound: true };
  }
  if (bottom) {
    const h = lineHeight(bottom.line);
    return { amount: parseAmountText(bottom.word.text), amountRect: { x0: bottom.word.x0 - h, y0: bottom.line.y0 - h * 0.35, x1: imgW, y1: bottom.line.y1 + h * 0.35 }, maxSubtotal: 0, subtotals: [], labelFound: false };
  }
  return { amount: null, amountRect: { x0: imgW * 0.6, y0: imgH * 0.92, x1: imgW, y1: imgH }, maxSubtotal: 0, subtotals: [], labelFound: false };
}

/** 3 桁区切りのカンマが正しく入った金額表記か（"73,420" / "980"） */
export function isWellFormedAmount(text: string): boolean {
  const t = toHalfWidth(text).replace(/[\s|]/g, '');
  return /^\d{1,3}(,\d{3})+$/.test(t) || /^\d{1,3}$/.test(t);
}

export interface AmountCandidate { text: string; value: number | null; weight: number; source: string }

/**
 * 合計金額を多数決で決める。表記が正しい（3 桁区切り）読みは加点、小計の最大値より小さい値は除外。
 * support＝勝った値を支持した読みの数、total＝有効な読みの数
 */
export function chooseAmount(cands: AmountCandidate[], maxSubtotal = 0): { amount: number | null; support: number; total: number; alternatives: number[] } {
  const valid = cands.filter((c) => c.value !== null && c.value > 0 && (maxSubtotal === 0 || c.value >= maxSubtotal));
  const pool = valid.length ? valid : cands.filter((c) => c.value !== null && c.value > 0);
  if (pool.length === 0) return { amount: null, support: 0, total: 0, alternatives: [] };
  const score = new Map<number, { s: number; n: number }>();
  for (const c of pool) {
    const cur = score.get(c.value!) ?? { s: 0, n: 0 };
    cur.s += c.weight + (isWellFormedAmount(c.text) ? 0.5 : 0);
    cur.n += 1;
    score.set(c.value!, cur);
  }
  const ranked = [...score.entries()].sort((a, b) => b[1].s - a[1].s || b[0] - a[0]);
  return { amount: ranked[0][0], support: ranked[0][1].n, total: pool.length, alternatives: ranked.slice(1).map((r) => r[0]) };
}

export function parseInvoice(lines: OcrLine[], imgW: number, imgH: number): ParsedInvoice & { daysCandidates: DaysCandidates; maxSubtotal: number; subtotals: number[]; totalLabelFound: boolean; daysConfident: boolean } {
  const { patientNo, patientName, headerRect, patientNoRect } = findPatient(lines, imgH);
  const daysCandidates = findDaysCandidates(lines, imgH);
  const d = chooseDays(daysCandidates);
  const { amount, amountRect, maxSubtotal, subtotals, labelFound } = findAmount(lines, imgW, imgH);
  return { patientNo, patientName, ym: findYm(lines, imgH), days: d.days, daysConfident: d.confident, amount, amountRect, headerRect, patientNoRect, daysRect: daysCandidates.columnRect, daysCandidates, maxSubtotal, subtotals, totalLabelFound: labelFound };
}

/** 数字専用の読み直し結果（"13" や "1 3"）→ 実日数 */
export function parseDaysText(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = toHalfWidth(text).replace(/\s/g, '').match(/\d{1,2}/);
  if (!m) return null;
  const n = Number(m[0]);
  return n >= 0 && n <= 31 ? n : null;
}
