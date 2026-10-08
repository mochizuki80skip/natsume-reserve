// Xserver（PHP）版：予約表の自動更新・新しい WEB予約のお知らせ・WEB予約の上書き防止の確認（サンプル店舗 S001 を使う）
// 例：BASE_URL=http://127.0.0.1:3003 CHROMIUM_PATH=... node e2e/live.mjs（30 秒ごとの更新を待つので 1 分ほどかかります）
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const p = await br.newPage({ viewport: { width: 1300, height: 1000 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const D = '2026-10-27';
await p.goto(B + '/admin/login/S001'); await p.fill('input[type=password]', 'password'); await p.click('button[type=submit]'); await p.waitForURL(/admin\/day/);
await p.goto(`${B}/admin/day/${D}`); await p.waitForSelector('#grid');
const cell = (hm, bed) => p.locator('#grid tbody tr').filter({ has: p.locator('td', { hasText: new RegExp(`^(🔒)?${hm}$`) }) }).locator('td.grid-cell').nth(bed - 1).locator('input');
const web = async (time, name, phone) => (await fetch(`${B}/api/public/S001/reserve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'NEW', date: D, time, name, phone }) })).status;
await p.waitForTimeout(1500); // お知らせの最初の確認（基準の時刻）を済ませる
ok('WEB予約（10:00）', await web(600, 'ウェブ 一郎', '09011110001') === 200);
ok('WEB予約（11:00）', await web(660, 'ウェブ 二郎', '09011110002') === 200);

// 画面が古いまま、WEB予約の入ったセルに電話予約を入れる → 保存されない
await cell('10:00', 1).click(); await p.keyboard.type('電話 花子'); await p.keyboard.press('Enter');
await p.waitForSelector('text=先に WEB予約が入っていたため', { timeout: 10000 });
ok('上書きされずにお知らせ', true, (await p.locator('[role=alert]').first().textContent()).slice(0, 60));
ok('セルは WEB予約の表示に戻る', (await cell('10:00', 1).inputValue()) === 'ウェブ 一郎（初診）');
const day = await p.evaluate(async (d) => (await (await fetch(`/api/admin/day?date=${d}`)).json()).data.cells, D);
ok('サーバーの WEB予約は残っている', day.some((c) => c.time === 600 && c.bed === 1 && c.text === 'ウェブ 一郎（初診）'));

// 30 秒以内に、お知らせと自動更新
await p.waitForSelector('text=新しい WEB予約が入りました', { timeout: 40000 });
const toast = await p.locator('[role=status]').allTextContents();
ok('新しい WEB予約のお知らせ（2件）', toast.length === 2 && toast.some((t) => t.includes('ウェブ 二郎')), toast.join(' / '));
await p.waitForFunction(() => [...document.querySelectorAll('#grid input')].some((i) => i.value === 'ウェブ 二郎（初診）'), null, { timeout: 40000 });
ok('予約表が自動で更新される（11:00 のWEB予約が出る）', true);
await p.screenshot({ path: new URL('./out-live.png', import.meta.url).pathname });

// 見えている WEB予約を直すのは今までどおりできる
await cell('11:00', 1).click(); await p.keyboard.press('End'); await p.keyboard.type(' 自賠'); await p.keyboard.press('Enter');
await p.waitForSelector('text=保存しました');
await p.waitForTimeout(500);
const day2 = await p.evaluate(async (d) => (await (await fetch(`/api/admin/day?date=${d}`)).json()).data.cells, D);
ok('見えているWEB予約は直せる', day2.some((c) => c.time === 660 && c.bed === 1 && c.text === 'ウェブ 二郎（初診） 自賠'));
// 空いているセルへの入力も今までどおり
await cell('10:00', 2).click(); await p.keyboard.type('電話 花子'); await p.keyboard.press('Enter');
await p.waitForSelector('text=保存しました');
await p.waitForTimeout(500);
const day3 = await p.evaluate(async (d) => (await (await fetch(`/api/admin/day?date=${d}`)).json()).data.cells, D);
ok('空いているセルに入力できる', day3.some((c) => c.time === 600 && c.bed === 2 && c.text === '電話 花子'));
// 「予約表を開く」
await p.locator('[role=status]').first().getByText('予約表を開く').click();
ok('お知らせから予約表へ', p.url().endsWith(`/admin/day/${D}`) && (await p.locator('[role=status]').count()) === 1);
ok('画面のエラーなし', errs.length === 0, JSON.stringify(errs));
await br.close();
