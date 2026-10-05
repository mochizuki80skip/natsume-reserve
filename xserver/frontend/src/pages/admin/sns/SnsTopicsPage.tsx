// 定型投稿（文章＋画像）の一覧と編集。文章には {店舗名} {エリア} {最寄駅} などの差し込み語を書き、店舗ごとの設定の値に置き換わる
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import { CHANNEL_JA, fileToJpegDataUrl, sendJson, type Channel, type Topic } from '@/lib/sns';
import { addDays } from '@/lib/time';
import SnsNav from '@/components/SnsNav';
import { useAdmin } from '../Layout';

interface VarHelp { key: string; label: string; builtin: boolean }
interface Resp { store: { code: string; name: string }; isHq: boolean; topics: Topic[]; vars: VarHelp[]; storeCount: number }
interface Preview { fullText: string; length: number; compliance: string[]; unfilled: string[]; unknown: string[] }
const CH_LABEL: Record<Channel | 'both', string> = { both: '両方', ig: CHANNEL_JA.ig, gbp: CHANNEL_JA.gbp };

export default function SnsTopicsPage() {
  const { me } = useAdmin();
  const [sp] = useSearchParams();
  const storeQ = me.session.role === 'hq' && sp.get('store') ? `store=${encodeURIComponent(sp.get('store')!)}` : '';
  const { data, error, reload } = useFetch<Resp>(`/api/admin/sns/topics?${storeQ}`);
  const [msg, setMsg] = useState('');
  const [nf, setNf] = useState({ shared: me.session.role === 'hq', channel: 'both' as Channel | 'both', title: '', body: '', months: '', standalone: true });
  const [edit, setEdit] = useState<Topic | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [bc, setBc] = useState<{ id: string; channel: Channel; scheduledAt: string; approve: boolean } | null>(null);
  const [showVars, setShowVars] = useState(false);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setMsg('');
    try { await fn(); if (ok) setMsg(ok); reload(); } catch (e) { setMsg((e as Error).message); }
  }
  const add = (e: React.FormEvent) => { e.preventDefault(); run(async () => { const r = await sendJson<{ unknownPlaceholders: string[] }>(`/api/admin/sns/topics?${storeQ}`, 'POST', nf); setNf({ ...nf, title: '', body: '', months: '' }); setPreview(null); if (r.unknownPlaceholders.length) throw new Error(`追加しました。ただし未定義の差し込み語があります：${r.unknownPlaceholders.join(' ')}（本部の SNS 管理で定義するか、本文を直してください）`); }, '定型投稿を追加しました'); };
  const saveEdit = () => edit && run(() => sendJson(`/api/admin/sns/topics?${storeQ}`, 'PUT', { id: edit.id, title: edit.title, body: edit.body, channel: edit.channel, months: edit.months, standalone: edit.standalone }), '保存しました').then(() => setEdit(null));
  const toggle = (t: Topic) => run(() => sendJson(`/api/admin/sns/topics?${storeQ}`, 'PUT', { id: t.id, active: !t.active }), t.active ? '使わないようにしました' : '使うようにしました');
  const del = (t: Topic) => confirm('この定型投稿を削除しますか？（作成済みの下書きは残ります）') && run(() => sendJson(`/api/admin/sns/topics?${storeQ}`, 'PUT', { id: t.id, action: 'delete' }), '削除しました');
  const bulkDel = () => sel.size > 0 && confirm(`${sel.size} 件を削除しますか？`) && run(() => sendJson(`/api/admin/sns/topics?${storeQ}`, 'PUT', { id: [...sel][0], action: 'bulk_delete', ids: [...sel] }), '削除しました').then(() => setSel(new Set()));
  const uploadImage = (t: Topic, file: File) => run(async () => { const dataUrl = await fileToJpegDataUrl(file); await sendJson(`/api/admin/sns/topics/${t.id}/image?${storeQ}`, 'POST', { dataUrl }); }, '画像を保存しました');
  const removeImage = (t: Topic) => confirm('画像を外しますか？') && run(() => sendJson(`/api/admin/sns/topics/${t.id}/image?${storeQ}`, 'POST', { remove: true }), '画像を外しました');
  async function doPreview(body: string, standalone: boolean, channel: Channel | 'both') {
    try { setPreview(await sendJson<Preview>(`/api/admin/sns/preview?${storeQ}`, 'POST', { channel: channel === 'gbp' ? 'gbp' : 'ig', standalone, body, title: '見出しの例' })); } catch (e) { setMsg((e as Error).message); }
  }
  async function broadcast() {
    if (!bc || !data) return;
    if (!confirm(`この定型投稿を全店舗（${data.storeCount} 店舗）の ${bc.scheduledAt.replace('T', ' ')} の下書きにします。${bc.approve ? '承認済みにするので、そのまま投稿されます。' : '各店舗（または本部）が承認すると投稿されます。'}よろしいですか？`)) return;
    await run(async () => {
      const r = await sendJson<{ created: number; skipped: string[]; unfilled: string[] }>(`/api/admin/hq/sns/topics/${bc.id}/broadcast`, 'POST', { channel: bc.channel, scheduledAt: bc.scheduledAt, stores: 'all', approve: bc.approve });
      setBc(null);
      let m = `${r.created} 店舗分の下書きを作りました。`;
      if (r.skipped.length) m += `　作らなかった店舗：${r.skipped.join('、')}`;
      if (r.unfilled.length) m += `　差し込み語が埋まっていない店舗（承認前に SNS 設定で値を入れてください）：${r.unfilled.join('／')}`;
      setMsg(m);
    }, '');
  }

  if (error) return <div><SnsNav /><p className="text-sm text-red-700">{error.message}</p></div>;
  if (!data) return <div><SnsNav /><p className="text-sm text-slate-500">読み込み中…</p></div>;
  const groups: [string, Topic[]][] = [['全店共通の定型投稿（本部が管理）', data.topics.filter((t) => t.shared)], [`${data.store.name} だけの定型投稿`, data.topics.filter((t) => !t.shared)]];
  const canEdit = (t: Topic) => (t.shared ? data.isHq : true);
  const insertVar = (key: string) => setNf({ ...nf, body: nf.body + `{${key}}` });

  return (
    <div className="space-y-4">
      <SnsNav title="定型投稿（文章＋画像）" />
      <p className="text-sm text-slate-600">
        文章と画像を作って保管しておくと、予定枠に合わせて自動で下書きになります（使った回数が少ないもの → 最後に使ってから長いもの、の順）。
        文章の中の <code className="rounded bg-slate-100 px-1">{'{店舗名}'}</code> <code className="rounded bg-slate-100 px-1">{'{エリア}'}</code> などの差し込み語は、投稿するときに店舗ごとの設定の値に置き換わります。
        値が無い店舗では <code className="rounded bg-slate-100 px-1">{'{…}'}</code> のまま残り、承認できません（その店舗の SNS 設定で値を入れてください）。
        <button type="button" onClick={() => setShowVars((v) => !v)} className="ml-2 text-brand underline">使える差し込み語を{showVars ? '隠す' : '見る'}</button>
      </p>
      {showVars && (
        <div className="rounded border bg-white p-3 text-xs">
          <table className="w-full"><tbody>
            {data.vars.map((v) => <tr key={v.key} className="border-t"><td className="whitespace-nowrap px-2 py-0.5"><code className="rounded bg-slate-100 px-1">{`{${v.key}}`}</code></td><td className="px-2 py-0.5">{v.label}{!v.builtin && <span className="ml-1 text-slate-400">（本部が定義）</span>}</td><td className="px-2 py-0.5"><button type="button" onClick={() => insertVar(v.key)} className="text-brand underline">本文に挿入</button></td></tr>)}
          </tbody></table>
          {data.isHq && <p className="mt-2 text-slate-500">「最寄駅」「駐車場」など店舗ごとに変わる言葉は、本部の SNS 管理「差し込み語の定義」で項目を追加し、各店舗の SNS 設定で値を入れます。</p>}
        </div>
      )}
      {msg && <p className="rounded bg-brand-light px-3 py-2 text-sm">{msg}</p>}

      <form onSubmit={add} className="space-y-2 rounded border bg-white p-3 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-bold">定型投稿を追加</span>
          {data.isHq && <label className="flex items-center gap-1"><input type="checkbox" checked={nf.shared} onChange={(e) => setNf({ ...nf, shared: e.target.checked })} />全店共通にする</label>}
          <select value={nf.channel} onChange={(e) => setNf({ ...nf, channel: e.target.value as Channel | 'both' })} className="rounded border px-2 py-1">{(['both', 'ig', 'gbp'] as const).map((c) => <option key={c} value={c}>{CH_LABEL[c]}</option>)}</select>
          <input value={nf.months} onChange={(e) => setNf({ ...nf, months: e.target.value })} placeholder="使う月（例 12,1,2。空なら通年）" className="w-56 rounded border px-2 py-1" />
          <label className="flex items-center gap-1" title="オフにすると、見出し＋本文として扱い、書き出し・締め・ハッシュタグ・営業時間の型で囲みます"><input type="checkbox" checked={nf.standalone} onChange={(e) => setNf({ ...nf, standalone: e.target.checked })} />本文をそのまま投稿文にする</label>
        </div>
        <input value={nf.title} onChange={(e) => setNf({ ...nf, title: e.target.value })} placeholder={nf.standalone ? '名前（一覧用。投稿文には入りません。例：駅チカ案内）' : '見出し（投稿文の先頭に入ります）'} className="w-full rounded border px-2 py-1" />
        <textarea value={nf.body} onChange={(e) => setNf({ ...nf, body: e.target.value })} required rows={6} placeholder={nf.standalone ? '投稿文（差し込み語入り）。例：{エリア}で接骨院をお探しなら{店舗名}へ。{最寄駅}から徒歩3分。\n\nご予約はこちら {予約URL}\n\n{ハッシュタグ}' : '本文（店名・締め・ハッシュタグは型から自動で付きます）'} className="w-full rounded border px-2 py-1" />
        <div className="flex flex-wrap items-center gap-2">
          <button className="rounded bg-brand px-3 py-1 text-white">追加</button>
          <button type="button" onClick={() => doPreview(nf.body, nf.standalone, nf.channel)} className="rounded border bg-white px-3 py-1">{data.store.name} での見本</button>
          <span className="text-xs text-slate-500">画像は追加したあと、一覧の「画像を選ぶ」から登録します（JPEG に変換して 1080px に縮小）。</span>
        </div>
        {preview && (
          <div className="rounded border bg-slate-50 p-3">
            <div className="mb-1 text-xs text-slate-600">見本（{preview.length} 文字）
              {preview.compliance.length > 0 && <span className="ml-2 text-red-700">禁止語：{preview.compliance.join('、')}</span>}
              {preview.unknown.length > 0 && <span className="ml-2 text-red-700">未定義の差し込み語：{preview.unknown.join(' ')}</span>}
              {preview.unfilled.filter((u) => !preview.unknown.includes(u)).length > 0 && <span className="ml-2 text-amber-700">この店舗で値が空：{preview.unfilled.filter((u) => !preview.unknown.includes(u)).join(' ')}</span>}
            </div>
            <pre className="whitespace-pre-wrap font-sans text-sm">{preview.fullText}</pre>
          </div>
        )}
      </form>

      {groups.map(([label, list]) => (
        <section key={label} className="rounded border bg-white">
          <h2 className="flex items-center gap-2 border-b px-3 py-2 font-bold">{label}<span className="text-sm font-normal text-slate-500">{list.length} 件</span>
            {list.some(canEdit) && <button type="button" disabled={![...sel].some((id) => list.some((t) => t.id === id))} onClick={bulkDel} className="ml-auto rounded border px-2 py-0.5 text-xs text-red-700 disabled:opacity-40">選択を削除</button>}
          </h2>
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-100 text-left text-xs text-slate-600"><th className="w-8 px-2 py-1"></th><th className="px-2 py-1">画像</th><th className="px-2 py-1">媒体</th><th className="px-2 py-1">月</th><th className="px-2 py-1">名前／投稿文</th><th className="px-2 py-1">使用</th><th className="px-2 py-1"></th></tr></thead>
            <tbody>
              {list.map((t) => edit?.id === t.id ? (
                <tr key={t.id} className="border-t bg-yellow-50">
                  <td></td>
                  <td className="px-2 py-1">{t.imageUrl && <img src={t.imageUrl} alt="" className="h-16 w-16 rounded object-cover" />}</td>
                  <td className="px-2 py-1"><select value={edit.channel} onChange={(e) => setEdit({ ...edit, channel: e.target.value as Channel | 'both' })} className="rounded border px-1">{(['both', 'ig', 'gbp'] as const).map((c) => <option key={c} value={c}>{CH_LABEL[c]}</option>)}</select></td>
                  <td className="px-2 py-1"><input value={edit.months} onChange={(e) => setEdit({ ...edit, months: e.target.value })} className="w-20 rounded border px-1" /></td>
                  <td className="px-2 py-1">
                    <input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} className="mb-1 w-full rounded border px-1" />
                    <textarea value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} rows={6} className="w-full rounded border px-1" />
                    <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={edit.standalone} onChange={(e) => setEdit({ ...edit, standalone: e.target.checked })} />本文をそのまま投稿文にする</label>
                  </td>
                  <td></td>
                  <td className="whitespace-nowrap px-2 py-1"><button type="button" onClick={saveEdit} className="rounded bg-brand px-2 py-0.5 text-white">保存</button> <button type="button" onClick={() => setEdit(null)} className="rounded border px-2 py-0.5">取消</button><br /><button type="button" onClick={() => doPreview(edit.body, edit.standalone, edit.channel)} className="mt-1 text-xs text-brand underline">見本を見る</button></td>
                </tr>
              ) : (
                <tr key={t.id} className={`border-t ${t.active ? '' : 'text-slate-400'}`}>
                  <td className="px-2 py-1">{canEdit(t) && <input type="checkbox" checked={sel.has(t.id)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(t.id); else n.delete(t.id); setSel(n); }} />}</td>
                  <td className="px-2 py-1">
                    {t.imageUrl ? <img src={t.imageUrl} alt="" className="h-16 w-16 rounded border object-cover" /> : <div className="flex h-16 w-16 items-center justify-center rounded border border-dashed text-xs text-slate-400">なし</div>}
                    {canEdit(t) && <div className="mt-1 flex gap-1 text-xs"><label className="cursor-pointer text-brand underline">{t.imageUrl ? '差し替え' : '画像を選ぶ'}<input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadImage(t, e.target.files[0])} /></label>{t.imageUrl && <button type="button" onClick={() => removeImage(t)} className="text-red-700 underline">外す</button>}</div>}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1 text-xs">{CH_LABEL[t.channel]}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-xs">{t.months ? t.months.split(',').map((m) => `${m}月`).join(' ') : '通年'}</td>
                  <td className="px-2 py-1">
                    <div className="font-bold">{t.title || '（名前なし）'}{!t.standalone && <span className="ml-2 rounded bg-slate-100 px-1 text-xs font-normal text-slate-600">型で囲む</span>}</div>
                    <div className="whitespace-pre-wrap text-xs text-slate-600">{t.body}</div>
                    {t.unknownPlaceholders.length > 0 && <div className="mt-1 text-xs text-red-700">未定義の差し込み語：{t.unknownPlaceholders.join(' ')}</div>}
                    {t.channel !== 'gbp' && !t.imageUrl && <div className="mt-1 text-xs text-amber-700">Instagram には画像が必要です（下書きの画面でも付けられます）</div>}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1 text-xs tabular-nums">{t.useCount} 回{t.lastUsedAt && <div className="text-slate-400">{t.lastUsedAt.slice(0, 10)}</div>}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-xs">
                    {canEdit(t) && <><button type="button" onClick={() => setEdit(t)} className="text-brand underline">編集</button> <button type="button" onClick={() => toggle(t)} className="text-slate-600 underline">{t.active ? '使わない' : '使う'}</button> <button type="button" onClick={() => del(t)} className="text-red-700 underline">削除</button></>}
                    {data.isHq && t.shared && <div className="mt-1"><button type="button" onClick={() => setBc({ id: t.id, channel: t.channel === 'gbp' ? 'gbp' : 'ig', scheduledAt: `${addDays(me.today, 1)}T18:00`, approve: false })} className="rounded border bg-white px-2 py-0.5">全店舗に一斉配信</button></div>}
                  </td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={7} className="px-2 py-3 text-slate-500">まだありません</td></tr>}
            </tbody>
          </table>
        </section>
      ))}

      {bc && <BroadcastDialog bc={bc} setBc={setBc} topic={data.topics.find((t) => t.id === bc.id)!} storeCount={data.storeCount} onRun={broadcast} />}
    </div>
  );
}

function BroadcastDialog({ bc, setBc, topic, storeCount, onRun }: { bc: { id: string; channel: Channel; scheduledAt: string; approve: boolean }; setBc: (v: typeof bc | null) => void; topic: Topic; storeCount: number; onRun: () => void }) {
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && setBc(null); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [setBc]);
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4" onClick={() => setBc(null)}>
      <div className="w-full max-w-lg space-y-3 rounded border bg-white p-4 text-sm shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold">「{topic.title || topic.body.slice(0, 20)}」を全店舗に一斉配信</h3>
        <p className="text-xs text-slate-600">稼働中の {storeCount} 店舗それぞれに、店舗ごとの差し込み語（店舗名・エリア・最寄駅など）で置き換えた下書きを作ります。媒体を「使わない」設定の店舗には作りません。</p>
        <div className="flex flex-wrap items-center gap-2">
          <select value={bc.channel} onChange={(e) => setBc({ ...bc, channel: e.target.value as Channel })} className="rounded border px-2 py-1">
            {(topic.channel === 'both' ? (['ig', 'gbp'] as Channel[]) : [topic.channel as Channel]).map((c) => <option key={c} value={c}>{CHANNEL_JA[c]}</option>)}
          </select>
          <input type="datetime-local" value={bc.scheduledAt} onChange={(e) => setBc({ ...bc, scheduledAt: e.target.value })} className="rounded border px-2 py-1" />
        </div>
        <label className="flex items-start gap-2"><input type="checkbox" checked={bc.approve} onChange={(e) => setBc({ ...bc, approve: e.target.checked })} className="mt-1" /><span>承認済みにして予定時刻にそのまま投稿する<br /><span className="text-xs text-slate-500">差し込み語が埋まっていない店舗・禁止語がある Google・画像が無い Instagram は下書きのまま残ります。チェックを外すと各店舗（または本部）が確認して承認します。</span></span></label>
        {bc.channel === 'ig' && !topic.imageUrl && <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">この定型投稿には画像がありません。Instagram は画像が必須なので、各下書きで画像を付けるまで承認できません。</p>}
        <div className="flex justify-end gap-2"><button type="button" onClick={() => setBc(null)} className="rounded border px-3 py-1">やめる</button><button type="button" onClick={onRun} className="rounded bg-brand px-3 py-1 text-white">下書きを作る</button></div>
      </div>
    </div>
  );
}
