// Xserver（PHP）版：新自・新三（全店）の来院実績（初診から 1〜12 回目の来院日・月ごとの来院回数）と、週の通院予定（店舗・本部・管轄MG が選ぶ）
// 例：BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... CHROMIUM_PATH=... node e2e/accidentvisits.mjs
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003';
const DB = process.env.DB_NAME ?? 'booking';
const sql = (q) => execSync(`mysql -uroot --default-character-set=utf8mb4 -N ${DB}`, { input: q }).toString().trim();
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const errs = [];
async function login(code, pass, user) {
  const p = await (await br.newContext({ viewport: { width: 1500, height: 1000 } })).newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  if (user) { await p.goto(`${B}/admin/login`); await p.fill('input[autocomplete="username"]', user); } else await p.goto(`${B}/admin/login/${code}`);
  await p.fill('input[type=password]', pass); await p.click('button[type=submit]'); await p.waitForURL((u) => !u.pathname.includes('/login')); await p.waitForTimeout(500);
  return p;
}
const api = (p, m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);
const add = (d, n) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
sql('DELETE FROM rate_limit');

const s1 = await login('S001', 'password');
const today = (await api(s1, 'GET', '/api/admin/me'))[1].today;
const ym = today.slice(0, 7), prevYm = add(`${ym}-01`, -1).slice(0, 7);
const sid = sql("SELECT id FROM store WHERE code='S001'");
// 初診（初自）：前月 3 日。来院チェックで新患継続率の行ができる
const first = `${prevYm}-03`;
await api(s1, 'PUT', '/api/admin/cells', { date: first, cells: [{ time: 540, bed: 1, text: '見本 一子（初自）' }] });
await api(s1, 'PUT', '/api/admin/visit', { date: first, time: 540, bed: 1, visited: true });
const k = (await api(s1, 'GET', `/api/admin/karte?month=${prevYm}`))[1].rows.find((r) => r.name.includes('一子'));
ok('準備：新自の行', !!k, '');
await api(s1, 'PATCH', '/api/admin/karte', { id: k.id, patch: { karteNo: '9301' } });
// そのあとの来院：前月 8 回・今月 5 回（書き方の違う来院はカルテNo 9301 付き。名前だけの来院も）。来院チェックのない日は数えない
const days = [5, 7, 10, 12, 14, 17, 19, 21].map((d) => `${prevYm}-${String(d).padStart(2, '0')}`);
const now = [1, 3, 5, 8, 10].map((d) => `${ym}-${String(d).padStart(2, '0')}`).filter((d) => d <= today);
let n = 0;
for (const d of [...days, ...now]) { n++; sql(`INSERT INTO cell (id, storeId, date, time, bed, text, visited, cardNo) VALUES ('av${String(n).padStart(4, '0')}', '${sid}', '${d}', 600, 2, '${n % 2 ? 'みほん いちこ' : '見本 一子'}', 1, ${n % 2 ? "'9301'" : 'NULL'})`); }
sql(`INSERT INTO cell (id, storeId, date, time, bed, text, visited) VALUES ('avx01', '${sid}', '${prevYm}-25', 600, 2, '見本 一子', 0)`); // チェックなし
const all = [first, ...days, ...now].sort();

// ---------- 本部：来院日・月ごと ----------
const hq = await login('', process.env.HQ_PASSWORD ?? 'hq-pass', 'HQ');
const r = (await api(hq, 'GET', `/api/admin/hq/accidents?month=${prevYm}`))[1].rows.find((x) => x.id === k.id);
ok('1〜12 回目の来院日（初診が 1 回目・書き方が違っても番号が同じなら同じ方・チェックなしは数えない）', JSON.stringify(r.visitDates) === JSON.stringify(all.slice(0, 12)), JSON.stringify(r.visitDates));
ok('月ごとの来院回数（初診の月から）', r.monthly[0].ym === prevYm && r.monthly[0].n === 1 + days.length && (r.monthly[1]?.n ?? 0) === now.length, JSON.stringify(r.monthly));
await hq.goto(`${B}/admin/hq/accidents?month=${prevYm}`); await hq.waitForSelector('table[aria-label="新自・新三（全店）"]'); await hq.waitForTimeout(800);
const tr = hq.locator('table[aria-label="新自・新三（全店）"] tbody tr', { hasText: '9301' });
ok('画面：12 回目まで日付が並ぶ', (await tr.getByLabel('1回目', { exact: true }).innerText()) === `${Number(first.slice(5, 7))}/3` && (await tr.getByLabel('12回目', { exact: true }).innerText()) !== '');
await api(s1, 'PATCH', '/api/admin/karte', { id: k.id, patch: { accidentDate: first, accidentNote: '見本：交差点で右折待ちのところに後ろから追突され、首と腰を痛めた。救急で受診したあと、こちらに来院。' } });
for (const w of [1366, 1280]) {
  await hq.setViewportSize({ width: w, height: 900 }); await hq.reload(); await hq.waitForSelector('table[aria-label="新自・新三（全店）"]'); await hq.waitForTimeout(800);
  const sw = await hq.getByTestId('accidents-wrap').evaluate((e) => [e.scrollWidth, e.clientWidth]);
  ok(`パソコンの画面（幅 ${w}）で横にスクロールしない`, sw[0] <= sw[1], JSON.stringify(sw));
}
await hq.screenshot({ path: new URL('./', import.meta.url).pathname + 'out-accidentvisits.png', fullPage: true });
ok('画面：月ごとの来院回数', (await tr.getByLabel('月ごとの来院').innerText()).includes(`${Number(prevYm.slice(5))}月 ${1 + days.length}回`));

// ---------- 週の通院予定：店舗が選ぶ → 本部に出る → 本部が直す ----------
await s1.goto(`${B}/admin/karte?month=${prevYm}`); await s1.waitForSelector('section[aria-label="新自・新三（事故）"]');
await s1.locator('section[aria-label="新自・新三（事故）"]').getByLabel('週の通院予定').first().selectOption('3'); await s1.waitForTimeout(800);
ok('店舗が週の予定を選べる', sql(`SELECT weeklyPlan FROM karte WHERE id='${k.id}'`) === '3');
await hq.reload(); await hq.waitForSelector('table[aria-label="新自・新三（全店）"]'); await hq.waitForTimeout(800);
const sel = hq.locator('table[aria-label="新自・新三（全店）"] tbody tr', { hasText: '9301' }).getByLabel('週の通院予定');
ok('本部の画面に店舗の選んだ予定が出る', (await sel.inputValue()) === '3');
await sel.selectOption('2'); await hq.waitForTimeout(800);
ok('本部も直せる', sql(`SELECT weeklyPlan FROM karte WHERE id='${k.id}'`) === '2');
ok('1〜5 回のほかは入れられない', (await api(hq, 'PUT', '/api/admin/accidents/plan', { id: k.id, plan: 6 }))[0] === 400);

// ---------- 管轄MG：管轄の店舗も管轄外の店舗も直せる（新自・新三） ----------
await api(hq, 'PUT', '/api/admin/hq/areas', { areas: [{ name: '見本エリア', stores: ['S002'] }] });
await api(hq, 'POST', '/api/admin/hq/accounts', { code: 'mgav1', name: '見本 MG', password: 'mgpass123', role: 'mg', area: '見本エリア' });
const mg = await login('', 'mgpass123', 'mgav1');
ok('管轄MG：管轄外の店舗の週の予定も直せる', (await api(mg, 'PUT', '/api/admin/accidents/plan', { id: k.id, plan: 4 }))[0] === 200 && sql(`SELECT weeklyPlan FROM karte WHERE id='${k.id}'`) === '4');
await mg.context().addCookies([{ name: 'bk_store', value: 'S001', url: B }]);
ok('管轄MG：管轄外の店舗の事故日・事故内容も直せる', (await api(mg, 'PATCH', '/api/admin/karte', { id: k.id, patch: { accidentNote: '見本：MG が直した事故内容' } }))[0] === 200 && sql(`SELECT accidentNote FROM karte WHERE id='${k.id}'`) === '見本：MG が直した事故内容');
ok('管轄MG：管轄外の店舗の新患継続率のほかの欄は直せない', (await api(mg, 'PATCH', '/api/admin/karte', { id: k.id, patch: { age: '40' } }))[0] === 403);
await mg.context().clearCookies({ name: 'bk_store' });
const s2 = await login('S002', 'password');
await api(s2, 'PUT', '/api/admin/cells', { date: first, cells: [{ time: 540, bed: 1, text: '見本 二子（新三）' }] });
await api(s2, 'PUT', '/api/admin/visit', { date: first, time: 540, bed: 1, visited: true });
const k2 = (await api(s2, 'GET', `/api/admin/karte?month=${prevYm}`))[1].rows.find((x) => x.name.includes('二子'));
ok('管轄MG：管轄の店舗は直せる', (await api(mg, 'PUT', '/api/admin/accidents/plan', { id: k2.id, plan: 4 }))[0] === 200 && sql(`SELECT weeklyPlan FROM karte WHERE id='${k2.id}'`) === '4');
ok('ほかの店舗のアカウントでは直せない', (await api(s2, 'PUT', '/api/admin/accidents/plan', { id: k.id, plan: 1 }))[0] === 404);
await mg.goto(`${B}/admin/hq/accidents?month=${prevYm}`); await mg.waitForSelector('table[aria-label="新自・新三（全店）"]'); await mg.waitForTimeout(800);
ok('管轄MG の画面：管轄外の行も選ぶ欄が出る', (await mg.locator('table[aria-label="新自・新三（全店）"] tbody tr', { hasText: '9301' }).getByLabel('週の通院予定').count()) === 1);
const xl = await hq.evaluate(async (u) => (await fetch(u)).status, `/api/admin/hq/accidents/export?month=${prevYm}`);
ok('Excel に保存できる', xl === 200);
ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
sql(`DELETE FROM cell WHERE id LIKE 'av%'`);
await br.close();
console.log(process.exitCode ? 'ACCIDENTVISITS FAILED' : 'ACCIDENTVISITS OK');
