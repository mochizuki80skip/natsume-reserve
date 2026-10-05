// 本部：SNS 管理（連携の状態、Google の拠点の割り当て、全店共通の設定、通知先、自動処理の記録）
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import { sendJson, type AccountRow, type Patterns, type Schedule } from '@/lib/sns';
import SnsNav from '@/components/SnsNav';
import SnsScheduleEditor from '@/components/SnsScheduleEditor';
import { useAdmin } from '../Layout';

interface StoreRow { code: string; name: string; active: boolean; igEnabled: boolean; gbpEnabled: boolean; igSchedule: string; gbpSchedule: string; area: string; ig: AccountRow | null; gbp: AccountRow | null; topics: number }
interface Setting { forbiddenWords: string[]; patterns: Patterns; defaultIgSchedule: Schedule; defaultGbpSchedule: Schedule; daysAhead: number; remindHours: number; hashtagBase: string; lineTargets: string[] }
interface Resp {
  setting: Setting; stores: StoreRow[]; sharedTopics: number; google: AccountRow | null;
  configured: { ig: boolean; google: boolean; line: boolean; lineWebhook: boolean; mail: boolean; appUrl: boolean; cronSecret: boolean };
  lineUsers: { userId: string; displayName: string; createdAt: string }[]; baseUrl: string; redirectUris: { ig: string; google: string; lineWebhook: string; cron: string };
  jobs: { k: string; ranAt: string; note: string | null }[]; mediaWritable: boolean;
}
interface Loc { account: string; accountName: string; location: string; title: string; address: string }

export default function SnsHqPage() {
  const { me } = useAdmin();
  const [sp] = useSearchParams();
  const { data, error, reload } = useFetch<Resp>(me.session.role === 'hq' ? '/api/admin/hq/sns' : null);
  const [msg, setMsg] = useState(sp.get('error') ?? (sp.get('connected') === 'google' ? 'Google アカウントを連携しました。下の「拠点を読み込む」で店舗に拠点を割り当ててください' : ''));
  const [s, setS] = useState<Setting | null>(null);
  const [locs, setLocs] = useState<Loc[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setS(data.setting); }, [data]);
  if (me.session.role !== 'hq') return <p className="text-sm">本部だけが見られます。</p>;
  if (error) return <div><SnsNav /><p className="text-sm text-red-700">{error.message}</p></div>;
  if (!data || !s) return <div><SnsNav /><p className="text-sm text-slate-500">読み込み中…</p></div>;

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true); setMsg('');
    try { await fn(); if (ok) setMsg(ok); reload(); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }
  const saveSetting = (e: React.FormEvent) => { e.preventDefault(); run(() => sendJson('/api/admin/hq/sns/settings', 'PUT', s), '共通設定を保存しました'); };
  async function loadLocations() {
    setBusy(true); setMsg('');
    try { const r = await fetch('/api/admin/hq/sns/google/locations'); const j = await r.json(); if (!r.ok) throw new Error(j.error); setLocs(j.locations); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }
  const mapLoc = (code: string, v: string) => {
    if (v === '') return run(() => sendJson('/api/admin/hq/sns/google/map', 'PUT', { store: code, clear: true }), '拠点の割り当てを外しました');
    const l = locs?.find((x) => `${x.account}|${x.location}` === v); if (!l) return;
    return run(() => sendJson('/api/admin/hq/sns/google/map', 'PUT', { store: code, account: l.account, location: l.location, title: l.title }), `${code} に ${l.title} を割り当てました`);
  };
  const setPattern = (ch: 'ig' | 'gbp', g: string, text: string) => setS({ ...s, patterns: { ...s.patterns, [ch]: { ...s.patterns[ch], [g]: text.split(/\n---\n/).map((x) => x.trim()).filter(Boolean) } } });
  const patternText = (list: string[]) => list.join('\n---\n');
  const check = (ok: boolean) => <span className={`mr-1 inline-block w-4 text-center ${ok ? 'text-green-700' : 'text-red-700'}`}>{ok ? '✓' : '✗'}</span>;

  return (
    <div className="space-y-4">
      <SnsNav title="SNS 管理（本部）" />
      {msg && <p className="rounded bg-brand-light px-3 py-2 text-sm">{msg}</p>}

      <section className="rounded border bg-white p-4 text-sm">
        <h2 className="mb-2 font-bold">接続状況（config.php の設定。値は表示しません）</h2>
        <div className="grid gap-1 md:grid-cols-2">
          <div>{check(data.configured.appUrl)}APP_URL（画像の公開 URL・連携の戻り先）：{data.baseUrl || '未設定'}</div>
          <div>{check(data.configured.cronSecret)}CRON_SECRET（自動処理）</div>
          <div>{check(data.configured.ig)}Instagram アプリ（IG_APP_ID / IG_APP_SECRET）</div>
          <div>{check(data.configured.google)}Google OAuth（GOOGLE_CLIENT_ID / SECRET）</div>
          <div>{check(data.configured.line)}LINE 通知（LINE_CHANNEL_ACCESS_TOKEN）　{check(data.configured.lineWebhook)}LINE Webhook（LINE_CHANNEL_SECRET）</div>
          <div>{check(data.configured.mail)}メール通知（NOTIFY_EMAIL。LINE が無いときの代わり）</div>
          <div>{check(data.mediaWritable)}画像の保存先（public/media/sns）に書き込める</div>
        </div>
        <details className="mt-2 text-xs text-slate-600">
          <summary className="cursor-pointer">各サービスに登録する URL</summary>
          <ul className="ml-4 mt-1 list-disc space-y-0.5">
            <li>Instagram アプリの「OAuth リダイレクト URI」：<code className="rounded bg-slate-100 px-1">{data.redirectUris.ig}</code></li>
            <li>Google OAuth クライアントの「承認済みのリダイレクト URI」：<code className="rounded bg-slate-100 px-1">{data.redirectUris.google}</code></li>
            <li>LINE Messaging API の「Webhook URL」：<code className="rounded bg-slate-100 px-1">{data.redirectUris.lineWebhook}</code></li>
            <li>Xserver の Cron（5〜10 分おき）：<code className="rounded bg-slate-100 px-1">/usr/bin/curl -s "{data.redirectUris.cron}" &gt; /dev/null</code></li>
          </ul>
        </details>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => run(() => sendJson('/api/admin/hq/sns/notify-test', 'POST', {}), '通知を送りました（届かない場合は通知先を確認）')} className="rounded border bg-white px-3 py-1 disabled:opacity-50">通知のテスト送信</button>
          <button type="button" disabled={busy} onClick={() => run(() => sendJson('/api/admin/hq/sns/run-cron', 'POST', {}), '自動処理を実行しました')} className="rounded border bg-white px-3 py-1 disabled:opacity-50">自動処理を今すぐ実行</button>
        </div>
        {data.jobs.length > 0 && <details className="mt-2 text-xs text-slate-600"><summary className="cursor-pointer">自動処理の記録（1 日 1 回の処理）</summary><ul className="ml-4 mt-1 list-disc">{data.jobs.map((j) => <li key={j.k}>{j.ranAt.slice(5, 16)} {j.k} <span className="text-slate-400">{j.note}</span></li>)}</ul></details>}
      </section>

      <section className="rounded border bg-white p-4 text-sm">
        <h2 className="mb-2 font-bold">Google ビジネスプロフィール（本部の Google アカウントで 24 店舗分をまとめて連携）</h2>
        {data.google?.connected ? <p>連携中{data.google.tokenRefreshedAt && <span className="text-xs text-slate-500">（最終更新 {data.google.tokenRefreshedAt.slice(0, 16)}）</span>}{data.google.lastError && <span className="ml-2 text-xs text-red-700">エラー：{data.google.lastError}</span>}</p> : <p className="text-slate-600">未連携。全店舗の拠点を管理している Google アカウントで連携してください。API の利用許可（申請）が下りる前でも連携はできますが、投稿・数字の取得は許可後に動きます。</p>}
        <div className="mt-2 flex flex-wrap gap-2">
          {data.configured.google && data.configured.appUrl ? <a href="/api/admin/sns/google/connect" className="rounded bg-blue-700 px-3 py-1 text-white">{data.google?.connected ? 'Google を再連携' : 'Google と連携する'}</a> : <span className="text-xs text-red-700">GOOGLE_CLIENT_ID / SECRET と APP_URL を config.php に設定してください</span>}
          {data.google?.connected && <button type="button" disabled={busy} onClick={loadLocations} className="rounded border bg-white px-3 py-1 disabled:opacity-50">拠点を読み込む</button>}
          {data.google?.connected && <button type="button" disabled={busy} onClick={() => confirm('Google の連携を解除しますか？') && run(() => sendJson('/api/admin/hq/sns/google/map', 'PUT', { disconnect: true }), '解除しました')} className="rounded border bg-white px-3 py-1 text-red-700">連携解除</button>}
        </div>
        {locs && <p className="mt-2 text-xs text-slate-500">{locs.length} 拠点を読み込みました。下の表で店舗ごとに拠点を選んでください。</p>}
      </section>

      <section className="overflow-x-auto rounded border bg-white">
        <h2 className="border-b px-3 py-2 font-bold">店舗ごとの状態</h2>
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-100 text-left text-xs text-slate-600"><th className="px-2 py-1">店舗</th><th className="px-2 py-1">Instagram</th><th className="px-2 py-1">Google 拠点</th><th className="px-2 py-1">頻度 IG / G</th><th className="px-2 py-1">地域</th><th className="px-2 py-1">店舗のネタ</th><th></th></tr></thead>
          <tbody>
            {data.stores.map((st) => (
              <tr key={st.code} className={`border-t ${st.active ? '' : 'text-slate-400'}`}>
                <td className="whitespace-nowrap px-2 py-1">{st.name}{!st.active && '（停止）'}</td>
                <td className="px-2 py-1 text-xs">{st.igEnabled ? (st.ig?.connected ? <span className="text-green-700">連携 @{st.ig.username}{st.ig.lastError && <span className="ml-1 text-red-700" title={st.ig.lastError}>!</span>}</span> : <span className="text-amber-700">未連携（手動投稿）</span>) : <span className="text-slate-400">使わない</span>}</td>
                <td className="px-2 py-1 text-xs">
                  {locs ? (
                    <select value={st.gbp?.locationName ? `${st.gbp.externalId}|${st.gbp.locationName}` : ''} onChange={(e) => mapLoc(st.code, e.target.value)} className="max-w-xs rounded border px-1 py-0.5">
                      <option value="">（割り当てなし）</option>
                      {locs.map((l) => <option key={l.location} value={`${l.account}|${l.location}`}>{l.title}　{l.address}</option>)}
                    </select>
                  ) : st.gbpEnabled ? (st.gbp?.locationName ? <span className="text-green-700">{st.gbp.username}{st.gbp.lastError && <span className="ml-1 text-red-700" title={st.gbp.lastError}>!</span>}</span> : <span className="text-amber-700">拠点未割当（手動投稿）</span>) : <span className="text-slate-400">使わない</span>}
                </td>
                <td className="whitespace-nowrap px-2 py-1 text-xs">{st.igEnabled ? st.igSchedule : '-'} / {st.gbpEnabled ? st.gbpSchedule : '-'}</td>
                <td className="px-2 py-1 text-xs">{st.area || <span className="text-amber-700">未設定</span>}</td>
                <td className="px-2 py-1 text-xs tabular-nums">{st.topics}（共通 {data.sharedTopics}）</td>
                <td className="whitespace-nowrap px-2 py-1 text-xs"><Link to={`/admin/sns/settings?store=${st.code}`} className="text-brand underline">設定</Link>　<Link to={`/admin/sns/posts?store=${st.code}`} className="text-brand underline">投稿</Link>　<Link to={`/admin/sns/topics?store=${st.code}`} className="text-brand underline">ネタ</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <form onSubmit={saveSetting} className="space-y-4 rounded border bg-white p-4 text-sm">
        <h2 className="font-bold">全店共通の設定</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <div><div className="mb-1">Instagram の既定の頻度</div><SnsScheduleEditor value={s.defaultIgSchedule} onChange={(v) => setS({ ...s, defaultIgSchedule: v })} /></div>
          <div><div className="mb-1">Google の既定の頻度</div><SnsScheduleEditor value={s.defaultGbpSchedule} onChange={(v) => setS({ ...s, defaultGbpSchedule: v })} /></div>
          <label>何日先まで下書きを作るか <input type="number" min={7} max={120} value={s.daysAhead} onChange={(e) => setS({ ...s, daysAhead: Number(e.target.value) })} className="w-20 rounded border px-2 py-1" /> 日</label>
          <label>承認待ちの通知を出す時間（予定の何時間前から） <input type="number" min={1} max={168} value={s.remindHours} onChange={(e) => setS({ ...s, remindHours: Number(e.target.value) })} className="w-20 rounded border px-2 py-1" /> 時間</label>
        </div>
        <label className="block">全店共通のハッシュタグ（店舗で指定が無いとき）<input value={s.hashtagBase} onChange={(e) => setS({ ...s, hashtagBase: e.target.value })} placeholder="#なつめ接骨院 #接骨院" className="mt-1 w-full rounded border px-2 py-1" /></label>
        <label className="block">広告規制で使わない語（読点・改行区切り。Google はこれが含まれると承認できない、Instagram は警告）<textarea value={s.forbiddenWords.join('、')} onChange={(e) => setS({ ...s, forbiddenWords: e.target.value.split(/[、,\n]+/).map((x) => x.trim()).filter(Boolean) })} rows={3} className="mt-1 w-full rounded border px-2 py-1" /></label>
        <details>
          <summary className="cursor-pointer font-bold">文章の型（書き出し・締め・キーワードの文）を編集</summary>
          <p className="my-1 text-xs text-slate-500">1 つの型を <code>---</code> だけの行で区切ります。使える差し込み語：{'{店舗名} {地域} {電話} {予約URL} {月} {キーワード}'}。「別のパターン」で順番に切り替わります。</p>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block text-xs">Instagram 書き出し<textarea value={patternText(s.patterns.ig.openings)} onChange={(e) => setPattern('ig', 'openings', e.target.value)} rows={6} className="mt-1 w-full rounded border px-2 py-1" /></label>
            <label className="block text-xs">Instagram 締め<textarea value={patternText(s.patterns.ig.closings)} onChange={(e) => setPattern('ig', 'closings', e.target.value)} rows={6} className="mt-1 w-full rounded border px-2 py-1" /></label>
            <label className="block text-xs">Google 書き出し<textarea value={patternText(s.patterns.gbp.openings)} onChange={(e) => setPattern('gbp', 'openings', e.target.value)} rows={6} className="mt-1 w-full rounded border px-2 py-1" /></label>
            <label className="block text-xs">Google キーワードの文<textarea value={patternText(s.patterns.gbp.keywordLines)} onChange={(e) => setPattern('gbp', 'keywordLines', e.target.value)} rows={6} className="mt-1 w-full rounded border px-2 py-1" /></label>
            <label className="block text-xs">Google 締め<textarea value={patternText(s.patterns.gbp.closings)} onChange={(e) => setPattern('gbp', 'closings', e.target.value)} rows={6} className="mt-1 w-full rounded border px-2 py-1" /></label>
          </div>
        </details>
        <div>
          <div className="mb-1 font-bold">LINE の通知先</div>
          {data.configured.line ? (
            data.lineUsers.length === 0 ? <p className="text-xs text-slate-500">通知を受けたい人が LINE 公式アカウントを友だち追加して、何かメッセージを 1 通送ると、ここに表示されます。</p> : (
              <div className="flex flex-wrap gap-2">{data.lineUsers.map((u) => <label key={u.userId} className="flex items-center gap-1 rounded border px-2 py-1"><input type="checkbox" checked={s.lineTargets.includes(u.userId)} onChange={(e) => setS({ ...s, lineTargets: e.target.checked ? [...s.lineTargets, u.userId] : s.lineTargets.filter((x) => x !== u.userId) })} />{u.displayName || u.userId.slice(0, 8) + '…'}</label>)}</div>
            )
          ) : <p className="text-xs text-slate-500">LINE 未設定。NOTIFY_EMAIL があればメールで通知します。</p>}
        </div>
        <button className="rounded bg-brand px-4 py-1.5 text-white">共通設定を保存</button>
      </form>
    </div>
  );
}
