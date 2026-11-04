// Xserver（PHP）版：自賠請求の提出のお知らせ。その月の最終営業日から提出するまで（締め切り：翌月 5 日）、ログインしたあと 1 日 1 回知らせ、
// メニューに印を出す（店舗：自賠請求に「!」／本部・管轄MG：自賠集計に未提出の店舗の数）。提出（請求者なしも）すると出なくなる
// 例：BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... CHROMIUM_PATH=... node e2e/jibaialert.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
// skipWhatsNew は自賠請求のお知らせも「見た」にするので使わず、更新のお知らせ・ブロックの提案だけ見たことにする
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const errs = [];
async function login(code, pass, user) {
  const ctx = await br.newContext({ viewport: { width: 1366, height: 1000 } });
  // このテストでは、自賠請求のお知らせを「まだ見ていない」にする
  await ctx.addInitScript(() => { try { localStorage.setItem('natsume.seenChangeId', '99999'); const t = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); for (let i = 1; i <= 9; i++) localStorage.setItem(`natsume.blockSuggest.S00${i}.${t}`, '1'); } catch { /* */ } });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  if (user) { await p.goto(`${B}/admin/login`); await p.fill('input[autocomplete="username"]', user); } else await p.goto(`${B}/admin/login/${code}`);
  await p.fill('input[type=password]', pass); await p.click('button[type=submit]'); await p.waitForURL(/admin\//); await p.waitForTimeout(1200);
  return p;
}
const api = (p, m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);

const s1 = await login('S001', 'password');
const me = (await api(s1, 'GET', '/api/admin/me'))[1];
const a = me.jibaiAlert;
ok('店舗：未提出の月と締め切り（翌月 5 日）', a && /^\d{4}-\d{2}$/.test(a.ym) && a.deadline.endsWith('-05') && a.deadline > `${a.ym}-28`, JSON.stringify(a));
// 今月の最終営業日より前なら前の月、最終営業日からは今月
const cur = me.today.slice(0, 7);
ok('前の月か今月の分', a.ym === cur || a.ym < cur);
const dlg = s1.getByRole('alertdialog', { name: '自賠請求の提出のお知らせ' });
const dt = await dlg.textContent();
ok('ログインしたらお知らせが出る（○月分・締め切り・請求者なしの案内）', dt.includes(`${Number(a.ym.slice(0, 4))}年${Number(a.ym.slice(5))}月分`) && dt.includes('締め切') && dt.includes('請求者なし'), dt.slice(0, 160));
await s1.screenshot({ path: new URL('./out-jibai-alert.png', import.meta.url).pathname });
ok('メニューの「自賠請求」に「!」', (await s1.getByLabel('自賠請求の未提出').count()) >= 1);
await dlg.getByRole('button', { name: 'あとで' }).click(); await s1.waitForTimeout(300);
await s1.reload(); await s1.waitForTimeout(1200);
ok('「あとで」で閉じると、今日はもう出ない（印は残る）', (await s1.getByRole('alertdialog', { name: '自賠請求の提出のお知らせ' }).count()) === 0 && (await s1.getByLabel('自賠請求の未提出').count()) >= 1);

// 本部・管轄MG：未提出の店舗の一覧
const hq = await login('', process.env.HQ_PASSWORD ?? 'hq-pass', 'HQ');
const hd = hq.getByRole('alertdialog', { name: '自賠請求の提出のお知らせ' });
const ht = await hd.textContent();
ok('本部：未提出の店舗の一覧（2 店舗）', ht.includes('2 店舗') && ht.includes('サンプル本店') && ht.includes('サンプル駅前院'), ht.slice(0, 200));
await hq.screenshot({ path: new URL('./out-jibai-alert-hq.png', import.meta.url).pathname });
await hd.getByRole('button', { name: '自賠集計を開く' }).click(); await hq.waitForURL(/hq\/jibai/);
ok('本部：「自賠集計を開く」で移る', true);
ok('本部：自賠集計に未提出の数', (await hq.getByLabel('自賠請求の未提出 2 店舗').count()) >= 1);
await api(hq, 'PUT', '/api/admin/hq/areas', { areas: [{ name: '見本エリア', stores: ['S002'] }] });
await api(hq, 'POST', '/api/admin/hq/accounts', { code: 'mg1', name: '見本 MG', password: 'mgpass123', role: 'mg', area: '見本エリア' });
const mg = await login('', 'mgpass123', 'mg1');
const mt = await mg.getByRole('alertdialog', { name: '自賠請求の提出のお知らせ' }).textContent();
ok('管轄MG：管轄の店舗だけ', mt.includes('サンプル駅前院') && !mt.includes('サンプル本店') && mt.includes('管轄の店舗'), mt.slice(0, 160));

// 提出（請求者なし）すると出なくなる
await api(s1, 'POST', '/api/admin/jibai/submit', { ym: a.ym, action: 'submit_empty' });
ok('店舗：提出すると出なくなる', (await api(s1, 'GET', '/api/admin/me'))[1].jibaiAlert === null);
const ha = (await api(hq, 'GET', '/api/admin/me'))[1].jibaiAlert;
ok('本部：提出した店舗は一覧から外れる', ha && ha.stores.length === 1 && ha.stores[0].code === 'S002', JSON.stringify(ha));
ok('経理には出ない', await (async () => { await api(hq, 'POST', '/api/admin/hq/accounts', { code: 'keiri1', name: '見本 経理', password: 'keiripass1', role: 'acct' }); const k = await login('', 'keiripass1', 'keiri1'); return (await api(k, 'GET', '/api/admin/me'))[1].jibaiAlert == null && (await k.getByRole('alertdialog', { name: '自賠請求の提出のお知らせ' }).count()) === 0; })());

ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
console.log(process.exitCode ? 'JIBAIALERT FAILED' : 'JIBAIALERT OK');
