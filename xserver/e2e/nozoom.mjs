// Xserver（PHP）版：患者様のページの入力欄は文字 16px 以上（iPhone で押したときに画面が拡大されて戻らないのを防ぐ）
// 例：BASE_URL=http://127.0.0.1:3003 CHROMIUM_PATH=... node e2e/nozoom.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const cp = await (await br.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
const sizes = () => cp.evaluate(() => [...document.querySelectorAll('main input:not([type=checkbox]):not([type=radio]), main select, main textarea')].map((e) => parseFloat(getComputedStyle(e).fontSize)));
await cp.goto(`${B}/s/S001`); await cp.waitForSelector('table.wk tbody tr', { timeout: 15000 });
await cp.getByRole('button', { name: /ご通院したことがある方/ }).click();
await cp.getByRole('radio', { name: /現在通院中/ }).click(); await cp.waitForTimeout(800);
let slot = cp.locator('td.o button').first();
for (let i = 0; i < 4 && (await slot.count()) === 0; i++) { await cp.getByRole('button', { name: '翌週 ›' }).click(); await cp.waitForTimeout(800); slot = cp.locator('td.o button').first(); }
await slot.click();
await cp.getByRole('button', { name: 'この日時で予約へ進む' }).click(); await cp.waitForSelector('h2');
const s1 = await sizes();
ok('予約の入力欄（診察券番号・氏名・電話番号）は 16px 以上', s1.length >= 3 && s1.every((x) => x >= 16), JSON.stringify(s1));
await cp.goto(`${B}/admin/login`); await cp.fill('input[autocomplete="username"]', 'HQ'); await cp.fill('input[type=password]', process.env.HQ_PASSWORD ?? 'hq-pass'); await cp.click('button[type=submit]'); await cp.waitForURL(/admin\//);
await cp.goto(`${B}/stores?preview=1`); await cp.waitForTimeout(1200);
const s2 = await sizes();
ok('店舗えらびの検索欄も 16px 以上', s2.length >= 1 && s2.every((x) => x >= 16), JSON.stringify(s2));
await br.close();
