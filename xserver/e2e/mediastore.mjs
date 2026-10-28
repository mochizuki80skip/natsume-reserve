// Xserver（PHP）版：媒体ごと×店舗ごとの WEB 予約 URL・QR（本部で使う店舗を選ぶ → 店舗の予約ページへ直接の URL・QR、まとめて保存、店舗設定に出る）
// 例：BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... CHROMIUM_PATH=... node e2e/mediastore.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const errs = [];
async function login(code, pass, user) {
  const ctx = await br.newContext({ viewport: { width: 1366, height: 1000 }, acceptDownloads: true });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  if (user) { await p.goto(`${B}/admin/login`); await p.fill('input[autocomplete="username"]', user); } else await p.goto(`${B}/admin/login/${code}`);
  await p.fill('input[type=password]', pass); await p.click('button[type=submit]'); await p.waitForURL(/admin\//); await p.waitForTimeout(500);
  return p;
}
const api = (p, m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);
const D = (() => { const d = new Date(); d.setDate(d.getDate() + 3); for (;;) { const s = d.toISOString().slice(0, 10); if ([1, 2, 3, 5].includes(d.getDay()) && !['2026-11-03', '2026-11-23', '2027-01-01'].includes(s)) return s; d.setDate(d.getDate() + 1); } })();

const hq = await login('', process.env.HQ_PASSWORD ?? 'hq-pass', 'HQ');
ok('媒体を追加', (await api(hq, 'PUT', '/api/admin/hq/referrals', { name: '見本インスタ', kind: 'media', trig: 'SNS' }))[0] === 200);
let ref = (await api(hq, 'GET', '/api/admin/hq/referrals'))[1];
const m = ref.rows.find((r) => r.name === '見本インスタ');
ok('はじめは使う店舗なし・店舗の一覧が付く', m.stores.length === 0 && ref.stores.some((s) => s.code === 'S001'), JSON.stringify(ref.stores));
ok('使う店舗を選ぶ（ない店舗コードは外す）', (await api(hq, 'PUT', '/api/admin/hq/referrals', { id: m.id, stores: ['S001', 'NOPE'] }))[0] === 200);
ref = (await api(hq, 'GET', '/api/admin/hq/referrals'))[1];
ok('使う店舗は S001 だけ', ref.rows.find((r) => r.id === m.id).stores.join() === 'S001');

// 本部の画面：店舗ごとの URL・QR、使う店舗を画面で足す、まとめて保存
await hq.goto(`${B}/admin/hq`); await hq.waitForTimeout(1200);
const tbl = hq.getByRole('region', { name: '店舗ごとの URL・QR' });
ok('店舗ごとの URL・QR の表に S001', (await tbl.textContent()).includes(`/s/S001?ref=${m.code}`));
await hq.getByLabel('見本インスタ を使う店舗').click();
await hq.getByLabel('見本インスタ：サンプル駅前').check().catch(async () => { await hq.locator(`label:has-text("サンプル") input`).nth(1).check(); });
await hq.getByRole('button', { name: /^保存（2店）$/ }).click(); await hq.waitForTimeout(1200);
ok('画面で使う店舗を 2 店に', (await api(hq, 'GET', '/api/admin/hq/referrals'))[1].rows.find((r) => r.id === m.id).stores.length === 2);
const [dl] = await Promise.all([hq.waitForEvent('download'), hq.getByRole('button', { name: 'QR をまとめて保存（zip）' }).click()]);
const zipPath = '/tmp/mediastore-test.zip'; await dl.saveAs(zipPath);
const z = fs.readFileSync(zipPath);
ok('QR をまとめて保存（zip に 2 枚）', z.readUInt32LE(0) === 0x04034b50 && z.readUInt16LE(z.length - 22 + 10) === 2 && z.includes(Buffer.from('QR_サンプル本店_見本インスタ.png')), dl.suggestedFilename());
const x = await hq.evaluate(async () => { const r = await fetch('/api/admin/hq/referrals/export'); return [r.status, r.headers.get('content-type')]; });
ok('URL の一覧を Excel で保存', x[0] === 200 && (x[1] ?? '').includes('spreadsheetml'), JSON.stringify(x));

// 店舗設定に、自店の媒体別 URL・QR（見るだけ）
const st = await login('S001', 'password');
await st.goto(`${B}/admin/settings`); await st.waitForTimeout(1200);
const sec = st.getByRole('region', { name: '媒体別の URL・QR' });
const t = await sec.textContent();
ok('店舗設定にギフトカードと媒体の URL・QR', t.includes('ギフトカード') && t.includes('媒体：見本インスタ') && t.includes(`/s/S001?ref=${m.code}`), t.slice(0, 200));
ok('店舗は本部の媒体を変えられない', (await api(st, 'PUT', '/api/admin/hq/referrals', { id: m.id, stores: [] }))[0] === 403);

// 媒体の URL から予約 → 来院 → 新患継続率のきっかけ・内訳
const res = await api(st, 'POST', '/api/public/S001/reserve', { kind: 'NEW', date: D, time: 660, name: '見本 媒太', phone: '090' + String(Date.now()).slice(-8), ref: m.code });
ok('媒体の印つきで予約できる', res[0] === 200, JSON.stringify(res));
await api(st, 'PUT', '/api/admin/visit', { date: D, time: 660, bed: res[1].bed ?? 1, visited: true });
const day = (await api(st, 'GET', `/api/admin/day?date=${D}`))[1].data;
const cell = day.cells.find((c) => c.text.startsWith('見本 媒太'));
if (cell && !cell.visited) await api(st, 'PUT', '/api/admin/visit', { date: D, time: cell.time, bed: cell.bed, visited: true });
const k = (await api(st, 'GET', `/api/admin/karte?month=${D.slice(0, 7)}`))[1].rows.find((r) => r.name === '見本媒太');
ok('新患継続率：きっかけ SNS・内訳 見本インスタ', k?.trig === 'SNS' && k?.trigDetail === '見本インスタ', JSON.stringify(k && [k.trig, k.trigDetail]));
ok('本部の表に店舗ごとの予約数', (await api(hq, 'GET', '/api/admin/hq/referrals'))[1].rows.find((r) => r.id === m.id).byStore.S001 === 1);

ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
console.log(process.exitCode ? 'MEDIASTORE FAILED' : 'MEDIASTORE OK');
