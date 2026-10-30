// Xserver（PHP）版：顧客の予約ページの 〇（空きが複数）・△（残り1枠：WEB で予約できる）・×（空きなし）と、タッチの差で埋まったときの案内（サンプル店舗 S001）
// 例：BASE_URL=http://127.0.0.1:3003 CHROMIUM_PATH=... node e2e/fewmark.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003';
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
let cookie = '';
const req = async (m, u, b) => {
  const r = await fetch(B + u, { method: m, headers: { 'Content-Type': 'application/json', cookie }, body: b ? JSON.stringify(b) : undefined, redirect: 'manual' });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return [r.status, await r.json().catch(() => null)];
};
const D = (() => { const d = new Date(); d.setDate(d.getDate() + 3); for (;;) { const s = d.toISOString().slice(0, 10); if ([1, 2, 3, 5].includes(d.getDay()) && !['2026-11-03', '2026-11-23', '2027-01-01'].includes(s)) return s; d.setDate(d.getDate() + 1); } })();
await req('POST', '/api/admin/login', { code: 'S001', password: 'password' });
const cap = (await req('GET', `/api/admin/day?date=${D}`))[1].data.capacity.am;
const st = async (time) => (await req('GET', `/api/public/S001/slots?date=${D}&kind=RETURN`))[1].slots.find((s) => s.time === time)?.status;
// 10:00 に（枠 − 1）人入れて残り 1 にする
await req('PUT', '/api/admin/cells', { date: D, cells: Array.from({ length: cap - 1 }, (_, i) => ({ time: 600, bed: i + 1, text: `見本 埋${i + 1}` })) });
ok('空きが複数は 〇', (await st(615)) === 'open');
ok('残り 1 枠は △', (await st(600)) === 'few', String(cap));
const phone = () => '090' + String(Date.now()).slice(-8);
const r1 = await (await fetch(`${B}/api/public/S001/reserve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'RETURN', date: D, time: 600, name: '見本 先着', phone: phone(), cardNo: '1' }) })).json();
ok('△ は WEB で予約できる', r1.ok === true, JSON.stringify(r1));
ok('埋まると ×', (await st(600)) === 'closed');
const r2 = await fetch(`${B}/api/public/S001/reserve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'RETURN', date: D, time: 600, name: '見本 後着', phone: phone(), cardNo: '2' }) });
ok('手続き中に埋まったときは案内', r2.status === 409 && ((await r2.json()).error ?? '').includes('ご予約の手続き中に'));

// 画面：凡例と △ の表示
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const p = await br.newPage({ viewport: { width: 390, height: 844 } });
await req('PUT', '/api/admin/cells', { date: D, cells: [{ time: 660, bed: 1, text: '見本 埋A' }, ...Array.from({ length: cap - 2 }, (_, i) => ({ time: 660, bed: i + 2, text: `見本 埋B${i}` }))] });
await p.goto(`${B}/s/S001`); await p.waitForSelector('table.wk');
await p.getByRole('button', { name: /ご通院したことがある方/ }).click(); await p.getByRole('radio', { name: /現在通院中/ }).click(); await p.waitForTimeout(800);
ok('凡例に 〇・△・📞・×', (await p.locator('.wk-legend').textContent()).includes('△') && (await p.locator('.wk-legend').textContent()).includes('直前・急患はお電話で'));
let few = p.getByRole('button', { name: /残り1枠・予約できます/ }).first();
for (let i = 0; i < 3 && (await few.count()) === 0; i++) { await p.getByRole('button', { name: '翌週 ›' }).click(); await p.waitForTimeout(800); few = p.getByRole('button', { name: /残り1枠・予約できます/ }).first(); }
ok('週の表に △', (await few.count()) > 0 && (await few.textContent()) === '△');
await few.click();
ok('△ を選ぶと予約へ進める', await p.getByRole('button', { name: 'この日時で予約へ進む' }).isVisible());
// 新規・再来を止めた時間：来院区分を選ぶ前（はじめての方を押しただけ）でも × に見える
await req('POST', '/api/admin/kind-blocks', { date: D, start: 900, end: 960, kinds: 'NR' });
await p.goto(`${B}/s/S001`); await p.waitForSelector('table.wk');
const cellAt = (time) => p.locator(`button[aria-label^="${Number(D.slice(5, 7))}/${Number(D.slice(8))} ${time} "]`);
for (let i = 0; i < 3 && (await p.getByRole('button', { name: new RegExp(`^${Number(D.slice(5, 7))}/${Number(D.slice(8))} `) }).count()) === 0; i++) { await p.getByRole('button', { name: '翌週 ›' }).click(); await p.waitForTimeout(800); }
ok('区分を選ぶ前：止めた時間（15:00）は 〇 に見えない', (await cellAt('15:00').count()) === 0);
await p.getByRole('button', { name: /はじめての方/ }).click(); await p.waitForTimeout(800);
ok('はじめての方を押しただけでも × のまま', (await cellAt('15:00').count()) === 0);
await p.getByRole('button', { name: /ご通院したことがある方/ }).click(); await p.waitForTimeout(800);
ok('ご通院したことがある方を押しても未選択のまま、どちらかを選ぶ案内', (await p.getByRole('radio', { name: /現在通院中/ }).getAttribute('aria-checked')) === 'false' && (await p.getByRole('note', { name: 'ご来院の内容の案内' }).textContent()).includes('どちらかを選んでください'));
ok('未選択の間は、表は現在通院中の空き状況（〇）', (await cellAt('15:00').count()) === 1);
await p.getByRole('radio', { name: /現在通院中/ }).click(); await p.waitForTimeout(800);
ok('現在通院中は取れる（〇）', (await cellAt('15:00').count()) === 1);
await cellAt('15:00').click();
await p.getByRole('radio', { name: /1ヶ月以上/ }).click(); await p.waitForTimeout(1000);
ok('選んだあとで区分を変えて × になったら、選び直しの案内', !(await p.getByRole('button', { name: 'この日時で予約へ進む' }).isVisible()) && (await p.textContent('body')).includes('この内容では予約できません'));
const pageW = await p.evaluate(() => document.documentElement.scrollWidth);
ok('スマホで横にはみ出さない', pageW <= 390, String(pageW));
await br.close();
console.log(process.exitCode ? 'FEWMARK FAILED' : 'FEWMARK OK');
