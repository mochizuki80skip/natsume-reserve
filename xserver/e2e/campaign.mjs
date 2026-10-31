// Xserver（PHP）版：経路別キャンペーン（ギフトカード・媒体の QR）。予約ページに内容と保険のご負担の目安を出し、区分を選んだ状態で始める。
// 予約には予約したときの内容が残り、予約表に 🎁特典 と店舗向けメモが出る（患者様には店舗向けメモを出さない）
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

// 1) 本部：保険のご負担の目安を直し、ギフトカードのキャンペーンを画面から追加
const hctx = await br.newContext({ viewport: { width: 1366, height: 1000 } });
const hp = await hctx.newPage(); hp.on('pageerror', (e) => errs.push(e.message)); hp.on('dialog', (d) => d.accept());
await hp.goto(`${B}/admin/login`); await hp.fill('input[autocomplete="username"]', 'HQ'); await hp.fill('input[type=password]', process.env.HQ_PASSWORD ?? 'hq-pass');
await hp.click('button[type=submit]'); await hp.waitForURL(/admin\/(hq|overview|day)/);
await hp.goto(`${B}/admin/hq`); await hp.waitForTimeout(1500);
const sec = hp.getByRole('region', { name: '経路別キャンペーン' });
ok('本部にキャンペーンの欄', await sec.isVisible());
ok('保険のご負担の目安のはじめの内容（3割 2,000）', (await sec.getByLabel('金額 1').inputValue()) === '2000');
await sec.getByLabel('金額 1').fill('2,100');
await sec.getByRole('button', { name: '目安を保存' }).click(); await hp.waitForTimeout(800);
ok('目安を保存できる', (await sec.textContent()).includes('保険のご負担の目安を保存しました'));
await sec.getByRole('button', { name: '＋ キャンペーンを追加' }).click();
const form = sec.getByRole('form', { name: 'キャンペーンを追加' });
await form.getByLabel('経路').selectOption('card');
await form.getByLabel('キャンペーン名').fill('初回 骨格・骨盤矯正 無料');
await form.getByLabel('説明').fill('初回の骨格・骨盤矯正が無料になります。\n※別途、保険の自己負担分がかかります。');
await form.getByLabel('はじめから選ぶ区分').selectOption('NEW');
await form.getByLabel('店舗向けメモ').fill(MEMO);
ok('入れながら見え方を確かめられる', (await form.getByRole('note', { name: 'キャンペーンの内容' }).textContent()).includes('2,100円'));
await form.getByRole('button', { name: '保存' }).click(); await hp.waitForTimeout(1000);
await sec.screenshot({ path: new URL('./out-campaign-hq.png', import.meta.url).pathname });
ok('キャンペーンを追加できる', await sec.getByRole('row', { name: /キャンペーン 初回 骨格・骨盤矯正 無料/ }).isVisible());

// 媒体の QR：再来キャンペーン（S002 だけ・再来を選んだ状態で始める）
await api(hp, 'PUT', '/api/admin/hq/referrals', { name: '見本チラシ', kind: 'media', trig: (await api(hp, 'GET', '/api/admin/hq/karte/options'))[1].options.trigger.find((t) => /チラシ|SNS|ホームページ/.test(t)) });
const media = (await api(hp, 'GET', '/api/admin/hq/referrals'))[1].rows.find((r) => r.name === '見本チラシ');
const [st] = await api(hp, 'PUT', '/api/admin/hq/campaigns', { route: `ref:${media.code}`, name: '再来 感謝キャンペーン', description: 'ひさしぶりの方へ', showInsurance: false, presetKind: 'REVISIT', memo: '', stores: ['S002'] });
ok('媒体の QR に店舗をしぼったキャンペーンを付けられる', st === 200);
ok('おかしな区分は保存しない', (await api(hp, 'PUT', '/api/admin/hq/campaigns', { route: 'card', name: 'x', presetKind: 'NOPE' }))[0] === 400);
ok('期間の逆転は保存しない', (await api(hp, 'PUT', '/api/admin/hq/campaigns', { route: 'card', name: 'x', from: '2026-12-10', to: '2026-12-01' }))[0] === 400);
ok('本部以外は使えない', await (async () => { const c = await br.newContext(); const p = await c.newPage(); await p.goto(`${B}/admin/login/S001`); await p.fill('input[type=password]', 'password'); await p.click('button[type=submit]'); await p.waitForURL(/admin\/day/); const r = (await api(p, 'GET', '/api/admin/hq/campaigns'))[0]; await c.close(); return r === 403 || r === 401; })());

// 2) 患者様：経路ごとの表示
const cp = await br.newPage({ viewport: { width: 420, height: 900 } }); cp.on('pageerror', (e) => errs.push(e.message));
await cp.goto(`${B}/s/S001?from=card`); await cp.waitForSelector('table.wk tbody tr', { timeout: 15000 });
const box = cp.getByRole('note', { name: 'キャンペーンの内容' });
const bt = await box.textContent();
ok('ギフトカードから来るとキャンペーンが出る', bt.includes('ギフトカード特典') && bt.includes('初回 骨格・骨盤矯正 無料'), bt);
ok('保険のご負担の目安（直した金額）', bt.includes('3割負担の方') && bt.includes('2,100円') && bt.includes('1割負担の方'));
ok('店舗向けメモは患者様に出さない', !(await cp.content()).includes('見本メモ'));
ok('「はじめて・ケガ・痛み・不調など」を選んだ状態で始まる', (await cp.getByRole('radio', { name: /ケガ・痛み・不調/ }).getAttribute('aria-checked')) === 'true');
ok('ほかの区分に変えられる', await (async () => { await cp.getByRole('radio', { name: /交通事故/ }).click(); return (await cp.getByRole('radio', { name: /交通事故/ }).getAttribute('aria-checked')) === 'true'; })());
await cp.getByRole('radio', { name: /ケガ・痛み・不調/ }).click(); await cp.waitForTimeout(800);
await cp.screenshot({ path: new URL('./out-campaign-booking.png', import.meta.url).pathname });
const plain = await br.newPage(); await plain.goto(`${B}/s/S001`); await plain.waitForSelector('table.wk tbody tr', { timeout: 15000 });
ok('ふつうの予約ページには出ない', (await plain.getByRole('note', { name: 'キャンペーンの内容' }).count()) === 0);
await plain.goto(`${B}/s/S001?ref=${media.code}`); await plain.waitForSelector('table.wk tbody tr', { timeout: 15000 });
ok('選んでいない店舗には出ない', (await plain.getByRole('note', { name: 'キャンペーンの内容' }).count()) === 0);
await plain.goto(`${B}/s/S002?ref=${media.code}`); await plain.waitForSelector('table.wk tbody tr', { timeout: 15000 });
const pt = await plain.getByRole('note', { name: 'キャンペーンの内容' }).textContent();
ok('媒体の QR から選んだ店舗に出る（目安なし）', pt.includes('見本チラシ特典') && pt.includes('再来 感謝キャンペーン') && !pt.includes('負担'), pt);
ok('再来キャンペーンは「1ヶ月以上ぶり」を選んだ状態', (await plain.getByRole('radio', { name: /1ヶ月以上/ }).getAttribute('aria-checked')) === 'true');
await plain.close();

// 3) ギフトカードから予約 → 確認・完了の画面にも出る
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
ok('完了の画面にも出る', (await cp.getByRole('note', { name: 'キャンペーンの内容' }).textContent()).includes('初回 骨格・骨盤矯正 無料'));
await cp.getByRole('link', { name: 'ご予約の確認ページを開く' }).click(); await cp.waitForTimeout(1200);
ok('確認ページにも出る（店舗向けメモなし）', (await cp.getByRole('note', { name: 'キャンペーンの内容' }).count()) === 1 && !(await cp.content()).includes('見本メモ'));

// 4) あとで本部が内容を変えても、入った予約はそのまま
const camp = (await api(hp, 'GET', '/api/admin/hq/campaigns'))[1].rows.find((c) => c.route === 'card');
ok('本部の一覧で予約の数が分かる', camp.reservations === 1, String(camp.reservations));
await api(hp, 'PUT', '/api/admin/hq/campaigns', { ...camp, name: '別のキャンペーン名' });
await api(hp, 'PUT', '/api/admin/hq/insurance', { rows: [{ label: '3割負担', amount: 9999 }] });

// 5) 店舗：予約表に 🎁特典、選ぶと内容と店舗向けメモ。WEB 予約一覧にも出る
const sp = await (await br.newContext({ viewport: { width: 1366, height: 1000 } })).newPage(); sp.on('pageerror', (e) => errs.push(e.message));
await sp.goto(`${B}/admin/login/S001`); await sp.fill('input[type=password]', 'password'); await sp.click('button[type=submit]'); await sp.waitForURL(/admin\/day/);
const resv = (await api(sp, 'GET', '/api/admin/reservations?tab=web'))[1].rows.find((r) => r.name === '見本 特典');
await sp.goto(`${B}/admin/day/${resv.date}`); await sp.waitForTimeout(1500);
const badge = sp.getByLabel(/^キャンペーンの予約：/);
ok('予約表のセルに 🎁特典', (await badge.count()) === 1 && (await badge.textContent()).includes('特典'));
ok('予約したときの名前のまま', (await badge.getAttribute('aria-label')).includes('初回 骨格・骨盤矯正 無料'));
await sp.locator(`td[data-cell="${resv.time}:${resv.bed}"] input`).click(); await sp.waitForTimeout(400);
const det = await sp.getByRole('note', { name: 'この予約のキャンペーン' }).textContent();
await sp.screenshot({ path: new URL('./out-campaign-grid.png', import.meta.url).pathname, clip: { x: 0, y: 0, width: 1366, height: 520 } });
ok('選ぶと内容と店舗向けメモが出る', det.includes('ギフトカード特典：初回 骨格・骨盤矯正 無料') && det.includes(MEMO), det);
ok('金額も予約したときのまま', det.includes('2,100円') && !det.includes('9,999'));
await sp.goto(`${B}/admin/reservations?tab=web`); await sp.waitForTimeout(1200);
ok('WEB 予約一覧に「特典」の列', (await sp.locator('td', { hasText: '🎁 初回 骨格・骨盤矯正 無料' }).count()) >= 1);
await sp.screenshot({ path: new URL('./out-campaign-list.png', import.meta.url).pathname });

ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
console.log(process.exitCode ? 'CAMPAIGN FAILED' : 'CAMPAIGN OK');
