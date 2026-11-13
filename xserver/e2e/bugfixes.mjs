// Xserver（PHP）版：2026-11 の点検で見つかった不具合の確認（直す前は失敗する）
// WEB 予約：枠の時刻でない時間・「休み」などの印と同じ名前・全角の電話番号・確認だけ（dryRun）で他人の予約が分からない
// 予約表：WEB 予約のセルを別の人の名前に書き換えたら予約は取消・2 回キャンセルしても名簿は 1 件・同時に動かしても 2 か所にならない
// そのほか：担当数の月の形・新患継続率の行が予約と一緒に動く・エリア名を変えても管轄MG がつながる・店舗コードを変えても URL の店舗がつながる
// 例：BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... CHROMIUM_PATH=... node e2e/bugfixes.mjs
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
async function login(code, pass, user) {
  const p = await (await br.newContext()).newPage();
  if (user) { await p.goto(`${B}/admin/login`); await p.fill('input[autocomplete="username"]', user); } else await p.goto(`${B}/admin/login/${code}`);
  await p.fill('input[type=password]', pass); await p.click('button[type=submit]'); await p.waitForURL(/admin\//); await p.waitForLoadState('networkidle');
  return p;
}
const api = (p, m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);
sql('DELETE FROM rate_limit');
const st = await login('S001', 'password');
// 3 日以上先の営業日（月・火・水・金）
const D = (() => { const d = new Date(); d.setDate(d.getDate() + 3); for (;;) { const s = d.toISOString().slice(0, 10); if ([1, 2, 3, 5].includes(d.getDay()) && !['2026-11-03', '2026-11-23', '2027-01-01'].includes(s)) return s; d.setDate(d.getDate() + 1); } })();
{ const d0 = (await api(st, 'GET', `/api/admin/day?date=${D}`))[1].data; await api(st, 'PUT', '/api/admin/cells', { date: D, cells: d0.cells.map((x) => ({ time: x.time, bed: x.bed, text: '' })) }); }
const reserve = (b) => api(st, 'POST', '/api/public/S001/reserve', { kind: 'RETURN', date: D, cardNo: '1', ...b });
const ph = () => '090' + String(Date.now() + Math.random() * 1e6 | 0).slice(-8);

// ---------- WEB 予約 ----------
ok('枠の時刻でない時間（9:05）は受けない', (await reserve({ time: 545, name: '見本 ずれ', phone: ph() }))[0] === 409);
for (const n of ['休み', '×', 'x', '-']) ok(`お名前が予約表の印（${n}）だと受けない`, (await reserve({ time: 540, name: n, phone: ph() }))[0] === 400);
const zen = await reserve({ time: 540, name: '見本 全角', phone: '０９０１２３４５６７８' });
ok('全角の電話番号でも受ける', zen[0] === 200, JSON.stringify(zen[1]).slice(0, 80));
const dry = await api(st, 'POST', '/api/public/S001/reserve-group', { dryRun: true, phone: '09012345678', people: [{ kind: 'RETURN', date: D, time: 600, name: '見本 全角' }, { kind: 'RETURN', date: D, time: 600 }] });
ok('確認だけ（dryRun）では、同じお名前・電話番号の予約があるかは分からない', dry[0] === 200 && dry[1].dryRun === true, JSON.stringify(dry[1]));
ok('グループでも枠の時刻でない時間は受けない', (await api(st, 'POST', '/api/public/S001/reserve-group', { phone: ph(), people: [{ kind: 'RETURN', date: D, time: 547, name: '見本 一', cardNo: '1' }, { kind: 'RETURN', date: D, time: 547, name: '見本 二', cardNo: '2' }] }))[0] === 409);

// ---------- 予約表：WEB 予約のセルを別の人の名前に書き換える ----------
const w = await api(st, 'POST', '/api/public/S001/reserve', { kind: 'NEW', date: D, time: 660, name: '見本 上書', phone: ph() });
const bed = Number(sql(`SELECT bed FROM reservation WHERE id = '${w[1].id}'`));
await api(st, 'PUT', '/api/admin/cells', { date: D, cells: [{ time: 660, bed, text: '見本 上書（初診）様', prev: '見本 上書（初診）' }] });
ok('（初診）や「様」の付け外しだけなら WEB 予約のまま', sql(`SELECT status FROM reservation WHERE id = '${w[1].id}'`) === 'BOOKED' && sql(`SELECT COUNT(*) FROM cell WHERE reservationId = '${w[1].id}'`) === '2');
await api(st, 'PUT', '/api/admin/cells', { date: D, cells: [{ time: 660, bed, text: '試験 別人', prev: '見本 上書（初診）様' }] });
ok('別の人の名前に書き換えたら、WEB 予約は取消・セルは WEB 予約から外れる', sql(`SELECT status FROM reservation WHERE id = '${w[1].id}'`) === 'CANCELLED' && sql(`SELECT COUNT(*) FROM cell WHERE reservationId = '${w[1].id}'`) === '0' && sql(`SELECT COALESCE(reservationId, '') FROM cell WHERE date = '${D}' AND time = 660 AND bed = ${bed}`) === '');
// 氏名のセルだけ消したとき（2 枠目が残る）も取消
const w2 = await api(st, 'POST', '/api/public/S001/reserve', { kind: 'NEW', date: D, time: 690, name: '見本 一枠消', phone: ph() });
const bed2 = Number(sql(`SELECT bed FROM reservation WHERE id = '${w2[1].id}'`));
await api(st, 'PUT', '/api/admin/cells', { date: D, cells: [{ time: 690, bed: bed2, text: '', prev: '見本 一枠消（初診）' }] });
ok('氏名のセルだけ消しても（2 枠目が残っても）、WEB 予約は取消', sql(`SELECT status FROM reservation WHERE id = '${w2[1].id}'`) === 'CANCELLED');

// ---------- 2 回キャンセル・同時に動かす ----------
await api(st, 'PUT', '/api/admin/cells', { date: D, cells: [{ time: 900, bed: 1, text: '見本 二回' }, { time: 930, bed: 1, text: '見本 二重移動' }] });
const c1 = await api(st, 'POST', '/api/admin/cancel', { date: D, time: 900, bed: 1, kind: 'ADVANCE' });
const c2 = await api(st, 'POST', '/api/admin/cancel', { date: D, time: 900, bed: 1, kind: 'ADVANCE' });
ok('2 回キャンセルしても名簿は 1 件', c1[0] === 200 && c2[0] === 404 && sql(`SELECT COUNT(*) FROM cancel_log WHERE date = '${D}' AND name = '見本 二回'`) === '1');
const [m1, m2] = await Promise.all([
  api(st, 'POST', '/api/admin/move', { date: D, time: 930, bed: 1, toDate: D, toTime: 960, allowOver: true }),
  api(st, 'POST', '/api/admin/move', { date: D, time: 930, bed: 1, toDate: D, toTime: 990, allowOver: true }),
]);
ok('同じ予約を同時に 2 か所へ動かしても、予約は 1 か所', sql(`SELECT COUNT(*) FROM cell WHERE date = '${D}' AND text = '見本 二重移動'`) === '1', `${m1[0]} ${m2[0]}`);
// 元に戻すとき、動かした先が別の人に変わっていたら戻さない
await api(st, 'PUT', '/api/admin/cells', { date: D, cells: [{ time: 1020, bed: 2, text: '見本 入替' }] });
ok('元に戻す：動かした先が別の人なら戻さない', (await api(st, 'POST', '/api/admin/move', { date: D, time: 1020, bed: 2, toDate: D, toTime: 1035, allowOver: true, expectText: '見本 別の人' }))[0] === 409);

// ---------- 新患継続率の行が予約と一緒に動く ----------
await api(st, 'PUT', '/api/admin/cells', { date: D, cells: [{ time: 1080, bed: 1, text: '見本 継続（初診）' }, { time: 1095, bed: 1, text: '上記初診対応' }] });
await api(st, 'PUT', '/api/admin/visit', { date: D, time: 1080, bed: 1, visited: true });
await api(st, 'GET', `/api/admin/karte?month=${D.slice(0, 7)}`);
await api(st, 'POST', '/api/admin/move', { date: D, time: 1080, bed: 1, toDate: D, toTime: 1080, toBed: 3, allowOver: true });
await api(st, 'GET', `/api/admin/karte?month=${D.slice(0, 7)}`);
ok('同じ日に動かしても、新患継続率は 1 行（二重に数えない）', sql(`SELECT COUNT(*) FROM karte WHERE date = '${D}' AND name LIKE '見本継続%'`) === '1' && sql(`SELECT srcBed FROM karte WHERE date = '${D}' AND name LIKE '見本継続%'`) === '3');
// 2 枠目：氏名に（初診）が無くても、下に「上記初診対応」があれば一緒に動く
await api(st, 'PUT', '/api/admin/cells', { date: D, cells: [{ time: 1140, bed: 1, text: '見本 印なし' }, { time: 1155, bed: 1, text: '上記初診対応' }] });
await api(st, 'POST', '/api/admin/move', { date: D, time: 1140, bed: 1, toDate: D, toTime: 1140, toBed: 4, allowOver: true });
ok('氏名に印が無くても、2 枠目は一緒に動く（元の場所に残らない）', sql(`SELECT COUNT(*) FROM cell WHERE date = '${D}' AND bed = 1 AND time = 1155`) === '0' && sql(`SELECT text FROM cell WHERE date = '${D}' AND bed = 4 AND time = 1155`) === '上記初診対応');

// ---------- 本部 ----------
ok('担当数：存在しない月（13 月）は 400', (await api(st, 'GET', '/api/admin/staff-counts?month=2026-13'))[0] === 400);
const hq = await login('', process.env.HQ_PASSWORD ?? 'hq-pass', 'HQ');
await api(hq, 'PUT', '/api/admin/hq/areas', { areas: [{ name: '見本エリア', stores: ['S001'] }] });
const area = (await api(hq, 'GET', '/api/admin/hq/karte/options'))[1].areas[0];
await api(hq, 'POST', '/api/admin/hq/accounts', { code: 'mgbug', name: '見本 MG', password: 'mgpass123', role: 'mg', area: '見本エリア' });
await api(hq, 'PUT', '/api/admin/hq/areas', { areas: [{ ...area, name: '見本エリア改' }] });
ok('エリア名を変えたら、管轄MG のエリア名もそろう', sql("SELECT area FROM admin_account WHERE code = 'mgbug'") === '見本エリア改');
sql("INSERT INTO campaign (id, route, name, stores, active, code) VALUES ('cbug', 'c:zzbug1', '見本 URL', 'S002', 1, 'zzbug1') ON DUPLICATE KEY UPDATE stores = 'S002';");
const ch = await api(hq, 'PUT', '/api/admin/hq/stores', { code: 'S002', action: 'update', newCode: 'S002B' });
ok('店舗コードを変えたら、URL・QR の使う店舗もそろう', sql("SELECT stores FROM campaign WHERE id = 'cbug'") === 'S002B', JSON.stringify(ch));
await api(hq, 'PUT', '/api/admin/hq/stores', { code: 'S002B', action: 'update', newCode: 'S002' });
sql("DELETE FROM campaign WHERE id = 'cbug'; DELETE FROM admin_account WHERE code = 'mgbug';");

await br.close();
console.log(process.exitCode ? 'BUGFIXES FAILED' : 'BUGFIXES OK');
