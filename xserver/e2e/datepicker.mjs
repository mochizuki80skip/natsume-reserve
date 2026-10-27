// Xserver（PHP）版：予約表の日付カレンダー（月を送っても移動しない・日を押したら移動）と、翌日の連打（押した数だけ進む・表が上下にずれない）
// 例：BASE_URL=http://127.0.0.1:3003 CHROMIUM_PATH=... node e2e/datepicker.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const p = await br.newPage({ viewport: { width: 1366, height: 900 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(`${B}/admin/login/S001`); await p.fill('input[type=password]', 'password'); await p.click('button[type=submit]'); await p.waitForURL(/admin\//); await p.waitForLoadState('networkidle');
await p.goto(`${B}/admin/day/2026-11-02`); await p.waitForSelector('#grid'); await p.waitForTimeout(500);

// カレンダー：月を送っても日付は変わらない
await p.getByRole('button', { name: '日付を選ぶ' }).click();
const cal = p.getByRole('dialog', { name: 'カレンダー' });
ok('カレンダーが開く（今の月）', await cal.getByText('2026年11月').isVisible());
await cal.getByRole('button', { name: '次の月' }).click(); await cal.getByRole('button', { name: '次の月' }).click(); await p.waitForTimeout(400);
ok('次の月を押しても移動しない', p.url().endsWith('/admin/day/2026-11-02') && await cal.getByText('2027年1月').isVisible(), p.url());
await cal.getByRole('button', { name: '前の月' }).click(); await p.waitForTimeout(300);
ok('前の月を押しても移動しない', p.url().endsWith('/admin/day/2026-11-02') && await cal.getByText('2026年12月').isVisible());
await cal.getByRole('button', { name: '2026-12-15' }).click();
await p.waitForURL(/2026-12-15/); await p.waitForSelector('#grid');
ok('日を押すとその日へ移動して閉じる', p.url().endsWith('/admin/day/2026-12-15') && !(await cal.isVisible()));
await p.getByRole('button', { name: '日付を選ぶ' }).click();
await p.keyboard.press('Escape');
ok('Esc で閉じる（移動しない）', !(await cal.isVisible()) && p.url().endsWith('/admin/day/2026-12-15'));

// 翌日の連打：押した数だけ進み、休診日をまたいでもスクロールの位置が変わらない
await p.goto(`${B}/admin/day/2026-11-02`); await p.waitForSelector('#grid'); await p.waitForTimeout(500);
await p.evaluate(() => window.scrollTo(0, 500)); await p.waitForTimeout(300);
const top = () => p.evaluate(() => ({ y: Math.round(scrollY), grid: Math.round(document.querySelector('#grid')?.getBoundingClientRect().top ?? NaN) }));
const before = await top();
for (let i = 0; i < 12; i++) { await p.getByRole('button', { name: /翌日/ }).first().dispatchEvent('click'); await p.waitForTimeout(15); }
await p.waitForTimeout(2500); await p.waitForSelector('#grid');
const after = await top();
ok('翌日を 12 回押すと 12 日進む', p.url().endsWith('/admin/day/2026-11-14'), p.url());
ok('表が上下にずれない（スクロールの位置そのまま）', after.y === before.y && after.grid === before.grid, JSON.stringify({ before, after }));
ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
