// 投稿一覧：媒体の切替、一覧／月のカレンダー、手での下書き追加、まとめて削除
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import { CHANNELS, CHANNEL_JA, STATUS_CLASS, STATUS_JA, addMonthsYm, formatScheduled, monthGrid, sendJson, type Channel, type Post, type Topic } from '@/lib/sns';
import { WEEKDAY_JA, addDays } from '@/lib/time';
import SnsNav from '@/components/SnsNav';
import { useAdmin } from '../Layout';

interface Resp { store: { code: string; name: string }; from: string; to: string; today: string; posts: Post[]; setting: { igEnabled: boolean; gbpEnabled: boolean; igSchedule: string; gbpSchedule: string; memo: string }; publishMode: Record<Channel, 'api' | 'manual'> }

export default function SnsPostsPage() {
  const { me } = useAdmin();
  const [sp, setSp] = useSearchParams();
  const storeQ = me.session.role === 'hq' && sp.get('store') ? `&store=${encodeURIComponent(sp.get('store')!)}` : '';
  const channel = (sp.get('channel') ?? 'all') as Channel | 'all';
  const view = sp.get('view') ?? 'list';
  const ym = sp.get('ym') ?? me.today.slice(0, 7);
  const from = view === 'calendar' ? `${ym}-01` : addDays(me.today, -14);
  const to = view === 'calendar' ? addDays(addMonthsYm(ym, 1) + '-01', -1) : addDays(me.today, 70);
  const url = `/api/admin/sns/posts?from=${from}&to=${to}${channel !== 'all' ? `&channel=${channel}` : ''}${storeQ}`;
  const { data, error, reload } = useFetch<Resp>(url);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState('');
  const [showNew, setShowNew] = useState(sp.get('new') === '1');
  const set = (k: string, v: string | null) => { const n = new URLSearchParams(sp); if (v === null) n.delete(k); else n.set(k, v); setSp(n, { replace: true }); };
  useEffect(() => { setSel(new Set()); }, [url]);

  async function bulkDelete() {
    if (sel.size === 0 || !confirm(`${sel.size} 件の下書きを削除しますか？`)) return;
    let n = 0;
    for (const id of sel) { try { await sendJson(`/api/admin/sns/posts/${id}/action`, 'POST', { action: 'delete' }); n++; } catch { /* 投稿済みなどは飛ばす */ } }
    setMsg(`${n} 件を削除しました`); reload();
  }
  async function bulk(action: 'check' | 'approve') {
    const label = action === 'check' ? '作成者チェック（1 人目）' : '承認（2 人目）';
    if (sel.size === 0 || !confirm(`${sel.size} 件を${label}しますか？内容は確認済みですか？`)) return;
    const errs: string[] = []; let n = 0;
    for (const id of sel) { try { await sendJson(`/api/admin/sns/posts/${id}/action`, 'POST', { action }); n++; } catch (e) { errs.push((e as Error).message); } }
    setMsg(`${n} 件を${label}しました${errs.length ? `。できなかったもの：${errs.slice(0, 3).join(' / ')}` : ''}`); reload();
  }

  if (error) return <div><SnsNav /><p className="text-sm text-red-700">{error.message}</p></div>;
  if (!data) return <div><SnsNav /><p className="text-sm text-slate-500">読み込み中…</p></div>;
  const posts = data.posts;
  const byDate = new Map<string, Post[]>();
  for (const p of posts) { const d = p.scheduledAt.slice(0, 10); byDate.set(d, [...(byDate.get(d) ?? []), p]); }
  const selectable = posts.filter((p) => p.status === 'draft' || p.status === 'checked' || p.status === 'approved' || p.status === 'failed');

  return (
    <div className="space-y-4">
      <SnsNav title={`投稿一覧：${data.store.name}`} />
      {msg && <p className="rounded bg-brand-light px-3 py-2 text-sm">{msg}</p>}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {(['all', ...CHANNELS] as const).map((c) => <button key={c} type="button" onClick={() => set('channel', c === 'all' ? null : c)} className={`rounded border px-3 py-1 ${channel === c ? 'bg-brand text-white' : 'bg-white'}`}>{c === 'all' ? 'すべて' : CHANNEL_JA[c]}</button>)}
        <span className="mx-2 text-slate-300">|</span>
        <button type="button" onClick={() => set('view', null)} className={`rounded border px-3 py-1 ${view === 'list' ? 'bg-slate-700 text-white' : 'bg-white'}`}>一覧</button>
        <button type="button" onClick={() => set('view', 'calendar')} className={`rounded border px-3 py-1 ${view === 'calendar' ? 'bg-slate-700 text-white' : 'bg-white'}`}>カレンダー</button>
        <button type="button" onClick={() => setShowNew((v) => !v)} className="rounded border bg-white px-3 py-1">＋ 手で下書きを追加</button>
        <span className="ml-auto text-xs text-slate-500">
          Instagram：{data.setting.igEnabled ? `${data.setting.igSchedule}（${data.publishMode.ig === 'api' ? '自動投稿' : '手動投稿'}）` : '使わない'}　
          Google：{data.setting.gbpEnabled ? `${data.setting.gbpSchedule}（${data.publishMode.gbp === 'api' ? '自動投稿' : '手動投稿'}）` : '使わない'}
        </span>
      </div>
      {data.setting.memo && <p className="whitespace-pre-wrap rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"><span className="font-bold">運用メモ：</span>{data.setting.memo}</p>}
      {showNew && <NewDraftForm storeQ={storeQ} today={me.today} onDone={() => { setShowNew(false); set('new', null); reload(); }} />}

      {view === 'calendar' ? (
        <div className="rounded border bg-white p-3">
          <div className="mb-2 flex items-center gap-2 text-sm">
            <button type="button" onClick={() => set('ym', addMonthsYm(ym, -1))} className="rounded border px-2 py-1">‹ 前月</button>
            <span className="font-bold">{ym.replace('-', '年')}月</span>
            <button type="button" onClick={() => set('ym', addMonthsYm(ym, 1))} className="rounded border px-2 py-1">翌月 ›</button>
            <button type="button" onClick={() => set('ym', null)} className="rounded border px-2 py-1">今月</button>
          </div>
          <table className="w-full table-fixed border-collapse text-xs">
            <thead><tr>{[1, 2, 3, 4, 5, 6, 0].map((w) => <th key={w} className={`border px-1 py-1 ${w === 0 ? 'text-red-700' : w === 6 ? 'text-blue-700' : ''}`}>{WEEKDAY_JA[w]}</th>)}</tr></thead>
            <tbody>
              {monthGrid(ym).map((week, i) => (
                <tr key={i}>
                  {week.map((d, j) => (
                    <td key={j} className={`h-24 border p-1 align-top ${d === me.today ? 'bg-yellow-50' : d === null ? 'bg-slate-50' : ''}`}>
                      {d && <div className="text-slate-500">{Number(d.slice(8))}</div>}
                      {d && (byDate.get(d) ?? []).map((p) => (
                        <Link key={p.id} to={`/admin/sns/posts/${p.id}`} className={`mt-0.5 block truncate rounded px-1 ${STATUS_CLASS[p.status]}`} title={`${CHANNEL_JA[p.channel]} ${p.scheduledAt.slice(11)} ${p.title || p.body}`}>
                          {p.channel === 'ig' ? 'IG' : 'G'} {p.scheduledAt.slice(11, 16)} {p.title || p.body.slice(0, 10)}
                        </Link>
                      ))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-500">色：灰＝下書き、紫＝1 人目チェック済み、青＝承認済み、緑＝投稿済み、赤＝失敗。</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded border bg-white">
          <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-sm">
            <label className="flex items-center gap-1"><input type="checkbox" checked={sel.size > 0 && sel.size === selectable.length} onChange={(e) => setSel(e.target.checked ? new Set(selectable.map((p) => p.id)) : new Set())} />すべて選択</label>
            <button type="button" disabled={sel.size === 0} onClick={() => bulk('check')} className="rounded border bg-white px-2 py-0.5 disabled:opacity-40">選択をチェック（1 人目）</button>
            <button type="button" disabled={sel.size === 0} onClick={() => bulk('approve')} className="rounded border bg-white px-2 py-0.5 disabled:opacity-40">選択を承認（2 人目）</button>
            <button type="button" disabled={sel.size === 0} onClick={bulkDelete} className="rounded border bg-white px-2 py-0.5 text-red-700 disabled:opacity-40">選択を削除</button>
            <span className="ml-auto text-xs text-slate-500">{from} 〜 {to}　{posts.length} 件</span>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-100 text-left text-xs text-slate-600"><th className="w-8 px-2 py-1"></th><th className="px-2 py-1">予定</th><th className="px-2 py-1">媒体</th><th className="px-2 py-1">見出し／本文</th><th className="px-2 py-1">画像</th><th className="px-2 py-1">状態</th><th className="px-2 py-1">数字</th></tr></thead>
            <tbody>
              {posts.map((p) => (
                <tr key={p.id} className={`border-t ${p.scheduledAt.slice(0, 10) < me.today && p.status === 'draft' ? 'bg-red-50' : ''}`}>
                  <td className="px-2 py-1">{(p.status === 'draft' || p.status === 'checked' || p.status === 'approved' || p.status === 'failed') && <input type="checkbox" checked={sel.has(p.id)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(p.id); else n.delete(p.id); setSel(n); }} />}</td>
                  <td className="whitespace-nowrap px-2 py-1 tabular-nums">{formatScheduled(p.scheduledAt)}</td>
                  <td className="whitespace-nowrap px-2 py-1"><span className={`rounded px-1.5 text-xs ${p.channel === 'ig' ? 'bg-pink-100 text-pink-800' : 'bg-emerald-100 text-emerald-800'}`}>{CHANNEL_JA[p.channel]}</span></td>
                  <td className="px-2 py-1"><Link to={`/admin/sns/posts/${p.id}`} className="text-brand underline">{p.title || p.body.slice(0, 30) || '（本文なし）'}</Link>
                    {p.compliance.hits.length > 0 && <span className="ml-2 rounded bg-red-100 px-1.5 text-xs text-red-800">要確認：{p.compliance.hits.join('、')}</span>}
                    {p.source === 'manual' && <span className="ml-2 text-xs text-slate-400">手入力</span>}
                  </td>
                  <td className="px-2 py-1">{p.imageUrl ? <img src={p.imageUrl} alt="" className="h-8 w-8 rounded object-cover" /> : <span className="text-xs text-slate-400">なし</span>}</td>
                  <td className="whitespace-nowrap px-2 py-1"><span className={`rounded px-1.5 text-xs ${STATUS_CLASS[p.status]}`}>{STATUS_JA[p.status]}</span>{p.publishMode === 'manual' && p.status !== 'posted' && <span className="ml-1 text-xs text-slate-500">手動</span>}{p.error && <span className="ml-1 text-xs text-red-700" title={p.error}>!</span>}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-xs tabular-nums text-slate-600">{p.stat ? `リーチ ${p.stat.reach ?? '-'}・いいね ${p.stat.likes ?? '-'}・保存 ${p.stat.saved ?? '-'}` : ''}</td>
                </tr>
              ))}
              {posts.length === 0 && <tr><td colSpan={7} className="px-2 py-4 text-center text-slate-500">この期間の投稿はありません</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function NewDraftForm({ storeQ, today, onDone }: { storeQ: string; today: string; onDone: () => void }) {
  const { data: topics } = useFetch<{ topics: Topic[] }>(`/api/admin/sns/topics?${storeQ.replace(/^&/, '')}`);
  const [f, setF] = useState({ channel: 'ig' as Channel, scheduledAt: `${addDays(today, 1)}T18:00`, topicId: '', title: '', body: '' });
  const [msg, setMsg] = useState('');
  const list = useMemo(() => (topics?.topics ?? []).filter((t) => t.active && (t.channel === 'both' || t.channel === f.channel)), [topics, f.channel]);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setMsg('');
    try {
      await sendJson(`/api/admin/sns/posts?${storeQ.replace(/^&/, '')}`, 'POST', { channel: f.channel, scheduledAt: f.scheduledAt, topicId: f.topicId || null, title: f.title, body: f.body });
      onDone();
    } catch (err) { setMsg((err as Error).message); }
  }
  return (
    <form onSubmit={submit} className="space-y-2 rounded border bg-white p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <select value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value as Channel })} className="rounded border px-2 py-1">{CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_JA[c]}</option>)}</select>
        <input type="datetime-local" value={f.scheduledAt} onChange={(e) => setF({ ...f, scheduledAt: e.target.value })} required className="rounded border px-2 py-1" />
        <select value={f.topicId} onChange={(e) => setF({ ...f, topicId: e.target.value })} className="rounded border px-2 py-1">
          <option value="">定型投稿を使わず本文を書く</option>
          {list.map((t) => <option key={t.id} value={t.id}>{t.shared ? '［共通］' : ''}{t.title || t.body.slice(0, 20)}（使用 {t.useCount} 回）</option>)}
        </select>
      </div>
      {!f.topicId && (
        <>
          <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="見出し（任意）" className="w-full rounded border px-2 py-1" />
          <textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder="本文（店名・締め・ハッシュタグなどは設定の型から自動で付きます）" rows={4} className="w-full rounded border px-2 py-1" />
        </>
      )}
      <div className="flex items-center gap-2"><button className="rounded bg-brand px-3 py-1 text-white">下書きを作る</button><span className="text-red-700">{msg}</span></div>
    </form>
  );
}
