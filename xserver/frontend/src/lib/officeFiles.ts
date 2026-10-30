// Excel（.xlsx）・Word（.docx）・CSV の読み書き。ライブラリを使わず、ブラウザの中だけで行う（サーバーに送るのは読み取った文章だけ）
// .xlsx / .docx は XML を zip でまとめたもの。読むときは DecompressionStream で展開し、書くときは圧縮しない zip にまとめる

// ---------- zip ----------
const td = new TextDecoder();
const te = new TextEncoder();

/** zip を展開して { パス: 中身 } にする */
export async function readZip(buf: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const v = new DataView(buf);
  const u8 = new Uint8Array(buf);
  // 終端レコード（中央ディレクトリの位置）を後ろから探す
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('ファイルを読めませんでした（Excel・Word のファイルではないようです）');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const method = v.getUint16(p + 10, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = td.decode(u8.subarray(p + 46, p + 46 + nameLen));
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const raw = u8.subarray(start, start + size);
    if (method === 0) out.set(name, raw);
    else if (method === 8) out.set(name, new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(d: Uint8Array): number { let c = 0xffffffff; for (let i = 0; i < d.length; i++) c = CRC_TABLE[(c ^ d[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

/** 圧縮しない zip を作る */
export function writeZip(files: { name: string; text: string }[], type: string): Blob {
  const parts: Uint8Array[] = []; const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = te.encode(f.name), data = te.encode(f.text), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    parts.push(new Uint8Array(h.buffer), name, data);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((a, x) => a + x.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)] as BlobPart[], { type });
}

// ---------- XML ----------
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // XML に入れられない制御文字を外す（改行・タブは残す）
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const xml = (u8: Uint8Array | undefined) => (u8 ? new DOMParser().parseFromString(td.decode(u8), 'application/xml') : null);
const byLocal = (el: Element | Document, name: string) => [...el.getElementsByTagNameNS('*', name)];

// ---------- Excel ----------
/** .xlsx の各シートを表（行 × 列の文字）にする */
export async function readXlsx(buf: ArrayBuffer): Promise<{ name: string; rows: string[][] }[]> {
  const z = await readZip(buf);
  const shared = byLocal(xml(z.get('xl/sharedStrings.xml')) ?? new Document(), 'si').map((si) => byLocal(si, 't').filter((t) => !t.closest('rPh')).map((t) => t.textContent ?? '').join(''));
  const wb = xml(z.get('xl/workbook.xml'));
  const rels = xml(z.get('xl/_rels/workbook.xml.rels'));
  const target = new Map(byLocal(rels ?? new Document(), 'Relationship').map((r) => [r.getAttribute('Id') ?? '', r.getAttribute('Target') ?? '']));
  const sheets = wb ? byLocal(wb, 'sheet').map((s) => ({ name: s.getAttribute('name') ?? '', rid: s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ?? s.getAttribute('r:id') ?? '' })) : [];
  const out: { name: string; rows: string[][] }[] = [];
  for (const s of sheets) {
    const t = (target.get(s.rid) ?? '').replace(/^\/?xl\//, '').replace(/^\//, '');
    const doc = xml(z.get('xl/' + t));
    if (!doc) continue;
    const rows: string[][] = [];
    for (const r of byLocal(doc, 'row')) {
      const ri = Number(r.getAttribute('r') ?? rows.length + 1) - 1;
      const row: string[] = [];
      let ci = 0;
      for (const c of byLocal(r, 'c')) {
        const ref = c.getAttribute('r');
        if (ref) { const m = /^([A-Z]+)/.exec(ref); if (m) ci = [...m[1]].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1; }
        const type = c.getAttribute('t');
        const v = byLocal(c, 'v')[0]?.textContent ?? '';
        row[ci] = type === 's' ? shared[Number(v)] ?? '' : type === 'inlineStr' ? byLocal(c, 't').map((x) => x.textContent ?? '').join('') : v;
        ci++;
      }
      rows[ri] = [...row].map((x) => x ?? '');
    }
    out.push({ name: s.name, rows: [...rows].map((x) => x ?? []) });
  }
  return out;
}

const colName = (i: number) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

/** 表を .xlsx にする（1 行目は太字の見出し、文章の列は折り返し） */
export function writeXlsx(sheetName: string, header: string[], rows: string[][], widths: number[] = []): Blob {
  const cell = (r: number, c: number, v: string, style: number) => `<c r="${colName(c)}${r}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${header.map((_, i) => `<col min="${i + 1}" max="${i + 1}" width="${widths[i] ?? 14}" customWidth="1"/>`).join('')}</cols><sheetData>
<row r="1">${header.map((h, c) => cell(1, c, h, 1)).join('')}</row>
${rows.map((row, i) => `<row r="${i + 2}">${row.map((v, c) => cell(i + 2, c, v ?? '', 2)).join('')}</row>`).join('\n')}
</sheetData><autoFilter ref="A1:${colName(header.length - 1)}${rows.length + 1}"/></worksheet>`;
  const safeName = esc(sheetName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1');
  return writeZip([
    { name: '[Content_Types].xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { name: '_rels/.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${safeName}" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${safeName}'!$A$1:$${colName(header.length - 1)}$${rows.length + 1}</definedName></definedNames></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: 'xl/styles.xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Meiryo UI"/></font><font><b/><sz val="11"/><name val="Meiryo UI"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' },
    { name: 'xl/worksheets/sheet1.xml', text: sheet },
  ], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

// ---------- Word ----------
/** .docx の本文を段落の文字に、表は行 × 列の文字にする */
export async function readDocx(buf: ArrayBuffer): Promise<{ text: string; tables: string[][][] }> {
  const z = await readZip(buf);
  const doc = xml(z.get('word/document.xml'));
  if (!doc) throw new Error('Word のファイルを読めませんでした');
  const paraText = (p: Element) => {
    let s = '';
    const walk = (n: Element) => { for (const c of [...n.children]) { const l = c.localName; if (l === 't') s += c.textContent ?? ''; else if (l === 'tab') s += '\t'; else if (l === 'br' || l === 'cr') s += '\n'; else if (l !== 'rPr' && l !== 'pPr' && l !== 'del' && l !== 'instrText') walk(c); } };
    walk(p);
    return s;
  };
  const body = byLocal(doc, 'body')[0];
  const lines: string[] = []; const tables: string[][][] = [];
  for (const el of body ? [...body.children] : []) {
    if (el.localName === 'p') lines.push(paraText(el));
    else if (el.localName === 'tbl') {
      const rows = [...el.children].filter((r) => r.localName === 'tr').map((tr) => [...tr.children].filter((c) => c.localName === 'tc').map((tc) => [...tc.children].filter((p) => p.localName === 'p').map(paraText).join('\n')));
      tables.push(rows);
      for (const r of rows) lines.push(r.join('\t'));
    }
  }
  return { text: lines.join('\n'), tables };
}

export interface DocPara { text: string; style?: 'title' | 'heading' | 'small' }
/** 段落を .docx にする（改行は段落内の改行に） */
export function writeDocx(paras: DocPara[]): Blob {
  const run = (text: string, rPr: string) => text.split('\n').map((line, i) => `${i ? '<w:r><w:br/></w:r>' : ''}<w:r>${rPr}<w:t xml:space="preserve">${esc(line)}</w:t></w:r>`).join('');
  const p = (x: DocPara) => {
    const rPr = x.style === 'title' ? '<w:rPr><w:b/><w:sz w:val="32"/></w:rPr>' : x.style === 'heading' ? '<w:rPr><w:b/><w:sz w:val="26"/></w:rPr>' : x.style === 'small' ? '<w:rPr><w:color w:val="64748B"/><w:sz w:val="18"/></w:rPr>' : '';
    const pPr = x.style === 'heading' ? '<w:pPr><w:spacing w:before="240"/></w:pPr>' : '';
    return `<w:p>${pPr}${run(x.text, rPr)}</w:p>`;
  };
  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras.map(p).join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  return writeZip([
    { name: '[Content_Types].xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>' },
    { name: '_rels/.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
    { name: 'word/_rels/document.xml.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: 'word/styles.xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Meiryo UI" w:eastAsia="Meiryo UI" w:hAnsi="Meiryo UI"/><w:sz w:val="21"/><w:lang w:val="ja-JP" w:eastAsia="ja-JP"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>' },
    { name: 'word/document.xml', text: docXml },
  ], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}

// ---------- CSV・貼り付けた表 ----------
/** CSV・タブ区切り（スプレッドシートからコピーした表）を行 × 列にする。引用符（"…"）の中の改行・区切りはそのまま */
export function parseDelimited(text: string, sep?: string): string[][] {
  text = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const d = sep ?? ((text.split('\n')[0].match(/\t/g)?.length ?? 0) > 0 ? '\t' : ',');
  const rows: string[][] = []; let row: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; continue; }
    if (ch === '"' && cur === '') q = true;
    else if (ch === d) { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const quote = (v: string, d: string) => (/["\n\r]/.test(v) || v.includes(d) ? `"${v.replace(/"/g, '""')}"` : v);
/** 行 × 列を CSV（Excel で文字化けしないよう BOM つき）にする */
export function writeCsv(header: string[], rows: string[][]): Blob {
  return new Blob(['﻿' + [header, ...rows].map((r) => r.map((v) => quote(v ?? '', ',')).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
}
/** スプレッドシートに貼り付けられるタブ区切りの文字 */
export function toTsv(header: string[], rows: string[][]): string {
  return [header, ...rows].map((r) => r.map((v) => quote(v ?? '', '\t')).join('\t')).join('\n');
}

/** ファイルを保存させる */
export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.style.display = 'none';
  document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(a.href); }, 10000);
}
