// Xserver（PHP）版：新患継続率にスプレッドシートの行を貼り付けて取り込む（上書き）／継続率の「年度（4月〜）」（サンプル店舗 S001・見本の名前だけ）
// 例：BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... CHROMIUM_PATH=... node e2e/karteimport.mjs
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

// 予約表から自動で入った 10 月の行（同じ人をスプレッドシートで上書きする）
await api('PUT', '/api/admin/cells', { date: '2026-10-02', cells: [{ time: 540, bed: 1, text: '見本 三郎（初診）' }] });
await api('PUT', '/api/admin/visit', { date: '2026-10-02', time: 540, bed: 1, visited: true });

const T = '\t';
const head1 = ['初回入力', '', '', '', '', '', '', '', '', '', '', '', '2回目', '', '', '3回目', '', '', '4回目', '', '', '5回目', '', '', '6回目', '', ''].join(T);
const head2 = ['日付', 'カルテNo', 'きっかけ', '内訳', '氏名', '新・再', '年齢', '性別', '症状ｶﾃｺﾞﾘｰ', '症状', '担当', '施術', ...Array(5).fill(['日付', '担当', '施術']).flat()].join(T);
const row = (a) => [...a, ...Array(27 - a.length).fill('')].join(T);
const tsv = [head1, head2,
  row(['4/3', '1203', 'チラシ', '', '見本 一郎', '新患', '45', '♂', '腰', '腰痛', '見本A', '矯正', '4/6', '見本A', '矯正', '4/10', '見本A', '矯正']),
  row(['4/5', '1204', 'みたことない', '', '見本 花子', '再', '62', '♀', '膝', '膝の痛み', '見本B', 'マッサ', '4/12', '見本B', 'マッサ']),
  row(['5/20', '1300', 'HP', '', '見本 四郎', '新患', '30', '♂', '首', '寝違え', '見本A', '矯正']),
  row(['10/2', '1500', 'HP', '', '見本 三郎', '新患', '50', '♂', '腰', 'ぎっくり腰', '見本A', '矯正', '10/5', '見本A', '矯正']),
  row(['4/31', '', '', '', '見本 五子']),
].join('\n');

// 1) 貼り付け → 確認
await p.goto(`${B}/admin/karte?month=2026-10`); await p.waitForSelector('text=新患継続率');
await p.getByRole('button', { name: '📋 スプレッドシートから貼り付け' }).click();
const dlg = p.getByRole('form', { name: 'スプレッドシートから貼り付け' });
await dlg.getByLabel('貼り付ける欄').fill(tsv);
await dlg.getByRole('button', { name: '内容を確認する' }).click();
await dlg.getByRole('table', { name: '取り込みの確認' }).waitFor();
const summary = await dlg.textContent();
ok('確認：新しく入る 3・上書き 1・読めない 1', /新しく入る 3 件・上書き 1 件・読めない 1 件/.test(summary), summary.match(/新しく入る.{0,40}/)?.[0]);
ok('読めない日付の理由', summary.includes('日付「4/31」が読めません'));
ok('選択肢にない言葉は黄色', (await dlg.locator('td.bg-yellow-200', { hasText: 'みたことない' }).count()) === 1);
await p.screenshot({ path: O + 'karte-import.png' });
const before = (await api('GET', '/api/admin/karte?month=2026-04'))[1].rows.length;
ok('確認だけでは入らない', before === 0);

// 2) 取り込む
await dlg.getByRole('button', { name: '4 件を取り込む' }).click();
await p.waitForURL(/month=2026-04/);
await p.waitForTimeout(800);
const apr = (await api('GET', '/api/admin/karte?month=2026-04'))[1].rows;
const a = apr.find((r) => r.name === '見本 一郎');
ok('4 月の行が入る', apr.length === 2 && a && a.karteNo === '1203' && a.age === 45 && a.treatment === '矯正' && a.visits[0].d === '2026-04-06' && a.visits[1].d === '2026-04-10' && !a.auto, JSON.stringify(a));
ok('再の人', apr.find((r) => r.name === '見本 花子')?.kind === 'REVISIT');
const oct = (await api('GET', '/api/admin/karte?month=2026-10'))[1].rows;
const s = oct.filter((r) => r.name === '見本 三郎');
ok('自動の行を上書き（重ねて入れない）', s.length === 1 && s[0].auto && s[0].karteNo === '1500' && s[0].symptom === 'ぎっくり腰' && s[0].visits[0].d === '2026-10-05', JSON.stringify(s));

// 3) もう一度：空の欄は今のまま・回の日付だけ足す
const [st, j] = await api('POST', '/api/admin/karte/import', { rows: [{ date: '2026-04-03', name: '見本 一郎', karteNo: '', age: null, visits: [{ d: '', s: '', t: '' }, { d: '', s: '', t: '' }, { d: '2026-04-20', s: '見本A', t: '矯正' }, { d: '', s: '', t: '' }, { d: '', s: '', t: '' }] }] });
const a2 = (await api('GET', '/api/admin/karte?month=2026-04'))[1].rows.find((r) => r.name === '見本 一郎');
ok('上書き：空の欄は残す・4回目を足す', st === 200 && j.counts.update === 1 && a2.karteNo === '1203' && a2.age === 45 && a2.visits[0].d === '2026-04-06' && a2.visits[2].d === '2026-04-20', JSON.stringify(a2.visits));
ok('日付・氏名がない行はエラー', (await api('POST', '/api/admin/karte/import', { rows: [{ name: 'x' }], dryRun: true }))[1].counts.error === 1);

// 4) 年度（4月〜）の継続率
await p.goto(`${B}/admin/karte?month=2026-10`); await p.waitForSelector('text=継続の状況');
await p.getByRole('group', { name: '継続率の期間' }).getByRole('button', { name: /2026年度/ }).click();
await p.waitForSelector('text=2026年度（2026年4月〜2027年3月）の初回 4名');
ok('年度の初回人数', true);
await p.screenshot({ path: O + 'karte-fy.png', fullPage: true });

// 5) 本部：新患・再来集計の「年度（4月〜）」
const h = await br.newPage({ viewport: { width: 1366, height: 900 } });
await h.goto(`${B}/admin/login`); await h.fill('input[autocomplete="username"]', 'HQ'); await h.fill('input[type=password]', process.env.HQ_PASSWORD ?? 'hqpass123'); await h.getByRole('button', { name: 'ログイン' }).click(); await h.waitForURL(/admin\//);
await h.goto(`${B}/admin/hq/karte`); await h.getByRole('button', { name: '年度（4月〜）' }).click();
await h.waitForSelector('text=2026年度');
const ht = await h.textContent('body');
ok('本部：年度の合計（4月〜）', /合計\s*4\s*前年度 0/.test(ht.replace(/\s+/g, ' ')), ht.replace(/\s+/g, ' ').match(/合計.{0,20}/)?.[0]);
ok('ページのエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
