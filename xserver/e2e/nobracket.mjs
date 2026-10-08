// Xserver（PHP）版：括弧なしの「初診」「再来」も初診・再来として数える確認（サンプル店舗 S001 を使う）
// 例：BASE_URL=http://127.0.0.1:3003 CHROMIUM_PATH=... node e2e/nobracket.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const p = await br.newPage({ viewport: { width: 1300, height: 1000 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const D = '2026-10-28';
await p.goto(B + '/admin/login/S001'); await p.fill('input[type=password]', 'password'); await p.click('button[type=submit]'); await p.waitForURL(/admin\/day/);
await p.goto(`${B}/admin/day/${D}`); await p.waitForSelector('#grid');
const row = (hm) => p.locator('#grid tbody tr').filter({ has: p.locator('td', { hasText: new RegExp(`^${hm}$`) }) });
const cell = (hm, bed) => row(hm).locator('td.grid-cell').nth(bed - 1);
async function put(hm, bed, text) { await cell(hm, bed).locator('input').click(); await p.keyboard.type(text); await p.keyboard.press('Enter'); await p.waitForSelector('text=保存しました'); }
await put('9:00', 1, '山田 初診');
await put('9:00', 2, '佐藤 再来');
await put('9:00', 3, '初美');
await put('9:30', 1, '鈴木 初自');
const num = async (label) => (await p.locator('table.text-sm').nth(1).locator('tr', { hasText: label }).locator('td').nth(3).textContent()).trim();
ok('初診に数える（山田 初診・鈴木 初自）', await num('初診') === '2', await num('初診'));
ok('再来に数える（佐藤 再来）', await num('再来') === '1');
ok('自賠に数える（鈴木 初自）', await num('自賠') === '1');
// 下のセルに「上記初診対応」→ 人数に数えない
await cell('9:00', 1).getByLabel('メニュー').click();
await p.getByText('下のセルに「上記初診対応」').click();
await p.waitForTimeout(800);
ok('上記初診対応を入れても人数は変わらない', await num('初診') === '2' && (await cell('9:15', 1).locator('input').inputValue()) === '上記初診対応');
// 移動で 2 枠まとめて動く
await cell('9:00', 1).getByLabel('メニュー').click();
await p.getByText('別の日・時間に移動…').click();
ok('括弧なしでも 2 枠ごと移動の扱い', await p.getByText('※2枠ごと移動します').isVisible());
await p.getByRole('button', { name: 'やめる' }).click();
// 来院チェック → 初回カルテ集計に名前だけで入る
await cell('9:00', 1).getByLabel('来院チェック').click();
await cell('9:00', 2).getByLabel('来院チェック').click();
await p.waitForTimeout(800);
await p.goto(`${B}/admin/karte?month=${D.slice(0, 7)}`);
await p.waitForSelector('text=初回カルテ集計');
await p.waitForTimeout(800);
ok('カルテ集計に山田（名前だけ）', (await p.locator('input[value="山田"]').count()) === 1, '');
ok('カルテ集計に佐藤（名前だけ）', (await p.locator('input[value="佐藤"]').count()) === 1, '');
ok('画面のエラーなし', errs.length === 0, JSON.stringify(errs));
await br.close();
