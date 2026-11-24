// Xserver（PHP）版：離反者リストの正確さ（店舗から「まだ通院している方が載る・離反した方が載らない」とのご指摘の直し）
// ・離反の日の前日に来院した方は離反にしない（当日の来院は離反：集計API の説明と同じ）
// ・同じ人の来院がカルテNo の違い（打ち間違いなど）と氏名だけに分かれても、あとの来院を見落とさない（1 人を何行にも出さない）
// ・手で理由を入れた行は、人の見分け方が変わっても 2 行にしない
// ・あとで予約表に名前がある（来院チェックなし・次の予約）方を画面で知らせる。「離反ではない」で数えずに下へ
// ・患者様を調べる（システムが見ている来院と来院チェックの有無）
// 例：BASE_URL=http://127.0.0.1:3003 CHROMIUM_PATH=... node e2e/churnfix.mjs
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003';
const DB = process.env.DB_NAME ?? 'booking';
const sql = (q) => execSync(`mysql -uroot --default-character-set=utf8mb4 -N ${DB}`, { input: q }).toString().trim();
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const p = await br.newPage({ viewport: { width: 1366, height: 900 } });
p.on('dialog', (d) => d.accept());
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const api = (m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);
sql('DELETE FROM rate_limit');
await p.goto(B + '/admin/login/S001'); await p.fill('input[type=password]', 'password'); await p.click('button[type=submit]'); await p.waitForURL((u) => !u.pathname.includes('/login'));
const today = (await api('GET', '/api/admin/me'))[1].today;
const add = (d, n) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const ym = add(`${today.slice(0, 7)}-01`, -1).slice(0, 7), prevYm = add(`${ym}-01`, -1).slice(0, 7);
const sid = sql("SELECT id FROM store WHERE code='S001'");
let n = 0;
const cell = (date, text, visited = 1, time = 540) => sql(`INSERT INTO cell (id, storeId, date, time, bed, text, visited) VALUES ('cf${String(++n).padStart(10, '0')}', '${sid}', '${date}', ${time + n * 0}, ${(n % 6) + 1}, '${text}', ${visited}) ON DUPLICATE KEY UPDATE text = VALUES(text), visited = VALUES(visited)`);
sql(`DELETE FROM cell WHERE storeId='${sid}' AND text LIKE '%見本%'; DELETE FROM churn WHERE storeId='${sid}'; DELETE FROM visit_archive WHERE storeId='${sid}'`);
// 一郎：前月 10 日に来院 → 今月 9 日（離反の日の前日）に来院（離反ではない）
cell(`${prevYm}-10`, '見本 一郎'); cell(`${ym}-09`, '見本 一郎', 1, 600);
// 三郎：カルテNo を打ち間違えた来院（9003・9004）と、氏名だけの来院（20 日）。最後は 20 日 → 離反は 1 行だけ
cell(`${prevYm}-12`, '9003 見本 三郎', 1, 630); cell(`${prevYm}-15`, '9004 見本 三郎', 1, 630); cell(`${prevYm}-20`, '見本 三郎', 1, 630);
// 四郎：前月 8 日に来院チェックあり → 今月 1 日に予約表に名前（来院チェックなし）
cell(`${prevYm}-08`, '見本 四郎', 1, 660); cell(`${ym}-01`, '見本 四郎', 0, 660);
// 六郎・七郎：前月に来院、今日から先に次の予約がある（離反から外す）
cell(`${prevYm}-11`, '見本 六郎', 1, 720); cell(add(today, 3), '見本 六郎', 0, 720);
cell(`${prevYm}-13`, '見本 七郎', 1, 750); cell(add(today, 4), '見本 七郎', 0, 750);
// 五郎：前は「見本 五郎様6」の書き方で人を見分けていた。そのときに理由を入れた行（手で直した行）が残っている
cell(`${prevYm}-09`, '見本 五郎様6', 1, 690);
sql(`INSERT INTO churn (id, storeId, churnDate, patientKey, lastVisit, cardNo, name, source, edited, reason) VALUES ('cfold5', '${sid}', '${ym}-09', 'n:見本五郎様6', '${prevYm}-09', '', '見本 五郎様6', 'auto', 1, '見本の理由')`);
// 八郎：離反の日の当日に来院 → 離反のまま（再来として出す）
cell(`${prevYm}-14`, '見本 八郎', 1, 780); cell(`${ym}-14`, '見本 八郎', 1, 780);
// 九子：患者一覧（フリガナ）で、ひらがなで書いた来院も同じ番号の方につながる
await api('POST', '/api/admin/patients', { rows: [{ no: '009501', name: '見本 九子', kana: 'ミホン キュウコ' }] });
cell(`${prevYm}-06`, '見本 九子', 1, 810); cell(`${prevYm}-16`, 'みほん きゅうこ', 1, 810);

const get = async () => (await api('GET', `/api/admin/churn?month=${ym}`))[1];
let d = await get();
const names = d.rows.map((r) => r.name);
ok('離反の日の前日に来院した方は離反にしない', !names.some((x) => x.includes('一郎')), JSON.stringify(names));
ok('カルテNo の違い・氏名だけに分かれた来院でも 1 人 1 行（最後の来院から）', d.rows.filter((r) => r.name.includes('三郎')).length === 1 && d.rows.find((r) => r.name.includes('三郎'))?.lastVisit === `${prevYm}-20`, JSON.stringify(d.rows.filter((r) => r.name.includes('三郎')).map((r) => [r.cardNo, r.lastVisit])));
const goro = d.rows.filter((r) => r.name.includes('五郎'));
ok('手で理由を入れた行は、見分け方が変わっても 2 行にしない（理由は残る）', goro.length === 1 && goro[0].reason === '見本の理由', JSON.stringify(goro.map((r) => [r.name, r.reason])));
const shiro = d.rows.find((r) => r.name.includes('四郎'));
ok('あとで予約表に名前（来院チェックなし）を知らせる', shiro?.after?.uncheckedAfter === `${ym}-01`, JSON.stringify(shiro?.after));
ok('次の予約がある方は離反から外す（下に別に出す）', !d.rows.some((r) => /六郎|七郎/.test(r.name)) && d.booked.some((r) => r.name.includes('六郎') && r.bookedDate === add(today, 3)) && d.booked.some((r) => r.name.includes('七郎')), JSON.stringify(d.booked.map((r) => [r.name, r.bookedDate])));
// 六郎：来院しないまま予約日が過ぎた → リストに戻る／七郎：予約どおり来院 → 外したまま
sql(`UPDATE cell SET date = '${add(today, -1)}' WHERE storeId='${sid}' AND text='見本 六郎' AND visited = 0`);
sql(`UPDATE cell SET date = '${add(today, -1)}', visited = 1 WHERE storeId='${sid}' AND text='見本 七郎' AND visited = 0`);
d = await get();
ok('来院しないまま予約日が過ぎたらリストに戻る', d.rows.some((r) => r.name.includes('六郎')) && !d.booked.some((r) => r.name.includes('六郎')), JSON.stringify(d.booked.map((r) => r.name)));
ok('予約どおり来院したら外したまま', d.booked.some((r) => r.name.includes('七郎')) && !d.rows.some((r) => r.name.includes('七郎')));
const hachi = d.rows.find((r) => r.name.includes('八郎'));
ok('離反の日の当日に来院した方は離反のまま（あとの来院は再来）', !!hachi && hachi.after?.seenAfter === `${ym}-14`, JSON.stringify(hachi?.after));
const kyu = d.rows.filter((r) => r.cardNo === '9501');
ok('患者一覧のフリガナで、ひらがなの来院も同じ番号につながる（1 人・最後の来院から）', kyu.length === 1 && kyu[0].lastVisit === `${prevYm}-16`, JSON.stringify(d.rows.filter((r) => /九子|きゅうこ/.test(r.name)).map((r) => [r.name, r.cardNo, r.lastVisit])));
const before = d.stats.count;

// 画面
await p.goto(`${B}/admin/churn?month=${ym}`); await p.waitForSelector('table[aria-label="離反者リスト"]');
ok('画面：あとで名前がある方の件数が出る', await p.getByLabel('あとで予約表に名前がある方').isVisible());
ok('画面：行に「名前あり（チェックなし）」が出る', (await p.locator('table[aria-label="離反者リスト"]').innerText()).includes('名前あり（チェックなし）'));
ok('画面：離反のあとに来院した方は「再来」', (await p.locator('table[aria-label="離反者リスト"]').innerText()).includes(`${Number(ym.slice(5))}/14 再来`));
// 「離反ではない」
const row = p.locator('table[aria-label="離反者リスト"] tbody tr:has(input[value="見本 四郎"])');
await row.getByRole('button', { name: '離反ではない' }).click(); await p.waitForTimeout(1200);
d = await get();
ok('「離反ではない」で数えなくなる', d.stats.count === before - 1 && !d.rows.some((r) => r.name.includes('四郎')) && d.dismissed.some((r) => r.name.includes('四郎')), `${before}→${d.stats.count}`);
ok('「離反ではない」にした方は下に出る', await p.getByText(/「離反ではない」にした方 1 名/).isVisible());
await p.getByText(/「離反ではない」にした方/).click();
await p.getByRole('button', { name: 'リストに戻す' }).click(); await p.waitForTimeout(1200);
ok('リストに戻せる', (await get()).stats.count === before);

// 患者様を調べる
await p.getByText('患者様を調べる').click();
await p.getByLabel('調べる氏名かカルテNo').fill('見本 四郎'); await p.getByRole('button', { name: '調べる' }).click(); await p.waitForTimeout(800);
const res = await p.locator('details[aria-label="患者様を調べる"]').innerText();
ok('調べる：来院チェックのない日が分かる', res.includes('なし（数えていない）') && res.includes('離反者リストに載っています'), res.slice(0, 300));
const lk = (await api('GET', `/api/admin/churn/lookup?q=9004`))[1];
ok('調べる：カルテNo でも探せる', lk.rows.length === 1 && lk.rows[0].text.includes('三郎'), JSON.stringify(lk.rows));
ok('調べる：1 文字では探さない', (await api('GET', '/api/admin/churn/lookup?q=' + encodeURIComponent('見')))[0] === 400);
ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
sql(`DELETE FROM cell WHERE id LIKE 'cf%'; DELETE FROM churn WHERE storeId='${sid}'`);
await br.close();
console.log(process.exitCode ? 'CHURNFIX FAILED' : 'CHURNFIX OK');
