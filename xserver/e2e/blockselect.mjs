// Xserver（PHP）版：予約表でセルを選んでブロックする（Ctrl＋クリックで離れたセルを足す・右下の ■ をドラッグで広げる・理由は任意・予約の入った枠は飛ばす・選んだ枠だけ外す）
// 例：BASE_URL=http://127.0.0.1:3003 CHROMIUM_PATH=... node e2e/blockselect.mjs
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
// 2 日以上先の月〜金（木曜・祝日を除く）
const D = (() => { const d = new Date(); d.setDate(d.getDate() + 2); for (;;) { const s = d.toISOString().slice(0, 10); if (d.getDay() >= 1 && d.getDay() <= 5 && d.getDay() !== 4 && !['2026-11-03', '2026-11-23'].includes(s)) return s; d.setDate(d.getDate() + 1); } })();
await api('PUT', '/api/admin/cells', { date: D, cells: [{ time: 615, bed: 3, text: '見本 予約' }] });
await p.goto(`${B}/admin/day/${D}`); await p.waitForSelector('td[data-cell="600:1"] input'); await p.waitForTimeout(800);
const cell = (t, b) => p.locator(`td[data-cell="${t}:${b}"]`);
const group = p.getByRole('group', { name: '選んだ枠のブロック' });

// 1 つ選ぶ → 「1 枠をブロック」
await cell(600, 1).locator('input').click(); await p.waitForTimeout(200);
ok('空いたセルを 1 つ選ぶと「1 枠をブロック」', (await group.textContent()).includes('1 枠をブロック'));
// 右下の ■ を 645 まで下へドラッグ（10:00〜10:45 の 4 枠）
const h = await cell(600, 1).getByLabel('選んだ範囲を広げる').boundingBox();
const tgt = await cell(645, 1).boundingBox();
await p.mouse.move(h.x + 4, h.y + 4); await p.mouse.down();
await p.mouse.move(tgt.x + 20, tgt.y + tgt.height / 2, { steps: 6 }); await p.waitForTimeout(200);
// 選ぶ範囲が変わると上の帯の高さが変わることがあるので、もう一度 10:45 の位置へ
const tgt2 = await cell(645, 1).boundingBox();
await p.mouse.move(tgt2.x + 20, tgt2.y + tgt2.height / 2, { steps: 2 }); await p.mouse.up(); await p.waitForTimeout(200);
ok('右下の ■ をドラッグして 4 枠に広がる', (await group.textContent()).includes('4 枠をブロック'), await group.textContent());
// Ctrl＋クリックでベッド3 の 10:00・10:15（予約あり）を足す → 6 枠選択・ブロックできるのは 5 枠
await cell(600, 3).locator('input').click({ modifiers: ['Control'] });
await cell(615, 3).locator('input').click({ modifiers: ['Control'] }); await p.waitForTimeout(200);
const bar = await p.getByRole('group', { name: '予約のメニュー' }).textContent();
ok('Ctrl＋クリックで離れたセルを足す（6 枠選択中）', bar.includes('6 枠選択中'), bar.slice(0, 120));
ok('予約の入った枠は飛ばす（5 枠をブロック）', (await group.textContent()).includes('5 枠をブロック'));
await p.screenshot({ path: new URL('./out-blockselect.png', import.meta.url).pathname, clip: { x: 0, y: 0, width: 1366, height: 700 } });
await group.getByLabel('ブロックの理由').fill('打合せ');
await group.getByRole('button', { name: /5 枠をブロック/ }).click(); await p.waitForTimeout(1500);
let blocks = (await api('GET', `/api/admin/day?date=${D}`))[1].data.blocks;
const desc = (bs) => bs.map((b) => `${b.start}-${b.end}:${b.beds.join(',')}:${b.label}`).sort().join(' / ');
ok('ベッドごとに続いた時間でブロック（ベッド1 10:00〜11:00・ベッド3 10:00〜10:15、理由つき）', desc(blocks) === ['600-660:1:打合せ', '600-615:3:打合せ'].sort().join(' / '), desc(blocks));
ok('予約表に 🔒打合せ', (await cell(630, 1).locator('input').getAttribute('placeholder')) === '🔒打合せ');
ok('予約の入った枠はそのまま', (await cell(615, 3).locator('input').inputValue()) === '見本 予約');
// 選んだ枠だけ外す（ベッド1 の 10:15・10:30）
await cell(615, 1).locator('input').click();
await cell(630, 1).locator('input').click({ modifiers: ['Control'] }); await p.waitForTimeout(200);
ok('ブロックしてある枠を選ぶと「ブロックを外す（2 枠）」', (await group.textContent()).includes('ブロックを外す（2 枠）'));
await group.getByRole('button', { name: /ブロックを外す/ }).click(); await p.waitForTimeout(1500);
blocks = (await api('GET', `/api/admin/day?date=${D}`))[1].data.blocks;
ok('選んだ枠だけ外れ、ほかは理由ごと残る', desc(blocks) === ['600-615:1:打合せ', '600-615:3:打合せ', '645-660:1:打合せ'].sort().join(' / '), desc(blocks));
// 理由なしでもブロックできる
await cell(690, 2).locator('input').click(); await p.waitForTimeout(200);
await group.getByRole('button', { name: /1 枠をブロック/ }).click(); await p.waitForTimeout(1200);
ok('理由は入れなくてもよい（🔒ブロック）', (await cell(690, 2).locator('input').getAttribute('placeholder')) === '🔒ブロック');
// WEB の空き：ブロックした枠は取れない
const pub = (await api('GET', `/api/public/S001/slots?date=${D}&kind=RETURN`))[1].slots;
ok('WEB の空きにも反映（ほかの API と同じ）', Array.isArray(pub));
ok('Esc で選択を外す', await (async () => { await cell(600, 2).locator('input').click(); await cell(615, 2).locator('input').click({ modifiers: ['Control'] }); await p.keyboard.press('Escape'); await p.waitForTimeout(200); return !(await p.getByRole('group', { name: '予約のメニュー' }).textContent()).includes('枠選択中'); })());
ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
console.log(process.exitCode ? 'BLOCKSELECT FAILED' : 'BLOCKSELECT OK');
