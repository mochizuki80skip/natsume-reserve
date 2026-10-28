// Xserver（PHP）版：新三（新・第三者行為）の区分と、メニューの「第三者」「自賠」（サンプル店舗 S001）
// 予約表の「新三」ボタン → 名前（新三）＋上記初診対応、色は新自と同じ。新規に数える。新患継続率は区分「新三」で、事故日・事故内容と通知（新自と同じ）
// 例：BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... CHROMIUM_PATH=... MAIL_LOG=/tmp/natsume-mail.log node e2e/shinsan.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003';
const LOG = process.env.MAIL_LOG ?? '/tmp/natsume-mail.log';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const errs = [];
async function login(code, pass, user) {
  const ctx = await br.newContext({ viewport: { width: 1366, height: 1000 } });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  if (user) { await p.goto(`${B}/admin/login`); await p.fill('input[autocomplete="username"]', user); } else await p.goto(`${B}/admin/login/${code}`);
  await p.fill('input[type=password]', pass); await p.click('button[type=submit]'); await p.waitForURL(/admin\//); await p.waitForTimeout(500);
  return p;
}
const api = (p, m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);
const mails = () => { try { return fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
// 3 日後以降の平日（木・日・祝を除く）
const D = (() => { const d = new Date(); d.setDate(d.getDate() + 3); for (;;) { const s = d.toISOString().slice(0, 10); if ([1, 2, 3, 5].includes(d.getDay()) && !['2026-11-03', '2026-11-23', '2027-01-01'].includes(s)) return s; d.setDate(d.getDate() + 1); } })();

const hq = await login('', process.env.HQ_PASSWORD ?? 'hq-pass', 'HQ');
await api(hq, 'PUT', '/api/admin/hq/jibai-notify', { rows: [{ area: '', email: 'all@example.com', label: '本部' }] });

const st = await login('S001', 'password');
// 1) 予約表：名前を入れて「新三」ボタン
await st.goto(`${B}/admin/day/${D}`); await st.waitForSelector('td[data-cell="540:1"] input');
await st.locator('td[data-cell="540:1"] input').click(); await st.keyboard.type('見本 三太'); await st.keyboard.press('Enter'); await st.waitForTimeout(400);
await st.locator('td[data-cell="540:1"] input').click(); await st.waitForTimeout(300);
const btn = st.getByRole('button', { name: '新三', exact: true });
ok('メニュー欄に「新三」ボタン', await btn.isVisible());
ok('メニューに「第三者」「自賠」', await st.getByRole('button', { name: '第三者', exact: true }).isVisible() && await st.getByRole('button', { name: '自賠', exact: true }).isVisible());
await btn.click(); await st.waitForTimeout(1500);
let day = (await api(st, 'GET', `/api/admin/day?date=${D}`))[1].data;
const c1 = day.cells.find((c) => c.time === 540 && c.bed === 1), c2 = day.cells.find((c) => c.time === 555 && c.bed === 1);
ok('「名前（新三）」と下のセルに「上記初診対応」', c1?.text === '見本 三太（新三）' && c2?.text === '上記初診対応', JSON.stringify([c1?.text, c2?.text]));
const bg = await st.locator('td[data-cell="540:1"]').evaluate((e) => getComputedStyle(e).backgroundColor);
ok('色は新自と同じ（オレンジ）', /253, 186, 116|rgb\(253/.test(bg), bg);
await st.getByRole('button', { name: '第三者', exact: true }).click(); await st.waitForTimeout(1200);
day = (await api(st, 'GET', `/api/admin/day?date=${D}`))[1].data;
ok('メニュー「第三者」を付けられる', (day.cells.find((c) => c.time === 540 && c.bed === 1)?.menus ?? []).includes('第三者'));
ok('予約表の人数に「新三」', (await st.textContent('body')).includes('新三1'));

// 2) WEB の新規の人数に数える（スタッフ 1 人＝新規 1 人まで → 9:00 は新規×、通院中はベッドが空いていれば取れる）
await api(st, 'POST', '/api/admin/staff-members', { name: '見本 施術', role: 'THERAPIST' });
const mem = (await api(st, 'GET', '/api/admin/settings'))[1].members;
await api(st, 'PUT', '/api/admin/staff-members', { id: mem.find((m) => m.name === '見本 施術').id, canFirst: true, canRevisit: true });
const slot = async (kind, time) => (await api(st, 'GET', `/api/public/S001/slots?date=${D}&kind=${kind}`))[1].slots.find((s) => s.time === time)?.status;
ok('新三の方がいる時間は、WEB の新規は取れない（新規に数える）', (await slot('NEW', 540)) === 'closed');

// 3) 今日の新三に来院チェック → 新患継続率（区分 新三）・通知（新自と同じ）
const today = (await api(st, 'GET', '/api/admin/me'))[1].today;
fs.rmSync(LOG, { force: true });
await api(st, 'PUT', '/api/admin/cells', { date: today, cells: [{ time: 600, bed: 3, text: '試験 三郎（新三）' }] });
await api(st, 'PUT', '/api/admin/visit', { date: today, time: 600, bed: 3, visited: true });
const k = (await api(st, 'GET', `/api/admin/karte?month=${today.slice(0, 7)}`))[1].rows.find((r) => r.name === '試験三郎');
ok('新患継続率に区分「新三」で入る（症状区分は事故第三者）', k?.kind === 'THIRD' && k?.symptomCat === '事故第三者', JSON.stringify(k && [k.kind, k.symptomCat]));
const m = mails();
ok('来院チェックで通知メール（【新三】第三者行為の初診・名字だけ）', m.length === 1 && m[0].subject.includes('【新三】') && m[0].subject.includes('第三者行為の初診') && m[0].body.includes('患者様：試験 様') && !m[0].body.includes('三郎'), JSON.stringify(m.map((x) => x.subject)));
ok('事故日・事故内容の未入力に数える', (await api(st, 'GET', '/api/admin/me'))[1].accidentMissing >= 1);
await st.goto(`${B}/admin/karte`); await st.waitForTimeout(1200);
const sec = st.getByRole('region', { name: '新自・新三（事故）' });
ok('継続率の下の一覧に新三の行', (await sec.locator('tr', { hasText: '試験三郎' }).textContent()).includes('新三'));
ok('上の件数に「新三 1」', (await st.textContent('main')).includes('新三 1'));

// 4) 本部の新患・再来集計に区分「新三」
await hq.goto(`${B}/admin/hq/karte`); await hq.waitForTimeout(1500);
ok('本部の集計に「新三（第三者）」', (await hq.textContent('main')).includes('新三（第三者）'));

ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
console.log(process.exitCode ? 'SHINSAN FAILED' : 'SHINSAN OK');
