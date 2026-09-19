// 起動中のサーバー（BASE_URL）に対して顧客予約〜管理画面までを一通り確認する
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3002';
const results = [];
const ok = (name, cond, extra = '') => { results.push([cond ? 'PASS' : 'FAIL', name, extra]); console.log(cond ? 'PASS' : 'FAIL', name, extra); if (!cond) process.exitCode = 1; };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ viewport: { width: 420, height: 860 } });
const page = await ctx.newPage();

// --- 顧客サイト
await page.goto(`${BASE}/s/S001`);
ok('顧客ページ表示', (await page.textContent('h1')).includes('WEB予約'));
await page.waitForSelector('table.wk tbody tr', { timeout: 15000 });
ok('最初の画面が週間一覧', (await page.locator('.wk-head button[aria-pressed="true"]').textContent()).includes('はじめての方'));
// 〇 が無い週なら翌週へ進む
let openSlot = page.locator('td.o button').first();
for (let i = 0; i < 4 && (await openSlot.count()) === 0; i++) {
  await page.getByRole('button', { name: '翌週 ›' }).click();
  await page.waitForTimeout(800);
  openSlot = page.locator('td.o button').first();
}
ok('週間一覧に〇がある', (await openSlot.count()) > 0);
ok('凡例が日付行の上にある', (await page.locator('.wk-head .wk-legend').count()) === 1);
// 来院区分は週間一覧の上で切り替え
await page.getByRole('button', { name: /ご通院中の方/ }).click(); await page.waitForTimeout(600);
ok('②に切り替えられる', (await page.locator('.wk-head button[aria-pressed="true"]').textContent()).includes('ご通院中'));
await page.getByRole('button', { name: /はじめての方/ }).click(); await page.waitForTimeout(800);
openSlot = page.locator('td.o button').first();
for (let i = 0; i < 4 && (await openSlot.count()) === 0; i++) { await page.getByRole('button', { name: '翌週 ›' }).click(); await page.waitForTimeout(800); openSlot = page.locator('td.o button').first(); }
const slotLabel = await openSlot.getAttribute('aria-label');
await openSlot.click();
await page.getByRole('button', { name: 'この日時で予約へ進む' }).click();
await page.waitForSelector('h2');
const dateTitle = await page.textContent('h2');
ok('日時選択', /年.*月.*日/.test(dateTitle), `${dateTitle} (${slotLabel})`);
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
const inputs = ap.locator('#grid tbody input');
const values = await inputs.evaluateAll((els) => els.map((e) => e.value));
ok('予約表に氏名（初）が入る', values.includes('テスト 太郎（初）'));
ok('2枠目に「上記初診対応」が入る', values.includes('上記初診対応'));
// スタッフ登録 → シフト（前休）→ 顧客に見える枠数が午前/午後で変わる
await ap.goto(`${BASE}/admin/settings`);
for (const n of ['山本', '佐々木', '田村']) {
  await ap.fill('input[placeholder="氏名"]', n);
  await ap.getByRole('button', { name: '追加' }).click();
  await ap.waitForTimeout(500);
}
await ap.goto(`${BASE}/admin/shifts?month=${date.slice(0, 7)}`);
await ap.waitForSelector('table');
await ap.selectOption(`select[aria-label="山本 ${date}"]`, 'AM_OFF');
await ap.waitForTimeout(600);
await ap.goto(`${BASE}/admin/day/${date}`);
await ap.waitForSelector('table');
const capText = await ap.locator('text=顧客に見える枠数').first().locator('..').textContent();
ok('シフト(前休)が枠数に反映（午前2/午後3）', /シフトから 2/.test(capText) && /シフトから 3/.test(capText), capText);
const amReserved = async () => Number((await ap.locator('table').first().locator('tr', { hasText: '予約' }).first().locator('td').nth(1).textContent()).trim());
ok('管理側に12:00の行がある', (await ap.locator('#grid tbody td', { hasText: /^12:00$/ }).count()) === 1);
{
  const before = await amReserved();
  const row12 = ap.locator('#grid tbody tr').filter({ has: ap.locator('td', { hasText: /^12:00$/ }) });
  const c = row12.locator('input').nth(2);
  await c.fill('正午さん'); await c.press('Enter');
  await ap.waitForSelector('text=保存しました', { timeout: 10000 });
  const after = await amReserved();
  ok('12:00 の入力は午前の人数に入る', Number(after) === Number(before) + 1, `${before}→${after}`);
}
const wk = await ap.evaluate(async (d) => (await fetch(`/api/public/S001/week?start=${d}&kind=RETURN`)).json(), date);
const dayW = wk.days.find((x) => x.date === date);
ok('顧客側は11:45まで', dayW && !dayW.slots.some((s) => s.time === 720) && dayW.slots.some((s) => s.time === 705));
ok('枠外列が無い', (await ap.locator('#grid thead th').allTextContents()).every((t) => !t.includes('枠外')));
ok('ベッド8列', (await ap.locator('#grid thead tr').last().locator('th').count()) === 9);
ok('人数カウント表示（予約 午前）', Number.isInteger(await amReserved()), String(await amReserved()));

// セル入力 → 保存 → リロードで残る
const firstEmpty = ap.locator('#grid tbody input').filter({ hasNot: ap.locator('[value]') });
const cellInput = ap.locator('#grid tbody tr').nth(2).locator('input').nth(1);
await cellInput.fill('鈴木');
await cellInput.press('Enter');
await ap.waitForSelector('text=保存しました', { timeout: 10000 });
await ap.reload();
await ap.waitForSelector('table');
const after = await ap.locator('#grid tbody tr').nth(2).locator('input').nth(1).inputValue();
ok('セル自動保存', after === '鈴木', after);

// 複数セル貼り付け（タブ・改行区切り）
const target = ap.locator('#grid tbody tr').nth(4).locator('input').nth(0);
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
const r4 = await ap.locator('#grid tbody tr').nth(4).locator('input').nth(1).inputValue();
const r5 = await ap.locator('#grid tbody tr').nth(5).locator('input').nth(0).inputValue();
ok('複数セル貼り付け', r4 === '高橋' && r5 === '田中', `${r4}/${r5}`);
// Excel の B7:L36 相当（時間列＋結合セル5ベッド、12:00 行なし）を 9:00 ベッド1 に貼り付け
{
  const am = Array.from({ length: 12 }, (_, i) => 540 + i * 15), pm = Array.from({ length: 18 }, (_, i) => 900 + i * 15);
  const hm = (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
  const lines = [...am, ...pm].map((t) => {
    const beds = ['', '', '', '✖', '✖'];
    if (t === 540) beds[0] = 'エクセル太郎';
    if (t === 705) beds[1] = '十一時四十五分';
    if (t === 900) beds[2] = '十五時ちょうど';
    if (t === 1095) beds[0] = '十八時十五分';
    return [hm(t), ...beds.flatMap((b) => [b, ''])].join('\t');
  });
  const tsv = lines.join('\r\n') + '\r\n';
  const rowOf0 = (t) => ap.locator('#grid tbody tr').filter({ has: ap.locator('td', { hasText: new RegExp(`^${hm(t)}$`) }) });
  const noonBefore = await rowOf0(720).locator('input').nth(2).inputValue();
  const first = ap.locator('#grid tbody tr').nth(0).locator('input').nth(0);
  await first.focus();
  await ap.evaluate((text) => {
    const dt = new DataTransfer(); dt.setData('text/plain', text);
    document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, tsv);
  await ap.waitForSelector('text=保存しました', { timeout: 10000 });
  await ap.reload(); await ap.waitForSelector('table');
  const rowOf = (t) => ap.locator('#grid tbody tr').filter({ has: ap.locator('td', { hasText: new RegExp(`^${hm(t)}$`) }) });
  const v = async (t, bed) => rowOf(t).locator('input').nth(bed - 1).inputValue();
  ok('Excel貼付: 9:00 ベッド1', (await v(540, 1)) === 'エクセル太郎', await v(540, 1));
  ok('Excel貼付: 結合セル→ベッド2に入る', (await v(705, 2)) === '十一時四十五分', await v(705, 2));
  ok('Excel貼付: 12:00行を飛ばして15:00に入る（12:00は変わらない）', (await v(900, 3)) === '十五時ちょうど' && (await v(720, 3)) === noonBefore, `${await v(900, 3)} / 12:00='${await v(720, 3)}'`);
  ok('Excel貼付: 18:15 ベッド1（午後の後半）', (await v(1095, 1)) === '十八時十五分', await v(1095, 1));
  ok('Excel貼付: ✖ はベッド4に入る', (await v(555, 4)) === '✖' && (await v(555, 6)) === '', `${await v(555, 4)} / bed6='${await v(555, 6)}'`);
}
await ap.screenshot({ path: 'e2e/out-admin-grid.png', fullPage: true });

// WEB予約の取消ボタン → 両セルが消え、顧客側で空きに戻る。消した直後の再読み込みでも保存される
{
  const d2 = '2026-09-25';
  const r1 = await ap.evaluate(async (d) => (await fetch(`/api/public/S001/reserve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'NEW', date: d, time: 600, name: '取消太郎', phone: '09011112222' }) })).json(), d2);
  ok('取消テスト用の予約作成', r1.ok === true, JSON.stringify(r1));
  await ap.goto(`${BASE}/admin/reservations`); await ap.waitForSelector('table');
  ok('WEB予約一覧に表示される', (await ap.locator('table').textContent()).includes('取消太郎'));
  await ap.goto(`${BASE}/admin/day/${d2}`); await ap.waitForSelector('table');
  ok('ベッド番号の上に表示範囲の見出し', (await ap.locator('#grid thead').textContent()).includes('予約サイトに表示') && (await ap.locator('#grid thead').textContent()).includes('非表示'));
  const rowOf = (t) => ap.locator('#grid tbody tr').filter({ has: ap.locator('td', { hasText: new RegExp(`^${t}$`) }) });
  await rowOf('10:00').locator('button[aria-label="メニュー"]').first().click();
  await ap.getByRole('button', { name: /キャンセル（連絡あり）/ }).click();
  await ap.getByRole('button', { name: '名簿へ移す' }).click(); // メモ・次回予約日は空のまま
  await ap.waitForTimeout(800);
  await ap.reload(); await ap.waitForSelector('table');
  const v1 = await rowOf('10:00').locator('input').nth(0).inputValue();
  const v2 = await rowOf('10:15').locator('input').nth(0).inputValue();
  ok('メニューのキャンセルで氏名と2枠目が消える', v1 === '' && v2 === '', `'${v1}' / '${v2}'`);
  const wk2 = await ap.evaluate(async (d) => (await fetch(`/api/public/S001/week?start=${d}&kind=RETURN`)).json(), d2);
  const slot = wk2.days.find((x) => x.date === d2)?.slots.find((s) => s.time === 600);
  ok('取消後は顧客側で空きに戻る', slot && slot.status !== 'closed', JSON.stringify(slot));
  // 文字を消して即 F5
  const c = rowOf('10:30').locator('input').nth(1);
  await c.fill('すぐ消す'); await c.press('Tab'); await ap.waitForSelector('text=保存しました', { timeout: 10000 });
  await c.click(); await ap.keyboard.press('Control+A'); await ap.keyboard.press('Delete');
  await ap.waitForTimeout(100);
  await ap.reload(); await ap.waitForSelector('table');
  await ap.waitForTimeout(500); await ap.reload(); await ap.waitForSelector('table'); // 直前送信分の反映を待って再表示
  ok('消した直後に再読み込みしても消えたまま', (await rowOf('10:30').locator('input').nth(1).inputValue()) === '');
}

// 再来（1ヶ月以上ぶり・診察券あり）→ 予約表に「（再）」と「上記再来対応」
{
  const d3 = '2026-09-26';
  const r = await ap.evaluate(async (d) => (await fetch(`/api/public/S001/reserve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'REVISIT', date: d, time: 600, name: '再来花子', phone: '09033334444', cardNo: '1234' }) })).json(), d3);
  ok('再来の予約作成', r.ok === true, JSON.stringify(r));
  const r0 = await ap.evaluate(async (d) => (await fetch(`/api/public/S001/reserve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'REVISIT', date: d, time: 660, name: '番号なし', phone: '09033334445' }) })).json(), d3);
  ok('再来は診察券番号なしでも予約できる', r0.ok === true, JSON.stringify(r0));
  const r2 = await ap.evaluate(async (d) => (await fetch(`/api/public/S001/reserve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'RETURN', date: d, time: 900, name: '通院中番号なし', phone: '09033334446' }) })).json(), d3);
  ok('通院中は診察券番号が必須', r2.ok !== true && /診察券/.test(r2.error ?? ''), JSON.stringify(r2));
  await ap.goto(`${BASE}/admin/day/${d3}`); await ap.waitForSelector('table');
  const vals = await ap.locator('#grid tbody input').evaluateAll((els) => els.map((e) => e.value));
  ok('予約表に「再来花子（再）」と「上記再来対応」', vals.includes('再来花子（再）') && vals.includes('上記再来対応'));
}

// 来院チェック → 来院人数、キャンセル名簿へ移動 → 枠が空く → 戻す
{
  const d4 = '2026-09-30';
  await ap.evaluate(async (d) => (await fetch(`/api/public/S001/reserve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'NEW', date: d, time: 900, name: '来院確認', phone: '09055556666' }) })).json(), d4);
  await ap.goto(`${BASE}/admin/day/${d4}`); await ap.waitForSelector('table');
  const rowOf = (t) => ap.locator('#grid tbody tr').filter({ has: ap.locator('td', { hasText: new RegExp(`^${t}$`) }) });
  await rowOf('15:00').locator('button[aria-label="来院チェック"]').first().click();
  await ap.waitForTimeout(600);
  await ap.reload(); await ap.waitForSelector('table');
  const visitedCount = await ap.locator('td.text-green-700').nth(1).textContent();
  ok('来院チェック → 午後の来院人数 1', visitedCount.trim() === '1', visitedCount);
  ok('来院チェック済みは2枠目も緑', (await rowOf('15:15').locator('td.bg-green-100').count()) === 1);
  // 名簿へ
  await rowOf('15:00').locator('button[aria-label="メニュー"]').first().click();
  await ap.getByRole('button', { name: /キャンセル（連絡あり）/ }).click();
  await ap.locator('input[placeholder="例）体調不良のため"]').fill('体調不良');
  await ap.locator('input[type="date"]').last().fill('2026-10-01'); // 次回予約日（ダイアログ内）
  await ap.getByRole('button', { name: '名簿へ移す' }).click();
  await ap.waitForTimeout(800);
  await ap.reload(); await ap.waitForSelector('table');
  ok('名簿へ移すとセルが空く', (await rowOf('15:00').locator('input').nth(0).inputValue()) === '' && (await rowOf('15:15').locator('input').nth(0).inputValue()) === '');
  const listText = await ap.locator('h2:has-text("キャンセル名簿")').locator('..').textContent();
  const memoVal = await ap.locator('input[placeholder="メモ"]').first().inputValue();
  ok('キャンセル名簿に載る', /来院確認/.test(listText) && /事前連絡/.test(listText) && /WEB予約/.test(listText) && memoVal === '体調不良', memoVal);
  const nextVal = await ap.locator('h2:has-text("キャンセル名簿") + div input[type="date"]').first().inputValue();
  ok('キャンセル名簿に次回予約日が載る', nextVal === '2026-10-01', nextVal);
  const wk3 = await ap.evaluate(async (d) => (await fetch(`/api/public/S001/week?start=${d}&kind=RETURN`)).json(), d4);
  ok('名簿へ移した枠は顧客側で空き', wk3.days.find((x) => x.date === d4)?.slots.find((s) => s.time === 900)?.status !== 'closed');
  await ap.goto(`${BASE}/admin/reservations?tab=cancel`); await ap.waitForSelector('table');
  ok('ログ画面のキャンセル名簿タブ', (await ap.locator('table').textContent()).includes('来院確認'));
  await ap.goto(`${BASE}/admin/day/${d4}`); await ap.waitForSelector('table');
  await ap.getByRole('button', { name: '予約表に戻す' }).first().click();
  await ap.waitForTimeout(800);
  await ap.reload(); await ap.waitForSelector('table');
  ok('名簿から予約表に戻せる', (await rowOf('15:00').locator('input').nth(0).inputValue()) === '来院確認（初）' && (await rowOf('15:15').locator('input').nth(0).inputValue()) === '上記初診対応');
}

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

// 店舗専用ログインURL（パスワードのみ）
{
  const sp = await browser.newContext(); const spp = await sp.newPage();
  await spp.goto(`${BASE}/admin/login/S001`);
  ok('店舗専用ログイン画面に店舗名', (await spp.textContent('h1')).includes('サンプル本店') && (await spp.locator('input[autocomplete="username"]').count()) === 0);
  await spp.fill('input[type="password"]', 'password');
  await spp.getByRole('button', { name: 'ログイン' }).click();
  await spp.waitForURL(/\/admin\/day\//, { timeout: 15000 });
  ok('店舗専用URLからログインできる', true);
  const r404 = await spp.goto(`${BASE}/admin/login/NOPE`);
  ok('存在しない店舗コードは404', r404.status() === 404);
  await sp.close();
}

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
console.log(process.exitCode ? 'SMOKE FAILED' : 'SMOKE OK');
