// Xserver（PHP）版：予約表のベッドの列は同じ幅（名前・メニュー・担当・WEB を入れても列が広がらない）と、
// カルテNo を入れると、患者一覧に無くても新患継続率に入れたカルテNo から氏名が出る
// 例：BASE_URL=http://127.0.0.1:3003 CHROMIUM_PATH=... node e2e/gridwidth.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const errs = [];
const p = await br.newPage({ viewport: { width: 1366, height: 1000 } }); p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
const api = (m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);
await p.goto(`${B}/admin/login/S001`); await p.fill('input[type=password]', 'password'); await p.click('button[type=submit]'); await p.waitForURL(/admin\/day/);
const D = (() => { const d = new Date(); d.setDate(d.getDate() + 2); for (;;) { const s = d.toISOString().slice(0, 10); if ([1, 2, 3, 5].includes(d.getDay()) && !['2026-11-23'].includes(s)) return s; d.setDate(d.getDate() + 1); } })();
await p.goto(`${B}/admin/day/${D}`); await p.waitForSelector('td[data-cell="540:1"] input'); await p.waitForTimeout(800);
const widths = () => p.evaluate(() => [...document.querySelectorAll('#grid tbody tr:first-child td')].slice(1).map((td) => Math.round(td.getBoundingClientRect().width)));
const w0 = await widths();
ok('はじめはベッドの列が同じ幅', Math.max(...w0) - Math.min(...w0) <= 1, JSON.stringify(w0));
// 長い名前・メニュー・担当・来院チェックを入れる
await api('PUT', '/api/admin/cells', { date: D, cells: [{ time: 540, bed: 2, text: '見本 とても長い名前の患者様（初診）' }, { time: 600, bed: 3, text: '見本 二郎（再）' }] });
await api('PUT', '/api/admin/cell-menus', { date: D, time: 600, bed: 3, menus: ['矯正', '自費', 'ワンコイン', '物販'] });
await api('PUT', '/api/admin/visit', { date: D, time: 600, bed: 3, visited: true });
await p.reload(); await p.waitForSelector('td[data-cell="540:1"] input'); await p.waitForTimeout(800);
await p.locator('td[data-cell="615:4"] input').fill('見本 三子とても長い名前を入れてみる'); await p.keyboard.press('Tab'); await p.waitForTimeout(800);
const w1 = await widths();
ok('入力したあとも、ベッドの列は同じ幅のまま', Math.max(...w1) - Math.min(...w1) <= 1 && Math.abs(w1[0] - w0[0]) <= 1, JSON.stringify([w0, w1]));
const over = await p.evaluate(() => [...document.querySelectorAll('#grid td.grid-cell')].flatMap((td) => { const r = td.getBoundingClientRect(); return [...td.querySelectorAll('span:not([aria-hidden]):not([aria-label="選んだ範囲を広げる"]),input')].filter((el) => { const e = el.getBoundingClientRect(); return e.width > 0 && e.right > r.right + 2; }).map((el) => `${td.dataset.cell}:${el.tagName}:${(el.className || '').slice(0, 40)}:${Math.round(el.getBoundingClientRect().right - r.right)}`); }));
ok('セルの中身が隣にはみ出さない', over.length === 0, JSON.stringify(over.slice(0, 5)));
await p.screenshot({ path: new URL('./out-gridwidth.png', import.meta.url).pathname, clip: { x: 0, y: 300, width: 1366, height: 500 } });
// スマホは画面の幅に収める（今までどおり）
await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(600);
ok('スマホでは画面の幅に収まる', await p.evaluate(() => document.getElementById('grid').getBoundingClientRect().width <= 392));
await p.setViewportSize({ width: 1366, height: 1000 });

// カルテNo：患者一覧に無い番号でも、新患継続率に入れたカルテNo から
await api('POST', '/api/admin/karte', { date: D, name: '見本花子', karteNo: '04567', kind: 'NEW' }).catch(() => {});
let k = (await api('GET', `/api/admin/karte?month=${D.slice(0, 7)}`))[1].rows.find((r) => r.name === '見本花子');
if (!k) { // 新患継続率の行は予約表から作る（来院チェック）
  await api('PUT', '/api/admin/cells', { date: D, cells: [{ time: 660, bed: 1, text: '見本 花子（初診）' }] });
  await api('PUT', '/api/admin/visit', { date: D, time: 660, bed: 1, visited: true });
  k = (await api('GET', `/api/admin/karte?month=${D.slice(0, 7)}`))[1].rows.find((r) => r.name === '見本花子');
  await api('PATCH', '/api/admin/karte', { id: k.id, patch: { karteNo: '04567' } });
}
const lk = (await api('GET', '/api/admin/patients/lookup?no=4567'))[1];
ok('新患継続率のカルテNo から氏名（名字と名前の間にスペース）', lk.name === '見本 花子' && lk.from === 'karte', JSON.stringify(lk));
await p.reload(); await p.waitForSelector('td[data-cell="540:1"] input'); await p.waitForTimeout(800);
await p.locator('td[data-cell="705:3"] input').fill('4567'); await p.waitForTimeout(600);
await p.keyboard.press('Enter'); await p.waitForTimeout(800);
ok('予約表でカルテNo を入れると氏名になる', (await p.locator('td[data-cell="705:3"] input').inputValue()) === '見本 花子');
ok('どこにもない番号は番号のまま', (await api('GET', '/api/admin/patients/lookup?no=99999'))[1].name === null);
ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
console.log(process.exitCode ? 'GRIDWIDTH FAILED' : 'GRIDWIDTH OK');
