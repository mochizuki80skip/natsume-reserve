// 管理画面のヘッダー（メニュー）が 1 行に収まるか（店舗・本部、画面幅 1366 / 1920）
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003';
const HQPW = process.env.HQ_PASSWORD ?? 'hqpass123';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(browser);
let fail = 0;
const ok = (n, c, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${n} ${d}`); if (!c) fail++; };
for (const role of ['store', 'hq']) {
  for (const w of [1280, 1366, 1920]) {
    const p = await (await browser.newContext({ viewport: { width: w, height: 800 } })).newPage();
    await p.goto(B + (role === 'hq' ? '/admin/login' : '/admin/login/S001'));
    if (role === 'hq') { const code = p.locator('input:not([type=password]):not([type=hidden])').first(); if (await code.count()) await code.fill('HQ'); }
    await p.fill('input[type=password]', role === 'hq' ? HQPW : 'password'); await p.click('button[type=submit]'); await p.waitForURL(/admin\/day/);
    await p.waitForSelector('header nav');
    const need = await p.evaluate(() => { const h = document.querySelector('header > div'); return h.scrollWidth; });
    const m = await p.evaluate(() => { const h = document.querySelector('header > div'); const links = [...h.querySelectorAll('a,button,select')].filter((e) => e.offsetParent); const tops = new Set(links.map((e) => Math.round(e.getBoundingClientRect().top / 8))); return { height: h.getBoundingClientRect().height, rows: tops.size, overflow: document.documentElement.scrollWidth > innerWidth || h.scrollWidth > h.clientWidth }; });
    ok(`${role} ${w}px 1 行`, m.height < 48 && !m.overflow, JSON.stringify({ ...m, need }));
    if (w === 1366) {
      await p.locator('summary', { hasText: 'その他' }).click();
      ok(`${role} その他にログアウト`, await p.getByRole('button', { name: /ログアウト/ }).isVisible());
      await p.getByRole('link', { name: '更新のお知らせ' }).click(); await p.waitForURL(/admin\/updates/);
      ok(`${role} 押したらメニューが閉じる`, !(await p.getByRole('button', { name: /ログアウト/ }).isVisible()));
      await p.goto(B + '/admin/calendar'); await p.waitForURL(/settings\?tab=calendar/);
      ok(`${role} 古いカレンダーの URL は店舗設定のカレンダーへ`, await p.getByRole('tab', { name: /カレンダー/, selected: true }).isVisible());
      await p.getByRole('link', { name: '翌月 ›' }).click(); await p.waitForURL(/tab=calendar&month=/);
      ok(`${role} 翌月もタブの中`, await p.getByRole('tab', { name: /カレンダー/, selected: true }).isVisible() && await p.getByText('日付をクリックしたときの操作').isVisible());
      await p.getByRole('tab', { name: '店舗・スタッフ' }).click(); await p.waitForURL(/admin\/settings$/);
      ok(`${role} 店舗・スタッフのタブ`, await p.getByText('患者一覧').first().isVisible().catch(() => false) || (await p.textContent('main, body')).includes('スタッフ'));
      if (role === 'hq') { await p.locator('summary', { hasText: '本部メニュー' }).click(); await p.getByRole('link', { name: '全店状況' }).click(); await p.waitForURL(/hq\/overview/); ok('hq 本部メニューから全店状況', true); }
    }
    await p.locator('header').screenshot({ path: `e2e/out-nav-${role}-${w}.png` });
  }
}
await browser.close();
process.exit(fail ? 1 : 0);
