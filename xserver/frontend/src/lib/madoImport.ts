// 窓口集計：スプレッドシートの「月間窓口表」（日ごとの欄）と「返戻」を読む（純粋関数）。
// 見出しは 2 段（上の段：一部負担金・未収回収・差額…、下の段：一部負担金／自費・報告メール合計・通帳入金額）。計算の欄（合計・自費＋鍼など）は読まない
import { parseSheetDate } from './karteImport';
import { findSection, type Section } from './sheetFile';

export const DAY_LABEL: Record<string, string> = {
  copay: '一部負担金', third: '第三者', self: '自費', acu: '鍼', goods: '物販', colCopay: '未収回収 一部負担金', colSelf: '未収回収 自費',
  diffCopay: '差額 一部負担金', diffSelf: '差額 自費', unknown: '不明金', deposit: '保証金', cert: '証明書代', mail: '報告メール合計', bank: '通帳入金額',
  insClaim: '保険請求金額', jibaiClaim: '自賠責請求金額',
};
export const HENREI_LABEL: Record<string, string> = {
  treatYm: '施術月', claimMonth: '請求月', patient: '患者様名', relation: '本人／家族', insurer: '保険者', insurerCode: '保険者コード',
  amount: '請求額', reamount: '再請求額', place: '返戻場所', action: '取／再提／保', reason: '理由',
};
export interface MadoDay { date: string; vals: Record<string, number> }
export type HenreiRow = Record<string, string | number>;

const norm = (s: string | undefined) => (s ?? '').normalize('NFKC').replace(/[\s　]/g, '');
const num = (s: string | undefined) => { const t = norm(s).replace(/[,円¥]/g, ''); return /^-?\d+(\.\d+)?$/.test(t) ? Math.round(Number(t)) : null; };

/** 上の段・下の段の見出しから、窓口集計の欄の名前（計算の欄・日付以外は null） */
export function madoKeyOf(group: string, sub: string): string | null {
  const g = norm(group), u = norm(sub);
  if (u.includes('報告メール')) return 'mail';
  if (u.includes('通帳')) return 'bank';
  if (g === '日付') return 'date';
  if (g.includes('合計') || u === '合計' || g.includes('+')) return null;
  if (g.includes('保険請求')) return 'insClaim';
  if (g.includes('自賠責請求')) return 'jibaiClaim';
  if (g.includes('未収回収')) return u.includes('自費') ? 'colSelf' : 'colCopay';
  if (g.includes('差額')) return u.includes('自費') ? 'diffSelf' : 'diffCopay';
  if (g.includes('不明金')) return 'unknown';
  if (g.includes('保証金')) return 'deposit';
  if (g.includes('証明書')) return 'cert';
  if (g === '販売' || g.includes('物販')) return 'goods';
  if (g.includes('第三者')) return 'third';
  if (g === '鍼') return 'acu';
  if (g === '自費') return 'self';
  if (g === '一部負担金') return 'copay';
  return null;
}

/** 見出しのない貼り付け：スプレッドシートと同じ並び（日付〜自賠責請求金額の 22 列）として読む */
const SHEET_KEYS: (string | null)[] = ['date', null, 'copay', 'third', null, 'self', 'acu', null, null, 'goods', 'colCopay', 'colSelf', 'diffCopay', 'diffSelf', 'unknown', 'deposit', 'cert', null, 'mail', 'bank', 'insClaim', 'jibaiClaim'];

export function parseMadoGrid(grid: string[][], sec: Section | null, fy: number): { days: MadoDay[]; error?: string } {
  let keys: (string | null)[];
  let from: number, c0: number;
  if (sec) {
    let group = '';
    keys = [];
    for (let c = sec.c0; c <= sec.c1; c++) {
      const top = grid[sec.top]?.[c] ?? '';
      if (top.trim()) group = top;
      keys.push(madoKeyOf(group, sec.header !== sec.top ? grid[sec.header]?.[c] ?? '' : ''));
    }
    from = sec.header + 1; c0 = sec.c0;
  } else {
    keys = SHEET_KEYS; from = 0; c0 = 0;
    if (!grid.some((r) => parseSheetDate(r[0] ?? '', fy))) return { days: [], error: '読めませんでした。月間窓口表の「日付」から「自賠責請求金額」までを、見出しの 2 段もいっしょにコピーしてください。' };
  }
  const di = keys.indexOf('date');
  const days: MadoDay[] = [];
  for (let r = from; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const date = parseSheetDate(String(row[c0 + di] ?? ''), fy);
    if (!date) continue;
    const vals: Record<string, number> = {};
    keys.forEach((k, i) => { if (!k || k === 'date') return; const v = num(row[c0 + i]); if (v !== null && v !== 0) vals[k] = v; });
    if (Object.keys(vals).length) days.push({ date, vals });
  }
  return { days };
}

const ymText = (s: string) => { const t = norm(s); if (/^\d{5}$/.test(t)) { const d = new Date(Date.UTC(1899, 11, 30) + Number(t) * 86400e3); return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}`; } return s.trim(); };
const henreiKeyOf = (h: string) => {
  const n = norm(h);
  if (n === '施術月') return 'treatYm'; if (n === '請求月') return 'claimMonth'; if (n.includes('患者')) return 'patient';
  if (n.includes('本人') || n.includes('家族')) return 'relation'; if (n.includes('保険者コード')) return 'insurerCode'; if (n.includes('保険者')) return 'insurer';
  if (n.includes('再請求')) return 'reamount'; if (n.includes('請求額')) return 'amount'; if (n.includes('返戻場所')) return 'place';
  if (n.includes('取') || n.includes('再提')) return 'action'; if (n === '理由') return 'reason';
  return null;
};

export function parseHenreiGrid(grid: string[][], sec: Section): HenreiRow[] {
  const keys = Array.from({ length: sec.c1 - sec.c0 + 1 }, (_, i) => henreiKeyOf(grid[sec.header]?.[sec.c0 + i] ?? ''));
  const out: HenreiRow[] = [];
  for (let r = sec.header + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const h: HenreiRow = {};
    keys.forEach((k, i) => {
      if (!k) return;
      const v = String(row[sec.c0 + i] ?? '').trim();
      if (!v) return;
      if (k === 'amount' || k === 'reamount') { const n = num(v); if (n !== null) h[k] = n; }
      else h[k] = k === 'treatYm' || k === 'claimMonth' ? ymText(v) : v;
    });
    if (h.patient) out.push(h);
  }
  return out;
}

/** シート（またはタブ区切りの貼り付け）から、月間窓口表と返戻を読む */
export function readMado(grid: string[][], fy: number): { days: MadoDay[]; henrei: HenreiRow[]; error?: string } {
  const m = parseMadoGrid(grid, findSection(grid, 'mado'), fy);
  const hs = findSection(grid, 'henrei');
  return { days: m.days, henrei: hs ? parseHenreiGrid(grid, hs) : [], error: m.days.length || hs ? undefined : m.error };
}
