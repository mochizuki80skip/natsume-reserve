// 自賠請求の手順フロー（7〜10：このシステムでの読み取り・提出）の画面写真を撮る（見本の患者だけ・サンプル店舗 S001）。public/guide/jibai-flow-N.png に保存
// 1〜6（レセコン）の画像は依頼者から受け取ったものを public/guide/jibai-flow-1〜6.png に置く
// まっさらな DB で：BASE_URL=http://127.0.0.1:3003 CHROMIUM_PATH=... node e2e/jibai-flow-shots.mjs
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003';
const OUT = new URL('../public/guide/', import.meta.url).pathname;
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

// ---- 自賠請求
await p.goto(`${B}/admin/login/S001`); await p.fill('input[type=password]', 'password'); await p.click('button[type=submit]'); await p.waitForURL(/admin\/day/);
await p.evaluate(() => localStorage.setItem('jibaiFlowClosed', '1')); // フローは閉じて撮る
await p.goto(`${B}/admin/jibai`); await p.waitForTimeout(1500);
const ym = await p.evaluate(async () => (await (await fetch('/api/admin/jibai')).json()).currentYm);
await shot('jibai-flow-7.png', [p.getByRole('button', { name: 'スクショを選ぶ' })], { area: p.getByRole('button', { name: 'スクショを選ぶ' }).locator('xpath=../..') });
await api('PUT', '/api/admin/jibai/claims', { ym, claims: [
  { patientNo: '001234a', patientName: '見本 太郎', invoiceYm: ym, days: 8, amount: 64800, source: 'OCR' },
  { patientNo: '001235b', patientName: '見本 花子', invoiceYm: ym, days: 5, amount: 40500, source: 'OCR' },
] });
await p.reload(); await p.waitForTimeout(1500);
const row = p.locator('tbody tr').first();
await shot('jibai-flow-8.png', [row.locator('input').nth(0), row.locator('input').nth(1), row.locator('select[aria-label="請求月"]'), row.locator('input').nth(2), row.locator('input').nth(3)], { area: p.locator('table').first() });
await row.locator('input').nth(2).fill('9');
await shot('jibai-flow-9.png', [p.getByRole('button', { name: /変更を保存/ })], { area: p.getByRole('button', { name: /変更を保存/ }).locator('xpath=..') });
await p.getByRole('button', { name: /変更を保存/ }).click(); await p.waitForTimeout(1200);
await shot('jibai-flow-10.png', [p.getByRole('button', { name: 'この月を提出する' })], { area: p.getByRole('button', { name: 'この月を提出する' }).locator('xpath=ancestor::div[contains(@class,"px-4 py-3")][1]') });
console.log(errs.length ? 'ERRORS ' + errs.join(' / ') : 'no page errors');
await br.close();
