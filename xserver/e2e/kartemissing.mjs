// Xserver（PHP）版：新患継続率の未入力。店舗＝「⚠ 未入力」を押すとどの行のどの欄か。管轄MG＝管轄店舗の未入力の店舗と中身（氏名は出さない）
// 例：BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... CHROMIUM_PATH=... node e2e/kartemissing.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003', O = new URL('./', import.meta.url).pathname + 'out-';
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
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10), M = today.slice(0, 7);
// S001 に 2 行（1 行は全部入れる、1 行はカルテNo・症状だけ空）、S002 に 1 行（未入力）
const s1 = await login('S001', 'password');
const add = async (p, patch) => { const id = (await api(p, 'POST', '/api/admin/karte', { date: today }))[1].row.id; await api(p, 'PATCH', '/api/admin/karte', { id, patch }); return id; };
const full = { kind: 'NEW', name: '見本 全部', karteNo: '1001', trig: 'Google', age: '40', sex: '♂', symptomCat: '腰', symptom: '腰痛', staff: '見本', treatment: '矯正' };
await add(s1, full);
await add(s1, { ...full, name: '見本 空き', karteNo: '', symptom: '' });
const s2 = await login('S002', 'password');
await add(s2, { kind: 'ACCIDENT', name: '見本 別店' });
const hq = await login('', process.env.HQ_PASSWORD ?? 'hq-pass', 'HQ');
await api(hq, 'PUT', '/api/admin/hq/areas', { areas: [{ name: '見本エリア', stores: ['S001'] }] });
await api(hq, 'POST', '/api/admin/hq/accounts', { code: 'mgk1', name: '見本 MG', password: 'mgpass123', role: 'mg', area: '見本エリア' });

// ---- 店舗：「⚠ 未入力 1件」を押すと中身
await s1.goto(`${B}/admin/karte?month=${M}`); await s1.waitForLoadState('networkidle');
await s1.getByRole('button', { name: /未入力 1件/ }).click();
const box = s1.getByRole('region', { name: '未入力の中身' });
const bt = await box.textContent();
ok('店舗：未入力を押すと、どの行のどの欄か出る', bt.includes('見本空き') && bt.includes('カルテNo・症状') && !bt.includes('見本全部'), bt);
await box.getByRole('button', { name: /見本空き/ }).click(); await s1.waitForTimeout(600);
ok('押すとその行へ', await s1.locator('tr[id^="karte-row-"].bg-yellow-100').count() === 1);
ok('メニューの「新患継続率」に未入力の数（今月・先月）', (await api(s1, 'GET', '/api/admin/me'))[1].karteMissing === 1 && await s1.getByLabel('新患継続率の未入力 1件').isVisible());
await s1.screenshot({ path: O + 'karte-missing-store.png', clip: { x: 0, y: 0, width: 1300, height: 360 } });

// ---- 管轄MG：管轄店舗（S001）の未入力だけ。氏名は出さない
const mg = await login('', 'mgpass123', 'mgk1');
await mg.goto(`${B}/admin/hq/karte`); await mg.waitForLoadState('networkidle');
const reg = mg.getByRole('region', { name: '未入力のある店舗' });
let t = await reg.textContent();
ok('MG：管轄店舗の未入力（S001 だけ・件数）', t.includes('管轄店舗の未入力') && t.includes('サンプル本店') && t.includes('未入力 1件') && !t.includes('サンプル駅前院'), t);
await reg.getByRole('button', { name: /サンプル本店/ }).click();
t = await reg.textContent();
ok('MG：押すと中身（区分・欄）。氏名は出ない', t.includes('新患') && t.includes('カルテNo・症状') && !t.includes('見本空き'), t);
ok('MG：その店舗の新患継続率を開くリンク', (await reg.getByRole('link', { name: /新患継続率を開く/ }).getAttribute('href')).includes('store=S001'));
await reg.screenshot({ path: O + 'karte-missing-mg.png' });
ok('MG のメニューに新患・再来集計', (await mg.locator('a[href="/admin/hq/karte"]').count()) >= 1);
// ---- 本部：全体なら両方の店舗
await hq.goto(`${B}/admin/hq/karte`); await hq.waitForLoadState('networkidle');
t = await hq.getByRole('region', { name: '未入力のある店舗' }).textContent();
ok('本部：全体の未入力のある店舗（2 店）', t.includes('サンプル本店') && t.includes('サンプル駅前院'), t);
ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
console.log(process.exitCode ? 'KARTEMISSING FAILED' : 'KARTEMISSING OK');
