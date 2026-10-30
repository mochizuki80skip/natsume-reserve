// 定型投稿・投稿文を Excel・CSV・Word・スプレッドシート（貼り付け）とやり取りするときの表の形
import type { Topic } from './sns';
import { download, parseDelimited, readDocx, readXlsx, toTsv, writeCsv, writeDocx, writeXlsx, type DocPara } from './officeFiles';

const WD = ['日', '月', '火', '水', '木', '金', '土'];
const CH: Record<string, string> = { gbp: 'Google', ig: 'Instagram', both: '両方' };

// ---------- 定型投稿 ----------
/** 読み込みに使う列（名前と本文があれば読める）。確認済み・使う・使用回数は保存用で、読み込みでは使わない */
export const TOPIC_HEADER = ['名前', '媒体', '曜日', '月', 'エリア', '店舗', '本文', '確認済み', '使う', '使用回数'];
const TOPIC_WIDTHS = [24, 10, 10, 8, 10, 8, 70, 9, 6, 9];

export function topicRows(topics: Topic[], storeCode: string): string[][] {
  return topics.map((t) => [t.title, CH[t.channel] ?? t.channel, t.weekdays ? t.weekdays.split(',').map((d) => WD[Number(d)]).join('・') : '', t.months, t.areas, t.shared ? '' : storeCode, t.body,
    t.approved ? '済' : '', t.active ? '○' : '×', String(t.useCount)]);
}

/** 定型投稿を保存する。kind：xlsx / csv / docx */
export function saveTopics(kind: 'xlsx' | 'csv' | 'docx', topics: Topic[], storeCode: string, label: string, today: string) {
  const name = `定型投稿_${label}_${today}`;
  const rows = topicRows(topics, storeCode);
  if (kind === 'xlsx') return download(writeXlsx('定型投稿', TOPIC_HEADER, rows, TOPIC_WIDTHS), `${name}.xlsx`);
  if (kind === 'csv') return download(writeCsv(TOPIC_HEADER, rows), `${name}.csv`);
  // Word は取り込みと同じ「名前：」「本文：」の形。直してそのまま読み込める
  const paras: DocPara[] = [{ text: `定型投稿（${label}）`, style: 'title' }, { text: `${today} 保存　${topics.length} 件。この形のまま直して「ファイルから読み込む」で取り込めます（同じ名前・同じ本文のものは二重に登録されません）。`, style: 'small' }];
  for (const r of rows) {
    paras.push({ text: '---' }, { text: `名前：${r[0]}`, style: 'heading' }, { text: `媒体：${r[1]}\n曜日：${r[2]}\n月：${r[3]}\nエリア：${r[4]}\n店舗：${r[5]}` }, { text: '本文：' }, { text: r[6] });
  }
  paras.push({ text: '---' });
  download(writeDocx(paras), `${name}.docx`);
}

/** スプレッドシートに貼り付けられる形 */
export const topicsTsv = (topics: Topic[], storeCode: string) => toTsv(TOPIC_HEADER, topicRows(topics, storeCode));

const COLS: Record<string, string[]> = { 名前: ['名前', 'タイトル', '件名'], 媒体: ['媒体'], 曜日: ['曜日'], 月: ['月'], エリア: ['エリア', '対象エリア'], 店舗: ['店舗', '店舗コード'], 本文: ['本文', '投稿文', '文章'] };

/** 表（1 行目などに見出し）を、取り込みの文章の形（--- 区切りの「名前：」「本文：」）にする。見出しに「本文」が無ければ null */
export function rowsToImportText(rows: string[][]): { text: string; count: number } | null {
  const hi = rows.findIndex((r) => r.some((c) => COLS.本文.includes(c.trim())));
  if (hi < 0) return null;
  const head = rows[hi].map((c) => c.trim());
  const col = (k: string) => head.findIndex((h) => COLS[k].includes(h));
  const idx = Object.fromEntries(Object.keys(COLS).map((k) => [k, col(k)]));
  const blocks: string[] = [];
  for (const r of rows.slice(hi + 1)) {
    const v = (k: string) => (idx[k] >= 0 ? (r[idx[k]] ?? '').trim() : '');
    const body = (idx.本文 >= 0 ? r[idx.本文] ?? '' : '').replace(/\r\n?/g, '\n').trim();
    if (!body) continue;
    // 本文の中の「---」だけの行は区切りと間違えるので、別の線の字にする
    blocks.push(`名前：${v('名前')}\n媒体：${v('媒体')}\n曜日：${v('曜日')}\n月：${v('月')}\nエリア：${v('エリア')}\n店舗：${v('店舗')}\n本文：\n${body.replace(/^\s*[-－ー─―=＝]{3,}\s*$/gmu, (m) => m.replace(/[-－ー─―=＝]/g, '‐'))}`);
  }
  return { text: blocks.map((b) => `---\n${b}`).join('\n') + '\n---', count: blocks.length };
}

/** 貼り付けた文字が、スプレッドシートからコピーした表（タブ区切りで見出しに「本文」）なら取り込みの形にする */
export function normalizePasted(text: string): string {
  const first = text.replace(/^\s+/, '').split('\n')[0] ?? '';
  if (!first.includes('\t')) return text;
  return rowsToImportText(parseDelimited(text, '\t'))?.text ?? text;
}

/** ファイル（Excel・CSV・Word・テキスト）を取り込みの文章にする */
export async function fileToImportText(f: File): Promise<string> {
  const ext = (f.name.split('.').pop() ?? '').toLowerCase();
  if (ext === 'xlsx' || ext === 'xlsm') {
    const sheets = await readXlsx(await f.arrayBuffer());
    for (const s of sheets) { const r = rowsToImportText(s.rows); if (r) return r.text; }
    throw new Error(`${f.name}：見出しに「本文」の列があるシートが見つかりません（1 行目に 名前・媒体・曜日・本文 などの見出しを入れてください）`);
  }
  if (ext === 'xls') throw new Error(`${f.name}：古い形式（.xls）は読めません。Excel で「名前を付けて保存」→「Excel ブック（.xlsx）」にしてください`);
  if (ext === 'doc') throw new Error(`${f.name}：古い形式（.doc）は読めません。Word で「名前を付けて保存」→「Word 文書（.docx）」にしてください`);
  if (ext === 'csv' || ext === 'tsv') {
    const r = rowsToImportText(parseDelimited(await readTextAny(f), ext === 'tsv' ? '\t' : undefined));
    if (!r) throw new Error(`${f.name}：1 行目に「本文」の見出しがありません`);
    return r.text;
  }
  if (ext === 'docx') {
    const d = await readDocx(await f.arrayBuffer());
    for (const t of d.tables) { const r = rowsToImportText(t); if (r) return r.text; }
    return d.text;
  }
  return normalizePasted(await readTextAny(f));
}

/** 文字コードが UTF-8 でなければ Shift_JIS として読む（Excel で保存した CSV） */
async function readTextAny(f: File): Promise<string> {
  const buf = await f.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('shift_jis').decode(buf); }
}

// ---------- 予定の投稿文（店舗ごとに差し込み語が入ったもの） ----------
export interface PostLine { scheduledAt: string; channel: string; status: string; title: string; text: string; storeCode: string; storeName: string; areaGroup: string }
const STATUS: Record<string, string> = { draft: '確認待ち', approved: '承認済み', publishing: '投稿中', posted: '投稿済み', failed: '失敗' };
export const POST_HEADER = ['日付', '曜日', '時刻', 'エリア', '店舗コード', '店舗名', '媒体', '状態', '名前', '投稿文'];
const POST_WIDTHS = [11, 5, 6, 10, 9, 16, 10, 9, 22, 80];
const postRows = (posts: PostLine[]) => posts.map((p) => {
  const d = p.scheduledAt.slice(0, 10);
  return [d, WD[new Date(`${d}T00:00:00`).getDay()], p.scheduledAt.slice(11, 16), p.areaGroup, p.storeCode, p.storeName, CH[p.channel] ?? p.channel, STATUS[p.status] ?? p.status, p.title, p.text];
});

export function savePosts(kind: 'xlsx' | 'csv' | 'docx', posts: PostLine[], label: string) {
  const name = `投稿予定_${label}`;
  const rows = postRows(posts);
  if (kind === 'xlsx') return download(writeXlsx('投稿予定', POST_HEADER, rows, POST_WIDTHS), `${name}.xlsx`);
  if (kind === 'csv') return download(writeCsv(POST_HEADER, rows), `${name}.csv`);
  const paras: DocPara[] = [{ text: `投稿予定（${label}）`, style: 'title' }, { text: `${posts.length} 件。店舗ごとの言葉（エリア・キーワードなど）が入った投稿文です。`, style: 'small' }];
  for (const r of rows) paras.push({ text: `${r[0]}（${r[1]}）${r[2]}　${r[5]}（${r[4]}）`, style: 'heading' }, { text: `${r[3] ? r[3] + '　' : ''}${r[6]}　${r[7]}${r[8] ? '　' + r[8] : ''}`, style: 'small' }, { text: r[9] });
  download(writeDocx(paras), `${name}.docx`);
}
export const postsTsv = (posts: PostLine[]) => toTsv(POST_HEADER, postRows(posts));
