// Xserver（PHP）版：店舗設定のスタッフ「施術者 ⇄ 受付」を登録後に変える（サンプル店舗 S001）
// 例：BASE_URL=http://127.0.0.1:3003 CHROMIUM_PATH=... node e2e/staffrole.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const errs = [];
const p = await br.newPage({ viewport: { width: 1366, height: 1000 } });
p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
await p.goto(`${B}/admin/login/S001`); await p.fill('input[type=password]', 'password'); await p.click('button[type=submit]'); await p.waitForURL(/admin\/day/);
const api = (m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);
const member = async (n) => (await api('GET', '/api/admin/settings'))[1].members.find((m) => m.name === n);

await api('POST', '/api/admin/staff-members', { name: '見本 受付子', role: 'RECEPTION' });
await p.goto(`${B}/admin/settings`); await p.waitForTimeout(1000);
await p.getByLabel('見本 受付子 施術者・受付').selectOption('THERAPIST'); await p.waitForTimeout(1000);
ok('受付 → 施術者に変えられる', (await member('見本 受付子')).role === 'THERAPIST');
await api('PUT', '/api/admin/staff-members', { id: (await member('見本 受付子')).id, isHead: true, canFirst: true, canRevisit: true });
await p.reload(); await p.waitForTimeout(1000);
await p.getByLabel('見本 受付子 施術者・受付').selectOption('RECEPTION'); await p.waitForTimeout(1000);
const m = await member('見本 受付子');
ok('施術者 → 受付に変えると、院長・初回・再来のチェックは外れる', m.role === 'RECEPTION' && !m.isHead && !m.canFirst && !m.canRevisit, JSON.stringify(m));
// 人数の上限：受付の上限を 1 にして、施術者をもう 1 人受付に変えようとすると止まる
const s0 = (await api('GET', '/api/admin/settings'))[1].store;
await api('PUT', '/api/admin/store', { ...s0, hoursOverride: s0.hoursOverride || null, maxReception: 1 });
await api('POST', '/api/admin/staff-members', { name: '見本 施術男', role: 'THERAPIST' });
const r = await api('PUT', '/api/admin/staff-members', { id: (await member('見本 施術男')).id, role: 'RECEPTION' });
ok('変えた先の上限を超えるときは変えられない', r[0] === 400 && (r[1]?.error ?? '').includes('受付は最大 1 名'), JSON.stringify(r));
await api('PUT', '/api/admin/store', { ...s0, hoursOverride: s0.hoursOverride || null });

ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
console.log(process.exitCode ? 'STAFFROLE FAILED' : 'STAFFROLE OK');
