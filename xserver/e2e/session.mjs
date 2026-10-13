// Xserver（PHP）版：店舗の新患・再来集計（自店舗だけ）と、ログイン切れのときの案内の確認（サンプル店舗 S001/S002 を使う）
// 例：BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... CHROMIUM_PATH=... node e2e/session.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const D = '2027-02-03'; // ほかの確認と重ならない月
async function storeLogin(ctx, code) {
  const p = await ctx.newPage();
  await p.goto(`${B}/admin/login/${code}`); await p.fill('input[type=password]', 'password'); await p.click('button[type=submit]'); await p.waitForURL(/admin\/day/);
  return p;
}
const api = (p, m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);

// S001・S002 で初診を 1 人ずつ来院チェック → カルテに入る
for (const code of ['S001', 'S002']) {
  const ctx = await br.newContext(); const p = await storeLogin(ctx, code);
  await api(p, 'PUT', '/api/admin/cells', { date: D, cells: [{ time: 540, bed: 1, text: `${code}太郎（初診）` }] });
  await api(p, 'PUT', '/api/admin/visit', { date: D, time: 540, bed: 1, visited: true });
  await api(p, 'GET', `/api/admin/karte?month=${D.slice(0, 7)}`);
  await ctx.close();
}
const ctx = await br.newContext();
const p = await storeLogin(ctx, 'S001');
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const [st, j] = await api(p, 'GET', `/api/admin/hq/karte?from=${D.slice(0, 7)}-01&to=${D.slice(0, 7)}-28`);
ok('店舗は自店舗の行だけ受け取る', st === 200 && j.rows.length === 1 && j.rows[0].store === 'S001' && j.stores.length === 1 && j.areas.length === 0, `${st} rows=${j?.rows?.length}`);
const [st2] = await api(p, 'PUT', '/api/admin/hq/karte/options', { category: 'trigger', labels: ['x'] });
ok('店舗は選択肢を変えられない', st2 === 403, String(st2));
await p.getByRole('link', { name: '新患・再来集計' }).click();
await p.waitForSelector('text=新患・再来 集計（サンプル本店）');
await p.locator('button', { hasText: '‹' }).first().click(); await p.locator('button', { hasText: '›' }).first().click();
await p.waitForTimeout(800);
const body = await p.textContent('body');
ok('店舗の集計画面（対象の切替・設定タブなし）', !body.includes('選択肢・エリアの設定') && !body.includes('エリア未設定') && body.includes('件数と継続率'));
ok('新患 1（自店舗だけ）', (await p.locator('div.rounded-lg', { hasText: '新患（初診・初）' }).first().locator('div.text-3xl').textContent()).trim() === '1');
await p.screenshot({ path: new URL('./out-store-karte.png', import.meta.url).pathname, fullPage: true });

// ログイン切れ：Cookie を消して画面を操作 → お知らせ付きでログイン画面 → ログイン後は元の画面に戻る
await ctx.clearCookies();
await p.getByRole('link', { name: '予約・来院ログ' }).click();
await p.waitForURL(/\/admin\/login\/S001\?expired=1/, { timeout: 10000 });
ok('店舗専用のログイン画面へ戻る', true, p.url().replace(B, ''));
ok('期限切れのお知らせ', await p.getByText('ログインの有効期限が切れたか').isVisible());
await p.fill('input[type=password]', 'password'); await p.click('button[type=submit]');
await p.waitForURL(/\/admin\/reservations/, { timeout: 10000 });
ok('ログイン後は元の画面へ', true, p.url().replace(B, ''));

// 本部は今までどおり全店
const hq = await br.newContext(); const hp = await hq.newPage();
await hp.goto(`${B}/admin/login`); await hp.fill('input[autocomplete="username"]', 'HQ'); await hp.fill('input[type=password]', process.env.HQ_PASSWORD ?? 'hq-pass'); await hp.getByRole('button', { name: 'ログイン' }).click(); await hp.waitForURL(/admin\/day/);
const [hs, hj] = await api(hp, 'GET', `/api/admin/hq/karte?from=${D.slice(0, 7)}-01&to=${D.slice(0, 7)}-28`);
ok('本部は全店の行', hs === 200 && hj.rows.length === 2 && hj.stores.length >= 2, `rows=${hj?.rows?.length}`);
await hp.goto(`${B}/admin/hq/karte`); await hp.waitForSelector('text=選択肢・エリアの設定');
ok('本部の画面は今までどおり', (await hp.textContent('body')).includes('対象'));
// ログインの延長：古いログイン（発行から 1 時間以上）は使うと延長される
const [, me] = await api(hp, 'GET', '/api/admin/me');
ok('本部のログインは有効', me?.session?.role === 'hq');
ok('画面のエラーなし', errs.length === 0, JSON.stringify(errs));
await br.close();
