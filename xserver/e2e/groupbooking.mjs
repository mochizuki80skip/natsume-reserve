// Xserver（PHP）版：WEB 予約でご家族（お連れ様）を一緒に予約（2〜4 名・みんな同じ日時／1人ずつ・全員取れたときだけ予約・
// お連れ様は「WEB で持てる予約の件数」に数えない・SMS は送らない・予約表の「お連れ様：氏名」・まとめてキャンセル）
// 例：BASE_URL=http://127.0.0.1:3003 CHROMIUM_PATH=... node e2e/groupbooking.mjs
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003', O = new URL('./', import.meta.url).pathname + 'out-';
const DB = process.env.DB_NAME ?? 'booking';
const sql = (q) => execSync(`mysql -uroot --default-character-set=utf8mb4 -N ${DB}`, { input: q }).toString().trim();
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const errs = [];
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const cp = await (await br.newContext({ viewport: { width: 420, height: 900 } })).newPage();
cp.on('pageerror', (e) => errs.push(e.message));
const pub = (path, body) => cp.evaluate(async ([p, b]) => { const r = await fetch(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); return [r.status, await r.json().catch(() => null)]; }, [path, body]);
const firstOpen = async () => {
  let slot = cp.locator('td.o button').first();
  for (let i = 0; i < 4 && (await slot.count()) === 0; i++) { await cp.getByRole('button', { name: '翌週 ›' }).click(); await cp.waitForTimeout(800); slot = cp.locator('td.o button').first(); }
  return slot;
};

// ---------- 1. みんな同じ日時（通院中＋はじめて） ----------
await cp.goto(`${B}/s/S001`); await cp.waitForSelector('table.wk tbody tr', { timeout: 15000 });
const party = cp.getByRole('group', { name: 'ご予約の人数' });
ok('人数の欄がある（最初は 1 名）', (await party.getByRole('button', { name: '1名' }).getAttribute('aria-pressed')) === 'true');
await party.getByRole('button', { name: '2名' }).click();
await cp.getByRole('group', { name: '来院区分' }).getByRole('button', { name: /ご通院したことがある方/ }).click();
await cp.getByRole('radiogroup', { name: 'ご来院の内容' }).getByRole('radio', { name: /現在通院中/ }).click(); await cp.waitForTimeout(600);
// お連れ様の区分を選ばずに進むと止まる
let slot = await firstOpen(); await slot.click();
await cp.getByRole('button', { name: 'この日時で予約へ進む' }).click(); await cp.waitForTimeout(400);
ok('お連れ様の区分が未選択なら進めない', (await cp.getByRole('alert').textContent()).includes('お連れ様の来院区分'));
await party.getByRole('radiogroup', { name: '2人目（お連れ様）の来院区分' }).getByRole('radio', { name: /はじめて（ケガ/ }).click(); await cp.waitForTimeout(900);
ok('同じ日時のときは「2名様ご一緒に取れる時間」の案内', await cp.getByRole('note', { name: '人数分の空き' }).isVisible());
slot = await firstOpen(); await slot.click();
await cp.getByRole('button', { name: 'この日時で予約へ進む' }).click(); await cp.waitForSelector('text=2人目（お連れ様）', { timeout: 10000 });
const sfx = String(Date.now()).slice(-4);
const lead = `見本 代表${sfx}`, comp = `見本 連れ${sfx}`;
await cp.locator('input[inputmode="numeric"]').first().fill('7001');
await cp.getByPlaceholder('例）山田 太郎').fill(lead);
await cp.getByPlaceholder('例）09012345678').fill('09055556666');
await cp.getByRole('group', { name: '2人目（お連れ様）' }).getByPlaceholder('例）山田 花子').fill(comp);
ok('お連れ様に電話番号の欄はない', (await cp.getByRole('group', { name: '2人目（お連れ様）' }).locator('input[type=tel]').count()) === 0);
await cp.getByRole('button', { name: '入力内容を確認する' }).click(); await cp.waitForSelector('text=ご予約内容の確認');
ok('確認画面に 2人目と「全員分を取らずに」の案内', await cp.getByLabel('2人目（お連れ様）の確認').isVisible() && await cp.getByRole('note', { name: 'まとめての予約の案内' }).isVisible());
await cp.screenshot({ path: O + 'group-confirm.png', fullPage: true });
await cp.getByRole('button', { name: '2名分を予約する' }).click(); await cp.waitForSelector('text=ご予約が確定しました', { timeout: 10000 });
const doneList = cp.getByRole('list', { name: 'お取りしたご予約' });
ok('完了画面に 2 人の予約', (await doneList.textContent()).includes(lead) && (await doneList.textContent()).includes(comp));
const rows = sql(`SELECT name, date, time, bed, groupId = id, groupId IS NOT NULL, COALESCE(smsStatus, '') FROM reservation WHERE phone = '+819055556666' ORDER BY groupId = id DESC`).split('\n').map((l) => l.split('\t'));
ok('2 件・同じ日時・別のベッド・同じグループ', rows.length === 2 && rows[0][1] === rows[1][1] && rows[0][2] === rows[1][2] && rows[0][3] !== rows[1][3] && rows[0][4] === '1' && rows[1][4] === '0' && rows[1][5] === '1', JSON.stringify(rows));
ok('SMS は送らない', rows.every((r) => r[6] === 'SKIPPED'));
const [D, T] = [rows[0][1], Number(rows[0][2])];
ok('この端末の「ご予約の確認」に 2 件', (await cp.evaluate(() => JSON.parse(localStorage.getItem('natsume.myReservations') ?? '[]').length)) >= 2);

// ---------- 2. お連れ様は「WEB で持てる予約の件数」に数えない ----------
sql("UPDATE store SET maxActiveBookings = 1 WHERE code = 'S001';");
// 別の日の空いている時間（同じ日は「同じお名前の予約がすでにある」で断られるため）
const wk0 = await cp.evaluate(async ([d]) => { const a = await (await fetch(`/api/public/S001/week?kind=RETURN&start=${d}`)).json(); const n = new Date(`${d}T00:00:00Z`); n.setUTCDate(n.getUTCDate() + 7); const b = await (await fetch(`/api/public/S001/week?kind=RETURN&start=${n.toISOString().slice(0, 10)}`)).json(); return [...a.days, ...b.days]; }, [D]);
const od = wk0.find((x) => x.date > D && x.slots.some((s) => s.status === 'open'));
const other = od.date, otherT = od.slots.find((s) => s.status === 'open').time;
const tryOne = (name) => pub('/api/public/S001/reserve', { kind: 'RETURN', date: other, time: otherT, name, phone: '09055556666', cardNo: '9' });
ok('1人目は 1 件持っているので、上限 1 件だと取れない', (await tryOne(lead))[0] === 409);
const c1 = await tryOne(comp);
ok('お連れ様の分は数えないので、お連れ様ご本人の予約は取れる', c1[0] === 200, JSON.stringify(c1[1]));
sql("UPDATE store SET maxActiveBookings = 4 WHERE code = 'S001';");

// ---------- 3. 全員取れなければ誰も取らない（API） ----------
const before = sql("SELECT COUNT(*) FROM reservation");
const many = [1, 2, 3, 4].map((i) => ({ kind: 'RETURN', date: D, time: T, name: `試験 満員${i}`, cardNo: String(i) }));
const r3 = await pub('/api/public/S001/reserve-group', { phone: '09077778888', people: many });
ok('同じ時間に入りきらない 4 名 → 409・1 件も入らない', r3[0] === 409 && sql("SELECT COUNT(*) FROM reservation") === before, JSON.stringify(r3[1]));
ok('確認だけ（dryRun）は予約を残さない', (await pub('/api/public/S001/reserve-group', { dryRun: true, people: [{ kind: 'RETURN', date: D, time: T + 60 }, { kind: 'NEW', date: D, time: T + 60 }] }))[1]?.dryRun === true && sql("SELECT COUNT(*) FROM reservation") === before);
ok('5 名は断る', (await pub('/api/public/S001/reserve-group', { phone: '09077778888', people: [...many, { ...many[0], name: '試験 五' }] }))[0] === 400);
// 週の表：残り 1 枠の時間は、2 名一緒だと ×
const wk1 = await cp.evaluate(async ([d]) => (await (await fetch(`/api/public/S001/week?kind=RETURN&start=${d}`)).json()), [D]);
const wk2 = await cp.evaluate(async ([d]) => (await (await fetch(`/api/public/S001/week?kind=RETURN&group=RETURN&start=${d}`)).json()), [D]);
const st1 = wk1.days.find((x) => x.date === D).slots.find((x) => x.time === T).status, st2 = wk2.days.find((x) => x.date === D).slots.find((x) => x.time === T).status;
ok('週の表：1 名で取れる時間でも、2 名一緒に入らなければ ×', (st1 === 'few' && st2 === 'closed') || (st1 === 'open' && (st2 === 'open' || st2 === 'few')), `${st1} → ${st2}`);

// ---------- 4. 1人ずつ選ぶ（別の日時） ----------
await cp.goto(`${B}/s/S001`); await cp.waitForSelector('table.wk tbody tr', { timeout: 15000 });
await cp.evaluate(() => { try { localStorage.removeItem('natsume.patient'); } catch { /* */ } });
const party2 = cp.getByRole('group', { name: 'ご予約の人数' });
await party2.getByRole('button', { name: '2名' }).click();
await cp.getByRole('group', { name: '来院区分' }).getByRole('button', { name: /はじめての方/ }).click();
await cp.getByRole('radiogroup', { name: 'ご来院の内容' }).getByRole('radio', { name: /ケガ・痛み・不調など/ }).click();
await party2.getByRole('radiogroup', { name: '2人目（お連れ様）の来院区分' }).getByRole('radio', { name: /現在通院中/ }).click();
await party2.getByRole('radiogroup', { name: '日時の決め方' }).getByRole('radio', { name: '1人ずつ選ぶ' }).click(); await cp.waitForTimeout(800);
slot = await firstOpen(); await slot.click();
await cp.getByRole('button', { name: 'この日時で予約へ進む' }).click(); await cp.waitForSelector('text=お連れ様の日時を選んでください');
await cp.getByRole('group', { name: '2人目の日時' }).getByRole('button', { name: 'カレンダーから選ぶ' }).click(); await cp.waitForSelector('table.wk tbody tr');
ok('お連れ様のカレンダーには区分の欄が出ない', (await cp.getByRole('group', { name: '来院区分' }).count()) === 0 && (await cp.textContent('main')).includes('2人目（お連れ様・現在通院中）の日時'));
const opens = cp.locator('td.o button');
await opens.nth(Math.min(5, (await opens.count()) - 1)).click();
await cp.getByRole('button', { name: 'この日時で予約へ進む' }).click(); await cp.waitForSelector('text=お連れ様の日時を選んでください');
await cp.getByRole('button', { name: 'お名前の入力へ進む' }).click(); await cp.waitForSelector('text=2人目（お連れ様）');
await cp.getByPlaceholder('例）山田 太郎').fill(`見本 親${sfx}`);
await cp.getByPlaceholder('例）09012345678').fill('09012120000');
const g2 = cp.getByRole('group', { name: '2人目（お連れ様）' });
await g2.locator('input[inputmode="numeric"]').fill('8001');
await g2.getByPlaceholder('例）山田 花子').fill(`見本 子${sfx}`);
await cp.getByRole('button', { name: '入力内容を確認する' }).click(); await cp.waitForSelector('text=ご予約内容の確認');
await cp.getByRole('button', { name: '2名分を予約する' }).click(); await cp.waitForSelector('text=ご予約が確定しました', { timeout: 10000 });
const rows2 = sql(`SELECT kind, date, time FROM reservation WHERE phone = '+819012120000' ORDER BY groupId = id DESC`).split('\n').map((l) => l.split('\t'));
ok('1人ずつ：初診と通院中・別の日時', rows2.length === 2 && rows2[0][0] === 'NEW' && rows2[1][0] === 'RETURN' && (rows2[0][1] !== rows2[1][1] || rows2[0][2] !== rows2[1][2]), JSON.stringify(rows2));

// ---------- 5. 予約表：「お連れ様：氏名」・まとめてキャンセル ----------
const st = await (await br.newContext({ viewport: { width: 1366, height: 1000 } })).newPage();
st.on('pageerror', (e) => errs.push(e.message)); st.on('dialog', (d) => d.accept());
await st.goto(`${B}/admin/login/S001`); await st.fill('input[type=password]', 'password'); await st.click('button[type=submit]'); await st.waitForURL(/admin\//);
await st.goto(`${B}/admin/day/${D}`); await st.waitForSelector('#grid'); await st.waitForTimeout(600);
const compBed = rows[1][3], leadBed = rows[0][3];
const compCell = st.locator(`td[data-cell="${T}:${compBed}"]`);
ok('お連れ様のセルに「お連れ様：（1人目の氏名）」', (await compCell.getByLabel(`お連れ様：${lead}`).count()) === 1);
ok('1人目のセルには 👥', (await st.locator(`td[data-cell="${T}:${leadBed}"]`).getByLabel('お連れ様あり').count()) === 1);
await st.screenshot({ path: O + 'group-grid.png', clip: { x: 0, y: 0, width: 1366, height: 900 } });
const leadCell = st.locator(`td[data-cell="${T}:${leadBed}"]`);
await leadCell.hover(); await leadCell.getByLabel('メニュー', { exact: true }).click();
await st.getByText('キャンセル・予約変更…').click(); await st.waitForTimeout(500);
const dlg = st.getByRole('form', { name: 'キャンセル・予約変更' });
await dlg.getByRole('radio', { name: /キャンセル（連絡あり）/ }).click();
ok('キャンセルのときに「お連れ様もまとめてキャンセル」（お連れ様の名前）', (await dlg.textContent()).includes(comp));
await dlg.getByLabel('お連れ様もまとめてキャンセル').check();
await dlg.getByRole('button', { name: '名簿へ移す' }).click(); await st.waitForTimeout(1200);
const after = sql(`SELECT status FROM reservation WHERE phone = '+819055556666' AND groupId IS NOT NULL`).split('\n');
ok('2 人ともキャンセル', after.length === 2 && after.every((x) => x === 'CANCELLED'), after.join(','));
ok('キャンセル名簿に 2 件', Number(sql(`SELECT COUNT(*) FROM cancel_log WHERE date = '${D}' AND (name LIKE '%${sfx}%')`)) === 2);

ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
console.log(process.exitCode ? 'GROUPBOOKING FAILED' : 'GROUPBOOKING OK');
