// Xserver（PHP）版：臨時休業（終日・午前・午後）とお知らせ（予約ページ・店舗えらび）、予約表のキャンセル人数
// 例：BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... CHROMIUM_PATH=... node e2e/closure.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003', O = new URL('./', import.meta.url).pathname + 'out-';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const errs = [];
async function login(code, pass, user) {
  const ctx = await br.newContext({ viewport: { width: 1300, height: 1000 } });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  if (user) { await p.goto(`${B}/admin/login`); await p.fill('input[autocomplete="username"]', user); } else await p.goto(`${B}/admin/login/${code}`);
  await p.fill('input[type=password]', pass); await p.click('button[type=submit]'); await p.waitForURL(/admin\//); await p.waitForTimeout(500);
  return p;
}
const api = (p, m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);

// 午前・午後とも受付のある営業日を 2 日（3 日後以降）
const days = [];
{ let s = new Date(); s.setDate(s.getDate() + 3); const first = s.toISOString().slice(0, 10);
  for (let w = 0; w < 4 && days.length < 2; w++, s.setDate(s.getDate() + 7)) {
    const j = await (await fetch(`${B}/api/public/S001/week?start=${s.toISOString().slice(0, 10)}&kind=RETURN`)).json();
    for (const d of j.days) if (days.length < 2 && d.date >= first && d.label === null && d.slots.some((x) => x.time < 720) && d.slots.some((x) => x.time >= 780)) days.push(d.date);
  } }
const [D1, D2] = days;
console.log('days', D1, D2);
const slotsOf = async (d) => (await (await fetch(`${B}/api/public/S001/week?start=${d}&kind=RETURN`)).json()).days.find((x) => x.date === d);

const p = await login('S001', 'password');
await p.goto(`${B}/admin/day/${D1}`); await p.waitForSelector('#grid');
const grp = p.getByRole('group', { name: '臨時休業' });
ok('最初は「なし」', (await grp.getByRole('button', { name: 'なし' }).getAttribute('aria-pressed')) === 'true');
await grp.getByRole('button', { name: '午前' }).click(); await p.waitForTimeout(800);
ok('午前にすると一言を入れるよう知らせる', (await p.textContent('body')).includes('理由を入れてください'));
const d1 = await slotsOf(D1);
ok('午前の臨時休業：午前の枠は患者様に出ない・午後は出る', d1.label === null && !d1.slots.some((x) => x.time < 720) && d1.slots.some((x) => x.time >= 780), JSON.stringify(d1.slots.map((x) => x.time)));
ok('予約表は午前も残る', (await p.locator('#grid tbody tr').filter({ has: p.locator('td', { hasText: /^9:00$/ }) }).count()) === 1);
await grp.locator('input').fill('台風のため'); await grp.locator('input').press('Tab'); await p.waitForTimeout(800);
ok('一言を入れると知らせが消える', !(await p.textContent('body')).includes('理由を入れてください'));
await p.screenshot({ path: O + 'closure-admin.png', clip: { x: 0, y: 0, width: 1300, height: 420 } });

await p.goto(`${B}/admin/day/${D2}`); await p.waitForSelector('#grid');
await p.getByRole('group', { name: '臨時休業' }).getByRole('button', { name: '終日' }).click(); await p.waitForTimeout(800);
const d2 = await slotsOf(D2);
ok('終日の臨時休業：日付の一覧は「臨時休業」', d2.label === '臨時休業', d2.label);
ok('終日でも予約表は出る', (await p.locator('#grid').count()) === 1);

// 予約ページ
const pub = await br.newPage();
await pub.goto(`${B}/s/S001`); await pub.waitForSelector('[aria-label="臨時休業のお知らせ"]');
const note = await pub.locator('[aria-label="臨時休業のお知らせ"]').textContent();
const mdJa = (d) => `${Number(d.slice(5, 7))}月${Number(d.slice(8))}日`;
ok('予約ページにお知らせ（午前・一言）', note.includes(`${mdJa(D1)}`) && note.includes('午前は臨時休業いたします（台風のため）'), note);
ok('予約ページにお知らせ（終日）', note.includes(`${mdJa(D2)}`) && /）は臨時休業いたします。/.test(note), note);
await pub.screenshot({ path: O + 'closure-booking.png', clip: { x: 0, y: 0, width: 1280, height: 320 } });

// 店舗えらび
const hq = await login('', process.env.HQ_PASSWORD ?? 'hq-pass', 'HQ');
await api(hq, 'PUT', '/api/admin/hq/stores-page', { open: true });
const js = await (await fetch(`${B}/api/public-stores`)).json();
const s1 = js.stores.find((s) => s.code === 'S001');
ok('店舗えらびの API に臨時休業', s1.closures.length === 2 && s1.closures[0].part === 'AM' && s1.closures[1].part === null, JSON.stringify(s1.closures));
await pub.setViewportSize({ width: 420, height: 900 });
await pub.goto(`${B}/stores`); await pub.waitForSelector('article');
const card = await pub.locator('article').filter({ hasText: 'サンプル本店' }).textContent();
const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;
ok('店舗のカードに臨時休業の印', card.includes(`${md(D1)}`) && card.includes('午前 臨時休業') && card.includes(`${md(D2)}`), card);
await pub.screenshot({ path: O + 'closure-stores.png', fullPage: false });

// 取り消すとお知らせが消える
await api(p, 'PUT', '/api/admin/days', { date: D1, closedPart: null });
await api(p, 'PUT', '/api/admin/days', { date: D2, closed: false });
const js2 = await (await fetch(`${B}/api/public-stores`)).json();
ok('取り消すとお知らせは出ない', js2.stores.find((s) => s.code === 'S001').closures.length === 0);
ok('おかしな値は受け付けない', (await api(p, 'PUT', '/api/admin/days', { date: D1, closedPart: 'XX' }))[0] === 400);
ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
