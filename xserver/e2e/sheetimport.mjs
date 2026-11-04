// Xserver（PHP）版：スプレッドシートのファイル（Excel）から取り込む。店舗のスプレッドシートと同じ並び（1 枚のシートに
// 月間窓口表・新患継続率・離反・返戻が横に並び、見出しは 5・6 行目）の見本の Excel をその場で作り、窓口集計・新患継続率・離反者リストへ取り込む。
// 取り込む前に「新しく入る／上書き／同じ」を見せ、上書きがあるときは最後に確かめる
// 例：BASE_URL=http://127.0.0.1:3003 CHROMIUM_PATH=... node e2e/sheetimport.mjs
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003';
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };

// ---------- 見本の Excel（.xlsx）を作る ----------
const col = (s) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const serial = (iso) => Math.round((Date.UTC(...iso.split('-').map((v, i) => (i === 1 ? Number(v) - 1 : Number(v)))) - Date.UTC(1899, 11, 30)) / 864e5);
function sheetXml(cells) { // cells: { 'BD7': 46296, 'CM7': '見本 一郎', 'X1': { e: '#DIV/0!' } }
  const rows = new Map();
  for (const [ref, v] of Object.entries(cells)) { const r = Number(ref.replace(/[A-Z]+/, '')); if (!rows.has(r)) rows.set(r, []); rows.get(r).push([ref, v]); }
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const body = [...rows.keys()].sort((a, b) => a - b).map((r) => `<row r="${r}">${rows.get(r).sort((a, b) => col(a[0].replace(/\d+/, '')) - col(b[0].replace(/\d+/, ''))).map(([ref, v]) =>
    typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : v && v.e ? `<c r="${ref}" t="e"><v>${v.e}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(files) {
  const parts = [], central = []; let off = 0;
  for (const [name, text] of files) {
    const data = Buffer.from(text, 'utf8'), nm = Buffer.from(name, 'utf8'), crc = crc32(data);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nm.length, 26);
    parts.push(h, nm, data);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nm.length, 28); c.writeUInt32LE(off, 42);
    central.push(c, nm); off += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, e]);
}
const M = '2026-10';
const c = {};
const put = (ref, v) => { c[ref] = v; };
// 月間窓口表（BD〜BY。上の段 5 行目・下の段 6 行目）
for (const [k, v] of Object.entries({ BD: '日付', BE: '曜日', BF: '一部負担金', BG: '第三者', BH: '一部負担金  合計', BI: '自費', BJ: '鍼', BK: '自費+鍼', BL: '合計', BM: '販売', BN: '未収回収', BP: '差額', BR: '不明金', BS: '保証金', BT: '証明書代', BV: '金額を一致させてください', BX: '保険請求 金額', BY: '自賠責請求 金額' })) put(`${k}5`, v);
for (const [k, v] of Object.entries({ BN: '一部負担金', BO: '自費', BP: '一部負担金', BQ: '自費', BT: '一律 4,000円 学校保険は0', BU: '合計', BV: '報告メール 合計', BW: '通帳 入金額' })) put(`${k}6`, v);
for (let d = 1; d <= 31; d++) put(`BD${6 + d}`, serial(`${M}-${String(d).padStart(2, '0')}`)); // 日付は計算で全部の日に入っている
Object.assign(c, { BF7: 25200, BG7: 3000, BH7: 28200, BI7: 23100, BJ7: 1200, BL7: 52500, BM7: 3000, BV7: 55500, BX7: 73646, BF8: 18000, BI8: 5000, BR8: 300, BH9: 0, BU7: { e: '#DIV/0!' } });
// 新患継続率（CJ〜DL。5 行目に 2〜6 回目、6 行目が見出し）
put('CJ5', '初回入力　※初回入力欄はすべて埋めて'); put('CU5', '2回目'); put('CX5', '3回目'); put('DA5', '4回目'); put('DD5', '5回目'); put('DG5', '6回目'); put('DJ5', '予後');
const kh = ['日付', 'カルテNo', 'きっかけ', '氏名', '新・再', '年齢', '性別', '症状カテゴリー', '症状', '担当', '施術内容', '日付', '担当', '施術内容', '日付', '担当', '施術内容', '日付', '担当', '施術内容', '日付', '担当', '施術内容', '日付', '担当', '施術内容', '中止', '転院', 'アンケート'];
const L = (i) => { let n = i + 1, s = ''; while (n) { s = String.fromCharCode(65 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26); } return s; };
kh.forEach((h, i) => put(`${L(col('CJ') + i)}6`, h));
const krow = (r, vals) => vals.forEach((v, i) => { if (v !== '') put(`${L(col('CJ') + i)}${r}`, v); });
krow(7, [serial(`${M}-03`), '2101', 'ママこケアHP', '見本 一郎', '新患', 45, '♂', '腰', '腰痛', '見本A', '矯正', serial(`${M}-06`), '見本A', '矯正']);
krow(8, [serial(`${M}-04`), '2102', 'チラシ', '見本 二子', '新患', 30, '♀', '肩', '肩こり', '見本B', 'マッサージ']);
put('CJ9', serial(`${M}-05`)); // 日付だけの行（氏名なし）は読まない
// 離反（DN〜DY）
['離反した 日付', 'カルテ No.', '患者氏名', '性', '年', '内訳(新・再・既)', '通院 回数', '担当', '症状', '施術内容', '管理 (治癒・転院)', '理由'].forEach((h, i) => put(`${L(col('DN') + i)}6`, h));
[serial(`${M}-12`), '1999', '見本 三郎', '♂', 60, '既存', '既存', '見本A', '膝', 'マッサージ', '', '仕事が忙しい'].forEach((v, i) => { if (v !== '') put(`${L(col('DN') + i)}7`, v); });
// 返戻（GE〜GO）
['施術月', '請求月', '患者様名', '本人／家族', '保険者', '保険者コード', '請求額', '再請求額', '返戻場所', '取／再提/保', '理由'].forEach((h, i) => put(`${L(col('GE') + i)}6`, h));
['2026/8', '2026/9', '見本 返戻', '本人', '見本健保', '06123456', 4200, '', '国保連', '再提', '資格喪失'].forEach((v, i) => { if (v !== '') put(`${L(col('GE') + i)}7`, v); });
const files = [
  ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'],
  ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="2026.10" sheetId="1" r:id="rId1"/><sheet name="入力規則" sheetId="2" r:id="rId2"/></sheets></workbook>'],
  ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>'],
  ['xl/worksheets/sheet1.xml', sheetXml(c)],
  ['xl/worksheets/sheet2.xml', sheetXml({ A1: '来院きっかけ', A2: '紹介家族' })],
];
const XLSX = new URL('./out-sample-sheet.xlsx', import.meta.url).pathname;
writeFileSync(XLSX, zip(files));

// ---------- 取り込む ----------
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const errs = [];
const p = await br.newPage({ viewport: { width: 1366, height: 1000 } }); p.on('pageerror', (e) => errs.push(e.message));
const dialogs = []; p.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
const api = (m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);
await p.goto(`${B}/admin/login/S001`); await p.fill('input[type=password]', 'password'); await p.click('button[type=submit]'); await p.waitForURL(/admin\/day/);

// 1) 窓口集計：10/2 にもう 1,000 円入っている → 上書き
await api('PUT', '/api/admin/madoguchi/day', { date: `${M}-02`, patch: { copay: 1000 } });
await p.goto(`${B}/admin/madoguchi?month=${M}`); await p.waitForSelector('table[aria-label="月間窓口表"]');
await p.getByRole('button', { name: '📋 スプレッドシートから取り込む' }).click();
const md = p.getByRole('form', { name: '窓口集計の取り込み' });
await md.getByLabel('スプレッドシートのファイル').setInputFiles(XLSX); await p.waitForTimeout(1500);
ok('表のあるシート（2026.10）を自動で選ぶ', (await md.textContent()).includes('シート「2026.10」の月間窓口表を読みました'));
const sum = await md.getByLabel('取り込みの結果').textContent();
ok('月間窓口表 2 日・返戻 1 行（新しく入る 2・上書き 1）', sum.includes('月間窓口表 2 日') && sum.includes('返戻 1 行') && sum.includes('新しく入る 2') && sum.includes('上書き 1'), sum);
const t1 = await md.getByRole('table', { name: '月間窓口表の取り込みの確認' }).textContent();
ok('計算の欄（合計・自費＋鍼）は読まず、下の段の見出しも読む', t1.includes('一部負担金 25,200') && t1.includes('報告メール合計 55,500') && t1.includes('保険請求金額 73,646') && !t1.includes('52,500') && !t1.includes('28,200'), t1);
ok('返戻の行（患者様名・請求額）', (await md.getByRole('table', { name: '返戻の取り込みの確認' }).textContent()).includes('見本 返戻'));
await p.screenshot({ path: new URL('./out-sheetimport-mado.png', import.meta.url).pathname });
await md.getByRole('button', { name: /件を取り込む/ }).click(); await p.waitForTimeout(1500);
ok('上書きがあるときは最後に確かめる', dialogs.some((m) => m.includes('上書き') && m.includes('10/2')), JSON.stringify(dialogs));
const m = (await api('GET', `/api/admin/madoguchi?month=${M}`))[1];
const d1 = m.days.find((d) => d.date === `${M}-01`).vals, d2 = m.days.find((d) => d.date === `${M}-02`).vals;
ok('10/1 が入る（計算の欄は入らない）', d1.copay === 25200 && d1.third === 3000 && d1.self === 23100 && d1.acu === 1200 && d1.goods === 3000 && d1.mail === 55500 && d1.insClaim === 73646, JSON.stringify(d1));
ok('10/2 は上書き（不明金も）', d2.copay === 18000 && d2.self === 5000 && d2.unknown === 300, JSON.stringify(d2));
ok('返戻が入る', m.henrei.some((h) => h.patient === '見本 返戻' && h.amount === 4200 && h.action === '再提'), JSON.stringify(m.henrei));
// もう一度同じファイル → 全部「同じ」
await p.getByRole('button', { name: '📋 スプレッドシートから取り込む' }).click();
await md.getByLabel('スプレッドシートのファイル').setInputFiles(XLSX); await p.waitForTimeout(1500);
ok('同じファイルをもう一度読むと「同じ」（取り込むものなし）', (await md.getByLabel('取り込みの結果').textContent()).includes('同じ 3') && await md.getByRole('button', { name: /件を取り込む/ }).isDisabled());
await md.getByRole('button', { name: 'やめる' }).click();

// 2) 新患継続率：ファイルから（きっかけの書き方の違いはそろえる）
await p.goto(`${B}/admin/karte?month=${M}`); await p.waitForTimeout(1500);
await p.getByRole('button', { name: /スプレッドシートから貼り付け/ }).click();
const kd = p.getByRole('form', { name: 'スプレッドシートから貼り付け' });
await kd.getByLabel('スプレッドシートのファイル').setInputFiles(XLSX); await p.waitForTimeout(2000);
ok('新患継続率：氏名のある 2 行が「新しく入る」', (await kd.textContent()).includes('新しく入る 2 件'), (await kd.textContent()).slice(0, 300));
await kd.getByRole('button', { name: /件を取り込む/ }).click(); await p.waitForTimeout(1500);
const kr = (await api('GET', `/api/admin/karte?month=${M}`))[1].rows;
const ichi = kr.find((r) => r.name.includes('一郎'));
ok('新患継続率に入る（ママこケアHP → ママニケアHP・2回目も）', ichi && ichi.trig === 'ママニケアHP' && ichi.karteNo === '2101' && ichi.visits?.[0]?.d === `${M}-06` && kr.some((r) => r.name.includes('二子')), JSON.stringify(ichi && [ichi.trig, ichi.karteNo, ichi.visits?.[0]]));

// 3) 離反者リスト：ファイルから
await p.goto(`${B}/admin/churn?month=${M}`); await p.waitForSelector('table[aria-label="離反者リスト"]');
await p.getByRole('button', { name: /スプレッドシートから貼り付け/ }).click();
const cd = p.getByRole('form', { name: '離反者リストの取り込み' });
await cd.getByLabel('スプレッドシートのファイル').setInputFiles(XLSX); await p.waitForTimeout(2000);
await cd.getByRole('button', { name: /件を取り込む/ }).click(); await p.waitForTimeout(1500);
ok('離反者リストに入る', (await api('GET', `/api/admin/churn?month=${M}`))[1].rows.some((r) => r.name === '見本 三郎' && r.reason === '仕事が忙しい'));

// 4) 窓口集計：貼り付け（見出しなし。スプレッドシートと同じ並び）
await p.goto(`${B}/admin/madoguchi?month=${M}`); await p.waitForSelector('table[aria-label="月間窓口表"]');
await p.getByRole('button', { name: '📋 スプレッドシートから取り込む' }).click();
const tsv = ['2026/10/5', '月', '9000', '', '9000', '2000', '', '2000', '11000', '', '', '', '', '', '', '', '', '', '', '', '', ''].join('\t');
await md.getByLabel('貼り付ける欄').fill(tsv);
await md.getByRole('button', { name: '内容を確認する' }).click(); await p.waitForTimeout(1500);
await md.getByRole('button', { name: /件を取り込む/ }).click(); await p.waitForTimeout(1500);
const d5 = (await api('GET', `/api/admin/madoguchi?month=${M}`))[1].days.find((d) => d.date === `${M}-05`).vals;
ok('見出しなしの貼り付けも読める', d5.copay === 9000 && d5.self === 2000 && d5.total === undefined, JSON.stringify(d5));

ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
console.log(process.exitCode ? 'SHEETIMPORT FAILED' : 'SHEETIMPORT OK');
