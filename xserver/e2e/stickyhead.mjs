// Xserver（PHP）版：上のメニュー（予約表・新患継続率など）を画面の上に固定し、予約表の日付の帯はそのすぐ下に固定（サンプル店舗 S001）
// 例：BASE_URL=http://127.0.0.1:3003 CHROMIUM_PATH=... node e2e/stickyhead.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const errs = [];
for (const [label, viewport] of [['パソコン', { width: 1366, height: 800 }], ['スマホ', { width: 390, height: 844 }]]) {
  const p = await br.newPage({ viewport }); p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`${B}/admin/login/S001`); await p.fill('input[type=password]', 'password'); await p.click('button[type=submit]'); await p.waitForURL(/admin\/day/);
  await p.waitForSelector('td[data-cell="540:1"] input'); await p.waitForTimeout(800);
  const head = p.getByRole('banner', { name: '管理画面のメニュー' });
  await p.mouse.wheel(0, 2500); await p.waitForTimeout(600);
  const hb = await head.boundingBox();
  ok(`${label}：下へ動かしても上のメニューが画面の上に残る`, hb && Math.abs(hb.y) < 2, JSON.stringify(hb));
  const nav = await p.locator('div.sticky').first().boundingBox();
  ok(`${label}：日付の帯は上のメニューのすぐ下`, nav && Math.abs(nav.y - (hb.y + hb.height)) < 3, JSON.stringify([hb, nav]));
  if (label === 'パソコン') {
    ok('上のメニューから新患継続率へ移れる（下へ動かしたまま）', await p.getByRole('link', { name: /新患継続率/ }).first().isVisible());
    await p.goto(`${B}/admin/karte`); await p.waitForTimeout(1200);
    await p.mouse.wheel(0, 2500); await p.waitForTimeout(500);
    const kb = await head.boundingBox();
    ok('ほかの画面（新患継続率）でも上のメニューが残る', kb && Math.abs(kb.y) < 2, JSON.stringify(kb));
  }
  await p.close();
}
ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
console.log(process.exitCode ? 'STICKYHEAD FAILED' : 'STICKYHEAD OK');
