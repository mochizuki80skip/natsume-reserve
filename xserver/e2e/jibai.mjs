// 自賠請求（速報集計）の一通りの確認：店舗でスクショを読み取り → 保存 → 提出 → 本部の集計・経理確認
// 例：cd xserver && php -S 127.0.0.1:3003 -t public dev-router.php &  BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... SHOT=./sample.png node e2e/jibai.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3003';
const HQ_PASSWORD = process.env.HQ_PASSWORD ?? 'hqpassword';
const SHOT = process.env.SHOT; // レセコン画面のスクショ（PNG）。無ければ読み取りの確認は飛ばす
const EXPECT = { patientNo: process.env.EXPECT_NO ?? '003862a', amount: process.env.EXPECT_AMOUNT ?? '73420', days: process.env.EXPECT_DAYS ?? '13' };
const ok = (name, cond, extra = '') => { console.log(cond ? 'PASS' : 'FAIL', name, extra); if (!cond) process.exitCode = 1; };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('console.error:', m.text()); });

async function login(code, password) {
  await page.goto(`${BASE}/admin/login`);
  await page.fill('input[autocomplete="username"]', code);
  await page.fill('input[type="password"]', password);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await page.waitForURL(/\/admin\/day\//, { timeout: 15000 });
}

// --- 店舗：読み取り → 保存 → 提出
await login('S001', 'password');
await page.goto(`${BASE}/admin/jibai`);
await page.waitForSelector('text=自賠請求（速報）');
ok('店舗の自賠請求ページが開く', true);
const ym = await page.locator('select').first().inputValue();
console.log('ym =', ym);

if (SHOT) {
  const t0 = Date.now();
  await page.setInputFiles('input[type="file"]', SHOT);
  await page.waitForSelector('tbody tr td input[placeholder="003862a"]', { timeout: 120000 });
  // 読み取りが終わって行が出るまで（未保存バッジ）
  await page.waitForSelector('text=未保存', { timeout: 120000 });
  await page.waitForFunction(() => !document.body.textContent.includes('読み取り中'), null, { timeout: 120000 });
  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  const row = page.locator('tbody tr').first();
  const no = await row.locator('input').nth(0).inputValue();
  const name = await row.locator('input').nth(1).inputValue();
  const days = await row.locator('input').nth(2).inputValue();
  const amount = await row.locator('input').nth(3).inputValue();
  console.log('OCR:', { no, name, days, amount, sec });
  ok('患者番号を読み取れた', no === EXPECT.patientNo, no);
  ok('実日数を読み取れた', days === EXPECT.days, days);
  ok('合計金額を読み取れた', amount === EXPECT.amount, amount);
  ok('氏名が入っている（誤読は確認画面で直す前提）', name.length >= 2, name);
  ok('確認用の切り抜き画像が出る', (await row.locator('img').count()) >= 2);
  await page.screenshot({ path: 'e2e/out-jibai-ocr.png', fullPage: true });
} else {
  await page.getByRole('button', { name: '＋ 手入力で追加' }).click();
  const row = page.locator('tbody tr').first();
  await row.locator('input').nth(0).fill(EXPECT.patientNo);
  await row.locator('input').nth(1).fill('テスト 太郎');
  await row.locator('input').nth(2).fill(EXPECT.days);
  await row.locator('input').nth(3).fill(EXPECT.amount);
}
// 手入力の 2 件目
await page.getByRole('button', { name: '＋ 手入力で追加' }).click();
const row2 = page.locator('tbody tr').nth(1);
await row2.locator('input').nth(0).fill('000001');
await row2.locator('input').nth(1).fill('テスト 花子');
await row2.locator('input').nth(3).fill('12000');
await page.getByRole('button', { name: /変更を保存/ }).click();
await page.waitForSelector('text=保存しました', { timeout: 15000 });
ok('保存できた', true, await page.locator('text=保存しました').textContent());
await page.waitForFunction(() => !document.body.textContent.includes('未保存'));
const total = Number(EXPECT.amount) + 12000;
ok('合計が表示される', (await page.locator('tfoot').textContent()).includes(total.toLocaleString('ja-JP')), await page.locator('tfoot').textContent());

page.once('dialog', (d) => d.accept());
await page.getByRole('button', { name: 'この月を提出する' }).click();
await page.waitForSelector('text=提出済み', { timeout: 15000 });
ok('提出できた', true);
ok('提出後は入力欄が編集不可', await page.locator('tbody tr').first().locator('input').nth(3).isDisabled());
await page.screenshot({ path: 'e2e/out-jibai-submitted.png', fullPage: true });

// 提出済みの月に店舗が保存しようとすると 409
const r409 = await page.evaluate(async (ym) => {
  const r = await fetch('/api/admin/jibai/claims', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ym, claims: [{ patientNo: 'x', amount: 1 }] }) });
  return r.status;
}, ym);
ok('提出済みの月は店舗から保存できない（409）', r409 === 409, String(r409));

// --- 本部：集計 → 明細で経理確認
await page.goto(`${BASE}/api/admin/logout`).catch(() => {});
await login('HQ', HQ_PASSWORD);
await page.goto(`${BASE}/admin/hq/jibai?ym=${ym}`);
await page.waitForSelector('text=全店集計');
const s001 = page.locator('tbody tr', { hasText: 'S001' }).first();
const s001Text = await s001.textContent();
ok('本部集計に S001 の合計が出る', s001Text.includes(total.toLocaleString('ja-JP')) && s001Text.includes('提出済み'), s001Text);
ok('全社合計が出る', (await page.locator('tfoot').textContent()).includes(total.toLocaleString('ja-JP')));
await page.screenshot({ path: 'e2e/out-jibai-hq.png', fullPage: true });

await s001.getByRole('button', { name: '明細・経理確認' }).click();
await page.waitForURL(/\/admin\/jibai/, { timeout: 15000 });
await page.waitForSelector('text=経理確認');
const vrow = page.locator('tbody tr', { has: page.locator(`input[value="${EXPECT.patientNo}"]`) }).first();
await vrow.getByRole('button', { name: '確認', exact: true }).click();
await page.waitForSelector('text=経理確認を登録しました', { timeout: 15000 });
await page.waitForSelector('text=✓ 確定');
ok('本部が経理確認を登録できる', true);
// 2 件目は速報と違う金額で確定 → 差額が出る
const vrow2 = page.locator('tbody tr', { has: page.locator('input[value="000001"]') }).first();
await vrow2.locator('input[placeholder="確定金額"]').fill('12500');
await vrow2.getByRole('button', { name: '確認', exact: true }).click();
await page.waitForSelector('text=差 +500円', { timeout: 15000 });
ok('速報との差額が表示される', true);
await page.screenshot({ path: 'e2e/out-jibai-verify.png', fullPage: true });

await page.goto(`${BASE}/admin/hq/jibai?ym=${ym}`);
await page.waitForSelector('text=全店集計');
const s001b = await page.locator('tbody tr', { hasText: 'S001' }).first().textContent();
ok('本部集計に確定合計と差額が出る', s001b.includes((total + 500).toLocaleString('ja-JP')) && s001b.includes('500'), s001b);

// 氏名の保持期間の設定
await page.locator('input[type="number"]').fill('30');
await page.getByRole('button', { name: '保存' }).click();
await page.waitForSelector('text=保存しました');
ok('氏名の保持期間を保存できる', true);

await browser.close();
console.log('done');
