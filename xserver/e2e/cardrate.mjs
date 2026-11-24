// Xserver（PHP）版：カルテNo で数える（A：予約表で診察券番号から氏名に置き換えたら番号も残す／B：店舗ごとのカルテNo 付き率）
// 例：BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... CHROMIUM_PATH=... node e2e/cardrate.mjs
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
  const p = await (await br.newContext({ viewport: { width: 1300, height: 1000 } })).newPage();
  p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  if (user) { await p.goto(`${B}/admin/login`); await p.fill('input[autocomplete="username"]', user); } else await p.goto(`${B}/admin/login/${code}`);
  await p.fill('input[type=password]', pass); await p.click('button[type=submit]'); await p.waitForURL((u) => !u.pathname.includes('/login')); await p.waitForLoadState('networkidle');
  return p;
}
const api = (p, m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);
sql('DELETE FROM rate_limit');
const st = await login('S001', 'password');
const sid = sql("SELECT id FROM store WHERE code='S001'");
const D = (() => { const d = new Date(); d.setDate(d.getDate() + 3); for (;;) { const s = d.toISOString().slice(0, 10); if ([1, 2, 3, 5].includes(d.getDay()) && !['2026-11-03', '2026-11-23', '2027-01-01'].includes(s)) return s; d.setDate(d.getDate() + 1); } })();
const cardOf = (time, bed) => sql(`SELECT COALESCE(cardNo, '') FROM cell WHERE storeId='${sid}' AND date='${D}' AND time=${time} AND bed=${bed}`);
{ const d0 = (await api(st, 'GET', `/api/admin/day?date=${D}`))[1].data; await api(st, 'PUT', '/api/admin/cells', { date: D, cells: d0.cells.map((x) => ({ time: x.time, bed: x.bed, text: '' })) }); }
await api(st, 'POST', '/api/admin/patients', { rows: [{ no: '009101', name: '見本 番号', kana: 'ミホン バンゴウ' }] });

// ---------- A) 予約表で診察券番号を打って Enter → 氏名に置き換わり、番号もセルに残る ----------
await st.goto(`${B}/admin/day/${D}`); await st.waitForSelector('#grid'); await st.waitForTimeout(500);
const inp = st.locator('td[data-cell="540:2"] input').first();
await inp.click(); await inp.fill('9101'); await st.waitForTimeout(700); await inp.press('Enter'); await st.waitForTimeout(1800);
ok('診察券番号 → 氏名に置き換わる', (await inp.inputValue()) === '見本 番号', await inp.inputValue());
ok('番号（カルテNo）もセルに残る', cardOf(540, 2) === '9101', cardOf(540, 2));
// 同じ人の書き足し（「様」）では番号は残る・別の人に書き換えたら外れる
await api(st, 'PUT', '/api/admin/cells', { date: D, cells: [{ time: 540, bed: 2, text: '見本 番号様' }] });
ok('同じ人の書き足しでは番号は残る', cardOf(540, 2) === '9101');
// 予約の移動でも番号は一緒に移る
const mv = await api(st, 'POST', '/api/admin/move', { date: D, time: 540, bed: 2, toDate: D, toTime: 600, toBed: 4 });
ok('予約を動かしても番号は一緒に移る', mv[0] === 200 && cardOf(600, 4) === '9101', JSON.stringify(mv[1]).slice(0, 100));
await api(st, 'PUT', '/api/admin/cells', { date: D, cells: [{ time: 600, bed: 4, text: '見本 別人' }] });
ok('別の人に書き換えたら番号は外れる', cardOf(600, 4) === '');
// 消して「元に戻す」と番号も戻る
await api(st, 'PUT', '/api/admin/cells', { date: D, cells: [{ time: 630, bed: 3, text: '見本 戻番', cardNo: '9105' }] });
await api(st, 'PUT', '/api/admin/cells', { date: D, cells: [{ time: 630, bed: 3, text: '' }] });
await api(st, 'PUT', '/api/admin/cells', { date: D, cells: [{ time: 630, bed: 3, text: '見本 戻番' }] });
ok('消して元に戻すと番号も戻る', cardOf(630, 3) === '9105', cardOf(630, 3));

// ---------- 離反：名前の書き方が違っても、番号が同じなら同じ人 ----------
const today = (await api(st, 'GET', '/api/admin/me'))[1].today;
const add = (d, n) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const ym = add(`${today.slice(0, 7)}-01`, -1).slice(0, 7), prevYm = add(`${ym}-01`, -1).slice(0, 7);
sql(`DELETE FROM cell WHERE storeId='${sid}' AND date LIKE '${prevYm}%'; DELETE FROM cell WHERE storeId='${sid}' AND date LIKE '${ym}%'; DELETE FROM churn WHERE storeId='${sid}'; DELETE FROM visit_archive WHERE storeId='${sid}'; DELETE FROM karte WHERE storeId='${sid}'`);
const cell = (id, date, time, bed, text, card) => sql(`INSERT INTO cell (id, storeId, date, time, bed, text, visited, cardNo) VALUES ('${id}', '${sid}', '${date}', ${time}, ${bed}, '${text}', 1, ${card ? `'${card}'` : 'NULL'})`);
cell('cr01', `${prevYm}-05`, 540, 1, '見本 太一', '9201');
cell('cr02', `${prevYm}-12`, 540, 1, 'みほん たいち', '9201'); // 書き方が違うが同じ番号
cell('cr03', `${prevYm}-07`, 600, 2, '見本 名前だけ', null);
const ch = (await api(st, 'GET', `/api/admin/churn?month=${ym}`))[1];
const taichi = ch.rows.filter((r) => r.cardNo === '9201');
ok('名前の書き方が違っても番号が同じなら 1 人（最後の来院から）', taichi.length === 1 && taichi[0].lastVisit === `${prevYm}-12`, JSON.stringify(taichi.map((r) => [r.name, r.lastVisit])));

// ---------- B) カルテNo 付き率 ----------
const cm = (await api(st, 'GET', `/api/admin/churn?month=${prevYm}`))[1].cardRate;
ok('離反の画面：その月の来院のカルテNo 付き率（3 件中 2 件）', cm.visits === 3 && cm.direct === 2 && cm.none === 1 && cm.rate === 66.7, JSON.stringify(cm));
await st.goto(`${B}/admin/churn?month=${prevYm}`); await st.waitForSelector('table[aria-label="離反者リスト"]');
ok('離反の画面に付き率が出る', (await st.getByLabel('カルテNo 付き率').innerText()).includes('66.7%'));
ok('店舗のアカウントでは店舗ごとの付き率（本部向け）は見られない', (await api(st, 'GET', `/api/admin/hq/card-rate?month=${prevYm}`))[0] === 403);
const hq = await login('', process.env.HQ_PASSWORD ?? 'hq-pass', 'HQ');
const hr = (await api(hq, 'GET', `/api/admin/hq/card-rate?month=${prevYm}`))[1];
const s1 = hr.rows.find((r) => r.code === 'S001');
ok('本部：店舗ごとの付き率', !!s1 && s1.visits === 3 && s1.rate === 66.7 && hr.rows.length >= 2, JSON.stringify(s1));
await hq.goto(`${B}/admin/hq/overview`); await hq.waitForSelector('section[aria-label="カルテNo 付き率"]');
await hq.locator('section[aria-label="カルテNo 付き率"] button').first().click(); await hq.waitForTimeout(800);
const box = hq.locator('section[aria-label="カルテNo 付き率"]');
ok('全店状況に店舗ごとの付き率の表が出る（月を戻せる）', (await box.innerText()).includes('名前から番号につながった'));
ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
sql(`DELETE FROM cell WHERE id LIKE 'cr0%'`);
await br.close();
console.log(process.exitCode ? 'CARDRATE FAILED' : 'CARDRATE OK');
