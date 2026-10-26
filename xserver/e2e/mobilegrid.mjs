// Xserver（PHP）版：スマホの幅（390px）で予約表の 8 ベッドが画面に収まり、氏名が読めること
// 例：BASE_URL=http://127.0.0.1:3003 CHROMIUM_PATH=... node e2e/mobilegrid.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003', O = new URL('./', import.meta.url).pathname + 'out-';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const p = await (await br.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(`${B}/admin/login/S001`); await p.fill('input[type=password]', 'password'); await p.click('button[type=submit]'); await p.waitForURL(/admin\//); await p.waitForLoadState('networkidle');
const D = '2026-11-02';
await p.evaluate(async (d) => fetch('/api/admin/cells', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: d, cells: [{ time: 540, bed: 1, text: '見本 太郎（再）' }, { time: 540, bed: 8, text: '試験 花子' }] }) }), D);
await p.goto(`${B}/admin/day/${D}`); await p.waitForSelector('#grid'); await p.waitForTimeout(500);
const m = await p.evaluate(() => {
  const ths = [...document.querySelectorAll('#grid thead tr:last-child th')];
  return { page: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth, cols: ths.length - 1, last: ths.at(-1).getBoundingClientRect().right, head: ths.at(-1).textContent };
});
ok('8 ベッドが画面の幅に収まる（横にずらさない）', m.cols === 8 && m.last <= m.vw && m.page <= m.vw, JSON.stringify(m));
const row = p.locator('#grid tbody tr').filter({ has: p.locator('td', { hasText: /^9:00$/ }) });
const lab = row.locator('td').nth(1).locator('.cell-label');
ok('氏名が見える（印の（再）は外す）', (await lab.isVisible()) && (await lab.textContent()) === '見本 太郎', await lab.textContent());
const box = await lab.boundingBox();
ok('氏名は 2 行まで折り返す', box.height > 15 && box.height <= 24, String(box.height));
ok('セルの高さは保つ', (await row.boundingBox()).height >= 26, String((await row.boundingBox()).height));
await row.locator('td').nth(1).locator('input').focus();
ok('入力中は入力欄の文字（印もそのまま）', !(await lab.isVisible()) && (await row.locator('td').nth(1).locator('input').inputValue()) === '見本 太郎（再）');
// 開いたらすぐ予約表：上はメニュー（☰）と日付の 1 行・人数の 1 行・「その日の設定」だけ
const gridTop = (await p.locator('#grid').boundingBox()).y;
ok('予約表が最初の画面の上の方に出る', gridTop < 260, String(gridTop));
ok('上のメニューは ☰ を押すまで出ない', !(await p.getByRole('link', { name: 'シフト' }).isVisible()));
await p.getByRole('button', { name: 'メニュー', exact: true }).first().click();
ok('☰ でメニューが開く', await p.getByRole('link', { name: 'シフト' }).isVisible());
await p.getByRole('button', { name: 'メニュー', exact: true }).first().click();
ok('印刷は出さない・元に戻すは出す', !(await p.getByText('印刷／PDF').isVisible()) && (await p.getByTitle(/1 つずつ戻します/).isVisible()));
ok('公開・臨時休業は畳んである', !(await p.getByRole('group', { name: '臨時休業' }).isVisible()));
await p.getByRole('button', { name: /その日の設定/ }).click();
ok('「その日の設定」で開く', await p.getByRole('group', { name: '臨時休業' }).isVisible());
await p.getByRole('button', { name: /その日の設定/ }).click();
await p.getByRole('button', { name: '✕ 閉じる' }).click(); await p.waitForTimeout(200); // 前の確認で選んだセルを閉じる
ok('メニューの欄は、セルを押すまで出ない', !(await p.getByRole('group', { name: '予約のメニュー' }).isVisible()));
await row.locator('td').nth(1).locator('input').click(); await p.waitForTimeout(300);
const sheet = await p.getByRole('group', { name: '予約のメニュー' }).boundingBox();
ok('名前のセルを押すと、画面の下にメニューの欄', sheet && sheet.y + sheet.height >= 840, JSON.stringify(sheet));
await p.getByRole('button', { name: '✕ 閉じる' }).click(); await p.waitForTimeout(200);
ok('閉じるで消える', !(await p.getByRole('group', { name: '予約のメニュー' }).isVisible()));
await p.screenshot({ path: O + 'mobile-grid.png' });
ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
