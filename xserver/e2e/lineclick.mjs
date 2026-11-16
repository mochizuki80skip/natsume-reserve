// Xserver（PHP）版：交通事故の相談 LINE のバナーが押された回数（店舗えらびページ・各店舗の予約ページ）を本部で見る。タブのマーク（ファビコン）
// 例：BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... CHROMIUM_PATH=... node e2e/lineclick.mjs
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003';
const DB = process.env.DB_NAME ?? 'booking';
const sql = (q) => execSync(`mysql -uroot --default-character-set=utf8mb4 -N ${DB}`, { input: q }).toString().trim();
const O = new URL('./', import.meta.url).pathname + 'out-';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const errs = [];
sql('DELETE FROM rate_limit'); sql('DELETE FROM line_click');
const ctx = await br.newContext({ viewport: { width: 1200, height: 900 } });
ctx.on('page', (pg) => { if (pg.url().startsWith('https://')) pg.close().catch(() => {}); });
await ctx.route('https://line.example/**', (r) => r.fulfill({ body: 'LINE' }));
const hq = await ctx.newPage(); hq.on('pageerror', (e) => errs.push(e.message));
await hq.goto(`${B}/admin/login`); await hq.fill('input[autocomplete="username"]', 'HQ'); await hq.fill('input[type=password]', process.env.HQ_PASSWORD ?? 'hq-pass'); await hq.click('button[type=submit]'); await hq.waitForURL(/admin\//); await hq.waitForLoadState('networkidle');
const api = (m, u, b) => hq.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);
await api('PUT', '/api/admin/hq/consult-line', { url: 'https://line.example/natsume' });
await api('PUT', '/api/admin/hq/stores-page', { open: true });

const pub = await ctx.newPage(); pub.on('pageerror', (e) => errs.push(e.message));
await pub.goto(`${B}/stores`); await pub.waitForSelector('article');
ok('タブのマーク（ファビコン）はなつめ接骨院のマーク', (await pub.locator('link[rel=icon][type="image/svg+xml"]').getAttribute('href')) === '/brand/favicon.svg' && (await (await fetch(`${B}/brand/favicon.svg`)).text()).includes('<path'));
for (let i = 0; i < 2; i++) { await pub.getByRole('link', { name: /交通事故のご相談はLINEで/ }).click(); await pub.waitForTimeout(500); }
await pub.goto(`${B}/s/S001`); await pub.waitForSelector('table.wk tbody tr', { timeout: 15000 });
await pub.getByRole('navigation', { name: 'お電話・ご相談' }).getByRole('link', { name: /交通事故/ }).click(); await pub.waitForTimeout(800);
ok('数えるのは日・ページ別の回数だけ', sql("SELECT CONCAT(page, ':', storeCode, ':', n) FROM line_click ORDER BY page DESC").split('\n').join(',') === 'stores::2,store:S001:1', sql('SELECT CONCAT(page, storeCode, n) FROM line_click'));
ok('おかしな店舗は数えない', (await (await fetch(`${B}/api/public/line-click`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page: 'store', store: 'NOPE' }) })).status) === 400);
const st = await api('GET', '/api/admin/hq/line-clicks');
const m = st[1].months[0];
ok('本部で月ごとの回数', m.stores === 2 && m.storePages === 1 && m.byStore[0].name === 'サンプル本店', JSON.stringify(m));
const sp = await (await br.newContext()).newPage();
await sp.goto(`${B}/admin/login/S001`); await sp.fill('input[type=password]', 'password'); await sp.click('button[type=submit]'); await sp.waitForURL(/admin\//);
await sp.waitForLoadState('networkidle');
const spSt = await sp.evaluate(async () => (await fetch('/api/admin/hq/line-clicks')).status);
ok('店舗のアカウントでは見られない', spSt === 403, String(spSt));
// 画面
await hq.goto(`${B}/admin/hq`); await hq.waitForLoadState('networkidle');
const g = hq.getByRole('group', { name: 'バナーが押された回数' });
await g.scrollIntoViewIfNeeded();
const row = g.getByRole('row', { name: `${m.month} の回数` });
ok('本部の画面に回数（店舗えらび 2・予約ページ 1・合計 3）', (await row.textContent()).replace(/\s/g, '').includes('213'), await row.textContent());
await row.getByRole('button', { name: '店舗別' }).click();
ok('店舗別も見られる', (await row.textContent()).includes('サンプル本店'));
await g.screenshot({ path: O + 'lineclick.png' });
ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
console.log(process.exitCode ? 'LINECLICK FAILED' : 'LINECLICK OK');
