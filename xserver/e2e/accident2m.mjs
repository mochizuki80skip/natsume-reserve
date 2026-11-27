// Xserver（PHP）版：新自・新三の 2ヶ月経過のリスト（継続・中止・終了）と、離反の未入力のアラート（今月・先月）
// 例：BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... CHROMIUM_PATH=... node e2e/accident2m.mjs
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003', O = new URL('./', import.meta.url).pathname + 'out-';
const DB = process.env.DB_NAME ?? 'booking';
const sql = (q) => execSync(`mysql -uroot --default-character-set=utf8mb4 -N ${DB}`, { input: q }).toString().trim();
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const errs = [];
async function login(code, pass, user) {
  const p = await (await br.newContext({ viewport: { width: 1300, height: 1000 } })).newPage();
  p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  if (user) { await p.goto(`${B}/admin/login`); await p.fill('input[autocomplete="username"]', user); } else await p.goto(`${B}/admin/login/${code}`);
  await p.fill('input[type=password]', pass); await p.click('button[type=submit]'); await p.waitForURL((u) => !u.pathname.includes('/login')); await p.waitForLoadState('networkidle');
  return p;
}
const api = (p, m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const back = (months, days = 0) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - months); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0, 10); };
const s1 = await login('S001', 'password');
const add = async (p, date, patch) => { const rr = await api(p, 'POST', '/api/admin/karte', { date }); if (!rr[1]?.row) console.log('ADD', JSON.stringify(rr)); const id = rr[1].row.id; await api(p, 'PATCH', '/api/admin/karte', { id, patch }); return id; };
const oldA = await add(s1, back(2, 5), { kind: 'ACCIDENT', name: '見本 二月', trig: '交通事故HP' });
await add(s1, back(1), { kind: 'ACCIDENT', name: '見本 一月' });
const oldT = await add(s1, back(3), { kind: 'THIRD', name: '見本 三月' });
const s2 = await login('S002', 'password');
await add(s2, back(2, 1), { kind: 'ACCIDENT', name: '見本 別店' });

// ---- 店舗
let r = (await api(s1, 'GET', '/api/admin/accidents/two-months'))[1];
ok('店舗：2ヶ月たった新自・新三だけ（自店舗）', r.rows.map((x) => x.name).sort().join(',') === '見本三月,見本二月', r.rows.map((x) => x.name).join(','));
ok('メニューに未選択の件数', (await api(s1, 'GET', '/api/admin/me'))[1].accidentTwoMonths === 2);
await s1.goto(`${B}/admin/karte`); await s1.waitForLoadState('networkidle');
const sec = s1.getByRole('region', { name: '2ヶ月経過の交通事故の患者様' });
ok('新患継続率の下に出る（きっかけ・経過）', (await sec.textContent()).includes('交通事故HP') && (await sec.textContent()).includes('2ヶ月5日'), await sec.textContent());
await sec.getByLabel('見本二月 の状態').selectOption('CONT'); await s1.waitForTimeout(800);
ok('「継続」はリストに残る', (await api(s1, 'GET', '/api/admin/accidents/two-months'))[1].rows.some((x) => x.name === '見本二月' && x.status === 'CONT'));
await sec.getByLabel('見本三月 の状態').selectOption('END'); await s1.waitForTimeout(800);
r = (await api(s1, 'GET', '/api/admin/accidents/two-months'))[1];
ok('「終了」はリストから外れる', !r.rows.some((x) => x.name === '見本三月') && r.rows.length === 1);
ok('未選択がなくなればメニューの数字も 0', (await api(s1, 'GET', '/api/admin/me'))[1].accidentTwoMonths === 0);
await s1.screenshot({ path: O + 'accident2m-store.png', fullPage: true });

// ---- 管轄MG（S001 だけ管轄）・本部
const hq = await login('', process.env.HQ_PASSWORD ?? 'hq-pass', 'HQ');
await api(hq, 'PUT', '/api/admin/hq/areas', { areas: [{ name: '見本エリア', stores: ['S001'] }] });
await api(hq, 'POST', '/api/admin/hq/accounts', { code: 'mg2m', name: '見本 MG', password: 'mgpass123', role: 'mg', area: '見本エリア' });
const mg = await login('', 'mgpass123', 'mg2m');
r = (await api(mg, 'GET', '/api/admin/accidents/two-months'))[1];
ok('MG：全店が見えて、管轄外も直せる', r.rows.length === 2 && r.rows.every((x) => x.canEdit === true));
ok('MG：管轄外も選べる', (await api(mg, 'PUT', '/api/admin/accidents/status', { id: r.rows.find((x) => x.store === 'S002').id, status: 'CONT' }))[0] === 200);
await api(mg, 'PUT', '/api/admin/accidents/status', { id: r.rows.find((x) => x.store === 'S002').id, status: '' }); // 元に戻す（このあとの数字の確認のため）
ok('MG：メニューの数字は管轄の店舗だけ（0）', (await api(mg, 'GET', '/api/admin/me'))[1].accidentTwoMonths === 0);
ok('本部：メニューの数字は全店（S002 の 1）', (await api(hq, 'GET', '/api/admin/me'))[1].accidentTwoMonths === 1);
await hq.goto(`${B}/admin/hq/accidents`); await hq.waitForLoadState('networkidle');
ok('本部：新自・新三（全店）に 2ヶ月経過（店舗名つき）', (await hq.getByRole('region', { name: '2ヶ月経過の交通事故の患者様' }).textContent()).includes('サンプル駅前院'));
ok('店舗はほかの店舗の行を選べない', (await api(s1, 'PUT', '/api/admin/accidents/status', { id: r.rows.find((x) => x.store === 'S002').id, status: 'END' }))[0] === 404);

// ---- 離反の未入力（今月・先月）
const sid = sql("SELECT id FROM store WHERE code='S001'");
sql(`DELETE FROM app_meta WHERE k LIKE 'churnSync:%'`);
sql(`INSERT INTO churn (id, storeId, churnDate, name, source) VALUES ('ch1', '${sid}', '${today}', '見本 離反', 'manual'), ('ch2', '${sid}', '${back(1)}', '見本 先月', 'manual'), ('ch3', '${sid}', '${back(3)}', '見本 前々', 'manual'), ('ch4', '${sid}', '${today}', '見本 済み', 'manual')`);
sql(`UPDATE churn SET manage = '治癒' WHERE id = 'ch4'`);
ok('離反：今月と先月の未入力だけ数える（2）', (await api(s1, 'GET', '/api/admin/me'))[1].churnMissing === 2, String((await api(s1, 'GET', '/api/admin/me'))[1].churnMissing));
await s1.goto(`${B}/admin/day/${today}`); await s1.waitForLoadState('networkidle');
ok('メニューの「離反」に赤い数字', await s1.getByLabel('離反の未入力 2件').isVisible());
ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
console.log(process.exitCode ? 'ACCIDENT2M FAILED' : 'ACCIDENT2M OK');
