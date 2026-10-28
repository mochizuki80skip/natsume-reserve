// Xserver（PHP）版：予約表で同じ日に同じお名前の予約が 2 か所以上になったら知らせる（名前を入れたとき・WEB 予約が入ったとき）（サンプル店舗 S001）
// 例：BASE_URL=http://127.0.0.1:3003 CHROMIUM_PATH=... node e2e/dupalert.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const errs = [];
const dialogs = [];
const p = await br.newPage({ viewport: { width: 1366, height: 1000 } });
p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
await p.goto(`${B}/admin/login/S001`); await p.fill('input[type=password]', 'password'); await p.click('button[type=submit]'); await p.waitForURL(/admin\/day/);
const D = (() => { const d = new Date(); d.setDate(d.getDate() + 3); for (;;) { const s = d.toISOString().slice(0, 10); if ([1, 2, 3, 5].includes(d.getDay()) && !['2026-11-03', '2026-11-23', '2027-01-01'].includes(s)) return s; d.setDate(d.getDate() + 1); } })();
await p.goto(`${B}/admin/day/${D}`); await p.waitForSelector('td[data-cell="540:1"] input');
const type = async (k, v) => { await p.locator(`td[data-cell="${k}"] input`).click(); await p.keyboard.type(v); await p.keyboard.press('Enter'); await p.waitForTimeout(600); };

await type('540:1', '見本 重子');
ok('1 か所だけなら知らせない', dialogs.length === 0 && (await p.getByRole('alert', { name: '予約の重複' }).count()) === 0);
await p.locator('td[data-cell="660:2"] input').click(); await p.keyboard.type('見本重子');
await p.waitForTimeout(500);
ok('入力中は知らせない', dialogs.length === 0);
await p.keyboard.press('Enter'); await p.waitForTimeout(800);
ok('名前を入れ終わると知らせる（音なし・お知らせの窓）', dialogs.length === 1 && dialogs[0].includes('同じお名前の予約が 2 か所以上') && dialogs[0].includes('9:00 ベッド1') && dialogs[0].includes('11:00 ベッド2') && dialogs[0].includes('対処してください'), JSON.stringify(dialogs));
ok('予約表の上に注意の帯', (await p.getByRole('alert', { name: '予約の重複' }).textContent()).includes('見本 重子'));
await p.waitForTimeout(2500);
await p.reload(); await p.waitForSelector('td[data-cell="540:1"] input'); await p.waitForTimeout(800);
ok('開き直したときは窓は出さず、帯で知らせる', dialogs.length === 1 && (await p.getByRole('alert', { name: '予約の重複' }).isVisible()));

// WEB 予約で同じお名前が入ったとき（予約表が新しくなったとき）
await type('960:3', '試験 二重');
ok('別の名前は知らせない', dialogs.length === 1);
const r = await fetch(`${B}/api/public/S001/reserve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'RETURN', date: D, time: 900, name: '試験二重', phone: '090' + String(Date.now()).slice(-8), cardNo: '9' }) });
ok('WEB 予約', r.status === 200, String(r.status));
await p.waitForTimeout(16000); // 入れた直後（15 秒以内）のセルは新しい内容で上書きしないため
await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); // 画面に戻ったときの読み直し
for (let i = 0; i < 20 && dialogs.length < 2; i++) await p.waitForTimeout(500);
ok('WEB 予約で同じお名前が入ったら知らせる', dialogs.length === 2 && dialogs[1].includes('試験'), JSON.stringify(dialogs));

ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
console.log(process.exitCode ? 'DUPALERT FAILED' : 'DUPALERT OK');
