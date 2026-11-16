// Xserver（PHP）版：予約表の 2 つの不具合の確認（直す前は失敗する）
// A) WEB 予約のセルを「削除」→「元に戻す」で、WEB 予約のつながり・メニュー・来院チェック・2 枠目も戻る
// B) 2 台のパソコンで同じ空いたセルにほぼ同時に別の名前を入れたとき、後の方は保存せず知らせる（黙って上書きしない）
// 例：BASE_URL=http://127.0.0.1:3003 CHROMIUM_PATH=... node e2e/cellsafety.mjs
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003';
const DB = process.env.DB_NAME ?? 'booking';
const sql = (q) => execSync(`mysql -uroot --default-character-set=utf8mb4 -N ${DB}`, { input: q }).toString().trim();
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const errs = [];
async function login() {
  const p = await (await br.newContext({ viewport: { width: 1300, height: 1000 } })).newPage();
  p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  await p.goto(`${B}/admin/login/S001`); await p.fill('input[type=password]', 'password'); await p.click('button[type=submit]'); await p.waitForURL(/admin\/day/); await p.waitForLoadState('networkidle');
  return p;
}
const api = (p, m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);
sql('DELETE FROM rate_limit');
const p = await login();
const D = (() => { const d = new Date(); d.setDate(d.getDate() + 3); for (;;) { const s = d.toISOString().slice(0, 10); if ([1, 2, 3, 5].includes(d.getDay()) && !['2026-11-03', '2026-11-23', '2027-01-01'].includes(s)) return s; d.setDate(d.getDate() + 1); } })();
const day = async () => (await api(p, 'GET', `/api/admin/day?date=${D}`))[1].data;
const cellAt = (d, t, b) => d.cells.find((x) => x.time === t && x.bed === b);
{ const d0 = await day(); await api(p, 'PUT', '/api/admin/cells', { date: D, cells: d0.cells.map((x) => ({ time: x.time, bed: x.bed, text: '' })) }); }

// ---------- A) WEB 予約（初診・2 枠）を削除して元に戻す ----------
const rv = await api(p, 'POST', '/api/public/S001/reserve', { kind: 'NEW', date: D, time: 600, name: '見本 戻す', phone: '09011112222' });
ok('準備：WEB 予約（初診 10:00）', rv[0] === 200, JSON.stringify(rv[1]).slice(0, 80));
let d = await day();
const c0 = d.cells.find((x) => x.time === 600 && x.text.includes('見本 戻す'));
const bed = c0.bed;
await api(p, 'PUT', '/api/admin/cell-menus', { date: D, time: 600, bed, menus: ['自賠'] });
await api(p, 'PUT', '/api/admin/visit', { date: D, time: 600, bed, visited: true });
await p.goto(`${B}/admin/day/${D}`); await p.waitForSelector('#grid'); await p.waitForTimeout(600);
const cell = p.locator(`td[data-cell="600:${bed}"]`);
await cell.hover(); await cell.getByLabel('メニュー', { exact: true }).click();
await p.getByText('削除（入力ミス・名簿に残さない）').click(); await p.waitForTimeout(1500);
d = await day();
ok('削除で氏名と 2 枠目が消え、WEB 予約は取消', !cellAt(d, 600, bed)?.text && !cellAt(d, 615, bed)?.text && sql(`SELECT status FROM reservation WHERE name='見本 戻す'`) === 'CANCELLED');
await p.getByRole('button', { name: /元に戻す/ }).first().click(); await p.waitForTimeout(2000);
d = await day();
const back = cellAt(d, 600, bed);
ok('元に戻すで氏名と 2 枠目が戻る', back?.text?.includes('見本 戻す') && /上記初診/.test(cellAt(d, 615, bed)?.text ?? ''), JSON.stringify([back?.text, cellAt(d, 615, bed)?.text]));
ok('WEB 予約のつながりも戻る（予約は「予約中」）', !!back?.web && sql(`SELECT status FROM reservation WHERE name='見本 戻す'`) === 'BOOKED', JSON.stringify(back?.web ?? null));
ok('2 枠目も WEB 予約につながる', sql(`SELECT COUNT(*) FROM cell WHERE reservationId=(SELECT id FROM reservation WHERE name='見本 戻す')`) === '2');
ok('メニュー（自賠）と来院チェックも戻る', (back?.menus ?? []).includes('自賠') && back?.visited === true, JSON.stringify([back?.menus, back?.visited]));
ok('画面でもメニュー・来院チェックが戻る', (await p.locator(`td[data-cell="600:${bed}"]`).innerText()).includes('自賠') && (await p.locator(`td[data-cell="600:${bed}"]`).getByLabel('来院チェックを外す').count()) === 1);
// 手入力のセルは、消して別の名前を入れても前の情報はつかない
await api(p, 'PUT', '/api/admin/cells', { date: D, cells: [{ time: 540, bed: 4, text: '見本 手入力' }] });
await api(p, 'PUT', '/api/admin/cell-menus', { date: D, time: 540, bed: 4, menus: ['自賠'] });
await api(p, 'PUT', '/api/admin/cells', { date: D, cells: [{ time: 540, bed: 4, text: '' }] });
await api(p, 'PUT', '/api/admin/cells', { date: D, cells: [{ time: 540, bed: 4, text: '見本 別人' }] });
ok('消したあとに別の人を入れても、前の人のメニューはつかない', !(cellAt(await day(), 540, 4)?.menus ?? []).length);

// ---------- B) 2 台のパソコンで同じ空いたセルに入力 ----------
const q = await login();
await p.goto(`${B}/admin/day/${D}`); await q.goto(`${B}/admin/day/${D}`);
await p.waitForSelector('#grid'); await q.waitForSelector('#grid'); await p.waitForTimeout(500);
const inp = (pg) => pg.locator('td[data-cell="660:5"] input').first();
await inp(p).click(); await inp(p).fill('見本 先'); await p.locator('td[data-cell="690:5"] input').first().click(); await p.waitForTimeout(1500);
ok('1 台目の入力は保存', cellAt(await day(), 660, 5)?.text === '見本 先');
await inp(q).click(); await inp(q).fill('見本 後'); await q.locator('td[data-cell="690:5"] input').first().click(); await q.waitForTimeout(1500);
ok('2 台目（古い画面）の入力では上書きしない', cellAt(await day(), 660, 5)?.text === '見本 先');
ok('2 台目に「ほかの端末で先に入力」と知らせる', await q.getByText(/ほかの端末.*先に入力/).isVisible());
ok('2 台目の画面も先の入力に直る', (await inp(q).inputValue()) === '見本 先');
// 同じ人の打ち足しや、自分が入れたセルの書き換えはそのまま保存できる
await inp(p).click(); await inp(p).fill('見本 先（初診）'); await p.locator('td[data-cell="690:5"] input').first().click(); await p.waitForTimeout(1500);
ok('自分の入力の打ち足しは保存', cellAt(await day(), 660, 5)?.text === '見本 先（初診）');
await inp(p).click(); await inp(p).fill('見本 書換'); await p.locator('td[data-cell="690:5"] input').first().click(); await p.waitForTimeout(1500);
ok('自分の入力を別の名前に書き換えるのも保存', cellAt(await day(), 660, 5)?.text === '見本 書換');
ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
console.log(process.exitCode ? 'CELLSAFETY FAILED' : 'CELLSAFETY OK');
