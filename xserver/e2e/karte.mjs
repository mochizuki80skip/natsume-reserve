// Xserver（PHP）版：初回カルテ集計の確認（サンプル店舗 S001 と本部 HQ を使う）
// 例：BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... node e2e/karte.mjs
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003';
let cookie = '';
const req = async (m, u, b) => {
  const r = await fetch(B + u, { method: m, headers: { 'Content-Type': 'application/json', cookie }, body: b ? JSON.stringify(b) : undefined, redirect: 'manual' });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return [r.status, await r.json().catch(() => null)];
};
const ok = (label, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'} ${label} ${extra}`); if (!cond) process.exitCode = 1; };

await req('POST', '/api/admin/login', { code: 'S001', password: 'password' });
const date = '2026-11-16', ym = '2026-11';
const put = (time, bed, text) => req('PUT', '/api/admin/cells', { date, cells: [{ time, bed, text }] });
await put(540, 1, '山田 太郎（初診）'); await put(555, 1, '上記初診対応'); await put(600, 2, '鈴木 花子（初自）'); await put(660, 3, '佐藤 一（再）'); await put(720, 1, '田中 二');
let k = await req('GET', `/api/admin/karte?month=${ym}`);
ok('来院チェック前は入らない', k[0] === 200 && k[1].rows.length === 0);
for (const [t, b] of [[540, 1], [600, 2], [660, 3], [720, 1]]) await req('PUT', '/api/admin/visit', { date, time: t, bed: b, visited: true });
k = await req('GET', `/api/admin/karte?month=${ym}`);
const rows = k[1].rows;
ok('来院チェックした初診・初自・再だけ自動で入る', rows.length === 3, rows.map((r) => r.name).join(','));
ok('区分と氏名（印を外す）', rows[0].kind === 'NEW' && rows[0].name === '山田 太郎' && rows[1].kind === 'ACCIDENT' && rows[2].kind === 'REVISIT');
ok('初自は症状カテゴリーに自賠', rows[1].symptomCat === '自賠');
ok('選択肢がそろっている', k[1].options.trigger.length === 20 && k[1].options.otherBiz.length === 33 && k[1].options.symptom.length === 17 && k[1].options.revisitAction.join() === 'LINE,DM');
const visits = [{ d: '2026-11-18', s: '山本', t: '矯正' }, ...Array(4).fill({ d: '', s: '', t: '' })];
const p = await req('PATCH', '/api/admin/karte', { id: rows[0].id, patch: { name: '山田 太郎（漢字）', age: '45', sex: '♂', trig: '紹介他事業', trigDetail: 'East-one三島', visits } });
ok('入力を保存', p[0] === 200 && p[1].row.age === 45 && p[1].row.visits[0].d === '2026-11-18');
ok('年齢がおかしいと保存しない', (await req('PATCH', '/api/admin/karte', { id: rows[0].id, patch: { age: 'abc' } }))[0] === 400);
ok('施術内容は矯正／マッサだけ', (await req('PATCH', '/api/admin/karte', { id: rows[0].id, patch: { treatment: 'マッサージ' } }))[0] === 400);
await req('PUT', '/api/admin/visit', { date, time: 540, bed: 1, visited: false });
await req('PUT', '/api/admin/visit', { date, time: 660, bed: 3, visited: false });
k = await req('GET', `/api/admin/karte?month=${ym}`);
ok('チェックを外すと手を加えていない行は消え、直した行は残る', k[1].rows.map((r) => r.kind).join() === 'NEW,ACCIDENT', k[1].rows.map((r) => r.name).join());
const add = await req('POST', '/api/admin/karte', { date: '2026-11-20' });
ok('行を手で追加・削除', add[0] === 200 && (await req('DELETE', '/api/admin/karte', { id: add[1].row.id }))[0] === 200);
ok('自動の行は削除できない（来院チェックで管理）', (await req('DELETE', '/api/admin/karte', { id: k[1].rows[1].id }))[0] === 400);
const x = await fetch(`${B}/api/admin/karte/export?month=${ym}`, { headers: { cookie } });
ok('Excel で保存できる', x.status === 200 && (x.headers.get('content-type') ?? '').includes('spreadsheetml'));

cookie = '';
await req('POST', '/api/admin/login', { code: 'HQ', password: process.env.HQ_PASSWORD ?? 'hqpass123' });
const h = await req('GET', `/api/admin/hq/karte?from=${ym}-01&to=${ym}-30`);
ok('本部の集計に出る（氏名は返さない）', h[0] === 200 && h[1].rows.length === 2 && !('name' in h[1].rows[0]) && h[1].rows.find((r) => r.kind === 'NEW')?.reached[0] === true);
ok('店舗アカウントでは本部の集計は見られない', await (async () => { const c = cookie; cookie = ''; await req('POST', '/api/admin/login', { code: 'S001', password: 'password' }); const r = (await req('GET', `/api/admin/hq/karte?from=${ym}-01&to=${ym}-30`))[0]; cookie = c; return r === 403; })());
ok('エリアを保存', (await req('PUT', '/api/admin/hq/areas', { areas: [{ name: 'テストエリア', stores: ['S001', 'NOPE'] }] }))[0] === 200);
const o = await req('GET', '/api/admin/hq/karte/options');
ok('エリアは実在する店舗だけ', o[1].areas.length === 1 && o[1].areas[0].stores.join() === 'S001');
ok('選択肢を変更', (await req('PUT', '/api/admin/hq/karte/options', { category: 'revisitAction', labels: ['LINE', 'DM', 'ハガキ', ''] }))[1].options.revisitAction.join() === 'LINE,DM,ハガキ');
await req('PUT', '/api/admin/hq/karte/options', { category: 'revisitAction', labels: ['LINE', 'DM'] });
await req('PUT', '/api/admin/hq/areas', { areas: [] });
console.log(process.exitCode ? 'KARTE FAILED' : 'KARTE OK');
