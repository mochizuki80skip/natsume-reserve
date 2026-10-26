// Xserver（PHP）版：「使い方」ガイド（開いていた画面の記事・記事・画像・調べる）（サンプル店舗 S001）
// 例：BASE_URL=http://127.0.0.1:3003 CHROMIUM_PATH=... node e2e/guide.mjs
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003', O = new URL('./', import.meta.url).pathname + 'out-';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const p = await br.newPage({ viewport: { width: 1366, height: 900 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
await p.goto(B + '/admin/login/S001'); await p.fill('input[type=password]', 'password'); await p.click('button[type=submit]'); await p.waitForURL(/admin\/day/);

// 1) 予約表から「使い方」→ 予約表の記事が上に出る
await p.getByRole('navigation').getByRole('link', { name: '使い方', exact: true }).click();
await p.waitForURL(/admin\/guide\?from=/);
await p.getByText('いま開いていた画面（予約表）の使い方').waitFor({ timeout: 5000 }).catch(() => {});
ok('開いていた画面の記事', await p.getByText('いま開いていた画面（予約表）の使い方').isVisible());
ok('目次にカテゴリ', (await p.textContent('main')).includes('こまったとき') && (await p.textContent('main')).includes('WEB 予約'));
await p.screenshot({ path: O + 'guide-top.png' });

// 2) 記事を開く：手順・画像・あわせて読む
await p.getByRole('button', { name: '電話予約を入れる（氏名・電話番号）' }).first().click();
await p.waitForURL(/a=phone/);
const img = p.locator('article img').first();
await img.waitFor();
ok('画面の写真が出る', await img.evaluate((el) => el.complete && el.naturalWidth > 100));
ok('手順の番号', (await p.locator('article ol li').count()) === 3);
await p.screenshot({ path: O + 'guide-article.png', fullPage: true });
await p.getByRole('button', { name: '予約を探す（氏名・診察券番号）' }).click();
ok('あわせて読むから別の記事へ', /a=find/.test(p.url()));
await p.getByRole('link', { name: '← もとの画面に戻る' }).click();
ok('もとの画面に戻る', /admin\/day\//.test(p.url()));

// 3) 調べる
await p.goto(B + '/admin/guide');
await p.getByLabel('使い方を調べる').fill('無断');
ok('言葉で調べる（本文の中も）', await p.getByRole('button', { name: 'キャンセル・予約変更' }).isVisible());
ok('見つかった言葉に色', (await p.locator('mark').count()) > 0);
await p.getByLabel('使い方を調べる').fill('あいうえおかきくけこ');
ok('見つからないとき', await p.getByText('見つかりませんでした').isVisible());

// 4) 店舗設定から開くと店舗設定の記事
await p.goto(B + '/admin/settings'); await p.waitForSelector('text=スタッフ・シフト'); await p.getByRole('navigation').getByRole('link', { name: '使い方', exact: true }).click(); await p.waitForURL(/from=%2Fadmin%2Fsettings/);
await p.getByText('いま開いていた画面（店舗設定）の使い方').waitFor({ timeout: 5000 }).catch(() => {});
ok('店舗設定の記事', await p.getByText('いま開いていた画面（店舗設定）の使い方').isVisible());

// 5) 記事の画像がすべて public/guide/ にある
const src = readFileSync(new URL('../frontend/src/lib/guide.ts', import.meta.url), 'utf8');
const imgs = [...src.matchAll(/img: '([^']+)'/g)].map((m) => m[1]);
const lost = imgs.filter((f) => !existsSync(new URL(`../public/guide/${f}`, import.meta.url)));
ok('記事の画像がそろっている', imgs.length > 20 && lost.length === 0, lost.join(','));
ok('ページのエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
