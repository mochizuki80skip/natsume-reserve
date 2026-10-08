// Xserver（PHP）版：予約の移動・下のセルに上記初診対応・クリックで全選択の確認（サンプル店舗 S001 を使う）
// 例：BASE_URL=http://127.0.0.1:3003 CHROMIUM_PATH=... node e2e/move.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003', O = new URL('./', import.meta.url).pathname + 'out-';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const p = await br.newPage({ viewport: { width: 1300, height: 1000 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => { errs.push('dialog:' + d.message()); d.dismiss(); });
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
await p.goto(B + '/admin/login/S001'); await p.fill('input[type=password]', 'password'); await p.click('button[type=submit]'); await p.waitForURL(/admin\/day/);
const api = (m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);
const D = '2026-10-20', D2 = '2026-10-21';
// WEB booking at 11:00 (NEW → 2 slots)
const wb = await api('POST', '/api/public/S001/reserve', { kind: 'NEW', date: D, time: 660, name: 'ウェブ 花子', phone: '09012340000' });
ok('WEB予約', wb[0] === 200);
await p.goto(`${B}/admin/day/${D}`); await p.waitForSelector('#grid');
const cell = (t, b) => p.locator('#grid tbody tr').nth(([540,555,570,585,600,615,630,645,660].indexOf(t))).locator('td').nth(b).locator('input');
// 1) hand-entered name + fill below
await cell(600, 1).click(); await p.keyboard.type('手入力 太郎（初診）'); await p.keyboard.press('Tab'); await p.waitForTimeout(800);
await cell(600, 1).hover(); await p.locator('#grid tbody tr').nth(4).locator('td').nth(1).locator('button[aria-label=メニュー]').click();
await p.click('text=下のセルに「上記初診対応」'); await p.waitForTimeout(1200);
ok('下のセルに上記初診対応', (await cell(615, 1).inputValue()) === '上記初診対応');
// 2) select on click
await cell(600, 1).click();
const sel = await p.evaluate(() => { const el = document.activeElement; return [el.selectionStart, el.selectionEnd, el.value.length]; });
ok('クリックで文字を全部選ぶ', sel[0] === 0 && sel[1] === sel[2], JSON.stringify(sel));
// 3) move WEB booking to next day
await p.locator('#grid tbody tr').nth(8).locator('td').nth(1).locator('button[aria-label=メニュー]').click();
await p.click('text=別の日・時間に移動…'); await p.fill('input[type=date] >> nth=-1', D2); await p.waitForTimeout(800);
await p.locator('form:has-text("予約を移動") select').selectOption('600');
await p.screenshot({ path: O + 'move-dialog.png' });
await p.click('button:has-text("移動する")'); await p.waitForSelector('text=に移動しました');
ok('移動元が空く', (await cell(660, 1).inputValue()) === '' && (await cell(675 === 675 ? 660 : 0, 1).inputValue()) === '');
const d2 = (await api('GET', `/api/admin/day?date=${D2}`))[1].data;
const c = d2.cells.filter((x) => x.time === 600 || x.time === 615);
ok('移動先に氏名と2枠目・WEB情報', c.length === 2 && c.some((x) => x.text.includes('ウェブ 花子') && x.web?.phone) && c.some((x) => x.text === '上記初診対応'), JSON.stringify(c.map((x) => x.text)));
const log = (await api('GET', `/api/admin/reservations?from=${D}&to=${D2}&status=all`))[1];
ok('予約ログの日時も移る', JSON.stringify(log).includes(D2), '');
await p.screenshot({ path: O + 'move-toast.png', clip: { x: 0, y: 900, width: 1300, height: 100 } });
// 4) not free
for (let b = 1; b <= 8; b++) await api('PUT', '/api/admin/cells', { date: D2, cells: [{ time: 960, bed: b, text: `満${b}` }] });
const nf = await api('POST', '/api/admin/move', { date: D, time: 600, bed: 1, toDate: D2, toTime: 960 });
ok('空いていないときは通知', nf[0] === 409 && nf[1].error.includes('空いていません'), nf[1]?.error);
const cl = await api('POST', '/api/admin/move', { date: D, time: 600, bed: 1, toDate: '2026-10-22', toTime: 600 });
ok('休診日は移動できない', cl[0] === 409, cl[1]?.error);
// dialog error shown in UI
await p.goto(`${B}/admin/day/${D}`); await p.waitForSelector('#grid');
await p.locator('#grid tbody tr').nth(4).locator('td').nth(1).locator('button[aria-label=メニュー]').click();
await p.click('text=別の日・時間に移動…'); await p.fill('input[type=date] >> nth=-1', D2); await p.waitForTimeout(800);
await p.locator('form:has-text("予約を移動") select').selectOption('960'); await p.click('button:has-text("移動する")'); await p.waitForTimeout(800);
ok('画面に「空いていません」', await p.locator('text=空いていません').count() > 0);
await p.locator('form:has-text("予約を移動")').screenshot({ path: O + 'move-full.png' });
console.log('errors', errs);
await br.close();
