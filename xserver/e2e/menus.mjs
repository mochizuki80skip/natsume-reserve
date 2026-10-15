// Xserver（PHP）版：予約表のメニュー（C案：選んだセルに上の帯のボタンで付ける）の確認（サンプル店舗 S001 を使う）
// 例：BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... CHROMIUM_PATH=... node e2e/menus.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const D = '2027-03-03', D2 = '2027-03-05';
const p = await br.newPage({ viewport: { width: 1300, height: 900 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => { errs.push('dialog:' + d.message()); d.dismiss(); });
await p.goto(`${B}/admin/login/S001`); await p.fill('input[type=password]', 'password'); await p.click('button[type=submit]'); await p.waitForURL(/admin\/day/);
await p.goto(`${B}/admin/day/${D}`); await p.waitForSelector('#grid');
const row = (hm) => p.locator('#grid tbody tr').filter({ has: p.locator('td', { hasText: new RegExp(`^${hm}$`) }) });
const cell = (hm, bed) => row(hm).locator('td.grid-cell').nth(bed - 1);
const bar = p.getByRole('group', { name: '予約のメニュー' });
ok('メニューの帯（未選択の案内）', (await bar.textContent()).includes('名前の入ったセルをクリックすると'));
await cell('9:00', 1).locator('input').click(); await p.keyboard.type('山田 初診'); await p.keyboard.press('Enter'); await p.waitForSelector('text=保存しました');
await cell('9:00', 1).locator('input').click();
const names = (await bar.getByRole('button').allTextContents()).filter((n) => !['新患', '再来', '新自'].includes(n));
ok('9つのメニューが並ぶ（12回目を含む）', names.join(',') === '矯正,2回目,3回目,6回目,12回目,パイオ,テープ,追加メニュー,ワンコイン', names.join(','));
const y0 = (await cell('9:00', 1).boundingBox()).y;
await bar.getByRole('button', { name: 'テープ' }).click();
await bar.getByRole('button', { name: '矯正' }).click();
await p.waitForTimeout(600);
ok('押したボタンが選択状態', await bar.getByRole('button', { name: '矯正' }).getAttribute('aria-pressed') === 'true');
ok('セルに短い印（矯・テ の順）', (await cell('9:00', 1).getByLabel(/^メニュー：/).textContent()) === '矯テ');
ok('セルの位置が動かない（帯は最初からある）', Math.abs((await cell('9:00', 1).boundingBox()).y - y0) < 1);
const h = (await cell('9:00', 1).boundingBox()).height, h2 = (await cell('9:30', 1).boundingBox()).height;
ok('セルの高さが増えない', Math.abs(h - h2) < 1, `${h} / ${h2}`);
ok('メニュー別の人数', (await p.getByRole('table', { name: 'メニュー別の人数' }).locator('tr', { hasText: '合計' }).locator('td').nth(1).textContent()) === '1');
await p.screenshot({ path: new URL('./out-menus.png', import.meta.url).pathname, clip: { x: 0, y: 0, width: 1300, height: 640 } });
// 2 枠目・空のセルを選ぶと案内に戻る
await cell('9:15', 1).locator('input').click();
ok('空のセルでは案内', (await bar.textContent()).includes('名前の入ったセルをクリックすると'));
// 読み直しても残る
await p.reload(); await p.waitForSelector('#grid');
ok('読み直しても残る', (await cell('9:00', 1).getByLabel(/^メニュー：/).textContent()) === '矯テ');
// 外す
await cell('9:00', 1).locator('input').click(); await bar.getByRole('button', { name: 'テープ' }).click(); await p.waitForTimeout(500);
ok('外せる', (await cell('9:00', 1).getByLabel(/^メニュー：/).textContent()) === '矯');
// 移動するとメニューも移る
await cell('9:00', 1).getByLabel('メニュー', { exact: true }).click();
await p.getByText('キャンセル・予約変更…').click();
await p.locator('form[aria-label="キャンセル・予約変更"] input[type=date]').fill(D2);
await p.waitForTimeout(800);
await p.locator('form[aria-label="キャンセル・予約変更"] select').selectOption('600');
await p.getByRole('button', { name: 'この日時に変更する' }).click();
await p.waitForSelector('text=に変更しました');
const j = await p.evaluate(async (d) => (await (await fetch(`/api/admin/day?date=${d}`)).json()).data, D2);
ok('移動先にメニューも移る', j.cells.some((c) => c.time === 600 && c.menus?.join() === '矯正'));
// 印刷に印
await p.goto(`${B}/admin/print/${D2}`); await p.waitForSelector('text=《予約表》');
ok('印刷にメニューの色付きの印', (await p.locator('td', { hasText: '山田 初診' }).locator('span[style*="background"]').first().textContent()) === '矯');
ok('印刷で初診のセルに色', ((await p.locator('td', { hasText: '山田 初診' }).getAttribute('style')) ?? '').includes('background'));
await p.screenshot({ path: new URL('./out-print-color.png', import.meta.url).pathname, clip: { x: 0, y: 0, width: 800, height: 360 } });
// 氏名のないセルには付けられない
const [st] = await p.evaluate(async (d) => { const r = await fetch('/api/admin/cell-menus', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: d, time: 660, bed: 3, menus: ['矯正'] }) }); return [r.status]; }, D);
ok('氏名のないセルには付けられない', st === 404);
// 本部がメニューを追加 → 店舗の帯に出る
const hq = await br.newContext(); const hp = await hq.newPage();
await hp.goto(`${B}/admin/login`); await hp.fill('input[autocomplete="username"]', 'HQ'); await hp.fill('input[type=password]', process.env.HQ_PASSWORD ?? 'hq-pass'); await hp.getByRole('button', { name: 'ログイン' }).click(); await hp.waitForURL(/admin\/day/);
const [hs] = await hp.evaluate(async () => { const r = await fetch('/api/admin/hq/karte/options', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category: 'menu', labels: ['矯正', '2回目', '3回目', '6回目', 'パイオ', 'テープ', '追加メニュー', 'ワンコイン', 'お試し'] }) }); return [r.status]; });
ok('本部がメニューを追加', hs === 200);
await hp.goto(`${B}/admin/hq/karte`); await hp.getByRole('button', { name: '選択肢・エリアの設定' }).click();
ok('本部の設定画面にメニュー欄', !!(await hp.waitForSelector('text=予約表のメニュー（全店共通）', { timeout: 10000 }).catch(() => null)));
await p.goto(`${B}/admin/day/${D2}`); await p.waitForSelector('#grid');
await row('10:00').locator('td.grid-cell input').first().click();
ok('店舗の帯に追加したメニュー', await bar.getByRole('button', { name: 'お試し' }).isVisible());
ok('画面のエラーなし', errs.length === 0, JSON.stringify(errs));
await br.close();
