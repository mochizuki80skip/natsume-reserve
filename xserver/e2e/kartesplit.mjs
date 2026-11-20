// Xserver（PHP）版：新患継続率の継続率を、新患・新自・新三で別々に出す（合算も選べる）
// 例：BASE_URL=http://127.0.0.1:3003 CHROMIUM_PATH=... node e2e/kartesplit.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003', O = new URL('./', import.meta.url).pathname + 'out-';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const errs = [];
const p = await (await br.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
p.on('pageerror', (e) => errs.push(e.message));
await p.goto(`${B}/admin/login/S001`); await p.fill('input[type=password]', 'password'); await p.click('button[type=submit]'); await p.waitForURL((u) => !u.pathname.includes('/login')); await p.waitForLoadState('networkidle');
const api = (m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10), M = today.slice(0, 7);
const d1 = `${M}-01`;
const vis = (n) => Array.from({ length: 5 }, (_, i) => ({ d: i < n ? `${M}-0${i + 2}` : '', s: '', t: '' }));
const add = async (patch) => { const id = (await api('POST', '/api/admin/karte', { date: d1 }))[1].row.id; await api('PATCH', '/api/admin/karte', { id, patch }); };
// 新患 2 人（2 人とも 2 回目あり）、新自 2 人（1 人だけ 2 回目あり）
await add({ kind: 'NEW', name: '見本 新一', visits: vis(2) });
await add({ kind: 'NEW', name: '見本 新二', visits: vis(1) });
await add({ kind: 'ACCIDENT', name: '見本 自一', visits: vis(1) });
await add({ kind: 'ACCIDENT', name: '見本 自二', visits: vis(0) });

// 新患継続率の画面：店舗の継続率
await p.goto(`${B}/admin/karte?month=${M}`); await p.waitForLoadState('networkidle');
const row = async (l) => (await p.getByRole('row', { name: `継続率 ${l}`, exact: true }).locator('td').allTextContents()).map((t) => t.trim());
ok('新患：2名・2回目 100%', (await row('新患'))[1] === '2名' && (await row('新患'))[2].startsWith('100%'), JSON.stringify(await row('新患')));
ok('新自：2名・2回目 50%（新患と別）', (await row('新自'))[1] === '2名' && (await row('新自'))[2].startsWith('50%'), JSON.stringify(await row('新自')));
ok('合算も出る：4名・75%', (await row('新規（合算）'))[1] === '4名' && (await row('新規（合算）'))[2].startsWith('75%'));
await p.screenshot({ path: O + 'karte-split.png', fullPage: true });

// 新患・再来集計（店舗）：件数と継続率
await p.goto(`${B}/admin/karte/summary`); await p.waitForLoadState('networkidle');
const sumRow = async () => (await p.getByRole('row', { name: /^件数と継続率 / }).first().locator('td').allTextContents()).map((t) => t.trim());
let r = await sumRow();
ok('集計：はじめは新患の継続率（2回目 100%）', r.some((t) => t.startsWith('100%')), JSON.stringify(r));
await p.getByRole('button', { name: '新自', exact: true }).click(); await p.waitForTimeout(300);
r = await sumRow();
ok('集計：「新自」を押すと新自の継続率（2回目 50%）', r.some((t) => t.startsWith('50%')) && !r.some((t) => t.startsWith('100%')), JSON.stringify(r));
await p.getByRole('button', { name: '新規（合算）', exact: true }).click(); await p.waitForTimeout(300);
r = await sumRow();
ok('集計：「新規（合算）」は 75%', r.some((t) => t.startsWith('75%')), JSON.stringify(r));
ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
console.log(process.exitCode ? 'KARTESPLIT FAILED' : 'KARTESPLIT OK');
