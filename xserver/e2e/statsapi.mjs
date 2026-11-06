// Xserver（PHP）版：集計API（/api/stats/...・統合ダッシュボード用）。キーの発行・停止（本部の画面）、401・403・429、
// 画面（窓口集計・日報・新患継続率・離反者リスト）と数字が一致すること、患者様の氏名などが入っていないこと、API を呼んでもデータが変わらないこと
// 例：BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... CHROMIUM_PATH=... node e2e/statsapi.mjs
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003';
const DB = process.env.DB_NAME ?? 'booking';
const sql = (q) => execSync(`mysql -uroot --default-character-set=utf8mb4 -N ${DB}`, { input: q }).toString().trim();
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
const stats = async (path, key, header = 'Authorization') => {
  const h = key ? { [header]: header === 'Authorization' ? `Bearer ${key}` : key } : {};
  const r = await fetch(`${B}/api/stats/${path}`, { headers: h });
  return [r.status, await r.json().catch(() => null)];
};
sql('DELETE FROM rate_limit');

// ---------- 本部の画面でキーを発行 ----------
const hq = await login('', process.env.HQ_PASSWORD ?? 'hq-pass', 'HQ');
await hq.goto(`${B}/admin/hq/accounts`); await hq.waitForSelector('text=集計API のキー'); await hq.waitForTimeout(400);
const sec = hq.getByRole('region', { name: '集計APIのキー' });
const form = sec.getByRole('form', { name: '集計APIのキーを発行' });
await form.getByLabel('名前').fill('統合ダッシュボード（確認）');
await form.getByRole('button', { name: 'キーを発行' }).click(); await hq.waitForTimeout(800);
const KEY = (await sec.getByLabel('キー', { exact: true }).textContent()).trim();
ok('本部：キーを発行すると 1 回だけ表示', /^nsk_[0-9a-f]{48}$/.test(KEY), KEY.slice(0, 8));
await hq.screenshot({ path: new URL('./out-statsapi-keys.png', import.meta.url).pathname });
ok('DB にはキーそのものは残さない（ハッシュだけ）', sql(`SELECT COUNT(*) FROM api_key WHERE keyHash = '${KEY}' OR prefix = '${KEY}'`) === '0' && sql(`SELECT COUNT(*) FROM api_key WHERE keyHash = SHA2('${KEY}', 256)`) === '1');
await sec.getByRole('button', { name: '閉じる（入れ終わった）' }).click();
ok('閉じるともう表示されない', (await sec.getByLabel('キー', { exact: true }).count()) === 0);

// ---------- 認証 ----------
ok('キーなし → 401', (await stats('meta'))[0] === 401);
const bad = await stats('meta', 'nsk_wrong');
ok('間違ったキー → 401（ok:false・error.code）', bad[0] === 401 && bad[1].ok === false && bad[1].error.code === 'unauthorized');
const meta = await stats('meta', KEY);
ok('meta：店舗とエリアと定義', meta[0] === 200 && meta[1].ok && meta[1].apiVersion === '1.0' && meta[1].data.stores.some((s) => s.code === 'S001') && meta[1].data.definitions.retentionMaxVisit === 6, JSON.stringify(meta[1]?.data?.stores));
ok('generatedAt は日本時間（+09:00）', /\+09:00$/.test(meta[1].generatedAt));
ok('X-API-Key でも受け付ける', (await stats('meta', KEY, 'X-API-Key'))[0] === 200);
ok('パラメータの間違い → 400 invalid_param', (await stats('daily?from=2026-1-1&to=2026-11-30', KEY))[1].error?.code === 'invalid_param' && (await stats('daily?from=2026-01-01&to=2026-11-30', KEY))[0] === 400 && (await stats('monthly?ym=2026-11&stores=NONE', KEY))[0] === 400);

// ---------- データを作る（S001）：最後の来院 L（前の月）→ 離反の日 C（今日より前） ----------
const sid = sql("SELECT id FROM store WHERE code = 'S001'");
const pad = (n) => String(n).padStart(2, '0');
const t = new Date(Date.now() + 9 * 3600e3 - 3 * 864e5); // 3 日前（日本時間）
const cd = Math.min(t.getUTCDate(), 28);
const C = `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(cd)}`;
const lm = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 1, cd));
const L = lm.toISOString().slice(0, 10);
const LY = L.slice(0, 7), CY = C.slice(0, 7);
const L2 = `${LY}-${pad(Math.max(1, cd - 1))}`; // 同じ月の別の日（継続した人の来院）
console.log('L', L, 'C', C);
sql(`DELETE FROM cell WHERE storeId = '${sid}' AND date BETWEEN '${LY}-01' AND '${C}';`);
const cells = [
  [L, 540, 1, '見本 一郎（初診）', 1, '見本 施術者'], [L, 555, 1, '上記初診対応', 1, '見本 施術者'], [L, 600, 2, '見本 二郎（再来）', 1, '見本 施術者'], [L, 600, 3, '見本 三郎（初自）', 1, ''],
  [L, 660, 1, '見本 四郎（新三）', 1, ''], [L, 660, 2, '見本 五郎', 1, ''], [L, 720, 1, '見本 六郎（初診）', 0, ''], [L2, 540, 1, '見本 七郎', 1, ''],
];
// 離反の日の当日に来院した人（八郎）は離反・前日に来院した人（九郎）は離反ではない
const Cm1 = `${CY}-${pad(cd - 1)}`;
if (cd > 1) cells.push([L, 780, 2, '見本 八郎', 1, ''], [C, 540, 5, '見本 八郎', 1, ''], [L, 780, 3, '見本 九郎', 1, ''], [Cm1, 540, 5, '見本 九郎', 1, '']);
for (const [d, tm, b, tx, v, s] of cells) sql(`INSERT INTO cell (id, storeId, date, time, bed, text, visited, staff) VALUES (REPLACE(UUID(), '-', ''), '${sid}', '${d}', ${tm}, ${b}, '${tx}', ${v}, '${s}');`);
sql(`INSERT INTO cancel_log (id, storeId, date, time, bed, name, kind, source, byCode) VALUES (REPLACE(UUID(), '-', ''), '${sid}', '${L}', 780, 1, '見本 取消', 'NEW', 'phone', 'S001');`);
sql(`INSERT INTO staff_member (id, storeId, name, role, startDate, joinType) VALUES ('stapi1', '${sid}', '見本 新人', 'THERAPIST', '${LY}-02', 'NEW') ON DUPLICATE KEY UPDATE startDate = VALUES(startDate);`);
const st = await login('S001', 'password');
await api(st, 'PUT', '/api/admin/madoguchi/day', { date: L, patch: { copay: 25200, third: 1000, self: 23100, acu: 1200, goods: 3000, colCopay: 500, unknown: 7, deposit: 100, cert: 300, mail: 54407, bank: 54400, insClaim: 73646, jibaiClaim: 12000 } });
await api(st, 'PUT', '/api/admin/madoguchi/day', { date: L2, patch: { copay: 1001, self: 999 } });
sql(`UPDATE madoguchi_month SET target = 150000 WHERE storeId = '${sid}' AND ym = '${LY}';`);

// ---------- API を呼んでもデータが変わらない（画面を開く前） ----------
const snap = () => sql(`SELECT CONCAT((SELECT COUNT(*) FROM karte WHERE storeId = '${sid}'), '/', (SELECT COUNT(*) FROM churn WHERE storeId = '${sid}'), '/', (SELECT COUNT(*) FROM cell WHERE storeId = '${sid}'), '/', (SELECT COALESCE(SUM(CRC32(vals)), 0) FROM madoguchi_day WHERE storeId = '${sid}'), '/', (SELECT COUNT(*) FROM madoguchi_month), '/', (SELECT COUNT(*) FROM follow))`);
const before = snap();
const out = {};
for (const [k, p] of [['daily', `daily?from=${LY}-01&to=${L}&stores=S001`], ['monthly', `monthly?ym=${LY}&stores=S001`], ['retention', `retention?ym=${LY}&stores=S001`], ['churn', `churn?ym=${CY}&stores=S001`], ['staff', `staff?ym=${LY}&stores=S001`]]) {
  const r = await stats(p, KEY);
  ok(`${k}：200`, r[0] === 200 && r[1].ok, JSON.stringify(r[1]).slice(0, 200));
  out[k] = r[1];
}
ok('API を呼んでもデータ（初回カルテ・離反者リスト・予約表・窓口集計）は変わらない', snap() === before, `${before} → ${snap()}`);

// ---------- 画面と一致 ----------
// 窓口集計
const mado = (await api(st, 'GET', `/api/admin/madoguchi?month=${LY}`))[1];
const mo = out.monthly.data[0];
const exTax = (n) => Math.sign(n) * Math.round(Math.abs(n) / 1.1); // 画面と同じ
const MAP = { copay: 'copay', third: 'thirdParty', copayTotal: 'copayTotal', self: 'selfPay', acu: 'acupuncture', selfAcu: 'selfPayAcuTotal', total: 'windowTotal', goods: 'goods', colCopay: 'uncollectedCopay', colSelf: 'uncollectedSelfPay', diffCopay: 'diffCopay', diffSelf: 'diffSelfPay', unknown: 'unknown', deposit: 'deposit', cert: 'certificate', match: 'reconcileTotal', mail: 'reportMailTotal', bank: 'bankDeposit', insClaim: 'insuranceClaim', jibaiClaim: 'jibaiClaim' };
ok('monthly：sumsTaxIncluded が窓口集計の「計」と一致（20 列）', Object.entries(MAP).every(([k, a]) => mo.sumsTaxIncluded[a] === mado.sum[k]), JSON.stringify(mo.sumsTaxIncluded));
ok('monthly：sumsTaxExcluded が「税抜」と一致（保険・自賠は null）', Object.entries(MAP).every(([k, a]) => (k === 'insClaim' || k === 'jibaiClaim' ? mo.sumsTaxExcluded[a] === null : mo.sumsTaxExcluded[a] === exTax(mado.sum[k]))));
ok('monthly：売上・目標・達成率（小数第1位）・合わない日', mo.salesTotal === mado.sales && mo.salesTarget === 150000 && mo.achievementRate === Math.round(mado.sales / 150000 * 1000) / 10 && Math.round(mo.achievementRate) === Math.round(mado.sales / 150000 * 100) && mo.mismatchDays === mado.mismatchDays && mo.mismatchDays === 2, `${mo.salesTotal} ${mo.achievementRate} ${mo.mismatchDays}`);
ok('monthly：経理確認・返戻・物販内訳の形', mo.accountingConfirmed.confirmed === false && mo.refunds.count === 0 && Array.isArray(mo.goodsBreakdown));
// 日ごとの窓口集計
const dl = out.daily.data.find((x) => x.date === L);
const dcalc = mado.days.find((x) => x.date === L).calc;
ok('daily：sales が窓口集計の 1 日と一致・entered', dl.sales.copayTotal === dcalc.copayTotal && dl.sales.windowTotal === dcalc.total && dl.sales.reconcileTotal === dcalc.match && dl.sales.copay === 25200 && dl.sales.diffCopay === null && dl.sales.entered === true && out.daily.data.find((x) => x.date === `${LY}-01`).sales.entered === (`${LY}-01` === L || `${LY}-01` === L2));
// 日報（来院・新規）
const rep = (await api(st, 'GET', `/api/admin/report?date=${L}`))[1];
const rv = (id) => rep.items.find((x) => x.id === id)?.value;
const sum = (k) => out.daily.data.reduce((a, x) => a + x[k], 0);
ok('daily：その日の来院・新患・新患（自賠）・再来が日報と一致', dl.visits === rv('total') && dl.newGeneral === rv('new') && dl.newJibai === rv('new-jibai') && dl.revisit === rv('revisit'), JSON.stringify([rv('total'), rv('new'), rv('new-jibai'), rv('revisit')]));
ok('daily：月の初めからの新規・再来の合計が日報の「月間成績」と一致', sum('newGeneral') === rv('p-new') && sum('revisit') === rv('p-revisit'));
ok('daily：その日の数（来院 5〜7・初診 1・初自 1・新三 1・再来 1・キャンセル 1）', dl.visits === 5 + (cd > 1 ? 2 : 0) && dl.newGeneral === 1 && dl.newJibai === 1 && dl.newThirdParty === 1 && dl.revisit === 1 && dl.cancels === 1, JSON.stringify(dl).slice(0, 160));
ok('monthly：来院・新規の合計（月全体）', mo.visits === 6 + (cd > 1 ? 2 : 0) && mo.newGeneral === 1 && mo.revisit === 1);
// 新患継続率（画面を開く前の API の数＝画面を開いたあとの数）
const kart = (await api(st, 'GET', `/api/admin/karte?month=${LY}`))[1];
const ret = out.retention.data[0];
const kindN = (k) => kart.rows.filter((r) => r.kind === k).length;
ok('retention：初回の人数が新患継続率の画面と一致（新患・新自・新三・再来）', ret.byKind.find((x) => x.kind === 'NEW').firstCount === kindN('NEW') && ret.byKind.find((x) => x.kind === 'ACCIDENT').firstCount === kindN('ACCIDENT') && ret.byKind.find((x) => x.kind === 'THIRD_PARTY').firstCount === kindN('THIRD') && ret.byKind.find((x) => x.kind === 'REVISIT').firstCount === kindN('REVISIT') && kindN('NEW') === 1, JSON.stringify(ret.byKind.map((x) => [x.kind, x.firstCount])));
ok('retention：reached は 2〜6 回目だけ（7〜12 は返さない）', Object.keys(ret.byKind[0].reached).join(',') === '2,3,4,5,6');
// 2 回目を入れる・中止にすると反映
const row = kart.rows.find((r) => r.kind === 'NEW');
const vis = row.visits.map((v, i) => (i === 0 ? { ...v, d: L2 } : v));
await api(st, 'PATCH', '/api/admin/karte', { id: row.id, patch: { visits: vis, stopped: true } });
const ret2 = (await stats(`retention?ym=${LY}&stores=S001`, KEY))[1].data[0].byKind.find((x) => x.kind === 'NEW');
ok('retention：2 回目の来院・中止（除いた数も）', ret2.reached['2'] === 1 && ret2.reached['3'] === 0 && ret2.dropped === 1 && ret2.excludingDropped.firstCount === 0, JSON.stringify(ret2));
// 離反
const ch = (await api(st, 'GET', `/api/admin/churn?month=${CY}`))[1];
const co = out.churn.data[0];
ok('churn：画面を開く前の API の離反数・分母も画面と同じ', co.churned === ch.stats.count && co.base === ch.stats.active);
// 区分（新患・再来・既存）と「除く」は初回カルテ（中止・転院）を見て決める（画面と同じ。上で新患継続率の画面を直したので、今の API と画面で比べる）
const coNow = (await stats(`churn?ym=${CY}&stores=S001`, KEY))[1].data[0];
ok('churn：離反数・分母・離反率・除いた離反率が離反者リストの画面と一致', coNow.churned === ch.stats.count && coNow.base === ch.stats.active && coNow.churnRate === ch.stats.rate && coNow.excluded === ch.stats.excluded && coNow.churnRateEx === ch.stats.rateEx && coNow.churned >= 4, `${coNow.churned}/${coNow.base} ${coNow.churnRate} ${coNow.churnRateEx} vs ${JSON.stringify(ch.stats)}`);
if (cd > 1) ok('churn：離反の日の当日の来院は離反・前日までの来院は継続（8 人中 7 人）', coNow.churned === 7 && coNow.base === 8 && ch.rows.some((r) => r.name.includes('八郎')) && !ch.rows.some((r) => r.name.includes('九郎')), `${coNow.churned}/${coNow.base}`);
ok('churn：区分ごと（新患・再来・既存）が画面と一致・合計＝離反数', coNow.byKind.reduce((a, x) => a + x.churned, 0) === coNow.churned && ['新患', '再来', '既存'].every((l) => coNow.byKind.find((x) => x.label === l).churned === ch.rows.filter((r) => r.kind === l).length), JSON.stringify(coNow.byKind));
// 中止にした人は除く方に（画面で管理を入れた内容が API にも）
const target = ch.rows.find((r) => r.kind === '再来') ?? ch.rows[0];
await api(st, 'PATCH', '/api/admin/churn', { id: target.id, patch: { manage: '転院' } });
const ch2 = (await api(st, 'GET', `/api/admin/churn?month=${CY}`))[1];
const co2 = (await stats(`churn?ym=${CY}&stores=S001`, KEY))[1].data[0];
ok('churn：画面で直した「管理」も反映（除いた離反率）', co2.excluded === ch2.stats.excluded && co2.churnRateEx === ch2.stats.rateEx && co2.excluded >= 1, `${co2.excluded} ${co2.churnRateEx} / ${JSON.stringify(ch2.stats)}`);
// スタッフ
const so = out.staff.data[0];
ok('staff：施術者の人数・入った人（新入社員）・名前と ID は返さない', so.therapists >= 1 && so.hires.total >= 1 && so.hires.NEW >= 1 && so.members.every((m) => !('staffName' in m) && !('staffId' in m) && !('handled' in m)) && so.members.some((m) => m.joinType === 'NEW' && m.shiftDays > 0), JSON.stringify(so).slice(0, 300));

// ---------- 個人情報が入っていない ----------
const all = JSON.stringify(out) + JSON.stringify(meta[1]);
ok('どの応答にも患者様の氏名・スタッフの名前が入っていない', !/見本|一郎|施術者|新人|取消/.test(all.replace(/"label":"[^"]*"/g, '').replace(/"(definitions|visitsRule|retentionRule|churnRule|churnBase|salesTaxNote|achievementRateRule)":("[^"]*"|\{[^}]*\})/g, '')));
ok('カルテNo・電話番号・患者番号のキーがない', !/karteNo|cardNo|phone|patient|"name":"見本/.test(all));

// ---------- 記録・IP 制限・停止・回数制限 ----------
ok('呼ばれた記録が操作の記録に残る（api.stats.daily・期間）', sql(`SELECT COUNT(*) FROM audit_log WHERE action = 'api.stats.daily' AND detail = '${LY}-01〜${L}'`) !== '0');
ok('最後に使った日時が残る', sql(`SELECT COUNT(*) FROM api_key WHERE keyHash = SHA2('${KEY}', 256) AND lastUsedAt IS NOT NULL`) === '1');
await hq.reload(); await hq.waitForSelector('text=集計API のキー'); await hq.waitForTimeout(400);
await sec.getByLabel('統合ダッシュボード（確認） の接続元 IP').fill('203.0.113.10'); await sec.getByLabel('統合ダッシュボード（確認） の接続元 IP').blur(); await hq.waitForTimeout(800);
const ip = await stats('meta', KEY);
ok('許可していない IP → 403', ip[0] === 403 && ip[1].error.code === 'forbidden');
await sec.getByLabel('統合ダッシュボード（確認） の接続元 IP').fill('127.0.0.1, 203.0.113.10'); await sec.getByLabel('統合ダッシュボード（確認） の接続元 IP').blur(); await hq.waitForTimeout(800);
ok('許可した IP → 200', (await stats('meta', KEY))[0] === 200);
await sec.locator('tr', { hasText: '統合ダッシュボード（確認）' }).getByRole('button', { name: '停止' }).click(); await hq.waitForTimeout(800);
const stopped = await stats('meta', KEY);
ok('停止したキー → 401', stopped[0] === 401 && stopped[1].error.code === 'unauthorized');
ok('店舗アカウントはキーを扱えない', (await api(st, 'GET', '/api/admin/hq/api-keys'))[0] === 403);
// 回数制限：別のキーで 61 回
const K2 = 'nsk_' + 'a'.repeat(48);
sql(`DELETE FROM api_key WHERE name = 'rate-test'; INSERT INTO api_key (id, name, keyHash, prefix) VALUES ('ratetest1', 'rate-test', SHA2('${K2}', 256), 'nsk_aaaaaa');`);
let last = 0;
for (let i = 0; i < 61; i++) last = (await stats('meta', K2))[0];
ok('1 分に 60 回を超えると 429', last === 429);
sql(`DELETE FROM api_key WHERE name = 'rate-test'; DELETE FROM rate_limit; DELETE FROM staff_member WHERE id = 'stapi1';`);

ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
console.log(process.exitCode ? 'STATSAPI FAILED' : 'STATSAPI OK');
