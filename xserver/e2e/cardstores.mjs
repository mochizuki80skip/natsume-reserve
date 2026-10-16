// Xserver（PHP）版：診察券番号 → 氏名（患者一覧 CSV の取り込み・予約表で Enter）と、店舗えらびページ（公開・住所・空いている時間帯・紹介カード経由）
// 例：BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... CHROMIUM_PATH=... node e2e/cardstores.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003', O = new URL('./', import.meta.url).pathname + 'out-';
const CSV = new URL('./fixtures/patients-sample.csv', import.meta.url).pathname; // 見本の名前だけ（実際の患者情報は置かない）
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const errs = [];
async function login(code, pass, user) {
  const ctx = await br.newContext({ viewport: { width: 1300, height: 1000 } });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  if (user) { await p.goto(`${B}/admin/login`); await p.fill('input[autocomplete="username"]', user); } else await p.goto(`${B}/admin/login/${code}`);
  await p.fill('input[type=password]', pass); await p.click('button[type=submit]'); await p.waitForURL(/admin\//); await p.waitForTimeout(500);
  return p;
}
const api = (p, m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);

// ---- 診察券番号 → 氏名
const p = await login('S001', 'password');
await p.goto(`${B}/admin/settings`); await p.waitForSelector('text=患者一覧（診察券番号 → 氏名）');
await p.locator('input[type=file]').setInputFiles(CSV);
await p.waitForSelector('text=人を取り込みました');
ok('CSV（Shift-JIS）を取り込む：同じ番号の x・a・r の行は 1 人', (await p.textContent('body')).includes('3 人を取り込みました'));
const lk = (await api(p, 'GET', '/api/admin/patients/lookup?no=003842'))[1];
ok('頭の 0 があっても同じ番号', lk.name === 'テスト 太郎', JSON.stringify(lk));
const D = '2026-10-27';
await p.goto(`${B}/admin/day/${D}`); await p.waitForSelector('#grid');
const rowOf = (t) => p.locator('#grid tbody tr').filter({ has: p.locator('td', { hasText: new RegExp(`^${t}$`) }) });
const cell = (t, b) => rowOf(t).locator('td').nth(b).locator('input');
await cell('9:00', 1).click(); await p.keyboard.type('3842'); await p.waitForTimeout(800);
ok('番号を入れると候補が出る', (await p.getByRole('status').filter({ hasText: '3842 → テスト 太郎' }).count()) === 1);
await p.screenshot({ path: O + 'cardno-hint.png', clip: { x: 0, y: 380, width: 1300, height: 200 } });
await p.keyboard.press('Enter'); await p.waitForTimeout(500);
ok('Enter で氏名に置き換わる', (await cell('9:00', 1).inputValue()) === 'テスト 太郎');
await p.keyboard.type('9999'); await p.keyboard.press('Enter'); await p.waitForTimeout(500);
ok('一覧に無い番号はそのまま', (await cell('9:15', 1).inputValue()) === '9999' && (await p.textContent('body')).includes('9999 は患者一覧にありません'));
await p.getByRole('button', { name: /元に戻す/ }).click(); await p.getByRole('button', { name: /元に戻す/ }).click(); await p.waitForTimeout(300);
ok('元に戻すで番号に戻る', (await cell('9:00', 1).inputValue()) === '3842', [await cell('9:00', 1).inputValue(), await cell('9:15', 1).inputValue(), await p.getByRole('button', { name: /元に戻す/ }).textContent()].join('|'));
// 全角の数字でも同じ
await cell('10:00', 1).click(); await p.keyboard.type('３８４２'); await p.waitForTimeout(800);
ok('全角の番号でも候補が出る', (await p.getByRole('status').filter({ hasText: '3842 → テスト 太郎' }).count()) === 1);
await p.keyboard.press('Enter'); await p.waitForTimeout(500);
ok('全角の番号でも Enter で氏名に', (await cell('10:00', 1).inputValue()) === 'テスト 太郎');
await cell('10:15', 1).click(); await p.keyboard.type('０００００５'); await p.keyboard.press('Enter'); await p.waitForTimeout(500);
ok('全角で頭に 0 があっても', (await cell('10:15', 1).inputValue()) === '見本 花子');
const p2 = await login('S002', 'password');
ok('ほかの店舗の一覧は見えない', (await api(p2, 'GET', '/api/admin/patients/lookup?no=3842'))[1].name === null);

// ---- 店舗えらびページ
const pub = await br.newPage();
await pub.goto(`${B}/stores?from=card`); await pub.waitForSelector('h1');
ok('公開前は準備中', (await pub.textContent('body')).includes('準備中'));
const hq = await login('', process.env.HQ_PASSWORD ?? 'hq-pass', 'HQ');
const up = await api(hq, 'PUT', '/api/admin/hq/stores', { code: 'S001', action: 'listing', address: '静岡県静岡市葵区追手町9-6', lat: 34.9756, lng: 138.3828, listed: true });
ok('住所と地図の位置を保存', up[0] === 200, JSON.stringify(up[1]));
const bad = await api(hq, 'PUT', '/api/admin/hq/stores', { code: 'S002', action: 'listing', address: 'x', lat: 999, lng: 1, listed: true });
ok('おかしな位置は保存しない', bad[0] === 400);
await hq.goto(`${B}/stores?from=card&preview=1`); await hq.waitForSelector('article');
ok('本部は公開前でも確認できる', (await hq.textContent('body')).includes('本部の確認用'));
await api(hq, 'PUT', '/api/admin/hq/stores-page', { open: true });
const js = await (await fetch(`${B}/api/public-stores`)).json();
const s1 = js.stores?.find((s) => s.code === 'S001');
ok('公開すると一覧が出る（住所・位置・営業時間）', js.open === true && s1?.address.includes('追手町') && s1.lat > 34 && js.hours.rows.length > 0 && js.hours.closed.includes('木'), JSON.stringify(js.hours));
ok('空いている時間帯（今日 or 次の営業日）', s1.quiet && /^\d{4}-\d{2}-\d{2}$/.test(s1.quiet.date) && (s1.quiet.am === null || /^\d+:00〜\d+:00$/.test(s1.quiet.am)), JSON.stringify(s1.quiet));
await pub.goto(`${B}/stores?from=card`); await pub.waitForSelector('article');
ok('店舗のカード', (await pub.locator('article').filter({ hasText: 'サンプル本店' }).count()) === 1 && (await pub.textContent('body')).includes('営業時間（全店共通）'));
await pub.setViewportSize({ width: 390, height: 844 });
await pub.screenshot({ path: O + 'stores.png', fullPage: true });
await pub.locator('article').filter({ hasText: 'サンプル本店' }).getByRole('link', { name: 'WEB 予約' }).click();
await pub.waitForURL(/\/s\/S001\?from=card/);
ok('WEB 予約へ（紹介カードの印を付けたまま）', true);
// 紹介カード経由の予約 → 来院チェック → 初回カルテ集計のきっかけ「ギフトカード」
const D2 = s1.quiet?.date ?? '2026-10-27';
const wk = await (await fetch(`${B}/api/public/S001/week?start=${D}&kind=NEW`)).json();
const open = wk.days.flatMap((d) => d.slots.filter((x) => x.status === 'open').map((x) => [d.date, x.time]))[0];
const rv = await (await fetch(`${B}/api/public/S001/reserve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'NEW', date: open[0], time: open[1], name: 'カード 経由', phone: '09012121212', via: 'card' }) })).json();
ok('紹介カード経由の予約', rv.ok === true, JSON.stringify(rv));
const day = (await api(p, 'GET', `/api/admin/day?date=${open[0]}`))[1].data;
const c0 = day.cells.find((c) => c.text.includes('カード 経由'));
await api(p, 'PUT', '/api/admin/visit', { date: open[0], time: c0.time, bed: c0.bed, visited: true });
const k = (await api(p, 'GET', `/api/admin/karte?month=${open[0].slice(0, 7)}`))[1];
ok('初回カルテ集計のきっかけに「ギフトカード」', k.rows.some((r) => r.name === 'カード 経由' && r.trig === 'ギフトカード'), JSON.stringify(k.rows.map((r) => [r.name, r.trig])));
await api(hq, 'PUT', '/api/admin/hq/stores-page', { open: false });
console.log('errors', errs, D2);
await br.close();
