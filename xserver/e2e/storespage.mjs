// Xserver（PHP）版：店舗えらびページの地域（住所の市・町／本部が決めた見出し）と並び順（管轄エリアの順とは別）
// 例：BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... CHROMIUM_PATH=... node e2e/storespage.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003', O = new URL('./', import.meta.url).pathname + 'out-';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const errs = [];
const hq = await (await br.newContext({ viewport: { width: 1300, height: 1000 } })).newPage();
hq.on('pageerror', (e) => errs.push(e.message)); hq.on('dialog', (d) => d.accept());
await hq.goto(`${B}/admin/login`); await hq.fill('input[autocomplete="username"]', 'HQ'); await hq.fill('input[type=password]', process.env.HQ_PASSWORD ?? 'hq-pass'); await hq.click('button[type=submit]'); await hq.waitForURL(/admin\//); await hq.waitForLoadState('networkidle');
const api = (m, u, b) => hq.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);
await api('PUT', '/api/admin/hq/stores', { code: 'S001', action: 'listing', address: '静岡県静岡市葵区追手町9-6', lat: 34.9756, lng: 138.3828, listed: true });
await api('PUT', '/api/admin/hq/stores', { code: 'S002', action: 'listing', address: '〒418-0047 静岡県富士宮市淀川町1-1', lat: 35.22, lng: 138.62, listed: true });
await api('PUT', '/api/admin/hq/stores-page', { open: true });
const pub = await (await br.newContext({ viewport: { width: 420, height: 900 } })).newPage();
pub.on('pageerror', (e) => errs.push(e.message));
const heads = async () => { await pub.goto(`${B}/stores`); await pub.waitForSelector('article'); return (await pub.locator('main section > h2').allTextContents()).map((s) => s.trim()).filter((s) => !s.startsWith('営業時間')); };
let h = await heads();
ok('郵便番号つきの住所でも富士宮市に分ける', JSON.stringify(h) === JSON.stringify(['静岡市', '富士宮市']), JSON.stringify(h));
// 本部の画面で ↓ を押して並びを変える
await hq.goto(`${B}/admin/hq`); await hq.waitForSelector('text=店舗えらびページ');
await hq.getByRole('button', { name: '店舗えらびの並び：サンプル本店を下に' }).click(); await hq.waitForTimeout(800);
h = await heads();
ok('並びを変えると見出しの順も変わる（富士宮市が先）', JSON.stringify(h) === JSON.stringify(['富士宮市', '静岡市']), JSON.stringify(h));
await hq.reload(); await hq.waitForSelector('text=店舗えらびページ');
ok('本部の表も同じ並び', (await hq.locator('tr', { has: hq.getByLabel('店舗えらびの並び：サンプル駅前院を上に') }).count()) === 1 && await hq.getByLabel('店舗えらびの並び：サンプル駅前院を上に').isDisabled());
// 地域を手で決める
await hq.getByLabel('サンプル本店 の地域').fill('静岡市（葵区）');
await hq.locator('tr', { has: hq.getByLabel('サンプル本店 の地域') }).getByRole('button', { name: '保存' }).click(); await hq.waitForTimeout(800);
h = await heads();
ok('地域を入れるとその見出しになる', h.includes('静岡市（葵区）') && !h.includes('静岡市'), JSON.stringify(h));
await pub.screenshot({ path: O + 'stores-city.png' });
ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
