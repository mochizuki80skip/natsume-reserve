// Xserver（PHP）版：交通事故患者様の終了報告（自賠請求のページで何件でも入れて申請 → 本部・管轄MG が月・年ごとに見る）
// 例：BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... CHROMIUM_PATH=... node e2e/accidentend.mjs
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
  await p.fill('input[type=password]', pass); await p.click('button[type=submit]'); await p.waitForURL((u) => !u.pathname.includes('/login')); await p.waitForLoadState('networkidle');
  return p;
}
const api = (p, m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const back = (months) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - months); return d.toISOString().slice(0, 10); };
const s1 = await login('S001', 'password');
{ const id = (await api(s1, 'POST', '/api/admin/karte', { date: back(3) }))[1].row.id; await api(s1, 'PATCH', '/api/admin/karte', { id, patch: { kind: 'ACCIDENT', name: '見本 終了', sex: '♂', age: '42', accidentDate: back(3), accidentNote: '停車中に追突された' } }); }

await s1.goto(`${B}/admin/jibai`); await s1.waitForLoadState('networkidle');
const sec = s1.getByRole('region', { name: '交通事故患者様 終了報告' });
await sec.getByLabel('2ヶ月経過のリストから選ぶ').selectOption({ index: 1 }); await s1.waitForTimeout(800);
const c1 = sec.getByRole('group', { name: '終了報告 1件目' });
ok('2ヶ月経過のリストから選ぶと、氏名・年齢・事故日・事故内容が入る', (await c1.getByLabel('患者氏名').inputValue()) === '見本終了' && (await c1.getByLabel('年齢').inputValue()) === '40代' && (await c1.getByLabel('発生機序').inputValue()).includes('追突') && await c1.getByRole('radio', { name: '男性' }).isChecked());
await sec.getByRole('button', { name: '＋ 患者様を追加' }).click();
await sec.getByRole('button', { name: /申請する（2 件）/ }).click();
ok('未入力があると申請しない（どの件のどの欄か）', (await sec.getByRole('status').textContent()).includes('1件目（見本終了）職業'), await sec.getByRole('status').textContent());
const fill = async (c, name) => {
  if (name) await c.getByLabel('患者氏名').fill(name);
  if (!(await c.getByRole('radio', { name: '男性' }).isChecked())) await c.getByRole('radio', { name: '女性' }).check();
  if (!(await c.getByLabel('年齢').inputValue())) await c.getByLabel('年齢').fill('30代');
  await c.getByLabel('職業').fill('デスクワーク');
  if (!(await c.getByLabel('事故日').inputValue())) await c.getByLabel('事故日').fill(back(4));
  await c.getByLabel('事故発生地域', { exact: true }).fill('見本市の交差点');
  if (!(await c.getByLabel('発生機序').inputValue())) await c.getByLabel('発生機序').fill('信号待ちで追突');
  await c.getByLabel('過失割合').fill('10：0　被害者');
  await c.getByRole('checkbox', { name: '首' }).check(); await c.getByRole('checkbox', { name: '腰' }).check();
  await c.getByLabel('通院期間', { exact: true }).selectOption('3ヶ月');
  await c.getByLabel('1ヶ月目').fill('むち打ち：首を回せない → 筋肉調整 → 60％改善');
  await c.getByLabel('2ヶ月目').fill('首の痛みが軽くなった');
  await c.getByRole('radio', { name: '撮影済み（顔出しNG）' }).check();
  await c.getByRole('radio', { name: '回答済み' }).check();
};
await fill(c1);
ok('通院期間の月数ぶん施術内容の欄が出る（3ヶ月 → 3 つ）', (await c1.getByLabel(/ヶ月目$/).count()) === 3);
await fill(sec.getByRole('group', { name: '終了報告 2件目' }), '見本 二人目');
await s1.screenshot({ path: O + 'accidentend-form.png', fullPage: true });
await sec.getByRole('button', { name: /申請する（2 件）/ }).click(); await s1.waitForTimeout(1200);
ok('まとめて申請できる', (await sec.getByRole('status').textContent()).includes('2 件の終了報告を申請しました'));
ok('申請した方は 2ヶ月経過のリストから外れる', !(await api(s1, 'GET', '/api/admin/accidents/two-months'))[1].rows.some((r) => r.name === '見本終了'));
await s1.reload(); await s1.waitForLoadState('networkidle');
ok('申請したら入力欄は空になる（このパソコンに残さない）', (await sec.getByRole('group', { name: /終了報告 1件目/ }).count()) === 0);
const ym = today.slice(0, 7);
let r = (await api(s1, 'GET', `/api/admin/accident-ends?unit=month&period=${ym}`))[1];
ok('店舗は自分の店舗の報告を見られる（店舗名は自動）', r.rows.length === 2 && r.rows.every((x) => x.storeName === 'サンプル本店') && r.rows[0].months[0].includes('むち打ち') && r.rows[0].months[1] !== '' && r.rows[0].months[2] === '' && r.rows[0].parts === '首・腰', JSON.stringify(r.rows.map((x) => [x.patientName, x.months.length, x.parts])));
ok('必須が欠けた申請はサーバーでも受けない', (await api(s1, 'POST', '/api/admin/accident-ends', { reports: [{ patientName: '見本' }] }))[0] === 400);

// ---- 本部・管轄MG：月ごと・年ごと
const hq = await login('', process.env.HQ_PASSWORD ?? 'hq-pass', 'HQ');
await hq.goto(`${B}/admin/accident-ends`); await hq.waitForLoadState('networkidle');
ok('本部：全店の終了報告（店舗名・件数）', (await hq.getByRole('group', { name: '件数' }).textContent()).includes('2 件') && (await hq.locator('table').textContent()).includes('サンプル本店'));
await hq.getByRole('row', { name: /終了報告 見本終了/ }).getByRole('button', { name: '詳しく' }).click();
ok('詳しく：発生機序・各月の施術内容', (await hq.locator('table').textContent()).includes('むち打ち') && (await hq.locator('table').textContent()).includes('見本市の交差点'));
await hq.getByRole('button', { name: '年ごと' }).click(); await hq.waitForTimeout(600);
ok('年ごと：月ごとの件数も出る', (await hq.getByRole('group', { name: '件数' }).textContent()).includes(`${Number(ym.slice(5))}月 2`));
await hq.screenshot({ path: O + 'accidentend-hq.png', fullPage: true });
ok('Excel で保存', (await hq.evaluate(async (p) => (await fetch(`/api/admin/accident-ends/export?unit=year&period=${p}`)).headers.get('content-type'), ym.slice(0, 4))).includes('spreadsheet'));
await api(hq, 'PUT', '/api/admin/hq/areas', { areas: [{ name: '見本エリア', stores: ['S002'] }] });
await api(hq, 'POST', '/api/admin/hq/accounts', { code: 'mgae', name: '見本 MG', password: 'mgpass123', role: 'mg', area: '見本エリア' });
const mg = await login('', 'mgpass123', 'mgae');
r = (await api(mg, 'GET', `/api/admin/accident-ends?unit=month&period=${ym}`))[1];
ok('MG：全店を見られる・管轄外は取り消せない', r.rows.length === 2 && r.rows.every((x) => !x.canDelete));
ok('MG のメニューに終了報告', (await mg.locator('a[href="/admin/accident-ends"]').count()) >= 1);
// ---- 取り消し（店舗）
ok('店舗は自分の報告を取り消せる', (await api(s1, 'DELETE', '/api/admin/accident-ends', { id: r.rows[1].id }))[0] === 200 && (await api(s1, 'GET', `/api/admin/accident-ends?unit=month&period=${ym}`))[1].rows.length === 1);
ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
console.log(process.exitCode ? 'ACCIDENTEND FAILED' : 'ACCIDENTEND OK');
