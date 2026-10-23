// Xserver（PHP）版：患者様の「ご予約の確認」（この端末で WEB 予約した予約の一覧）
// 例：BASE_URL=http://127.0.0.1:3003 CHROMIUM_PATH=... node e2e/myres.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003', O = new URL('./', import.meta.url).pathname + 'out-';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const errs = [];
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const cp = await (await br.newContext({ viewport: { width: 420, height: 860 } })).newPage();
cp.on('pageerror', (e) => errs.push(e.message));

// 1) はじめは「ご予約の確認」は出ない
await cp.goto(`${B}/s/S001`); await cp.waitForSelector('table.wk tbody tr', { timeout: 15000 });
ok('予約したことがない端末では出ない', (await cp.getByRole('link', { name: '📅 ご予約の確認' }).count()) === 0);

// 2) WEB 予約する
await cp.getByRole('button', { name: /ご通院したことがある方/ }).click();
await cp.getByRole('radio', { name: /現在通院中/ }).click(); await cp.waitForTimeout(800);
let slot = cp.locator('td.o button').first();
for (let i = 0; i < 4 && (await slot.count()) === 0; i++) { await cp.getByRole('button', { name: '翌週 ›' }).click(); await cp.waitForTimeout(800); slot = cp.locator('td.o button').first(); }
await slot.click();
await cp.getByRole('button', { name: 'この日時で予約へ進む' }).click(); await cp.waitForSelector('h2');
const sfx = String(Date.now()).slice(-5);
const cardInput = cp.locator('input[inputmode="numeric"]').first();
if (await cardInput.count()) await cardInput.fill('123456');
await cp.fill('input[placeholder*="山田"]', `確認 花子${sfx}`);
await cp.fill('input[type="tel"]', '070' + String(Date.now()).slice(-8));
await cp.getByRole('button', { name: '入力内容を確認する' }).click();
await cp.getByRole('button', { name: 'この内容で予約する' }).click();
await cp.waitForSelector('text=ご予約が確定しました', { timeout: 15000 });
ok('予約した直後から上に出る', await cp.getByRole('link', { name: '📅 ご予約の確認' }).isVisible());

// 3) 予約ページに戻ると「ご予約の確認」→ 一覧に日時・店舗・名前
await cp.goto(`${B}/s/S001`); await cp.waitForSelector('table.wk tbody tr', { timeout: 15000 });
await cp.getByRole('link', { name: '📅 ご予約の確認' }).click(); await cp.waitForURL(/\/my\?store=S001/);
await cp.waitForSelector('text=ご予約中');
const t = await cp.textContent('main');
ok('一覧に日時・店舗・名前（フルネーム）', /月.*日.*〜/.test(t) && t.includes('サンプル本店') && t.includes(`確認 花子${sfx}`) && !t.includes('＊'), t.slice(0, 160));
ok('電話番号は出さない', !/070\d/.test(t));
await cp.screenshot({ path: O + 'myres.png' });

// 4) 店舗で時間を動かすと、一覧も新しい時間になる
const ap = await br.newPage();
await ap.goto(B + '/admin/login/S001'); await ap.fill('input[type=password]', 'password'); await ap.click('button[type=submit]'); await ap.waitForURL(/admin\/day/);
const api = (pg, m, u, b) => pg.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);
const res = (await api(ap, 'GET', '/api/admin/reservations?status=all'))[1].rows.find((r) => r.name === `確認 花子${sfx}`);
const mv = await api(ap, 'POST', '/api/admin/move', { date: res.date, time: res.time, bed: res.bed, toDate: res.date, toTime: res.time + 30, allowOver: true });
ok('店舗で時間を動かす', mv[0] === 200, JSON.stringify(mv[1]).slice(0, 80));
await cp.reload(); await cp.waitForSelector('text=ご予約中');
const hm = `${Math.floor((res.time + 30) / 60)}:${String((res.time + 30) % 60).padStart(2, '0')}〜`;
ok('一覧は新しい時間', (await cp.textContent('main')).includes(hm), hm);
// 5) くわしく見る → 確認ページ → 「この端末のご予約をすべて見る」で戻れる
await cp.getByRole('link', { name: /くわしく見る/ }).first().click(); await cp.waitForURL(/\/r\//);
ok('確認ページから一覧へ', !!(await cp.waitForSelector('text=この端末のご予約をすべて見る', { timeout: 10000 }).catch(() => null)));
// 6) 別の端末（ブラウザ）では出ない
const other = await (await br.newContext()).newPage();
await other.goto(`${B}/my`); await other.waitForSelector('h1');
ok('別の端末では一覧に出ない', (await other.textContent('main')).includes('この端末で WEB 予約したご予約はありません'));
ok('画面のエラーなし', errs.length === 0, JSON.stringify(errs));
await br.close();
