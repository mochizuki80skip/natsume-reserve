// Xserver（PHP）版：セキュリティ点検で直したところ（ログインの無効化・回数制限・見られる範囲・CSV・ヘッダーなど）
// 例：BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... node e2e/security.mjs   （DB を作り直した直後に実行）
import { execSync } from 'node:child_process';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003';
// 回数制限の数をリセット（ローカルの DB だけ。DB_NAME は既定の booking）
const resetLimits = () => execSync(`mysql -uroot ${process.env.DB_NAME ?? 'booking'} -e "DELETE FROM rate_limit"`);
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const cookieOf = (r) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).filter((c) => !c.endsWith('=')).join('; ');
async function login(code, password, extra = {}) {
  const r = await fetch(`${B}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify({ code, password }) });
  return { status: r.status, cookie: cookieOf(r), body: await r.json().catch(() => null) };
}
const call = async (cookie, m, u, b, extra = {}) => { const r = await fetch(`${B}${u}`, { method: m, redirect: 'manual', headers: { Cookie: cookie, ...(b ? { 'Content-Type': 'application/json' } : {}), ...extra }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, text: await r.text(), r }; };
const HQP = process.env.HQ_PASSWORD ?? 'hq-pass';

const hq = (await login('HQ', HQP)).cookie;
// ---- 1. パスワードの再設定・店舗の停止で、ログイン中の画面も使えなくなる
let s2 = (await login('S002', 'password')).cookie;
ok('ログイン直後は使える', (await call(s2, 'GET', '/api/admin/me')).status === 200);
await call(hq, 'PUT', '/api/admin/hq/stores', { code: 'S002', action: 'reset', password: 'newpass123' });
ok('本部がパスワードを再設定すると、前のログインは使えない', (await call(s2, 'GET', '/api/admin/me')).status === 401);
s2 = (await login('S002', 'newpass123')).cookie;
await call(hq, 'PUT', '/api/admin/hq/stores', { code: 'S002', action: 'toggle' });
ok('店舗を停止すると、ログイン中でも使えない', (await call(s2, 'PUT', '/api/admin/cells', { date: '2026-11-02', cells: [{ time: 540, bed: 1, text: 'x' }] })).status === 401);
await call(hq, 'PUT', '/api/admin/hq/stores', { code: 'S002', action: 'toggle' });
// 自分でパスワードを変える：この画面は続けて使え、ほかの画面（前の Cookie）は使えない
const a = (await login('S001', 'password')).cookie, b = (await login('S001', 'password')).cookie;
const ch = await call(a, 'PATCH', '/api/admin/store', { current: 'password', next: 'password2' });
const a2 = cookieOf(ch.r) || a;
ok('自分でパスワードを変えた画面はそのまま使える', ch.status === 200 && (await call(a2, 'GET', '/api/admin/me')).status === 200, String(ch.status));
ok('ほかの画面のログインは使えなくなる', (await call(b, 'GET', '/api/admin/me')).status === 401);
await call(a2, 'PATCH', '/api/admin/store', { current: 'password2', next: 'password' });

// ---- 2. 回数制限：X-Forwarded-For を変えてもすり抜けない・アカウントごとの制限
let last = 0;
for (let i = 0; i < 11; i++) last = (await login('S002', 'wrong-pass', { 'X-Forwarded-For': `10.0.0.${i}` })).status;
ok('同じアカウントで 10 回間違えると止まる（接続元を偽っても）', last === 429, String(last));
ok('止まっている間は正しいパスワードでも入れない', (await login('S002', 'newpass123')).status === 429);
ok('ほかのアカウントは入れる', (await login('S001', 'password')).status === 200);
resetLimits();

// ---- 3. 見られる範囲
await call(hq, 'POST', '/api/admin/hq/accounts', { code: 'keiri1', name: '見本 経理', password: 'keiripass1', role: 'acct' });
await call(hq, 'PUT', '/api/admin/hq/areas', { areas: [{ name: '見本エリア', stores: ['S001'] }] });
await call(hq, 'POST', '/api/admin/hq/accounts', { code: 'mg1', name: '見本 MG', password: 'mgpass123', role: 'mg', area: '見本エリア' });
await call(hq, 'PUT', '/api/admin/hq/stores', { code: 'S002', action: 'update', hqOnly: true });
const acct = (await login('keiri1', 'keiripass1')).cookie, mg = (await login('mg1', 'mgpass123')).cookie;
ok('経理も本部専用の店舗の窓口集計を見られる', (await call(acct, 'GET', '/api/admin/madoguchi?store=S002')).status === 200);
ok('管轄MG も本部専用の店舗の窓口集計を見られる（見るだけ）', (await call(mg, 'GET', '/api/admin/madoguchi?store=S002')).status === 200);
const al = JSON.parse((await call(acct, 'GET', '/api/admin/acct/madoguchi')).text);
ok('窓口集計（全店）の一覧に本部専用の店舗も出る', JSON.stringify(al).includes('S002'));
ok('経理は全店状況を使えない', (await call(acct, 'GET', '/api/admin/hq/overview')).status === 403);
await call(hq, 'PUT', '/api/admin/hq/stores', { code: 'S002', action: 'update', hqOnly: false });
ok('経理も自分のパスワードは変えられる', (await call(acct, 'PATCH', '/api/admin/store', { current: 'keiripass1', next: 'keiripass2' })).status === 200);
// 管理者（HQ）のパスワードは HQ 本人だけ
await call(hq, 'POST', '/api/admin/hq/accounts', { code: 'hq2', name: '見本 本部', password: 'hq2pass123', role: 'hq', canManage: true });
const hq2 = (await login('hq2', 'hq2pass123')).cookie;
const owner = JSON.parse((await call(hq2, 'GET', '/api/admin/hq/accounts')).text).accounts.find((x) => x.code === 'HQ');
ok('ほかの管理者は HQ のパスワードを変えられない', (await call(hq2, 'PUT', '/api/admin/hq/accounts', { id: owner.id, password: 'takeover123' })).status === 403);

// ---- 4. 店舗切替・ログアウト：ほかのサイトからのフォーム送信は受け付けない
const sw = await fetch(`${B}/api/admin/switch`, { method: 'POST', redirect: 'manual', headers: { Cookie: hq, 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://evil.example' }, body: 'store=S001&back=/admin' });
ok('ほかのサイトからの店舗切替は断る', sw.status === 403, String(sw.status));
const sw2 = await fetch(`${B}/api/admin/switch`, { method: 'POST', redirect: 'manual', headers: { Cookie: hq, 'Content-Type': 'application/x-www-form-urlencoded', Origin: B }, body: 'store=S001&back=/admin' });
ok('自分の画面からの店舗切替は使える', sw2.status === 303, String(sw2.status));

// ---- 5. CSV の数式・二重予約の文言・ヘッダー
const s1 = (await login('S001', 'password')).cookie;
let D;
{ const s = new Date(); s.setDate(s.getDate() + 3); const j = await (await fetch(`${B}/api/public/S001/week?start=${s.toISOString().slice(0, 10)}&kind=NEW`)).json(); D = j.days.find((d) => d.label === null && d.slots.some((x) => x.status === 'open'))?.date; }
const slot = (await (await fetch(`${B}/api/public/S001/week?start=${D}&kind=NEW`)).json()).days.find((d) => d.date === D).slots.find((x) => x.status === 'open').time;
const rs = await fetch(`${B}/api/public/S001/reserve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'NEW', date: D, time: slot, name: '=HYPERLINK("x")', phone: '09012345678' }) });
ok('予約できる（見本）', rs.status === 200, String(rs.status));
const dup = await fetch(`${B}/api/public/S001/reserve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'NEW', date: D, time: slot, name: '=HYPERLINK("x")', phone: '09012345678' }) });
const dupMsg = (await dup.json()).error ?? '';
ok('二重予約の文言に時刻を出さない', dup.status === 409 && !/\d{1,2}:\d{2}/.test(dupMsg), dupMsg);
const csv = (await call(s1, 'GET', `/api/admin/reservations/export?tab=web&from=${D}&to=${D}&format=csv`)).text;
ok('CSV では = で始まる氏名の頭に \' を付ける', csv.includes(`"'=HYPERLINK(""x"")"`) || csv.includes(`'=HYPERLINK`), csv.split('\n').slice(0, 3).join(' / '));
const home = await fetch(`${B}/s/S001`);
ok('画面に CSP（埋め込み禁止など）', (home.headers.get('content-security-policy') ?? '').includes("frame-ancestors 'self'"));
ok('合言葉が見本のままの cron は動かない', (await fetch(`${B}/api/cron/cleanup?token=change-me`)).status === 401);
const adm = await fetch(`${B}/admin/login`);
ok('管理画面はほかのサイトに埋め込めない', adm.headers.get('x-frame-options') === 'SAMEORIGIN' && (adm.headers.get('content-security-policy') ?? '').includes("frame-ancestors 'self';"));
