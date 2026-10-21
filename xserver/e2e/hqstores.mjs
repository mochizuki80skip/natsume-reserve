// Xserver（PHP）版：本部の店舗一覧（エリア別・並び順・本部専用・URL のコピー）と特別な営業日
// 例：BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... CHROMIUM_PATH=... node e2e/hqstores.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003', O = new URL('./', import.meta.url).pathname + 'out-';
const HQPW = process.env.HQ_PASSWORD ?? 'hqpass123';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const errs = [];
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const ctx = await br.newContext({ viewport: { width: 1400, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
const hp = await ctx.newPage();
hp.on('pageerror', (e) => errs.push(e.message));
await hp.goto(`${B}/admin/login`); await hp.fill('input[autocomplete="username"]', 'HQ'); await hp.fill('input[type=password]', HQPW); await hp.getByRole('button', { name: 'ログイン' }).click(); await hp.waitForURL(/admin\/day/);
const api = (pg, m, u, b) => pg.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);
const order = async () => (await api(hp, 'GET', '/api/admin/hq'))[1].stores.map((s) => s.code).join(',');

// 準備：店舗を 2 つ足して、エリアに分ける
await api(hp, 'POST', '/api/admin/hq/stores', { code: 'S003', name: '見本 東', phone: '055-000-0003', password: 'password' });
await api(hp, 'PUT', '/api/admin/hq/areas', { areas: [{ name: '静岡エリア', stores: ['S001', 'S002'] }, { name: '東部エリア', stores: ['S003'] }] });
ok('エリアの順に並ぶ', (await order()) === 'S001,S002,S003', await order());

// 1) 並べ替え・エリアの付け替え（画面から）
await hp.goto(`${B}/admin/hq`); await hp.waitForSelector('text=店舗一覧');
ok('エリアの見出し', await hp.getByText('静岡エリア（2 店舗）').isVisible() && await hp.getByText('東部エリア（1 店舗）').isVisible());
await hp.getByRole('button', { name: 'サンプル駅前院 を上へ' }).click(); await hp.waitForTimeout(800);
ok('↑ で並び順が変わる', (await order()) === 'S002,S001,S003', await order());
ok('エリアのいちばん上は↑を押せない', await hp.getByRole('button', { name: 'サンプル駅前院 を上へ' }).isDisabled());
await hp.getByLabel('サンプル本店 のエリア').selectOption('東部エリア'); await hp.waitForTimeout(800);
ok('エリアを選び直せる（後ろに入る）', (await order()) === 'S002,S003,S001', await order());

// 2) 編集・URL：URL のコピーと本部専用
await hp.locator('tr', { hasText: '見本 東' }).getByRole('button', { name: '編集・URL' }).click();
ok('顧客URL・管理URL が出る', (await hp.locator('code', { hasText: '/s/S003' }).count()) === 1 && (await hp.locator('code', { hasText: '/admin/login/S003' }).count()) === 1);
await hp.locator('div.rounded.border', { hasText: '顧客URL（WEB 予約）' }).getByRole('button', { name: 'URL をコピー' }).click();
ok('QR コードも出る', (await hp.getByAltText('顧客URL（WEB 予約）の QR コード').count()) === 1);
ok('コピーできる', (await hp.evaluate(() => navigator.clipboard.readText())).endsWith('/s/S003'));
await hp.screenshot({ path: O + 'hq-stores.png', clip: { x: 0, y: 0, width: 1400, height: 700 } });
await hp.getByLabel(/本部専用（店舗のアカウント/).check(); await hp.getByRole('button', { name: '保存' }).first().click(); await hp.waitForTimeout(800);
ok('本部専用はいちばん上', (await order()) === 'S003,S002,S001', await order());
ok('本部専用の見出し', await hp.getByText('本部専用（本部の人だけが見る店舗）（1 店舗）').isVisible());
const pub = await br.newPage();
await pub.goto(`${B}/admin/login/S003`);
const lg = await api(pub, 'POST', '/api/admin/login', { code: 'S003', password: 'password' });
ok('本部専用の店舗は店舗のアカウントでログインできない', lg[0] === 403 && lg[1].error.includes('本部専用'), JSON.stringify(lg));
const lg2 = await api(pub, 'POST', '/api/admin/login', { code: 'S002', password: 'password' });
ok('ほかの店舗はログインできる', lg2[0] === 200);
// 店舗切り替え：本部専用 → エリアごとの見出し
const groups = await hp.locator('header select[name=store] optgroup').evaluateAll((gs) => gs.map((g) => `${g.label}:${[...g.querySelectorAll('option')].map((o) => o.textContent).join('/')}`));
ok('店舗切り替えに本部専用とエリアの見出し', groups.join('|') === '本部専用:見本 東|静岡エリア:サンプル駅前院|東部エリア:サンプル本店', groups.join('|'));

// 3) 特別な営業日（店舗設定）：定休日の木曜をプレオープンにする
const sp = await br.newPage({ viewport: { width: 1400, height: 1000 } });
sp.on('pageerror', (e) => errs.push(e.message));
await sp.goto(`${B}/admin/login/S001`); await sp.fill('input[type=password]', 'password'); await sp.click('button[type=submit]'); await sp.waitForURL(/admin\/day/);
// 店舗設定にも URL・QR コード（保存できる）
await sp.goto(`${B}/admin/settings`); await sp.waitForSelector('text=この店舗の URL・QR コード');
ok('店舗設定に顧客URL・管理URL の QR', (await sp.getByAltText('顧客URL（WEB 予約）の QR コード').count()) === 1 && (await sp.getByAltText('管理URL（店舗のログイン）の QR コード').count()) === 1);
const save = sp.getByRole('link', { name: 'QR 画像を保存' }).first();
ok('保存のファイル名（店舗名入り）', (await save.getAttribute('download')) === 'QR_サンプル本店_顧客URL.png' && (await save.getAttribute('href')).startsWith('blob:'), await save.getAttribute('download'));
const dl = sp.waitForEvent('download');
await save.click();
const file = await dl;
ok('QR 画像を保存できる（PNG）', (await file.createReadStream().then((st) => new Promise((res) => { const b = []; st.on('data', (c) => b.push(c)); st.on('end', () => res(Buffer.concat(b))); }))).subarray(1, 4).toString() === 'PNG');
await sp.locator('section[aria-label="この店舗の URL・QR コード"]').screenshot({ path: O + 'store-qr.png' });
// 次の木曜（定休日）。公開している範囲に入るよう、今日から 2〜8 日先
const D = (() => { const t = new Date(Date.now() + 9 * 3600 * 1000); t.setUTCDate(t.getUTCDate() + 2); while (t.getUTCDay() !== 4) t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10); })();
const before = (await api(sp, 'GET', `/api/admin/day?date=${D}`))[1].data;
ok('準備：木曜は定休日', before.times.length === 0);
await sp.goto(`${B}/admin/settings`); await sp.waitForSelector('text=特別な営業日（プレオープン・イベントなど）');
await sp.getByLabel('特別な営業日の日付').fill(D);
await sp.getByLabel('午前の始め').fill('10:00'); await sp.getByLabel('午前の受付の最後').fill('12:30');
await sp.getByLabel('午後の始め').fill('13:30'); await sp.getByLabel('午後の受付の最後').fill('16:00');
await sp.getByLabel('特別な営業日のメモ').fill('プレオープン');
await sp.getByRole('region', { name: '特別な営業日' }).getByRole('button', { name: '保存' }).click();
await sp.waitForSelector('text=を特別な営業日にしました');
const after = (await api(sp, 'GET', `/api/admin/day?date=${D}`))[1].data;
ok('その日だけ決めた時間で予約表ができる', after.times[0] === 600 && after.times.includes(750) && after.times.includes(810) && after.times.includes(960) && !after.times.includes(780), JSON.stringify(after.times));
const slots = (await api(sp, 'GET', `/api/public/S001/slots?date=${D}&kind=RETURN`))[1];
ok('WEB 予約にも枠が出る', slots.published && slots.slots.length > 0 && slots.slots[0].time === 600, JSON.stringify(slots).slice(0, 120));
await sp.goto(`${B}/admin/day/${D}`); await sp.waitForSelector('#grid');
ok('予約表に「特別営業：プレオープン」', (await sp.locator('p', { hasText: '特別営業：プレオープン' }).textContent()).includes('10:00〜12:30／13:30〜16:00'));
await sp.screenshot({ path: O + 'special-day.png', clip: { x: 0, y: 0, width: 1400, height: 420 } });
const bad = await api(sp, 'PUT', '/api/admin/special-days', { date: D, sessions: [['13:00', '12:00']], memo: '' });
ok('おかしな時間は保存しない', bad[0] === 400);
await api(sp, 'DELETE', '/api/admin/special-days', { date: D });
ok('消すと通常（定休日）に戻る', (await api(sp, 'GET', `/api/admin/day?date=${D}`))[1].data.times.length === 0);
ok('画面のエラーなし', errs.length === 0, JSON.stringify(errs));
await br.close();
