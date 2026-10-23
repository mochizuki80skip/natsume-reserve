// 「使い方」ガイドの画面写真を撮る（見本の名前だけ・サンプル店舗 S001）。大事なところを赤い枠で囲んで public/guide/ に保存する
// まっさらな DB で：BASE_URL=http://127.0.0.1:3003 CHROMIUM_PATH=... node e2e/guide-shots.mjs
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003';
const OUT = new URL('../public/guide/', import.meta.url).pathname;
const CSV = new URL('./fixtures/patients-sample.csv', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const p = await br.newPage({ viewport: { width: 1280, height: 860 } });
p.on('dialog', (d) => d.accept());
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const api = (m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);

/** targets を赤い枠で囲み、その周り（area があればその範囲）を撮る */
async function shot(name, targets, { area, pad = [220, 110] } = {}) {
  const ts = (Array.isArray(targets) ? targets : [targets]).filter(Boolean);
  const box = async (l) => l.evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }; });
  // 画面に出る URL は本番のものに見せる（QR はそのまま）
  await p.evaluate((b) => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) if (n.nodeValue.includes(b)) n.nodeValue = n.nodeValue.split(b).join('https://yoyaku.hachimaru-80skip.com'); }, B);
  const boxes = [];
  for (const t of ts) boxes.push(await box(t.first()));
  await p.evaluate((bs) => {
    for (const b of bs) {
      const d = document.createElement('div');
      d.className = 'guide-mark';
      Object.assign(d.style, { position: 'absolute', left: `${b.x - 4}px`, top: `${b.y - 4}px`, width: `${b.w + 8}px`, height: `${b.h + 8}px`, border: '3px solid #e11d48', borderRadius: '6px', zIndex: 99999, pointerEvents: 'none', boxShadow: '0 0 0 3px rgba(225,29,72,.18)' });
      document.body.appendChild(d);
    }
  }, boxes);
  let c;
  if (area) { const a = await box(area.first()); c = { x: a.x - 8, y: a.y - 8, w: a.w + 16, h: a.h + 16 }; }
  else {
    const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
    const x1 = Math.max(...boxes.map((b) => b.x + b.w)), y1 = Math.max(...boxes.map((b) => b.y + b.h));
    c = { x: x0 - pad[0], y: y0 - pad[1], w: x1 - x0 + pad[0] * 2, h: y1 - y0 + pad[1] * 2 };
  }
  const W = await p.evaluate(() => document.documentElement.scrollWidth);
  const H = await p.evaluate(() => document.documentElement.scrollHeight);
  const x = Math.max(0, c.x), y = Math.max(0, c.y);
  const clip = { x, y, width: Math.min(W - x, c.w + c.x - x, 1280), height: Math.min(H - y, c.h + c.y - y, 900) };
  await p.screenshot({ path: OUT + name, clip, fullPage: true });
  await p.evaluate(() => document.querySelectorAll('.guide-mark').forEach((d) => d.remove()));
  console.log('saved', name);
}

// ---- ログイン
await p.goto(`${B}/admin/login/S001`); await p.waitForSelector('input[type=password]');
await shot('login-1.png', [p.locator('input[type=password]'), p.locator('button[type=submit]')], { pad: [260, 160] });
await p.fill('input[type=password]', 'password'); await p.click('button[type=submit]'); await p.waitForURL(/admin\/day/);

// 見本のデータ：患者一覧・スタッフの色と担当・WEB 予約
await p.goto(`${B}/admin/settings`); await p.waitForSelector('text=患者一覧（診察券番号 → 氏名）');
await p.locator('input[type=file]').setInputFiles(CSV); await p.waitForSelector('text=人を取り込みました');
for (const name of ['見本 一郎', '見本 二郎', '見本 三子']) {
  const m = (await api('POST', '/api/admin/staff-members', { name, role: 'THERAPIST' }))[1].member;
  await api('PUT', '/api/admin/staff-members', { id: m.id, canFirst: true, canRevisit: true });
}
const D = '2026-10-27';
const reserve = (time, name, phone, kind = 'NEW') => p.evaluate(async ([D, time, name, phone, kind]) => {
  const r = await fetch('/api/public/S001/reserve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, date: D, time, name, phone }) });
  return r.status;
}, [D, time, name, phone, kind]);
console.log('web', await reserve(570, '見本 花子', '090-1234-5678'));
await api('PUT', '/api/admin/cells', { date: D, cells: [
  { time: 540, bed: 1, text: '見本 太郎（初診）' }, { time: 555, bed: 1, text: '上記初診対応' },
  { time: 540, bed: 2, text: '例 次郎' }, { time: 600, bed: 1, text: '試し 三郎（再来）' }, { time: 615, bed: 1, text: '上記再来対応' },
  { time: 630, bed: 2, text: '練習 一子' }, { time: 660, bed: 3, text: '仮名 四郎' },
] });
for (const [t, b] of [[540, 1], [540, 2]]) await api('PUT', '/api/admin/visit', { date: D, time: t, bed: b, visited: true });
await api('PUT', '/api/admin/cell-staff', { date: D, cells: [{ time: 540, bed: 1 }], staff: '見本 一郎' });
await api('PUT', '/api/admin/cell-staff', { date: D, cells: [{ time: 600, bed: 1 }, { time: 540, bed: 2 }], staff: '見本 二郎' });

// ---- 予約表
await p.goto(`${B}/admin/day/${D}`); await p.waitForSelector('#grid'); await p.waitForTimeout(800);
const cell = (t, b) => p.locator(`td[data-cell="${t}:${b}"]`);
const nav = p.locator('[aria-label="日付の切り替え"]');
await shot('start-1.png', [p.locator('#grid')], { area: p.locator('main') });

await cell(630, 3).locator('input').click(); await p.keyboard.type('見本 五郎'); await p.waitForTimeout(200);
await shot('grid-basic-1.png', [cell(630, 3)], { pad: [380, 170] });
await p.keyboard.press('Escape'); await p.keyboard.press('Enter'); await p.waitForTimeout(700);

// 電話予約
await cell(690, 2).locator('input').click();
const phoneBtn = p.getByRole('button', { name: /11:30 ベッド2 に電話予約を入れる/ });
await shot('phone-1.png', [phoneBtn, cell(690, 2)], { pad: [80, 60] });
await phoneBtn.click();
const dlg = p.getByRole('form', { name: '電話予約を入れる' });
await dlg.getByLabel('お名前').fill('電話 見本'); await dlg.getByLabel('電話番号').fill('090-1111-2222');
await shot('phone-2.png', [dlg.getByRole('button', { name: '予約表に入れる' })], { area: dlg });
await dlg.getByRole('button', { name: '予約表に入れる' }).click(); await p.waitForTimeout(1000);

// 区分・メニュー・物販／担当
await cell(540, 2).locator('input').click(); await p.waitForTimeout(300);
const bar = p.getByRole('group', { name: '予約のメニュー' });
await shot('kind-menu-1.png', [bar], { pad: [20, 60] });
const staffRow = p.getByRole('group', { name: '担当' });
await shot('staff-1.png', [staffRow], { pad: [20, 70] });

// 来院チェック
await shot('visit-1.png', [cell(540, 1).getByRole('button', { name: /来院チェック/ })], { pad: [160, 70] });

// 予約を動かす
await cell(690, 3).evaluate((el) => el.scrollIntoView({ block: 'center' })); await p.waitForTimeout(300);
const from = await cell(660, 3).boundingBox(), to = await cell(720, 3).boundingBox();
await p.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await p.mouse.down();
await p.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2 + 4, { steps: 3 });
await p.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(1000);
const toast = p.getByText('に動かしました');
await shot('drag-1.png', [toast, cell(720, 3)], { pad: [420, 60] });

// キャンセル・予約変更
await cell(630, 2).hover(); await cell(630, 2).getByLabel('メニュー', { exact: true }).click();
const chg = p.getByText('キャンセル・予約変更…');
await shot('change-1.png', [chg], { pad: [260, 130] });
await chg.click(); await p.waitForTimeout(600);
const chDlg = p.getByRole('form', { name: 'キャンセル・予約変更' });
await shot('change-2.png', [chDlg.getByRole('radiogroup', { name: 'どうするか' })], { area: chDlg });
await p.keyboard.press('Escape');
const closeBtn = p.getByRole('button', { name: /やめる|閉じる/ }).first(); if (await closeBtn.isVisible().catch(() => false)) await closeBtn.click();
await p.waitForTimeout(300);

// 予約を探す
await p.getByRole('button', { name: '🔍 予約を探す' }).click();
const fd = p.getByRole('dialog').first();
await p.keyboard.type('見本'); await p.keyboard.press('Enter'); await p.waitForTimeout(1000);
await shot('find-1.png', [p.getByRole('button', { name: '🔍 予約を探す' })], { area: fd });
await p.keyboard.press('Escape'); await p.waitForTimeout(300);
const close2 = p.getByRole('button', { name: /閉じる/ }).first(); if (await close2.isVisible().catch(() => false)) await close2.click();

// 診察券番号
await cell(720, 1).locator('input').click(); await p.keyboard.type('3842'); await p.waitForTimeout(900);
await shot('cardno-1.png', [cell(720, 1)], { pad: [260, 120] });
await p.keyboard.press('Enter'); await p.waitForTimeout(800);

// 元に戻す・印刷・WEB・公開・枠数
await shot('undo-1.png', [nav.getByRole('button', { name: /元に戻す/ })], { area: nav });
await shot('print-1.png', [nav.getByRole('link', { name: '印刷／PDF' })], { area: nav });
await shot('web-1.png', [cell(570, 1).or(p.locator('td[data-cell]').filter({ hasText: '見本 花子' })).first()], { pad: [260, 90] });
const pubRow = p.getByText('公開する', { exact: true }).locator('xpath=..');
await shot('publish-1.png', [pubRow], { pad: [420, 60] });
await p.getByRole('button', { name: /枠数・ブロック/ }).click(); await p.waitForTimeout(400);
await shot('capacity-1.png', [p.getByRole('button', { name: /枠数・ブロック/ }), p.getByText('顧客に見える枠数').locator('xpath=../..')], { pad: [20, 30] });
await p.getByRole('button', { name: /枠数・ブロック/ }).click();

// ---- そのほかの画面
await p.goto(`${B}/admin/settings?tab=calendar`); await p.waitForTimeout(1200);
await shot('publish-2.png', [p.getByRole('tab', { name: /カレンダー/ })], { area: p.locator('main') });
await p.goto(`${B}/admin/shifts`); await p.waitForTimeout(1200);
await shot('shifts-1.png', [p.locator('select').first()], { area: p.locator('main') });
await p.goto(`${B}/admin/reservations?from=2026-10-01&to=2026-11-30`); await p.waitForTimeout(1200);
await shot('log-1.png', [p.getByRole('link', { name: 'WEB予約一覧' }), p.getByRole('link', { name: 'キャンセル名簿' })], { area: p.locator('main') });
await p.goto(`${B}/admin/karte?month=2026-10`); await p.waitForTimeout(1500);
await shot('karte-1.png', [p.locator('table tbody tr').first()], { area: p.locator('main') });
await p.goto(`${B}/admin/karte/summary`); await p.waitForTimeout(1500);
await shot('summary-1.png', [p.getByText('単位').first()], { area: p.locator('main') });
await p.goto(`${B}/admin/staff-counts`); await p.waitForTimeout(1200);
await shot('staffcounts-1.png', [p.getByRole('button', { name: '日ごとの施術人数' }), p.getByRole('button', { name: '新患・再来・回数' })], { area: p.locator('main') });
await p.goto(`${B}/admin/jibai`); await p.waitForTimeout(1200);
await shot('jibai-1.png', [p.getByRole('button', { name: 'スクショを選ぶ' })], { area: p.locator('main') });
await p.goto(`${B}/admin/settings`); await p.waitForTimeout(1200);
const staffSec = p.locator('section').filter({ has: p.getByRole('heading', { name: 'スタッフ・シフト' }) });
await shot('settings-1.png', [staffSec.locator('label').filter({ hasText: '初回（初診・新自）を担当する' }).first(), staffSec.locator('label').filter({ hasText: '再来を担当する' }).first(), staffSec.locator('label').filter({ hasText: '予約表の色' }).first()], { area: staffSec });
await shot('settings-2.png', [p.getByText('QR 画像を保存', { exact: true }).first(), p.getByText('QR 画像を保存', { exact: true }).nth(1)], { pad: [40, 30], area: p.getByText('この店舗の URL・QR コード').locator('xpath=..') });

console.log(errs.length ? 'ERRORS ' + errs.join(' / ') : 'no page errors');
await br.close();
