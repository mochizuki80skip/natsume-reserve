// Xserver（PHP）版：新自の通知を LINE 公式アカウントで送る（合言葉・6 桁の番号での登録・Webhook の署名・エリアごとの送り先・止める）
// 例：BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... CHROMIUM_PATH=... MAIL_LOG=/tmp/natsume-mail.log node e2e/linenotify.mjs
// （PHP のサーバーも同じ MAIL_LOG で起動しておく：LINE にも送らずにそのファイルに書く）
import { createRequire } from 'node:module';
import fs from 'node:fs';
import crypto from 'node:crypto';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003';
const LOG = process.env.MAIL_LOG ?? '/tmp/natsume-mail.log';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const errs = [];
async function login(code, pass, user) {
  const p = await (await br.newContext({ viewport: { width: 1300, height: 1000 } })).newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  if (user) { await p.goto(`${B}/admin/login`); await p.fill('input[autocomplete="username"]', user); } else await p.goto(`${B}/admin/login/${code}`);
  await p.fill('input[type=password]', pass); await p.click('button[type=submit]'); await p.waitForURL(/admin\//); await p.waitForTimeout(800);
  return p;
}
const api = (p, m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);
const logs = () => { try { return fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const SECRET = 'testsecret0123456789abcdef';
async function hook(events, secret = SECRET) {
  const body = JSON.stringify({ destination: 'Uxxx', events });
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64');
  return (await fetch(`${B}/api/line/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Line-Signature': sig }, body })).status;
}
const msg = (src, text) => ({ type: 'message', replyToken: 'r' + Math.random(), source: src, message: { type: 'text', id: '1', text } });

const hq = await login('', process.env.HQ_PASSWORD ?? 'hq-pass', 'HQ');
await api(hq, 'PUT', '/api/admin/hq/areas', { areas: [{ name: '静岡エリア', stores: ['S001'] }, { name: '東部エリア', stores: ['S002'] }] });
ok('合言葉：おかしな文字は入れられない', (await api(hq, 'PUT', '/api/admin/hq/line', { token: 'ab cd<>' }))[0] === 400);
ok('合言葉を保存', (await api(hq, 'PUT', '/api/admin/hq/line', { token: 'TESTTOKEN.abc/123+=', secret: SECRET }))[0] === 200);
const g0 = await api(hq, 'GET', '/api/admin/hq/line');
ok('合言葉は画面に返さない（入っているかだけ）', g0[1].hasToken && g0[1].hasSecret && !JSON.stringify(g0[1]).includes('TESTTOKEN') && !JSON.stringify(g0[1]).includes(SECRET) && g0[1].webhookUrl.endsWith('/api/line/webhook'));
ok('名前がないと番号は出ない', (await api(hq, 'POST', '/api/admin/hq/line/targets', { area: '', label: '' }))[0] === 400);
const t1 = (await api(hq, 'POST', '/api/admin/hq/line/targets', { area: '静岡エリア', label: '静岡エリアMG' }))[1];
const t2 = (await api(hq, 'POST', '/api/admin/hq/line/targets', { area: '東部エリア', label: '東部グループ' }))[1];
ok('6 桁の番号が出る', /^\d{6}$/.test(t1.code) && /^\d{6}$/.test(t2.code) && t1.code !== t2.code);

fs.rmSync(LOG, { force: true });
ok('署名のない Webhook は受けない', (await fetch(`${B}/api/line/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"events":[]}' })).status === 403);
ok('署名の違う Webhook は受けない', (await hook([msg({ type: 'user', userId: 'Uaaaa' }, t1.code)], 'wrong')) === 403);
ok('LINE の接続確認（events が空）は 200', (await hook([])) === 200);
ok('ふつうのトークには返事をしない', (await hook([msg({ type: 'user', userId: 'Uaaaa' }, 'こんにちは')])) === 200 && logs().length === 0);
await hook([msg({ type: 'user', userId: 'Uaaaa' }, '000000')]);
ok('違う番号には「見つかりません」と返事', logs().at(-1)?.lineReply?.includes('見つかりませんでした'));
await hook([msg({ type: 'user', userId: 'Uaaaa' }, t1.code)]);
ok('個人のトークで番号を送ると登録', logs().at(-1)?.lineReply?.includes('登録しました（静岡エリアMG）'));
const zen = t2.code.replace(/\d/g, (d) => String.fromCharCode(d.charCodeAt(0) + 0xfee0));
await hook([msg({ type: 'group', groupId: 'Cgggg', userId: 'Ubbbb' }, ` ${zen} `)]);
const g1 = (await api(hq, 'GET', '/api/admin/hq/line'))[1].targets;
ok('グループのトーク（全角の数字）でも登録', g1.find((t) => t.label === '東部グループ')?.linked && g1.find((t) => t.label === '東部グループ')?.kind === 'group' && g1.find((t) => t.label === '静岡エリアMG')?.kind === 'user' && g1.every((t) => t.code === null), JSON.stringify(g1));
await hook([msg({ type: 'user', userId: 'Ucccc' }, t1.code)]);
ok('使った番号はもう使えない', logs().at(-1)?.lineReply?.includes('見つかりませんでした'));

fs.rmSync(LOG, { force: true });
const tt = await api(hq, 'POST', '/api/admin/hq/line/test');
ok('試しの通知（2 か所）', tt[0] === 200 && tt[1].sent === 2 && logs().filter((x) => x.line).map((x) => x.line).sort().join() === 'Cgggg,Uaaaa', JSON.stringify(tt));

// 店舗：静岡エリアの S001 で新自が来院 → 静岡エリアの LINE だけ
const st = await login('S001', 'password');
const today = (await api(st, 'GET', '/api/admin/me'))[1].today;
fs.rmSync(LOG, { force: true });
await api(st, 'PUT', '/api/admin/cells', { date: today, cells: [{ time: 600, bed: 2, text: '見本 太郎（初自）' }] });
await api(st, 'PUT', '/api/admin/visit', { date: today, time: 600, bed: 2, visited: true });
const sent = logs().filter((x) => x.line);
ok('新自の来院で、その店舗のエリアの LINE だけに届く（はじめは予約表のとおりの氏名）', sent.length === 1 && sent[0].line === 'Uaaaa' && sent[0].text.includes('【新自】サンプル本店') && sent[0].text.includes('患者様：見本 太郎 様') && (process.env.APP_URL ? sent[0].text.includes(process.env.APP_URL + '/admin/karte?store=S001') : true), JSON.stringify(sent));

// 患者様の出し方を変える（カルテNo が入っていればカルテNo も）
const kid = (await api(st, 'GET', `/api/admin/karte?month=${today.slice(0, 7)}`))[1].rows.find((r) => r.kind === 'ACCIDENT').id;
await api(st, 'PATCH', '/api/admin/karte', { id: kid, patch: { karteNo: '1201' } });
const who = async (mode) => {
  await api(hq, 'PUT', '/api/admin/hq/notify-name', { mode });
  return st.evaluate(async () => '');
};
ok('出し方：おかしな値は保存できない', (await api(hq, 'PUT', '/api/admin/hq/notify-name', { mode: 'all' }))[0] === 400);
await who('full');
fs.rmSync(LOG, { force: true });
await api(st, 'PUT', '/api/admin/cells', { date: today, cells: [{ time: 720, bed: 4, text: '例示 一郎（初自）' }] });
await api(st, 'PUT', '/api/admin/visit', { date: today, time: 720, bed: 4, visited: true });
ok('出し方：氏名＋カルテNo（カルテNo がまだ無いときは氏名だけ）', logs().filter((x) => x.line)[0]?.text.includes('患者様：例示 一郎 様'), JSON.stringify(logs()));
fs.rmSync(LOG, { force: true });
await api(st, 'PUT', '/api/admin/cells', { date: today, cells: [{ time: 735, bed: 5, text: '例示二郎（初自）' }] });
await api(st, 'PUT', '/api/admin/visit', { date: today, time: 735, bed: 5, visited: true });
ok('出し方：氏名は予約表のとおり（空白なしなら空白なしのまま）', logs().filter((x) => x.line)[0]?.text.includes('患者様：例示二郎 様'), JSON.stringify(logs()));
await who('none');
fs.rmSync(LOG, { force: true });
await api(st, 'PUT', '/api/admin/cells', { date: today, cells: [{ time: 720, bed: 5, text: '仮名 次郎（初自）' }] });
await api(st, 'PUT', '/api/admin/visit', { date: today, time: 720, bed: 5, visited: true });
ok('出し方：出さない', logs().filter((x) => x.line).length === 1 && !logs().filter((x) => x.line)[0].text.includes('患者様'), JSON.stringify(logs()));
await who('surname');

// ブロックされたら止める・止めた送り先には送らない
await hook([{ type: 'unfollow', source: { type: 'user', userId: 'Uaaaa' } }]);
const g2 = (await api(hq, 'GET', '/api/admin/hq/line'))[1].targets;
ok('ブロックされたら止める', g2.find((t) => t.label === '静岡エリアMG')?.active === false);
fs.rmSync(LOG, { force: true });
await api(st, 'PUT', '/api/admin/cells', { date: today, cells: [{ time: 660, bed: 3, text: '試験 花子（初自）' }] });
await api(st, 'PUT', '/api/admin/visit', { date: today, time: 660, bed: 3, visited: true });
ok('止めた送り先には送らない', logs().filter((x) => x.line).length === 0);

// 通知のリンク（?store=店舗コード）：本部が押すと、その店舗に切り替わって継続率が開く
await api(hq, 'GET', '/api/admin/me');
await hq.goto(`${B}/admin/karte?store=S002`); await hq.waitForURL((u) => !u.search.includes('store='), { timeout: 10000 }).catch(() => {}); await hq.waitForTimeout(1200);
const meHq = (await api(hq, 'GET', '/api/admin/me'))[1];
ok('通知のリンクで、その店舗に切り替わって継続率が開く', meHq.store.code === 'S002' && hq.url().endsWith('/admin/karte') && (await hq.getByRole('heading', { name: '新患継続率' }).count()) === 1, hq.url() + ' ' + meHq.store.code);
await hq.goto(`${B}/admin/karte?store=NOPE`); await hq.waitForTimeout(1000);
ok('知らない店舗コードでは切り替えない', (await api(hq, 'GET', '/api/admin/me'))[1].store.code === 'S002');

// 本部の画面
await hq.goto(`${B}/admin/hq`); await hq.waitForTimeout(1000);
const area = hq.getByLabel('LINEの通知');
ok('本部の画面に LINE の欄（合言葉は入っています・送り先 2 つ）', (await area.textContent()).includes('（入っています）') && (await area.textContent()).includes('登録済み（グループ）') && (await area.textContent()).includes('止めています'));
await area.getByLabel('LINEの送り先の名前').fill('本部 見本'); await area.getByRole('button', { name: '番号を出す' }).click(); await hq.waitForTimeout(800);
ok('画面から番号を出せる', /番号 \d{6} を送ってください/.test(await area.textContent()));
ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
