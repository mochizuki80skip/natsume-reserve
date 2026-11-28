// Xserver（PHP）版：本部アカウントのヘッダー（本部の画面を上の段・店舗の予約表へ一覧から 1 回で飛ぶ・店舗の画面は下の段にその店舗のメニュー）。ログインしたら全店状況。
// 管轄MG は「管轄の予約状況」で管轄の店舗の今日の予約数を見て飛べる
// 例：BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... CHROMIUM_PATH=... node e2e/hqheader.mjs
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003';
const DB = process.env.DB_NAME ?? 'booking';
const sql = (q) => execSync(`mysql -uroot --default-character-set=utf8mb4 -N ${DB}`, { input: q }).toString().trim();
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const errs = [];
async function login(code, pass, user) {
  const p = await (await br.newContext({ viewport: { width: 1400, height: 1000 } })).newPage(); p.on('pageerror', (e) => errs.push(e.message));
  if (user) { await p.goto(`${B}/admin/login`); await p.fill('input[autocomplete="username"]', user); } else await p.goto(`${B}/admin/login/${code}`);
  await p.fill('input[type=password]', pass); await p.click('button[type=submit]'); await p.waitForURL((u) => !u.pathname.includes('/login')); await p.waitForLoadState('networkidle');
  return p;
}
const api = (p, m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);
sql('DELETE FROM rate_limit');
const hq = await login('', process.env.HQ_PASSWORD ?? 'hq-pass', 'HQ');
const today = (await api(hq, 'GET', '/api/admin/me'))[1].today;
ok('本部はログインすると全店状況', new URL(hq.url()).pathname === '/admin/hq/overview', hq.url());
const nav = hq.getByRole('banner', { name: '管理画面のメニュー' });
const top = await nav.innerText();
ok('上の段は本部の画面', ['全店状況', '新患・再来集計', '新自・新三', '自賠集計', '窓口集計', 'マーケ', '人員配置', '変更履歴', '本部設定', '店舗の予約表'].every((t) => top.includes(t)) && !top.includes('シフト'), top.replace(/\s+/g, ' ').slice(0, 200));
ok('本部の画面では店舗のメニューの段は出ない', (await hq.getByLabel('店舗のメニュー').count()) === 0);
// 予約を 2 件入れて、今日の予約数が出るか
await hq.context().addCookies([{ name: 'bk_store', value: 'S002', url: B }]);
const d0 = (await api(hq, 'GET', `/api/admin/day?date=${today}`))[1].data;
const free = d0.times.slice(0, 2);
await api(hq, 'PUT', '/api/admin/cells', { date: today, cells: free.map((t) => ({ time: t, bed: 1, text: `見本 本部ヘッダー${t}` })) });
const want = (await api(hq, 'GET', `/api/admin/hq/overview?date=${today}`))[1].rows.find((r) => r.code === 'S002');
await nav.getByText('🏥 店舗の予約表').click();
const list = hq.getByLabel('🏥 店舗の予約表の一覧');
await list.getByRole('button', { name: /サンプル駅前院/ }).waitFor(); await hq.waitForTimeout(800);
ok('一覧に今日の予約数', (await list.getByRole('button', { name: /サンプル駅前院/ }).innerText()).includes(String(want.rAm + want.rPm)), JSON.stringify(want));
await list.getByRole('button', { name: /サンプル駅前院/ }).click();
await hq.waitForURL(new RegExp(`/admin/day/${today}`)); await hq.waitForSelector('#grid');
ok('押すとその店舗の今日の予約表', (await api(hq, 'GET', '/api/admin/me'))[1].store.code === 'S002');
const sub = hq.getByLabel('店舗のメニュー');
ok('店舗の画面では下の段にその店舗のメニュー', (await sub.innerText()).includes('シフト') && (await sub.innerText()).includes('店舗設定') && (await sub.getByLabel('表示する店舗').inputValue()) === 'S002');
await sub.getByLabel('表示する店舗').selectOption('S001'); await hq.waitForURL(/admin\/day/); await hq.waitForTimeout(800);
ok('下の段のドロップダウンで店舗を切り替えられる（同じ画面のまま）', (await api(hq, 'GET', '/api/admin/me'))[1].store.code === 'S001' && new URL(hq.url()).pathname.startsWith('/admin/day'));
await sub.getByRole('link', { name: 'シフト' }).click(); await hq.waitForURL(/admin\/shifts/);
ok('下の段から店舗の画面へ', true);
await nav.getByRole('link', { name: '全店状況' }).click(); await hq.waitForURL(/admin\/hq\/overview/); await hq.waitForTimeout(500);
ok('上の段から本部の画面へ戻れる', (await hq.getByLabel('店舗のメニュー').count()) === 0, hq.url());
await nav.getByText('本部設定').click();
ok('本部設定の中に店舗・設定・アカウント・終了報告', (await Promise.all(['本部（店舗・設定）', 'アカウント', '事故患者 終了報告'].map((t) => nav.getByRole('link', { name: t, exact: true }).count()))).every((n) => n === 1));

// ---------- 管轄MG ----------
await api(hq, 'PUT', '/api/admin/hq/areas', { areas: [{ name: '見本エリア', stores: ['S002'] }] });
await api(hq, 'POST', '/api/admin/hq/accounts', { code: 'mghd1', name: '見本 MG', password: 'mgpass123', role: 'mg', area: '見本エリア' });
const mg = await login('', 'mgpass123', 'mghd1');
const mnav = mg.getByRole('banner', { name: '管理画面のメニュー' });
await mnav.getByText('🏥 管轄の予約状況').click();
const ml = mg.getByLabel('🏥 管轄の予約状況の一覧');
await ml.getByRole('button').first().waitFor(); await mg.waitForTimeout(800);
const names = await ml.getByRole('button').allInnerTexts();
ok('管轄MG：管轄の店舗だけ・今日の予約数つき', names.length === 1 && names[0].includes('サンプル駅前院') && names[0].includes(String(want.rAm + want.rPm)), JSON.stringify(names));
ok('管轄MG：上の段は今までどおり（予約表など）', (await mnav.innerText()).includes('予約表'));
ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
console.log(process.exitCode ? 'HQHEADER FAILED' : 'HQHEADER OK');
