// Xserver（PHP）版：予約表の「本日」・複数セルのコピー／貼り付け・新患／再来／新自・元に戻す・消した入力の履歴・未来院の赤なし・印刷の行の高さ
// 例：BASE_URL=http://127.0.0.1:3003 CHROMIUM_PATH=... node e2e/grid2.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003', O = new URL('./', import.meta.url).pathname + 'out-';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const ctx = await br.newContext({ viewport: { width: 1300, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => { errs.push('dialog:' + d.message()); d.dismiss(); });
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
await p.goto(B + '/admin/login/S001'); await p.fill('input[type=password]', 'password'); await p.click('button[type=submit]'); await p.waitForURL(/admin\/day/);
const api = (m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);
const today = new URL(p.url()).pathname.split('/').pop();
const D = '2026-10-27'; // 火曜
await p.goto(`${B}/admin/day/${D}`); await p.waitForSelector('#grid');
const rowOf = (t) => p.locator('#grid tbody tr').filter({ has: p.locator('td', { hasText: new RegExp(`^${t}$`) }) });
const cell = (t, b) => rowOf(t).locator('td').nth(b).locator('input');

// ① 本日
await p.getByRole('button', { name: '本日', exact: true }).click(); await p.waitForURL(new RegExp(`/admin/day/${today}$`));
ok('「本日」で今日の予約表へ', true);
await p.goto(`${B}/admin/day/${D}`); await p.waitForSelector('#grid');

// ② 複数セルを選んでコピー → 貼り付け
await cell('9:00', 1).click(); await p.keyboard.type('家族 父');
await cell('9:15', 1).click(); await p.keyboard.type('家族 母');
await cell('9:30', 1).click(); await p.keyboard.type('家族 子');
await cell('9:00', 1).click();
await cell('9:30', 1).click({ modifiers: ['Shift'] });
ok('Shift＋クリックで 3 セル選べる', await p.locator('#grid td.bg-indigo-100').count() === 3);
await p.keyboard.press('Control+c');
await cell('10:00', 3).click();
await p.keyboard.press('Control+v'); await p.waitForTimeout(500);
ok('まとめて貼り付け', (await cell('10:00', 3).inputValue()) === '家族 父' && (await cell('10:15', 3).inputValue()) === '家族 母' && (await cell('10:30', 3).inputValue()) === '家族 子');
await p.screenshot({ path: O + 'grid-range.png', clip: { x: 0, y: 380, width: 1300, height: 420 } });
// ⑥ 元に戻す（貼り付けを戻す）
await p.getByRole('button', { name: /元に戻す/ }).click(); await p.waitForTimeout(300);
ok('元に戻すで貼り付けを取り消す', (await cell('10:00', 3).inputValue()) === '' && (await cell('10:30', 3).inputValue()) === '');
// Shift＋矢印 → Delete → Ctrl+Z
await cell('9:00', 1).click(); await p.keyboard.press('Shift+ArrowDown'); await p.keyboard.press('Shift+ArrowDown');
await p.keyboard.press('Delete'); await p.waitForTimeout(300);
ok('選んだセルを Delete でまとめて消す', (await cell('9:00', 1).inputValue()) === '' && (await cell('9:30', 1).inputValue()) === '');
await p.keyboard.press('Control+z'); await p.waitForTimeout(300);
ok('Ctrl+Z で戻る', (await cell('9:00', 1).inputValue()) === '家族 父' && (await cell('9:30', 1).inputValue()) === '家族 子');

// ④ 新患・再来・新自
await cell('11:00', 2).click(); await p.keyboard.type('区分 太郎');
const bar = p.getByRole('group', { name: '予約のメニュー' });
await bar.getByRole('button', { name: '新患', exact: true }).click(); await p.waitForTimeout(300);
ok('新患 → （初診）と下に上記初診対応', (await cell('11:00', 2).inputValue()) === '区分 太郎（初診）' && (await cell('11:15', 2).inputValue()) === '上記初診対応');
await bar.getByRole('button', { name: '再来', exact: true }).click(); await p.waitForTimeout(300);
ok('再来に付け替え', (await cell('11:00', 2).inputValue()) === '区分 太郎（再来）' && (await cell('11:15', 2).inputValue()) === '上記再来対応');
await bar.getByRole('button', { name: '新自', exact: true }).click(); await p.waitForTimeout(800);
ok('新自に付け替え', (await cell('11:00', 2).inputValue()) === '区分 太郎（新自）');
const nums = await p.locator('table[title^="内訳"] tbody').textContent();
ok('新自は初診と自賠に数える', /初診\d*1/.test(nums.replace(/\s/g, '')) && /自賠\d*1/.test(nums.replace(/\s/g, '')), nums);
await bar.getByRole('button', { name: '新自', exact: true }).click(); await p.waitForTimeout(300);
ok('もう一度押すと外れる', (await cell('11:00', 2).inputValue()) === '区分 太郎' && (await cell('11:15', 2).inputValue()) === '');

// ⑥ 消した入力の履歴（サーバー）
await cell('9:00', 1).click(); await p.keyboard.type('上書き 次郎'); await p.keyboard.press('Tab'); await p.waitForTimeout(1200);
const lg = (await api('GET', `/api/admin/cell-log?date=${D}`))[1];
ok('書き換えた入力が履歴に残る', lg.rows.some((r) => r.before === '家族 父' && r.after === '上書き 次郎'), JSON.stringify(lg.rows));
await cell('9:00', 1).click(); await p.keyboard.press('Delete'); await p.keyboard.press('Tab'); await p.waitForTimeout(1200);
await p.reload(); await p.waitForSelector('#grid');
await p.getByText('消した・書き換えた入力の履歴').click(); await p.waitForTimeout(800);
await p.getByRole('row').filter({ hasText: '家族 父' }).filter({ hasText: '上書き 次郎' }).getByRole('button', { name: 'このセルに戻す' }).click(); await p.waitForTimeout(1200);
ok('画面を開き直しても履歴から戻せる', (await cell('9:00', 1).inputValue()) === '家族 父');

// ⑤ 未来院の赤は出さない（過去の日・未チェック）
const past = '2026-10-06';
await api('PUT', '/api/admin/cells', { date: past, cells: [{ time: 540, bed: 1, text: '過去 未チェック' }] });
await p.goto(`${B}/admin/day/${past}`); await p.waitForSelector('#grid');
ok('未来院の赤・タグは出ない', (await p.locator('#grid td.bg-red-100').count()) === 0 && (await p.locator('#grid').getByText('未来院').count()) === 0 && (await p.locator('#grid').getByText('未チェック').count()) >= 1);

// ③ 印刷：A4 1 枚で、行の高さが広がる
const pp = await ctx.newPage();
await pp.goto(`${B}/admin/print/${D}`); await pp.waitForSelector('table');
const rowH = await pp.evaluate(() => document.querySelector('main table tbody tr').getBoundingClientRect().height);
await pp.emulateMedia({ media: 'print' });
const pdf = await pp.pdf({ format: 'A4', preferCSSPageSize: true, printBackground: true });
fs.writeFileSync(O + 'print-a4.pdf', pdf);
const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
ok('印刷は A4 1 枚', pages === 1, `pages=${pages}`);
ok('行の高さが広がる（6mm 以上）', rowH >= 6 * 3.78, `${(rowH / 3.78).toFixed(1)}mm`);
await pp.screenshot({ path: O + 'print-a4.png', fullPage: true });
console.log('errors', errs);
await br.close();
