// Xserver（PHP）版：紹介元（業者）ごとの専用 QR → 店舗えらびページ → WEB 予約 → 初回カルテのきっかけ「業者紹介」・内訳＝業者名
// 例：BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... CHROMIUM_PATH=... node e2e/referral.mjs
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
const sfx = String(Date.now()).slice(-5);
const NAME = `ワタモ${sfx}`;

// 1) 本部で紹介元を追加 → 専用 URL と QR
await hp.goto(`${B}/admin/hq`); await hp.waitForSelector('text=紹介元（業者）の専用 QR');
ok('公開前は「準備中」の注意', await hp.getByText('店舗えらびページがまだ「非公開」です').first().isVisible());
await hp.getByLabel('新しい紹介元の名前').fill(NAME); await hp.getByRole('button', { name: '紹介元を追加' }).click();
await hp.waitForSelector(`text=「${NAME}」を追加しました`);
const ref = (await api(hp, 'GET', '/api/admin/hq/referrals'))[1].rows.find((r) => r.name === NAME);
ok('紹介元ができる（専用の短い文字）', !!ref && /^[a-z0-9]{6}$/.test(ref.code), JSON.stringify(ref));
ok('QR 画像が出る', await hp.getByAltText(`${NAME} の QR コード`).isVisible());
ok('専用 URL', (await hp.locator('code', { hasText: `/stores?ref=${ref.code}` }).count()) === 1);
ok('同じ名前は追加できない', (await api(hp, 'PUT', '/api/admin/hq/referrals', { name: NAME }))[0] === 409);
await hp.locator('section', { hasText: '紹介元（業者）の専用 QR' }).screenshot({ path: O + 'referral-hq.png' });

// 2) 店舗えらびページを公開 → QR の URL から店舗の予約ページへ ref を引き継ぐ
await api(hp, 'PUT', '/api/admin/hq/stores-page', { open: true });
const cp = await br.newPage({ viewport: { width: 420, height: 860 } });
cp.on('pageerror', (e) => errs.push(e.message));
await cp.goto(`${B}/stores?ref=${ref.code}`); await cp.waitForSelector('text=ご予約の店舗をお選びください');
const href = await cp.getByRole('link', { name: 'WEB 予約' }).first().getAttribute('href');
ok('店舗の予約ページへ ref を引き継ぐ', href.includes(`ref=${ref.code}`), href);
await cp.goto(B + href.replace(/^\/s\/[^?]+/, '/s/S001'));
await cp.waitForSelector('table.wk tbody tr', { timeout: 15000 });
await cp.getByRole('button', { name: /はじめての方/ }).click();
await cp.getByRole('radio', { name: /ケガ・痛み・不調/ }).click(); await cp.waitForTimeout(800);
let slot = cp.locator('td.o button').first();
for (let i = 0; i < 4 && (await slot.count()) === 0; i++) { await cp.getByRole('button', { name: '翌週 ›' }).click(); await cp.waitForTimeout(800); slot = cp.locator('td.o button').first(); }
let sent = null;
cp.on('request', (r) => { if (r.url().includes('/reserve') && r.method() === 'POST') sent = r.postDataJSON(); });
await slot.click();
await cp.getByRole('button', { name: 'この日時で予約へ進む' }).click(); await cp.waitForSelector('h2');
await cp.fill('input[placeholder*="山田"]', `紹介 太郎${sfx}`);
await cp.fill('input[type="tel"]', '080' + String(Date.now()).slice(-8));
await cp.getByRole('button', { name: '入力内容を確認する' }).click();
await cp.getByRole('button', { name: 'この内容で予約する' }).click();
await cp.waitForSelector('text=ご予約が確定しました', { timeout: 15000 });
ok('予約に紹介元を付けて送る', sent?.ref === ref.code, JSON.stringify(sent));

// 3) 来院チェック → 初回カルテのきっかけ「業者紹介」・内訳＝業者名
const sp = await br.newPage();
await sp.goto(B + '/admin/login/S001'); await sp.fill('input[type=password]', 'password'); await sp.click('button[type=submit]'); await sp.waitForURL(/admin\/day/);
const res = (await api(sp, 'GET', '/api/admin/reservations?status=all'))[1].rows.find((r) => r.name.startsWith(`紹介 太郎${sfx}`));
ok('予約が入る', !!res, '');
await api(sp, 'PUT', '/api/admin/visit', { date: res.date, time: res.time, bed: res.bed, visited: true });
const k = (await api(sp, 'GET', `/api/admin/karte?month=${res.date.slice(0, 7)}`))[1].rows.find((r) => r.name.startsWith(`紹介 太郎${sfx}`));
ok('きっかけ「業者紹介」・内訳＝業者名', k?.trig === '業者紹介' && k?.trigDetail === NAME, JSON.stringify(k && { trig: k.trig, d: k.trigDetail }));
await sp.goto(`${B}/admin/karte?month=${res.date.slice(0, 7)}`); await sp.waitForSelector('text=合計');
ok('カルテ画面の内訳に業者名', (await sp.locator('select[aria-label="内訳（紹介元）"]').first().inputValue()) === NAME);
const cnt = (await api(hp, 'GET', '/api/admin/hq/referrals'))[1].rows.find((r) => r.code === ref.code);
ok('本部の一覧に人数', cnt.reservations === 1 && cnt.kartes === 1, JSON.stringify(cnt));

// 4) 名前を変えるとカルテの内訳もそろう／止めた QR は付かない
const NAME2 = `${NAME}商事`;
await api(hp, 'PUT', '/api/admin/hq/referrals', { id: ref.id, name: NAME2 });
const k2 = (await api(sp, 'GET', `/api/admin/karte?month=${res.date.slice(0, 7)}`))[1].rows.find((r) => r.id === k.id);
ok('名前を変えると内訳もそろう', k2.trigDetail === NAME2, k2.trigDetail);
await api(hp, 'PUT', '/api/admin/hq/referrals', { id: ref.id, active: false });
const r2 = await api(cp, 'POST', '/api/public/S001/reserve', { kind: 'NEW', date: '2026-10-27', time: 600, name: `止め 次郎${sfx}`, phone: '070' + String(Date.now()).slice(-8), ref: ref.code });
const res2 = (await api(sp, 'GET', '/api/admin/reservations?status=all'))[1].rows.find((r) => r.name.startsWith(`止め 次郎${sfx}`));
ok('止めた QR から予約しても紹介元は付かない', r2[0] === 200 && (await api(hp, 'GET', '/api/admin/hq/referrals'))[1].rows.find((r) => r.code === ref.code).reservations === 1, JSON.stringify(r2[1]).slice(0, 80) + ' ' + !!res2);
await api(hp, 'PUT', '/api/admin/hq/stores-page', { open: false });
ok('画面のエラーなし', errs.length === 0, JSON.stringify(errs));
await br.close();
