// Xserver（PHP）版：窓口集計（月間窓口表・物販内訳・返戻）と、経理・管轄MG のアカウント（サンプル店舗 S001・S002、見本の名前）
// 例：BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... CHROMIUM_PATH=... node e2e/madoguchi.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003', O = new URL('./', import.meta.url).pathname + 'out-';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const errs = [];
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const api = (pg, m, u, b) => pg.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);
async function login(code, pass, user) {
  const p = await br.newPage({ viewport: { width: 1366, height: 900 } });
  p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  if (user) { await p.goto(`${B}/admin/login`); await p.fill('input[autocomplete="username"]', user); } else await p.goto(`${B}/admin/login/${code}`);
  await p.fill('input[type=password]', pass); await p.click('button[type=submit]'); await p.waitForURL(/admin\/(day|acct)/); await p.waitForTimeout(500);
  return p;
}
const M = '2026-10', D = '2026-10-02'; // 10/2（金）

// ---- 本部：物販の商品・エリア・経理と管轄MG のアカウント
const hq = await login('', process.env.HQ_PASSWORD ?? 'hqpass123', 'HQ');
await hq.goto(`${B}/admin/hq`);
const goods = hq.getByRole('region', { name: '物販の商品' });
await goods.getByLabel('新しい商品名').fill('見本ゼロ'); await goods.getByLabel('新しい商品の販売価格').fill('200'); await goods.getByLabel('新しい商品の原価').fill('16');
await goods.getByRole('button', { name: '商品を追加' }).click(); await hq.waitForSelector('text=「見本ゼロ」を追加しました');
await api(hq, 'PUT', '/api/admin/hq/goods', { name: '見本テープ', price: 330, cost: 64 });
ok('商品 2 つ', (await api(hq, 'GET', '/api/admin/hq/goods'))[1].rows.length === 2);
await api(hq, 'PUT', '/api/admin/hq/areas', { areas: [{ name: '見本エリア', stores: ['S002'] }] });
ok('経理アカウント', (await api(hq, 'POST', '/api/admin/hq/accounts', { code: 'keiri1', name: '見本 経理', password: 'keiripass1', role: 'acct' }))[0] === 200);
ok('管轄MG はエリアが必要', (await api(hq, 'POST', '/api/admin/hq/accounts', { code: 'mg1', name: '見本 MG', password: 'mgpass123', role: 'mg' }))[0] === 400);
ok('管轄MG アカウント', (await api(hq, 'POST', '/api/admin/hq/accounts', { code: 'mg1', name: '見本 MG', password: 'mgpass123', role: 'mg', area: '見本エリア' }))[0] === 200);
await hq.goto(`${B}/admin/hq/accounts`); await hq.waitForSelector('text=mg1');
ok('アカウントの一覧に種類', (await hq.textContent('main')).includes('経理') && (await hq.textContent('main')).includes('管轄MG'));

// ---- 店舗：月間窓口表（全角でも半角・照合が合わないと赤）
const sp = await login('S001', 'password');
await sp.goto(`${B}/admin/madoguchi?month=${M}`); await sp.waitForSelector('table[aria-label="月間窓口表"]');
const cell = (l) => sp.getByLabel(`10/2 ${l}`, { exact: true });
await cell('一部負担金').fill('４３９８０'); await cell('一部負担金').press('Tab');
await cell('自費').fill('65620'); await cell('自費').press('Tab');
await cell('鍼').fill('2000'); await cell('鍼').press('Tab');
await cell('不明金').fill('-500'); await cell('不明金').press('Tab');
await cell('金額を一致させてください 報告メール合計').fill('111100'); await cell('金額を一致させてください 報告メール合計').press('Tab');
await cell('金額を一致させてください 通帳入金額').fill('111000'); await cell('金額を一致させてください 通帳入金額').press('Tab');
await cell('保険請求金額').fill('130692'); await cell('保険請求金額').press('Tab');
await cell('自賠責請求金額').fill('31380'); await cell('自賠責請求金額').press('Enter');
await sp.waitForTimeout(1500);
let m = (await api(sp, 'GET', `/api/admin/madoguchi?month=${M}`))[1];
const d2 = m.days.find((d) => d.date === D);
ok('自動の計算（一部負担金合計・自費＋鍼・合計・照合の合計）', d2.vals.copay === 43980 && d2.calc.copayTotal === 43980 && d2.calc.selfAcu === 67620 && d2.calc.total === 111600 && d2.calc.match === 111100, JSON.stringify(d2.calc));
ok('通帳入金が合わない日', d2.calc.mismatch === true && m.mismatchDays === 1);
ok('売上＝合計＋保険請求＋自賠責', m.sales === 111600 + 130692 + 31380, String(m.sales));
const row2 = sp.locator('table[aria-label="月間窓口表"] tbody tr').nth(1); // 10/2（1 行目は 10/1）
ok('合わないと 3 列とも赤', (await row2.locator('td.bg-red-500').count()) === 3);
await sp.screenshot({ path: O + 'madoguchi-ng.png' });
await cell('金額を一致させてください 通帳入金額').fill('111100'); await cell('金額を一致させてください 通帳入金額').press('Enter'); await sp.waitForTimeout(1000);
m = (await api(sp, 'GET', `/api/admin/madoguchi?month=${M}`))[1];
ok('直すと合う', m.mismatchDays === 0 && (await row2.locator('td.bg-red-500').count()) === 0);
ok('木曜は休診日（グレー）', m.days.find((d) => d.date === '2026-10-01').closed === true);
await sp.screenshot({ path: O + 'madoguchi.png' });
// 物販内訳
await sp.getByRole('tab', { name: '物販内訳' }).click();
await sp.getByLabel('10/2 見本ゼロ', { exact: true }).fill('10'); await sp.getByLabel('10/2 見本ゼロ', { exact: true }).press('Tab');
await sp.getByLabel('10/2 見本テープ', { exact: true }).fill('3'); await sp.getByLabel('10/2 見本テープ', { exact: true }).press('Tab');
await sp.getByLabel('見本ゼロ 月初の在庫').fill('300'); await sp.getByLabel('見本ゼロ 月初の在庫').press('Enter');
await sp.waitForTimeout(1200);
m = (await api(sp, 'GET', `/api/admin/madoguchi?month=${M}`))[1];
ok('物販：販売合計・在庫', m.sum.goodsSales === 10 * 200 + 3 * 330 && Object.values(m.stockStart)[0] === 300, JSON.stringify([m.sum.goodsSales, m.stockStart]));
ok('月末の在庫', (await sp.locator('tfoot tr', { hasText: '月末の在庫' }).textContent()).includes('290'));
// 返戻
await sp.getByRole('tab', { name: '返戻' }).click();
await sp.getByRole('button', { name: '＋ 行を追加' }).first().click(); await sp.waitForTimeout(800);
const ht = sp.getByRole('table', { name: '返戻', exact: true });
await ht.getByLabel('患者様名').fill('見本 太郎'); await ht.getByLabel('患者様名').press('Tab');
await ht.getByLabel('請求額', { exact: true }).fill('11148'); await ht.getByLabel('請求額', { exact: true }).press('Enter');
await sp.waitForTimeout(1000);
m = (await api(sp, 'GET', `/api/admin/madoguchi?month=${M}`))[1];
ok('返戻の行', m.henrei.length === 1 && m.henrei[0].patient === '見本 太郎' && m.henrei[0].amount === 11148 && !m.henrei[0].special);
ok('店舗は経理確認できない', (await api(sp, 'PUT', '/api/admin/acct/madoguchi/check', { store: 'S001', month: M, checked: true }))[0] === 403);
ok('店舗は一覧を見られない', (await api(sp, 'GET', `/api/admin/acct/madoguchi?month=${M}`))[0] === 403);
const xr = await sp.evaluate(async (m) => { const r = await fetch(`/api/admin/madoguchi/export?month=${m}`); return [r.status, (await r.arrayBuffer()).byteLength]; }, M);
ok('店舗の Excel', xr[0] === 200 && xr[1] > 1000);

// ---- 本部：売上目標
ok('売上目標（本部）', (await api(hq, 'PUT', '/api/admin/acct/madoguchi/target', { store: 'S001', month: M, target: 3710000 }))[0] === 200);

// ---- 経理：一覧・確認・見るだけ・ほかの画面は出ない
const ac = await login('', 'keiripass1', 'keiri1');
ok('経理はログインすると窓口集計', /\/admin\/acct/.test(ac.url()), ac.url());
await ac.waitForSelector('table[aria-label="窓口集計の一覧"]');
const row1 = ac.locator('tbody tr', { hasText: 'サンプル本店' });
ok('一覧に売上・目標・達成率', (await row1.textContent()).includes('273,672') && (await row1.textContent()).includes('3,710,000') && (await row1.textContent()).includes('7%'), await row1.textContent());
await row1.getByRole('button', { name: '確認済みにする' }).click(); await ac.waitForSelector('text=経理確認済みにしました');
ok('経理確認', (await row1.textContent()).includes('済'));
ok('経理は売上目標を入れられない', (await api(ac, 'PUT', '/api/admin/acct/madoguchi/target', { store: 'S001', month: M, target: 1 }))[0] === 403);
await ac.screenshot({ path: O + 'acct.png' });
await row1.getByRole('link', { name: '開く' }).click(); await ac.waitForSelector('table[aria-label="月間窓口表"]');
ok('開くと見るだけ（入力欄なし）', (await ac.locator('table[aria-label="月間窓口表"] input').count()) === 0 && (await ac.textContent('main')).includes('見るだけ'));
ok('経理は入力できない（API）', (await api(ac, 'PUT', '/api/admin/madoguchi/day', { date: D, patch: { copay: 1 } }))[0] === 403);
ok('経理は予約表を開けない（API）', (await api(ac, 'GET', `/api/admin/day?date=${D}`))[0] === 403);
await ac.goto(`${B}/admin/day/${D}`); await ac.waitForURL(/\/admin\/acct/);
ok('経理が予約表を開くと窓口集計へ', true);
ok('経理は自賠集計を見られる', (await api(ac, 'GET', `/api/admin/hq/jibai?ym=${M}`))[0] === 200);
ok('経理は本部の設定を開けない', (await api(ac, 'GET', '/api/admin/hq/goods'))[0] === 403);
const nav = await ac.getByRole('navigation').textContent();
ok('経理のメニュー', nav.includes('窓口集計（全店）') && nav.includes('自賠集計') && !nav.includes('予約表'), nav);

// 店舗が直すと「確認後に変更あり」
await sp.getByRole('tab', { name: '月間窓口表' }).click();
await cell('第三者').fill('1000'); await cell('第三者').press('Enter'); await sp.waitForTimeout(1000);
await ac.goto(`${B}/admin/acct?month=${M}`); await ac.waitForSelector('table[aria-label="窓口集計の一覧"]');
ok('確認後に変更あり', (await ac.locator('tbody tr', { hasText: 'サンプル本店' }).textContent()).includes('確認後に変更あり'));

// ---- 管轄MG：エリアの店舗だけ・店舗と同じことができる
const mg = await login('', 'mgpass123', 'mg1');
const me = (await api(mg, 'GET', '/api/admin/me'))[1];
ok('管轄MG：表示中はエリアの店舗', me.store?.code === 'S002' && me.stores.map((s) => s.code).join() === 'S002', JSON.stringify([me.store?.code, me.stores.map((s) => s.code)]));
ok('管轄MG：予約表を直せる', (await api(mg, 'PUT', '/api/admin/cells', { date: D, cells: [{ time: 540, bed: 1, text: '見本 MG入力' }] }))[0] === 200);
const sw = await mg.evaluate(async () => { const f = new FormData(); f.set('store', 'S001'); f.set('back', '/admin'); const r = await fetch('/api/admin/switch', { method: 'POST', body: f, redirect: 'manual' }); return r.status; });
ok('管轄外の店舗には切り替えられない', sw === 404, String(sw));
ok('管轄MG：本部の画面は開けない', (await api(mg, 'GET', '/api/admin/hq/goods'))[0] === 403);
const mgList = (await api(mg, 'GET', `/api/admin/acct/madoguchi?month=${M}`))[1];
ok('管轄MG：窓口集計の一覧はエリアの店舗だけ', mgList.rows.length === 1 && mgList.rows[0].code === 'S002' && !mgList.canCheck);
ok('管轄MG：管轄外の店舗の窓口表は見られない', (await api(mg, 'GET', `/api/admin/madoguchi?month=${M}&store=S001`))[0] === 404);
const kh = (await api(mg, 'GET', `/api/admin/hq/karte?from=${M}-01&to=${M}-31`))[1];
ok('管轄MG：新患・再来集計はエリアの店舗', kh.stores.length === 1 && kh.stores[0].code === 'S002');
const nav2 = await mg.getByRole('navigation').textContent();
ok('管轄MG のメニュー', nav2.includes('予約表') && nav2.includes('エリアの窓口集計') && !nav2.includes('本部メニュー'), nav2);
// 本部でアカウントを止めると、すぐ使えなくなる
const accs = (await api(hq, 'GET', '/api/admin/hq/accounts'))[1].accounts;
await api(hq, 'PUT', '/api/admin/hq/accounts', { id: accs.find((a) => a.code === 'mg1').id, active: false });
ok('止めた管轄MG は使えない', (await api(mg, 'GET', '/api/admin/me'))[0] === 401);
ok('ページのエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
