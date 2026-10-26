// Xserver（PHP）版：予約の移動・下のセルに上記初診対応・クリックで全選択の確認（サンプル店舗 S001 を使う）
// 例：BASE_URL=http://127.0.0.1:3003 CHROMIUM_PATH=... node e2e/move.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003', O = new URL('./', import.meta.url).pathname + 'out-';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const p = await br.newPage({ viewport: { width: 1300, height: 1000 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => { errs.push('dialog:' + d.message()); d.dismiss(); });
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
await p.goto(B + '/admin/login/S001'); await p.fill('input[type=password]', 'password'); await p.click('button[type=submit]'); await p.waitForURL(/admin\/day/);
const api = (m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);
const D = '2026-11-17', D2 = '2026-11-18';
// 先の日に WEB 予約を入れるので、WEB で予約できる日数の制限を外す
{ const s0 = (await api('GET', '/api/admin/settings'))[1].store; await api('PUT', '/api/admin/store', { ...s0, hoursOverride: s0.hoursOverride || null, bookDaysAhead: null }); }
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
await p.click('text=キャンセル・予約変更…'); await p.fill('form[aria-label="キャンセル・予約変更"] input[type=date]', D2); await p.waitForTimeout(800);
await p.locator('form[aria-label="キャンセル・予約変更"] select').selectOption('600');
await p.screenshot({ path: O + 'move-dialog.png' });
await p.click('button:has-text("この日時に変更する")'); await p.waitForSelector('text=に変更しました');
ok('移動元が空く', (await cell(660, 1).inputValue()) === '' && (await cell(675 === 675 ? 660 : 0, 1).inputValue()) === '');
const d2 = (await api('GET', `/api/admin/day?date=${D2}`))[1].data;
const c = d2.cells.filter((x) => x.time === 600 || x.time === 615);
ok('移動先に氏名と2枠目・WEB情報', c.length === 2 && c.some((x) => x.text.includes('ウェブ 花子') && x.web?.phone) && c.some((x) => x.text === '上記初診対応'), JSON.stringify(c.map((x) => x.text)));
const log = (await api('GET', `/api/admin/reservations?from=${D}&to=${D2}&status=all`))[1];
ok('予約ログの日時も移る', JSON.stringify(log).includes(D2), '');
const dd = (await api('GET', `/api/admin/day?date=${D}`))[1].data;
ok('元の日の名簿に「予約変更」と変更先が残る', dd.cancels.some((x) => x.kind === 'CHANGE' && x.nextDate === D2 && x.nextTime === 600 && x.name.includes('ウェブ 花子')), JSON.stringify(dd.cancels));
const back = await api('DELETE', '/api/admin/cancel', { id: dd.cancels.find((x) => x.kind === 'CHANGE')?.id });
ok('予約変更の記録は予約表に戻せない', back[0] === 409);
await p.screenshot({ path: O + 'move-toast.png', clip: { x: 0, y: 900, width: 1300, height: 100 } });
// 4) 予約サイトの枠がいっぱい（施術者の人数ぶん埋まっている）→ 確認なしでは入れない。チェックすれば空いているベッドに入る
const dd2 = (await api('GET', `/api/admin/day?date=${D2}`))[1].data;
const capPm = dd2.capacity.pm, bedsAll = dd2.beds.length;
for (let b = 1; b <= capPm; b++) await api('PUT', '/api/admin/cells', { date: D2, cells: [{ time: 990, bed: b, text: `枠${b}` }, { time: 1005, bed: b, text: `枠${b}` }] });
const ov = await api('POST', '/api/admin/move', { date: D, time: 600, bed: 1, toDate: D2, toTime: 990 });
ok('枠がいっぱいの時間は確認なしでは入らない', ov[0] === 409 && ov[1].error.includes('枠'), `${ov[1]?.error} cap=${capPm} beds=${bedsAll}`);
const slots = (await api('GET', `/api/admin/move-slots?date=${D2}&slots=2&fromDate=${D}&fromTime=600&fromBed=1`))[1].slots;
const s990 = slots.find((x) => x.time === 990);
ok('変更ダイアログ用に枠の残りとベッドの空きを返す', s990 && s990.left === 0 && s990.beds === bedsAll - capPm, JSON.stringify(s990));
// 物理的に全ベッドが埋まっているとき
for (let b = 1; b <= bedsAll; b++) await api('PUT', '/api/admin/cells', { date: D2, cells: [{ time: 960, bed: b, text: `満${b}` }] });
const nf = await api('POST', '/api/admin/move', { date: D, time: 600, bed: 1, toDate: D2, toTime: 960, allowOver: true });
ok('空いていないときは通知', nf[0] === 409 && nf[1].error.includes('空いていません'), nf[1]?.error);
const cl = await api('POST', '/api/admin/move', { date: D, time: 600, bed: 1, toDate: '2026-11-19', toTime: 600 });
ok('休診日は移動できない', cl[0] === 409, cl[1]?.error);
// dialog error shown in UI
await p.goto(`${B}/admin/day/${D}`); await p.waitForSelector('#grid');
await p.locator('#grid tbody tr').nth(4).locator('td').nth(1).locator('button[aria-label=メニュー]').click();
await p.click('text=キャンセル・予約変更…'); await p.fill('form[aria-label="キャンセル・予約変更"] input[type=date]', D2); await p.waitForTimeout(800);
const opt960 = await p.locator('form[aria-label="キャンセル・予約変更"] option[value="960"]').evaluate((o) => [o.disabled, o.textContent]);
ok('ベッドが無い時間は選べない', opt960[0] === true, JSON.stringify(opt960));
await p.locator('form[aria-label="キャンセル・予約変更"] select').selectOption('990'); await p.waitForTimeout(300);
ok('枠がいっぱいの時間は注意とチェック欄が出る', await p.getByText('枠を超えて入れる（').isVisible());
await p.click('button:has-text("この日時に変更する")'); await p.waitForTimeout(500);
ok('チェックしないと変更しない', await p.locator('form[aria-label="キャンセル・予約変更"]').getByText('チェックしてください').count() > 0);
await p.locator('form[aria-label="キャンセル・予約変更"]').screenshot({ path: O + 'move-full.png' });
await p.getByLabel(/枠を超えて入れる/).check();
await p.click('button:has-text("この日時に変更する")'); await p.waitForSelector('text=に変更しました');
const d3 = (await api('GET', `/api/admin/day?date=${D2}`))[1].data;
ok('チェックすると予約サイトに出していないベッドに入る', d3.cells.some((x) => x.time === 990 && x.bed > capPm && x.text.includes('手入力 太郎')));
console.log('errors', errs);
await br.close();
