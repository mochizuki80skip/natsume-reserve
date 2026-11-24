// Xserver（PHP）版：URL・QR のきっかけ（C：内訳つきのきっかけも選べる＋その場できっかけを足す）と、ストーリー画像の URL（Instagram ストーリーズ用・全店）
// 例：BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... CHROMIUM_PATH=... node e2e/urltrig.mjs
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
  p.on('pageerror', (e) => errs.push(e.message));
  if (user) { await p.goto(`${B}/admin/login`); await p.fill('input[autocomplete="username"]', user); } else await p.goto(`${B}/admin/login/${code}`);
  await p.fill('input[type=password]', pass); await p.click('button[type=submit]'); await p.waitForURL((u) => !u.pathname.includes('/login')); await p.waitForLoadState('networkidle');
  return p;
}
const api = (p, m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);
const hq = await login('', process.env.HQ_PASSWORD ?? 'hq-pass', 'HQ');
hq.on('dialog', (d) => d.accept(d.type() === 'prompt' ? '公式LINE' : undefined));

// ---- C：内訳つきのきっかけ（紹介他事業／やまがた）
await hq.goto(`${B}/admin/hq`); await hq.waitForLoadState('networkidle');
const sec = hq.getByRole('region', { name: 'WEB 予約の URL・QR' });
await sec.getByRole('button', { name: '＋ URL・QR を作る' }).click();
let form = sec.getByRole('form', { name: 'URL・QR を作る' });
await form.getByLabel('URL の名前').fill('見本 ワンコインのチラシ');
await form.getByLabel('新患継続率のきっかけ').selectOption('紹介他事業');
ok('内訳つきのきっかけは内訳を選ぶまで保存できない', await form.getByRole('button', { name: '保存' }).isDisabled());
await form.getByLabel('きっかけの内訳').selectOption('やまがた');
await form.getByRole('button', { name: '保存' }).click(); await hq.waitForTimeout(1000);
let rows = (await api(hq, 'GET', '/api/admin/hq/campaigns'))[1].rows;
const one = rows.find((r) => r.label === '見本 ワンコインのチラシ');
ok('紹介他事業／やまがたの URL ができる', one?.trig === '紹介他事業' && one.trigDetail === 'やまがた', JSON.stringify(one));
ok('内訳が選択肢にないものは受けない', (await api(hq, 'PUT', '/api/admin/hq/campaigns', { label: 'x1', trig: '紹介他事業', trigDetail: 'ない内訳' }))[0] === 400);
ok('業者紹介は URL では選べない', (await api(hq, 'PUT', '/api/admin/hq/campaigns', { label: 'x2', trig: '業者紹介', trigDetail: 'x' }))[0] === 400);
// ---- C：その場できっかけを足す
await sec.getByRole('button', { name: '＋ URL・QR を作る' }).click();
form = sec.getByRole('form', { name: 'URL・QR を作る' });
await form.getByRole('button', { name: '＋ きっかけを足す' }).click(); await hq.waitForTimeout(1200);
ok('足したきっかけが選ばれている', (await form.getByLabel('新患継続率のきっかけ').inputValue()) === '公式LINE');
ok('新患継続率の集客きっかけにも入る', (await api(hq, 'GET', '/api/admin/hq/karte/options'))[1].options.trigger.includes('公式LINE'));
await hq.screenshot({ path: O + 'urltrig-form.png', fullPage: true });

// ---- 予約 → 新患継続率に キャンペーン／ワンコイン
const s1 = await login('S001', 'password');
let open;
for (let w = 0; w < 3 && !open; w++) { const st = new Date(); st.setDate(st.getDate() + 1 + w * 7); const wk = (await api(s1, 'GET', `/api/public/S001/week?start=${st.toISOString().slice(0, 10)}&kind=NEW`))[1]; open = wk.days.flatMap((d) => d.slots.filter((x) => x.status === 'open').map((x) => [d.date, x.time]))[0]; }
const rv = (await api(s1, 'POST', '/api/public/S001/reserve', { kind: 'NEW', date: open[0], time: open[1], name: '見本 内訳', phone: '09031313199', c: one.code }))[1];
const cell = (await api(s1, 'GET', `/api/admin/day?date=${open[0]}`))[1].data.cells.find((c) => c.text.includes('内訳'));
await api(s1, 'PUT', '/api/admin/visit', { date: open[0], time: open[1], bed: cell.bed, visited: true });
const k = ((await api(s1, 'GET', `/api/admin/karte?month=${open[0].slice(0, 7)}`))[1].rows ?? []).find((r) => r.name.includes('内訳'));
ok('URL から来た初診は きっかけ 紹介他事業・内訳 やまがた', rv.ok && k?.trig === '紹介他事業' && k?.trigDetail === 'やまがた', JSON.stringify(k && [k.trig, k.trigDetail]));
rows = (await api(hq, 'GET', '/api/admin/hq/campaigns'))[1].rows;
ok('URL の一覧の新患にも数える', rows.find((r) => r.label === '見本 ワンコインのチラシ').kartes === 1);

// ---- ストーリー画像の URL（Instagram ストーリーズ用・全店）
await s1.goto(`${B}/admin/story`); await s1.waitForLoadState('networkidle');
const url = await s1.locator('code').first().textContent();
ok('ストーリー画像の URL はストーリーズ用の URL（この店舗の予約ページ）', /\/s\/S001\?c=[a-z0-9]+$/.test(url), url);
const s2 = await login('S002', 'password');
const url2 = (await api(s2, 'GET', '/api/admin/story-url'))[1].url;
ok('全店で同じ印（店舗ごとの予約ページ）', url2.includes('/s/S002?c=') && url2.split('c=')[1] === url.split('c=')[1]);
rows = (await api(hq, 'GET', '/api/admin/hq/campaigns'))[1].rows;
const story = rows.find((r) => r.story);
ok('本部の URL 一覧に「ストーリーズ用・全店」（きっかけは SNS）', !!story && story.trig === 'SNS' && story.stores.length === 0, JSON.stringify(story));
ok('ストーリーズ用の URL は消せない', (await api(hq, 'DELETE', '/api/admin/hq/campaigns', { id: story.id }))[0] === 400);
// 既存の方（通院中）がストーリーから予約 → 既存として数える
const rv2 = (await api(s2, 'POST', '/api/public/S002/reserve', { kind: 'RETURN', cardNo: '77', date: open[0], time: open[1], name: '見本 既存', phone: '09031313198', c: story.code }))[1];
rows = (await api(hq, 'GET', '/api/admin/hq/campaigns'))[1].rows;
const st2 = rows.find((r) => r.story);
ok('既存の方の予約は「既存」として数える', rv2.ok && st2.reservations === 1 && st2.resExisting === 1, JSON.stringify([rv2.ok, st2.reservations, st2.resExisting]));
ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
console.log(process.exitCode ? 'URLTRIG FAILED' : 'URLTRIG OK');
