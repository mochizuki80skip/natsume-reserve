// 起動中のサーバー（BASE_URL）に対して顧客予約〜管理画面までを一通り確認する
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3002';
const results = [];
const ok = (name, cond, extra = '') => { results.push([cond ? 'PASS' : 'FAIL', name, extra]); if (!cond) process.exitCode = 1; };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ viewport: { width: 420, height: 860 } });
const page = await ctx.newPage();

// --- 顧客サイト
await page.goto(`${BASE}/s/S001`);
ok('顧客ページ表示', (await page.textContent('h1')).includes('WEB予約'));
await page.getByRole('button', { name: /はじめての方/ }).click();
await page.waitForSelector('text=〇', { timeout: 15000 });
const openDay = page.locator('button:has-text("〇")').first();
const dayNum = (await openDay.textContent()).replace('〇', '').trim();
await openDay.click();
await page.waitForSelector('h2');
const dateTitle = await page.textContent('h2');
ok('日付選択', /年.*月.*日/.test(dateTitle), dateTitle);
const openSlot = page.locator('button:has-text("〇")').first();
await openSlot.waitFor({ timeout: 15000 });
const slotLabel = (await openSlot.textContent()).trim();
await openSlot.click();
await page.fill('input[placeholder*="山田"]', 'テスト 太郎');
await page.fill('input[type="tel"]', '09012345678');
await page.getByRole('button', { name: 'この内容で予約する' }).click();
await page.waitForSelector('text=ご予約が確定しました', { timeout: 15000 });
ok('予約確定', true, `${dateTitle} ${slotLabel}`);
await page.screenshot({ path: 'e2e/out-customer-done.png' });

// 同じ枠が 2 枠使われたか（初回=30分）は管理画面で確認する
// --- 管理画面
const admin = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const ap = await admin.newPage();
await ap.goto(`${BASE}/admin/day/2026-10-21`);
ok('未ログインはログインへ', ap.url().includes('/admin/login'));
await ap.fill('input[autocomplete="username"]', 'S001');
await ap.fill('input[type="password"]', 'password');
await ap.getByRole('button', { name: 'ログイン' }).click();
await ap.waitForURL(/\/admin\/day\//, { timeout: 15000 });
ok('ログイン成功', true, ap.url());

// 予約した日の予約表を開く（dateTitle: 2026年10月21日（水））
const m = dateTitle.match(/(\d+)年(\d+)月(\d+)日/);
const date = `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
await ap.goto(`${BASE}/admin/day/${date}`);
await ap.waitForSelector('table');
const inputs = ap.locator('table tbody input');
const values = await inputs.evaluateAll((els) => els.map((e) => e.value));
ok('予約表に氏名（初）が入る', values.includes('テスト 太郎（初）'));
ok('2枠目に〃が入る', values.includes('〃'));
const countText = await ap.locator('text=午前').first().textContent();
ok('人数カウント表示', /名/.test(countText), countText);

// セル入力 → 保存 → リロードで残る
const firstEmpty = ap.locator('table tbody input').filter({ hasNot: ap.locator('[value]') });
const cellInput = ap.locator('table tbody tr').nth(2).locator('input').nth(1);
await cellInput.fill('鈴木');
await cellInput.press('Enter');
await ap.waitForSelector('text=保存しました', { timeout: 10000 });
await ap.reload();
await ap.waitForSelector('table');
const after = await ap.locator('table tbody tr').nth(2).locator('input').nth(1).inputValue();
ok('セル自動保存', after === '鈴木', after);

// 複数セル貼り付け（タブ・改行区切り）
const target = ap.locator('table tbody tr').nth(4).locator('input').nth(0);
await target.focus();
await ap.evaluate(() => {
  const el = document.activeElement;
  const dt = new DataTransfer();
  dt.setData('text/plain', '佐藤\t高橋\n田中\t伊藤\n');
  el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
});
await ap.waitForSelector('text=保存しました', { timeout: 10000 });
await ap.reload();
await ap.waitForSelector('table');
const r4 = await ap.locator('table tbody tr').nth(4).locator('input').nth(1).inputValue();
const r5 = await ap.locator('table tbody tr').nth(5).locator('input').nth(0).inputValue();
ok('複数セル貼り付け', r4 === '高橋' && r5 === '田中', `${r4}/${r5}`);
await ap.screenshot({ path: 'e2e/out-admin-grid.png', fullPage: true });

// 顧客API に個人情報が含まれない
const slotsJson = await ap.evaluate(async (d) => (await fetch(`/api/public/S001/slots?date=${d}&kind=RETURN`)).text(), date);
ok('顧客APIに氏名なし', !slotsJson.includes('太郎') && !slotsJson.includes('鈴木') && !slotsJson.includes('0901'));

// カレンダー・印刷・設定・本部
await ap.goto(`${BASE}/admin/calendar?month=${date.slice(0, 7)}`);
ok('カレンダー表示', await ap.locator('text=公開').count() > 0);
await ap.goto(`${BASE}/admin/print/${date}`);
ok('印刷ページ', (await ap.textContent('h1')).includes('予約表'));
await ap.screenshot({ path: 'e2e/out-print.png', fullPage: true });
await ap.goto(`${BASE}/admin/hq`);
ok('店舗アカウントは本部画面に入れない', !ap.url().includes('/admin/hq'));

// 本部ログイン
await ap.goto(`${BASE}/api/admin/logout`).catch(() => {});
const hq = await browser.newContext();
const hp = await hq.newPage();
await hp.goto(`${BASE}/admin/login`);
await hp.fill('input[autocomplete="username"]', 'HQ');
await hp.fill('input[type="password"]', process.env.HQ_PASSWORD ?? 'hq-pass');
await hp.getByRole('button', { name: 'ログイン' }).click();
await hp.waitForURL(/\/admin\/day\//, { timeout: 15000 });
await hp.goto(`${BASE}/admin/hq`);
ok('本部画面', (await hp.textContent('h1')).includes('本部管理'));
ok('店舗切替セレクト', await hp.locator('select[name="store"]').count() === 1);

await browser.close();
for (const [s, n, x] of results) console.log(s, n, x);
console.log(process.exitCode ? 'SMOKE FAILED' : 'SMOKE OK');
