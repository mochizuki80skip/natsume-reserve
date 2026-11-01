// Xserver（PHP）版：WEB 予約の URL・QR（集客経路）とキャンペーン。
// 本部で ①名前 ②きっかけ ③店舗 ④キャンペーン の順に作る → 店舗えらび用＋店舗別の URL・QR。キャンペーンを付けると店舗えらびページ・予約ページに出て、
// 決めた区分を選んだ状態で始まる。予約には予約したときの内容が残り、予約表に 🎁特典 と店舗向けメモ（患者様には出さない）。
// キャンペーンなしの URL でも新患継続率のきっかけ・内訳が入る。紹介カード用の古い QR（/stores?from=card）はギフトカードの URL と同じになる。店舗設定にも出る
// 例：BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... CHROMIUM_PATH=... node e2e/campaign.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const errs = [];
const api = (p, m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);
const MEMO = '会計：矯正 0 円＋保険の自己負担（見本メモ）';
const shot = (p, n, o = {}) => p.screenshot({ path: new URL(`./out-${n}.png`, import.meta.url).pathname, ...o }).catch(() => {});

// 1) 本部：保険の目安を直し、ギフトカードの URL（キャンペーンつき）を画面から作る
const hp = await (await br.newContext({ viewport: { width: 1366, height: 1000 } })).newPage(); hp.on('pageerror', (e) => errs.push(e.message)); hp.on('dialog', (d) => d.accept());
await hp.goto(`${B}/admin/login`); await hp.fill('input[autocomplete="username"]', 'HQ'); await hp.fill('input[type=password]', process.env.HQ_PASSWORD ?? 'hq-pass');
await hp.click('button[type=submit]'); await hp.waitForURL(/admin\/(hq|overview|day)/);
await api(hp, 'PUT', '/api/admin/hq/stores-page', { open: true });
await hp.goto(`${B}/admin/hq`); await hp.waitForTimeout(1500);
const sec = hp.getByRole('region', { name: 'WEB 予約の URL・QR' });
ok('本部に URL・QR の欄（媒体の欄は 1 つにまとめた）', await sec.isVisible() && (await hp.getByRole('region', { name: '媒体の専用 QR' }).count()) === 0);
ok('保険の目安のはじめの内容（3割 2,000）', (await sec.getByLabel('金額 1').inputValue()) === '2000');
await sec.getByLabel('金額 1').fill('2,100');
await sec.getByRole('button', { name: '目安を保存' }).click(); await hp.waitForTimeout(800);
ok('目安を保存できる', (await sec.textContent()).includes('保険のご負担の目安を保存しました'));
await sec.getByRole('button', { name: '＋ URL・QR を作る' }).click();
let form = sec.getByRole('form', { name: 'URL・QR を作る' });
ok('名前ときっかけを入れるまで保存できない', await form.getByRole('button', { name: '保存' }).isDisabled());
await form.getByLabel('URL の名前').fill('ギフトカード');
await form.getByLabel('新患継続率のきっかけ').selectOption('ギフトカード');
ok('はじめはキャンペーン「付けない」', (await form.getByRole('radio', { name: '付けない' }).getAttribute('aria-checked')) === 'true' && (await form.getByRole('group', { name: 'キャンペーンの内容' }).count()) === 0);
await form.getByRole('radio', { name: '付ける' }).click();
await form.getByLabel('キャンペーン名').fill('初回 骨格・骨盤矯正 1,000円 → 無料');
await form.getByLabel('説明').fill('初回の骨格・骨盤矯正が無料になります。\n※別途、保険の自己負担分がかかります。');
await form.getByLabel('はじめから選ぶ区分').selectOption('NEW');
await form.getByLabel('店舗向けメモ').fill(MEMO);
ok('入れながら見え方を確かめられる', (await form.getByRole('note', { name: 'キャンペーンの内容' }).textContent()).includes('ギフトカード特典'));
await shot(hp, 'campaign-hq', { clip: await sec.boundingBox() });
await form.getByRole('button', { name: '保存' }).click(); await hp.waitForTimeout(1200);
const giftRow = sec.getByRole('row', { name: 'URL ギフトカード' });
ok('一覧に出る（きっかけ・キャンペーン）', (await giftRow.textContent()).includes('初回 骨格・骨盤矯正 1,000円 → 無料'));
await giftRow.getByRole('button', { name: /URL・QR/ }).click(); await hp.waitForTimeout(800);
const urls = sec.getByRole('region', { name: 'ギフトカード の URL・QR の一覧' });
const all = await urls.locator('code').allTextContents();
const giftStores = all.find((u) => u.includes('/stores?c='));
ok('店舗えらび用と店舗別の URL・QR', !!giftStores && all.some((u) => u.includes('/s/S002?c=')) && (await urls.getByRole('img').count()) >= 3, JSON.stringify(all));
const giftCode = giftStores.split('c=')[1];

// キャンペーンなしの URL（ポータルサイト。S002 だけ）・キャンペーンつき（SNS・再来・S002 だけ）
const [s1] = await api(hp, 'PUT', '/api/admin/hq/campaigns', { label: 'ポータルサイト A', trig: 'その他', stores: ['S002'], hasContent: false });
ok('キャンペーンなしの URL も作れる', s1 === 200);
await api(hp, 'PUT', '/api/admin/hq/campaigns', { label: 'Instagram 広告（冬）', trig: 'SNS', stores: ['S002'], hasContent: true, name: '再来 感謝キャンペーン', description: 'ひさしぶりの方へ', showInsurance: false, presetKind: 'REVISIT' });
const rows = (await api(hp, 'GET', '/api/admin/hq/campaigns'))[1].rows;
const portal = rows.find((r) => r.label === 'ポータルサイト A'), insta = rows.find((r) => r.label === 'Instagram 広告（冬）');
ok('同じ名前は作れない', (await api(hp, 'PUT', '/api/admin/hq/campaigns', { label: 'ギフトカード', trig: 'SNS' }))[0] === 409);
ok('きっかけは必要', (await api(hp, 'PUT', '/api/admin/hq/campaigns', { label: 'x' }))[0] === 400);
ok('キャンペーンを付けるなら名前が必要', (await api(hp, 'PUT', '/api/admin/hq/campaigns', { label: 'y', trig: 'SNS', hasContent: true }))[0] === 400);
ok('期間の逆転は保存しない', (await api(hp, 'PUT', '/api/admin/hq/campaigns', { label: 'z', trig: 'SNS', hasContent: true, name: 'z', from: '2026-12-10', to: '2026-12-01' }))[0] === 400);
ok('本部以外は使えない', await (async () => { const c = await br.newContext(); const p = await c.newPage(); await p.goto(`${B}/admin/login/S001`); await p.fill('input[type=password]', 'password'); await p.click('button[type=submit]'); await p.waitForURL(/admin\/day/); const r = (await api(p, 'GET', '/api/admin/hq/campaigns'))[0]; await c.close(); return r === 403 || r === 401; })());

// 2) 患者様：ギフトカードの店舗えらび用 URL → 見出し「ギフトカードをお持ちの方へ」＋内容 → 店舗の予約ページ
const cp = await br.newPage({ viewport: { width: 420, height: 900 } }); cp.on('pageerror', (e) => errs.push(e.message));
await cp.goto(`${B}/stores?c=${giftCode}`); await cp.waitForSelector('text=ご予約の店舗をお選びください');
const head = await cp.getByRole('region', { name: 'キャンペーンのお知らせ' }).textContent();
ok('店舗えらびページ：ギフトカードをお持ちの方へ＋内容と目安', head.includes('ギフトカードをお持ちの方へ') && head.includes('1,000円 → 無料') && head.includes('2,100円'), head);
await shot(cp, 'campaign-stores', { fullPage: false });
const old = await br.newPage(); await old.goto(`${B}/stores?from=card`); await old.waitForSelector('text=ご予約の店舗をお選びください');
ok('古い紹介カード用の QR も同じ表示', (await old.getByRole('region', { name: 'キャンペーンのお知らせ' }).textContent()).includes('ギフトカードをお持ちの方へ'));
await old.goto(`${B}/stores`); await old.waitForSelector('text=ご予約の店舗をお選びください');
ok('ふつうの店舗えらびページには出ない', (await old.getByRole('region', { name: 'キャンペーンのお知らせ' }).count()) === 0);
await old.goto(`${B}/stores?c=${portal.code}`); await old.waitForSelector('text=ご予約の店舗をお選びください');
ok('店舗をしぼった URL は、その店舗だけ並ぶ（キャンペーンなしは何も出ない）', (await old.locator('article').count()) === 1 && (await old.getByRole('region', { name: 'キャンペーンのお知らせ' }).count()) === 0);
await old.goto(`${B}/s/S001?c=${insta.code}`); await old.waitForSelector('table.wk tbody tr', { timeout: 15000 });
ok('選んでいない店舗の予約ページには出ない', (await old.getByRole('note', { name: 'キャンペーンの内容' }).count()) === 0);
await old.goto(`${B}/s/S002?c=${insta.code}`); await old.waitForSelector('table.wk tbody tr', { timeout: 15000 });
ok('キャンペーンの店舗の予約ページに出る（目安なし）', (await old.getByRole('note', { name: 'キャンペーンの内容' }).textContent()).includes('再来 感謝キャンペーン'));
ok('再来キャンペーンは「1ヶ月以上ぶり」を選んだ状態', (await old.getByRole('radio', { name: /1ヶ月以上/ }).getAttribute('aria-checked')) === 'true');
await old.close();

const href = await cp.locator('article').filter({ hasText: 'サンプル本店' }).getByRole('link', { name: 'WEB 予約' }).getAttribute('href');
ok('予約ページへ印を引き継ぐ', href.includes(`c=${giftCode}`), href);
await cp.goto(B + href); await cp.waitForSelector('table.wk tbody tr', { timeout: 15000 });
const bt = await cp.getByRole('note', { name: 'キャンペーンの内容' }).textContent();
ok('予約ページに出る（ギフトカード特典・目安）', bt.includes('ギフトカード特典') && bt.includes('3割負担の方') && bt.includes('2,100円'), bt);
ok('店舗向けメモは患者様に出さない', !(await cp.content()).includes('見本メモ'));
ok('「はじめて・ケガ・痛み・不調など」を選んだ状態', (await cp.getByRole('radio', { name: /ケガ・痛み・不調/ }).getAttribute('aria-checked')) === 'true');
await shot(cp, 'campaign-booking');

// 3) ギフトカードから予約 → 確認・完了・確認ページにも出る
let slot = cp.locator('td.o button').first();
for (let i = 0; i < 4 && (await slot.count()) === 0; i++) { await cp.getByRole('button', { name: '翌週 ›' }).click(); await cp.waitForTimeout(800); slot = cp.locator('td.o button').first(); }
await slot.click();
await cp.getByRole('button', { name: 'この日時で予約へ進む' }).click(); await cp.waitForSelector('h2');
await cp.fill('input[placeholder*="山田"]', '見本 特典');
await cp.fill('input[type="tel"]', '080' + String(Date.now()).slice(-8));
await cp.getByRole('button', { name: '入力内容を確認する' }).click();
ok('確認の画面にも出る', (await cp.getByRole('note', { name: 'キャンペーンの内容' }).count()) === 1);
await cp.getByRole('button', { name: 'この内容で予約する' }).click();
await cp.waitForSelector('text=ご予約が確定しました');
ok('完了の画面にも出る', (await cp.getByRole('note', { name: 'キャンペーンの内容' }).textContent()).includes('1,000円 → 無料'));
await cp.getByRole('link', { name: 'ご予約の確認ページを開く' }).click(); await cp.waitForTimeout(1200);
ok('確認ページにも出る（店舗向けメモなし）', (await cp.getByRole('note', { name: 'キャンペーンの内容' }).count()) === 1 && !(await cp.content()).includes('見本メモ'));

// 4) あとで本部が内容を変えても、入った予約はそのまま。止めても URL は使える
const gift = (await api(hp, 'GET', '/api/admin/hq/campaigns'))[1].rows.find((c) => c.code === giftCode);
ok('一覧で予約の数が分かる', gift.reservations === 1, String(gift.reservations));
await api(hp, 'PUT', '/api/admin/hq/campaigns', { ...gift, name: '別のキャンペーン名' });
ok('直しても URL（印）は変わらない', (await api(hp, 'GET', '/api/admin/hq/campaigns'))[1].rows.some((c) => c.code === giftCode));
await api(hp, 'PUT', '/api/admin/hq/insurance', { rows: [{ label: '3割負担', amount: 9999 }] });

// 5) 店舗：予約表に 🎁特典、選ぶと内容と店舗向けメモ。WEB 予約一覧にも出る。店舗設定に URL・QR
const sp = await (await br.newContext({ viewport: { width: 1366, height: 1000 } })).newPage(); sp.on('pageerror', (e) => errs.push(e.message));
await sp.goto(`${B}/admin/login/S001`); await sp.fill('input[type=password]', 'password'); await sp.click('button[type=submit]'); await sp.waitForURL(/admin\/day/);
const resv = (await api(sp, 'GET', '/api/admin/reservations?tab=web'))[1].rows.find((r) => r.name === '見本 特典');
await sp.goto(`${B}/admin/day/${resv.date}`); await sp.waitForTimeout(1500);
const badge = sp.getByLabel(/^キャンペーンの予約：/);
ok('予約表のセルに 🎁特典（予約したときの名前）', (await badge.count()) === 1 && (await badge.getAttribute('aria-label')).includes('1,000円 → 無料'));
await sp.locator(`td[data-cell="${resv.time}:${resv.bed}"] input`).click(); await sp.waitForTimeout(400);
const det = await sp.getByRole('note', { name: 'この予約のキャンペーン' }).textContent();
ok('選ぶと内容と店舗向けメモ（金額も予約したときのまま）', det.includes('ギフトカード特典') && det.includes(MEMO) && det.includes('2,100円') && !det.includes('9,999'), det);
await shot(sp, 'campaign-grid', { clip: { x: 0, y: 0, width: 1366, height: 520 } });
await sp.goto(`${B}/admin/reservations?tab=web`); await sp.waitForTimeout(1200);
ok('WEB 予約一覧に「特典」の列', (await sp.locator('td', { hasText: '🎁 初回 骨格・骨盤矯正 1,000円 → 無料' }).count()) >= 1);
// 来院チェック → 新患継続率：きっかけ ギフトカード
await api(sp, 'PUT', '/api/admin/visit', { date: resv.date, time: resv.time, bed: resv.bed, visited: true });
const k1 = ((await api(sp, 'GET', `/api/admin/karte?month=${resv.date.slice(0, 7)}`))[1].rows ?? []).find((r) => r.name.includes('特典'));
ok('新患継続率：きっかけ ギフトカード', k1?.trig === 'ギフトカード', JSON.stringify(k1 && [k1.trig, k1.trigDetail]));
await sp.goto(`${B}/admin/settings`); await sp.waitForTimeout(1500);
const media = await sp.getByRole('region', { name: '媒体別の URL・QR' }).textContent();
ok('店舗設定に、この店舗で使う URL だけ出る', media.includes('ギフトカード') && !media.includes('ポータルサイト A') && media.includes(`/s/S001?c=${giftCode}`), media.slice(0, 200));

// 6) キャンペーンなしの URL（S002）から予約 → 予約表に 🎁 は出ないが、新患継続率は「その他・ポータルサイト A」
const s2 = await (await br.newContext()).newPage();
await s2.goto(`${B}/admin/login/S002`); await s2.fill('input[type=password]', 'password'); await s2.click('button[type=submit]'); await s2.waitForURL(/admin\/day/);
let open;
for (let w = 0; w < 3 && !open; w++) {
  const st = new Date(); st.setDate(st.getDate() + 1 + w * 7);
  const wk = (await api(s2, 'GET', `/api/public/S002/week?start=${st.toISOString().slice(0, 10)}&kind=NEW`))[1];
  open = wk.days.flatMap((d) => d.slots.filter((x) => x.status === 'open').map((x) => [d.date, x.time]))[0];
}
const rv = (await api(s2, 'POST', '/api/public/S002/reserve', { kind: 'NEW', date: open[0], time: open[1], name: '見本 経路', phone: '09031313131', c: portal.code }))[1];
ok('キャンペーンなしの URL から予約（キャンペーンは返らない）', rv.ok && rv.campaign === null, JSON.stringify(rv).slice(0, 160));
const cell = (await api(s2, 'GET', `/api/admin/day?date=${open[0]}`))[1].data.cells.find((c) => c.text.includes('経路'));
ok('予約表に 🎁 は出ない', cell && cell.web && !cell.web.campaign);
await api(s2, 'PUT', '/api/admin/visit', { date: open[0], time: open[1], bed: cell.bed, visited: true });
const k2 = ((await api(s2, 'GET', `/api/admin/karte?month=${open[0].slice(0, 7)}`))[1].rows ?? []).find((r) => r.name.includes('経路'));
ok('新患継続率：きっかけ その他・内訳 ポータルサイト A', k2?.trig === 'その他' && k2?.trigDetail === 'ポータルサイト A', JSON.stringify(k2 && [k2.trig, k2.trigDetail]));
ok('一覧に新患継続率の数', (await api(hp, 'GET', '/api/admin/hq/campaigns'))[1].rows.find((c) => c.code === portal.code).kartes === 1);
// 名前を変えると新患継続率の内訳もそろう
await api(hp, 'PUT', '/api/admin/hq/campaigns', { ...portal, label: 'ポータルサイト B' });
const k3 = ((await api(s2, 'GET', `/api/admin/karte?month=${open[0].slice(0, 7)}`))[1].rows ?? []).find((r) => r.name.includes('経路'));
ok('名前を変えると内訳もそろう', k3?.trigDetail === 'ポータルサイト B', k3?.trigDetail);
// 止めても URL は使える（キャンペーンだけ出ない）
await api(hp, 'PUT', '/api/admin/hq/campaigns', { id: gift.id, active: false });
const pg = await br.newPage(); await pg.goto(`${B}/stores?c=${giftCode}`); await pg.waitForSelector('text=ご予約の店舗をお選びください');
ok('キャンペーンを止めると出ない（URL は開ける）', (await pg.getByRole('region', { name: 'キャンペーンのお知らせ' }).count()) === 0 && (await pg.locator('article').count()) >= 2);
ok('Excel の一覧', (await hp.evaluate(async () => (await fetch('/api/admin/hq/campaigns/export')).headers.get('content-type'))).includes('spreadsheet'));

ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
console.log(process.exitCode ? 'CAMPAIGN FAILED' : 'CAMPAIGN OK');
