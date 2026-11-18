// Xserver（PHP）版：本部の「WEB予約の設定チェック」（店舗ごとに済んでいない設定を一覧にする・見るだけ）
// 例：BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... CHROMIUM_PATH=... node e2e/setupcheck.mjs
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003';
const DB = process.env.DB_NAME ?? 'booking';
const sql = (q) => execSync(`mysql -uroot --default-character-set=utf8mb4 -N ${DB}`, { input: q }).toString().trim();
const O = new URL('./', import.meta.url).pathname + 'out-';
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
sql('DELETE FROM rate_limit');
const st = await login('S001', 'password');
ok('店舗のアカウントでは見られない', (await api(st, 'GET', '/api/admin/hq/setup-check'))[0] === 403);
const hq = await login('', process.env.HQ_PASSWORD ?? 'hq-pass', 'HQ');
const keys = async (code) => ((await api(hq, 'GET', '/api/admin/hq/setup-check'))[1].stores.find((s) => s.code === code)?.issues ?? []).map((i) => i.key);
let k = await keys('S001');
ok('見本の店舗：見本・電話番号・住所・地図・患者一覧・初期パスワードが出る', ['sample', 'phone', 'address', 'map', 'patients', 'password'].every((x) => k.includes(x)), k.join(','));
// 直すと消える
const sid = sql("SELECT id FROM store WHERE code='S002'");
sql(`UPDATE store SET name='駅前テスト院', phone='055-123-4567', address='静岡県静岡市葵区1-1', lat=34.9, lng=138.3, listed=1, patientsImportedAt=NOW() WHERE id='${sid}'`);
sql(`DELETE FROM shift WHERE storeId='${sid}'`); sql(`DELETE FROM staff_member WHERE storeId='${sid}'`);
k = await keys('S002');
ok('施術者がいないと「施術者」が出る', k.includes('staff') && !k.includes('phone') && !k.includes('address') && !k.includes('sample'), k.join(','));
sql(`INSERT INTO staff_member (id, storeId, name, role, canFirst, canRevisit) VALUES ('sc1', '${sid}', '見本 施術', 'THERAPIST', 1, 0)`);
k = await keys('S002');
ok('再来の担当がいない・シフトが入っていない日が出る', k.includes('revisit') && !k.includes('first') && k.includes('shift'), k.join(','));
const today = new Date(Date.now() + 9 * 3600e3);
for (let i = 0; i < 14; i++) { const d = new Date(today.getTime() + i * 864e5).toISOString().slice(0, 10); sql(`INSERT IGNORE INTO shift (id, storeId, staffId, date, status) VALUES ('sc${i}x', '${sid}', 'sc1', '${d}', 'WORK')`); }
sql(`UPDATE staff_member SET canRevisit=1 WHERE id='sc1'`);
await api(hq, 'PUT', '/api/admin/hq/stores', { code: 'S002', action: 'reset', password: 'kakunin-pass-1' });
k = await keys('S002');
ok('直すと消える（S002 は残りなし）', k.length === 0, k.join(','));

// 画面
await hq.goto(`${B}/admin/hq`); await hq.waitForLoadState('networkidle');
const sec = hq.getByRole('region', { name: 'WEB予約の設定チェック' });
await sec.getByRole('button', { name: 'チェックする' }).click();
await sec.getByRole('status').waitFor();
ok('残っている店舗の数', (await sec.getByRole('status').textContent()).includes('設定が残っている店舗：1 店'), await sec.getByRole('status').textContent());
ok('サンプル本店の残りが出る', (await sec.getByLabel('サンプル本店の残り').textContent()).includes('店舗のパスワードが初期のままです'));
ok('済んでいる店舗も出る', (await sec.textContent()).includes('済んでいる店舗：駅前テスト院'));
await sec.screenshot({ path: O + 'setupcheck.png' });
ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
console.log(process.exitCode ? 'SETUPCHECK FAILED' : 'SETUPCHECK OK');
