// Xserver（PHP）版：臨時休業をまとめて入れる（本部・管轄MG）と、店舗への通知
// 例：BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... CHROMIUM_PATH=... node e2e/closurebulk.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003', O = new URL('./', import.meta.url).pathname + 'out-';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const errs = [];
async function login(code, pass, user) {
  const ctx = await br.newContext({ viewport: { width: 1300, height: 1000 } });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  if (user) { await p.goto(`${B}/admin/login`); await p.fill('input[autocomplete="username"]', user); } else await p.goto(`${B}/admin/login/${code}`);
  await p.fill('input[type=password]', pass); await p.click('button[type=submit]'); await p.waitForURL(/admin\//); await p.waitForTimeout(500);
  return p;
}
const api = (p, m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);

// 午前・午後とも受付のある営業日（3 日後以降）
let D;
{ const s = new Date(); s.setDate(s.getDate() + 3); const first = s.toISOString().slice(0, 10);
  const j = await (await fetch(`${B}/api/public/S001/week?start=${first}&kind=RETURN`)).json();
  D = j.days.find((d) => d.date >= first && d.label === null && d.slots.some((x) => x.time < 720) && d.slots.some((x) => x.time >= 780))?.date;
  if (!D) { const j2 = await (await fetch(`${B}/api/public/S001/week?start=${new Date(s.getTime() + 7 * 864e5).toISOString().slice(0, 10)}&kind=RETURN`)).json(); D = j2.days.find((d) => d.label === null && d.slots.some((x) => x.time < 720))?.date; } }
console.log('date', D);

const hq = await login('', process.env.HQ_PASSWORD ?? 'hq-pass', 'HQ');
await api(hq, 'PUT', '/api/admin/hq/areas', { areas: [{ name: '静岡エリア', stores: ['S001'] }, { name: '東部エリア', stores: ['S002'] }] });
await api(hq, 'POST', '/api/admin/hq/accounts', { code: 'mg1', name: '見本 MG', password: 'mgpass123', role: 'mg', area: '東部エリア' });
// S001 の午前に予約を 1 件
const st = await login('S001', 'password');
await st.evaluate(async (d) => fetch('/api/public/S001/reserve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'NEW', date: d, time: 600, name: '見本 太郎', phone: '09011112222' }) }), D);

await hq.goto(`${B}/admin/hq`); await hq.waitForSelector('section[aria-label="臨時休業（まとめて）"]');
const sec = hq.locator('section[aria-label="臨時休業（まとめて）"]');
await sec.locator('input[type=date]').fill(D); await hq.waitForTimeout(600);
await sec.getByRole('button', { name: '午前' }).click();
await sec.locator('input[placeholder="例）台風のため"]').fill('台風のため');
await sec.getByLabel('静岡エリア（全部）').check();
ok('エリアの「全部」で 1 店舗', (await sec.getByRole('button', { name: /1 店舗を午前の臨時休業にする/ }).count()) === 1);
await sec.getByRole('button', { name: '全店をえらぶ' }).click();
ok('全店をえらぶで 2 店舗', (await sec.getByRole('button', { name: /2 店舗を午前の臨時休業にする/ }).count()) === 1);
await sec.getByRole('button', { name: /2 店舗を午前の臨時休業にする/ }).click(); await hq.waitForTimeout(1200);
const tbl = await sec.locator('table[aria-label="この日の臨時休業"]').textContent();
ok('一覧に 2 店舗・予約の件数（要連絡）', /サンプル本店午前台風のため1件（要連絡）本部/.test(tbl) && (await sec.locator('table[aria-label="この日の臨時休業"] tbody tr').count()) === 2, tbl);
await hq.screenshot({ path: O + 'closure-bulk.png', clip: { x: 0, y: 60, width: 1300, height: 640 } });
const wk = (await (await fetch(`${B}/api/public/S002/week?start=${D}&kind=RETURN`)).json()).days.find((x) => x.date === D);
ok('S002 も午前の枠が止まる', !wk.slots.some((x) => x.time < 720) && wk.slots.some((x) => x.time >= 780));

// 店舗の通知
await st.goto(`${B}/admin`); await st.waitForSelector('[aria-label="臨時休業の通知"]');
const nt = await st.locator('[aria-label="臨時休業の通知"]').textContent();
ok('店舗に通知（入れた人・午前・予約 1件）', nt.includes('本部が') && nt.includes('午前 を臨時休業にしました') && nt.includes('予約が 1件'), nt);
await st.screenshot({ path: O + 'closure-notice.png', clip: { x: 0, y: 0, width: 1300, height: 160 } });
await st.getByRole('button', { name: '確認しました' }).click(); await st.waitForTimeout(600);
ok('「確認しました」で通知が消える', (await st.locator('[aria-label="臨時休業の通知"]').count()) === 0);

// 管轄MG：管轄の店舗だけ
const mg = await login('', 'mgpass123', 'mg1');
const mgList = (await api(mg, 'GET', `/api/admin/closures?date=${D}`))[1];
ok('管轄MG には管轄の店舗だけ出る', mgList.stores.length === 1 && mgList.stores[0].code === 'S002', JSON.stringify(mgList.stores.map((s) => s.code)));
ok('管轄MG は管轄外を変えられない', (await api(mg, 'PUT', '/api/admin/closures', { date: D, codes: ['S001'], part: 'ALL', note: '' }))[0] === 403);
await mg.goto(`${B}/admin/hq/overview`); await mg.waitForSelector('section[aria-label="臨時休業（まとめて）"]');
ok('管轄MG は全店状況の下で使える', true);
ok('店舗アカウントは使えない', (await api(st, 'GET', `/api/admin/closures?date=${D}`))[0] === 403);

// 取り消し → 店舗に取り消しの通知
await sec.getByRole('button', { name: 'この日の臨時休業をまとめて取り消す' }).click(); await hq.waitForTimeout(1200);
ok('まとめて取り消せる', (await sec.locator('table[aria-label="この日の臨時休業"]').count()) === 0);
await st.reload(); await st.waitForSelector('[aria-label="臨時休業の通知"]');
ok('店舗に取り消しの通知', (await st.locator('[aria-label="臨時休業の通知"]').textContent()).includes('臨時休業を取り消しました'));
// 店舗が自分で入れたときは通知しない
await api(st, 'PUT', '/api/admin/closures/ack', { date: D });
await api(st, 'PUT', '/api/admin/days', { date: D, closed: true });
ok('店舗が自分で入れた臨時休業は通知しない', (await api(st, 'GET', '/api/admin/closures/notices'))[1].notices.length === 0);
ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
