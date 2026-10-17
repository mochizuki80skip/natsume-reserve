// Xserver（PHP）版：予約表のセルをマウスで動かす（同じ日の時間・ベッドの変更。確認なし）と「元に戻す」（サンプル店舗 S001）
// 例：BASE_URL=http://127.0.0.1:3003 CHROMIUM_PATH=... node e2e/drag.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003', O = new URL('./', import.meta.url).pathname + 'out-';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const p = await br.newPage({ viewport: { width: 1300, height: 1000 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => { errs.push('dialog:' + d.message()); d.dismiss(); });
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
await p.goto(B + '/admin/login/S001'); await p.fill('input[type=password]', 'password'); await p.click('button[type=submit]'); await p.waitForURL(/admin\/day/);
const api = (m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);
const D = '2026-10-27';
const day = async () => (await api('GET', `/api/admin/day?date=${D}`))[1].data;
const textAt = (d, t, b) => d.cells.find((x) => x.time === t && x.bed === b)?.text ?? '';
const input = (t, b) => p.locator(`td[data-cell="${t}:${b}"] input`);
async function dragCell(from, to) {
  const a = await p.locator(`td[data-cell="${from}"] input`).boundingBox();
  const z = await p.locator(`td[data-cell="${to}"]`).boundingBox();
  await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await p.mouse.down();
  await p.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 4, { steps: 3 });
  await p.mouse.move(z.x + z.width / 2, z.y + z.height / 2, { steps: 8 });
  await p.mouse.up();
  await p.waitForTimeout(1200);
}

// 前回の確認の残りを消す
{ const d0 = await day(); await api('PUT', '/api/admin/cells', { date: D, cells: d0.cells.map((x) => ({ time: x.time, bed: x.bed, text: '' })) }); }
// 準備：手入力の予約（9:00 ベッド1・担当とメニュー付き・来院チェック）と WEB 予約（11:00・初診で 2 枠）
await api('PUT', '/api/admin/cells', { date: D, cells: [{ time: 540, bed: 1, text: 'ドラッグ 一郎（再来）' }, { time: 600, bed: 4, text: 'ふさがり 次郎' }] });
await api('PUT', '/api/admin/visit', { date: D, time: 540, bed: 1, visited: true });
const wb = await api('POST', '/api/public/S001/reserve', { kind: 'NEW', date: D, time: 660, name: 'ウェブ 三子', phone: '090' + String(Date.now()).slice(-8) });
ok('準備：WEB予約', wb[0] === 200, JSON.stringify(wb[1]).slice(0, 80));
await p.goto(`${B}/admin/day/${D}`); await p.waitForSelector('#grid');

// 1) 手入力の予約を 9:00 ベッド1 → 10:30 ベッド2 へ（確認なし）
await dragCell('540:1', '630:2');
let d = await day();
ok('動かすと元が空き、置いた場所に入る', textAt(d, 540, 1) === '' && textAt(d, 630, 2) === 'ドラッグ 一郎（再来）', `${textAt(d, 540, 1)} / ${textAt(d, 630, 2)}`);
ok('画面にもすぐ出る', (await input(540, 1).inputValue()) === '' && (await input(630, 2).inputValue()) === 'ドラッグ 一郎（再来）');
ok('来院チェックも一緒に移る', d.cells.find((x) => x.time === 630 && x.bed === 2)?.visited === true);
ok('名簿に「予約変更」として残る', d.cancels.some((x) => x.kind === 'CHANGE' && x.nextTime === 630 && x.name === 'ドラッグ 一郎（再来）'));
ok('お知らせが出る', await p.getByText('に動かしました').isVisible());
ok('確認の画面は出ない', errs.every((e) => !e.startsWith('dialog')) && (await p.locator('form[aria-label="キャンセル・予約変更"]').count()) === 0);
await p.screenshot({ path: O + 'drag-moved.png' });

// 2) 「元に戻す」で元の場所へ（名簿の「予約変更」も消える）
await p.getByRole('button', { name: /^↶ 元に戻す（/ }).click(); await p.waitForTimeout(1200);
d = await day();
ok('元に戻すで元の場所へ', textAt(d, 540, 1) === 'ドラッグ 一郎（再来）' && textAt(d, 630, 2) === '', `${textAt(d, 540, 1)} / ${textAt(d, 630, 2)}`);
ok('元に戻すと名簿の「予約変更」も消える', !d.cancels.some((x) => x.kind === 'CHANGE' && x.name === 'ドラッグ 一郎（再来）'));

// 3) 別の予約の上には置けない（何も変わらない）
await dragCell('540:1', '600:4');
d = await day();
ok('予約の入ったセルには置けない', textAt(d, 540, 1) === 'ドラッグ 一郎（再来）' && textAt(d, 600, 4) === 'ふさがり 次郎');
ok('置けない理由が出る', await p.getByText('別の予約が入っているため動かせません').isVisible());

// 4) WEB 予約（2 枠）を 11:00 → 9:30 ベッド3 へ。2 枠目・電話番号・予約ログの時間も移る
const webBed = d.cells.find((x) => x.text.includes('ウェブ 三子')).bed;
await dragCell(`660:${webBed}`, '570:3');
d = await day();
const w = d.cells.find((x) => x.time === 570 && x.bed === 3);
ok('WEB予約も動かせる（2 枠目・WEBの情報ごと）', w?.text.includes('ウェブ 三子') && w?.web?.phone && textAt(d, 585, 3) === '上記初診対応' && textAt(d, 660, webBed) === '' && textAt(d, 675, webBed) === '', JSON.stringify(w));
const log = (await api('GET', `/api/admin/reservations?from=${D}&to=${D}&status=all`))[1];
ok('予約ログの時間も変わる', JSON.stringify(log).includes('"time":570') || JSON.stringify(log).includes('9:30'), JSON.stringify(log).slice(0, 200));

// 5) Ctrl+Z でも戻せる
await input(900, 5).click(); await p.keyboard.press('Control+z'); await p.waitForTimeout(1200);
d = await day();
ok('Ctrl+Z で WEB予約が元の時間へ', textAt(d, 660, webBed).includes('ウェブ 三子') && textAt(d, 570, 3) === '');

// 6) 枠（施術者の人数）がいっぱいの時間には動かさない
const capAm = d.capacity.am;
const fill = []; for (let b = 1; b <= capAm; b++) fill.push({ time: 690, bed: b, text: `満${b}` });
await api('PUT', '/api/admin/cells', { date: D, cells: fill });
await p.reload(); await p.waitForSelector('#grid');
const freeBed = d.beds.find((b) => b > capAm);
if (freeBed) {
  await dragCell('540:1', `690:${freeBed}`);
  d = await day();
  ok('枠がいっぱいの時間には動かない（理由が出る）', textAt(d, 540, 1) === 'ドラッグ 一郎（再来）' && await p.getByText('枠（施術者の人数）がいっぱい').isVisible());
}

// 7) ふつうのクリック・入力は今までどおり（動かない）
await input(540, 1).click(); await p.keyboard.type('ドラッグ 一郎（再来）様'); await p.keyboard.press('Tab'); await p.waitForTimeout(800);
d = await day();
ok('クリックして入力はそのまま使える', textAt(d, 540, 1) === 'ドラッグ 一郎（再来）様');
ok('画面のエラーなし', errs.length === 0, JSON.stringify(errs));
await br.close();
