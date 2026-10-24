// Xserver（PHP）版：数字の欄は全角で打っても半角で入る（新患継続率の日付・年齢・カルテNo、自賠請求の金額）（サンプル店舗 S001・見本の名前）
// 例：BASE_URL=http://127.0.0.1:3003 CHROMIUM_PATH=... node e2e/halfwidth.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const p = await br.newPage({ viewport: { width: 1366, height: 900 } });
p.on('dialog', (d) => d.accept());
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const api = (m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);
await p.goto(B + '/admin/login/S001'); await p.fill('input[type=password]', 'password'); await p.click('button[type=submit]'); await p.waitForURL(/admin\/day/);
await api('POST', '/api/admin/karte/import', { rows: [{ date: '2026-06-03', name: '見本 一郎' }] });

await p.goto(`${B}/admin/karte?month=2026-06`); await p.waitForSelector('text=継続の状況');
const d2 = p.getByLabel('2回目 日付').first();
await d2.click(); await p.keyboard.type('６／１０');
ok('打ったそばから半角', (await d2.inputValue()) === '6/10', await d2.inputValue());
await p.keyboard.press('Enter');
const age = p.getByLabel('年齢').first(); await age.click(); await p.keyboard.type('４５'); await p.keyboard.press('Enter');
const no = p.getByLabel('カルテNo').first(); await no.click(); await p.keyboard.type('１２０３ａ'); await p.keyboard.press('Enter');
await p.waitForTimeout(1200);
const r = (await api('GET', '/api/admin/karte?month=2026-06'))[1].rows[0];
ok('2回目の日付・年齢・カルテNo が半角で保存', r.visits[0].d === '2026-06-10' && r.age === 45 && r.karteNo === '1203a', JSON.stringify([r.visits[0].d, r.age, r.karteNo]));
ok('年齢のエラーが出ない', errs.length === 0, errs.join(' / '));

// 自賠請求：金額・実日数
await p.goto(`${B}/admin/jibai`); await p.getByRole('button', { name: /手入力で追加/ }).click();
const amount = p.locator('td input[inputmode="numeric"]').nth(1);
await amount.click(); await p.keyboard.type('１２３４５');
ok('自賠の金額も半角', (await amount.inputValue()) === '12345', await amount.inputValue());
const days = p.locator('td input[inputmode="numeric"]').nth(0);
await days.click(); await p.keyboard.type('３');
ok('自賠の実日数も半角', (await days.inputValue()) === '3', await days.inputValue());
await br.close();
