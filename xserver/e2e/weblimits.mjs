// Xserver（PHP）版：WEB 予約の上限（新規＋再来は担当できる人数まで・新規／再来を止める時間・1 人が持てる予約の件数・予約できる日数）（S001）
// 例：BASE_URL=http://127.0.0.1:3003 CHROMIUM_PATH=... node e2e/weblimits.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003', O = new URL('./', import.meta.url).pathname + 'out-';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const p = await br.newPage({ viewport: { width: 1366, height: 900 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
await p.goto(B + '/admin/login/S001'); await p.fill('input[type=password]', 'password'); await p.click('button[type=submit]'); await p.waitForURL(/admin\/day/); await p.waitForLoadState('networkidle');
const api = (m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);
// 営業日（3 日後以降で午前・午後のある日）
let D;
{ const s = new Date(); s.setDate(s.getDate() + 3); const first = s.toISOString().slice(0, 10);
  for (let w = 0; w < 3 && !D; w++) { const j = await (await fetch(`${B}/api/public/S001/week?start=${new Date(s.getTime() + w * 7 * 864e5).toISOString().slice(0, 10)}&kind=RETURN`)).json(); D = j.days.find((d) => d.date >= first && d.label === null && d.slots.some((x) => x.time === 540) && d.slots.some((x) => x.time === 600))?.date; } }
console.log('date', D);
const st = async (kind, time, date = D) => (await api('GET', `/api/public/S001/slots?date=${date}&kind=${kind}`))[1].slots.find((s) => s.time === time)?.status;
const put = (cells) => api('PUT', '/api/admin/cells', { date: D, cells });

// ---- 1. 新規＋再来は「初回か再来を担当できる人数」まで（4 人出勤・うち 1 人はどちらも担当しない）
for (const n of ['見本 一', '見本 二', '見本 三', '見本 四']) await api('POST', '/api/admin/staff-members', { name: n, role: 'THERAPIST' });
const mem = (await api('GET', '/api/admin/settings'))[1].members;
const id = (n) => mem.find((m) => m.name === n).id;
for (const n of ['見本 一', '見本 二']) await api('PUT', '/api/admin/staff-members', { id: id(n), canFirst: true, canRevisit: true });
await api('PUT', '/api/admin/staff-members', { id: id('見本 三'), canRevisit: true });
const cap = (await api('GET', `/api/admin/day?date=${D}`))[1].data.capacity;
ok('枠 4・新規 2・再来 3・合わせて 3', cap.am === 4 && cap.firstAm === 2 && cap.revisitAm === 3 && cap.eitherAm === 3, JSON.stringify(cap));
await put([{ time: 540, bed: 1, text: '見本 新一（初診）' }, { time: 555, bed: 1, text: '上記初診対応' }, { time: 540, bed: 2, text: '見本 新二（初診）' }, { time: 555, bed: 2, text: '上記初診対応' }]);
ok('新規 2 人のとき、再来はあと 1 人取れる', (await st('REVISIT', 540)) !== 'closed');
await put([{ time: 540, bed: 3, text: '見本 再三（再）' }, { time: 555, bed: 3, text: '上記再来対応' }]);
ok('新規 2＋再来 1＝3 で、再来は×（枠はまだ 1 つ空いている）', (await st('REVISIT', 540)) === 'closed');
ok('通院中はまだ取れる（枠 4 のうち 3）', (await st('RETURN', 540)) !== 'closed');
ok('店舗設定に「WEB で同時に受ける人数」の欄（古い同時対応数の欄は無い）', await (async () => { await p.goto(`${B}/admin/settings`); await p.waitForTimeout(800); return (await p.getByLabel('新規の同時対応数').count()) === 0 && !(await p.textContent('main')).includes('再来の同時対応数'); })());

// ---- 2. 新規・再来を止める時間（初診・再来は×、新自・通院中は取れる）
await p.goto(`${B}/admin/day/${D}`); await p.waitForSelector('#grid');
await p.getByRole('button', { name: /枠数・ブロック/ }).click();
const ks = p.getByLabel('新規・再来を止める', { exact: true });
await ks.getByRole('button', { name: '＋ 時間を追加' }).click();
await ks.getByLabel('止める開始').selectOption('600');
await ks.getByLabel('止める終了').selectOption('660');
await ks.getByPlaceholder('理由（例：院長不在）').fill('院長不在');
await ks.getByRole('button', { name: '追加' }).click(); await p.waitForTimeout(800);
ok('止める時間が出る', (await ks.textContent()).includes('10:00〜11:00') && (await ks.textContent()).includes('院長不在'));
ok('予約表の時刻に「新再✕」', (await p.locator('#grid tbody tr').filter({ has: p.locator('td', { hasText: /^10:15/ }) }).first().textContent()).includes('新再✕'));
ok('初診は×', (await st('NEW', 615)) === 'closed');
ok('再来は×', (await st('REVISIT', 615)) === 'closed');
ok('新自（交通事故）は取れる', (await st('ACCIDENT', 615)) !== 'closed');
ok('通院中は取れる', (await st('RETURN', 615)) !== 'closed');
ok('止める時間の外は初診も取れる', (await st('NEW', 690)) !== 'closed');
await p.screenshot({ path: O + 'kindstop.png', clip: { x: 0, y: 0, width: 1366, height: 700 } });
await ks.getByLabel('新規・再来を止めるのをやめる').click(); await p.waitForTimeout(800);
ok('やめると初診も取れる', (await st('NEW', 615)) !== 'closed');

// ---- 3. 1 人が持てる予約（既定 4 件）と、WEB で予約できる日数（既定 14 日）
const s0 = (await api('GET', '/api/admin/settings'))[1].store;
ok('既定：4 件・14 日', s0.maxActiveBookings === 4 && s0.bookDaysAhead === 14, JSON.stringify([s0.maxActiveBookings, s0.bookDaysAhead]));
await api('PUT', '/api/admin/store', { ...s0, hoursOverride: s0.hoursOverride || null, maxActiveBookings: 2 });
// 2 週分（夕方は今日の枠が終わっているため、1 週だけだと足りないことがある）
const wk = async (start) => (await (await fetch(`${B}/api/public/S001/week?start=${start}&kind=RETURN`)).json()).days;
const D7 = (() => { const d = new Date(D + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 7); return d.toISOString().slice(0, 10); })();
const week = [...await wk(D), ...await wk(D7)].filter((d) => d.label === null && d.slots.some((x) => x.status === 'open' || x.status === 'few'));
const reserve = (date, time, name = '見本 予約') => fetch(`${B}/api/public/S001/reserve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'RETURN', date, time, name, phone: '09011112222', cardNo: '123' }) }).then(async (r) => [r.status, (await r.json()).error ?? '']);
const slot = (d) => d.slots.find((x) => x.status === 'open' || x.status === 'few').time;
const r1 = await reserve(week[0].date, slot(week[0])), r2 = await reserve(week[1].date, slot(week[1]));
const r3 = await reserve(week[2].date, slot(week[2]));
ok('2 件までは取れる', r1[0] === 200 && r2[0] === 200, JSON.stringify([r1, r2]));
ok('3 件目は断る（件数の案内）', r3[0] === 409 && r3[1].includes('2 件まで'), JSON.stringify(r3));
ok('氏名が違えば（家族）別の人として取れる', (await reserve(week[2].date, slot(week[2]), '見本 家族'))[0] === 200);
// 14 日より先：予約ページでは見られるが電話マーク、予約は断る
const far = new Date(); far.setDate(far.getDate() + 20);
const fj = await (await fetch(`${B}/api/public/S001/week?start=${far.toISOString().slice(0, 10)}&kind=RETURN`)).json();
const lim = new Date(); lim.setDate(lim.getDate() + 14); const limD = lim.toISOString().slice(0, 10);
const fd = fj.days.find((d) => d.date > limD && d.label === null && d.slots.length);
ok('14 日より先は電話マーク（×ではない）', fd && fd.slots.every((x) => x.status !== 'open') && fd.slots.some((x) => x.status === 'phone'), JSON.stringify(fd?.slots.slice(0, 3)));
const rf = await reserve(fd.date, fd.slots[0].time, '見本 先');
ok('14 日より先の予約は断る（電話の案内）', rf[0] === 409 && rf[1].includes('14 日先まで'), JSON.stringify(rf));
// 「WEB で予約できる日数」は既存の方（通院中・1ヶ月以上ぶり）だけ。はじめての方は公開する日数まで WEB で取れる
const fn = (await (await fetch(`${B}/api/public/S001/week?start=${far.toISOString().slice(0, 10)}&kind=NEW`)).json()).days.find((d) => d.date === fd.date);
ok('はじめての方は 14 日より先も WEB で取れる（〇・△）', fn && fn.slots.some((x) => x.status === 'open' || x.status === 'few'), JSON.stringify(fn?.slots.slice(0, 3)));
const fr = (await (await fetch(`${B}/api/public/S001/week?start=${far.toISOString().slice(0, 10)}&kind=REVISIT`)).json()).days.find((d) => d.date === fd.date);
ok('1ヶ月以上ぶりの方も新規と同じく 14 日より先も WEB で取れる', fr && fr.slots.some((x) => x.status === 'open' || x.status === 'few'));
const rn = await fetch(`${B}/api/public/S001/reserve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'NEW', date: fd.date, time: fn.slots.find((x) => x.status === 'open' || x.status === 'few').time, name: '見本 広告', phone: '09033334444' }) });
ok('はじめての方は 14 日より先も予約できる', rn.status === 200, String(rn.status));
await api('PUT', '/api/admin/store', { ...s0, hoursOverride: s0.hoursOverride || null, bookDaysAhead: null, maxActiveBookings: null });
ok('空欄にすると 14 日より先も取れる', (await reserve(fd.date, fd.slots[0].time, '見本 先'))[0] === 200);
ok('画面のエラーなし', errs.length === 0, JSON.stringify(errs));
await br.close();
