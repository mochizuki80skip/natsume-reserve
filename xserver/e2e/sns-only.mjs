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
ok('タブの名前が SNS投稿管理', html.includes('<title>SNS投稿管理</title>'));
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
ok('店舗をまとめて登録がある', await page.waitForSelector('text=店舗をまとめて登録', { timeout: 8000 }).then(() => true, () => false));
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
  await page.waitForSelector('section');
  if (await page.locator('button:has-text("件を表示")').count()) await page.locator('button:has-text("件を表示")').first().click();
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
  const badMsg = (await bad.json()).error ?? '';
  ok('https で始まらない URL は保存しない（どの店舗の欄か分かる）', bad.status === 400 && badMsg.includes('Google の投稿ページ URL'), badMsg);
  // 長い URL：Google 検索は店名だけの短い形に、その他の長い URL はそのまま保存
  const longSearch = 'https://www.google.com/search?q=' + encodeURIComponent('あかり接骨院 三島市谷田') + '&sca_esv=' + 'a'.repeat(300) + '&ei=xyz&ved=' + 'b'.repeat(200);
  const longOther = 'https://business.google.com/n/1234567890/profile?fid=' + 'c'.repeat(600);
  await put([{ code: 'S002', gbpPostUrl: longSearch, igProfileUrl: longOther }]);
  const v4 = (await (await fetch(`${BASE}/api/admin/sns/vars`, { headers: { cookie } })).json()).stores.find((x) => x.code === 'S002');
  ok('長い Google 検索の URL は短く整えて保存', v4.gbpPostUrl === 'https://www.google.com/search?q=' + encodeURIComponent('あかり接骨院 三島市谷田'), v4.gbpPostUrl);
  ok('300 文字を超える URL も保存できる', v4.igProfileUrl === longOther);
  await put([{ code: 'S002', gbpPostUrl: '', igProfileUrl: '' }]);
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
// 定型投稿の曜日・対象エリア：月・水・金の定型投稿がそれぞれの曜日に使われ、対象エリア外の店舗には使われない
{
  const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
  const H = { cookie, 'Content-Type': 'application/json' };
  const mk = async (title, weekdays, areas = '') => (await (await fetch(`${BASE}/api/admin/sns/topics?store=S002`, { method: 'POST', headers: H, body: JSON.stringify({ shared: true, channel: 'gbp', title, body: `${title}：{エリア}の{店舗名}です。`, months: '', weekdays, areas, standalone: true }) })).json()).id;
  const ids = [await mk('月_曜日テスト', '1'), await mk('水_曜日テスト', '3'), await mk('金_曜日テスト', '5'), await mk('月_浜松だけ', '1', '浜松')];
  ok('曜日・エリア付きの定型投稿を登録', ids.every(Boolean));
  const tl = await (await fetch(`${BASE}/api/admin/sns/topics?store=S002`, { headers: { cookie } })).json();
  const t1 = tl.topics.find((t) => t.id === ids[0]);
  ok('定型投稿に曜日・エリアが保存される', t1?.weekdays === '1' && tl.topics.find((t) => t.id === ids[3])?.areas === '浜松');
  await fetch(`${BASE}/api/admin/sns/settings?store=S002`, { method: 'PUT', headers: H, body: JSON.stringify({ gbpEnabled: true, gbpSchedule: { type: 'weekly', weekdays: [1, 3, 5], hour: 10, minute: 0 }, area: '沼津市' }) });
  // S002 の先の Google の下書きを消してから作り直す
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const plus = (n) => new Date(new Date(today).getTime() + n * 86400e3).toISOString().slice(0, 10);
  const old = await (await fetch(`${BASE}/api/admin/sns/posts?store=S002&channel=gbp&from=${plus(1)}&to=${plus(30)}`, { headers: { cookie } })).json();
  for (const p of old.posts) if (p.status !== 'posted') await fetch(`${BASE}/api/admin/sns/posts/${p.id}/action`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'delete' }) });
  await fetch(`${BASE}/api/admin/sns/generate?store=S002&days=21`, { method: 'POST', headers: H, body: '{}' });
  const made = (await (await fetch(`${BASE}/api/admin/sns/posts?store=S002&channel=gbp&from=${plus(1)}&to=${plus(21)}`, { headers: { cookie } })).json()).posts;
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const wrong = made.filter((p) => !p.title.startsWith(WD[new Date(p.scheduledAt.slice(0, 10) + 'T00:00:00Z').getUTCDay()] + '_'));
  ok('月・水・金の下書きにそれぞれの曜日の定型投稿が使われる', made.length >= 6 && wrong.length === 0, `${made.length} 件、合わない ${wrong.map((p) => p.scheduledAt.slice(0, 10) + p.title).join(' ')}`);
  ok('対象エリア外（浜松）の定型投稿は使われない', made.every((p) => !p.title.includes('浜松')));
  for (const id of ids) await fetch(`${BASE}/api/admin/sns/topics?store=S002`, { method: 'PUT', headers: H, body: JSON.stringify({ id, action: 'delete' }) });
  for (const p of made) await fetch(`${BASE}/api/admin/sns/posts/${p.id}/action`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'delete' }) });
}
// claude.ai で作った定型投稿の取り込み：依頼文 → 貼り付け → 確認 → 取り込み
{
  const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
  const H = { cookie, 'Content-Type': 'application/json' };
  const pr = await (await fetch(`${BASE}/api/admin/sns/topics/prompt`, { method: 'POST', headers: H, body: JSON.stringify({ theme: '冬のぎっくり腰', count: 3, channel: 'gbp', weekdays: '1,3,5', perStore: true }) })).json();
  ok('依頼文にルール・出力の形・店舗の一覧が入る', pr.prompt.includes('{メインキーワード}') && pr.prompt.includes('名前：') && pr.prompt.includes('本文：') && pr.prompt.includes('S001｜') && pr.prompt.includes('電話番号・住所・営業時間・URL'));
  const tag = `T${Date.now() % 100000}`;
  const reply = `承知しました。\n\n\`\`\`\n---\n名前：月_${tag}_お悩み\n媒体：Google\n曜日：月曜日\nエリア：\n店舗：\n本文：\n{エリア}の{店舗名}です。\n腰の張りはご相談ください。\n---\n名前：水_${tag}_電話あり\n媒体：Google\n曜日：水\n本文：\nお電話 055-123-4567 まで。\n---\n名前：金_${tag}_店舗用\n媒体：両方\n曜日：金\n店舗：S002\n本文：\n{エリア}の{メインキーワード}、{店舗名}です。\n---\n\`\`\`\n以上です。`;
  const dry = await (await fetch(`${BASE}/api/admin/sns/topics/import`, { method: 'POST', headers: H, body: JSON.stringify({ text: reply, dryRun: true }) })).json();
  ok('貼り付けを 3 件に読み分ける', dry.items.length === 3, JSON.stringify(dry.items.map((i) => [i.title, i.weekdays, i.status])));
  ok('曜日・店舗を読み取る', dry.items[0].weekdays === '1' && dry.items[2].weekdays === '5' && dry.items[2].store !== '');
  ok('Google に電話番号が入ったものはエラー', dry.items[1].status === 'error');
  ok('締めのあいさつ（以上です）を本文に入れない', !dry.items[2].body.includes('以上です'));
  // 画面から取り込む
  await page.goto(`${BASE}/admin/sns/topics`); await page.waitForSelector('text=定型投稿を追加');
  await page.locator('summary:has-text("Claude で定型投稿を作って取り込む")').click();
  await page.getByRole('button', { name: '依頼文をコピー' }).click();
  ok('依頼文を作れる（画面）', await page.waitForSelector('summary:has-text("依頼文を見る")', { timeout: 5000 }).then(() => true, () => false));
  await page.locator('textarea[placeholder^="claude.ai の返答"]').fill(reply);
  await page.getByRole('button', { name: '確認する' }).click();
  await page.waitForSelector('button:has-text("件を定型投稿に取り込む")');
  await page.getByRole('button', { name: /2 件を定型投稿に取り込む/ }).click();
  ok('2 件を取り込める（画面）', await page.waitForSelector('text=2 件を定型投稿に登録しました', { timeout: 5000 }).then(() => true, () => false));
  // claude.ai から受け取ったファイル（複数）を読み込む。名前の「7月」から月を読む
  await page.locator('input[aria-label="返答のファイル"]').setInputFiles([
    { name: 'Google_7-9.txt', mimeType: 'text/plain', buffer: Buffer.from('```\n---\n名前：月_7月_01_夏休みの部活\n媒体：Google\n曜日：月\nエリア：\n店舗：\n本文：\n{エリア}で{メインキーワード}をお探しの方へ。夏の部活のケガのご相談を承っています。\n---\n```') },
    { name: 'Google_10-12.txt', mimeType: 'text/plain', buffer: Buffer.from('```\n---\n名前：金_12月_01_大掃除\n媒体：Google\n曜日：金\nエリア：\n店舗：\n本文：\n{エリア}の{メインキーワード}・{店舗名}です。大掃除でのケガのご相談を承っています。\n---\n```') },
  ]);
  await page.waitForSelector('text=2 個のファイルを読み込みました');
  await page.getByRole('button', { name: '確認する' }).click();
  await page.waitForSelector('button:has-text("件を定型投稿に取り込む")');
  const rowsText = (await page.locator('details:has(summary:has-text("Claude で定型投稿を作って取り込む")) table').first().textContent()) ?? '';
  ok('ファイルを複数まとめて読み込み、名前の月を読む', rowsText.includes('7月') && rowsText.includes('12月') && (await page.getByRole('button', { name: /^2 件を定型投稿に取り込む/ }).count()) === 1, rowsText.slice(0, 120));
  const again = await (await fetch(`${BASE}/api/admin/sns/topics/import`, { method: 'POST', headers: H, body: JSON.stringify({ text: reply, dryRun: false }) })).json();
  ok('同じものは二重に登録しない', again.created === 0 && again.skipped === 2);
  const tl = await (await fetch(`${BASE}/api/admin/sns/topics?store=S002`, { headers: { cookie } })).json();
  const mine = tl.topics.filter((t) => t.title.includes(tag));
  ok('取り込んだ定型投稿に曜日が入る（店舗用は S002 に）', mine.length === 2 && mine.some((t) => t.weekdays === '1' && t.shared) && mine.some((t) => t.weekdays === '5' && !t.shared));
  for (const t of mine) await fetch(`${BASE}/api/admin/sns/topics?store=S002`, { method: 'PUT', headers: H, body: JSON.stringify({ id: t.id, action: 'delete' }) });
}
const ck = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
ok('Instagram の API 連携は使える', (await fetch(`${BASE}/api/admin/sns/ig/connect?store=S001`, { headers: { cookie: ck }, redirect: 'manual' })).status === 302);
ok('Google の API 連携（分析用）は使える', (await fetch(`${BASE}/api/admin/sns/google/connect`, { headers: { cookie: ck }, redirect: 'manual' })).status === 302);
{
  const pm = await (await fetch(`${BASE}/api/admin/sns/posts?store=S001&channel=gbp`, { headers: { cookie: ck } })).json();
  ok('Google と連携していても投稿は手動のまま', pm.publishMode?.gbp === 'manual');
  const ins = await (await fetch(`${BASE}/api/admin/sns/insights?detail=S001`, { headers: { cookie: ck } })).json();
  ok('分析に検索キーワードの欄がある', ins.detail && 'keywords' in ins.detail && Array.isArray(ins.rows[0]?.kwTop));
}
{
  // エリア分け：カレンダーのエリアのタブ・設定のまとめて入力
  const H = { cookie: ck, 'content-type': 'application/json' };
  const before = (await (await fetch(`${BASE}/api/admin/sns/vars`, { headers: { cookie: ck } })).json()).stores;
  const orig = Object.fromEntries(before.map((r) => [r.code, r.areaGroup ?? '']));
  const put = await fetch(`${BASE}/api/admin/sns/vars`, { method: 'PUT', headers: H, body: JSON.stringify({ rows: [{ code: 'S001', areaGroup: 'E2E東部' }, { code: 'S002', areaGroup: 'E2E西部' }] }) });
  ok('エリア分けを一括設定で保存できる', put.status === 200);
  const all = await (await fetch(`${BASE}/api/admin/sns/calendar`, { headers: { cookie: ck } })).json();
  ok('カレンダーにエリアの一覧が出る', all.areas.some((a) => a.name === 'E2E東部' && a.stores === 1) && all.areas.some((a) => a.name === 'E2E西部'));
  const east = await (await fetch(`${BASE}/api/admin/sns/calendar?area=${encodeURIComponent('E2E東部')}`, { headers: { cookie: ck } })).json();
  ok('エリアで絞ると、そのエリアの店舗の投稿だけ', east.stores.length === 1 && east.stores[0].code === 'S001' && east.posts.every((p) => p.storeCode === 'S001'));
  await page.goto(`${BASE}/admin/sns/calendar`); await page.waitForSelector('h1:has-text("カレンダー")');
  await page.getByRole('button', { name: /^E2E東部（1 店）/ }).click();
  ok('カレンダーのエリアのタブで絞り込める（画面）', await page.waitForSelector('text=E2E東部の投稿の曜日・時刻', { timeout: 5000 }).then(() => true, () => false) && page.url().includes('area='));
  await page.goto(`${BASE}/admin/sns/schedule?area=${encodeURIComponent('E2E西部')}`); await page.waitForSelector('text=まとめて設定');
  ok('配信設定をエリアで絞ると、そのエリアの店舗だけ表に出る', (await page.locator('input[aria-label$="のエリア分け"]').count()) === 1);
  await page.locator('section:has-text("まとめて設定")').getByRole('button', { name: 'このエリアに入れる' }).nth(1).click();
  ok('エリアの店舗にまとめて曜日を入れられる', (await page.locator('text=1 店舗の Google の曜日・時刻を入れました').count()) === 1 && (await page.locator('button:has-text("保存（1 店舗）")').count()) === 1);
  // 表で、店舗ごとに曜日とエリア分けを変えて保存する
  const st0 = (await (await fetch(`${BASE}/api/admin/hq/sns/stores`, { headers: { cookie: ck } })).json()).stores.find((x) => x.code === 'S001');
  await page.goto(`${BASE}/admin/sns/schedule?area=${encodeURIComponent('E2E東部')}`); await page.waitForSelector('text=曜日ごとの店舗数');
  const chips = page.locator(`button[aria-label^="${st0.name} Google "]`);
  let addDay = -1; const WDJ = ['日', '月', '火', '水', '木', '金', '土'];
  for (const d of [1, 2, 3, 4, 5, 6, 0]) if ((await page.locator(`button[aria-label="${st0.name} Google ${WDJ[d]}"]`).getAttribute('aria-pressed')) === 'false') { addDay = d; break; }
  ok('配信設定の表に曜日のボタンがある', (await chips.count()) === 7 && addDay >= 0);
  await page.locator(`button[aria-label="${st0.name} Google ${WDJ[addDay]}"]`).click();
  await page.locator(`input[aria-label="${st0.name} のエリア分け"]`).fill('E2E北部');
  await page.getByRole('button', { name: '保存（1 店舗）' }).click();
  await page.waitForSelector('text=1 店舗を保存しました');
  const st1 = (await (await fetch(`${BASE}/api/admin/hq/sns/stores`, { headers: { cookie: ck } })).json()).stores.find((x) => x.code === 'S001');
  ok('表で変えた曜日とエリア分けが保存される', st1.setting.areaGroup === 'E2E北部' && st1.setting.gbpSchedule?.type === 'weekly' && st1.setting.gbpSchedule.weekdays.includes(addDay), JSON.stringify(st1.setting.gbpSchedule));
  await fetch(`${BASE}/api/admin/sns/settings?store=S001`, { method: 'PUT', headers: H, body: JSON.stringify({ gbpSchedule: st0.setting.gbpSchedule }) });
  // 4 エリア（中部・中東部・中西部・東部）：「東部」の定型投稿は「中東部」の店舗に使わない
  await fetch(`${BASE}/api/admin/sns/vars`, { method: 'PUT', headers: H, body: JSON.stringify({ rows: [{ code: 'S001', areaGroup: '中東部' }, { code: 'S002', areaGroup: '東部' }] }) });
  const tid = (await (await fetch(`${BASE}/api/admin/sns/topics?store=S002`, { method: 'POST', headers: H, body: JSON.stringify({ shared: true, channel: 'gbp', title: 'E2E東部だけ', body: '{エリア}の{店舗名}です。東部の話題です。', months: '', weekdays: '', areas: '東部', standalone: true }) })).json()).id;
  const bcr = await (await fetch(`${BASE}/api/admin/hq/sns/topics/${tid}/broadcast`, { method: 'POST', headers: H, body: JSON.stringify({ channel: 'gbp', scheduledAt: '2099-03-02 10:00', stores: ['S001', 'S002'] }) })).json();
  ok('「東部」の定型投稿は東部の店舗だけ（中東部の店舗には使わない）', bcr.created === 1 && bcr.skipped.some((x) => x.includes('対象エリアの外')), JSON.stringify(bcr));
  const bposts = (await (await fetch(`${BASE}/api/admin/sns/drafts`, { headers: { cookie: ck } })).json()).posts.filter((p) => p.title === 'E2E東部だけ' || (p.body ?? '').includes('東部の話題'));
  for (const p of bposts) await fetch(`${BASE}/api/admin/sns/posts/${p.id}/action`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'delete' }) });
  await fetch(`${BASE}/api/admin/sns/topics?store=S002`, { method: 'PUT', headers: H, body: JSON.stringify({ id: tid, action: 'delete' }) });
  const apr = await (await fetch(`${BASE}/api/admin/sns/topics/prompt`, { method: 'POST', headers: H, body: JSON.stringify({ theme: '', count: 4, channel: 'gbp', weekdays: '1', perStore: false, area: '東部' }) })).json();
  ok('Claude への依頼文に対象エリアが入る', apr.prompt.includes('対象エリア：東部') && apr.prompt.includes('エリア：東部'));
  const adr = await (await fetch(`${BASE}/api/admin/sns/topics/import`, { method: 'POST', headers: H, body: JSON.stringify({ text: '---\n名前：月_E2Eエリア\n媒体：Google\n曜日：月\nエリア：\n本文：\n{エリア}で{メインキーワード}をお探しの方へ。\n---', dryRun: true, channel: 'gbp', area: '東部' }) })).json();
  ok('対象エリアを選んで取り込むと、エリアが空のものにも入る', adr.items[0]?.areas === '東部', JSON.stringify(adr.items[0] ?? {}));
  await fetch(`${BASE}/api/admin/sns/vars`, { method: 'PUT', headers: H, body: JSON.stringify({ rows: [{ code: 'S001', areaGroup: orig.S001 ?? '' }, { code: 'S002', areaGroup: orig.S002 ?? '' }] }) });
}
{
  // カレンダー：ドラッグで移動（承認はそのまま）、クリックで内容の変更、日付から投稿の追加
  const H = { cookie: ck, 'content-type': 'application/json' };
  const cal = async () => (await (await fetch(`${BASE}/api/admin/sns/calendar?from=2099-05-01&to=2099-05-31`, { headers: { cookie: ck } })).json()).posts;
  for (const p of await cal()) await fetch(`${BASE}/api/admin/sns/posts/${p.id}/action`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'delete' }) });
  const mk = await (await fetch(`${BASE}/api/admin/sns/posts?store=S001`, { method: 'POST', headers: H, body: JSON.stringify({ channel: 'gbp', scheduledAt: '2099-05-12 10:00', title: 'E2Eカレンダー移動', body: '足首のケガのご相談を承っています。' }) })).json();
  const pid = mk.post?.id ?? mk.id;
  const ap = await fetch(`${BASE}/api/admin/sns/posts/${pid}/action`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'approve' }) });
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.goto(`${BASE}/admin/sns/calendar?ym=2099-05&show=store`); await page.waitForSelector('text=E2Eカレンダー移動');
  await page.locator('[data-date="2099-05-14"]').scrollIntoViewIfNeeded();
  await page.locator('button:has-text("E2Eカレンダー移動")').dragTo(page.locator('[data-date="2099-05-14"]'));
  ok('カレンダーでドラッグして別の日へ移動できる', await page.waitForSelector('text=/1 件を 5\\/14（木） ?に移動しました/', { timeout: 8000 }).then(() => true, () => false));
  const moved = (await cal()).find((p) => p.id === pid);
  ok('移動しても時刻と承認はそのまま', moved?.scheduledAt === '2099-05-14 10:00' && (ap.status !== 200 || moved?.status === 'approved'), JSON.stringify(moved));
  await page.locator('button:has-text("E2Eカレンダー移動")').click();
  await page.waitForSelector('[role="dialog"] >> text=日時を変える');
  await page.waitForFunction(() => (document.querySelector('select[aria-label="定型投稿を選ぶ"]')?.options.length ?? 0) > 1, null, { timeout: 8000 }).catch(() => {});
  const opts = await page.locator('select[aria-label="定型投稿を選ぶ"] option').count();
  ok('投稿を押すと、日時・内容を変えるパネルが開く', opts > 1);
  await page.locator('select[aria-label="定型投稿を選ぶ"]').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'この内容にする' }).click();
  ok('パネルで内容（定型投稿）を変えられる', await page.waitForSelector('text=の内容を変えました', { timeout: 8000 }).then(() => true, () => false));
  await page.keyboard.press('Escape');
  await page.locator('[data-date="2099-05-20"] button').first().click();
  await page.waitForSelector('text=この日に投稿を追加');
  await page.waitForFunction(() => (document.querySelector('select[aria-label="追加する定型投稿"]')?.options.length ?? 0) > 1, null, { timeout: 8000 }).catch(() => {});
  await page.locator('select[aria-label="追加する定型投稿"]').selectOption({ index: 1 });
  await page.locator('[role="dialog"] button:has-text("店舗に下書きを作る")').click();
  ok('日付を押して、その日に投稿を追加できる', await page.waitForSelector('text=店舗分の下書きを作りました', { timeout: 8000 }).then(() => true, () => false));
  const added = (await cal()).filter((p) => p.scheduledAt.startsWith('2099-05-20'));
  ok('追加した投稿がカレンダーに出る', added.length >= 1, String(added.length));
  for (const p of await cal()) await fetch(`${BASE}/api/admin/sns/posts/${p.id}/action`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'delete' }) });
}
const credRaw = await (await fetch(`${BASE}/api/admin/sns/credentials?store=S001`, { headers: { cookie: ck } })).text();
ok('ログイン情報の取得にパスワードは含まれない', !credRaw.includes('Secret#Pass1') && credRaw.includes('natsume_test_ig'));
const sp = await (await browser.newContext()).newPage();
await sp.goto(`${BASE}/admin/login/S001`); await sp.fill('input[type="password"]', 'password'); await sp.getByRole('button', { name: 'ログイン' }).click(); await sp.waitForURL(/\/admin\/sns/);
const sck = (await sp.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
ok('店舗アカウントはログイン情報を見られない', (await fetch(`${BASE}/api/admin/sns/credentials`, { headers: { cookie: sck } })).status === 403);
await sp.goto(`${BASE}/admin/sns/settings`); await sp.waitForSelector('text=文章に差し込む情報');
ok('店舗の SNS 設定にログイン情報の欄が無い', (await sp.locator('text=ログイン情報（本部だけ').count()) === 0);
await sp.goto(`${BASE}/admin/sns/calendar`); await sp.waitForSelector('h1:has-text("カレンダー")');
ok('店舗アカウントのカレンダーは自店舗だけ（エリアのタブ無し）', (await sp.locator('button:has-text("すべて（")').count()) === 0 && (await sp.getByRole('button', { name: '＋ 手で下書きを追加' }).count()) === 1);
ok('コンソールエラーなし', errors.length === 0, errors.join(' | '));
await browser.close();
