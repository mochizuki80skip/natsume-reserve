// Xserver（PHP）版：キャンペーン専用の URL・QR（店舗えらび用＋店舗別）。予約ページ・店舗えらびページに内容を出し、
// 初診の新患継続率はきっかけ＝決めた媒体、内訳＝キャンペーン名で入る。紹介カード用の QR から店舗えらびページにも出る
// 例：BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... CHROMIUM_PATH=... node e2e/campaignurl.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const errs = [];
const api = (p, m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);

const hp = await (await br.newContext({ viewport: { width: 1366, height: 1000 } })).newPage(); hp.on('pageerror', (e) => errs.push(e.message)); hp.on('dialog', (d) => d.accept());
await hp.goto(`${B}/admin/login`); await hp.fill('input[autocomplete="username"]', 'HQ'); await hp.fill('input[type=password]', process.env.HQ_PASSWORD ?? 'hq-pass');
await hp.click('button[type=submit]'); await hp.waitForURL(/admin\/(hq|overview|day)/);
await api(hp, 'PUT', '/api/admin/hq/stores-page', { open: true });
await hp.goto(`${B}/admin/hq`); await hp.waitForTimeout(1500);
const sec = hp.getByRole('region', { name: '経路別キャンペーン' });
await sec.getByRole('button', { name: '＋ キャンペーンを追加' }).click();
const form = sec.getByRole('form', { name: 'キャンペーンを追加' });
ok('はじめは「専用の URL・QR を作る」', (await form.getByLabel('経路').inputValue()) === 'own');
await form.getByLabel('キャンペーン名').fill('冬の肩こり ワンコイン矯正');
await form.getByLabel('説明').fill('肩こりの矯正がワンコイン（500円）');
ok('きっかけを選ぶまで保存できない', await form.getByRole('button', { name: '保存' }).isDisabled());
await form.getByLabel('入るきっかけ').selectOption('SNS');
await form.getByLabel('はじめから選ぶ区分').selectOption('REVISIT');
await form.getByRole('button', { name: '保存' }).click(); await hp.waitForTimeout(1200);
const urls = sec.getByRole('region', { name: '冬の肩こり ワンコイン矯正 の URL・QR の一覧' });
ok('保存すると URL・QR の一覧ができる', await urls.isVisible());
const all = await urls.locator('code').allTextContents();
const storesUrl = all.find((u) => u.includes('/stores?c='));
const s2Url = all.find((u) => u.includes('/s/S002?c='));
ok('店舗えらび用と店舗別の URL', !!storesUrl && !!s2Url && all.length >= 3, JSON.stringify(all));
ok('QR が出る', (await urls.getByRole('img').count()) >= 3);
await hp.screenshot({ path: new URL('./out-campaign-url.png', import.meta.url).pathname, fullPage: false, clip: await sec.boundingBox() }).catch(() => {});
const code = storesUrl.split('c=')[1];
ok('Excel の一覧', (await hp.evaluate(async () => (await fetch('/api/admin/hq/campaigns/export')).headers.get('content-type'))).includes('spreadsheet'));
const camp = (await api(hp, 'GET', '/api/admin/hq/campaigns'))[1].rows.find((c) => c.code === code);
await api(hp, 'PUT', '/api/admin/hq/campaigns', { ...camp, route: 'own', description: '肩こりの矯正がワンコイン（500円）です' });
ok('直しても URL（印）は変わらない', (await api(hp, 'GET', '/api/admin/hq/campaigns'))[1].rows.some((c) => c.code === code));
ok('専用の URL はきっかけが必要', (await api(hp, 'PUT', '/api/admin/hq/campaigns', { route: 'own', name: 'x' }))[0] === 400);

// 店舗えらび用の URL：上にキャンペーン → 店舗を選ぶと予約ページにも出る
const cp = await br.newPage({ viewport: { width: 420, height: 900 } }); cp.on('pageerror', (e) => errs.push(e.message));
await cp.goto(storesUrl.replace(/^https?:\/\/[^/]+/, B)); await cp.waitForSelector('text=ご予約の店舗をお選びください');
ok('店舗えらびページにもキャンペーンが出る', (await cp.getByRole('note', { name: 'キャンペーンの内容' }).textContent()).includes('冬の肩こり ワンコイン矯正'));
const href = await cp.locator('article').filter({ hasText: 'サンプル本店' }).getByRole('link', { name: 'WEB 予約' }).getAttribute('href');
ok('予約ページへ印を引き継ぐ', href.includes(`c=${code}`), href);
await cp.goto(B + href); await cp.waitForSelector('table.wk tbody tr', { timeout: 15000 });
ok('予約ページに出る', (await cp.getByRole('note', { name: 'キャンペーンの内容' }).textContent()).includes('キャンペーン特典'));
ok('再来（1ヶ月以上ぶり）を選んだ状態', (await cp.getByRole('radio', { name: /1ヶ月以上/ }).getAttribute('aria-checked')) === 'true');
const plain = await br.newPage(); await plain.goto(`${B}/stores`); await plain.waitForSelector('text=ご予約の店舗をお選びください');
ok('ふつうの店舗えらびページには出ない', (await plain.getByRole('note', { name: 'キャンペーンの内容' }).count()) === 0);
// 紹介カード用の QR：ギフトカードのキャンペーンがあれば店舗えらびページにも出る
await api(hp, 'PUT', '/api/admin/hq/campaigns', { route: 'card', name: '初回 骨格・骨盤矯正 1,000円 → 無料', showInsurance: true, presetKind: 'NEW' });
await plain.goto(`${B}/stores?from=card`); await plain.waitForSelector('text=ご予約の店舗をお選びください');
ok('紹介カード用の QR の店舗えらびページに出る', (await plain.getByRole('note', { name: 'キャンペーンの内容' }).textContent()).includes('1,000円 → 無料'));
await plain.close();

// 予約 → 来院チェック → 新患継続率のきっかけ SNS・内訳＝キャンペーン名（API で）
const s1 = await (await br.newContext()).newPage();
await s1.goto(`${B}/admin/login/S001`); await s1.fill('input[type=password]', 'password'); await s1.click('button[type=submit]'); await s1.waitForURL(/admin\/day/);
let open;
for (let w = 0; w < 3 && !open; w++) {
  const st = new Date(); st.setDate(st.getDate() + 1 + w * 7);
  const wk = (await api(s1, 'GET', `/api/public/S001/week?start=${st.toISOString().slice(0, 10)}&kind=NEW`))[1];
  open = wk.days.flatMap((d) => d.slots.filter((x) => x.status === 'open').map((x) => [d.date, x.time]))[0];
}
const rv = (await api(s1, 'POST', '/api/public/S001/reserve', { kind: 'NEW', date: open[0], time: open[1], name: '見本 広告', phone: '09031313131', c: code }))[1];
ok('キャンペーン URL から予約できる（内容も返る）', rv.ok && rv.campaign?.name === '冬の肩こり ワンコイン矯正', JSON.stringify(rv).slice(0, 160));
const day = (await api(s1, 'GET', `/api/admin/day?date=${open[0]}`))[1].data;
const cell = day.cells.find((c) => c.web?.campaign);
ok('予約表に残る', cell?.web.campaign.name === '冬の肩こり ワンコイン矯正');
await api(s1, 'PUT', '/api/admin/visit', { date: open[0], time: open[1], bed: cell.bed, visited: true });
const karte = (await api(s1, 'GET', `/api/admin/karte?month=${open[0].slice(0, 7)}`))[1];
const row = (karte.rows ?? []).find((r) => r.name.includes('広告'));
ok('新患継続率：きっかけ SNS・内訳 キャンペーン名', row?.trig === 'SNS' && row?.trigDetail === '冬の肩こり ワンコイン矯正', JSON.stringify(row && [row.trig, row.trigDetail]));

ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
console.log(process.exitCode ? 'CAMPAIGNURL FAILED' : 'CAMPAIGNURL OK');
