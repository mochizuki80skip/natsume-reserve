// Xserver（PHP）版：日報（自動で入る数字・店舗の手入力・目標・本部の項目の設定・A4 1 枚の PDF）（S001）
// 例：BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... CHROMIUM_PATH=... node e2e/report.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003', O = new URL('./', import.meta.url).pathname + 'out-';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const errs = [];
async function login(code, pass, user) {
  const p = await (await br.newContext({ viewport: { width: 1300, height: 1000 } })).newPage();
  p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  if (user) { await p.goto(`${B}/admin/login`); await p.fill('input[autocomplete="username"]', user); } else await p.goto(`${B}/admin/login/${code}`);
  await p.fill('input[type=password]', pass); await p.click('button[type=submit]'); await p.waitForURL(/admin\//); await p.waitForLoadState('networkidle');
  return p;
}
const api = (p, m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);
const st = await login('S001', 'password');
// 営業日（月曜〜水曜・金・土のどれか）：今日より前の営業日を 2 日使う
const days = [];
for (let i = 1; days.length < 2 && i < 20; i++) { const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10); const day = (await api(st, 'GET', `/api/admin/day?date=${d}`))[1]?.data; if (day?.times?.length && d.slice(0, 7) === new Date().toISOString().slice(0, 7)) days.push(d); }
const [D, D0] = days;
console.log('days', D, D0);
// 予約表：午前 2 人（初診 1）・午後 1 人（自賠）・自費メニュー 1 人、前の日に 1 人 → 来院チェック
await api(st, 'PUT', '/api/admin/cells', { date: D, cells: [{ time: 540, bed: 1, text: '見本 一（初診）' }, { time: 555, bed: 1, text: '上記初診対応' }, { time: 600, bed: 2, text: '見本 二' }, { time: 900, bed: 1, text: '見本 三（初自）' }] });
await api(st, 'PUT', '/api/admin/cells', { date: D0, cells: [{ time: 540, bed: 1, text: '見本 四（初診）' }] });
for (const [d, t, b] of [[D, 540, 1], [D, 600, 2], [D, 900, 1], [D0, 540, 1]]) await api(st, 'PUT', '/api/admin/visit', { date: d, time: t, bed: b, visited: true });
await api(st, 'PUT', '/api/admin/cell-menus', { date: D, time: 600, bed: 2, menus: ['自費'] });
await api(st, 'PUT', '/api/admin/madoguchi/day', { date: D, patch: { copay: 25200, self: 23100, acu: 1200, goods: 3000, insClaim: 73646 } });
const r1 = (await api(st, 'GET', `/api/admin/report?date=${D}`))[1];
const v = (id) => r1.items.find((x) => x.id === id)?.value;
ok('来院数：午前 2・午後 1・合計 3', v('am') === 2 && v('pm') === 1 && v('total') === 3, JSON.stringify([v('am'), v('pm'), v('total')]));
ok('新患 1・新患（自賠）1・自賠 1・自費 1', v('new') === 1 && v('new-jibai') === 1 && v('jibai') === 1 && v('self') === 1, JSON.stringify([v('new'), v('new-jibai'), v('jibai'), v('self')]));
ok('窓口集計から：窓口計 49,500・保険請求', v('m-total') === 49500 && v('ins-claim') === 73646);
ok('今月の新患（前の日も）2', r1.items.find((x) => x.id === 'p-new').value === 2);
// 画面で手入力（時間外・口コミ・今月の目標）
await st.goto(`${B}/admin/report?date=${D}`); await st.waitForSelector('article[aria-label="日報"]');
await st.getByLabel('本日の時間外').fill('1:05'); await st.getByLabel('本日の時間外').press('Tab'); await st.waitForTimeout(700);
await st.getByLabel('本日の口コミ').fill('２'); await st.getByLabel('本日の口コミ').press('Tab'); await st.waitForTimeout(700);
await st.getByRole('textbox', { name: '今月の目標' }).fill('明るく　素早く　丁寧に'); await st.getByRole('textbox', { name: '今月の目標' }).press('Tab'); await st.waitForTimeout(700);
await api(st, 'PUT', '/api/admin/report/value', { date: D0, item: 'ot-today', value: '0:30' });
const r2 = (await api(st, 'GET', `/api/admin/report?date=${D}`))[1];
const w = (id) => r2.items.find((x) => x.id === id);
ok('時間外は分で残し、今月の合計も出る（1:05＋0:30）', w('ot-today').value === '65' && w('ot-month').value === 95 && w('ot-month').fmt === 'time', JSON.stringify([w('ot-today').value, w('ot-month').value]));
ok('全角の数字も入る（口コミ 2）', w('review-today').value === '2');
ok('今月の目標（月に 1 回の文章）', w('goal').value === '明るく　素早く　丁寧に' && (await api(st, 'GET', `/api/admin/report?date=${D0}`))[1].items.find((x) => x.id === 'goal').value === '明るく　素早く　丁寧に');
ok('自動の欄は入力できない', (await api(st, 'PUT', '/api/admin/report/value', { date: D, item: 'am', value: '9' }))[0] === 400);
ok('時間の形が違うと断る', (await api(st, 'PUT', '/api/admin/report/value', { date: D, item: 'ot-today', value: 'あ' }))[0] === 400);

// 本部：目標を入れる → 差分・達成率
const hq = await login('', process.env.HQ_PASSWORD ?? 'hq-pass', 'HQ');
const ym = D.slice(0, 7);
await hq.goto(`${B}/admin/acct?month=${ym}`); await hq.waitForSelector('section[aria-label="日報の目標"]');
await hq.getByLabel('サンプル本店 新規の目標').fill('50'); await hq.getByLabel('サンプル本店 新規の目標').press('Tab'); await hq.waitForTimeout(700);
await hq.getByLabel('サンプル本店 平均来院数目標の目標').fill('110'); await hq.getByLabel('サンプル本店 平均来院数目標の目標').press('Tab'); await hq.waitForTimeout(700);
const r3 = (await api(st, 'GET', `/api/admin/report?date=${D}`))[1];
const pn = r3.items.find((x) => x.id === 'p-new');
ok('月間成績：目標 50・実績 2・差分 −48', pn.target === 50 && pn.diff === -48, JSON.stringify(pn));
ok('平均来院数目標 110 と達成率', r3.items.find((x) => x.id === 'target-avg').value === 110 && r3.items.find((x) => x.id === 'achieve').value !== null);
ok('店舗は目標を入れられない', (await api(st, 'PUT', '/api/admin/report/targets', { store: 'S001', month: ym, src: 'month.new', value: 1 }))[0] === 403);

// 本部：項目を変える（名前を変え、手入力の項目を足す）
await hq.goto(`${B}/admin/hq`); await hq.waitForSelector('section[aria-label="日報の項目"]');
const ed = hq.locator('section[aria-label="日報の項目"]');
await ed.locator('input[aria-label="項目名"]').nth(2).fill('午前');
await ed.getByRole('button', { name: '＋ 項目を足す' }).click();
await ed.locator('input[aria-label="項目名"]').last().fill('見本の項目');
await ed.getByRole('button', { name: '保存' }).click(); await hq.waitForTimeout(800);
const r4 = (await api(st, 'GET', `/api/admin/report?date=${D}`))[1];
ok('本部が変えた項目が日報に出る', r4.items.find((x) => x.id === 'am').label === '午前' && r4.items.some((x) => x.label === '見本の項目' && x.editable), JSON.stringify(r4.items.slice(2, 3)));
ok('店舗は項目を変えられない', (await api(st, 'PUT', '/api/admin/hq/report-items', { items: [] }))[0] === 403);
ok('おかしな「どこから取るか」は断る', (await api(hq, 'PUT', '/api/admin/hq/report-items', { items: [{ section: 'x', kind: 'value', label: 'x', source: 'evil' }] }))[0] === 400);

// 画面と印刷（A4 1 枚）
await st.goto(`${B}/admin/report?date=${D}`); await st.waitForSelector('article[aria-label="日報"]');
const sheet = await st.locator('article[aria-label="日報"]').textContent();
ok('画面：店舗名・日付・院長の欄・目標', sheet.includes('サンプル本店') && sheet.includes('出勤状況') && sheet.includes('¥49,500') && sheet.includes('1:35'), sheet.slice(0, 160));
await st.screenshot({ path: O + 'report.png', fullPage: true });
await st.emulateMedia({ media: 'print' });
const pdf = await st.pdf({ format: 'A4', printBackground: true });
const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
ok('印刷すると A4 1 枚', pages === 1, `pages=${pages}`);
(await import('node:fs')).writeFileSync(O + 'report.pdf', pdf);
ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
