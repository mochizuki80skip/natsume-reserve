// 新患継続率：スプレッドシートからコピーした表（タブ区切り）を行に直す（純粋関数）
// 列は見出しの名前で見分ける。2〜6回目は、上の段の「2回目」などの見出し、または 2 つ目以降の「日付」の並びで見分ける
import { VISIT_COUNT, parseMd, type KarteKind, type KarteVisit } from './karte';

export interface ImportRow {
  date: string; karteNo: string; trig: string; trigDetail: string; name: string; kind: KarteKind;
  age: number | null; sex: string; symptomCat: string; symptom: string; staff: string; treatment: string; visits: KarteVisit[];
}
export interface ParsedLine { line: number; row?: ImportRow; error?: string }
export interface ParseResult { lines: ParsedLine[]; columns: string[]; error?: string }

type Field = 'date' | 'karteNo' | 'trig' | 'trigDetail' | 'name' | 'kind' | 'age' | 'sex' | 'symptomCat' | 'symptom' | 'staff' | 'treatment';
type Col = { field: Field; visit?: undefined } | { field: 'd' | 's' | 't'; visit: number };

/** Google スプレッドシート・Excel のコピー（タブ区切り。改行やタブを含むセルは "…" で囲まれる） */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  const t = text.replace(/\r\n?/g, '\n');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const norm = (s: string) => s.normalize('NFKC').replace(/[\s　]/g, '').toLowerCase();

function fieldOf(h: string): Field | 'd' | 's' | 't' | null {
  const n = norm(h).replace(/\d+回目/, '');
  if (!n) return null;
  if (n.includes('日付') || n === '日' || n.includes('来院日')) return 'date';
  if (n.startsWith('カルテ')) return 'karteNo';
  if (n.includes('きっかけ')) return 'trig';
  if (n.includes('内訳')) return 'trigDetail';
  if (n.includes('氏名') || n === '名前' || n === 'お名前') return 'name';
  if (n.includes('新・再') || n === '新再' || n.includes('区分')) return 'kind';
  if (n.includes('年齢')) return 'age';
  if (n.includes('性別')) return 'sex';
  if (n.includes('症状カテ')) return 'symptomCat';
  if (n.includes('症状')) return 'symptom';
  if (n.includes('担当')) return 'staff';
  if (n.includes('施術')) return 'treatment';
  return null;
}

/** 見出しの行（「氏名」と「日付」がある行）から列の意味を決める */
function columnsOf(head: string[], above: string[] | undefined): (Col | null)[] {
  // 上の段（結合セルは先頭だけに文字がある）を右へ引き伸ばして「2回目」などを読む
  let group = '';
  const groups = head.map((_, i) => { const g = above?.[i]?.trim(); if (g) group = g; return group; });
  let visit = 0; // 「日付」が 2 回目以降に出てきたら 2〜6 回目
  let seenDate = false;
  return head.map((h, i) => {
    const f = fieldOf(h);
    const m = norm(h).match(/(\d+)回目/) ?? norm(groups[i]).match(/(\d+)回目/);
    let v = m ? Number(m[1]) : 0;
    if (!m && f === 'date') { if (seenDate) visit = visit ? visit + 1 : 2; seenDate = true; }
    if (!m && visit) v = visit;
    if (v >= 2 && v <= VISIT_COUNT + 1) {
      if (f === 'date' || (m && f === null && norm(h).match(/^\d+回目$/))) return { field: 'd', visit: v };
      if (f === 'staff') return { field: 's', visit: v };
      if (f === 'treatment') return { field: 't', visit: v };
      return null;
    }
    if (v) return null; // 7 回目以降などは読まない
    return f && f !== 'd' && f !== 's' && f !== 't' ? { field: f } : null;
  });
}

/** 年度（4月はじまり）で年のない日付「4/3」を読む。「2026/4/3」「2026-04-03」「4月3日」、シリアル値も読む */
export function parseSheetDate(input: string, fy: number): string | null {
  const s = input.normalize('NFKC').trim().replace(/[.\-年]/g, '/').replace(/月/g, '/').replace(/日/g, '').replace(/\(.\)|（.）/g, '').trim();
  if (!s) return '';
  let y: number, m: number, d: number;
  const full = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  const md = s.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (full) { y = Number(full[1]); m = Number(full[2]); d = Number(full[3]); }
  else if (md) { m = Number(md[1]); d = Number(md[2]); y = m >= 4 ? fy : fy + 1; }
  else if (/^\d{5}$/.test(s) && Number(s) > 40000 && Number(s) < 60000) {
    return new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400e3).toISOString().slice(0, 10);
  } else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (m < 1 || m > 12 || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

export function kindOf(s: string): KarteKind {
  const n = norm(s);
  if (n.includes('自')) return 'ACCIDENT';
  if (n.startsWith('再')) return 'REVISIT';
  return 'NEW';
}
const sexOf = (s: string) => { const n = norm(s); return /^(♂|男|m)/.test(n) ? '♂' : /^(♀|女|f)/.test(n) ? '♀' : ''; };
const treatmentOf = (s: string) => (norm(s).includes('マッサ') ? 'マッサ' : norm(s).includes('矯正') ? '矯正' : '');
const dropSama = (s: string) => s.trim().replace(/[\s　]*様$/, '');

/** 新患継続率の画面（＝スプレッドシート）と同じ列の並び。見出しの行をコピーしなかったときに使う */
export const SCREEN_HEAD = ['日付', 'カルテNo', 'きっかけ', '内訳', '氏名', '新・再', '年齢', '性別', '症状ｶﾃｺﾞﾘｰ', '症状', '担当', '施術', ...Array.from({ length: VISIT_COUNT }, () => ['日付', '担当', '施術']).flat()];
/** 店舗のスプレッドシートの並び（「内訳」の列がなく、6回目の後ろに 予後〔中止・転院〕・アンケート がある） */
export const SHEET_HEAD = ['日付', 'カルテNo', 'きっかけ', '氏名', '新・再', '年齢', '性別', '症状カテゴリー', '症状', '担当', '施術内容', ...Array.from({ length: VISIT_COUNT }, () => ['日付', '担当', '施術内容']).flat(), '中止', '転院', 'アンケート'];

/** 見出しなしのとき、「新・再」（新患・再来など）が何列目にあるかで並びを決める（5 列目＝スプレッドシート、6 列目＝画面） */
function headOf(table: string[][]): string[] {
  const isKind = (s: string | undefined) => /^(新患|新自|初自|初診|再来|再診|新|初|再)$/.test(norm(s ?? ''));
  const at = (k: number) => table.filter((r) => isKind(r[k])).length;
  return at(4) > at(5) ? SHEET_HEAD : SCREEN_HEAD;
}

export function parseSheet(text: string, fy: number): ParseResult {
  const table = parseTsv(text);
  let hi = table.findIndex((r) => r.some((c) => fieldOf(c) === 'name') && r.some((c) => fieldOf(c) === 'date'));
  let cols: (Col | null)[];
  if (hi >= 0) cols = columnsOf(table[hi], hi > 0 ? table[hi - 1] : undefined);
  else {
    // 見出しなし：画面と同じ並びとして読む（1 列目が日付の行があるときだけ）
    if (!table.some((r) => (r[0] ?? '').trim() && parseSheetDate(r[0], fy))) return { lines: [], columns: [], error: '読めませんでした。新患継続率と同じ並び（日付・カルテNo・きっかけ…）の行をコピーするか、見出しの行もいっしょにコピーしてください。' };
    cols = columnsOf(headOf(table), undefined);
    hi = -1;
  }
  const columns = cols.map((c) => (c ? (c.visit ? `${c.visit}回目${{ d: '日付', s: '担当', t: '施術' }[c.field]}` : c.field) : '')).filter(Boolean);
  const lines: ParsedLine[] = [];
  for (let i = hi + 1; i < table.length; i++) {
    const cells = table[i];
    const get = (f: Field) => { const k = cols.findIndex((c) => c && !c.visit && c.field === f); return k < 0 ? '' : (cells[k] ?? '').trim(); };
    const name = dropSama(get('name'));
    const rawDate = get('date');
    if (!name) continue; // 空の行・合計の行・日付だけ先に入れてある行など
    const line = i + 1;
    const date = parseSheetDate(rawDate, fy);
    if (!date) { lines.push({ line, error: rawDate ? `日付「${rawDate}」が読めません` : '日付がありません' }); continue; }
    const visits: KarteVisit[] = Array.from({ length: VISIT_COUNT }, () => ({ d: '', s: '', t: '' }));
    let bad = '';
    cols.forEach((c, k) => {
      if (!c?.visit) return;
      const v = (cells[k] ?? '').trim();
      const x = visits[c.visit - 2];
      if (c.field === 'd') {
        const d = /^\d{4}/.test(v.normalize('NFKC')) ? parseSheetDate(v, fy) : parseMd(v, date);
        if (d === null) bad ||= `${c.visit}回目の日付「${v}」が読めません`; else x.d = d;
      } else if (c.field === 's') x.s = v.slice(0, 30);
      else x.t = treatmentOf(v);
    });
    if (bad) { lines.push({ line, error: bad }); continue; }
    const age = get('age').normalize('NFKC').match(/\d{1,3}/);
    lines.push({
      line,
      row: {
        date, name: name.slice(0, 40), karteNo: get('karteNo').replace(/^(\d{1,3}(?:,\d{3})+)$/, (x) => x.replace(/,/g, '')).slice(0, 20), kind: kindOf(get('kind')),
        trig: get('trig').slice(0, 30), trigDetail: get('trigDetail').slice(0, 60),
        age: age && Number(age[0]) <= 120 ? Number(age[0]) : null, sex: sexOf(get('sex')),
        symptomCat: get('symptomCat').slice(0, 20), symptom: get('symptom').slice(0, 100), staff: get('staff').slice(0, 30), treatment: treatmentOf(get('treatment')),
        visits,
      },
    });
  }
  return { lines, columns };
}
