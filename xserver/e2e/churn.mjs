// Xserver（PHP）版：離反者リスト（来院の記録から自動・離反率 2 とおり・貼り付けの取り込み）と 2 週間フォロー（サンプル店舗 S001・見本の名前）
// 今日＝2026-10-24 の前提（日付は見本の環境に合わせる）。例：BASE_URL=http://127.0.0.1:3003 CHROMIUM_PATH=... node e2e/churn.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003', O = new URL('./', import.meta.url).pathname + 'out-';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const p = await br.newPage({ viewport: { width: 1366, height: 900 } });
p.on('dialog', (d) => d.accept());
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const api = (m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);
await p.goto(B + '/admin/login/S001'); await p.fill('input[type=password]', 'password'); await p.click('button[type=submit]'); await p.waitForURL(/admin\/day/);
const today = (await api('GET', '/api/admin/me'))[1].today;
const add = (d, n) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const visit = async (date, time, bed, text, visited = true) => {
  await api('PUT', '/api/admin/cells', { date, cells: [{ time, bed, text }] });
  if (visited) await api('PUT', '/api/admin/visit', { date, time, bed, visited: true });
};
const ym = today.slice(0, 7), prevYm = add(`${ym}-01`, -1).slice(0, 7);
// 前月の来院：一郎（今月に離反）・二郎（今月また来院＝続けて通院）・四郎（初診・今月に離反・中止）
await visit(`${prevYm}-05`, 540, 1, '見本 四郎（初診）');
await visit(`${prevYm}-10`, 600, 1, '見本 一郎');
await visit(`${prevYm}-20`, 600, 2, '見本 二郎');
await visit(`${ym}-15`, 600, 2, '見本 二郎');
const k = (await api('GET', `/api/admin/karte?month=${prevYm}`))[1].rows.find((r) => r.name === '見本四郎');
await api('PATCH', '/api/admin/karte', { id: k.id, patch: { karteNo: '1500', age: '50', sex: '♂', symptomCat: '腰', symptom: '腰痛', treatment: '矯正', stopped: true } });
// 2 週間フォロー：14 日前に来院（五郎は予約なし、六子は先の予約あり）
const d14 = add(today, -14);
await visit(d14, 660, 1, '見本 五郎');
await visit(d14, 660, 2, '見本 六子');
await visit(add(today, 4), 600, 3, '見本 六子', false);

// ---- 離反者リスト
const c = (await api('GET', `/api/admin/churn?month=${ym}`))[1];
const ichiro = c.rows.find((r) => r.name === '見本 一郎');
const shiro = c.rows.find((r) => r.name === '見本 四郎');
ok('離反：翌月の同じ日（一郎）', ichiro?.churnDate === `${ym}-10` && ichiro.lastVisit === `${prevYm}-10` && ichiro.kind === '既存' && ichiro.visits === '', JSON.stringify(ichiro));
ok('続けて通院の方は出ない（二郎）', !c.rows.some((r) => r.name === '見本 二郎'));
ok('新患継続率から自動（四郎：カルテNo・性・年・症状・施術・新患・通院回数・管理＝中止）', shiro && shiro.cardNo === '1500' && shiro.sex === '♂' && shiro.age === 50 && shiro.kind === '新患' && shiro.visits === '1' && shiro.treatment === '矯正' && shiro.manage === '中止' && shiro.symptom.includes('腰'), JSON.stringify(shiro));
ok('離反率 2 とおり（含む 2/3・除く 1/2）', c.stats.count === 2 && c.stats.active === 3 && c.stats.rate === 66.7 && c.stats.rateEx === 50, JSON.stringify(c.stats));
// 店舗で入れる：理由・通院回数（既存の方は手打ち）
await p.goto(`${B}/admin/churn?month=${ym}`); await p.waitForSelector('table[aria-label="離反者リスト"]');
const row = p.locator('table[aria-label="離反者リスト"] tbody tr').filter({ has: p.locator('input[aria-label="患者氏名"][value="見本 一郎"]') });
await row.getByLabel('通院回数').fill('７〜１２'); await row.getByLabel('通院回数').press('Tab');
await row.getByLabel('理由').fill('仕事が忙しい（見本）'); await row.getByLabel('理由').press('Enter');
await p.waitForTimeout(1200);
const c2 = (await api('GET', `/api/admin/churn?month=${ym}`))[1].rows.find((r) => r.name === '見本 一郎');
ok('理由・通院回数を保存（全角も半角に）', c2.reason === '仕事が忙しい（見本）' && c2.visits === '7〜12', JSON.stringify(c2));
ok('自動の行は消せない', (await api('DELETE', '/api/admin/churn', { id: c2.id }))[0] === 400);
await p.screenshot({ path: O + 'churn.png' });
// 過去のスプレッドシートを取り込む（4 月）
const T = '\t';
const tsv = [['離反した日付', 'カルテNo.', '患者氏名', '性', '年', '内訳(新・再・既)', '通院回数', '担当', '症状', '施術内容', '管理(治癒・転院)', '理由'].join(T),
  ['4/2', '1322', '見本 七郎', '♂', '53', '再来', '2', '見本A', '肩', 'マッサージ', '治癒', ''].join(T),
  ['4/3', '584', '見本 八子', '♀', '42', '既存', '既存', '見本A', '肩', 'マッサージ', '', '予約で埋まって当日お断り'].join(T)].join('\n');
await p.goto(`${B}/admin/churn?month=2026-04`); await p.waitForSelector('table[aria-label="離反者リスト"]');
await p.evaluate((t) => { const dt = new DataTransfer(); dt.setData('text/plain', t); document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, tsv);
const dlg = p.getByRole('form', { name: '離反者リストの取り込み' });
await dlg.getByRole('table', { name: '取り込みの確認' }).waitFor();
ok('Ctrl+V で取り込みの確認', (await dlg.textContent()).includes('新しく入る 2 件'));
await dlg.getByRole('button', { name: '2 件を取り込む' }).click(); await p.waitForTimeout(1000);
const apr = (await api('GET', '/api/admin/churn?month=2026-04'))[1].rows;
ok('4 月の離反者リストが入る', apr.length === 2 && apr[0].source === 'import' && apr.find((r) => r.name === '見本 七郎').manage === '治癒' && apr.find((r) => r.name === '見本 八子').reason.includes('当日お断り'));
ok('2 回取り込むと上書き', (await api('POST', '/api/admin/churn/import', { rows: [{ churnDate: '2026-04-02', cardNo: '1322', name: '見本 七郎', reason: '転居（見本）' }] }))[1].counts.update === 1);
const xr = await p.evaluate(async () => (await fetch('/api/admin/churn/export?month=2026-04')).status);
ok('Excel', xr === 200);

// ---- 2 週間フォロー
const f = (await api('GET', '/api/admin/follow'))[1];
ok('今日のリスト：14 日前に来院・予約なしの方だけ（五郎）', f.rows.length === 1 && f.rows[0].name === '見本 五郎' && f.rows[0].lastVisit === d14, JSON.stringify(f.rows.map((r) => r.name)));
await p.goto(`${B}/admin/churn?tab=follow`); await p.waitForSelector('table[aria-label="2週間フォロー"]');
await p.getByLabel('見本 五郎 に連絡した').click(); await p.waitForTimeout(1000);
await p.getByLabel('見本 五郎 の備考').fill('LINE で連絡（見本）'); await p.getByLabel('見本 五郎 の備考').press('Enter'); await p.waitForTimeout(800);
const f2 = (await api('GET', '/api/admin/follow'))[1].rows[0];
ok('連絡のチェック（日付つき）・備考', f2.contactedAt === today && f2.note === 'LINE で連絡（見本）');
await p.screenshot({ path: O + 'follow.png' });
// あとで予約が入ると次回来院日時が自動で出る
await visit(add(today, 6), 660, 3, '見本 五郎', false);
const f3 = (await api('GET', '/api/admin/follow'))[1].rows[0];
ok('予約が入ると次回来院日時が自動', f3.autoNext?.date === add(today, 6) && f3.autoNext.time === 660, JSON.stringify(f3.autoNext));
ok('履歴：前の日のリストも見られる', (await api('GET', `/api/admin/follow?date=${today}`))[0] === 200 && (await api('GET', '/api/admin/follow?pending=1'))[1].pendingCount === 0);
ok('ページのエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
