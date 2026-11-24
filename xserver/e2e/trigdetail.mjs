// Xserver（PHP）版：どのきっかけにも内訳（チラシ→ワンコイン など）。本部が作る・URL・QR で選べる（選ばなくてもよい）・店舗は空でも未入力にしない。
// URL・QR の一覧はきっかけ（大項目）ごとにまとめる
// 例：BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... CHROMIUM_PATH=... node e2e/trigdetail.mjs
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
  await p.fill('input[type=password]', pass); await p.click('button[type=submit]'); await p.waitForURL((u) => !u.pathname.includes('/login')); await p.waitForLoadState('networkidle');
  return p;
}
const api = (p, m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);
sql('DELETE FROM rate_limit');
const hq = await login('', process.env.HQ_PASSWORD ?? 'hq-pass', 'HQ');

// ---------- 本部：チラシの内訳を作る（新患・再来集計の「選択肢・エリアの設定」） ----------
await hq.goto(`${B}/admin/hq/karte`); await hq.waitForLoadState('networkidle');
await hq.getByRole('button', { name: '選択肢・エリアの設定' }).click();
const box = hq.getByLabel('きっかけごとの内訳');
await box.getByLabel('内訳を作るきっかけ').selectOption('チラシ');
await box.locator('textarea').first().fill('ワンコイン\n通常');
await box.getByRole('button', { name: '保存' }).first().click(); await hq.waitForTimeout(1000);
const opt = (await api(hq, 'GET', '/api/admin/hq/karte/options'))[1].options;
ok('チラシの内訳を作れる', JSON.stringify(opt['d:チラシ']) === JSON.stringify(['ワンコイン', '通常']), JSON.stringify(opt['d:チラシ']));
ok('紹介他事業などは今までの内訳の設定（ここでは作れない）', (await api(hq, 'PUT', '/api/admin/hq/karte/options', { category: 'd:紹介他事業', labels: ['x'] }))[0] === 400);
ok('ないきっかけには作れない', (await api(hq, 'PUT', '/api/admin/hq/karte/options', { category: 'd:見本ないきっかけ', labels: ['x'] }))[0] === 400);

// ---------- URL・QR：チラシ／ワンコイン と チラシ（内訳なし）・Google（内訳なし） ----------
const put = (b) => api(hq, 'PUT', '/api/admin/hq/campaigns', b);
ok('チラシ／ワンコインの URL', (await put({ label: '見本 ワンコインチラシA', trig: 'チラシ', trigDetail: 'ワンコイン' }))[0] === 200);
ok('チラシ（内訳なし）の URL も作れる', (await put({ label: '見本 駅前チラシ', trig: 'チラシ', trigDetail: '' }))[0] === 200);
ok('作っていない内訳は選べない', (await put({ label: '見本 x', trig: 'チラシ', trigDetail: 'ない内訳' }))[0] === 400);
ok('キャンペーンなどは今までどおり内訳が要る', (await put({ label: '見本 y', trig: 'キャンペーン', trigDetail: '' }))[0] === 400);
await put({ label: '見本 グーグル', trig: 'Google' });
await hq.goto(`${B}/admin/hq`); await hq.waitForLoadState('networkidle');
const sec = hq.getByRole('region', { name: 'WEB 予約の URL・QR' });
ok('一覧はきっかけごとにまとまる（見出しに本数）', (await sec.getByLabel('きっかけ チラシ').innerText()).includes('2 本') && (await sec.getByLabel('きっかけ Google').count()) === 1);
await sec.getByLabel('きっかけ チラシ').getByRole('button').click(); await hq.waitForTimeout(300);
ok('見出しを押すとたためる', (await sec.locator('tr', { hasText: '見本 駅前チラシ' }).count()) === 0);
await sec.getByLabel('きっかけ チラシ').getByRole('button').click();
await sec.getByRole('button', { name: '＋ URL・QR を作る' }).click();
const form = sec.getByRole('form', { name: 'URL・QR を作る' });
await form.getByLabel('新患継続率のきっかけ').selectOption('チラシ');
ok('作る画面：チラシの内訳は「任意」で選べる', (await form.innerText()).includes('「チラシ」の内訳 （任意）') && (await form.getByLabel('きっかけの内訳').locator('option').allInnerTexts()).includes('ワンコイン'));

// ---------- 予約 → 新患継続率：内訳を選んだ URL はその内訳、選ばない URL は URL の名前 ----------
const rows = (await api(hq, 'GET', '/api/admin/hq/campaigns'))[1].rows;
const a = rows.find((r) => r.label === '見本 ワンコインチラシA'), b = rows.find((r) => r.label === '見本 駅前チラシ');
const s1 = await login('S001', 'password');
const slots = [];
for (let w = 0; w < 3 && slots.length < 2; w++) {
  const st = new Date(); st.setDate(st.getDate() + 2 + w * 7);
  const wk = (await api(s1, 'GET', `/api/public/S001/week?start=${st.toISOString().slice(0, 10)}&kind=NEW`))[1];
  for (const d of wk.days) for (const s of d.slots) if (slots.length < 2 && (s.status === 'open' || s.status === 'few') && !slots.some((x) => x[0] === d.date)) slots.push([d.date, s.time]);
}
for (const [i, c] of [a, b].entries()) {
  const r = await api(s1, 'POST', '/api/public/S001/reserve', { kind: 'NEW', date: slots[i][0], time: slots[i][1], name: `見本 チラシ${i}`, phone: `0903131${5000 + i}`, c: c.code });
  const cell = (await api(s1, 'GET', `/api/admin/day?date=${slots[i][0]}`))[1].data.cells.find((x) => x.text.includes(`チラシ${i}`));
  await api(s1, 'PUT', '/api/admin/visit', { date: slots[i][0], time: cell.time, bed: cell.bed, visited: true });
  ok(`準備：予約 ${i + 1}`, r[0] === 200);
}
const k = async (i) => ((await api(s1, 'GET', `/api/admin/karte?month=${slots[i][0].slice(0, 7)}`))[1].rows ?? []).find((r) => r.name.includes(`チラシ${i}`));
const k0 = await k(0), k1 = await k(1);
ok('内訳を選んだ URL から来た方は「チラシ／ワンコイン」', k0?.trig === 'チラシ' && k0?.trigDetail === 'ワンコイン', JSON.stringify(k0 && [k0.trig, k0.trigDetail]));
ok('内訳を選ばない URL から来た方は「チラシ／URL の名前」', k1?.trig === 'チラシ' && k1?.trigDetail === '見本 駅前チラシ', JSON.stringify(k1 && [k1.trig, k1.trigDetail]));

// ---------- 店舗：手で入れるときは選べる・空でも未入力にしない ----------
const add = await api(s1, 'POST', '/api/admin/karte', { date: slots[0][0] });
await api(s1, 'PATCH', '/api/admin/karte', { id: add[1].row.id, patch: { trig: 'チラシ', name: '見本 手入力' } });
const mine = ((await api(s1, 'GET', `/api/admin/karte?month=${slots[0][0].slice(0, 7)}`))[1].rows ?? []).find((r) => r.id === add[1].row.id);
ok('店舗：チラシの内訳は空でも未入力にしない', !(mine?.missingFields ?? []).includes('trigDetail'), JSON.stringify(mine?.missingFields));
await s1.goto(`${B}/admin/karte?month=${slots[0][0].slice(0, 7)}`); await s1.waitForLoadState('networkidle');
const sel = s1.locator('tr', { has: s1.locator('input[value="見本手入力"]') }).getByLabel('内訳');
ok('店舗：チラシの内訳を選べる', (await sel.locator('option').allInnerTexts()).includes('通常'));
await sel.selectOption('通常'); await s1.waitForTimeout(800);
ok('店舗：選んだ内訳が保存される', sql(`SELECT trigDetail FROM karte WHERE id='${add[1].row.id}'`) === '通常');
ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
console.log(process.exitCode ? 'TRIGDETAIL FAILED' : 'TRIGDETAIL OK');
