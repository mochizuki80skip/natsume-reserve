// Xserver（PHP）版：自賠の未請求者リスト（新自で、自賠請求のスクショの明細に同じカルテNo が無い方）。店舗＝自店舗（理由・除く）、本部・管轄MG＝店舗ごとの人数
// 例：BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... CHROMIUM_PATH=... node e2e/jibaiunclaimed.mjs
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
const ym = today.slice(0, 7);
const lastMonth = (() => { const d = new Date(`${ym}-15T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
const s1 = await login('S001', 'password');
const add = async (date, patch) => { const id = (await api(s1, 'POST', '/api/admin/karte', { date }))[1].row.id; await api(s1, 'PATCH', '/api/admin/karte', { id, patch }); return id; };
await add(`${lastMonth}-05`, { kind: 'ACCIDENT', name: '見本 請求済', karteNo: '0120' });
await add(`${lastMonth}-06`, { kind: 'ACCIDENT', name: '見本 未請求', karteNo: '300' });
await add(`${lastMonth}-07`, { kind: 'ACCIDENT', name: '見本 番号なし' });
await add(`${lastMonth}-08`, { kind: 'THIRD', name: '見本 第三者', karteNo: '500' });
await add(today, { kind: 'ACCIDENT', name: '見本 今月', karteNo: '400' });
// 先月から自賠請求を使っている。今月の画面で、カルテNo 120 の方を請求（頭の 0 の有無は同じ番号とみなす）
const sid = sql("SELECT id FROM store WHERE code='S001'");
sql(`INSERT INTO jibai_month (id, storeId, ym, status) VALUES ('jmtest1', '${sid}', '${lastMonth}', 'DRAFT')`);
await api(s1, 'PUT', '/api/admin/jibai/claims', { ym, claims: [{ patientNo: '120', patientName: '見本 請求済', invoiceYm: ym, days: 3, amount: 21000 }] });

let r = (await api(s1, 'GET', '/api/admin/jibai/unclaimed'))[1];
ok('店舗：新自で請求スクショにカルテNo が無い方（番号なしも）', r.rows.map((x) => x.name).sort().join(',') === ['見本番号なし', '見本未請求'].sort().join(',') && r.count === 2, JSON.stringify(r.rows.map((x) => x.name)));
ok('第三者・今月の初診・請求済みの方は出ない', !r.rows.some((x) => /第三者|今月|請求済/.test(x.name)));
await s1.goto(`${B}/admin/jibai`); await s1.waitForLoadState('networkidle');
const sec = s1.getByRole('region', { name: '自賠の未請求者' });
ok('自賠請求のページに出る（2 人）', (await sec.textContent()).includes('2 人') && (await sec.textContent()).includes('未入力（新患継続率で入れてください）'));
await sec.getByLabel('見本未請求 の理由').fill('書類待ち'); await sec.getByLabel('見本未請求 の理由').blur(); await s1.waitForTimeout(600);
await sec.getByLabel('見本番号なし を除く').click(); await s1.waitForTimeout(800);
r = (await api(s1, 'GET', '/api/admin/jibai/unclaimed'))[1];
ok('理由を入れられる・除くと人数から外れる', r.rows.find((x) => x.name === '見本未請求').reason === '書類待ち' && r.count === 1);
await s1.screenshot({ path: O + 'jibai-unclaimed-store.png', fullPage: true });

// ---- 本部・管轄MG：店舗ごとの人数
const hq = await login('', process.env.HQ_PASSWORD ?? 'hq-pass', 'HQ');
r = (await api(hq, 'GET', '/api/admin/jibai/unclaimed'))[1];
ok('本部：店舗ごとの人数', r.stores.find((s) => s.code === 'S001').count === 1 && r.stores.find((s) => s.code === 'S002').count === 0);
await hq.goto(`${B}/admin/hq/jibai`); await hq.waitForLoadState('networkidle');
const hs = hq.getByRole('region', { name: '自賠の未請求者（店舗ごと）' });
await hs.getByRole('button', { name: /未請求 サンプル本店 1人/ }).click();
ok('本部：店舗を押すと一覧（理由も）', (await hs.textContent()).includes('見本未請求') && (await hs.textContent()).includes('書類待ち'));
await hs.screenshot({ path: O + 'jibai-unclaimed-hq.png' });
ok('本部は理由を直せない（店舗が入れる）…ただし API は直せる権限のある人だけ', (await api(hq, 'PUT', '/api/admin/jibai/unclaimed', { id: r.stores[0].rows[0].id, reason: '本部メモ' }))[0] === 200);
await api(hq, 'PUT', '/api/admin/hq/areas', { areas: [{ name: '見本エリア', stores: ['S002'] }] });
await api(hq, 'POST', '/api/admin/hq/accounts', { code: 'mgju', name: '見本 MG', password: 'mgpass123', role: 'mg', area: '見本エリア' });
const mg = await login('', 'mgpass123', 'mgju');
r = (await api(mg, 'GET', '/api/admin/jibai/unclaimed'))[1];
ok('MG：店舗ごとの人数が見える', r.stores.find((s) => s.code === 'S001').count === 1);
ok('MG：管轄外の理由は直せない', (await api(mg, 'PUT', '/api/admin/jibai/unclaimed', { id: r.stores.find((s) => s.code === 'S001').rows[0].id, reason: 'x' }))[0] === 403);
const s2 = await login('S002', 'password');
ok('店舗はほかの店舗の行を直せない', (await api(s2, 'PUT', '/api/admin/jibai/unclaimed', { id: r.stores.find((s) => s.code === 'S001').rows[0].id, reason: 'x' }))[0] === 404);
ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
console.log(process.exitCode ? 'JIBAIUNCLAIMED FAILED' : 'JIBAIUNCLAIMED OK');
