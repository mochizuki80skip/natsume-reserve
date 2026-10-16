// SNS 投稿管理だけの設置（config.php の APP_MODE = 'sns'）で、予約の画面・API が出ないことを確認する
// 例：config.php に 'APP_MODE' => 'sns', 'BOOKING_URL' => 'https://yoyaku.example.jp' を入れて PHP を起動してから
//     BASE_URL=http://127.0.0.1:3003 HQ_PASSWORD=... node e2e/sns-only.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../frontend/package.json', import.meta.url))('playwright');
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3003';
const HQ_PASSWORD = process.env.HQ_PASSWORD ?? 'hq-pass-local';
const ok = (name, cond, extra = '') => { console.log(cond ? 'PASS' : 'FAIL', name, extra); if (!cond) process.exitCode = 1; };

const html = await (await fetch(`${BASE}/admin/login`)).text();
ok('画面に APP_MODE=sns が渡される', html.includes('window.APP_MODE="sns"'));
ok('予約の API は出ない', (await fetch(`${BASE}/api/public/S001/week?kind=NEW`)).status === 404);
ok('店舗名の取得（店舗別ログイン用）は残る', (await fetch(`${BASE}/api/public/S001/store`)).status === 200);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await (await browser.newContext()).newPage();
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`${BASE}/`); await page.waitForURL(/\/admin\/login/);
ok('トップはログインへ', (await page.textContent('h1')).includes('SNS投稿管理'));
await page.fill('input[autocomplete="username"]', 'HQ'); await page.fill('input[type="password"]', HQ_PASSWORD); await page.getByRole('button', { name: 'ログイン' }).click();
await page.waitForURL(/\/admin\/sns$/);
ok('ログイン後は SNS ホーム', true);
const nav = (await page.locator('header nav').textContent()).replace(/\s+/g, '');
const side = (await page.locator('aside').textContent()).replace(/\s+/g, '');
ok('メニューに予約表・シフト・自賠請求が無い', !nav.includes('予約表') && !nav.includes('シフト') && !nav.includes('自賠'));
ok('左メニューにホーム・下書き（全店）・手動投稿・カレンダー・店舗の一括設定・接続状況がある', side.includes('ホーム') && side.includes('下書き（全店）') && side.includes('手動投稿') && side.includes('カレンダー') && side.includes('店舗の一括設定') && side.includes('接続状況'));
ok('ヘッダーに店舗設定・店舗管理がある', nav.includes('店舗設定') && nav.includes('店舗管理'));
await page.goto(`${BASE}/admin/hq`); await page.waitForSelector('h1:has-text("店舗管理")');
ok('店舗管理に共通設定（営業時間）が無い', (await page.locator('text=全店共通設定').count()) === 0);
ok('店舗をまとめて登録がある', (await page.locator('text=店舗をまとめて登録').count()) === 1);
ok('店舗管理は SNS 用の画面（左メニュー付き）', page.url().endsWith('/admin/sns/stores') && (await page.locator('aside').count()) === 1);
ok('店舗管理にベッド・顧客URLが無い', (await page.locator('th:has-text("ベッド")').count()) === 0 && (await page.locator('text=顧客URL').count()) === 0);
ok('店舗管理に地域・Instagram・Google の列がある', (await page.locator('th:has-text("地域")').count()) === 1 && (await page.locator('th:has-text("Instagram")').count()) === 1 && (await page.locator('th:has-text("Google")').count()) === 1);
await page.getByRole('link', { name: 'SNS設定' }).first().click();
await page.waitForURL(/\/admin\/sns\/settings\?store=/); await page.waitForSelector('h1:has-text("SNS 設定")');
ok('SNS設定ボタンで店舗の SNS 設定が開く', (await page.locator('text=文章に差し込む情報').count()) === 1);
ok('店舗管理に戻るリンクがある', (await page.locator('text=店舗管理に戻る').count()) === 1);
ok('Instagram の連携ボタンがある（自動投稿）', (await page.locator('a:has-text("Instagram と連携する"), a:has-text("Instagram を再連携")').count()) === 1);
ok('Google の投稿ページを開くボタンがある', (await page.locator('a:has-text("Google の投稿ページを開く"), a:has-text("Google で店名を検索")').count()) >= 1);
const credCard = page.locator('div.border-pink-200');
await credCard.locator('input[placeholder="natsume_honten"]').fill(`natsume_test_ig`);
if (await credCard.locator('button:has-text("変更")').count()) await credCard.locator('button:has-text("変更")').click();
await credCard.locator('input[placeholder="パスワード"], input[placeholder="新しいパスワード"]').fill('Secret#Pass1');
await credCard.getByRole('button', { name: '保存' }).click();
await page.waitForSelector('div.border-pink-200 button:has-text("表示")');
ok('パスワードは保存後に伏せ字', (await page.locator('div.border-pink-200 code').textContent()).includes('•'));
await page.locator('div.border-pink-200 button:has-text("表示")').click();
await page.waitForFunction(() => document.querySelector('div.border-pink-200 code')?.textContent === 'Secret#Pass1');
ok('表示でパスワードが見える', true);
await page.goto(`${BASE}/admin/sns/stores`); await page.waitForSelector('th:has-text("地域")');
ok('店舗管理に ID と PW 保管済みが出る', (await page.locator('text=@natsume_test_ig').count()) === 1 && (await page.locator('text=PW 保管済み').count()) >= 1);
await page.goto(`${BASE}/admin/settings`); await page.waitForSelector('h1');
ok('店舗設定にベッド数などが無い', (await page.locator('text=ベッド数').count()) === 0);
await page.goto(`${BASE}/s/S001`); await page.waitForURL(/\/admin\/login/);
ok('顧客の予約ページはログインへ転送', true);
const r = await (await fetch(`${BASE}/api/admin/sns/settings?store=S001`, { headers: { cookie: (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ') } })).json();
ok('{予約URL} は BOOKING_URL のもの', typeof r.store?.bookingUrl === 'string' && !r.store.bookingUrl.startsWith(BASE), r.store?.bookingUrl ?? '');
// 差し込み語：S002 のエリアを空にして下書きを作ると {エリア} が残り、差し込み語のページで入れると埋まる
{
  const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
  const put = (rows) => fetch(`${BASE}/api/admin/sns/vars`, { method: 'PUT', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ rows }) }).then((r) => r.json());
  await put([{ code: 'S002', area: '' }]);
  const mk = await fetch(`${BASE}/api/admin/sns/posts?store=S002`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: 'gbp', scheduledAt: '2099-01-05 10:00', title: 'テスト', body: '{エリア}で腰痛にお困りの方へ。{店舗名}です。' }) });
  ok('エリア未入力の下書きを作成', mk.ok);
  await page.goto(`${BASE}/admin/sns/drafts?store=S002&unfilled=1`); await page.waitForSelector('h1:has-text("下書き")');
  ok('下書きページに {エリア} が赤く出る', await page.waitForSelector('section mark:has-text("{エリア}")', { timeout: 10000 }).then(() => true, () => false));
  await page.locator('label:has-text("エリア {エリア}") input').first().fill('三島市');
  await page.getByRole('button', { name: '保存して下書きを完成' }).first().click();
  await page.waitForSelector('text=件の下書きを埋めました');
  const gone = await page.waitForFunction(() => ![...document.querySelectorAll('section mark')].some((m) => m.textContent === '{エリア}'), null, { timeout: 10000 }).then(() => true, () => false);
  ok('保存すると下書きが埋まる（画面から {エリア} が消える）', gone);
  const d = await (await fetch(`${BASE}/api/admin/sns/drafts?store=S002`, { headers: { cookie } })).json();
  ok('API でも {エリア} が残っていない', d.posts.every((p) => !p.fullText.includes('{エリア}')));
  await page.goto(`${BASE}/admin/sns/vars`); await page.waitForSelector('th:has-text("エリア")');
  ok('差し込み語ページに全店舗の行がある', (await page.locator('tbody tr').count()) >= 2);
  const r = await put([{ code: 'S002', area: '沼津市' }]);
  ok('一括保存の応答', r.ok === true && r.saved === 1);
  // 一括設定：URL・ハッシュタグ・投稿の有無も保存できる
  const r2 = await put([{ code: 'S002', gbpPostUrl: 'https://business.google.com/n/123/posts', hashtags: '#テスト', gbpEnabled: true, memo: '料金は書かない' }]);
  const v2 = (await (await fetch(`${BASE}/api/admin/sns/vars`, { headers: { cookie } })).json()).stores.find((x) => x.code === 'S002');
  ok('一括設定で URL・タグ・メモ・投稿の有無を保存', r2.ok && v2.gbpPostUrl === 'https://business.google.com/n/123/posts' && v2.hashtags === '#テスト' && v2.gbpEnabled === true && v2.memo === '料金は書かない');
  const bad = await fetch(`${BASE}/api/admin/sns/vars`, { method: 'PUT', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: [{ code: 'S002', gbpPostUrl: 'business.google.com' }] }) });
  ok('https で始まらない URL は保存しない', bad.status === 400);
  // キーワードは本文に合うものが入る（腰の話 → 腰痛。ムチウチにはならない）
  await put([{ code: 'S002', area: '三島市谷田', keywordsFixed: '接骨院', keywordsRotation: '交通事故、ムチウチ、腰痛、子どものケガ' }]);
  const kp = await (await fetch(`${BASE}/api/admin/sns/posts?store=S002`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: 'gbp', scheduledAt: '2099-02-01 10:00', title: '朝起きたときの腰の張り', body: '朝、起き上がるときに腰が重いと感じる方は、寝ている間に体が冷えて筋肉がこわばっていることが多いです。' }) })).json();
  const kpost = await (await fetch(`${BASE}/api/admin/sns/posts/${kp.id}`, { headers: { cookie } })).json();
  const ktext = kpost.post?.fullText ?? '';
  ok('Google の締めのキーワードが本文に合う（腰痛）', ktext.includes('腰痛') && !ktext.includes('ムチウチ'), ktext.split('\n').slice(-3).join(' / '));
  ok('Google の投稿に「エリア＋メインキーワード」が入る', ktext.includes('三島市谷田の接骨院') || ktext.includes('三島市谷田で接骨院'), ktext.split('\n').slice(-3).join(' / '));
  ok('埋まらない差し込み語が残らない', !/\{[^{}\s]{1,20}\}/u.test(ktext));
  const kp2 = await (await fetch(`${BASE}/api/admin/sns/posts?store=S002`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: 'gbp', scheduledAt: '2099-02-02 10:00', title: '季節の変わり目の体調管理', body: '朝晩の寒暖差で体がだるくなりやすい時期です。' }) })).json();
  const t2 = (await (await fetch(`${BASE}/api/admin/sns/posts/${kp2.id}`, { headers: { cookie } })).json()).post?.fullText ?? '';
  ok('合う症状が無い本文は症状を入れず、メインキーワードだけ', t2.includes('接骨院') && !/交通事故|ムチウチ|腰痛|子どものケガ/.test(t2), t2.split('\n').slice(-2).join(' / '));
  const ip = await (await fetch(`${BASE}/api/admin/sns/posts?store=S002`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: 'ig', scheduledAt: '2099-02-03 10:00', title: 'テスト', body: '本文', patternIdx: 1 }) })).json();
  let telLeft = false;
  for (let i = 0; i < 3; i++) {
    const t = (await (await fetch(`${BASE}/api/admin/sns/posts/${ip.id}`, { headers: { cookie } })).json()).post?.fullText ?? '';
    if (t.includes('{電話}') || t.includes('お電話')) telLeft = true;
    await fetch(`${BASE}/api/admin/sns/posts/${ip.id}/action`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'regenerate' }) });
  }
  ok('Instagram の文型を切り替えても {電話} の文が使われない', !telLeft);
  // 貼り付け（見出し行あり）で表に反映できる
  await page.goto(`${BASE}/admin/sns/vars`); await page.waitForSelector('th:has-text("エリア")');
  await page.locator('summary:has-text("Excel から貼り付けて")').click();
  await page.locator('textarea').fill('店舗コード\tエリア\nS002\t三島市');
  await page.getByRole('button', { name: '表に反映' }).click();
  ok('見出し付きの貼り付けで反映', await page.waitForSelector('text=1 店舗に反映しました', { timeout: 5000 }).then(() => true, () => false));
  await page.getByRole('button', { name: /保存（1 店舗）/ }).click();
  await page.waitForSelector('text=店舗を保存しました');
  const v3 = (await (await fetch(`${BASE}/api/admin/sns/vars`, { headers: { cookie } })).json()).stores.find((x) => x.code === 'S002');
  ok('貼り付けた値が保存される', v3.area === '三島市');
  await put([{ code: 'S002', area: '沼津市', gbpPostUrl: '', hashtags: '', memo: '' }]);
}
// 電話番号は使わない：店舗の追加・一括登録に電話番号の欄が無く、無しで登録できる
{
  await page.goto(`${BASE}/admin/sns/stores`); await page.waitForSelector('th:has-text("地域")');
  ok('店舗の追加に電話番号の欄が無い', (await page.locator('input[placeholder="電話番号"]').count()) === 0);
  const code = `T${Date.now() % 100000}`;
  await page.fill('input[placeholder="店舗コード (例: S003)"]', code); await page.fill('input[placeholder="店舗名"]', 'テスト院'); await page.fill('input[placeholder="初期パスワード"]', 'password123');
  await page.getByRole('button', { name: '店舗を追加' }).click();
  await page.waitForSelector(`text=店舗 ${code} を追加しました`);
  ok('電話番号なしで店舗を追加できる', true);
  const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
  const code2 = `U${Date.now() % 100000}`;
  const bulk = await (await fetch(`${BASE}/api/admin/hq/stores/bulk`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: [{ code: code2, name: '一括院', phone: '', password: 'password123' }] }) })).json();
  ok('一括登録も電話番号なしでできる', bulk.added === 1, JSON.stringify(bulk));
  const tv = await (await fetch(`${BASE}/api/admin/sns/topics?store=S001`, { headers: { cookie } })).json();
  ok('差し込み語の一覧に {電話} が無い', Array.isArray(tv.vars) && !tv.vars.some((v) => v.key === '電話'));
  for (const c of [code, code2]) await fetch(`${BASE}/api/admin/hq/stores`, { method: 'PUT', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ code: c, action: 'delete' }) });
}
const ck = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
ok('Instagram の API 連携は使える', (await fetch(`${BASE}/api/admin/sns/ig/connect?store=S001`, { headers: { cookie: ck }, redirect: 'manual' })).status === 302);
ok('Google の API 連携は止まっている', (await fetch(`${BASE}/api/admin/sns/google/connect`, { headers: { cookie: ck }, redirect: 'manual' })).status === 404);
const credRaw = await (await fetch(`${BASE}/api/admin/sns/credentials?store=S001`, { headers: { cookie: ck } })).text();
ok('ログイン情報の取得にパスワードは含まれない', !credRaw.includes('Secret#Pass1') && credRaw.includes('natsume_test_ig'));
const sp = await (await browser.newContext()).newPage();
await sp.goto(`${BASE}/admin/login/S001`); await sp.fill('input[type="password"]', 'password'); await sp.getByRole('button', { name: 'ログイン' }).click(); await sp.waitForURL(/\/admin\/sns/);
const sck = (await sp.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
ok('店舗アカウントはログイン情報を見られない', (await fetch(`${BASE}/api/admin/sns/credentials`, { headers: { cookie: sck } })).status === 403);
await sp.goto(`${BASE}/admin/sns/settings`); await sp.waitForSelector('text=文章に差し込む情報');
ok('店舗の SNS 設定にログイン情報の欄が無い', (await sp.locator('text=ログイン情報（本部だけ').count()) === 0);
ok('コンソールエラーなし', errors.length === 0, errors.join(' | '));
await browser.close();
