// Xserver（PHP）版：自賠請求だけに使う店舗（本部の店舗一覧・集計・店舗えらび・WEB 予約に出さない。自賠集計には入る）
// 例：BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... CHROMIUM_PATH=... node e2e/jibaionly.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003', O = new URL('./', import.meta.url).pathname + 'out-';
const HQPW = process.env.HQ_PASSWORD ?? 'hqpass123';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const errs = [];
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const hp = await br.newPage({ viewport: { width: 1400, height: 1000 } });
hp.on('pageerror', (e) => errs.push(e.message));
await hp.goto(`${B}/admin/login`); await hp.fill('input[autocomplete="username"]', 'HQ'); await hp.fill('input[type=password]', HQPW); await hp.getByRole('button', { name: 'ログイン' }).click(); await hp.waitForURL(/admin\/day/);
const api = (pg, m, u, b) => pg.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);

// 1) 本部の店舗一覧で「自賠請求のみ」にする（S002 を見本に）
await hp.goto(`${B}/admin/hq`); await hp.waitForSelector('text=店舗一覧');
await hp.locator('tr', { hasText: 'サンプル駅前院' }).getByRole('button', { name: '編集・URL' }).click();
await hp.getByLabel(/自賠請求のみ/).check(); await hp.getByRole('button', { name: '保存' }).first().click(); await hp.waitForTimeout(800);
ok('店舗一覧に出ない', (await hp.locator('tbody tr', { hasText: 'サンプル駅前院' }).count()) === 0 && (await hp.getByText(/店舗一覧（1 店舗）/).count()) === 1);
await hp.getByRole('button', { name: /自賠請求のみの店舗（1 店舗）を表示する/ }).click();
ok('「表示する」で見られる', (await hp.locator('tbody tr', { hasText: 'サンプル駅前院' }).count()) === 1);
await hp.screenshot({ path: O + 'jibai-only.png', clip: { x: 0, y: 0, width: 1400, height: 520 } });
ok('店舗えらびページの設定にも出ない', !(await hp.locator('section', { hasText: '店舗えらびページ（紹介カードの QR）' }).textContent()).includes('サンプル駅前院'));

// 2) 全店状況・新患・再来集計・店舗えらび・WEB 予約に出ない／店舗切り替えではいちばん下
const ov = (await api(hp, 'GET', '/api/admin/hq/overview'))[1];
ok('全店状況に出ない', !JSON.stringify(ov).includes('S002'));
const ko = (await api(hp, 'GET', '/api/admin/hq/karte/options'))[1];
ok('新患・再来集計の店舗に出ない', !ko.stores.some((s) => s.code === 'S002'));
await api(hp, 'PUT', '/api/admin/hq/stores-page', { open: true });
const ps = (await api(hp, 'GET', '/api/public-stores'))[1];
ok('店舗えらびページに出ない', !ps.stores.some((s) => s.code === 'S002'));
await api(hp, 'PUT', '/api/admin/hq/stores-page', { open: false });
ok('WEB 予約の空き・予約は受けない', (await api(hp, 'GET', '/api/public/S002/week'))[0] === 404 && (await api(hp, 'POST', '/api/public/S002/reserve', { kind: 'RETURN', date: '2026-11-04', time: 600, name: 'x', phone: '09012345678' }))[0] === 404);
const cp = await br.newPage(); await cp.goto(`${B}/s/S002`); await cp.waitForSelector('h1');
ok('WEB 予約のページは「見つかりません」', (await cp.textContent('h1')).includes('ページが見つかりません'));
const groups = await hp.locator('header select[name=store] optgroup').evaluateAll((gs) => gs.map((g) => g.label));
ok('店舗切り替えではいちばん下の「自賠請求のみ」', groups[groups.length - 1] === '自賠請求のみ', groups.join('|'));
const jb = (await api(hp, 'GET', '/api/admin/hq/jibai'))[1];
ok('自賠集計には入る', JSON.stringify(jb).includes('S002'), JSON.stringify(jb).slice(0, 120));

// 3) その店舗でログイン → 自賠請求だけ
const sp = await br.newPage();
sp.on('pageerror', (e) => errs.push(e.message));
await sp.goto(`${B}/admin/login/S002`); await sp.fill('input[type=password]', 'password'); await sp.click('button[type=submit]');
await sp.waitForURL(/admin\/jibai/);
ok('ログインすると自賠請求が開く', true);
const nav = await sp.locator('header nav').textContent();
ok('メニューは自賠請求だけ', nav.includes('自賠請求') && !nav.includes('予約表') && !nav.includes('新患継続率') && !nav.includes('店舗設定'), nav);
await sp.goto(`${B}/admin/settings`); await sp.waitForURL(/admin\/jibai/);
ok('ほかの画面を開いても自賠請求へ', true);
ok('画面のエラーなし', errs.length === 0, JSON.stringify(errs));
await br.close();
