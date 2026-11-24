// Xserver（PHP）版：WEB 予約の URL・QR ごとに、実際に来院したか（予約表の来院チェック）を数える
// 来院・これから（来院日がまだ）・チェックなし（来院日が過ぎたのに来院チェックなし）・取消
// 例：BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... CHROMIUM_PATH=... node e2e/campvisit.mjs
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
  const p = await (await br.newContext({ viewport: { width: 1400, height: 1000 } })).newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  if (user) { await p.goto(`${B}/admin/login`); await p.fill('input[autocomplete="username"]', user); } else await p.goto(`${B}/admin/login/${code}`);
  await p.fill('input[type=password]', pass); await p.click('button[type=submit]'); await p.waitForURL((u) => !u.pathname.includes('/login')); await p.waitForTimeout(500);
  return p;
}
const api = (p, m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);
sql('DELETE FROM rate_limit');
const hq = await login('', process.env.HQ_PASSWORD ?? 'hq-pass', 'HQ');
const mk = await api(hq, 'PUT', '/api/admin/hq/campaigns', { label: '見本 来院を数えるチラシ', trig: '' });
ok('準備：URL を作る', mk[0] === 200, JSON.stringify(mk[1]).slice(0, 80));
const camp = () => api(hq, 'GET', '/api/admin/hq/campaigns').then((r) => r[1].rows.find((x) => x.label === '見本 来院を数えるチラシ'));
const code = (await camp()).code;
const s1 = await login('S001', 'password');
// 空いている枠を 4 つ（別の時間）
const slots = [];
for (let w = 0; w < 4 && slots.length < 4; w++) {
  const st = new Date(); st.setDate(st.getDate() + 2 + w * 7);
  const wk = (await api(s1, 'GET', `/api/public/S001/week?start=${st.toISOString().slice(0, 10)}&kind=RETURN`))[1];
  for (const d of wk.days) for (const s of d.slots) if (slots.length < 4 && (s.status === 'open' || s.status === 'few') && !slots.some((x) => x[0] === d.date)) slots.push([d.date, s.time]);
}
const ids = [];
for (const [i, [date, time]] of slots.entries()) {
  const r = await api(s1, 'POST', '/api/public/S001/reserve', { kind: i === 0 ? 'NEW' : 'RETURN', cardNo: i === 0 ? '' : String(9400 + i), date, time, name: `見本 来院${i}`, phone: `0903131${String(4000 + i)}`, c: code });
  ok(`準備：WEB 予約 ${i + 1}`, r[0] === 200, JSON.stringify(r[1]).slice(0, 80));
  ids.push(sql(`SELECT id FROM reservation WHERE name='見本 来院${i}'`));
}
const cellOf = async (i) => (await api(s1, 'GET', `/api/admin/day?date=${slots[i][0]}`))[1].data.cells.find((c) => c.text.includes(`来院${i}`));
// 0：来院チェック → 来院（新規）
const c0 = await cellOf(0);
await api(s1, 'PUT', '/api/admin/visit', { date: slots[0][0], time: c0.time, bed: c0.bed, visited: true });
// 1：キャンセル（予約表）→ 取消
const c1 = await cellOf(1);
await api(s1, 'POST', '/api/admin/cancel', { date: slots[1][0], time: c1.time, bed: c1.bed, kind: 'ADVANCE' });
// 2：これから（何もしない）／3：来院日が過ぎたのに来院チェックなし
sql(`UPDATE reservation SET date = '2026-01-05' WHERE id = '${ids[3]}'`);
let c = await camp();
ok('来院した件数（新規）・これから・チェックなし・取消', JSON.stringify(c.came) === JSON.stringify({ visited: 1, visitedNew: 1, upcoming: 1, unchecked: 1, cancelled: 1 }), JSON.stringify(c.came));
// 来院チェックを外すと来院から外れる
await api(s1, 'PUT', '/api/admin/visit', { date: slots[0][0], time: c0.time, bed: c0.bed, visited: false });
ok('来院チェックを外すと来院の数から外れる', (await camp()).came.visited === 0);
await api(s1, 'PUT', '/api/admin/visit', { date: slots[0][0], time: c0.time, bed: c0.bed, visited: true });
// 予約表のセルが保持期間で消えても、来院したことは残る
sql(`DELETE FROM cell WHERE reservationId = '${ids[0]}'`);
ok('予約表のセルが消えても来院は残る', (await camp()).came.visited === 1);
// 画面
await hq.goto(`${B}/admin/hq`); await hq.waitForLoadState('networkidle');
const row = hq.getByRole('region', { name: 'WEB 予約の URL・QR' }).locator('tr', { hasText: '見本 来院を数えるチラシ' });
const cell = await row.getByLabel('来院').innerText();
ok('URL・QR の一覧に「来院」の列', cell.includes('1') && cell.includes('これから 1') && cell.includes('チェックなし 1') && cell.includes('取消 1'), cell);
ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
console.log(process.exitCode ? 'CAMPVISIT FAILED' : 'CAMPVISIT OK');
