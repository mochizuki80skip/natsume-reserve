// Xserver（PHP）版：「様」を自動で外す・初回カルテの氏名の確認（名字だけ・ひらがなだけ・カタカナだけ）（サンプル店舗 S001）
// 例：BASE_URL=http://127.0.0.1:3003 CHROMIUM_PATH=... node e2e/names.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
import { skipWhatsNew } from './seen.mjs';
const B = process.env.BASE_URL ?? 'http://127.0.0.1:3003', O = new URL('./', import.meta.url).pathname + 'out-';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
skipWhatsNew(br);
const p = await br.newPage({ viewport: { width: 1500, height: 1000 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l} ${x}`); if (!c) process.exitCode = 1; };
await p.goto(B + '/admin/login/S001'); await p.fill('input[type=password]', 'password'); await p.click('button[type=submit]'); await p.waitForURL(/admin\/day/);
const api = (m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)]; }, [m, u, b]);
const D = '2026-10-28';
const day = async () => (await api('GET', `/api/admin/day?date=${D}`))[1].data;
const textAt = (d, t, b) => d.cells.find((x) => x.time === t && x.bed === b)?.text ?? '';

// 1) 予約表：「様」を外す
await p.goto(`${B}/admin/day/${D}`); await p.waitForSelector('#grid');
await p.locator('td[data-cell="540:1"] input').click(); await p.keyboard.type('予測 変換様'); await p.keyboard.press('Tab'); await p.waitForTimeout(1000);
await p.locator('td[data-cell="555:1"] input').click(); await p.keyboard.type('予測 二郎 様（初診）'); await p.keyboard.press('Enter'); await p.waitForTimeout(1000);
let d = await day();
ok('「様」を外して保存', textAt(d, 540, 1) === '予測 変換' && textAt(d, 555, 1) === '予測 二郎（初診）', `${textAt(d, 540, 1)} / ${textAt(d, 555, 1)}`);
ok('画面でも外れる', (await p.locator('td[data-cell="540:1"] input').inputValue()) === '予測 変換');
await p.getByRole('button', { name: /^↶ 元に戻す（/ }).click(); await p.waitForTimeout(800);
ok('元に戻すは 1 回で入力前へ', (await p.locator('td[data-cell="555:1"] input').inputValue()) === '');
const wb = await api('POST', '/api/public/S001/reserve', { kind: 'NEW', date: D, time: 600, name: 'ウェブ 予約様', phone: '090' + String(Date.now()).slice(-8) });
d = await day();
ok('WEB予約の「様」も外す', wb[0] === 200 && d.cells.some((c) => c.text.startsWith('ウェブ 予約') && !c.text.includes('様')), JSON.stringify(d.cells.map((c) => c.text)));

// 2) 初回カルテの氏名の確認
const names = ['佐藤（初診）', 'やまだ はなこ（初診）', 'ジョン スミス（初診）', '鈴木 一郎（初診）'];
await api('PUT', '/api/admin/cells', { date: D, cells: names.map((n, i) => ({ time: 900 + i * 15, bed: 2, text: n })) });
for (let i = 0; i < names.length; i++) await api('PUT', '/api/admin/visit', { date: D, time: 900 + i * 15, bed: 2, visited: true });
await p.goto(`${B}/admin/karte?month=2026-10`); await p.waitForSelector('text=氏名の確認');
ok('上に件数', (await p.getByText(/氏名の確認 \d+件/).textContent()).includes('3件'), await p.getByText(/氏名の確認 \d+件/).textContent());
ok('名字だけ？', await p.getByRole('button', { name: '名字だけ？' }).isVisible());
ok('ひらがなのみ', await p.getByRole('button', { name: 'ひらがなのみ' }).isVisible());
ok('外国の方？（色を分ける）', (await p.getByRole('button', { name: '外国の方？' }).getAttribute('class')).includes('violet'));
await p.screenshot({ path: O + 'karte-names.png', clip: { x: 0, y: 0, width: 1500, height: 420 } });
await p.getByRole('button', { name: '外国の方？' }).click(); await p.getByRole('button', { name: 'この氏名で正しい' }).click(); await p.waitForTimeout(1000);
ok('正しいを押すと消える', (await p.getByRole('button', { name: '外国の方？' }).count()) === 0);
await p.reload(); await p.waitForSelector('text=氏名の確認');
ok('読み直しても消えたまま', (await p.getByRole('button', { name: '外国の方？' }).count()) === 0 && (await p.getByText(/氏名の確認 \d+件/).textContent()).includes('2件'));
const sato = p.locator('input[aria-label="氏名"][value="佐藤"]');
await sato.fill('佐藤 花子'); await sato.press('Enter'); await p.waitForTimeout(1000);
ok('直すと消える', (await p.getByRole('button', { name: '名字だけ？' }).count()) === 0);
ok('画面のエラーなし', errs.length === 0, JSON.stringify(errs));
await br.close();
