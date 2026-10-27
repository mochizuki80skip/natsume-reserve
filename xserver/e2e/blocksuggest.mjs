// Xserver（PHP）版：新規・再来ブロックの提案（担当がふさがったら提案 → 院長が承認 → WEB の新規だけ×、当てはまらなくなったら自動で外れる）（S001）
// 例：BASE_URL=http://127.0.0.1:3003 CHROMIUM_PATH=... node e2e/blocksuggest.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003', O = new URL('./', import.meta.url).pathname + 'out-';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const p = await br.newPage({ viewport: { width: 1366, height: 900 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(B + '/admin/login/S001'); await p.fill('input[type=password]', 'password'); await p.click('button[type=submit]'); await p.waitForURL(/admin\/day/); await p.waitForLoadState('networkidle');
const api = (m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);
let D;
{ const s = new Date(); s.setDate(s.getDate() + 3); const first = s.toISOString().slice(0, 10);
  const j = await (await fetch(`${B}/api/public/S001/week?start=${first}&kind=RETURN`)).json(); D = j.days.find((d) => d.date >= first && d.label === null && d.slots.some((x) => x.time === 600))?.date;
  if (!D) { const j2 = await (await fetch(`${B}/api/public/S001/week?start=${new Date(s.getTime() + 7 * 864e5).toISOString().slice(0, 10)}&kind=RETURN`)).json(); D = j2.days.find((d) => d.label === null && d.slots.some((x) => x.time === 600))?.date; } }
console.log('date', D);
const st = async (kind, time = 600) => (await api('GET', `/api/public/S001/slots?date=${D}&kind=${kind}`))[1].slots.find((s) => s.time === time)?.status;
// スタッフ：見本 一（新〇再〇）・見本 二（新〇再〇）・見本 三（再〇）。顧客に見せる枠は 5 にして、枠では埋まらないようにする
for (const n of ['見本 一', '見本 二', '見本 三']) await api('POST', '/api/admin/staff-members', { name: n, role: 'THERAPIST' });
const mem = (await api('GET', '/api/admin/settings'))[1].members;
const id = (n) => mem.find((m) => m.name === n).id;
for (const n of ['見本 一', '見本 二']) await api('PUT', '/api/admin/staff-members', { id: id(n), canFirst: true, canRevisit: true });
await api('PUT', '/api/admin/staff-members', { id: id('見本 三'), canRevisit: true });
await api('PUT', '/api/admin/days', { date: D, capacityAm: 5 });
// 10:00：見本 一 が 6回目を 2 人担当（ふさがっている）
await api('PUT', '/api/admin/cells', { date: D, cells: [{ time: 600, bed: 1, text: '見本 甲' }, { time: 600, bed: 2, text: '見本 乙' }] });
await api('PUT', '/api/admin/cell-staff', { date: D, staff: '見本 一', cells: [{ time: 600, bed: 1 }, { time: 600, bed: 2 }] });
ok('見本 一 だけふさがっている間は提案なし（見本 二 が新規を受けられる）', (await api('GET', `/api/admin/block-suggestions?date=${D}`))[1].suggestions.length === 0);

// 窓口で、担当の付いていない初診を入れる → 見本 二 が担当予定でふさがる → その場でお知らせ
await p.goto(`${B}/admin/day/${D}`); await p.waitForSelector('#grid');
const rowOf = (t) => p.locator('#grid tbody tr').filter({ has: p.locator('td', { hasText: new RegExp(`^${t}$`) }) });
await rowOf('10:00').locator('td').nth(3).locator('input').fill('見本 丙（初診）');
await rowOf('10:00').locator('td').nth(3).locator('input').press('Enter');
const dlg = p.getByRole('dialog', { name: 'ブロックの提案' });
await dlg.waitFor({ timeout: 10000 }).catch(() => {});
ok('予約を入れたらその場でお知らせ（新規を止める）', await dlg.isVisible() && (await dlg.textContent()).includes('新規を止める') && (await dlg.textContent()).includes('10:00'), await dlg.textContent().catch(() => ''));
await p.screenshot({ path: O + 'blocksuggest.png' });
ok('承認する前は新規も取れる', (await st('NEW')) !== 'closed');
await dlg.getByRole('button', { name: '止める（承認）' }).first().click(); await p.waitForTimeout(1000);
ok('承認すると WEB の新規は×', (await st('NEW')) === 'closed');
ok('再来は取れる（見本 三）', (await st('REVISIT')) !== 'closed');
ok('通院中・新自は今までどおり', (await st('RETURN')) !== 'closed' && (await st('ACCIDENT')) !== 'closed');
await p.reload(); await p.waitForSelector('#grid');
ok('予約表の時刻に「新✕」', (await p.locator('#grid tbody tr td:first-child', { hasText: /^10:00/ }).first().textContent()).includes('新✕'));

// 予約が減って当てはまらなくなったら自動で外れる
await api('PUT', '/api/admin/cells', { date: D, cells: [{ time: 600, bed: 2, text: '' }] });
ok('当てはまらなくなったら提案は消える', (await api('GET', `/api/admin/block-suggestions?date=${D}`))[1].suggestions.length === 0);
ok('ブロックも自動で外れ、新規が取れる', (await st('NEW')) !== 'closed');

// 止めない → 同じ日・同じ時間ではもう出さない
await api('PUT', '/api/admin/cells', { date: D, cells: [{ time: 600, bed: 2, text: '見本 乙' }] });
await api('PUT', '/api/admin/cell-staff', { date: D, staff: '見本 一', cells: [{ time: 600, bed: 2 }] });
const s1 = (await api('GET', `/api/admin/block-suggestions?date=${D}`))[1].suggestions;
ok('また当てはまると提案が出る', s1.length === 1 && s1[0].kind === 'N', JSON.stringify(s1));
await api('POST', '/api/admin/block-suggestions', { ...s1[0], action: 'dismiss' });
ok('止めないを押すと、同じ時間はもう出さない', (await api('GET', `/api/admin/block-suggestions?date=${D}`))[1].suggestions.length === 0);
ok('止めないのときは新規が取れる', (await st('NEW')) !== 'closed');
// 手で入れる「新規だけ止める」
await api('POST', '/api/admin/kind-blocks', { date: D, start: 660, end: 690, kinds: 'R', label: '見本' });
ok('再来だけ止める（手で入れる）', (await st('REVISIT', 660)) === 'closed' && (await st('NEW', 660)) !== 'closed');
ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
