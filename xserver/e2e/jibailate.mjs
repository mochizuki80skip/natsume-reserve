// Xserver（PHP）版：自賠請求の月遅れ（この月に出した前の月分）と、この月に出した合計（店舗の画面・本部の自賠集計）
// 例：BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... CHROMIUM_PATH=... node e2e/jibailate.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const errs = [];
async function login(code, pass, user) {
  const p = await (await br.newContext({ viewport: { width: 1366, height: 1000 } })).newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  if (user) { await p.goto(`${B}/admin/login`); await p.fill('input[autocomplete="username"]', user); } else await p.goto(`${B}/admin/login/${code}`);
  await p.fill('input[type=password]', pass); await p.click('button[type=submit]'); await p.waitForURL(/admin\//); await p.waitForTimeout(500);
  return p;
}
const api = (p, m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);

const s1 = await login('S001', 'password');
const ym = (await api(s1, 'GET', '/api/admin/jibai'))[1].currentYm;
const [y, m] = ym.split('-').map(Number);
const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
// この月の画面で：この月分 50,000 円・月遅れ（前の月分）30,000 円と 12,000 円
await api(s1, 'PUT', '/api/admin/jibai/claims', { ym, claims: [
  { patientNo: '000101a', patientName: '見本 当月', invoiceYm: ym, days: 6, amount: 50000 },
  { patientNo: '000102b', patientName: '見本 遅一', invoiceYm: prev, days: 4, amount: 30000 },
  { patientNo: '000103c', patientName: '見本 遅二', invoiceYm: prev, days: 2, amount: 12000 },
] });
await s1.goto(`${B}/admin/jibai?ym=${ym}`); await s1.waitForSelector('text=自賠請求（速報）'); await s1.waitForTimeout(800);
const late = await s1.getByLabel('月遅れ（この月に出す分）').textContent();
const sent = await s1.getByLabel('この月に出す合計').textContent();
ok('店舗：月遅れ 2 件 42,000円', late.includes('2 件') && late.includes('42,000円'), late);
ok('店舗：この月に出す合計 3 件 92,000円', sent.includes('3 件') && sent.includes('92,000円'), sent);
ok('店舗：この月分の合計（請求月で集計）は 50,000円', (await s1.locator(`text=分の合計（請求月で集計）`).locator('..').textContent()).includes('50,000円'));
await s1.screenshot({ path: new URL('./out-jibai-late.png', import.meta.url).pathname });

const hq = await login('', process.env.HQ_PASSWORD ?? 'hq-pass', 'HQ');
await hq.goto(`${B}/admin/hq/jibai?ym=${ym}`); await hq.waitForSelector('text=全店集計'); await hq.waitForTimeout(600);
const tds = await hq.locator('tbody tr', { hasText: 'サンプル本店' }).first().locator('td').allTextContents();
ok('本部：速報合計（この月分）50,000', tds[3].includes('50,000'), JSON.stringify(tds));
ok('本部：月遅れ（この月に出した）2件 42,000', tds[7].includes('2件') && tds[7].includes('42,000'), tds[7]);
ok('本部：この月に出した合計 3件 92,000', tds[8].includes('3件') && tds[8].includes('92,000'), tds[8]);
const foot = await hq.locator('tfoot').textContent();
ok('本部：上のまとめにも月遅れ・この月に出した合計', (await hq.getByLabel('全店の月遅れ').textContent()).includes('42,000') && (await hq.getByLabel('全店のこの月に出した合計').textContent()).includes('92,000'));
ok('本部：全店の合計にも月遅れ・この月に出した合計', foot.includes('2件 42,000') && foot.includes('3 件 92,000'), foot);
await hq.goto(`${B}/admin/hq/jibai?ym=${prev}`); await hq.waitForSelector('text=全店集計'); await hq.waitForTimeout(600);
const pt = await hq.locator('tbody tr', { hasText: 'サンプル本店' }).first().locator('td').allTextContents();
ok('本部：前の月の速報合計に月遅れの 42,000 が入る', pt[3].includes('42,000'), JSON.stringify(pt));
await hq.goto(`${B}/admin/hq/jibai?ym=${ym}`); await hq.waitForSelector('text=全店集計');
await hq.screenshot({ path: new URL('./out-jibai-late-hq.png', import.meta.url).pathname });

ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
console.log(process.exitCode ? 'JIBAILATE FAILED' : 'JIBAILATE OK');
