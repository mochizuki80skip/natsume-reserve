// Xserver（PHP）版：予約表の担当者（まとめて付ける・2回目に初回の担当が自動で入る・初回カルテ集計への反映・担当数）とセルの色
// 例：BASE_URL=http://127.0.0.1:3003 CHROMIUM_PATH=... node e2e/staff.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003', O = new URL('./', import.meta.url).pathname + 'out-';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const p = await br.newPage({ viewport: { width: 1400, height: 1000 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => { errs.push('dialog:' + d.message()); d.dismiss(); });
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
await p.goto(B + '/admin/login/S001'); await p.fill('input[type=password]', 'password'); await p.click('button[type=submit]'); await p.waitForURL(/admin\/day/);
const api = (m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);
for (const n of ['望月', '佐藤']) await api('POST', '/api/admin/staff-members', { name: n, role: 'THERAPIST' });
// 望月は「初回を担当する」→ 予約表の色（自動で 1 色目の緑）
const mem = (await api('GET', '/api/admin/settings'))[1].members;
await api('PUT', '/api/admin/staff-members', { id: mem.find((m) => m.name === '望月').id, canFirst: true });
const D1 = '2026-10-06', D2 = '2026-10-13'; // 火曜
// 初回（初診）2 人と、ほかの 1 人
await api('PUT', '/api/admin/cells', { date: D1, cells: [{ time: 540, bed: 1, text: '担当 太郎（初診）' }, { time: 555, bed: 1, text: '上記初診対応' }, { time: 600, bed: 1, text: '担当 花子（再来）' }, { time: 615, bed: 1, text: '上記再来対応' }, { time: 660, bed: 2, text: 'ほか 一郎' }] });
for (const [t, b] of [[540, 1], [600, 1], [660, 2]]) await api('PUT', '/api/admin/visit', { date: D1, time: t, bed: b, visited: true });
await p.goto(`${B}/admin/day/${D1}`); await p.waitForSelector('#grid');
const rowOf = (t) => p.locator('#grid tbody tr').filter({ has: p.locator('td', { hasText: new RegExp(`^${t}$`) }) });
const cell = (t, b) => rowOf(t).locator('td').nth(b);
const bar = p.getByRole('group', { name: '予約のメニュー' });
// 色：初診は薄い赤、来院済みは左に緑の線
ok('初診のセルは赤（担当なしでも）', (await cell('9:00', 1).getAttribute('style') ?? '').includes('252, 165, 165'));
ok('2 枠目も同じ色', (await cell('9:15', 1).getAttribute('style') ?? '').includes('252, 165, 165'));
ok('再来のセルは青', (await cell('10:00', 1).getAttribute('style') ?? '').includes('147, 197, 253'));
// まとめて担当を付ける（9:00〜10:00 のベッド1 を選ぶ → 名前のある 2 件）
await cell('9:00', 1).locator('input').click();
await cell('10:00', 1).locator('input').click({ modifiers: ['Shift'] });
ok('選んだ件数が出る', (await bar.textContent()).includes('2 件'), await bar.textContent());
await bar.getByRole('button', { name: '望月' }).click(); await p.waitForTimeout(800);
ok('担当がセルに出る', (await cell('9:00', 1).textContent()).includes('望月') && (await cell('10:00', 1).textContent()).includes('望月') && !(await cell('9:15', 1).textContent()).includes('望月'));
await cell('11:00', 2).locator('input').click(); await bar.getByRole('button', { name: '佐藤' }).click(); await p.waitForTimeout(800);
await bar.getByRole('button', { name: '矯正' }).click(); await p.waitForTimeout(800);
ok('矯正は黄緑の斜線', (await cell('11:00', 2).getAttribute('style') ?? '').includes('repeating-linear-gradient'));
await p.screenshot({ path: O + 'staff-grid.png', clip: { x: 0, y: 300, width: 1400, height: 520 } });
// 初回カルテ集計に担当が入る
const k = (await api('GET', `/api/admin/karte?month=${D1.slice(0, 7)}`))[1];
const kt = k.rows.find((r) => r.name === '担当 太郎');
ok('初回カルテ集計に担当が自動で入る', kt?.staff === '望月', JSON.stringify(k.rows.map((r) => [r.name, r.staff])));
// 2 回目：メニュー「2回目」を付けると担当が自動で入り、来院チェックで初回カルテ集計の 2 回目に日付が入る
await api('PUT', '/api/admin/cells', { date: D2, cells: [{ time: 540, bed: 1, text: '担当 太郎' }] });
await p.goto(`${B}/admin/day/${D2}`); await p.waitForSelector('#grid');
await cell('9:00', 1).locator('input').click();
await bar.getByRole('button', { name: '2回目', exact: true }).click(); await p.waitForTimeout(800);
ok('2回目を付けると初回の担当が自動で入る', (await cell('9:00', 1).textContent()).includes('望月'));
ok('2回目は初回担当（望月）の色', (await cell('9:00', 1).getAttribute('style') ?? '').includes('187, 247, 208'), await cell('9:00', 1).getAttribute('style'));
ok('回数は数字の印', (await cell('9:00', 1).getByLabel(/^メニュー：/).textContent()) === '2');
ok('凡例に担当の色', (await p.textContent('body')).includes('望月（2・3・6・12回目）'));
await cell('9:00', 1).getByLabel('来院チェック').click(); await p.waitForTimeout(800);
const k2 = (await api('GET', `/api/admin/karte?month=${D1.slice(0, 7)}`))[1].rows.find((r) => r.name === '担当 太郎');
ok('初回カルテ集計の 2 回目に日付と担当が入る', k2?.visits?.[0]?.d === D2 && k2.visits[0].s === '望月', JSON.stringify(k2?.visits?.[0]));
await p.screenshot({ path: O + 'staff-auto.png', clip: { x: 0, y: 300, width: 1400, height: 300 } });
// 担当数
const sc = (await api('GET', `/api/admin/staff-counts?month=${D1.slice(0, 7)}`))[1];
const mo = sc.rows.find((r) => r.staff === '望月'), sa = sc.rows.find((r) => r.staff === '佐藤');
ok('担当数（来院チェック済み）', mo?.total === 3 && mo.new === 1 && mo.revisit === 1 && mo.counts['2回目'] === 1 && sa?.total === 1, JSON.stringify(sc.rows));
ok('2回目到達率の元', mo?.firsts === 2 && mo.reached2 === 1, JSON.stringify(mo));
ok('日ごとの人数', mo?.days?.[D1] === 2 && mo.days[D2] === 1 && sa?.days?.[D1] === 1, JSON.stringify(mo?.days));
await p.goto(`${B}/admin/staff-counts`); await p.waitForSelector('table');
// 今月の画面で、望月の行の「月の合計」が 3、日ごとに 2・1
const row = p.locator('table[aria-label="日ごとの施術人数"] tr').filter({ hasText: '望月' });
const cellsTxt = await row.locator('td').allTextContents();
ok('担当数の画面（日ごと→月の合計）', cellsTxt[0] === '望月' && cellsTxt[1] === '3' && cellsTxt[7] === '2' && cellsTxt[14] === '1', JSON.stringify(cellsTxt));
await p.screenshot({ path: O + 'staff-daily.png', fullPage: true });
console.log('errors', errs);
await br.close();
