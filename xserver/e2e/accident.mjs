// Xserver（PHP）版：新自（交通事故）の事故日・事故内容の一覧（継続率の下）と未入力の数、来院チェックでのメール通知、相談LINEのバナー
// 例：BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... CHROMIUM_PATH=... MAIL_LOG=/tmp/natsume-mail.log node e2e/accident.mjs
// （PHP のサーバーも同じ MAIL_LOG で起動しておく：メールを送らずにそのファイルに書く）
import { createRequire } from 'node:module';
import fs from 'node:fs';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003';
const LOG = process.env.MAIL_LOG ?? '/tmp/natsume-mail.log';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
const errs = [];
async function login(code, pass, user, viewport = { width: 1300, height: 1000 }) {
  const ctx = await br.newContext({ viewport });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  if (user) { await p.goto(`${B}/admin/login`); await p.fill('input[autocomplete="username"]', user); } else await p.goto(`${B}/admin/login/${code}`);
  await p.fill('input[type=password]', pass); await p.click('button[type=submit]'); await p.waitForURL(/admin\//); await p.waitForTimeout(500);
  return p;
}
const api = (p, m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);
const mails = () => { try { return fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };

const hq = await login('', process.env.HQ_PASSWORD ?? 'hq-pass', 'HQ');
await api(hq, 'PUT', '/api/admin/hq/areas', { areas: [{ name: '静岡エリア', stores: ['S001'] }, { name: '東部エリア', stores: ['S002'] }] });
ok('正しくないメールアドレスは保存できない', (await api(hq, 'PUT', '/api/admin/hq/jibai-notify', { rows: [{ area: '', email: 'nope', label: '' }] }))[0] === 400);
ok('送り先を保存', (await api(hq, 'PUT', '/api/admin/hq/jibai-notify', { rows: [{ area: '', email: 'all@example.com', label: '本部' }, { area: '静岡エリア', email: 'mg-s@example.com', label: '静岡MG' }, { area: '東部エリア', email: 'mg-t@example.com', label: '東部MG' }] }))[0] === 200);
fs.rmSync(LOG, { force: true });
const t = await api(hq, 'POST', '/api/admin/hq/jibai-notify/test');
ok('試しのメール（3 件）', t[0] === 200 && t[1].sent === 3 && mails().length === 1 && mails()[0].to.length === 3, JSON.stringify(t));
ok('相談LINE：https 以外は保存できない', (await api(hq, 'PUT', '/api/admin/hq/consult-line', { url: 'http://lin.ee/x' }))[0] === 400);
ok('相談LINE：URL を保存', (await api(hq, 'PUT', '/api/admin/hq/consult-line', { url: 'https://lin.ee/sample123' }))[0] === 200);
await api(hq, 'PUT', '/api/admin/hq/stores-page', { open: true });
// 本部の画面に設定の欄
await hq.goto(`${B}/admin/hq`); await hq.waitForTimeout(800);
ok('本部の画面に通知・相談LINEの欄', await hq.getByRole('region', { name: '新自の通知と相談LINE' }).isVisible() && (await hq.getByLabel('相談LINEのURL').inputValue()) === 'https://lin.ee/sample123');

// 店舗：今日と昔の日に（初自）を入れて来院チェック
const st = await login('S001', 'password');
const today = (await api(st, 'GET', '/api/admin/me'))[1].today;
const OLD = '2026-09-01';
fs.rmSync(LOG, { force: true });
await api(st, 'PUT', '/api/admin/cells', { date: today, cells: [{ time: 540, bed: 1, text: '見本 太郎（初自）' }] });
await api(st, 'PUT', '/api/admin/cells', { date: OLD, cells: [{ time: 540, bed: 1, text: '試験 花子（初自）' }] });
await api(st, 'PUT', '/api/admin/visit', { date: today, time: 540, bed: 1, visited: true });
await api(st, 'PUT', '/api/admin/visit', { date: OLD, time: 540, bed: 1, visited: true });
let m = mails();
ok('今日の新自の来院でメール 1 通（昔の日は送らない）', m.length === 1, JSON.stringify(m.map((x) => x.subject)));
ok('送り先は全店の分と、その店舗のエリアの分だけ', m[0] && m[0].to.sort().join() === 'all@example.com,mg-s@example.com', m[0]?.to.join());
ok('件名・本文（患者様は名字だけ。件名には出さない）', m[0] && m[0].subject.includes('【新自】') && m[0].body.includes('サンプル本店') && m[0].body.includes('患者様：見本 様') && !m[0].body.includes('太郎') && !m[0].subject.includes('見本'), m[0]?.body);
// チェックを外して付け直しても、もう一度は送らない
await api(st, 'PUT', '/api/admin/visit', { date: today, time: 540, bed: 1, visited: false });
await api(st, 'PUT', '/api/admin/visit', { date: today, time: 540, bed: 1, visited: true });
ok('付け直しても二重に送らない', mails().length === 1);

// 未入力の数（前の月も含めて）
await api(st, 'GET', `/api/admin/karte?month=${OLD.slice(0, 7)}`); // 昔の月の行を作る
const me1 = (await api(st, 'GET', '/api/admin/me'))[1];
ok('未入力の数（前の月も含めて 2 件）', me1.accidentMissing === 2, String(me1.accidentMissing));
await st.goto(`${B}/admin/karte`); await st.waitForTimeout(1200);
const sec = st.getByRole('region', { name: '新自（交通事故）' });
ok('継続率の下に新自の一覧（この月の分＋ほかの月の未入力）', await sec.isVisible() && (await sec.textContent()).includes('見本 太郎') && (await sec.textContent()).includes('ほかの月の未入力（1件）') && (await sec.textContent()).includes('未入力 2件'));
ok('メニューに赤い数字', (await st.getByRole('link', { name: /新患継続率/ }).first().textContent()).includes('2'));
// 今日の行の事故日・事故内容を入れる（9/18 → 初診日より前の日）
const row = sec.locator('tr', { hasText: '見本 太郎' });
await row.getByLabel('事故日').fill('9/18'); await row.getByLabel('事故日').press('Enter'); await st.waitForTimeout(500);
await row.getByLabel('事故内容').fill('信号待ちで停車中に後ろから追突された'); await row.getByLabel('事故内容').blur(); await st.waitForTimeout(1200);
const k = (await api(st, 'GET', `/api/admin/karte?month=${today.slice(0, 7)}`))[1].rows.find((r) => r.kind === 'ACCIDENT');
ok('事故日・事故内容が保存される（事故日は初診日より前の日）', k.accidentDate === `${Number(today.slice(5, 7)) >= 9 ? today.slice(0, 4) : Number(today.slice(0, 4)) - 1}-09-18` && k.accidentNote === '信号待ちで停車中に後ろから追突された', JSON.stringify([k.accidentDate, k.accidentNote]));
ok('未入力が 1 件に減り、メニューの数字も変わる', (await sec.textContent()).includes('未入力 1件') && (await st.getByRole('link', { name: /新患継続率/ }).first().textContent()).includes('1'));
ok('ほかの月の行もここで入れられる', await sec.locator('tr', { hasText: '試験 花子' }).getByLabel('事故内容').isVisible());

// 患者様のページ：店舗えらびの上・予約ページのいちばん下（どの段階でも）
const pub = await (await br.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })).newPage();
pub.on('pageerror', (e) => errs.push(e.message));
await pub.goto(`${B}/stores`); await pub.waitForTimeout(1200);
const b1 = pub.getByRole('link', { name: /交通事故のご相談はLINEで/ });
ok('店舗えらびにバナー（URL・1 行）', (await b1.getAttribute('href')) === 'https://lin.ee/sample123' && (await b1.boundingBox()).height < 60, JSON.stringify(await b1.boundingBox()));
await pub.goto(`${B}/s/S001`); await pub.waitForTimeout(1500);
const b2 = pub.getByRole('link', { name: /交通事故のご相談はLINEで/ });
const bb = await b2.boundingBox();
ok('予約ページのいちばん下に出し続ける', (await b2.getAttribute('href')) === 'https://lin.ee/sample123' && bb.y + bb.height > 844 - 70 && bb.y + bb.height <= 844, JSON.stringify(bb));
await pub.mouse.wheel(0, 1500); await pub.waitForTimeout(400);
const bb2 = await b2.boundingBox();
ok('スクロールしても下に出たまま', Math.abs(bb2.y - bb.y) < 2, JSON.stringify(bb2));
const tel = pub.getByRole('link', { name: /お電話で予約・変更・キャンセル/ });
const tb = await tel.boundingBox();
ok('電話（予約・変更・キャンセル）も同じ帯に並ぶ・帯は低い', (await tel.getAttribute('href')).startsWith('tel:') && Math.abs(tb.y - bb.y) < 2 && bb.height <= 44, JSON.stringify([tb, bb]));
// いちばん下までスクロールしても、ページの電話の欄は帯に隠れない
await pub.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await pub.waitForTimeout(400);
const big = await pub.locator('main a[href^="tel:"]').last().boundingBox();
ok('ページの下の電話の欄が帯に隠れない', big.y + big.height <= tb.y - 4, JSON.stringify([big, tb]));
// 日時を選ぶと、選んだ日時の帯は下の帯の上に出る（重ならない）
await pub.evaluate(() => window.scrollTo(0, 0));
await pub.getByRole('button', { name: /はじめての方/ }).first().click().catch(() => {});
await pub.locator('table.wk tbody button').first().click(); await pub.waitForTimeout(500);
const sh = await pub.locator('.wk-sheet').boundingBox();
ok('選んだ日時の帯は下の帯の上（重ならない）', sh && sh.y + sh.height <= tb.y + 1, JSON.stringify([sh, tb]));
// URL を消すとバナーは出ない
await api(hq, 'PUT', '/api/admin/hq/consult-line', { url: '' });
await pub.goto(`${B}/s/S001`); await pub.waitForTimeout(1200);
ok('URL を消すと LINE は出ない（電話だけ横いっぱい）', (await pub.getByRole('link', { name: /交通事故のご相談はLINEで/ }).count()) === 0 && (await pub.getByRole('link', { name: /お電話で予約・変更・キャンセル/ }).boundingBox()).width > 300);
await api(hq, 'PUT', '/api/admin/hq/stores-page', { open: false });
ok('画面のエラーなし', errs.length === 0, errs.join(' / '));
await br.close();
