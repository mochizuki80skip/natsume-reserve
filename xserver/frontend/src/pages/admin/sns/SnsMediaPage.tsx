// 画像ライブラリ：量産した画像をまとめて登録し、定型投稿や下書きに割り当てる。画像の無い下書きには使用回数の少ない画像が自動で付く
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import { CHANNEL_JA, fileToJpegDataUrl, sendJson, type Channel, type Media } from '@/lib/sns';
import SnsNav from '@/components/SnsNav';
import { useAdmin } from '../Layout';

interface Resp { store: { code: string; name: string }; isHq: boolean; media: Media[] }
const CH_LABEL: Record<Channel | 'both', string> = { both: '両方', ig: CHANNEL_JA.ig, gbp: CHANNEL_JA.gbp };

export default function SnsMediaPage() {
  const { me } = useAdmin();
  const [sp] = useSearchParams();
  const storeQ = me.session.role === 'hq' && sp.get('store') ? `store=${encodeURIComponent(sp.get('store')!)}` : '';
  const { data, error, reload } = useFetch<Resp>(`/api/admin/sns/media?${storeQ}`);
  const [msg, setMsg] = useState('');
  const [up, setUp] = useState({ shared: me.session.role === 'hq', channel: 'both' as Channel | 'both', label: '' });
  const [progress, setProgress] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ id: string; label: string } | null>(null);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setMsg('');
    try { await fn(); if (ok) setMsg(ok); reload(); } catch (e) { setMsg((e as Error).message); }
  }
  async function upload(files: FileList) {
    const list = Array.from(files);
    let okN = 0; const errs: string[] = [];
    for (let i = 0; i < list.length; i++) {
      setProgress(`${i + 1} / ${list.length} 枚目を登録中…`);
      try { const dataUrl = await fileToJpegDataUrl(list[i]); await sendJson(`/api/admin/sns/media?${storeQ}`, 'POST', { dataUrl, label: up.label, channel: up.channel, shared: up.shared }); okN++; }
      catch (e) { errs.push(`${list[i].name}: ${(e as Error).message}`); }
    }
    setProgress(null);
    setMsg(`${okN} 枚を登録しました${errs.length ? `。失敗：${errs.slice(0, 3).join(' / ')}` : ''}`);
    reload();
  }
  const own = (m: Media) => (m.shared ? data?.isHq : true);
  const bulkDel = () => sel.size > 0 && confirm(`${sel.size} 枚を削除しますか？（作成済みの下書きの画像は残ります）`) && run(() => sendJson(`/api/admin/sns/media?${storeQ}`, 'PUT', { action: 'bulk_delete', ids: [...sel] }), '削除しました').then(() => setSel(new Set()));
  const toggle = (m: Media) => run(() => sendJson(`/api/admin/sns/media?${storeQ}`, 'PUT', { id: m.id, active: !m.active }), m.active ? '自動割り当てから外しました' : '自動割り当てに戻しました');
  const setChannel = (m: Media, ch: string) => run(() => sendJson(`/api/admin/sns/media?${storeQ}`, 'PUT', { id: m.id, channel: ch }), '保存しました');
  const saveLabel = () => editing && run(() => sendJson(`/api/admin/sns/media?${storeQ}`, 'PUT', { id: editing.id, label: editing.label }), '保存しました').then(() => setEditing(null));

  if (error) return <div><SnsNav /><p className="text-sm text-red-700">{error.message}</p></div>;
  if (!data) return <div><SnsNav /><p className="text-sm text-slate-500">読み込み中…</p></div>;
  const groups: [string, Media[]][] = [['全店共通の画像（本部が管理）', data.media.filter((m) => m.shared)], [`${data.store.name} だけの画像`, data.media.filter((m) => !m.shared)]];

  return (
    <div className="space-y-4">
      <SnsNav title="画像ライブラリ" />
      <p className="text-sm text-slate-600">量産した画像をまとめて登録しておく場所です。定型投稿に画像が無いとき、下書きには「使った回数が少ない画像」が自動で付きます（下書きの画面で別の画像に変えられます）。JPEG に変換して長辺 1080px に縮小して保存します。Instagram は正方形〜縦 4:5、Google は横長〜正方形が見切れにくいです。</p>
      {msg && <p className="rounded bg-brand-light px-3 py-2 text-sm">{msg}</p>}
      <div className="flex flex-wrap items-center gap-3 rounded border bg-white p-3 text-sm">
        <span className="font-bold">まとめて登録</span>
        {data.isHq && <label className="flex items-center gap-1"><input type="checkbox" checked={up.shared} onChange={(e) => setUp({ ...up, shared: e.target.checked })} />全店共通</label>}
        <select value={up.channel} onChange={(e) => setUp({ ...up, channel: e.target.value as Channel | 'both' })} className="rounded border px-2 py-1">{(['both', 'ig', 'gbp'] as const).map((c) => <option key={c} value={c}>{CH_LABEL[c]} 用</option>)}</select>
        <input value={up.label} onChange={(e) => setUp({ ...up, label: e.target.value })} placeholder="メモ（例：腰痛・冬）" className="w-48 rounded border px-2 py-1" />
        <label className={`cursor-pointer rounded px-3 py-1 text-white ${progress ? 'bg-slate-400' : 'bg-brand'}`}>{progress ?? '画像を選ぶ（複数可）'}<input type="file" accept="image/*" multiple disabled={!!progress} className="hidden" onChange={(e) => e.target.files && e.target.files.length && upload(e.target.files)} /></label>
      </div>

      {groups.map(([label, list]) => (
        <section key={label} className="rounded border bg-white">
          <h2 className="flex items-center gap-2 border-b px-3 py-2 font-bold">{label}<span className="text-sm font-normal text-slate-500">{list.length} 枚</span>
            {list.some(own) && <button type="button" disabled={![...sel].some((id) => list.some((m) => m.id === id))} onClick={bulkDel} className="ml-auto rounded border px-2 py-0.5 text-xs text-red-700 disabled:opacity-40">選択を削除</button>}
          </h2>
          {list.length === 0 ? <p className="px-3 py-3 text-sm text-slate-500">まだありません</p> : (
            <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {list.map((m) => (
                <div key={m.id} className={`rounded border p-1 text-xs ${m.active ? '' : 'opacity-50'}`}>
                  <div className="relative">
                    <img src={m.url} alt="" className="aspect-square w-full rounded object-cover" />
                    {own(m) && <input type="checkbox" checked={sel.has(m.id)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(m.id); else n.delete(m.id); setSel(n); }} className="absolute left-1 top-1" />}
                  </div>
                  {editing?.id === m.id ? (
                    <div className="mt-1 flex gap-1"><input value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} className="w-full rounded border px-1" /><button type="button" onClick={saveLabel} className="rounded bg-brand px-1 text-white">保存</button></div>
                  ) : <div className="mt-1 truncate" title={m.label}>{m.label || <span className="text-slate-400">（メモなし）</span>}{own(m) && <button type="button" onClick={() => setEditing({ id: m.id, label: m.label })} className="ml-1 text-brand underline">編集</button>}</div>}
                  <div className="flex items-center gap-1 text-slate-500">
                    {own(m) ? <select value={m.channel} onChange={(e) => setChannel(m, e.target.value)} className="rounded border px-1">{(['both', 'ig', 'gbp'] as const).map((c) => <option key={c} value={c}>{CH_LABEL[c]}</option>)}</select> : <span>{CH_LABEL[m.channel]}</span>}
                    <span>{m.width}×{m.height}</span><span className="ml-auto">{m.useCount} 回</span>
                  </div>
                  {own(m) && <div className="mt-0.5"><button type="button" onClick={() => toggle(m)} className="text-slate-600 underline">{m.active ? '自動割り当てから外す' : '自動割り当てに戻す'}</button></div>}
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
