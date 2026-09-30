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
  const invoiceYm = await row.locator('select[aria-label="請求月"]').inputValue();
  const days = await row.locator('input').nth(2).inputValue();
  const amount = await row.locator('input').nth(3).inputValue();
  console.log('OCR:', { no, name, invoiceYm, days, amount, sec });
  ok('請求月（令和 年 月）を読み取れた', invoiceYm === (process.env.EXPECT_YM ?? '2026-09'), invoiceYm);
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
await ctx.clearCookies(); // ログアウト（Cookie を消す）
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
const cur = await page.locator('input[type="number"]').inputValue();
await page.locator('input[type="number"]').fill(cur === '45' ? '60' : '45');
await page.getByRole('button', { name: '保存' }).click();
await page.waitForSelector('text=保存しました');
ok('氏名の保持期間を保存できる', true);

// --- 請求月が読み取れない画像：未選択のままでは保存・提出できず、選べば提出できる（S002 で確認）
if (process.env.SHOT_NO_YM) {
  await ctx.clearCookies();
  await page.goto(`${BASE}/admin/login`);
  await page.fill('input[autocomplete="username"]', 'S002');
  await page.fill('input[type="password"]', 'password');
  await page.getByRole('button', { name: 'ログイン' }).click();
  await page.waitForURL(/\/admin\/day\//, { timeout: 15000 });
  await page.goto(`${BASE}/admin/jibai?ym=${ym}`);
  await page.waitForSelector('input[type="file"]', { state: 'attached' });
  await page.setInputFiles('input[type="file"]', process.env.SHOT_NO_YM);
  await page.waitForSelector('text=未保存', { timeout: 120000 });
  await page.waitForFunction(() => !document.body.textContent.includes('読み取り中'), null, { timeout: 120000 });
  const nrow = page.locator('tbody tr').first();
  ok('請求月が読めない画像では未選択になる', (await nrow.locator('select[aria-label="請求月"]').inputValue()) === '');
  ok('未選択の警告が出る', (await page.locator('text=請求月が未選択の明細が 1 件あります').count()) > 0);
  await page.getByRole('button', { name: /変更を保存/ }).click();
  await page.waitForSelector('text=何年何月分かを選んでから保存してください', { timeout: 5000 });
  ok('未選択のままでは保存できない', true);
  ok('未選択のままでは提出ボタンが押せない', await page.getByRole('button', { name: 'この月を提出する' }).isDisabled());
  await nrow.locator('select[aria-label="請求月"]').selectOption(ym);
  await page.getByRole('button', { name: /変更を保存/ }).click();
  await page.waitForSelector('text=保存しました', { timeout: 15000 });
  await page.waitForFunction(() => !document.body.textContent.includes('未保存'));
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'この月を提出する' }).click();
  await page.waitForSelector('text=提出済み', { timeout: 15000 });
  ok('請求月を選べば保存・提出できる', true);
  await page.screenshot({ path: 'e2e/out-jibai-noym.png', fullPage: true });
}

// --- 別の月の画面で登録した明細は、請求月の合計に入る（S002：翌月の画面で当月分を登録）
if (process.env.SHOT_NO_YM) {
  const [yy, mm] = ym.split('-').map(Number);
  const nextYm = mm === 12 ? `${yy + 1}-01` : `${yy}-${String(mm + 1).padStart(2, '0')}`;
  const fmt = (m) => `${Number(m.split('-')[0])}年${Number(m.split('-')[1])}月`;
  await page.goto(`${BASE}/admin/jibai?ym=${nextYm}`);
  await page.waitForSelector('text=自賠請求（速報）');
  await page.getByRole('button', { name: '＋ 手入力で追加' }).click();
  const lr = page.locator('tbody tr').first();
  await lr.locator('input').nth(0).fill('000777');
  await lr.locator('input').nth(1).fill('テスト 遅延');
  await lr.locator('select[aria-label="請求月"]').selectOption(ym);
  await lr.locator('input').nth(3).fill('30000');
  ok('請求月が違う行に「○月の合計に入ります」と出る', (await lr.textContent()).includes(`${fmt(ym)}分として、${fmt(ym)}の合計に入ります`));
  await page.getByRole('button', { name: /変更を保存/ }).click();
  await page.waitForSelector('text=保存しました', { timeout: 15000 });
  await page.waitForFunction(() => !document.body.textContent.includes('未保存'));
  const panel = await page.locator('text=この画面の請求月別の内訳').locator('..').textContent();
  ok('請求月別の内訳に「○月分 何件 何円」が出る', panel.includes(`${fmt(ym)}分`) && panel.includes('1 件') && panel.includes('30,000円'), panel);
  ok('翌月分の合計には含めない', (await page.locator(`text=${fmt(nextYm)}分の合計（請求月で集計）`).locator('..').textContent()).includes('0 件'));
  await page.screenshot({ path: 'e2e/out-jibai-othermonth.png', fullPage: true });
  await page.goto(`${BASE}/admin/jibai?ym=${ym}`);
  await page.waitForSelector(`text=他の月の画面で登録された${fmt(ym)}分`);
  const head = await page.locator(`text=${fmt(ym)}分の合計（請求月で集計）`).locator('..').textContent();
  ok('当月の画面で、別の画面で登録した分を当月の合計に含める', head.includes('2 件') && head.includes((Number(EXPECT.amount) + 30000).toLocaleString('ja-JP')), head);
  // 本部の集計も請求月で合算
  await ctx.clearCookies();
  await login('HQ', HQ_PASSWORD);
  await page.goto(`${BASE}/admin/hq/jibai?ym=${ym}`);
  await page.waitForSelector('text=全店集計');
  const s002 = await page.locator('tbody tr', { hasText: 'S002' }).first().textContent();
  ok('本部集計で、別の画面で登録した分が請求月に合算される', s002.includes((Number(EXPECT.amount) + 30000).toLocaleString('ja-JP')) && s002.includes('他の月の画面で登録 1件'), s002);
  await page.goto(`${BASE}/admin/hq/jibai?ym=${nextYm}`);
  await page.waitForSelector('text=全店集計');
  const s002n = await page.locator('tbody tr', { hasText: 'S002' }).first().textContent();
  ok('翌月の本部集計には入らず「別の月分」と出る', s002n.includes('別の月分 1件') && !s002n.includes('30,000'), s002n);
}

await browser.close();
console.log('done');
