// Xserver（PHP）版：SNS 投稿管理の画面を一通り操作して確認する
// 例：cd xserver && node e2e/sns-mock.mjs &  PHP_CLI_SERVER_WORKERS=4 php -S 127.0.0.1:3003 -t public dev-router.php &
//     BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... node e2e/sns.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3003';
const HQ_PASSWORD = process.env.HQ_PASSWORD ?? 'hq-pass-local';
const TITLE = `E2E 見出し ${Date.now().toString(36)}`;
const ok = (name, cond, extra = '') => { console.log(cond ? 'PASS' : 'FAIL', name, extra); if (!cond) process.exitCode = 1; };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => d.accept('')); // confirm / prompt は OK で進める
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

// ログイン（本部）
await page.goto(`${BASE}/admin/login`);
await page.fill('input[autocomplete="username"]', 'HQ');
await page.fill('input[type="password"]', HQ_PASSWORD);
await page.getByRole('button', { name: 'ログイン' }).click();
await page.waitForURL(/\/admin\/day\//, { timeout: 15000 });
ok('本部ログイン', true);

// ナビから SNS 投稿へ
await page.click('text=SNS投稿');
await page.waitForURL(/\/admin\/sns$/);
await page.waitForSelector('h1:has-text("確認待ち")');
ok('SNS ホームが開く', (await page.textContent('body')).includes('承認待ちの下書き'));
ok('本部メニューに SNS管理がある', (await page.locator('a:has-text("SNS管理（本部）")').count()) === 1);

// 本部の SNS 管理
await page.click('a:has-text("SNS管理（本部）")');
await page.waitForSelector('h1:has-text("SNS 管理（本部）")');
const hqText = await page.textContent('body');
ok('接続状況が表示される', hqText.includes('APP_URL') && hqText.includes('CRON_SECRET'));
ok('店舗ごとの状態の表がある', hqText.includes('店舗ごとの状態'));
await page.click('button:has-text("拠点を読み込む")');
await page.waitForSelector('text=拠点を読み込みました', { timeout: 15000 });
ok('Google の拠点を読み込める（モック）', true);
await page.fill('input[type="number"][min="7"]', '45');
await page.click('button:has-text("共通設定を保存")');
await page.waitForSelector('text=共通設定を保存しました');
ok('共通設定を保存', true);

// 店舗の設定
await page.goto(`${BASE}/admin/sns/settings?store=S002`);
await page.waitForSelector('h1:has-text("SNS 設定")');
await page.check('input[type="checkbox"] >> nth=0');
await page.fill('input[placeholder="#なつめ接骨院 #沼津 #接骨院"]', '#なつめ接骨院 #駅前');
const areaInput = page.getByRole('textbox', { name: '地域（例：沼津市）' });
await areaInput.fill('沼津市');
await page.click('button:has-text("保存")');
await page.waitForSelector('text=保存しました');
ok('店舗の SNS 設定を保存', true);
await page.click('button:has-text("Instagram の見本")');
await page.waitForSelector('text=Instagram の見本（');
ok('投稿文の見本が出る', (await page.textContent('pre')).includes('サンプル駅前院'));

// ネタ
await page.goto(`${BASE}/admin/sns/topics?store=S002`);
await page.waitForSelector('h1:has-text("ネタ")');
await page.fill('input[placeholder^="見出し"]', TITLE);
await page.fill('textarea[placeholder^="本文"]', 'E2E の本文です。温めて動かすことが大切です。');
await page.click('button:has-text("追加")');
await page.waitForSelector('text=ネタを追加しました');
ok('ネタを追加', (await page.textContent('body')).includes(TITLE));

// 下書きを作って一覧へ
await page.goto(`${BASE}/admin/sns?`);
await page.waitForSelector('h1:has-text("確認待ち")');
await page.goto(`${BASE}/admin/sns/posts?store=S002&new=1`);
await page.waitForSelector('text=手で下書きを追加');
const nf = page.locator('form:has(button:has-text("下書きを作る"))');
await nf.locator('select').nth(0).selectOption('ig');
const dt = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10) + 'T18:00';
await nf.locator('input[type="datetime-local"]').fill(dt);
const topicSel = nf.locator('select').nth(1);
const opts = await topicSel.locator('option').allTextContents();
ok('ネタの選択肢に追加したネタがある', opts.some((o) => o.includes(TITLE)));
await topicSel.selectOption({ index: opts.findIndex((o) => o.includes(TITLE)) });
await page.click('button:has-text("下書きを作る")');
await page.waitForSelector(`a:has-text("${TITLE}")`);
ok('一覧に下書きが出る', (await page.textContent('table')).includes(TITLE));
await page.click('button:has-text("カレンダー")');
await page.waitForSelector('text=色：灰＝下書き');
ok('カレンダー表示', true);
await page.click('button:has-text("一覧")');
await page.click(`a:has-text("${TITLE}")`);
await page.waitForSelector('h2:has-text("画像")');

// 詳細：承認は画像なしでも手動モードなら可。ここは API 連携なし店舗（S002）なので手動
const body1 = await page.textContent('body');
ok('手動投稿の表示（S002 は未連携）', body1.includes('手動投稿'));
await page.click('button:has-text("別のパターン")');
await page.waitForSelector('text=別のパターンにしました');
ok('別のパターン', true);
await page.click('button:has-text("この定型画像を使う")');
await page.waitForSelector('text=定型画像を保存しました', { timeout: 15000 });
ok('定型画像を保存', (await page.locator('img[alt="投稿画像"]').count()) === 1);
await page.fill('label:has-text("本文") textarea', 'E2E の本文です。必ず治ります。');
ok('入力中に禁止語の警告が出る', (await page.textContent('body')).includes('広告規制で使わない語：必ず、治り'));
await page.fill('label:has-text("本文") textarea', 'E2E の本文です。温めて動かすことが大切です。');
if (await page.locator('button:has-text("承認する")').isDisabled()) { await page.click('button:has-text("保存")'); await page.waitForSelector('text=保存しました'); }
await page.click('button:has-text("承認する")');
await page.waitForSelector('text=承認しました');
ok('承認できる', (await page.textContent('body')).includes('承認済み'));
await page.click('button:has-text("投稿した（手動）")');
await page.waitForSelector('text=投稿済みにしました');
ok('手動で投稿した記録', (await page.textContent('body')).includes('投稿日時'));

// 分析
await page.goto(`${BASE}/admin/sns/insights?detail=S001`);
await page.waitForSelector('h1:has-text("分析")');
const ins = await page.textContent('body');
ok('分析の表と詳細', ins.includes('サンプル本店 の詳しい内容') && ins.includes('気づき'));
ok('CSV のリンク', (await page.locator('a:has-text("CSV で書き出し")').count()) === 1);

// 店舗アカウントでログインして自店舗だけ見えること
await ctx.clearCookies();
await page.goto(`${BASE}/admin/login/S002`);
await page.fill('input[type="password"]', 'password');
await page.getByRole('button', { name: 'ログイン' }).click();
await page.waitForURL(/\/admin\/day\//, { timeout: 15000 });
await page.goto(`${BASE}/admin/sns`);
await page.waitForSelector('h1:has-text("確認待ち")');
ok('店舗には SNS管理（本部）が出ない', (await page.locator('a:has-text("SNS管理（本部）")').count()) === 0);
await page.goto(`${BASE}/admin/sns/insights`);
await page.waitForSelector('h1:has-text("分析")');
const own = await page.textContent('body');
ok('店舗の分析は自店舗だけ', own.includes('サンプル駅前院') && !own.includes('サンプル本店'));

ok('コンソールエラーなし', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
