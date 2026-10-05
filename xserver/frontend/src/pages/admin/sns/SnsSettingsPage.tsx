// 店舗の SNS 設定：投稿の有無・頻度、差し込みに使う情報（地域・住所・営業時間・タグ・キーワード）、運用メモ、Instagram の連携
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import { describeSchedule, sendJson, type AccountRow, type Channel, type Patterns, type Schedule, type StoreSetting } from '@/lib/sns';
import SnsNav from '@/components/SnsNav';
import SnsScheduleEditor from '@/components/SnsScheduleEditor';
import { useAdmin } from '../Layout';

interface Resp {
  store: { code: string; name: string; phone: string; bookingUrl: string }; setting: StoreSetting;
  defaults: { igSchedule: Schedule; gbpSchedule: Schedule; hashtagBase: string; daysAhead: number }; patterns: Patterns;
  accounts: { ig: AccountRow | null; gbp: AccountRow | null }; igConfigured: boolean; googleConnected: boolean; isHq: boolean; baseUrl: string; appUrlSet: boolean;
}

export default function SnsSettingsPage() {
  const { me } = useAdmin();
  const [sp] = useSearchParams();
  const storeQ = me.session.role === 'hq' && sp.get('store') ? `store=${encodeURIComponent(sp.get('store')!)}` : '';
  const { data, error, reload } = useFetch<Resp>(`/api/admin/sns/settings?${storeQ}`);
  const [f, setF] = useState<StoreSetting | null>(null);
  const [msg, setMsg] = useState(sp.get('error') ?? (sp.get('connected') === 'ig' ? 'Instagram を連携しました' : ''));
  const [preview, setPreview] = useState<{ channel: Channel; fullText: string; length: number; compliance: string[] } | null>(null);
  const [token, setToken] = useState('');
  useEffect(() => { if (data) setF(data.setting); }, [data]);
  if (error) return <div><SnsNav /><p className="text-sm text-red-700">{error.message}</p></div>;
  if (!data || !f) return <div><SnsNav /><p className="text-sm text-slate-500">読み込み中…</p></div>;

  async function save(e: React.FormEvent) {
    e.preventDefault(); setMsg('');
    try { await sendJson(`/api/admin/sns/settings?${storeQ}`, 'PUT', f); setMsg('保存しました'); reload(); } catch (err) { setMsg((err as Error).message); }
  }
  async function showPreview(channel: Channel) {
    try {
      const r = await sendJson<{ fullText: string; length: number; compliance: string[] }>(`/api/admin/sns/preview?${storeQ}`, 'POST', { channel, ...f!, title: '朝起きたときの腰の張り', body: '朝、起き上がるときに腰が重いと感じる方は、寝ている間に体が冷えて筋肉がこわばっていることが多いです。起き上がる前に布団の中で膝を立てて左右にゆっくり倒す体操を3回ずつ。', patternIdx: Math.floor(Math.random() * 4) });
      setPreview({ channel, ...r });
    } catch (err) { setMsg((err as Error).message); }
  }
  async function pasteToken(disconnect = false) {
    setMsg('');
    try { await sendJson(`/api/admin/sns/ig/token?${storeQ}`, 'POST', disconnect ? { disconnect: true } : { token }); setToken(''); setMsg(disconnect ? '連携を解除しました' : 'Instagram を連携しました'); reload(); } catch (err) { setMsg((err as Error).message); }
  }
  const str = (k: keyof StoreSetting) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f!, [k]: e.target.value });
  const ig = data.accounts.ig; const gbp = data.accounts.gbp;

  return (
    <div className="space-y-4">
      <SnsNav title={`SNS 設定：${data.store.name}`} />
      {msg && <p className="rounded bg-brand-light px-3 py-2 text-sm">{msg}</p>}
      <div className="grid gap-4 xl:grid-cols-2 xl:items-start">
        <form onSubmit={save} className="space-y-4 rounded border bg-white p-4 text-sm">
          <section>
            <h2 className="mb-2 font-bold">投稿の有無と頻度</h2>
            {(['ig', 'gbp'] as const).map((ch) => {
              const en = ch === 'ig' ? f.igEnabled : f.gbpEnabled; const own = ch === 'ig' ? f.igSchedule : f.gbpSchedule; const def = ch === 'ig' ? data.defaults.igSchedule : data.defaults.gbpSchedule;
              return (
                <div key={ch} className="mb-3 rounded border p-3">
                  <label className="flex items-center gap-2 font-bold"><input type="checkbox" checked={en} onChange={(e) => setF({ ...f, [ch === 'ig' ? 'igEnabled' : 'gbpEnabled']: e.target.checked })} />{ch === 'ig' ? 'Instagram' : 'Google ビジネスプロフィール'} に投稿する</label>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-1"><input type="radio" checked={own === null} onChange={() => setF({ ...f, [ch === 'ig' ? 'igSchedule' : 'gbpSchedule']: null })} />全店共通の既定（{describeSchedule(def)}）</label>
                    <label className="flex items-center gap-1"><input type="radio" checked={own !== null} onChange={() => setF({ ...f, [ch === 'ig' ? 'igSchedule' : 'gbpSchedule']: own ?? def })} />この店舗で決める</label>
                  </div>
                  {own && <div className="mt-2"><SnsScheduleEditor value={own} onChange={(s) => setF({ ...f, [ch === 'ig' ? 'igSchedule' : 'gbpSchedule']: s })} /></div>}
                </div>
              );
            })}
            <p className="text-xs text-slate-500">下書きは毎朝 {data.defaults.daysAhead} 日先まで自動で作られます（本部の SNS 管理で変更）。投稿は予定時刻以降、5〜10 分おきの自動処理で送られます。</p>
          </section>
          <section className="space-y-2">
            <h2 className="font-bold">文章に差し込む情報</h2>
            <label className="block">地域（例：沼津市）<input value={f.area} onChange={str('area')} className="mt-1 w-full rounded border px-2 py-1" /></label>
            <label className="block">住所（Google の投稿の末尾に付けます。空なら付けない）<input value={f.address} onChange={str('address')} className="mt-1 w-full rounded border px-2 py-1" /></label>
            <label className="block">営業時間の表記（同上。例：平日 9:00〜12:00 / 15:00〜20:00、木・日休）<input value={f.hoursText} onChange={str('hoursText')} className="mt-1 w-full rounded border px-2 py-1" /></label>
            <label className="block">Instagram のハッシュタグ（空なら全店共通：{data.defaults.hashtagBase || '店名・#接骨院・#地域'}）<input value={f.hashtags} onChange={str('hashtags')} placeholder="#なつめ接骨院 #沼津 #接骨院" className="mt-1 w-full rounded border px-2 py-1" /></label>
            <label className="block">Google：毎回入れる検索キーワード（読点区切り）<input value={f.keywordsFixed} onChange={str('keywordsFixed')} placeholder="接骨院、整骨院" className="mt-1 w-full rounded border px-2 py-1" /></label>
            <label className="block">Google：日替わりで入れるキーワード（読点区切り。1 投稿に 1 つ）<input value={f.keywordsRotation} onChange={str('keywordsRotation')} placeholder="腰痛、肩こり、交通事故、スポーツのケガ" className="mt-1 w-full rounded border px-2 py-1" /></label>
            <label className="block">運用メモ（下書きを確認する人が毎回見るルール。例：料金は書かない、絵文字なし）<textarea value={f.memo} onChange={str('memo')} rows={3} className="mt-1 w-full rounded border px-2 py-1" /></label>
            <div className="text-xs text-slate-500">電話番号 {data.store.phone}・WEB予約 URL {data.store.bookingUrl} は店舗設定から自動で入ります。文章の型（書き出し・締め）は本部の SNS 管理で編集します。</div>
          </section>
          <div className="flex flex-wrap items-center gap-2">
            <button className="rounded bg-brand px-4 py-1.5 text-white">保存</button>
            <button type="button" onClick={() => showPreview('ig')} className="rounded border bg-white px-3 py-1">Instagram の見本</button>
            <button type="button" onClick={() => showPreview('gbp')} className="rounded border bg-white px-3 py-1">Google の見本</button>
          </div>
          {preview && <div className="rounded border bg-slate-50 p-3"><div className="mb-1 text-xs text-slate-600">{preview.channel === 'ig' ? 'Instagram' : 'Google'} の見本（{preview.length} 文字）{preview.compliance.length > 0 && <span className="ml-2 text-red-700">禁止語：{preview.compliance.join('、')}</span>}</div><pre className="whitespace-pre-wrap font-sans text-sm">{preview.fullText}</pre></div>}
        </form>

        <div className="space-y-4">
          <section className="rounded border bg-white p-4 text-sm">
            <h2 className="mb-2 font-bold">Instagram の連携</h2>
            {ig?.connected ? (
              <div className="space-y-1">
                <p>連携中：<span className="font-bold">@{ig.username || ig.externalId}</span></p>
                <p className="text-xs text-slate-500">トークンの期限 {ig.tokenExpiresAt?.slice(0, 10)}（30 日ごとに自動更新）{ig.tokenRefreshedAt && `・最終更新 ${ig.tokenRefreshedAt.slice(0, 10)}`}</p>
                {ig.lastError && <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-800">直近のエラー：{ig.lastError}。再連携してください</p>}
              </div>
            ) : <p className="text-slate-600">未連携です。連携するまで Instagram は「手動投稿」（本文をコピーしてアプリから投稿）になります。</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {data.igConfigured ? (
                data.appUrlSet ? <a href={`/api/admin/sns/ig/connect?${storeQ}`} className="rounded bg-pink-600 px-3 py-1 text-white">{ig?.connected ? 'Instagram を再連携' : 'Instagram と連携する'}</a> : <span className="text-xs text-red-700">config.php の APP_URL が未設定のため連携できません</span>
              ) : <span className="text-xs text-slate-500">Meta のアプリ ID が config.php に未設定です（本部に連絡）</span>}
            </div>
            <p className="mt-2 text-xs text-slate-500">この店舗の Instagram がプロアカウント（ビジネス）で、連携するスマホ／PC でそのアカウントにログインしている状態で押してください。ログイン画面が出たら許可を押すと戻ってきます。</p>
            {data.isHq && (
              <details className="mt-3 text-xs">
                <summary className="cursor-pointer text-slate-600">本部向け：トークンを直接登録／連携解除</summary>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="Meta のアプリ画面で発行した長期トークン" className="w-80 rounded border px-2 py-1" />
                  <button type="button" onClick={() => pasteToken(false)} className="rounded border bg-white px-2 py-1">登録</button>
                  {ig && <button type="button" onClick={() => confirm('連携を解除しますか？') && pasteToken(true)} className="rounded border bg-white px-2 py-1 text-red-700">連携解除</button>}
                </div>
              </details>
            )}
          </section>
          <section className="rounded border bg-white p-4 text-sm">
            <h2 className="mb-2 font-bold">Google ビジネスプロフィールの連携</h2>
            {gbp?.locationName ? <p>拠点：<span className="font-bold">{gbp.username}</span> <span className="text-xs text-slate-500">{gbp.locationName}</span>{!data.googleConnected && <span className="ml-2 text-xs text-red-700">（本部の Google 連携が切れています）</span>}</p> : <p className="text-slate-600">拠点が割り当てられていません。{data.isHq ? '「SNS管理（本部）」で Google アカウントを連携し、この店舗に拠点を割り当ててください。' : '本部が Google アカウントを連携し拠点を割り当てるまでは「手動投稿」になります。'}</p>}
            {gbp?.lastError && <p className="mt-1 rounded bg-red-50 px-2 py-1 text-xs text-red-800">直近のエラー：{gbp.lastError}</p>}
            <p className="mt-2 text-xs text-slate-500">Google の API は利用許可（申請）が出るまで使えません。許可前は予定時刻に通知が届くので、本文をコピーして Google の画面から投稿し、「投稿した」を押してください。</p>
          </section>
        </div>
      </div>
    </div>
  );
}
