// Xserver（PHP）版：自賠請求の「提出月を変える」。前の月分（10 月分）を今月（11 月）の画面で提出してしまったとき、提出を 10 月へ移す
// 例：BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... CHROMIUM_PATH=... node e2e/jibaimove.mjs
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
const cur = (await api(s1, 'GET', '/api/admin/jibai'))[1].currentYm;
const [y, m] = cur.split('-').map(Number);
const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
const fmt = (ym) => `${Number(ym.slice(0, 4))}年${Number(ym.slice(5))}月`;
// 今月の画面で、前の月分の 2 件を登録して提出してしまった
await api(s1, 'PUT', '/api/admin/jibai/claims', { ym: cur, claims: [
  { patientNo: '000301a', patientName: '見本 遅れ一', invoiceYm: prev, days: 5, amount: 40000 },
  { patientNo: '000302b', patientName: '見本 遅れ二', invoiceYm: prev, days: 3, amount: 25000 },
] });
await api(s1, 'POST', '/api/admin/jibai/submit', { ym: cur, action: 'submit', unclaimed: 0 });
const hq = await login('', process.env.HQ_PASSWORD ?? 'hq-pass', 'HQ');
const before = (await api(hq, 'GET', `/api/admin/hq/jibai?ym=${prev}`))[1].rows.find((r) => r.code === 'S001');
ok('前：本部の前の月は「提出済み」ではない（今月の画面で提出したため）', before.status !== 'SUBMITTED', before.status);
// 店舗の画面で「提出月を変える」
await s1.goto(`${B}/admin/jibai?ym=${cur}`); await s1.waitForSelector('text=自賠請求（速報）'); await s1.waitForTimeout(600);
await s1.getByRole('button', { name: '提出月を変える' }).click();
const g = s1.getByRole('group', { name: '提出月を変える' });
ok('明細の請求月（前の月）をはじめから選んでいる', (await g.getByLabel('移す先の月').inputValue()) === prev);
await s1.screenshot({ path: new URL('./out-jibai-move.png', import.meta.url).pathname });
await g.getByRole('button', { name: '変える' }).click(); await s1.waitForTimeout(1500);
ok('移したあと、前の月の画面を開く', s1.url().includes(`ym=${prev}`) && (await s1.textContent('main')).includes('提出済み'));
const after = (await api(hq, 'GET', `/api/admin/hq/jibai?ym=${prev}`))[1].rows.find((r) => r.code === 'S001');
ok('本部：前の月が「提出済み」・明細 2 件・65,000', after.status === 'SUBMITTED' && after.count === 2 && after.total === 65000 && after.sentCount === 2, JSON.stringify(after));
const now = (await api(hq, 'GET', `/api/admin/hq/jibai?ym=${cur}`))[1].rows.find((r) => r.code === 'S001');
ok('本部：今月は未提出に戻る（明細 0）', now.status !== 'SUBMITTED' && now.sentCount === 0, JSON.stringify(now));
ok('明細は前の月の画面へ移る', (await api(s1, 'GET', `/api/admin/jibai?ym=${prev}`))[1].claims.length === 2);
// 移す先が提出済みなら断る・提出していない月は移せない
await api(s1, 'PUT', '/api/admin/jibai/claims', { ym: cur, claims: [{ patientNo: '000303c', patientName: '見本 今月', invoiceYm: cur, days: 2, amount: 10000 }] });
await api(s1, 'POST', '/api/admin/jibai/submit', { ym: cur, action: 'submit', unclaimed: 0 });
ok('移す先が提出済みなら断る', (await api(s1, 'POST', '/api/admin/jibai/submit', { ym: cur, action: 'move', to: prev }))[0] === 409);
ok('提出していない月は移せない', (await api(s1, 'POST', '/api/admin/jibai/submit', { ym: `${y + 1}-01`, action: 'move', to: cur }))[0] === 400);
ok(`画面の表示（${fmt(prev)}）`, true);
ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
console.log(process.exitCode ? 'JIBAIMOVE FAILED' : 'JIBAIMOVE OK');
