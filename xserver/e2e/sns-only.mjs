// SNS 投稿管理だけの設置（config.php の APP_MODE = 'sns'）で、予約の画面・API が出ないことを確認する
// 例：config.php に 'APP_MODE' => 'sns', 'BOOKING_URL' => 'https://yoyaku.example.jp' を入れて PHP を起動してから
//     BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... node e2e/sns-only.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3003';
const HQ_PASSWORD = process.env.HQ_PASSWORD ?? 'hq-pass-local';
const ok = (name, cond, extra = '') => { console.log(cond ? 'PASS' : 'FAIL', name, extra); if (!cond) process.exitCode = 1; };

const html = await (await fetch(`${BASE}/admin/login`)).text();
ok('画面に APP_MODE=sns が渡される', html.includes('window.APP_MODE="sns"'));
ok('予約の API は出ない', (await fetch(`${BASE}/api/public/S001/week?kind=NEW`)).status === 404);
ok('店舗名の取得（店舗別ログイン用）は残る', (await fetch(`${BASE}/api/public/S001/store`)).status === 200);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await (await browser.newContext()).newPage();
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`${BASE}/`); await page.waitForURL(/\/admin\/login/);
ok('トップはログインへ', (await page.textContent('h1')).includes('SNS投稿管理'));
await page.fill('input[autocomplete="username"]', 'HQ'); await page.fill('input[type="password"]', HQ_PASSWORD); await page.getByRole('button', { name: 'ログイン' }).click();
await page.waitForURL(/\/admin\/sns$/);
ok('ログイン後は SNS ホーム', true);
const nav = (await page.locator('header nav').textContent()).replace(/\s+/g, '');
const side = (await page.locator('aside').textContent()).replace(/\s+/g, '');
ok('メニューに予約表・シフト・自賠請求が無い', !nav.includes('予約表') && !nav.includes('シフト') && !nav.includes('自賠'));
ok('左メニューにホーム・手動投稿・カレンダー・店舗の下書き・接続状況がある', side.includes('ホーム') && side.includes('手動投稿') && side.includes('カレンダー') && side.includes('店舗の下書き') && side.includes('接続状況'));
ok('ヘッダーに店舗設定・店舗管理がある', nav.includes('店舗設定') && nav.includes('店舗管理'));
await page.goto(`${BASE}/admin/hq`); await page.waitForSelector('h1:has-text("店舗管理")');
ok('店舗管理に共通設定（営業時間）が無い', (await page.locator('text=全店共通設定').count()) === 0);
ok('店舗をまとめて登録がある', (await page.locator('text=店舗をまとめて登録').count()) === 1);
await page.goto(`${BASE}/admin/settings`); await page.waitForSelector('h1');
ok('店舗設定にベッド数などが無い', (await page.locator('text=ベッド数').count()) === 0);
await page.goto(`${BASE}/s/S001`); await page.waitForURL(/\/admin\/login/);
ok('顧客の予約ページはログインへ転送', true);
const r = await (await fetch(`${BASE}/api/admin/sns/settings?store=S001`, { headers: { cookie: (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ') } })).json();
ok('{予約URL} は BOOKING_URL のもの', typeof r.store?.bookingUrl === 'string' && !r.store.bookingUrl.startsWith(BASE), r.store?.bookingUrl ?? '');
ok('コンソールエラーなし', errors.length === 0, errors.join(' | '));
await browser.close();
