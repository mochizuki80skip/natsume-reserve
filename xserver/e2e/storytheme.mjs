// Xserver（PHP）版：ストーリー画像のテーマ（色・見出しの形）を店舗ごとに選ぶ・覚える（サンプル店舗 S001・S002）
// 例：BASE_URL=http://127.0.0.1:3003 CHROMIUM_PATH=... node e2e/storytheme.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const errs = [];
async function login(code) {
  const p = await br.newPage({ viewport: { width: 1300, height: 1000 } }); p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`${B}/admin/login/${code}`); await p.fill('input[type=password]', 'password'); await p.click('button[type=submit]'); await p.waitForURL(/admin\/day/);
  return p;
}
// 見出しのあたり（上から 60px）の色
const headerColor = (p) => p.evaluate(() => { const c = document.querySelector('canvas'); const d = c.getContext('2d').getImageData(40, 60, 1, 1).data; return '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join(''); });

const p1 = await login('S001');
await p1.goto(`${B}/admin/story`); await p1.waitForTimeout(2000);
ok('テーマを選ぶ欄', await p1.getByRole('group', { name: '画像のテーマ' }).isVisible());
const auto1 = await headerColor(p1);
const p2 = await login('S002');
await p2.goto(`${B}/admin/story`); await p2.waitForTimeout(2000);
const auto2 = await headerColor(p2);
ok('おまかせは店舗ごとに違う色になる', auto1 !== auto2, `${auto1} ${auto2}`);
await p1.getByRole('button', { name: 'テーマ さくら' }).click(); await p1.waitForTimeout(1200);
ok('さくらを選ぶと見出しがさくら色', (await headerColor(p1)) === '#f4a6c0', await headerColor(p1));
await p1.reload(); await p1.waitForTimeout(2000);
ok('選んだテーマを店舗で覚える', (await p1.getByRole('button', { name: 'テーマ さくら' }).getAttribute('aria-pressed')) === 'true' && (await headerColor(p1)) === '#f4a6c0');
await p1.getByRole('button', { name: 'テーマ ネイビー' }).click(); await p1.waitForTimeout(1200);
ok('ネイビーに変えられる', (await headerColor(p1)) === '#1f3b5b');
ok('おかしなテーマは保存しない', (await p1.evaluate(async () => (await fetch('/api/admin/story-theme', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ theme: 'nope' }) })).status)) === 400);
await p1.getByRole('button', { name: /おまかせ/ }).click(); await p1.waitForTimeout(1200);
ok('おまかせに戻せる', (await headerColor(p1)) === auto1);
ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
console.log(process.exitCode ? 'STORYTHEME FAILED' : 'STORYTHEME OK');
