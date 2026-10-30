// Xserver（PHP）版：臨時休業を期間でまとめて入れる（年末年始など。本部・管轄MG）
// 例：BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... CHROMIUM_PATH=... node e2e/closurerange.mjs
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
const add = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const D = (() => { const d = new Date(); d.setDate(d.getDate() + 3); for (;;) { const s = d.toISOString().slice(0, 10); if ([1].includes(d.getDay()) && !['2026-11-03', '2026-11-23'].includes(s)) return s; d.setDate(d.getDate() + 1); } })(); // 月曜
const D2 = add(D, 2);

const s1 = await login('S001', 'password');
await api(s1, 'PUT', '/api/admin/cells', { date: add(D, 1), cells: [{ time: 600, bed: 1, text: '見本 休日' }] });
const hq = await login('', process.env.HQ_PASSWORD ?? 'hq-pass', 'HQ');
await hq.goto(`${B}/admin/hq`); await hq.waitForTimeout(1200);
const sec = hq.getByRole('region', { name: '臨時休業（まとめて）' });
await sec.getByLabel('臨時休業の始めの日').fill(D); await hq.waitForTimeout(600);
await sec.getByLabel('臨時休業の終わりの日').fill(D2);
await sec.getByPlaceholder('例）台風のため').fill('年末年始のお休み');
await sec.getByRole('button', { name: '全店をえらぶ' }).click();
await sec.getByRole('button', { name: /店舗を.*（3 日）終日の臨時休業にする/ }).click(); await hq.waitForTimeout(1500);
ok('期間（3 日）で臨時休業にできる', (await sec.textContent()).includes('2 店舗を') && (await sec.textContent()).includes('の臨時休業にしました'));
ok('休みの日に入っている予約を知らせる（消さない）', (await hq.getByRole('alert', { name: '休みの日の予約' }).textContent()).includes('サンプル本店'));
for (const d of [D, add(D, 1), D2]) {
  const st = (await api(hq, "GET", `/api/admin/closures?date=${d}`))[1].stores;
  ok(`${d} は 2 店とも休業`, st.every((r) => r.part === 'ALL'), JSON.stringify(st.map((r) => r.part)));
}
ok('期間の次の日は休業ではない', (await api(hq, 'GET', `/api/admin/closures?date=${add(D, 3)}`))[1].stores.every((r) => !r.part));
const pub = (await api(s1, 'GET', `/api/public/S001/slots?date=${add(D, 1)}&kind=RETURN`))[1];
ok('予約ページでは取れない', (pub.slots ?? []).every((x) => x.status === 'closed'), JSON.stringify(pub).slice(0, 120));
ok('予約は消していない', (await api(s1, 'GET', `/api/admin/day?date=${add(D, 1)}`))[1].data.cells.some((c) => c.text === '見本 休日'));
ok('31 日より長い期間は入れられない', (await api(hq, 'PUT', '/api/admin/closures', { date: D, to: add(D, 40), codes: ['S001'], part: 'ALL', note: 'x' }))[0] === 400);
// 期間でまとめて取り消す
await sec.getByRole('button', { name: '全店をえらぶ' }).click();
await sec.getByRole('button', { name: /店舗の.*臨時休業を取り消す/ }).click(); await hq.waitForTimeout(1500);
ok('期間でまとめて取り消せる', (await api(hq, 'GET', `/api/admin/closures?date=${D2}`))[1].stores.every((r) => !r.part));
ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
console.log(process.exitCode ? 'CLOSURERANGE FAILED' : 'CLOSURERANGE OK');
