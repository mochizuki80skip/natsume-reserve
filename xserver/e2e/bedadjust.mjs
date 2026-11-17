// Xserver（PHP）版：WEB 解放ベッド数＝シフトで〇の施術者の人数＋店舗設定の「WEB解放ベッドの足し引き」
// 例：BASE_URL=http://127.0.0.1:3003 CHROMIUM_PATH=... node e2e/bedadjust.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003', O = new URL('./', import.meta.url).pathname + 'out-';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const p = await br.newPage({ viewport: { width: 1300, height: 1000 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
await p.goto(`${B}/admin/login/S001`); await p.fill('input[type=password]', 'password'); await p.click('button[type=submit]'); await p.waitForURL(/admin\/day/); await p.waitForLoadState('networkidle');
const api = (m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);
const D = (() => { const d = new Date(); d.setDate(d.getDate() + 3); for (;;) { const s = d.toISOString().slice(0, 10); if ([1, 2, 3, 5].includes(d.getDay()) && !['2026-11-23', '2027-01-01'].includes(s)) return s; d.setDate(d.getDate() + 1); } })();
for (const n of ['見本 一', '見本 二', '見本 三', '見本 四']) await api('POST', '/api/admin/staff-members', { name: n, role: 'THERAPIST' });
const mem = (await api('GET', '/api/admin/settings'))[1].members;
const id = (n) => mem.find((m) => m.name === n).id;
// 4 人のうち 1 人は休み（週 2 日の休み）→ 〇は 3 人
await api('PUT', '/api/admin/shifts', { staffId: id('見本 四'), date: D, status: 'OFF' });
const cap = async () => (await api('GET', `/api/admin/day?date=${D}`))[1].data.capacity;
let c = await cap();
ok('足し引きなし：〇の 3 人 → 3 ベッド', c.am === 3 && c.pm === 3, JSON.stringify([c.am, c.pm]));
const st = (await api('GET', '/api/admin/settings'))[1].store;
ok('店舗設定に足し引き（はじめは 0）', st.bedAdjust === 0);
// 画面で +1 にする
await p.goto(`${B}/admin/settings`); await p.waitForLoadState('networkidle');
await p.getByLabel('WEB解放ベッドの足し引き').fill('1');
await p.getByRole('button', { name: /^保存/ }).first().click(); await p.waitForTimeout(1000);
c = await cap();
ok('「+1」→ 〇の 3 人＋1 ＝ 4 ベッド', c.am === 4 && c.pm === 4, JSON.stringify([c.am, c.pm]));
// 〇が 0 人の時間は足さない
for (const n of ['見本 一', '見本 二', '見本 三']) await api('PUT', '/api/admin/shifts', { staffId: id(n), date: D, status: 'PM_OFF' });
c = await cap();
ok('午後は〇が 0 人 → 0（足さない）・午前は 4', c.pm === 0 && c.am === 4, JSON.stringify([c.am, c.pm]));
// ベッド数より多くはならない・マイナス
const put = async (v) => { const r = await api('PUT', '/api/admin/store', { ...(await api('GET', '/api/admin/settings'))[1].store, hoursOverride: null, bedAdjust: v }); return r; };
const r20 = await put(20);
ok('ベッド数まで', (await cap()).am === 8, JSON.stringify([r20, (await cap()).am]));
await put(-1);
ok('「-1」→ 2 ベッド', (await cap()).am === 2);
// シフト表の「顧客に見える枠数」も同じ
await p.goto(`${B}/admin/shifts`); await p.waitForLoadState('networkidle');
await p.screenshot({ path: O + 'bedadjust-shifts.png' });
ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
console.log(process.exitCode ? 'BEDADJUST FAILED' : 'BEDADJUST OK');
