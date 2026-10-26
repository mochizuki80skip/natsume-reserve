// Xserver（PHP）版：人員の過不足（全体・エリア別・氏名・院長・入社／退職／異動／休職）と、更新のお知らせの出し分け
// 例：BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... CHROMIUM_PATH=... node e2e/staffing.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003', O = new URL('./', import.meta.url).pathname + 'out-';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const errs = [];
async function login(code, pass, user) {
  const p = await (await br.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  if (user) { await p.goto(`${B}/admin/login`); await p.fill('input[autocomplete="username"]', user); } else await p.goto(`${B}/admin/login/${code}`);
  await p.fill('input[type=password]', pass); await p.click('button[type=submit]'); await p.waitForURL(/admin\//); await p.waitForLoadState('networkidle');
  return p;
}
const api = (p, m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);

const st = await login('S001', 'password');
const add = async (name, role, extra = {}) => { const m = (await api(st, 'POST', '/api/admin/staff-members', { name, role, ...extra }))[1].member; return m.id; };
const a = await add('見本 院長', 'THERAPIST'), b = await add('見本 退職', 'THERAPIST'), c = await add('見本 休職', 'THERAPIST'), d = await add('見本 受付', 'RECEPTION', { joinType: 'NEW', startDate: '2026-11-10' }), e = await add('見本 二番', 'THERAPIST');
await api(st, 'PUT', '/api/admin/staff-members', { id: e, isHead: true });
await api(st, 'PUT', '/api/admin/staff-members', { id: a, isHead: true }); // 院長は 1 人：二番のチェックは外れる
await api(st, 'PUT', '/api/admin/staff-members', { id: b, endDate: '2026-11-20', endReason: 'RETIRE' });
await api(st, 'PUT', '/api/admin/staff-members', { id: c, leaveStart: '2026-11-05', leaveEnd: '2026-11-30' });
ok('休職の終わりが開始より前はだめ', (await api(st, 'PUT', '/api/admin/staff-members', { id: c, leaveEnd: '2026-11-01' }))[0] === 400);
const ms = (await api(st, 'GET', '/api/admin/settings'))[1].members;
ok('院長は 1 店舗に 1 人', ms.filter((m) => m.isHead).map((m) => m.name).join() === '見本 院長', JSON.stringify(ms.map((m) => [m.name, m.isHead])));
await st.goto(`${B}/admin/settings`); await st.waitForSelector('text=スタッフ・シフト');
ok('店舗設定に院長・休職の期間', await st.getByLabel('見本 院長 院長').isChecked() && (await st.getByLabel('見本 休職 休職の開始日').inputValue()) === '2026-11-05' && (await st.getByLabel('見本 退職 終わる理由').inputValue()) === 'RETIRE');

const hq = await login('', process.env.HQ_PASSWORD ?? 'hq-pass', 'HQ');
await api(hq, 'PUT', '/api/admin/hq/areas', { areas: [{ name: '静岡エリア', stores: ['S001'] }, { name: '東部エリア', stores: ['S002'] }] });
await api(hq, 'PUT', '/api/admin/staffing/std', { store: 'S001', therapists: 4, reception: 1 });
await api(hq, 'PUT', '/api/admin/staffing/std', { store: 'S002', therapists: 1, reception: 1 });
const sf = (await api(hq, 'GET', '/api/admin/staffing?month=2026-11'))[1];
const s1 = sf.rows.find((r) => r.code === 'S001');
const names = s1.people.therapist.map((p) => p.name);
ok('氏名：院長が先頭', names[0] === '見本 院長' && s1.people.therapist[0].head, JSON.stringify(names));
const note = (n) => s1.people.therapist.concat(s1.people.reception).find((p) => p.name === n)?.notes.map((x) => x.kind).join();
ok('退職・休職・入社の印', note('見本 退職') === 'retire' && note('見本 休職') === 'leave' && note('見本 受付') === 'join', [note('見本 退職'), note('見本 休職'), note('見本 受付')].join('/'));
ok('休職の期間中は数えない（いちばん少ない日：院長・二番の 2 人＋退職は 20 日まで）', s1.therapist.min === 2 && s1.therapist.start === 4, JSON.stringify(s1.therapist));

await hq.goto(`${B}/admin/staffing?month=2026-11`); await hq.waitForSelector('table[aria-label="人員の過不足"]');
ok('開いたときは全体', (await hq.getByRole('tab', { name: '全体' }).getAttribute('aria-selected')) === 'true');
ok('全体：上にエリアごとのまとめ', await hq.getByLabel('静岡エリアのまとめ').isVisible() && await hq.getByLabel('東部エリアのまとめ').isVisible() && await hq.getByLabel('全体のまとめ').isVisible());
ok('まとめに足りない店舗', (await hq.getByLabel('静岡エリアのまとめ').textContent()).includes('足りない店舗：サンプル本店'));
const nm = await hq.getByLabel('サンプル本店 施術者の氏名').textContent();
ok('氏名と院長・退職・休職の表示', nm.includes('見本 院長院長') && nm.includes('11/20 退職') && nm.includes('休職 11/5〜11/30'), nm);
ok('受付の入社の表示', (await hq.getByLabel('サンプル本店 受付の氏名').textContent()).includes('11/10〜 入社'));
await hq.screenshot({ path: O + 'staffing-all.png', fullPage: true });
await hq.getByRole('tab', { name: 'エリア別' }).click(); await hq.waitForTimeout(300);
const body = await hq.locator('table[aria-label="人員の過不足"] tbody').textContent();
ok('エリア別：エリアの小計の下に店舗', body.indexOf('静岡エリア 計') < body.indexOf('サンプル本店') && body.indexOf('東部エリア 計') < body.indexOf('サンプル駅前院'), body.slice(0, 120));
await hq.screenshot({ path: O + 'staffing-area.png', fullPage: true });

// ---- 更新のお知らせの出し分け
await api(hq, 'POST', '/api/admin/hq/accounts', { code: 'mg1', name: '見本 MG', password: 'mgpass123', role: 'mg', area: '静岡エリア' });
await api(hq, 'POST', '/api/admin/hq/accounts', { code: 'keiri1', name: '見本 経理', password: 'keiripass1', role: 'acct' });
const titles = async (p) => { await p.goto(`${B}/admin/updates`); await p.waitForSelector('h1'); return p.textContent('main'); };
const tStore = await titles(st), tMg = await titles(await login('', 'mgpass123', 'mg1')), tAcct = await titles(await login('', 'keiripass1', 'keiri1'));
ok('店舗には本部だけのお知らせは出ない', !tStore.includes('人員の過不足：全体・エリア別と氏名') && tStore.includes('スタッフに院長'));
ok('管轄MG にはすべて出る', tMg.includes('人員の過不足：全体・エリア別と氏名') && tMg.includes('スタッフに院長'));
ok('経理には経理に関係するものだけ', tAcct.includes('窓口集計（月間窓口表・物販内訳・返戻）') && !tAcct.includes('スタッフに院長') && !tAcct.includes('人員の過不足：全体'));
ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
