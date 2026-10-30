// Xserver（PHP）版：本部の全店共通の営業時間（入れやすい形・店舗だけの時間を全店共通に戻す）と、特別な営業日をまとめて入れる（本部＝全店、管轄MG＝管轄の店舗）
// 例：BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... CHROMIUM_PATH=... node e2e/specialbulk.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const errs = [];
async function login(code, pass, user) {
  const ctx = await br.newContext({ viewport: { width: 1366, height: 1000 } });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  if (user) { await p.goto(`${B}/admin/login`); await p.fill('input[autocomplete="username"]', user); } else await p.goto(`${B}/admin/login/${code}`);
  await p.fill('input[type=password]', pass); await p.click('button[type=submit]'); await p.waitForURL(/admin\/(day|hq|overview)/); await p.waitForTimeout(500);
  return p;
}
const api = (p, m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);
const D = (() => { const d = new Date(); d.setDate(d.getDate() + 3); for (;;) { const s = d.toISOString().slice(0, 10); if ([1, 2, 3, 5].includes(d.getDay()) && !['2026-11-03', '2026-11-23', '2027-01-01'].includes(s)) return s; d.setDate(d.getDate() + 1); } })();
const D1 = (() => { const d = new Date(D + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();

const hq = await login('', process.env.HQ_PASSWORD ?? 'hq-pass', 'HQ');
// 1) 全店共通の営業時間：店舗設定と同じ入れ方
await hq.goto(`${B}/admin/hq`); await hq.waitForTimeout(1200);
const g = hq.getByRole('group', { name: '全店共通の営業時間' });
ok('全店共通の営業時間が曜日ごとの入れ方', await g.getByLabel('月 午前 開始').first().isVisible());
await g.getByLabel('月 午前 開始').first().fill('09:30');
await hq.getByRole('button', { name: '共通設定を保存' }).click(); await hq.waitForTimeout(1000);
ok('保存すると全店共通の時間が変わる', ((await api(hq, 'GET', '/api/admin/hq'))[1].setting.hours ?? '').includes('09:30'));
await g.getByLabel('月 午前 開始').first().fill('09:00');
await hq.getByRole('button', { name: '共通設定を保存' }).click(); await hq.waitForTimeout(800);

// 店舗だけの営業時間 → 一覧に出て「全店共通に戻す」
const s2 = await login('S002', 'password');
const st2 = (await api(s2, 'GET', '/api/admin/settings'))[1].store;
const own = { periods: [{ byWeekday: { 1: [['10:00', '11:45']], 2: [['10:00', '11:45']] } }] };
ok('店舗が自分の営業時間を入れる', (await api(s2, 'PUT', '/api/admin/store', { ...st2, hoursOverride: own }))[0] === 200);
await hq.reload(); await hq.waitForTimeout(1200);
ok('店舗だけの営業時間を使っている店舗が出る', (await hq.getByLabel('店舗だけの営業時間を使っている店舗').textContent()).includes('サンプル駅前'));
await hq.getByRole('button', { name: /サンプル駅前.* を全店共通に戻す/ }).click(); await hq.waitForTimeout(1200);
ok('全店共通に戻す', !(await api(hq, 'GET', '/api/admin/hq'))[1].stores.find((s) => s.code === 'S002').ownHours);

// 2) 特別な営業日をまとめて入れる（時間の外の予約は知らせる）
const s1 = await login('S001', 'password');
await api(s1, 'PUT', '/api/admin/cells', { date: D, cells: [{ time: 900, bed: 1, text: '見本 午後' }] });
await hq.reload(); await hq.waitForTimeout(1200);
const sec = hq.getByRole('region', { name: '特別な営業日（まとめて）' });
await sec.getByLabel('特別営業の始めの日').fill(D);
await sec.getByLabel('特別営業の終わりの日').fill(D1);
await sec.getByLabel('午前の始め').fill('09:00'); await sec.getByLabel('午前の受付の最後').fill('11:45');
await sec.getByLabel('特別営業のメモ').fill('見本の時短営業');
await sec.getByRole('button', { name: '選んだ店舗に入れる' }).click(); await hq.waitForTimeout(1500);
ok('全店に入る（2 日 × 2 店）', (await sec.textContent()).includes('2 店舗に特別な営業日を入れました'));
ok('時間の外の予約を知らせる（消さない）', (await hq.getByRole('alert', { name: '時間の外の予約' }).textContent()).includes('サンプル本店'));
const slots = (await api(s1, 'GET', `/api/public/S001/slots?date=${D}&kind=RETURN`))[1].slots;
ok('その日は入れた時間だけ（9:00〜11:45）', slots.length > 0 && slots.every((x) => x.time >= 540 && x.time <= 705), JSON.stringify(slots.map((x) => x.time)));
ok('店舗の特別な営業日にも出る', (await api(s1, 'GET', '/api/admin/special-days'))[1].rows.some((r) => r.date === D && r.memo === '見本の時短営業'));
ok('予約は消していない', (await api(s1, 'GET', `/api/admin/day?date=${D}`))[1].data.cells.some((c) => c.text === '見本 午後'));
const rows = (await api(hq, 'GET', '/api/admin/special-bulk'))[1].rows;
ok('一覧にまとめて出る（日付ごと・2 店）', rows.length === 2 && rows.every((r) => r.stores.length === 2), JSON.stringify(rows));

// 3) 管轄MG：管轄の店舗だけ
await api(hq, 'PUT', '/api/admin/hq/areas', { areas: [{ name: '見本エリア', stores: ['S001'] }] });
await api(hq, 'POST', '/api/admin/hq/accounts', { code: 'MG01', name: '見本 管轄', password: 'mgpass123', role: 'mg', area: '見本エリア' });
const mg = await login('', 'mgpass123', 'MG01');
const mr = (await api(mg, 'GET', '/api/admin/special-bulk'))[1];
ok('MG は管轄の店舗だけ選べる', mr.stores.map((s) => s.code).join() === 'S001', JSON.stringify(mr.stores));
ok('MG は管轄外の店舗には入れられない', (await api(mg, 'PUT', '/api/admin/special-bulk', { from: D, sessions: [['10:00', '11:45']], stores: ['S002'] }))[0] === 400);
ok('MG が管轄の店舗に入れる（上書き）', (await api(mg, 'PUT', '/api/admin/special-bulk', { from: D, sessions: [['10:00', '11:45']], memo: 'MG', stores: ['S001'] }))[0] === 200);
ok('店舗の時間が上書きされる', (await api(s1, 'GET', `/api/public/S001/slots?date=${D}&kind=RETURN`))[1].slots[0].time === 600);
await mg.goto(`${B}/admin/hq/overview`); await mg.waitForTimeout(1200);
ok('MG の画面にも出る', await mg.getByRole('region', { name: '特別な営業日（まとめて）' }).isVisible());

// 4) まとめて消す
for (const r of (await api(hq, 'GET', '/api/admin/special-bulk'))[1].rows) await api(hq, 'DELETE', '/api/admin/special-bulk', { date: r.date, stores: r.stores });
ok('まとめて消すと通常の営業時間に戻る', (await api(hq, 'GET', '/api/admin/special-bulk'))[1].rows.length === 0 && (await api(s1, 'GET', `/api/public/S001/slots?date=${D}&kind=RETURN`))[1].slots.some((x) => x.time >= 900));
ok('店舗は使えない', (await api(s1, 'GET', '/api/admin/special-bulk'))[0] === 403);

ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
console.log(process.exitCode ? 'SPECIALBULK FAILED' : 'SPECIALBULK OK');
