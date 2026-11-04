// スプレッドシートのファイル（Excel .xlsx・CSV）を、このパソコンの中だけで読む（どこにも送らない）。
// 1 枚のシートに表が横に並んでいる店舗のスプレッドシート（月のシート「2027.1」など）から、見出しで表の場所を見つけ、
// 今までの「貼り付けで取り込む」と同じ形（タブ区切りの文字）にして渡す
export interface Sheet { name: string; grid: string[][] }
export type SectionKind = 'karte' | 'churn' | 'mado' | 'henrei';
export interface Section { kind: SectionKind; top: number; header: number; c0: number; c1: number }

// ---------- ZIP（xlsx の中身） ----------
async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const buf = await new Response(new Blob([data as BlobPart]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(buf);
}

async function unzip(buf: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const v = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Excel のファイルとして読めませんでした');
  const n = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  const dec = new TextDecoder();
  for (let i = 0; i < n; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const method = v.getUint16(p + 10, true);
    const csize = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commLen;
    if (!/^xl\/(workbook\.xml|sharedStrings\.xml|worksheets\/[^/]+\.xml|_rels\/workbook\.xml\.rels)$/.test(name)) continue;
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const raw = u8.subarray(start, start + csize);
    out.set(name, method === 8 ? await inflate(raw) : raw.slice());
  }
  return out;
}

const colNum = (ref: string) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

async function readXlsx(buf: ArrayBuffer): Promise<Sheet[]> {
  const files = await unzip(buf);
  const dec = new TextDecoder();
  const xml = (name: string) => { const f = files.get(name); return f ? new DOMParser().parseFromString(dec.decode(f), 'application/xml') : null; };
  const strings: string[] = [];
  const ss = xml('xl/sharedStrings.xml');
  if (ss) for (const si of Array.from(ss.getElementsByTagName('si'))) strings.push(Array.from(si.getElementsByTagName('t')).map((t) => t.textContent ?? '').join(''));
  const rels = new Map<string, string>();
  const rx = xml('xl/_rels/workbook.xml.rels');
  if (rx) for (const r of Array.from(rx.getElementsByTagName('Relationship'))) rels.set(r.getAttribute('Id') ?? '', (r.getAttribute('Target') ?? '').replace(/^\/?(xl\/)?/, 'xl/'));
  const wb = xml('xl/workbook.xml');
  const out: Sheet[] = [];
  for (const s of Array.from(wb?.getElementsByTagName('sheet') ?? [])) {
    const rid = s.getAttribute('r:id') ?? s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ?? '';
    const doc = xml(rels.get(rid) ?? '');
    if (!doc) continue;
    const grid: string[][] = [];
    for (const row of Array.from(doc.getElementsByTagName('row'))) {
      const r = Number(row.getAttribute('r')) - 1;
      if (r < 0 || r > 5000) continue;
      const line: string[] = (grid[r] = grid[r] ?? []);
      for (const c of Array.from(row.getElementsByTagName('c'))) {
        const ci = colNum(c.getAttribute('r') ?? '');
        if (ci < 0 || ci > 400) continue;
        const t = c.getAttribute('t');
        const vv = c.getElementsByTagName('v')[0]?.textContent ?? '';
        let val = t === 's' ? strings[Number(vv)] ?? '' : t === 'inlineStr' ? Array.from(c.getElementsByTagName('t')).map((x) => x.textContent ?? '').join('') : vv;
        if (t === 'e' || /^#(DIV\/0!|REF!|VALUE!|N\/A|NAME\?)$/.test(val)) val = ''; // 計算のエラーは空に
        line[ci] = val;
      }
    }
    for (let i = 0; i < grid.length; i++) grid[i] = grid[i] ?? [];
    out.push({ name: s.getAttribute('name') ?? '', grid });
  }
  return out;
}

/** CSV（Excel の「CSV UTF-8」・Shift_JIS のどちらも） */
function readCsv(buf: ArrayBuffer, name: string): Sheet[] {
  let text = new TextDecoder('utf-8').decode(buf);
  if (text.includes('�')) text = new TextDecoder('shift_jis').decode(buf);
  text = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const grid: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"' && cell === '') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); grid.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); grid.push(row); }
  return [{ name, grid }];
}

export async function readSheetFile(file: File): Promise<Sheet[]> {
  const buf = await file.arrayBuffer();
  if (/\.csv$/i.test(file.name)) return readCsv(buf, file.name.replace(/\.csv$/i, ''));
  if (/\.xlsx$/i.test(file.name)) return readXlsx(buf);
  throw new Error('Excel（.xlsx）か CSV のファイルを選んでください（.xls は Excel で「.xlsx」として保存し直してください）');
}

// ---------- 表の場所を見つける ----------
const norm = (s: string | undefined) => (s ?? '').normalize('NFKC').replace(/[\s　]/g, '');

export function findSection(grid: string[][], kind: SectionKind): Section | null {
  for (let r = 0; r < Math.min(grid.length, 40); r++) {
    const row = grid[r] ?? [];
    const cells = Array.from({ length: row.length }, (_, i) => norm(row[i])); // 空のセル（穴）も '' にする
    const at = (pred: (s: string) => boolean, from = 0) => cells.findIndex((s, i) => i >= from && pred(s));
    if (kind === 'karte') {
      const k = at((s) => s.startsWith('カルテ'));
      if (k < 0 || at((s) => s.includes('氏名'), k) < 0 || at((s) => s.includes('新・再') || s === '新再', k) < 0) continue;
      let c0 = k; while (c0 > 0 && !cells[c0].includes('日付')) c0--;
      if (!cells[c0].includes('日付')) continue;
      let c1 = at((s) => s.includes('アンケート'), k);
      if (c1 < 0) { c1 = k; while (c1 + 1 < cells.length && (cells[c1 + 1] || cells[c1 + 2])) c1++; }
      return { kind, top: Math.max(0, r - 1), header: r, c0, c1 };
    }
    if (kind === 'churn') {
      const c0 = at((s) => s.includes('離反') && s.includes('日付'));
      if (c0 < 0) continue;
      let c1 = at((s) => s === '理由', c0);
      if (c1 < 0) c1 = c0 + 11;
      return { kind, top: r, header: r, c0, c1 };
    }
    if (kind === 'mado') {
      // 上の段：日付・曜日・一部負担金…（下の段に 未収回収・差額 の 一部負担金／自費、報告メール合計・通帳入金額）
      const c0 = cells.findIndex((s, i) => s === '日付' && cells[i + 1] === '曜日' && (cells[i + 2] ?? '').startsWith('一部負担金'));
      if (c0 < 0) continue;
      let c1 = at((s) => s.includes('自賠責請求'), c0);
      if (c1 < 0) c1 = c0 + 21;
      return { kind, top: r, header: r + 1, c0, c1 };
    }
    if (kind === 'henrei') {
      const c0 = at((s) => s === '施術月');
      if (c0 < 0 || at((s) => s.includes('患者'), c0) < 0) continue;
      let c1 = at((s) => s === '理由', c0);
      if (c1 < 0) c1 = c0 + 10;
      return { kind, top: r, header: r, c0, c1 };
    }
  }
  return null;
}

/** 表を、見出しの段（上の段も）＋中身の行のタブ区切りの文字にする。中身は keyCols（列の位置）のどれかが入っている行だけ */
export function sectionText(grid: string[][], s: Section, keyCols?: number[]): string {
  const esc = (v: string) => (/[\t\n"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const slice = (r: number) => Array.from({ length: s.c1 - s.c0 + 1 }, (_, i) => esc(String(grid[r]?.[s.c0 + i] ?? '')));
  const lines: string[][] = [];
  for (let r = s.top; r <= s.header; r++) lines.push(slice(r));
  const keys = keyCols ?? [0];
  for (let r = s.header + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    if (keys.some((k) => String(row[s.c0 + k] ?? '').trim() !== '' && String(row[s.c0 + k]).trim() !== '0')) lines.push(slice(r));
  }
  return lines.map((l) => l.join('\t')).join('\n');
}

/** 見出しの段から、列の名前で何列目かを探す（表の中での位置） */
export function colOf(grid: string[][], s: Section, pred: (name: string) => boolean): number {
  const h = Array.from({ length: s.c1 - s.c0 + 1 }, (_, i) => norm(grid[s.header]?.[s.c0 + i]));
  return h.findIndex(pred);
}
