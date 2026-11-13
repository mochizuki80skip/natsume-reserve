// Xserver（PHP）版：「キャンセル・予約変更」のダイアログで予約を動かしたあとの「元に戻す」（同じ日・別の日）。
// 前は、ダイアログで動かした予約は元に戻すの記録に入らず、元に戻すで 1 つ前の入力（氏名の入力）が戻って、元の場所に氏名が無くなっていた
// 例：BASE_URL=http://127.0.0.1:3003 CHROMIUM_PATH=... node e2e/moveundo.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const p = await br.newPage({ viewport: { width: 1300, height: 1000 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
await p.goto(B + '/admin/login/S001'); await p.fill('input[type=password]', 'password'); await p.click('button[type=submit]'); await p.waitForURL(/admin\/day/);
const api = (m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);
// 営業している日を 2 つ（3 日以上先の月・火・水・金。祝日を除く）
const open = []; { const d = new Date(); d.setDate(d.getDate() + 3); while (open.length < 2) { const s = d.toISOString().slice(0, 10); if ([1, 2, 3, 5].includes(d.getDay()) && !['2026-11-03', '2026-11-23', '2027-01-01'].includes(s)) open.push(s); d.setDate(d.getDate() + 1); } }
const [D, D2] = open;
const day = async (date = D) => (await api('GET', `/api/admin/day?date=${date}`))[1].data;
const textAt = (d, t, b) => d.cells.find((x) => x.time === t && x.bed === b)?.text ?? '';
const input = (t, b) => p.locator(`td[data-cell="${t}:${b}"] input`);
for (const date of open) { const d0 = await day(date); await api('PUT', '/api/admin/cells', { date, cells: d0.cells.map((x) => ({ time: x.time, bed: x.bed, text: '' })) }); }
await p.goto(`${B}/admin/day/${D}`); await p.waitForSelector('#grid'); await p.waitForTimeout(500);

// 画面で氏名を入れる（「元に戻す」の記録に入る）
await input(540, 1).click(); await input(540, 1).fill('見本 移動（初診）'); await input(555, 1).click(); await input(555, 1).fill('上記初診対応'); await input(600, 3).click(); await p.waitForTimeout(1500);
ok('準備：9:00 ベッド1 に 2 枠の予約', textAt(await day(), 540, 1) === '見本 移動（初診）' && textAt(await day(), 555, 1) === '上記初診対応');

async function openChange(t, b) {
  const c = p.locator(`td[data-cell="${t}:${b}"]`);
  await c.hover(); await c.getByLabel('メニュー', { exact: true }).click();
  await p.getByText('キャンセル・予約変更…').click(); await p.waitForTimeout(600);
  return p.getByRole('form', { name: 'キャンセル・予約変更' });
}

// 1) ダイアログで同じ日の 10:30 に変更 → 元に戻す
let dlg = await openChange(540, 1);
await dlg.locator('select').selectOption('630'); await dlg.getByRole('button', { name: 'この日時に変更する' }).click(); await p.waitForTimeout(1500);
let d = await day();
const movedBed = d.cells.find((x) => x.time === 630 && x.text === '見本 移動（初診）')?.bed;
ok('ダイアログで 10:30 に変更', !!movedBed && textAt(d, 540, 1) === '' && textAt(d, 645, movedBed) === '上記初診対応');
await p.getByRole('button', { name: '↶ 元に戻す' }).last().click(); await p.waitForTimeout(1800);
d = await day();
ok('元に戻すで、元の 9:00 ベッド1 に氏名と 2 枠目が戻る（サーバー）', textAt(d, 540, 1) === '見本 移動（初診）' && textAt(d, 555, 1) === '上記初診対応' && textAt(d, 630, movedBed) === '', JSON.stringify(d.cells.map((x) => [x.time, x.bed, x.text])));
ok('画面でも 9:00 ベッド1 に氏名', (await input(540, 1).inputValue()) === '見本 移動（初診）' && (await input(555, 1).inputValue()) === '上記初診対応' && (await input(630, movedBed).inputValue()) === '');
ok('予約変更の記録は消える', !(d.cancels ?? []).some((c) => c.kind === 'CHANGE' && c.name.includes('見本 移動')));

// 2) ダイアログで別の日（D2）に変更 → 元に戻す
dlg = await openChange(540, 1);
await dlg.locator('input[type=date]').fill(D2); await p.waitForTimeout(800);
await dlg.locator('select').selectOption('600'); await dlg.getByRole('button', { name: 'この日時に変更する' }).click(); await p.waitForTimeout(1500);
ok('別の日に変更（元の日は空く）', textAt(await day(), 540, 1) === '' && (await day(D2)).cells.some((x) => x.time === 600 && x.text === '見本 移動（初診）'));
await p.getByRole('button', { name: /元に戻す/ }).first().click(); await p.waitForTimeout(1800);
d = await day();
ok('元に戻すで、別の日から元の 9:00 ベッド1 に戻る', textAt(d, 540, 1) === '見本 移動（初診）' && textAt(d, 555, 1) === '上記初診対応' && !(await day(D2)).cells.some((x) => x.text === '見本 移動（初診）'));
ok('画面でも戻る', (await input(540, 1).inputValue()) === '見本 移動（初診）');

// 3) 元に戻しても、前の入力（氏名を入れたこと）は勝手に戻らない
await p.waitForTimeout(500);
ok('氏名はそのまま（元に戻すで消えない）', textAt(await day(), 540, 1) === '見本 移動（初診）');

ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
console.log(process.exitCode ? 'MOVEUNDO FAILED' : 'MOVEUNDO OK');
