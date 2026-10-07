// Xserver（PHP）版：本部アカウント（一人ずつ）・発行と停止の権限・操作の記録の確認
// 例：BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... node e2e/accounts.mjs
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003';
const HQPW = process.env.HQ_PASSWORD ?? 'hqpass123';
const client = () => {
  let cookie = '';
  return async (m, u, b) => {
    const r = await fetch(B + u, { method: m, headers: { 'Content-Type': 'application/json', cookie }, body: b ? JSON.stringify(b) : undefined, redirect: 'manual' });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return [r.status, await r.json().catch(() => null)];
  };
};
const ok = (label, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'} ${label} ${extra}`); if (!cond) process.exitCode = 1; };
const sfx = Date.now().toString(36).slice(-4);

const hq = client();
ok('HQ でログイン', (await hq('POST', '/api/admin/login', { code: 'HQ', password: HQPW }))[0] === 200);
const me = (await hq('GET', '/api/admin/me'))[1];
ok('HQ は発行・停止の権限あり', me.session.canManage === true && me.session.name !== '');
ok('MG のアカウントを発行（権限なし）', (await hq('POST', '/api/admin/hq/accounts', { code: `mg${sfx}`, name: '山田 MG', password: 'mgpass123', canManage: false }))[0] === 200);
ok('部長のアカウントを発行（権限あり）', (await hq('POST', '/api/admin/hq/accounts', { code: `bu${sfx}`, name: '佐藤 部長', password: 'bupass123', canManage: true }))[0] === 200);
ok('店舗コードと同じ ID は不可', (await hq('POST', '/api/admin/hq/accounts', { code: 'S001', name: 'x', password: 'xxxxxxxx' }))[0] === 400);
ok('短いパスワードは不可', (await hq('POST', '/api/admin/hq/accounts', { code: `zz${sfx}`, name: 'x', password: 'short' }))[0] === 400);
let list = (await hq('GET', '/api/admin/hq/accounts'))[1].accounts;
const mg = list.find((a) => a.code === `mg${sfx}`), bu = list.find((a) => a.code === `bu${sfx}`), owner = list.find((a) => a.owner);

const m = client();
ok('MG は自分の ID でログインできる', (await m('POST', '/api/admin/login', { code: `mg${sfx}`, password: 'mgpass123' }))[0] === 200);
ok('MG は本部の集計を見られる', (await m('GET', '/api/admin/hq/karte?from=2026-10-01&to=2026-10-31'))[0] === 200);
ok('MG は店舗設定などを変えられる（本部と同じ）', (await m('GET', '/api/admin/settings'))[0] === 200);
ok('MG はアカウントを発行できない', (await m('POST', '/api/admin/hq/accounts', { code: `x${sfx}`, name: 'x', password: 'xxxxxxxx' }))[0] === 403);
ok('MG は操作の記録を見られない', (await m('GET', '/api/admin/hq/audit'))[0] === 403);
ok('MG は自分のパスワードを変えられる', (await m('PATCH', '/api/admin/store', { current: 'mgpass123', next: 'mgpass456' }))[0] === 200);

const b = client();
await b('POST', '/api/admin/login', { code: `bu${sfx}`, password: 'bupass123' });
ok('部長は MG を停止できる', (await b('PUT', '/api/admin/hq/accounts', { id: mg.id, active: false }))[0] === 200);
ok('停止された MG は次の操作から使えない', (await m('GET', '/api/admin/me'))[0] === 401);
ok('停止された MG はログインできない', (await client()('POST', '/api/admin/login', { code: `mg${sfx}`, password: 'mgpass456' }))[0] === 401);
ok('管理者 HQ は停止できない', (await b('PUT', '/api/admin/hq/accounts', { id: owner.id, active: false }))[0] === 400);
ok('自分自身は停止できない', (await b('PUT', '/api/admin/hq/accounts', { id: bu.id, active: false }))[0] === 400);
ok('HQ の権限は外せない', (await b('PUT', '/api/admin/hq/accounts', { id: owner.id, canManage: false }))[0] === 400);
ok('パスワード再設定と再開', (await b('PUT', '/api/admin/hq/accounts', { id: mg.id, active: true, password: 'mgnew1234' }))[0] === 200 && (await client()('POST', '/api/admin/login', { code: `mg${sfx}`, password: 'mgnew1234' }))[0] === 200);
ok('部長の権限を外す', (await hq('PUT', '/api/admin/hq/accounts', { id: bu.id, canManage: false }))[0] === 200 && (await b('GET', '/api/admin/hq/audit'))[0] === 403);

const audit = (await hq('GET', '/api/admin/hq/audit'))[1].rows;
ok('操作の記録に、誰が何をしたかが残る', audit.some((r) => r.actor.includes('佐藤 部長') && r.action === '本部アカウントの変更') && audit.some((r) => r.actor.includes('山田 MG') && r.action === '自分のパスワード変更'), audit.slice(0, 3).map((r) => `${r.actor}:${r.action}`).join(' / '));
const f = (await hq('GET', `/api/admin/hq/audit?account=${mg.id}`))[1];
ok('操作した人で絞り込める', f.rows.length > 0 && f.rows.every((r) => r.actor.includes('山田 MG')), `${f.rows.length}件`);
const all = (await hq('GET', '/api/admin/hq/audit'))[1];
ok('絞り込みの選択肢に本部の人と店舗が出る', all.actors.some((x) => x.id === mg.id && x.hq && x.count >= 1) && all.actors.some((x) => x.id === bu.id));
ok('記録にパスワードは残らない', !JSON.stringify(audit).includes('mgnew1234'));
// 後片付け（停止）
for (const a of [mg, bu]) await hq('PUT', '/api/admin/hq/accounts', { id: a.id, active: false });
console.log(process.exitCode ? 'ACCOUNTS FAILED' : 'ACCOUNTS OK');
