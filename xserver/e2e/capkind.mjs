// Xserver（PHP）版：新規・再来の同時対応数（シフトの「初回を担当する」「再来を担当する」の人数と店舗設定）（サンプル店舗 S001）
// 例：ともふさ 新〇再〇／室塚 新〇再〇／山本 新×再〇 → 新規は同時 2 人、再来は同時 3 人、合計は 3 人まで
// 例：BASE_URL=http://127.0.0.1:3003 CHROMIUM_PATH=... node e2e/capkind.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const p = await br.newPage({ viewport: { width: 1366, height: 900 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
await p.goto(B + '/admin/login/S001'); await p.fill('input[type=password]', 'password'); await p.click('button[type=submit]'); await p.waitForURL(/admin\/day/);
const api = (m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);
const D = (() => { const d = new Date(); d.setDate(d.getDate() + 3); for (;;) { const s = d.toISOString().slice(0, 10); if ([1, 2, 3, 5].includes(d.getDay()) && !['2026-11-03', '2026-11-23', '2027-01-01'].includes(s)) return s; d.setDate(d.getDate() + 1); } })() // 3 日後以降の平日（木・日・祝を除く）;

const st = async (kind, time) => (await api('GET', `/api/public/S001/slots?date=${D}&kind=${kind}`))[1].slots.find((s) => s.time === time)?.status;
const put = (cells) => api('PUT', '/api/admin/cells', { date: D, cells });

// スタッフ 3 人（ともふさ 新〇再〇／室塚 新〇再〇／山本 新×再〇）。シフトは全員出勤（未入力＝出勤）
for (const n of ['ともふさ', '室塚', '山本']) await api('POST', '/api/admin/staff-members', { name: n, role: 'THERAPIST' });
const mem = (await api('GET', '/api/admin/settings'))[1].members;
const id = (n) => mem.find((m) => m.name === n).id;
for (const n of ['ともふさ', '室塚']) await api('PUT', '/api/admin/staff-members', { id: id(n), canFirst: true, canRevisit: true });
await api('PUT', '/api/admin/staff-members', { id: id('山本'), canFirst: false, canRevisit: true });
const day = (await api('GET', `/api/admin/day?date=${D}`))[1].data;
ok('枠数は出勤の 3 人', day.capacity.am === 3 && day.capacity.pm === 3, JSON.stringify([day.capacity.am, day.capacity.pm]));
ok('WEB の同時上限：新規 2・再来 3', day.capacity.firstAm === 2 && day.capacity.revisitAm === 3, JSON.stringify(day.capacity));

// 9:00 に新規 2 人 → 新規はもう取れない。再来・通院中はまだ取れる（合計 2／3）
await put([{ time: 540, bed: 1, text: '新規 一（初診）' }, { time: 555, bed: 1, text: '上記初診対応' }, { time: 540, bed: 2, text: '新規 二（初診）' }, { time: 555, bed: 2, text: '上記初診対応' }]);
ok('新規 2 人で、新規は×', (await st('NEW', 540)) === 'closed');
ok('新規 2 人でも、再来はまだ取れる', (await st('REVISIT', 540)) !== 'closed', await st('REVISIT', 540));
ok('交通事故（新規扱い）も×', (await st('ACCIDENT', 540)) === 'closed');
// 9:00 に再来 1 人 → 合計 3 人で全部×
await put([{ time: 540, bed: 3, text: '再来 三（再来）' }, { time: 555, bed: 3, text: '上記再来対応' }]);
ok('合計 3 人で、再来も×', (await st('REVISIT', 540)) === 'closed');
ok('合計 3 人で、通院中も×', (await st('RETURN', 540)) === 'closed');

// 10:30 に再来 2 人 → 再来はまだ取れる（上限 3）。新規も取れる（新規 0 人・合計 2／3）
await put([{ time: 630, bed: 1, text: '再来 四（再来）' }, { time: 630, bed: 2, text: '再来 五（再来）' }]);
ok('再来 2 人なら、再来はまだ取れる', (await st('REVISIT', 630)) !== 'closed');
ok('再来 2 人なら、新規もまだ取れる', (await st('NEW', 630)) !== 'closed');
// 店舗設定の「再来の同時対応数」は使わない（シフトのスタッフの人数で決める）
const s0 = (await api('GET', '/api/admin/settings'))[1].store;
const sv = await api('PUT', '/api/admin/store', { ...s0, hoursOverride: s0.hoursOverride || null, maxRevisitConcurrent: 2 });
ok('店舗設定を保存できる', sv[0] === 200, JSON.stringify(sv));
ok('店舗設定の同時対応数は使わない（再来はまだ取れる）', (await st('REVISIT', 630)) !== 'closed');
await api('PUT', '/api/admin/store', { ...s0, hoursOverride: s0.hoursOverride || null, maxRevisitConcurrent: null });

// 午後：室塚が午後休み → 新規は午後 1 人まで（ともふさだけ）
await api('PUT', '/api/admin/shifts', { staffId: id('室塚'), date: D, status: 'PM_OFF' });
const d2 = (await api('GET', `/api/admin/day?date=${D}`))[1].data;
ok('午後休みの人は数えない（新規 午前2・午後1）', d2.capacity.firstAm === 2 && d2.capacity.firstPm === 1, JSON.stringify(d2.capacity));
const pm = d2.times.find((t) => t >= 900);
await put([{ time: pm, bed: 1, text: '午後 六（初診）' }, { time: pm + 15, bed: 1, text: '上記初診対応' }]);
ok('午後は新規 1 人で×', (await st('NEW', pm)) === 'closed');
ok('午後の再来はまだ取れる', (await st('REVISIT', pm)) !== 'closed');

// 他店からのヘルプは合計の人数には入るが、新規・再来の人数には数えない（担当できるかは人による）
await api('PUT', '/api/admin/help-in', { date: D, status: 'HELP_IN', name: 'ヘルプ 花子' });
const d3 = (await api('GET', `/api/admin/day?date=${D}`))[1].data;
ok('ヘルプは合計には入る', d3.capacity.am === 4, JSON.stringify(d3.capacity.am));
ok('ヘルプは新規・再来の人数に数えない', d3.capacity.firstAm === 2 && d3.capacity.revisitAm === 3 && d3.capacity.firstPm === 1, JSON.stringify(d3.capacity));
await api('PUT', '/api/admin/help-in', { date: D, status: '' });

// 予約表の「枠数・ブロック」に WEB の同時上限が出る
await p.goto(`${B}/admin/day/${D}`); await p.waitForSelector('#grid');
await p.getByRole('button', { name: /枠数・ブロック/ }).click();
ok('予約表に WEB の同時上限', (await p.getByText(/WEB の同時上限/).textContent()).includes('新規 午前2・午後1'), await p.getByText(/WEB の同時上限/).textContent());

// チェックを全部外すと、今までどおり上限なし（合計だけ）
for (const n of ['ともふさ', '室塚', '山本']) await api('PUT', '/api/admin/staff-members', { id: id(n), canFirst: false, canRevisit: false });
ok('チェックが無ければ午後の新規も取れる（合計 1／2）', (await st('NEW', pm)) !== 'closed', await st('NEW', pm));
ok('画面のエラーなし', errs.length === 0, JSON.stringify(errs));
await br.close();
