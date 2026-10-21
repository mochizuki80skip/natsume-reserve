// Xserver（PHP）版：電話予約（来院区分・氏名・電話番号）と「予約を探す」（氏名・診察券番号）（サンプル店舗 S001）
// 例：BASE_URL=http://127.0.0.1:3003 CHROMIUM_PATH=... node e2e/phonefind.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003', O = new URL('./', import.meta.url).pathname + 'out-';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const p = await br.newPage({ viewport: { width: 1366, height: 900 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
await p.goto(B + '/admin/login/S001'); await p.fill('input[type=password]', 'password'); await p.click('button[type=submit]'); await p.waitForURL(/admin\/day/);
const api = (m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);
const D = '2026-10-27';
const day = async () => (await api('GET', `/api/admin/day?date=${D}`))[1].data;
const cellOf = (d, t, b) => d.cells.find((x) => x.time === t && x.bed === b);

// 1) 空いたセルを選ぶ → 「電話予約を入れる」
await p.goto(`${B}/admin/day/${D}`); await p.waitForSelector('#grid');
await p.locator('td[data-cell="600:2"] input').click();
await p.getByRole('button', { name: /10:00 ベッド2 に電話予約を入れる/ }).click();
const dlg = p.getByRole('form', { name: '電話予約を入れる' });
await dlg.getByLabel('お名前').fill('電話 一郎様');
await dlg.getByLabel('電話番号').fill('090-1111-2222');
await p.screenshot({ path: O + 'phone-booking.png', clip: { x: 300, y: 0, width: 760, height: 560 } });
await dlg.getByRole('button', { name: '予約表に入れる' }).click();
await p.waitForSelector('text=に電話予約「電話 一郎様」を入れました');
await p.waitForTimeout(800);
let d = await day();
ok('氏名（初診）と 2 枠目が入る（様は外す）', cellOf(d, 600, 2)?.text === '電話 一郎（初診）' && cellOf(d, 615, 2)?.text === '上記初診対応', JSON.stringify([cellOf(d, 600, 2)?.text, cellOf(d, 615, 2)?.text]));
ok('電話番号はセルの文字とは別に保存', cellOf(d, 600, 2)?.phone === '+819011112222' && !cellOf(d, 600, 2).text.includes('090'));
ok('氏名の下に電話番号', (await p.locator('td[data-cell="600:2"]').textContent()).includes('📞090-1111-2222'));
await p.locator('td[data-cell="600:2"]').screenshot({ path: O + 'phone-cell.png' });

// 2) 電話番号の必須・形式
await p.locator('td[data-cell="660:3"] input').click();
await p.getByRole('button', { name: /11:00 ベッド3 に電話予約を入れる/ }).click();
await p.getByRole('form', { name: '電話予約を入れる' }).getByLabel('お名前').fill('番号 なし');
await p.getByRole('form', { name: '電話予約を入れる' }).getByRole('button', { name: '予約表に入れる' }).click();
ok('電話番号なしでは入れない', await p.getByText('電話番号を入れてください').isVisible());
await p.getByRole('button', { name: 'やめる' }).click();

// 3) 通院中は 1 枠・区分の印なし
await p.locator('td[data-cell="690:4"] input').click();
await p.getByRole('button', { name: /11:30 ベッド4 に電話予約を入れる/ }).click();
const d2 = p.getByRole('form', { name: '電話予約を入れる' });
await d2.getByLabel('現在通院中').check(); await d2.getByLabel('お名前').fill('通院 二郎'); await d2.getByLabel('電話番号').fill('０８０２２２２３３３３');
await d2.getByRole('button', { name: '予約表に入れる' }).click(); await p.waitForTimeout(1200);
d = await day();
ok('通院中は 1 枠（全角の番号も OK）', cellOf(d, 690, 4)?.text === '通院 二郎' && !cellOf(d, 705, 4) && cellOf(d, 690, 4)?.phone === '+818022223333', JSON.stringify(cellOf(d, 690, 4)));

// 4) ⋯ → 電話番号を入れる・直す
await p.locator('td[data-cell="600:2"]').hover(); await p.locator('td[data-cell="600:2"] button[aria-label=メニュー]').click();
await p.getByRole('button', { name: '📞 電話番号を入れる・直す' }).click();
const d3 = p.getByRole('form', { name: '電話番号' });
await d3.getByLabel('電話番号').fill('090-9999-8888'); await d3.getByRole('button', { name: '保存' }).click(); await p.waitForTimeout(800);
d = await day();
ok('電話番号を直せる', cellOf(d, 600, 2)?.phone === '+819099998888');

// 5) 時間を動かすと電話番号もついていく／別の人の名前に書き換えると外れる
await api('POST', '/api/admin/move', { date: D, time: 600, bed: 2, toDate: D, toTime: 630, toBed: 5, allowOver: true });
d = await day();
ok('動かすと電話番号もつく', cellOf(d, 630, 5)?.phone === '+819099998888' && cellOf(d, 645, 5)?.text === '上記初診対応');
await api('PUT', '/api/admin/cells', { date: D, cells: [{ time: 690, bed: 4, text: '別の 人' }] });
d = await day();
ok('別の名前に書き換えると電話番号は外れる', cellOf(d, 690, 4)?.text === '別の 人' && !cellOf(d, 690, 4)?.phone);

// 6) 予約を探す：氏名・診察券番号（患者一覧から）・WEB 予約
await api('POST', '/api/admin/patients', { rows: [{ no: '003842', name: '見本 花子', kana: 'ミホン ハナコ' }] });
await api('PUT', '/api/admin/cells', { date: '2026-11-10', cells: [{ time: 600, bed: 1, text: '見本 花子（再来）' }] });
const wb = await api('POST', '/api/public/S001/reserve', { kind: 'RETURN', date: '2026-11-04', time: 600, name: '見本 花子', phone: '070' + String(Date.now()).slice(-8), cardNo: '3842' });
ok('準備：WEB 予約', wb[0] === 200, JSON.stringify(wb[1]).slice(0, 60));
await p.reload(); await p.waitForSelector('#grid');
await p.getByRole('button', { name: '🔍 予約を探す' }).click();
const fd = p.getByRole('dialog', { name: '予約を探す' });
await fd.getByLabel('氏名または診察券番号').fill('3842'); await fd.getByRole('button', { name: '探す' }).click();
await fd.locator('tbody tr').first().waitFor();
const t = await fd.textContent();
ok('診察券番号 → 氏名', t.includes('診察券番号 3842 → 見本 花子'));
ok('WEB 予約も予約表の名前も出る', t.includes('WEB予約') && t.includes('予約表に入力') && (await fd.locator('tbody tr').count()) === 2, t.slice(0, 200));
await p.screenshot({ path: O + 'find.png', clip: { x: 200, y: 0, width: 960, height: 520 } });
await fd.getByLabel('氏名または診察券番号').fill('電話一郎'); await fd.getByRole('button', { name: '探す' }).click();
await p.waitForTimeout(800);
ok('氏名（スペースなしでも）で電話予約が出る', (await fd.textContent()).includes('電話予約') && (await fd.textContent()).includes('090-9999-8888'));
await fd.locator('tbody tr').first().click(); await p.waitForURL(new RegExp(`/admin/day/${D}`));
ok('行を押すとその日の予約表へ', true);
ok('画面のエラーなし', errs.length === 0, JSON.stringify(errs));
await br.close();
