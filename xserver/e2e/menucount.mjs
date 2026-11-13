// Xserver（PHP）版：メニューの「自賠」「第三者」も人数の内訳に数える（予約表・日報・集計API）と、
// 予約表の上の人数（予約・来院・初診・再来・自賠・新三・キャンセル）がスクロールしても見える（日付の帯と一緒に固定）
// 例：BASE_URL=http://127.0.0.1:3003 CHROMIUM_PATH=... node e2e/menucount.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003', O = new URL('./', import.meta.url).pathname + 'out-';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const p = await br.newPage({ viewport: { width: 1366, height: 800 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
await p.goto(B + '/admin/login/S001'); await p.fill('input[type=password]', 'password'); await p.click('button[type=submit]'); await p.waitForURL(/admin\/day/); await p.waitForLoadState('networkidle');
const api = (m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);
// 今日より前の、同じ月の営業日（日報は「その日までの今月」を数えるため）
let D = null;
for (let i = 1; i < 40 && !D; i++) { const d = new Date(Date.now() + 9 * 3600e3 - i * 864e5).toISOString().slice(0, 10); if ((await api('GET', `/api/admin/day?date=${d}`))[1]?.data?.times?.length) D = d; }
{ const d0 = (await api('GET', `/api/admin/day?date=${D}`))[1].data; await api('PUT', '/api/admin/cells', { date: D, cells: d0.cells.map((x) => ({ time: x.time, bed: x.bed, text: '' })) }); }
await api('PUT', '/api/admin/cells', { date: D, cells: [
  { time: 540, bed: 1, text: '見本 一（初診）' }, { time: 555, bed: 1, text: '上記初診対応' },
  { time: 540, bed: 2, text: '見本 二（初診）' }, { time: 555, bed: 2, text: '上記初診対応' },
  { time: 540, bed: 3, text: '見本 三（再）' },
] });
await api('PUT', '/api/admin/cell-menus', { date: D, time: 540, bed: 1, menus: ['自賠'] });
await api('PUT', '/api/admin/cell-menus', { date: D, time: 540, bed: 2, menus: ['第三者'] });
await api('PUT', '/api/admin/cell-menus', { date: D, time: 540, bed: 3, menus: ['自賠'] });
for (const b of [1, 2, 3]) await api('PUT', '/api/admin/visit', { date: D, time: 540, bed: b, visited: true });

await p.goto(`${B}/admin/day/${D}`); await p.waitForSelector('#grid'); await p.waitForTimeout(800);
const n = async (label) => Number(await p.locator(`[aria-label="${label}の人数"]`).getAttribute('data-all'));
ok('予約表：初診 2・再来 1', (await n('初診')) === 2 && (await n('再来')) === 1);
ok('予約表：メニューの「自賠」も自賠に数える（初診＋再来で 2）', (await n('自賠')) === 2, String(await n('自賠')));
ok('予約表：メニューの「第三者」が付いた初診は新三に数える', (await n('新三')) === 1, String(await n('新三')));
ok('予約表：来院 3', (await n('来院')) === 3);
// 日報
const rep = (await api('GET', `/api/admin/report?date=${D}`))[1];
const v = (id) => rep.items.find((x) => x.id === id)?.value;
ok('日報：新患（自賠）1・自賠 2・新患 0・再来 1（予約表と同じ数え方）', v('new-jibai') === 1 && v('jibai') === 2 && v('new') === 0 && v('revisit') === 1, JSON.stringify([v('new'), v('new-jibai'), v('jibai'), v('revisit')]));

// スクロールしても人数が見える
await p.mouse.wheel(0, 2500); await p.waitForTimeout(600);
const box = await p.locator('[aria-label="この日の人数"]').boundingBox();
const can = await p.locator('[aria-label="キャンセルの人数"]').boundingBox();
ok('スクロールしても人数とキャンセルが画面の上に見える', !!box && box.y >= 0 && box.y < 200 && !!can && can.y < 200, JSON.stringify(box));
ok('人数の帯は 1 行（高さを取らない）', !!box && box.height <= 48, String(box?.height));
await p.screenshot({ path: O + 'sticky-counts.png', clip: { x: 0, y: 0, width: 1366, height: 260 } });
// スマホでも見える
const m = await (await br.newContext({ viewport: { width: 390, height: 800 }, isMobile: true })).newPage();
await m.goto(B + '/admin/login/S001'); await m.fill('input[type=password]', 'password'); await m.click('button[type=submit]'); await m.waitForURL(/admin\/day/);
await m.goto(`${B}/admin/day/${D}`); await m.waitForSelector('#grid'); await m.waitForTimeout(600);
await m.mouse.wheel(0, 2000); await m.waitForTimeout(500);
const mb = await m.locator('[aria-label="この日の人数"]').boundingBox();
ok('スマホ：スクロールしても人数が見える', !!mb && mb.y >= 0 && mb.y < 200 && mb.height <= 90, JSON.stringify(mb));
await m.screenshot({ path: O + 'sticky-counts-mobile.png', clip: { x: 0, y: 0, width: 390, height: 300 } });

ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
console.log(process.exitCode ? 'MENUCOUNT FAILED' : 'MENUCOUNT OK');
