// ネタ（見出し＋本文）の一覧と編集。全店共通（本部が管理）と、この店舗だけのもの
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import { CHANNEL_JA, sendJson, type Channel, type Topic } from '@/lib/sns';
import SnsNav from '@/components/SnsNav';
import { useAdmin } from '../Layout';

interface Resp { store: { code: string; name: string }; isHq: boolean; topics: Topic[] }
const CH_LABEL: Record<Channel | 'both', string> = { both: '両方', ig: CHANNEL_JA.ig, gbp: CHANNEL_JA.gbp };

export default function SnsTopicsPage() {
  const { me } = useAdmin();
  const [sp] = useSearchParams();
  const storeQ = me.session.role === 'hq' && sp.get('store') ? `store=${encodeURIComponent(sp.get('store')!)}` : '';
  const { data, error, reload } = useFetch<Resp>(`/api/admin/sns/topics?${storeQ}`);
  const [msg, setMsg] = useState('');
  const [nf, setNf] = useState({ shared: false, channel: 'both' as Channel | 'both', title: '', body: '', months: '' });
  const [edit, setEdit] = useState<Topic | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());

  async function run(fn: () => Promise<unknown>, ok: string) {
    setMsg('');
    try { await fn(); setMsg(ok); reload(); } catch (e) { setMsg((e as Error).message); }
  }
  const add = (e: React.FormEvent) => { e.preventDefault(); run(async () => { await sendJson(`/api/admin/sns/topics?${storeQ}`, 'POST', nf); setNf({ ...nf, title: '', body: '', months: '' }); }, 'ネタを追加しました'); };
  const saveEdit = () => edit && run(() => sendJson(`/api/admin/sns/topics?${storeQ}`, 'PUT', { id: edit.id, title: edit.title, body: edit.body, channel: edit.channel, months: edit.months }), '保存しました').then(() => setEdit(null));
  const toggle = (t: Topic) => run(() => sendJson(`/api/admin/sns/topics?${storeQ}`, 'PUT', { id: t.id, active: !t.active }), t.active ? '使わないようにしました' : '使うようにしました');
  const del = (t: Topic) => confirm('このネタを削除しますか？') && run(() => sendJson(`/api/admin/sns/topics?${storeQ}`, 'PUT', { id: t.id, action: 'delete' }), '削除しました');
  const bulkDel = () => sel.size > 0 && confirm(`${sel.size} 件を削除しますか？`) && run(() => sendJson(`/api/admin/sns/topics?${storeQ}`, 'PUT', { id: [...sel][0], action: 'bulk_delete', ids: [...sel] }), '削除しました').then(() => setSel(new Set()));

  if (error) return <div><SnsNav /><p className="text-sm text-red-700">{error.message}</p></div>;
  if (!data) return <div><SnsNav /><p className="text-sm text-slate-500">読み込み中…</p></div>;
  const groups: [string, Topic[]][] = [['全店共通のネタ（本部が管理）', data.topics.filter((t) => t.shared)], [`${data.store.name} だけのネタ`, data.topics.filter((t) => !t.shared)]];
  const canEdit = (t: Topic) => (t.shared ? data.isHq : true);

  return (
    <div className="space-y-4">
      <SnsNav title="ネタ（見出し＋本文）" />
      <p className="text-sm text-slate-600">ネタは「使った回数が少ないもの → 最後に使ってから長いもの」の順に自動で下書きに使われます。使う月を指定すると、その月だけに使います。店名・地域・締めの一言・ハッシュタグ・営業時間は「設定」の型から自動で付くので、本文には書かないでください。</p>
      {msg && <p className="rounded bg-brand-light px-3 py-2 text-sm">{msg}</p>}
      <form onSubmit={add} className="space-y-2 rounded border bg-white p-3 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-bold">ネタを追加</span>
          {data.isHq && <label className="flex items-center gap-1"><input type="checkbox" checked={nf.shared} onChange={(e) => setNf({ ...nf, shared: e.target.checked })} />全店共通にする</label>}
          <select value={nf.channel} onChange={(e) => setNf({ ...nf, channel: e.target.value as Channel | 'both' })} className="rounded border px-2 py-1">{(['both', 'ig', 'gbp'] as const).map((c) => <option key={c} value={c}>{CH_LABEL[c]}</option>)}</select>
          <input value={nf.months} onChange={(e) => setNf({ ...nf, months: e.target.value })} placeholder="使う月（例 12,1,2。空なら通年）" className="w-56 rounded border px-2 py-1" />
        </div>
        <input value={nf.title} onChange={(e) => setNf({ ...nf, title: e.target.value })} placeholder="見出し（例：朝起きたときの腰の張り）※「続きが気になる形」にして、答えは本文で" className="w-full rounded border px-2 py-1" />
        <textarea value={nf.body} onChange={(e) => setNf({ ...nf, body: e.target.value })} required rows={4} placeholder="本文（150〜300 文字くらい。「治る」「必ず」などの断定は使わない）" className="w-full rounded border px-2 py-1" />
        <button className="rounded bg-brand px-3 py-1 text-white">追加</button>
      </form>

      {groups.map(([label, list]) => (
        <section key={label} className="rounded border bg-white">
          <h2 className="flex items-center gap-2 border-b px-3 py-2 font-bold">{label}<span className="text-sm font-normal text-slate-500">{list.length} 件</span>
            {list.some(canEdit) && <button type="button" disabled={![...sel].some((id) => list.some((t) => t.id === id))} onClick={bulkDel} className="ml-auto rounded border px-2 py-0.5 text-xs text-red-700 disabled:opacity-40">選択を削除</button>}
          </h2>
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-100 text-left text-xs text-slate-600"><th className="w-8 px-2 py-1"></th><th className="px-2 py-1">媒体</th><th className="px-2 py-1">月</th><th className="px-2 py-1">見出し／本文</th><th className="px-2 py-1">使用</th><th className="px-2 py-1"></th></tr></thead>
            <tbody>
              {list.map((t) => edit?.id === t.id ? (
                <tr key={t.id} className="border-t bg-yellow-50">
                  <td></td>
                  <td className="px-2 py-1"><select value={edit.channel} onChange={(e) => setEdit({ ...edit, channel: e.target.value as Channel | 'both' })} className="rounded border px-1">{(['both', 'ig', 'gbp'] as const).map((c) => <option key={c} value={c}>{CH_LABEL[c]}</option>)}</select></td>
                  <td className="px-2 py-1"><input value={edit.months} onChange={(e) => setEdit({ ...edit, months: e.target.value })} className="w-20 rounded border px-1" /></td>
                  <td className="px-2 py-1"><input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} className="mb-1 w-full rounded border px-1" /><textarea value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} rows={4} className="w-full rounded border px-1" /></td>
                  <td></td>
                  <td className="whitespace-nowrap px-2 py-1"><button type="button" onClick={saveEdit} className="rounded bg-brand px-2 py-0.5 text-white">保存</button> <button type="button" onClick={() => setEdit(null)} className="rounded border px-2 py-0.5">取消</button></td>
                </tr>
              ) : (
                <tr key={t.id} className={`border-t ${t.active ? '' : 'text-slate-400'}`}>
                  <td className="px-2 py-1">{canEdit(t) && <input type="checkbox" checked={sel.has(t.id)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(t.id); else n.delete(t.id); setSel(n); }} />}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-xs">{CH_LABEL[t.channel]}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-xs">{t.months ? t.months.split(',').map((m) => `${m}月`).join(' ') : '通年'}</td>
                  <td className="px-2 py-1"><div className="font-bold">{t.title || '（見出しなし）'}</div><div className="whitespace-pre-wrap text-xs text-slate-600">{t.body}</div></td>
                  <td className="whitespace-nowrap px-2 py-1 text-xs tabular-nums">{t.useCount} 回{t.lastUsedAt && <div className="text-slate-400">{t.lastUsedAt.slice(0, 10)}</div>}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-xs">{canEdit(t) && <><button type="button" onClick={() => setEdit(t)} className="text-brand underline">編集</button> <button type="button" onClick={() => toggle(t)} className="text-slate-600 underline">{t.active ? '使わない' : '使う'}</button> <button type="button" onClick={() => del(t)} className="text-red-700 underline">削除</button></>}</td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={6} className="px-2 py-3 text-slate-500">まだありません</td></tr>}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
