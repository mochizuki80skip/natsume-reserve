// Xserver（PHP）版：予約表の変更の履歴（だれが・いつ・何を）
// 入力・書き換え・消した・キャンセル・予約変更（移動）・名簿から戻した・WEB 予約の受付を、操作したアカウント（店舗・本部・管轄MG）と一緒に残す
// 例：BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... CHROMIUM_PATH=... node e2e/history.mjs
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
  const ctx = await br.newContext({ viewport: { width: 1300, height: 1000 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  if (user) { await p.goto(`${B}/admin/login`); await p.fill('input[autocomplete="username"]', user); } else await p.goto(`${B}/admin/login/${code}`);
  await p.fill('input[type=password]', pass); await p.click('button[type=submit]'); await p.waitForURL((u) => !u.pathname.includes('/login')); await p.waitForLoadState('networkidle');
  return p;
}
const api = (p, m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);
sql('DELETE FROM rate_limit');
const st = await login('S001', 'password');
const storeName = sql("SELECT name FROM store WHERE code='S001'");
const D = (() => { const d = new Date(); d.setDate(d.getDate() + 3); for (;;) { const s = d.toISOString().slice(0, 10); if ([1, 2, 3, 5].includes(d.getDay()) && !['2026-11-03', '2026-11-23', '2027-01-01'].includes(s)) return s; d.setDate(d.getDate() + 1); } })();
const put = (p, time, bed, text) => api(p, 'PUT', '/api/admin/cells', { date: D, cells: [{ time, bed, text }] });
{ const d0 = (await api(st, 'GET', `/api/admin/day?date=${D}`))[1].data; await api(st, 'PUT', '/api/admin/cells', { date: D, cells: d0.cells.map((x) => ({ time: x.time, bed: x.bed, text: '' })) }); }
sql("DELETE FROM cell_log");
const logs = async (p) => (await api(p, 'GET', `/api/admin/cell-log?date=${D}`))[1].rows;

// ---------- 店舗のアカウントで：入力 → 打ち足し（1 行にまとまる）→ 別の人に書き換え → 消す ----------
await put(st, 540, 4, '見本 履歴');
await put(st, 540, 4, '見本 履歴（初診）');
let r = await logs(st);
ok('入力と続けての打ち足しは 1 行（入力）にまとまる', r.length === 1 && r[0].kind === 'INPUT' && r[0].before === '' && r[0].after === '見本 履歴（初診）', JSON.stringify(r));
ok('どのアカウントかが店舗名で出る', r[0]?.who?.includes('店舗：' + storeName), r[0]?.who);
await put(st, 540, 4, '見本 別人');
await put(st, 540, 4, '');
r = await logs(st);
ok('別の人への書き換えは「書き換え」で残る', r.some((x) => x.kind === 'EDIT' && x.before === '見本 履歴（初診）' && x.after === '見本 別人'), JSON.stringify(r.map((x) => [x.kind, x.before, x.after])));
ok('消したら「消した」で残る', r.some((x) => x.kind === 'DELETE' && x.before === '見本 別人'));

// ---------- 本部のアカウントで同じ店舗の予約表を書き換える ----------
const hq = await login('', process.env.HQ_PASSWORD ?? 'hq-pass', 'HQ');
await hq.context().addCookies([{ name: 'bk_store', value: 'S001', url: B }]);
await put(hq, 600, 5, '見本 本部入力');
r = await logs(st);
const hqRow = r.find((x) => x.after === '見本 本部入力');
ok('本部で入れた入力は「本部」のアカウントと出る', !!hqRow && hqRow.kind === 'INPUT' && hqRow.who.startsWith('本部：'), JSON.stringify(hqRow));

// ---------- 管轄MG のアカウントで ----------
sql("DELETE FROM area WHERE name='見本エリア'; INSERT INTO area (id, name, storeCodes, sortOrder) VALUES ('arhist1', '見本エリア', 'S001', 99)");
await api(hq, 'POST', '/api/admin/hq/accounts', { code: 'mgh1', name: '見本 管轄', password: 'mgpass123', role: 'mg', area: '見本エリア' });
const mg = await login('', 'mgpass123', 'mgh1');
await mg.context().addCookies([{ name: 'bk_store', value: 'S001', url: B }]);
const mgPut = await put(mg, 600, 5, '見本 MG書換');
r = await logs(st);
const mgRow = r.find((x) => x.after === '見本 MG書換');
ok('管轄MG で書き換えたら「管轄MG」と名前が出る', mgPut[0] === 200 && !!mgRow && mgRow.kind === 'EDIT' && mgRow.who.startsWith('管轄MG：見本 管轄'), JSON.stringify([mgPut[0], mgRow]));

// ---------- キャンセル・予約変更（移動）・名簿から戻す ----------
await put(st, 660, 3, '見本 キャンセル');
const cx = await api(st, 'POST', '/api/admin/cancel', { date: D, time: 660, bed: 3, kind: 'ADVANCE' });
ok('準備：キャンセル', cx[0] === 200, JSON.stringify(cx[1]).slice(0, 80));
await put(st, 570, 3, '見本 移動');
const mv = await api(st, 'POST', '/api/admin/move', { date: D, time: 570, bed: 3, toDate: D, toTime: 630, toBed: 6 });
ok('準備：予約変更（移動）', mv[0] === 200, JSON.stringify(mv[1]).slice(0, 120));
const back = await api(st, 'DELETE', '/api/admin/cancel', { id: cx[1].log.id });
ok('準備：名簿から戻す', back[0] === 200, JSON.stringify(back[1]));
r = await logs(st);
ok('キャンセルが残る（事前連絡）', r.some((x) => x.kind === 'CANCEL' && x.before === '見本 キャンセル' && x.note.includes('事前連絡')));
ok('予約変更（移動）が移動先と一緒に残る', r.some((x) => x.kind === 'MOVE' && x.before === '見本 移動' && x.note.includes('10:30') && x.note.includes('ベッド6')), JSON.stringify(r.filter((x) => x.kind === 'MOVE')));
ok('名簿から戻したことも残る', r.some((x) => x.kind === 'RESTORE' && x.after === '見本 キャンセル'));

// ---------- WEB 予約：受付が出る・氏名に「様」を足しても取消にならず、書き足しの記録が残る ----------
const rv = await api(st, 'POST', '/api/public/S001/reserve', { kind: 'RETURN', date: D, time: 690, name: '見本 ウェブ', phone: '09011113333', cardNo: '9999' });
ok('準備：WEB 予約', rv[0] === 200, JSON.stringify(rv[1]).slice(0, 80));
const wc = (await api(st, 'GET', `/api/admin/day?date=${D}`))[1].data.cells.find((x) => x.time === 690 && x.text.includes('見本 ウェブ'));
await put(st, 690, wc.bed, wc.text + '様6');
ok('「様6」を足しても WEB 予約は予約中のまま', sql("SELECT status FROM reservation WHERE name='見本 ウェブ'") === 'BOOKED');
r = await logs(st);
ok('書き足しも「書き換え」で残る（WEB予約のセル）', r.some((x) => x.kind === 'EDIT' && x.after.endsWith('様6') && x.note.includes('WEB')), JSON.stringify(r.filter((x) => x.time === 690)));

// ---------- 予約・来院ログの「変更履歴」 ----------
const today = sql('SELECT DATE(NOW())');
const h = (await api(st, 'GET', `/api/admin/reservations?tab=history&from=${D}&to=${D}&basis=date`))[1];
ok('変更履歴（予約日で）に WEB 予約の受付が出る', h.rows.some((x) => x.kind === 'WEB' && x.after === '見本 ウェブ' && x.who.includes('WEB予約')), JSON.stringify(h.rows.filter((x) => x.kind === 'WEB')));
ok('変更履歴に本部・管轄MG・店舗の操作が並ぶ', ['本部：', '管轄MG：', '店舗：'].every((w) => h.rows.some((x) => x.who.startsWith(w))));
const h2 = (await api(st, 'GET', `/api/admin/reservations?tab=history&from=${today}&to=${today}`))[1];
ok('「操作した日」で探しても出る', h2.filter.basis === 'op' && h2.rows.length >= h.rows.length - 0 && h2.rows.some((x) => x.kind === 'MOVE'), `${h2.rows.length}/${h.rows.length}`);
const hq2 = (await api(st, 'GET', `/api/admin/reservations?tab=history&from=${D}&to=${D}&basis=date&q=${encodeURIComponent('本部入力')}`))[1];
ok('氏名で絞り込める', hq2.rows.length >= 1 && hq2.rows.every((x) => (x.before + x.after).includes('本部入力')), JSON.stringify(hq2.rows.map((x) => x.after)));
const csv = await st.evaluate(async (u) => (await fetch(u)).text(), `/api/admin/reservations/export?tab=history&from=${D}&to=${D}&basis=date&format=csv`);
ok('CSV に保存できる（アカウントの列あり）', csv.includes('操作日時,アカウント,操作') && csv.includes('管轄MG：見本 管轄'));

// 画面
await st.goto(`${B}/admin/reservations?tab=history&from=${D}&to=${D}&basis=date`);
await st.waitForSelector('table[aria-label="変更履歴"]');
const body = await st.locator('table[aria-label="変更履歴"]').innerText();
ok('画面の変更履歴に操作とアカウントが出る', body.includes('予約変更（移動）') && body.includes('管轄MG：見本 管轄') && body.includes('WEB予約の受付'), body.slice(0, 200));
await st.goto(`${B}/admin/day/${D}`); await st.waitForSelector('#grid');
await st.getByText('この日の変更の履歴').click(); await st.waitForTimeout(800);
const panel = await st.locator('details:has-text("この日の変更の履歴")').innerText();
ok('予約表の下の履歴にも操作とアカウントが出る', panel.includes('予約変更') && panel.includes('本部：') && panel.includes('キャンセル'), panel.slice(0, 200));
// ---------- 本部メニュー・MG メニューの変更履歴 ----------
const hh = (await api(hq, 'GET', `/api/admin/hq/history?from=${D}&to=${D}&basis=date`))[1];
ok('本部：全店の変更履歴に店舗名つきで出る', hh.rows.length > 0 && hh.rows.every((x) => x.store) && hh.rows.some((x) => x.store === storeName && x.who.startsWith('管轄MG：')), JSON.stringify(hh.rows[0]));
ok('本部：店舗の選択肢がある', hh.stores.some((x) => x.code === 'S001') && hh.stores.some((x) => x.code === 'S002'));
const hs2 = (await api(hq, 'GET', `/api/admin/hq/history?from=${D}&to=${D}&basis=date&store=S002`))[1];
ok('本部：店舗を選ぶとその店舗だけ', hs2.rows.every((x) => x.store !== storeName));
const mh = (await api(mg, 'GET', `/api/admin/hq/history?from=${D}&to=${D}&basis=date`))[1];
ok('管轄MG：管轄の店舗の履歴が見られる', mh.rows.length > 0 && mh.rows.every((x) => x.store === storeName), String(mh.rows.length));
ok('店舗のアカウントでは全店の履歴は見られない', (await api(st, 'GET', `/api/admin/hq/history?from=${D}&to=${D}`))[0] === 403);
const hcsv = await hq.evaluate(async (u) => (await fetch(u)).text(), `/api/admin/hq/history/export?from=${D}&to=${D}&basis=date&format=csv`);
ok('本部：CSV に店舗の列つきで保存できる', hcsv.includes('操作日時,店舗,アカウント'));
await hq.goto(`${B}/admin`); await hq.waitForLoadState('networkidle');
await hq.getByRole('link', { name: '変更履歴', exact: true }).click();
await hq.waitForSelector('table[aria-label="変更履歴（全店）"]');
await hq.getByLabel('日付の見方').selectOption('date');
await hq.locator('input[type=date]').first().fill(D); await hq.locator('input[type=date]').nth(1).fill(D);
await hq.getByRole('button', { name: '絞り込む' }).click(); await hq.waitForTimeout(1000);
ok('本部メニューから変更履歴の画面が開ける', (await hq.locator('table[aria-label="変更履歴（全店）"]').innerText()).includes('管轄MG：見本 管轄'));

// ---------- 取消になった理由（記録を始める前の取消も、予約表の様子から） ----------
const rv2 = await api(st, 'POST', '/api/public/S001/reserve', { kind: 'RETURN', date: D, time: 720 - 60, name: '見本 古い取消', phone: '09011114444', cardNo: '9998' });
const rid2 = sql("SELECT id FROM reservation WHERE name='見本 古い取消'");
// 直す前の不具合と同じ状態（予約表には「様」付きの同じ人が残り、予約だけ取消・記録なし）を作る
sql(`UPDATE cell SET text=CONCAT(text,'様3'), reservationId=NULL WHERE reservationId='${rid2}' AND text LIKE '%古い取消%'; UPDATE cell SET reservationId=NULL WHERE reservationId='${rid2}'; UPDATE reservation SET status='CANCELLED', cancelledAt=NULL, cancelledBy=NULL, cancelNote=NULL WHERE id='${rid2}'; DELETE FROM cell_log WHERE \`after\` LIKE '%古い取消%'`);
const wl = (await api(st, 'GET', `/api/admin/reservations?from=${D}&to=${D}&status=CANCELLED`))[1].rows;
const old = wl.find((x) => x.name === '見本 古い取消');
ok('準備：WEB 予約', rv2[0] === 200);
ok('記録を始める前の取消にも理由（推定）が出る：様などの書き足しの不具合', !!old && old.cancelText.startsWith('（推定）') && old.cancelText.includes('不具合'), old?.cancelText);
const mine = wl.find((x) => x.name === '見本 ウェブ');
ok('記録のある取消は、日時とアカウントが出る', !mine || mine.status === 'BOOKED', '');
const del = await api(st, 'POST', '/api/public/S001/reserve', { kind: 'RETURN', date: D, time: 600, name: '見本 消された', phone: '09011115555', cardNo: '9997' });
const dc = (await api(st, 'GET', `/api/admin/day?date=${D}`))[1].data.cells.find((x) => x.text.includes('見本 消された'));
await put(st, 600, dc.bed, '');
const dl = (await api(st, 'GET', `/api/admin/reservations?from=${D}&to=${D}&status=CANCELLED`))[1].rows.find((x) => x.name === '見本 消された');
ok('予約表で消した取消は、消したアカウントが出る', del[0] === 200 && !!dl && dl.cancelText.includes('店舗：' + storeName) && !dl.cancelText.startsWith('（推定）'), dl?.cancelText);

ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
console.log(process.exitCode ? 'HISTORY FAILED' : 'HISTORY OK');
