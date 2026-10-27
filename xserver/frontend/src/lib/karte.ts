// 初回カルテ集計の型と計算（純粋関数）
export type KarteKind = 'NEW' | 'ACCIDENT' | 'REVISIT';
export interface KarteVisit { d: string; s: string; t: string }
export interface KarteRow {
  id: string; date: string; auto: boolean; karteNo: string; kind: KarteKind; trig: string; trigDetail: string; name: string; nameOk?: boolean;
  age: number | null; sex: string; symptomCat: string; symptom: string; staff: string; treatment: string; visits: KarteVisit[];
  /** 予後（中止・転院）・アンケート（チェック欄） */
  stopped?: boolean; transferred?: boolean; survey?: boolean;
  /** 新自（交通事故）：事故日・事故内容 */
  accidentDate?: string | null; accidentNote?: string;
}
export interface KarteOptions { trigger: string[]; otherBiz: string[]; campaign: string[]; symptom: string[]; revisitAction: string[]; menu?: string[]; goods?: string[]; partner?: string[] }
/** 内訳が必要なきっかけ → 内訳の選択肢の種類（null は記入のみ） */
export type DetailFor = Record<string, 'otherBiz' | 'campaign' | 'partner' | null>;

export const KIND_LABEL: Record<KarteKind, string> = { NEW: '新患', ACCIDENT: '初自', REVISIT: '再' };
export const KIND_COLOR: Record<KarteKind, string> = { NEW: '#e34948', ACCIDENT: '#eda100', REVISIT: '#2a78d6' };
export const TREATMENTS = ['矯正', 'マッサ'];
export const VISIT_COUNT = 5;

/** 未入力（黄色）にする項目。再の人は、きっかけ（再来アクション）と内訳は空でもよい */
export function missingFields(r: KarteRow, detailFor: DetailFor): Set<string> {
  const m = new Set<string>();
  const req: (keyof KarteRow)[] = ['karteNo', 'name', 'sex', 'symptomCat', 'symptom', 'staff', 'treatment'];
  for (const k of req) if (!String(r[k] ?? '').trim()) m.add(k);
  if (r.age === null) m.add('age');
  if (r.kind !== 'REVISIT') {
    if (!r.trig) m.add('trig');
    if (r.trig in detailFor && !r.trigDetail.trim()) m.add('trigDetail');
  }
  return m;
}

/** "9/5" "09/05" "0905" "9.5" → その行の日付を基準に YYYY-MM-DD（月が戻るときは翌年）。空は ''、読めなければ null */
export function parseMd(input: string, baseDate: string): string | null {
  const s = input.trim().replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[／．\-.]/g, '/');
  if (!s) return '';
  let m: number, d: number;
  const a = s.match(/^(\d{1,2})\/(\d{1,2})$/);
  const b = s.match(/^(\d{2})(\d{2})$/);
  if (a) { m = Number(a[1]); d = Number(a[2]); } else if (b) { m = Number(b[1]); d = Number(b[2]); } else return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  let y = Number(baseDate.slice(0, 4));
  if (m < Number(baseDate.slice(5, 7))) y += 1;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return dt.toISOString().slice(0, 10);
}
export const md = (iso: string) => (iso ? `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}` : '');

/** 継続：初回の人数と、2〜6回目の日付が入っている人数 */
export interface Retention { first: number; reached: number[] }
export function retentionOf(rows: { visits?: KarteVisit[]; reached?: boolean[] }[]): Retention {
  const reached = Array(VISIT_COUNT).fill(0) as number[];
  for (const r of rows) {
    for (let i = 0; i < VISIT_COUNT; i++) if (r.reached ? r.reached[i] : r.visits?.[i]?.d) reached[i]++;
  }
  return { first: rows.length, reached };
}
export const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
export const isNewKind = (k: string) => k === 'NEW' || k === 'ACCIDENT';

/** 事故日の入力："9/18" "0918" → 初診日より前の日（初診日より後になるときは前の年）、"2026/9/18" はそのまま。空は ''、読めなければ null */
export function parseAccidentDate(input: string, firstDate: string): string | null {
  const s = input.trim().replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[／．\-.年月]/g, '/').replace(/日$/, '');
  if (!s) return '';
  const full = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (full) {
    const dt = new Date(Date.UTC(Number(full[1]), Number(full[2]) - 1, Number(full[3])));
    return dt.getUTCMonth() === Number(full[2]) - 1 ? dt.toISOString().slice(0, 10) : null;
  }
  const iso = parseMd(s, firstDate);
  if (!iso) return iso;
  return iso > firstDate ? `${Number(iso.slice(0, 4)) - 1}${iso.slice(4)}` : iso;
}

/** 新自で、事故日・事故内容のどちらかが空 */
export const accidentMissing = (r: KarteRow) => r.kind === 'ACCIDENT' && (!r.accidentDate || !(r.accidentNote ?? '').trim());
