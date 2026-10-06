// Xserver（PHP）版：新規の同時対応数と予約表のブロックの確認（サンプル店舗 S001 を使う）
// 例：BASE_URL=http://127.0.0.1:3003 node e2e/rules.mjs
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003';
let cookie = '';
const req = async (m, u, b) => {
  const r = await fetch(B + u, { method: m, headers: { 'Content-Type': 'application/json', cookie }, body: b ? JSON.stringify(b) : undefined, redirect: 'manual' });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return [r.status, await r.json().catch(() => null)];
};
const ok = (label, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'} ${label} ${extra}`); if (!cond) process.exitCode = 1; };

await req('POST', '/api/admin/login', { code: 'S001', password: 'password' });
// 2 週間後以降の平日で、まだ予約の無い日を使う
const now = new Date(Date.now() + 9 * 3600e3);
let date;
for (let i = 14; i < 60; i++) {
  const x = new Date(now.getTime() + i * 864e5);
  if (x.getUTCDay() < 1 || x.getUTCDay() > 5) continue;
  const d = x.toISOString().slice(0, 10);
  const day = (await req('GET', `/api/admin/day?date=${d}`))[1]?.data;
  if (day && day.cells.length === 0 && day.blocks.length === 0 && day.times.includes(600)) { date = d; break; }
}
const slots = async (kind) => Object.fromEntries((await req('GET', `/api/public/S001/slots?date=${date}&kind=${kind}`))[1].slots.map((s) => [s.time, s.status]));
const st = (await req('GET', '/api/admin/settings'))[1].store;

// 新規の同時対応数 = 1
ok('同時対応数を保存', (await req('PUT', '/api/admin/store', { ...st, maxNewConcurrent: 1, hoursOverride: null }))[0] === 200);
ok('上限前は通常どおり（電話マークにならない）', (await slots('NEW'))[600] === 'open');
ok('新規を 10:00 に予約', (await req('POST', '/api/public/S001/reserve', { kind: 'NEW', date, time: 600, name: '規則 一', phone: '09011112222' }))[0] === 200);
let n = await slots('NEW'), r = await slots('RETURN');
ok('重なる時間の新規は×', n[585] === 'closed' && n[600] === 'closed' && n[615] === 'closed', JSON.stringify([n[585], n[600], n[615]]));
ok('重ならない時間の新規は〇', n[630] === 'open');
ok('通院中の方は影響なし', r[600] === 'open');
ok('2 人目の新規は受けない', (await req('POST', '/api/public/S001/reserve', { kind: 'NEW', date, time: 600, name: '規則 二', phone: '09033334444' }))[0] === 409);
await req('PUT', '/api/admin/store', { ...st, maxNewConcurrent: 0, hoursOverride: null });
ok('制限なしに戻すと〇', (await slots('NEW'))[600] === 'open');

// ブロック（ベッド単位）。顧客に見せる枠は 3（ベッド1〜3）
ok('ブロック追加（ベッド1〜3）', (await req('POST', '/api/admin/blocks', { date, start: 660, end: 705, beds: [1, 2, 3], label: '打合せ' }))[0] === 200);
r = await slots('RETURN');
ok('見せる枠のベッドを全部止めると×・終了時刻からは〇', r[660] === 'closed' && r[690] === 'closed' && r[705] === 'open', JSON.stringify([r[660], r[690], r[705]]));
n = await slots('NEW');
ok('新規はブロックにかかる直前も×', n[645] === 'closed' && n[630] === 'open', JSON.stringify([n[630], n[645]]));
ok('ベッド1だけ止める', (await req('POST', '/api/admin/blocks', { date, start: 1020, end: 1080, beds: [1] }))[0] === 200);
ok('1 台止めると残り 2（〇のまま）', (await slots('RETURN'))[1020] === 'open');
ok('ベッド2も止める', (await req('POST', '/api/admin/blocks', { date, start: 1020, end: 1080, beds: [2] }))[0] === 200);
ok('2 台止めると残り 1（電話マーク）', (await slots('RETURN'))[1020] === 'phone');
ok('見せていないベッド6を止めても枠は減らない', (await req('POST', '/api/admin/blocks', { date, start: 1110, end: 1140, beds: [6] }))[0] === 200 && (await slots('RETURN'))[1110] === 'open');
ok('ベッド未選択は不可', (await req('POST', '/api/admin/blocks', { date, start: 900, end: 960, beds: [] }))[0] === 400);
ok('開始＞終了は不可', (await req('POST', '/api/admin/blocks', { date, start: 960, end: 900, beds: [1] }))[0] === 400);
const day = (await req('GET', `/api/admin/day?date=${date}`))[1].data;
ok('予約表にブロックが出る', day.blocks.length === 4 && day.blocks[0].label === '打合せ' && day.blocks[0].beds.join() === '1,2,3');
for (const b of day.blocks) await req('DELETE', '/api/admin/blocks', { id: b.id });
ok('解除すると〇', (await slots('RETURN'))[660] === 'open');
console.log(process.exitCode ? 'RULES FAILED' : 'RULES OK', date);
