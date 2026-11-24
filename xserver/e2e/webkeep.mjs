// Xserver（PHP）版：WEB 予約の氏名に「様」や回数（様6）を足しても予約を取消にしない（2026-11 の不具合）。
// 取消になったときは、いつ・どのアカウントで・何をしたかを予約・来院ログに出す。前の不具合で取消になった予約は、更新のときに戻す。
// 離反：「様6」などや前に書いたカルテNo を外して同じ人と見る
// 例：BASE_URL=http://127.0.0.1:3003 CHROMIUM_PATH=... node e2e/webkeep.mjs
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003', O = new URL('./', import.meta.url).pathname + 'out-';
const DB = process.env.DB_NAME ?? 'booking';
const sql = (q) => execSync(`mysql -uroot --default-character-set=utf8mb4 -N ${DB}`, { input: q }).toString().trim();
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const errs = [];
const p = await (await br.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
await p.goto(`${B}/admin/login/S001`); await p.fill('input[type=password]', 'password'); await p.click('button[type=submit]'); await p.waitForURL((u) => !u.pathname.includes('/login')); await p.waitForLoadState('networkidle');
const api = (m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);
sql('DELETE FROM rate_limit');
const D = (() => { const d = new Date(); d.setDate(d.getDate() + 3); for (;;) { const s = d.toISOString().slice(0, 10); if ([1, 2, 3, 5].includes(d.getDay()) && !['2026-11-23', '2027-01-01'].includes(s)) return s; d.setDate(d.getDate() + 1); } })();
const book = async (t, name, card) => { const r = await api('POST', '/api/public/S001/reserve', { kind: 'RETURN', cardNo: card, date: D, time: t, name, phone: '090' + String(Date.now()).slice(-8) }); return (await api('GET', `/api/admin/day?date=${D}`))[1].data.cells.find((c) => c.time === t && c.text.includes(name.split(' ')[1])); };
const status = (name) => sql(`SELECT status FROM reservation WHERE name='${name}'`);

// 1) 氏名に「様6」を足しても取消にしない（前は取消になり、履歴にも出なかった）
let c = await book(600, '見本 一郎', '1600');
await api('PUT', '/api/admin/cells', { date: D, cells: [{ time: 600, bed: c.bed, text: '見本 一郎様6', prev: c.text }] });
ok('「様6」を足しても WEB 予約はそのまま', status('見本 一郎') === 'BOOKED' && !!(await api('GET', `/api/admin/day?date=${D}`))[1].data.cells.find((x) => x.time === 600 && x.bed === c.bed).web);
await api('PUT', '/api/admin/cells', { date: D, cells: [{ time: 600, bed: c.bed, text: '1600 見本一郎', prev: '見本 一郎様6' }] });
ok('前にカルテNo を書いても同じ人', status('見本 一郎') === 'BOOKED');
// 2) 別の人に書き換えたら取消。いつ・どのアカウントで・何をしたかが残る
c = await book(660, '見本 二郎', '1601');
await api('PUT', '/api/admin/cells', { date: D, cells: [{ time: 660, bed: c.bed, text: '試験 花子', prev: c.text }] });
ok('別の人に書き換えたら取消', status('見本 二郎') === 'CANCELLED');
ok('取消の日時・アカウント・操作が残る', sql(`SELECT CONCAT(cancelledBy, '|', cancelNote) FROM reservation WHERE name='見本 二郎'`) === 'S001|予約表でセルを消した・別の人の名前に書き換えた');
const log = (await api('GET', `/api/admin/reservations?tab=web&from=${D}&to=${D}`))[1].rows.find((r) => r.name === '見本 二郎');
ok('予約・来院ログに取消の記録', (log?.cancelText ?? '').includes('S001') && log.cancelText.includes('別の人の名前に書き換えた'), log?.cancelText);
await p.goto(`${B}/admin/reservations?from=${D}&to=${D}`); await p.waitForLoadState('networkidle');
ok('画面にも出る', (await p.locator('table').textContent()).includes('別の人の名前に書き換えた'));
await p.screenshot({ path: O + 'webkeep-log.png', fullPage: true });

// 3) 前の不具合で取消になった予約は、更新のときに戻る（セルに同じ人の名前が残っていて、キャンセルの名簿にも無いもの）
c = await book(570, '見本 三郎', '1602');
sql(`UPDATE reservation SET status='CANCELLED' WHERE name='見本 三郎'; UPDATE cell SET text='見本 三郎様3', reservationId=NULL WHERE date='${D}' AND time=570 AND bed=${c.bed}; UPDATE app_meta SET v=63 WHERE k='schema'`);
await api('GET', '/api/admin/me');
ok('更新のときに、前の不具合で取消になった予約を戻す', status('見本 三郎') === 'BOOKED' && sql(`SELECT COUNT(*) FROM cell WHERE reservationId=(SELECT id FROM reservation WHERE name='見本 三郎')`) === '1');
ok('別の人に書き換えた予約は戻さない', status('見本 二郎') === 'CANCELLED');

// 4) 離反：「様5」「様6」は同じ人（前は別の人と見て、通っているのに離反に出た）
const sid = sql("SELECT id FROM store WHERE code='S001'");
const mon = new Date(Date.now() + 9 * 3600e3); mon.setUTCDate(1); mon.setUTCMonth(mon.getUTCMonth() - 1);
const ym = mon.toISOString().slice(0, 7);
const prev = new Date(`${ym}-01T00:00:00Z`); prev.setUTCMonth(prev.getUTCMonth() - 1);
const pv = prev.toISOString().slice(0, 7);
sql(`INSERT INTO cell (id, storeId, date, time, bed, text, visited) VALUES ('ck1', '${sid}', '${pv}-03', 540, 1, '見本 四郎様5', 1), ('ck2', '${sid}', '${pv}-20', 540, 1, '見本 四郎様6', 1), ('ck3', '${sid}', '${pv}-04', 540, 2, '見本 五郎', 1)`);
const ch = (await api('GET', `/api/admin/churn?month=${ym}`))[1].rows.map((r) => r.name);
ok('「様5」の来院は、そのあと「様6」で来ているので離反に出ない', !ch.some((n) => n.includes('四郎') && n.includes('5')) , JSON.stringify(ch));
ok('来ていない方は離反に出る', ch.some((n) => n.includes('五郎')), JSON.stringify(ch));
ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
console.log(process.exitCode ? 'WEBKEEP FAILED' : 'WEBKEEP OK');
