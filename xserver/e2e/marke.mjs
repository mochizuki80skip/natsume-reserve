// Xserver（PHP）版：本部メニュー・MG メニューの「📈 マーケ」
// ① 店舗ごとの入件（日ごと：新規・再来・新自・新三・来院数、前年同月、広告費の配分）② きっかけ別（店舗ごと）③ URL・QR の月別。全体・エリア・店舗
// 例：BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... CHROMIUM_PATH=... node e2e/marke.mjs
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
const today = (await api(hq, 'GET', '/api/admin/me'))[1].today;
const ym = today.slice(0, 7), ly = `${Number(ym.slice(0, 4)) - 1}${ym.slice(4)}`;
const s1 = sql("SELECT id FROM store WHERE code='S001'"), s2 = sql("SELECT id FROM store WHERE code='S002'");
sql(`DELETE FROM karte; DELETE FROM cell WHERE date LIKE '${ym}%'; DELETE FROM visit_archive`);
let n = 0;
const k = (sid, date, kind, trig, detail = '') => sql(`INSERT INTO karte (id, storeId, date, kind, name, trig, trigDetail, visits) VALUES ('mk${String(++n).padStart(6, '0')}', '${sid}', '${date}', '${kind}', '見本${n}', '${trig}', '${detail}', '[]')`);
// 今月：S001 新規 3（2 日に 2・3 日に 1。Google 2・チラシ／ワンコイン 1）・再来 1・新自 1、S002 新規 1（Google）・新三 1。前年同月：S001 新規 1
k(s1, `${ym}-02`, 'NEW', 'Google'); k(s1, `${ym}-02`, 'NEW', 'Google'); k(s1, `${ym}-03`, 'NEW', 'チラシ', 'ワンコイン');
k(s1, `${ym}-03`, 'REVISIT', 'LINE'); k(s1, `${ym}-04`, 'ACCIDENT', '自院HP');
k(s2, `${ym}-02`, 'NEW', 'Google'); k(s2, `${ym}-05`, 'THIRD', 'Google');
k(s1, `${ly}-10`, 'NEW', 'SNS');
// 来院数：S001 の 2 日に 3 人
for (const [i, nm] of ['見本 来A', '見本 来B', '見本 来C'].entries()) sql(`INSERT INTO cell (id, storeId, date, time, bed, text, visited) VALUES ('mkc${i}', '${s1}', '${ym}-02', ${540 + i * 30}, 1, '${nm}', 1)`);

// ---------- ① 店舗ごとの入件 ----------
const d = (await api(hq, 'GET', `/api/admin/marke/daily?month=${ym}&kind=NEW`))[1];
ok('新規（新患だけ）を店舗・日ごとに数える', d.counts.S001?.[`${ym}-02`] === 2 && d.counts.S001?.[`${ym}-03`] === 1 && d.counts.S002?.[`${ym}-02`] === 1 && !d.counts.S002?.[`${ym}-05`], JSON.stringify(d.counts));
ok('前年同月の合計', d.lastYear.S001 === 1, JSON.stringify(d.lastYear));
const kinds = async (kind) => (await api(hq, 'GET', `/api/admin/marke/daily?month=${ym}&kind=${kind}`))[1].counts;
ok('再来・新自・新三・来院数も見られる', (await kinds('REVISIT')).S001?.[`${ym}-03`] === 1 && (await kinds('ACCIDENT')).S001?.[`${ym}-04`] === 1 && (await kinds('THIRD')).S002?.[`${ym}-05`] === 1 && (await kinds('VISIT')).S001?.[`${ym}-02`] === 3);
ok('広告費の配分を入れられる（本部）', (await api(hq, 'PUT', '/api/admin/marke/budget', { month: ym, store: 'S001', amount: 5 }))[0] === 200 && (await api(hq, 'GET', `/api/admin/marke/daily?month=${ym}&kind=NEW`))[1].budget.S001 === 5);

// ---------- ② きっかけ別 ----------
const t = (await api(hq, 'GET', `/api/admin/marke/trig?period=month&month=${ym}`))[1];
ok('きっかけ別（新患）', t.counts.S001?.Google === 2 && t.counts.S001?.['チラシ'] === 1 && t.counts.S002?.Google === 1 && !t.counts.S001?.['自院HP'] && t.details.S001?.['チラシ']?.['ワンコイン'] === 1, JSON.stringify(t.counts));
const t2 = (await api(hq, 'GET', `/api/admin/marke/trig?period=month&month=${ym}&withInjury=1`))[1];
ok('新自・新三も含められる', t2.counts.S001?.['自院HP'] === 1 && t2.counts.S002?.Google === 2);
const fy = Number(ym.slice(5)) >= 4 ? Number(ym.slice(0, 4)) : Number(ym.slice(0, 4)) - 1;
ok('年度・期間でも見られる', (await api(hq, 'GET', `/api/admin/marke/trig?period=fy&fy=${fy}`))[1].counts.S001?.Google === 2 && (await api(hq, 'GET', `/api/admin/marke/trig?period=range&from=${ym}-03&to=${ym}-28`))[1].counts.S001?.Google === undefined);

// ---------- ③ URL・QR の月別 ----------
await api(hq, 'PUT', '/api/admin/hq/campaigns', { label: '見本 マーケチラシ', trig: 'チラシ' });
const camp = (await api(hq, 'GET', '/api/admin/hq/campaigns'))[1].rows.find((r) => r.label === '見本 マーケチラシ');
const cj = JSON.stringify({ id: camp.id, route: 'c', name: '', trig: 'チラシ', detail: '見本 マーケチラシ' }).replace(/'/g, "''");
const res = (id, sid, kind, visited, status = 'BOOKED') => sql(`INSERT INTO reservation (id, storeId, date, time, bed, kind, name, phone, status, viewToken, campaign, visited, createdAt) VALUES ('${id}', '${sid}', '${ym}-06', 600, 1, '${kind}', '見本 予約', '+819000000000', '${status}', 'tok_${id}', '${cj}', ${visited}, NOW())`);
res('mkr1', s1, 'NEW', 1); res('mkr2', s1, 'NEW', 0); res('mkr3', s1, 'RETURN', 1); res('mkr4', s2, 'NEW', 1); res('mkr5', s1, 'NEW', 0, 'CANCELLED');
const u = (await api(hq, 'GET', `/api/admin/marke/urls?fy=${fy}`))[1].urls.find((x) => x.id === camp.id);
ok('URL・QR の月別：WEB 予約・新規・来院・来院した新規', JSON.stringify(u?.months?.[ym]) === JSON.stringify({ res: 4, resNew: 3, came: 3, cameNew: 2 }), JSON.stringify(u?.months));
const u1 = (await api(hq, 'GET', `/api/admin/marke/urls?fy=${fy}&store=S001`))[1].urls.find((x) => x.id === camp.id);
ok('店舗を選ぶとその店舗の分だけ', u1?.months?.[ym]?.cameNew === 1);

// ---------- 管轄MG：全体・エリア・店舗で見られる。配分は管轄の店舗だけ ----------
await api(hq, 'PUT', '/api/admin/hq/areas', { areas: [{ name: '見本東エリア', stores: ['S002'] }, { name: '見本西エリア', stores: ['S001'] }] });
await api(hq, 'POST', '/api/admin/hq/accounts', { code: 'mgmk1', name: '見本 MG', password: 'mgpass123', role: 'mg', area: '見本東エリア' });
const mg = await login('', 'mgpass123', 'mgmk1');
const md = (await api(mg, 'GET', `/api/admin/marke/daily?month=${ym}&kind=NEW`))[1];
ok('管轄MG：全店の数字が見られる', md.counts.S001?.[`${ym}-02`] === 2 && JSON.stringify(md.mine) === JSON.stringify(['S002']));
ok('管轄MG：配分は管轄の店舗だけ', (await api(mg, 'PUT', '/api/admin/marke/budget', { month: ym, store: 'S002', amount: 10 }))[0] === 200 && (await api(mg, 'PUT', '/api/admin/marke/budget', { month: ym, store: 'S001', amount: 1 }))[0] === 403);
const st = await login('S001', 'password');
ok('店舗のアカウントでは見られない', (await api(st, 'GET', `/api/admin/marke/daily?month=${ym}`))[0] === 403);

// ---------- 画面 ----------
await mg.goto(`${B}/admin/marke`); await mg.waitForSelector('table[aria-label="店舗ごとの入件"]'); await mg.waitForTimeout(600);
ok('管轄MG：はじめは自分のエリア', (await mg.getByLabel('見る範囲').inputValue()) === 'a:見本東エリア');
await mg.getByLabel('見る範囲').selectOption('all'); await mg.waitForTimeout(300);
ok('全体にするとエリアごとの合計が出る', (await mg.getByLabel('エリアごとの合計').innerText()).includes('見本西エリア'));
ok('月の合計（全体）', (await mg.getByLabel('月の合計（全体）').innerText()) === '4');
await hq.goto(`${B}/admin/marke`); await hq.waitForSelector('table[aria-label="店舗ごとの入件"]'); await hq.waitForTimeout(600);
ok('本部メニューから開ける・配分の欄', (await hq.getByLabel(/の広告費の配分$/).count()) >= 2);
await hq.getByRole('tab', { name: '② きっかけ別（店舗ごと）' }).click(); await hq.waitForSelector('table[aria-label="きっかけ別（店舗ごと）"]');
const tt = await hq.locator('table[aria-label="きっかけ別（店舗ごと）"]').innerText();
ok('きっかけ別の表（店舗×きっかけ・割合）', tt.includes('Google') && tt.includes('チラシ') && tt.includes('割合'), tt.slice(0, 200));
await hq.getByRole('button', { name: 'チラシ' }).click();
ok('きっかけを押すと内訳', (await hq.getByLabel('きっかけの内訳').innerText()).includes('ワンコイン'));
await hq.getByRole('tab', { name: '③ URL・QR の月別' }).click(); await hq.waitForSelector('table[aria-label="URL・QR の月別"]');
ok('URL・QR の月別の表', (await hq.locator('table[aria-label="URL・QR の月別"]').innerText()).includes('見本 マーケチラシ'));
await hq.screenshot({ path: new URL('./', import.meta.url).pathname + 'out-marke.png', fullPage: true });
ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
sql("DELETE FROM reservation WHERE id LIKE 'mkr%'");
await br.close();
console.log(process.exitCode ? 'MARKE FAILED' : 'MARKE OK');
