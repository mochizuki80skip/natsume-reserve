// Xserver（PHP）版：新自・新三（全店）。本部・管轄MG（全店）が事故日・事故内容を見るだけ。未入力の件数・絞り込み・前の月の未入力・Excel
// 例：BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... CHROMIUM_PATH=... node e2e/accidentshq.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const errs = [];
async function login(code, pass, user) {
  const p = await (await br.newContext({ viewport: { width: 1366, height: 1000 } })).newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  if (user) { await p.goto(`${B}/admin/login`); await p.fill('input[autocomplete="username"]', user); } else await p.goto(`${B}/admin/login/${code}`);
  await p.fill('input[type=password]', pass); await p.click('button[type=submit]'); await p.waitForURL(/admin\//); await p.waitForTimeout(500);
  return p;
}
const api = (p, m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);
const add = (d, n) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

// 店舗：今月に新自（S001・入力済み）・新三（S002・未入力）、前の月に新自（S002・未入力）
const s1 = await login('S001', 'password');
const today = (await api(s1, 'GET', '/api/admin/me'))[1].today;
const ym = today.slice(0, 7), prev = add(`${ym}-01`, -20);
const seed = async (p, date, text) => { await api(p, 'PUT', '/api/admin/cells', { date, cells: [{ time: 540, bed: 1, text }] }); await api(p, 'PUT', '/api/admin/visit', { date, time: 540, bed: 1, visited: true }); };
await seed(s1, today, '見本 太郎（初自）');
const k1 = (await api(s1, 'GET', `/api/admin/karte?month=${ym}`))[1].rows.find((r) => r.name.includes('太郎'));
await api(s1, 'PATCH', '/api/admin/karte', { id: k1.id, patch: { accidentDate: add(today, -3), accidentNote: '交差点で追突された（見本）' } });
const s2 = await login('S002', 'password');
await seed(s2, today, '見本 花子（新三）');
await seed(s2, prev, '見本 次郎（初自）');

// 本部・管轄MG のアカウント
const hq = await login('', process.env.HQ_PASSWORD ?? 'hq-pass', 'HQ');
await api(hq, 'PUT', '/api/admin/hq/areas', { areas: [{ name: '見本エリア', stores: ['S002'] }] });
await api(hq, 'POST', '/api/admin/hq/accounts', { code: 'mg1', name: '見本 MG', password: 'mgpass123', role: 'mg', area: '見本エリア' });
ok('本部メニューに「新自・新三（全店）」', (await hq.locator('a[href="/admin/hq/accidents"]').count()) >= 1);
await hq.goto(`${B}/admin/hq/accidents?month=${ym}`); await hq.waitForSelector('table[aria-label="新自・新三（全店）"]');
await hq.waitForTimeout(800);
const t = hq.locator('table[aria-label="新自・新三（全店）"] tbody');
const txt = await t.textContent();
ok('全店の新自・新三が出る（氏名・事故日・事故内容）', txt.includes('見本太郎') && txt.includes('交差点で追突された（見本）') && txt.includes('新三') && txt.includes('サンプル駅前院'), txt.slice(0, 200));
ok('前の月の未入力も出る', txt.includes('見本次郎') && txt.includes('前の月の未入力'));
ok('入力欄はない（見るだけ）', (await t.locator('input, textarea').count()) === 0);
const miss = await hq.getByRole('group', { name: '店舗ごとの未入力' }).textContent();
ok('店舗ごとの未入力の件数', miss.includes('サンプル駅前院 2 件') && !miss.includes('サンプル本店'), miss);
await hq.getByRole('group', { name: '店舗ごとの未入力' }).getByRole('button', { name: /サンプル駅前院/ }).click(); await hq.waitForTimeout(300);
ok('押すとその店舗の未入力だけ', (await t.locator('tr').count()) === 2 && !(await t.textContent()).includes('太郎'));
await hq.screenshot({ path: new URL('./out-accidents-hq.png', import.meta.url).pathname });
ok('Excel', (await hq.evaluate(async (m) => (await fetch(`/api/admin/hq/accidents/export?month=${m}`)).headers.get('content-type'), ym)).includes('spreadsheet'));

const mg = await login('', 'mgpass123', 'mg1');
ok('管轄MG のメニューに「新自・新三（全店）」', (await mg.locator('a[href="/admin/hq/accidents"]').count()) >= 1);
const mr = (await api(mg, 'GET', `/api/admin/hq/accidents?month=${ym}`))[1];
ok('管轄MG は全店を見られる（管轄外の S001 も）', mr.rows.some((r) => r.store === 'S001') && mr.rows.some((r) => r.store === 'S002'));
ok('店舗は見られない', (await api(s1, 'GET', `/api/admin/hq/accidents?month=${ym}`))[0] === 403);
ok('人員配置の名前', (await hq.locator('a[href="/admin/staffing"]').first().textContent()) === '人員配置');

ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
console.log(process.exitCode ? 'ACCIDENTSHQ FAILED' : 'ACCIDENTSHQ OK');
