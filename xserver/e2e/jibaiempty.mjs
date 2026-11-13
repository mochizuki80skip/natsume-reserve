// Xserver（PHP）版：自賠請求の「請求者なし（0 件で提出）」。店舗の画面のボタンと、本部・管轄MG の自賠集計から店舗ごと・まとめて
// 例：BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... CHROMIUM_PATH=... node e2e/jibaiempty.mjs
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

// S001 は明細あり（請求者なしにはできない）
const s1 = await login('S001', 'password');
const ym = (await api(s1, 'GET', '/api/admin/jibai'))[1].currentYm;
await api(s1, 'PUT', '/api/admin/jibai/claims', { ym, claims: [{ patientNo: '000201a', patientName: '見本 明細', invoiceYm: ym, days: 3, amount: 21000 }] });

// 店舗の画面：明細 0 件の月に「請求者なし（0 件で提出）」
const [y, m] = ym.split('-').map(Number);
const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
await s1.goto(`${B}/admin/jibai?ym=${next}`); await s1.waitForSelector('text=自賠請求（速報）'); await s1.waitForTimeout(600);
const g = s1.getByRole('group', { name: '請求者なしで提出' });
ok('店舗：明細 0 件の月に「請求者なし（0 件で提出）」', await g.getByRole('button', { name: '請求者なし（0 件で提出）' }).isVisible());
// 未請求者数を入れないと提出できない（請求者なしでも入れる。請求できていない方がいれば人数を入れる）
await g.getByRole('button', { name: '請求者なし（0 件で提出）' }).click(); await s1.waitForTimeout(800);
ok('未請求者数が空なら提出できない', (await s1.textContent('main')).includes('未請求者数（請求ができていない') && !(await s1.textContent('main')).includes('提出済み（請求者なし）'));
await s1.getByLabel('未請求者数', { exact: true }).fill('１');
await g.getByRole('button', { name: '請求者なし（0 件で提出）' }).click(); await s1.waitForTimeout(1200);
ok('請求者なしでも未請求者数を残す（全角の 1 も可）', (await s1.getByLabel('提出した未請求者数').textContent()).includes('未請求 1 人'));
ok('店舗：提出済み（請求者なし）と出る', (await s1.textContent('main')).includes('提出済み（請求者なし）'));
await s1.goto(`${B}/admin/jibai?ym=${ym}`); await s1.waitForSelector('text=自賠請求（速報）'); await s1.waitForTimeout(600);
ok('店舗：明細のある月には出ない', (await s1.getByRole('group', { name: '請求者なしで提出' }).count()) === 0);

// 本部：S002（明細 0 件・未提出）を店舗ごとに、まとめての欄にも出る
const hq = await login('', process.env.HQ_PASSWORD ?? 'hq-pass', 'HQ');
await hq.goto(`${B}/admin/hq/jibai?ym=${ym}`); await hq.waitForSelector('text=全店集計'); await hq.waitForTimeout(600);
const bulk = hq.getByRole('group', { name: '請求者なしの店舗' });
const hn = (await api(hq, 'GET', `/api/admin/hq/jibai?ym=${next}`))[1];
ok('本部の自賠集計：店舗が入れた未請求者数と合計', hn.rows.find((r) => r.code === 'S001').unclaimed === 1 && hn.sum.unclaimed === 1, JSON.stringify([hn.rows.map((r) => r.unclaimed), hn.sum.unclaimed]));
await hq.goto(`${B}/admin/hq/jibai?ym=${next}`); await hq.waitForSelector('text=全店集計'); await hq.waitForTimeout(600);
ok('本部の画面に未請求者数の列', (await hq.getByLabel('サンプル本店 の未請求者数').textContent()).includes('1 人') && (await hq.getByLabel('全店の未請求者数').textContent()).includes('1 人'));
await hq.screenshot({ path: new URL('./out-jibai-unclaimed-hq.png', import.meta.url).pathname });
await hq.goto(`${B}/admin/hq/jibai?ym=${ym}`); await hq.waitForSelector('text=全店集計'); await hq.waitForTimeout(600);
ok('本部：明細 0 件・未提出の店舗の欄（S002 だけ）', (await bulk.textContent()).includes('サンプル駅前院') && !(await bulk.textContent()).includes('サンプル本店'));
ok('本部：明細のある店舗には「請求者なし」のボタンがない', (await hq.getByRole('button', { name: 'サンプル本店 を請求者なしにする' }).count()) === 0);
await hq.screenshot({ path: new URL('./out-jibai-empty-hq.png', import.meta.url).pathname });
await hq.getByRole('button', { name: 'サンプル駅前院 を請求者なしにする' }).click(); await hq.waitForTimeout(1200);
const row = await hq.locator('tbody tr', { hasText: 'サンプル駅前院' }).first().textContent();
ok('本部：店舗ごとに「請求者なし」→ 提出済み（請求者なし）', row.includes('提出済み（請求者なし）'), row);
ok('本部：まとめての欄は消える（もうない）', (await hq.getByRole('group', { name: '請求者なしの店舗' }).count()) === 0);
ok('本部：明細のある店舗は API でもしない', (await api(hq, 'POST', '/api/admin/hq/jibai/submit-empty', { ym, stores: ['S001'] }))[1].skipped.includes('S001'));
ok('店舗は本部の操作を使えない', (await api(s1, 'POST', '/api/admin/hq/jibai/submit-empty', { ym, stores: ['S002'] }))[0] === 403);
// 店舗が「提出を取り消す」で戻せる
const s2 = await login('S002', 'password');
await s2.goto(`${B}/admin/jibai?ym=${ym}`); await s2.waitForSelector('text=自賠請求（速報）'); await s2.waitForTimeout(600);
ok('店舗の画面にも提出済み（請求者なし）', (await s2.textContent('main')).includes('提出済み（請求者なし）'));
await s2.getByRole('button', { name: '提出を取り消す' }).click(); await s2.waitForTimeout(1200);
ok('提出を取り消すと戻る', (await s2.getByRole('group', { name: '請求者なしで提出' }).count()) === 1);
// 本部：まとめて
await hq.reload(); await hq.waitForSelector('text=全店集計'); await hq.waitForTimeout(600);
await hq.getByRole('group', { name: '請求者なしの店舗' }).getByRole('button', { name: 'まとめて「請求者なし」にする' }).click(); await hq.waitForTimeout(1200);
ok('本部：まとめて「請求者なし」', (await hq.locator('tbody tr', { hasText: 'サンプル駅前院' }).first().textContent()).includes('提出済み（請求者なし）'));

ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
console.log(process.exitCode ? 'JIBAIEMPTY FAILED' : 'JIBAIEMPTY OK');
