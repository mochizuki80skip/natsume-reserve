// Xserver（PHP）版：プライバシーポリシー（本部が書いて公開・【 】が残っていると公開できない・予約ページ／店舗えらびの下にリンクと一文）と、
// 媒体ごとの店舗えらび URL（きっかけ＝選んだもの・内訳＝媒体名）（サンプル店舗 S001・見本の名前）
// 例：BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... CHROMIUM_PATH=... node e2e/privacy.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003', O = new URL('./', import.meta.url).pathname + 'out-';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const errs = [];
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const api = (pg, m, u, b) => pg.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);
const hp = await br.newPage({ viewport: { width: 1366, height: 900 } });
hp.on('pageerror', (e) => errs.push(e.message)); hp.on('dialog', (d) => d.accept());
await hp.goto(`${B}/admin/login`); await hp.fill('input[autocomplete="username"]', 'HQ'); await hp.fill('input[type=password]', process.env.HQ_PASSWORD ?? 'hqpass123'); await hp.getByRole('button', { name: 'ログイン' }).click(); await hp.waitForURL(/admin\//);

// 1) 公開前：予約ページにリンクは出ない
const cp = await br.newPage({ viewport: { width: 390, height: 800 } });
cp.on('pageerror', (e) => errs.push(e.message));
await cp.goto(`${B}/s/S001`); await cp.waitForSelector('table.wk tbody tr', { timeout: 15000 });
ok('公開前はリンクなし', (await cp.getByRole('link', { name: 'プライバシーポリシー' }).count()) === 0);

// 2) 本部：下書き・【 】が残っていると公開できない
await hp.goto(`${B}/admin/hq`);
const sec = hp.getByRole('region', { name: 'プライバシーポリシー' });
await sec.waitFor();
ok('下書きが入っている', (await sec.getByLabel('プライバシーポリシーの文章').inputValue()).includes('## 5. グループでの共同利用'));
ok('【 】が残っていると公開ボタンが押せない', await sec.getByRole('button', { name: '保存して公開する' }).isDisabled() && (await sec.textContent()).includes('まだ埋まっていない所'));
await hp.screenshot({ path: O + 'privacy-editor.png', fullPage: false });
ok('API でも公開できない', (await api(hp, 'PUT', '/api/admin/hq/privacy', { body: '【法人名】', published: true }))[0] === 400);
// 埋めた文章で公開
const filled = (await sec.getByLabel('プライバシーポリシーの文章').inputValue()).replace(/【[^】]*】/g, '見本');
await sec.getByLabel('プライバシーポリシーの文章').fill(filled);
await sec.getByRole('button', { name: '保存して公開する' }).click();
await hp.waitForSelector('text=保存して公開しました');
ok('公開中', (await sec.textContent()).includes('公開中'));

// 3) 公開ページ・予約ページの下のリンクと一文
await cp.goto(`${B}/privacy`); await cp.waitForSelector('h2');
const pt = await cp.textContent('main');
ok('公開ページ（見出し・共同利用・窓口）', pt.includes('5. グループでの共同利用') && pt.includes('054-207-7327') && !pt.includes('【'), pt.slice(0, 80));
await cp.screenshot({ path: O + 'privacy-page.png', fullPage: true });
await cp.goto(`${B}/s/S001`); await cp.waitForSelector('table.wk tbody tr', { timeout: 15000 });
ok('予約ページの下にリンク', await cp.locator('footer').getByRole('link', { name: 'プライバシーポリシー' }).waitFor({ timeout: 8000 }).then(() => true, () => false));

// 4) 媒体：作る → 店舗えらびページから予約 → 新患継続率のきっかけ・内訳
ok('媒体はきっかけが必要', (await api(hp, 'PUT', '/api/admin/hq/referrals', { name: '見本インスタ', kind: 'media' }))[0] === 400);
ok('内訳つきのきっかけは選べない', (await api(hp, 'PUT', '/api/admin/hq/referrals', { name: '見本インスタ', kind: 'media', trig: '業者紹介' }))[0] === 400);
await hp.reload();
const media = hp.getByRole('region', { name: '媒体の専用 QR' });
await media.getByLabel('新しい媒体の名前').fill('見本インスタ');
await media.getByLabel('入るきっかけ').selectOption('SNS');
await media.getByRole('button', { name: '媒体を追加' }).click();
await hp.waitForSelector('text=「見本インスタ」を追加しました');
const m = (await api(hp, 'GET', '/api/admin/hq/referrals'))[1].rows.find((r) => r.name === '見本インスタ');
ok('媒体ができる', m && m.kind === 'media' && m.trig === 'SNS', JSON.stringify(m));
ok('紹介元の表には出ない', (await hp.getByRole('region', { name: '紹介元の専用 QR' }).getByLabel('紹介元の名前', { exact: true }).count()) === 0);
await hp.screenshot({ path: O + 'media-editor.png', fullPage: true });
await api(hp, 'PUT', '/api/admin/hq/stores-page', { open: true });
await cp.goto(`${B}/stores?ref=${m.code}`); await cp.waitForSelector('text=ご予約の店舗をお選びください');
ok('店舗えらびページの下にもリンク', await cp.locator('footer').getByRole('link', { name: 'プライバシーポリシー' }).isVisible());
const href = await cp.getByRole('link', { name: 'WEB 予約' }).first().getAttribute('href');
await cp.goto(B + href.replace(/^\/s\/[^?]+/, '/s/S001')); await cp.waitForSelector('table.wk tbody tr', { timeout: 15000 });
await cp.getByRole('button', { name: /はじめての方/ }).click();
await cp.getByRole('radio', { name: /ケガ・痛み・不調/ }).click(); await cp.waitForTimeout(800);
let slot = cp.locator('td.o button').first();
for (let i = 0; i < 4 && (await slot.count()) === 0; i++) { await cp.getByRole('button', { name: '翌週 ›' }).click(); await cp.waitForTimeout(800); slot = cp.locator('td.o button').first(); }
await slot.click();
await cp.getByRole('button', { name: 'この日時で予約へ進む' }).click(); await cp.waitForSelector('h2');
await cp.fill('input[placeholder*="山田"]', '見本 媒子');
await cp.fill('input[type="tel"]', '090' + String(Date.now()).slice(-8));
await cp.getByRole('button', { name: '入力内容を確認する' }).click();
ok('予約ボタンの上に一文', await cp.getByText('ご入力いただいた個人情報は、ご予約の管理とご連絡、施術のために使います').isVisible());
await cp.screenshot({ path: O + 'privacy-note.png', fullPage: true });
await cp.getByRole('button', { name: 'この内容で予約する' }).click();
await cp.waitForSelector('text=ご予約が確定しました', { timeout: 15000 });
const sp = await br.newPage();
await sp.goto(B + '/admin/login/S001'); await sp.fill('input[type=password]', 'password'); await sp.click('button[type=submit]'); await sp.waitForURL(/admin\/day/);
const res = (await api(sp, 'GET', '/api/admin/reservations?status=all'))[1].rows.find((r) => r.name === '見本 媒子');
await api(sp, 'PUT', '/api/admin/visit', { date: res.date, time: res.time, bed: res.bed, visited: true });
const k = (await api(sp, 'GET', `/api/admin/karte?month=${res.date.slice(0, 7)}`))[1].rows.find((r) => r.name === '見本 媒子');
ok('新患継続率：きっかけ SNS・内訳 見本インスタ', k?.trig === 'SNS' && k?.trigDetail === '見本インスタ', JSON.stringify(k && [k.trig, k.trigDetail]));
await sp.goto(`${B}/admin/karte?month=${res.date.slice(0, 7)}`); await sp.waitForSelector('text=継続の状況');
ok('内訳の欄に媒体名が見える', (await sp.getByLabel('内訳').first().inputValue()) === '見本インスタ');
const m2 = (await api(hp, 'GET', '/api/admin/hq/referrals'))[1].rows.find((r) => r.name === '見本インスタ');
ok('媒体の予約数・新患継続率の数', m2.reservations === 1 && m2.kartes === 1, JSON.stringify(m2));
// きっかけを変えると新患継続率もそろう
await api(hp, 'PUT', '/api/admin/hq/referrals', { id: m2.id, trig: 'チラシ' });
const k2 = (await api(sp, 'GET', `/api/admin/karte?month=${res.date.slice(0, 7)}`))[1].rows.find((r) => r.name === '見本 媒子');
ok('きっかけを変えると行もそろう', k2.trig === 'チラシ' && k2.trigDetail === '見本インスタ');
ok('ページのエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
