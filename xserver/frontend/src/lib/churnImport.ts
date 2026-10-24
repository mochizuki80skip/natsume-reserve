// 離反者リスト：スプレッドシートからコピーした表を行に直す（見出しの名前で列を見分ける。見出しがなければスプレッドシートと同じ並び）
import { parseSheetDate, parseTsv, sexOf, treatmentOf } from './karteImport';

export interface ChurnImportRow { churnDate: string; cardNo: string; name: string; sex: string; age: number | null; kind: string; visits: string; staff: string; symptom: string; treatment: string; manage: string; reason: string }
export interface ChurnLine { line: number; row?: ChurnImportRow; error?: string }
type F = keyof ChurnImportRow;

/** スプレッドシートの並び（離反した日付・カルテNo.・患者氏名・性・年・内訳・通院回数・担当・症状・施術内容・管理・理由） */
export const CHURN_HEAD: F[] = ['churnDate', 'cardNo', 'name', 'sex', 'age', 'kind', 'visits', 'staff', 'symptom', 'treatment', 'manage', 'reason'];
const norm = (s: string) => s.normalize('NFKC').replace(/[\s　]/g, '');

function fieldOf(h: string): F | null {
  const n = norm(h);
  if (!n) return null;
  if (n.includes('離反') || n.includes('日付')) return 'churnDate';
  if (n.startsWith('カルテ')) return 'cardNo';
  if (n.includes('氏名') || n.includes('名前')) return 'name';
  if (n === '性' || n.includes('性別')) return 'sex';
  if (n === '年' || n.includes('年齢')) return 'age';
  if (n.includes('内訳')) return 'kind';
  if (n.includes('通院')) return 'visits';
  if (n.includes('担当')) return 'staff';
  if (n.includes('症状')) return 'symptom';
  if (n.includes('施術')) return 'treatment';
  if (n.includes('管理')) return 'manage';
  if (n.includes('理由') || n.includes('備考')) return 'reason';
  return null;
}

export function parseChurnSheet(text: string, fy: number): { lines: ChurnLine[]; error?: string } {
  const table = parseTsv(text);
  let hi = table.findIndex((r) => r.some((c) => fieldOf(c) === 'name') && r.some((c) => fieldOf(c) === 'churnDate'));
  let cols: (F | null)[];
  if (hi >= 0) cols = table[hi].map(fieldOf);
  else {
    if (!table.some((r) => (r[0] ?? '').trim() && parseSheetDate(r[0], fy))) return { lines: [], error: '読めませんでした。離反者リストと同じ並び（離反した日付・カルテNo.・患者氏名…）の行をコピーするか、見出しの行もいっしょにコピーしてください。' };
    cols = CHURN_HEAD;
    hi = -1;
  }
  const lines: ChurnLine[] = [];
  for (let i = hi + 1; i < table.length; i++) {
    const cells = table[i];
    const get = (f: F) => { const k = cols.indexOf(f); return k < 0 ? '' : (cells[k] ?? '').trim(); };
    const name = get('name').replace(/[\s　]*様$/, '');
    const card = get('cardNo').replace(/,/g, '');
    if (!name && !card) continue;
    const raw = get('churnDate');
    const d = parseSheetDate(raw, fy);
    if (!d) { lines.push({ line: i + 1, error: raw ? `日付「${raw}」が読めません` : '日付がありません' }); continue; }
    const age = get('age').normalize('NFKC').match(/\d{1,3}/);
    const kind = norm(get('kind'));
    lines.push({
      line: i + 1,
      row: {
        churnDate: d, cardNo: card.slice(0, 20), name: name.slice(0, 40), sex: sexOf(get('sex')), age: age && Number(age[0]) <= 120 ? Number(age[0]) : null,
        kind: kind.startsWith('新') ? '新患' : kind.startsWith('再') ? '再来' : kind.startsWith('既') ? '既存' : kind.slice(0, 10),
        visits: get('visits').normalize('NFKC').replace(/~/g, '〜').slice(0, 10), staff: get('staff').slice(0, 30), symptom: get('symptom').slice(0, 100),
        treatment: treatmentOf(get('treatment')), manage: norm(get('manage')).slice(0, 10), reason: get('reason').slice(0, 200),
      },
    });
  }
  return { lines };
}
