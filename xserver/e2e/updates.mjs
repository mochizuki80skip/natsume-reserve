// Xserver（PHP）版：更新のお知らせ（新しい版の帯・一度だけの変更内容・お知らせのページ）の確認（サンプル店舗 S001 を使う）
// 例：BASE_URL=http://127.0.0.1:3003 CHROMIUM_PATH=... node e2e/updates.mjs（public/version.json を一時的に書き換えて元に戻します）
import { createRequire } from 'node:module';
import fs from 'node:fs';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003';
const VJ = new URL('../public/version.json', import.meta.url).pathname;
const original = fs.readFileSync(VJ, 'utf8');
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  const p = await br.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`${B}/admin/login/S001`); await p.fill('input[type=password]', 'password'); await p.click('button[type=submit]'); await p.waitForURL(/admin\/day/);
  const dlg = p.getByRole('dialog', { name: '更新のお知らせ' });
  await dlg.waitFor({ timeout: 15000 });
  const t = await dlg.textContent();
  // version.json の一番新しい日の（店舗向けの）お知らせが出て、古い日のお知らせは出ない
  const notes = JSON.parse(original).notes;
  const newest = notes[0].date;
  const want = notes.filter((n) => n.date === newest && n.audience.includes('店舗')).map((n) => n.title).slice(0, 6); // 画面には 6 件まで
  const old = notes.find((n) => n.date !== newest && n.audience.includes('店舗'))?.title ?? '（なし）';
  ok('初めては一番新しい日のお知らせが出る', want.every((x) => t.includes(x)) && !t.includes(old), `${want.join('／')} ／ 出ないはず：${old}`);
  ok('店舗には本部向けのお知らせを出さない', !t.includes('紹介カードの QR の案内ページ'));
  await dlg.getByRole('button', { name: '確認しました' }).click();
  await p.reload(); await p.waitForSelector('h1'); await p.waitForTimeout(500);
  ok('確認したら二度は出ない', (await p.getByRole('dialog', { name: '更新のお知らせ' }).count()) === 0);
  ok('新しい版でなければ帯は出ない', (await p.getByText('画面が新しくなりました').count()) === 0);
  // 本部が新しい版を入れた（version.json だけ新しくなる）
  const j = JSON.parse(original);
  fs.writeFileSync(VJ, JSON.stringify({ ...j, version: '2099-01-01 00:00', latestId: j.latestId + 1, notes: [{ id: j.latestId + 1, date: '2099-01-01', title: 'テストの新機能', audience: ['店舗'], items: ['新しいボタンを足しました'] }, ...j.notes] }));
  await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await p.getByText('画面が新しくなりました').waitFor({ timeout: 5000 });
  ok('開いたままの画面に帯が出る', true);
  await p.getByRole('button', { name: '変更内容を見る' }).click();
  ok('帯から新しい版の変更内容が見られる', await p.getByText('新しいボタンを足しました').isVisible());
  await p.screenshot({ path: new URL('./out-update-banner.png', import.meta.url).pathname, clip: { x: 0, y: 0, width: 1200, height: 260 } });
  await p.goto(`${B}/admin/updates`); await p.waitForSelector('h1:has-text("更新のお知らせ")');
  ok('お知らせのページ', (await p.textContent('main, body')).includes('予約の移動・コピー・上記初診対応'));
  ok('画面のエラーなし', errs.length === 0, JSON.stringify(errs));
} finally {
  fs.writeFileSync(VJ, original);
  await br.close();
}
