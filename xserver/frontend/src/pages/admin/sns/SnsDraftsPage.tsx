// 下書き（全店を 1 ページで）：確認待ち・失敗の下書きを店舗ごとにまとめて表示する。
// 投稿文に {エリア} などが残っている店舗は、その場で値を入れて保存すると、作成済みの下書きが埋まって完成する
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import { CHANNEL_JA, STATUS_CLASS, STATUS_JA, checkIssues, formatScheduled, sendJson, type Channel, type Post, type VarDef } from '@/lib/sns';
import { GBP_FORBIDDEN, fieldFor, fieldId, fieldLabel, getValue, setValue, toRow, type StoreVars, type VarField } from '@/lib/snsVars';
import { StoreDot } from '@/lib/storeColor';
import SnsNav from '@/components/SnsNav';
import { Thumb } from './SnsHomePage';

interface Resp { today: string; isHq: boolean; stores: StoreVars[]; customVars: VarDef[]; posts: Post[] }

/** 承認を止める問題（Instagram の「要確認」の語は警告だけなので含めない） */
function blocking(p: Post): string[] {
  return checkIssues(p, p.publishMode === 'api').filter((x) => !x.startsWith('要確認'));
}

/** 本文の {…} を赤く目立たせる */
function Highlight({ text }: { text: string }) {
  const parts = text.split(/(\{[^{}\s]{1,20}\})/u);
  return <>{parts.map((s, i) => /^\{[^{}\s]{1,20}\}$/u.test(s) ? <mark key={i} className="rounded bg-red-100 px-0.5 font-bold text-red-700">{s}</mark> : <span key={i}>{s}</span>)}</>;
}

export default function SnsDraftsPage() {
  const [sp, setSp] = useSearchParams();
  const channel = (sp.get('channel') ?? 'all') as Channel | 'all';
  const storeF = sp.get('store') ?? '';
  const onlyUnfilled = sp.get('unfilled') === '1';
  const { data, error, reload } = useFetch<Resp>(`/api/admin/sns/drafts?${channel !== 'all' ? `channel=${channel}` : ''}`);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const set = (k: string, v: string | null) => { const n = new URLSearchParams(sp); if (v === null || v === '') n.delete(k); else n.set(k, v); setSp(n, { replace: true }); };
  useEffect(() => { setSel(new Set()); }, [channel, storeF, onlyUnfilled]);

  const groups = useMemo(() => {
    if (!data) return [];
    return data.stores
      .filter((s) => !storeF || s.code === storeF)
      .map((s) => ({ store: s, posts: data.posts.filter((p) => p.storeCode === s.code && (!onlyUnfilled || p.unfilled.length > 0)) }))
      .filter((g) => g.posts.length > 0);
  }, [data, storeF, onlyUnfilled]);

  if (error) return <div><SnsNav title="下書き" /><p className="text-sm text-red-700">{error.message}</p></div>;
  if (!data) return <div><SnsNav title="下書き" /><p className="text-sm text-slate-500">読み込み中…</p></div>;

  const total = data.posts.length;
  const unfilledTotal = data.posts.filter((p) => p.unfilled.length > 0).length;
  const visible = groups.flatMap((g) => g.posts);
  const readyVisible = visible.filter((p) => p.status === 'draft' && blocking(p).length === 0);

  async function approve(ids: string[]) {
    if (ids.length === 0) return;
    if (ids.length > 1 && !confirm(`${ids.length} 件を承認しますか？内容は確認済みですか？`)) return;
    setBusy(true); setMsg('');
    const errs: string[] = []; let n = 0;
    for (const id of ids) { try { await sendJson(`/api/admin/sns/posts/${id}/action`, 'POST', { action: 'approve' }); n++; } catch (e) { errs.push((e as Error).message); } }
    setMsg(`${n} 件を承認しました${errs.length ? `。承認できなかったもの：${errs.slice(0, 3).join(' / ')}` : ''}`);
    setSel(new Set()); setBusy(false); reload();
  }
  async function remove(p: Post) {
    if (!confirm('この下書きを削除しますか？')) return;
    try { await sendJson(`/api/admin/sns/posts/${p.id}/action`, 'POST', { action: 'delete' }); reload(); } catch (e) { setMsg((e as Error).message); }
  }
  const toggle = (id: string, on: boolean) => { const n = new Set(sel); if (on) n.add(id); else n.delete(id); setSel(n); };

  return (
    <div className="space-y-4 pb-16">
      <SnsNav title={data.isHq ? '下書き（全店）' : '下書き'} />
      <p className="-mt-2 text-sm text-slate-600">確認待ち・失敗の下書きを店舗ごとにまとめています。<mark className="rounded bg-red-100 px-0.5 font-bold text-red-700">{'{エリア}'}</mark> のように赤い語が残っている下書きは、店舗の欄で値を入れて「保存して下書きを完成」を押すと埋まります。</p>
      {msg && <p className="rounded bg-brand-light px-3 py-2 text-sm">{msg}</p>}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        {(['all', 'ig', 'gbp'] as const).map((c) => <button key={c} type="button" onClick={() => set('channel', c === 'all' ? null : c)} className={`rounded border px-3 py-1 ${channel === c ? 'bg-brand text-white' : 'bg-white'}`}>{c === 'all' ? 'すべて' : CHANNEL_JA[c]}</button>)}
        {data.isHq && (
          <select value={storeF} onChange={(e) => set('store', e.target.value)} className="rounded border bg-white px-2 py-1">
            <option value="">全店舗</option>
            {data.stores.map((s) => <option key={s.code} value={s.code}>{s.name}（{data.posts.filter((p) => p.storeCode === s.code).length}）</option>)}
          </select>
        )}
        <label className="flex items-center gap-1"><input type="checkbox" checked={onlyUnfilled} onChange={(e) => set('unfilled', e.target.checked ? '1' : null)} />差し込み語が未入力のものだけ</label>
        <span className="ml-auto text-slate-600">全 {total} 件{unfilledTotal > 0 && <span className="ml-2 rounded bg-red-50 px-2 text-red-700">未入力あり {unfilledTotal} 件</span>}</span>
      </div>

      {groups.length === 0 && <p className="rounded border bg-white px-3 py-6 text-center text-sm text-slate-500">該当する下書きはありません。</p>}

      {groups.map(({ store, posts }) => {
        const tokens = Array.from(new Set(posts.flatMap((p) => p.unfilled)));
        const fields: VarField[] = [];
        const notHere: string[] = [];
        for (const t of tokens) {
          const f = fieldFor(t, data.customVars);
          if (f) { if (!fields.some((x) => fieldId(x) === fieldId(f))) fields.push(f); } else notHere.push(t);
        }
        const isOpen = open.has(store.code) || posts.length <= 8;
        const shown = isOpen ? posts : posts.slice(0, 8);
        return (
          <section key={store.code} className="rounded-lg border bg-white">
            <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
              <StoreDot code={store.code} /><span className="font-bold">{store.name}</span>
              <span className="text-xs text-slate-500">{posts.length} 件{posts.some((p) => p.unfilled.length) && <span className="ml-1 text-red-700">（未入力あり {posts.filter((p) => p.unfilled.length).length}）</span>}</span>
              <Link to={`/admin/sns/settings?store=${encodeURIComponent(store.code)}`} className="ml-auto text-xs text-brand underline">SNS設定</Link>
              <Link to={`/admin/sns/posts?store=${encodeURIComponent(store.code)}`} className="text-xs text-brand underline">この店舗の投稿一覧</Link>
            </div>
            {(fields.length > 0 || notHere.length > 0) && <FillBox key={JSON.stringify(store)} store={store} fields={fields} notHere={notHere} customVars={data.customVars} onSaved={(n) => { setMsg(`${store.name}：保存して ${n} 件の下書きを埋めました`); reload(); }} onError={setMsg} />}
            <table className="w-full text-sm">
              <tbody>
                {shown.map((p) => {
                  const issues = checkIssues(p, p.publishMode === 'api');
                  const ready = p.status === 'draft' && blocking(p).length === 0;
                  return (
                    <tr key={p.id} className="border-t align-top hover:bg-slate-50">
                      <td className="w-8 px-3 py-2"><input type="checkbox" disabled={!ready} checked={sel.has(p.id)} onChange={(e) => toggle(p.id, e.target.checked)} /></td>
                      <td className="w-16 py-2"><Link to={`/admin/sns/posts/${p.id}`}><Thumb p={p} /></Link></td>
                      <td className="whitespace-nowrap px-2 py-2 tabular-nums">{formatScheduled(p.scheduledAt)}<div className={`mt-1 inline-block rounded px-1.5 text-xs ${p.channel === 'ig' ? 'bg-pink-100 text-pink-800' : 'bg-emerald-100 text-emerald-800'}`}>{CHANNEL_JA[p.channel]}</div></td>
                      <td className="px-2 py-2">
                        <Link to={`/admin/sns/posts/${p.id}`} className="font-bold text-slate-800 hover:underline">{p.title || '（見出しなし）'}</Link>
                        <div className="mt-0.5 line-clamp-3 whitespace-pre-line text-xs text-slate-600"><Highlight text={p.fullText} /></div>
                        {issues.length > 0 && <div className={`mt-1 text-xs ${blocking(p).length ? 'text-red-700' : 'text-amber-700'}`}>{issues.join(' / ')}</div>}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2"><span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_CLASS[p.status]}`}>{STATUS_JA[p.status]}</span></td>
                      <td className="whitespace-nowrap px-2 py-2 text-right">
                        <button type="button" disabled={!ready || busy} onClick={() => approve([p.id])} className="rounded bg-green-700 px-2 py-1 text-xs text-white disabled:opacity-30">承認</button>
                        <Link to={`/admin/sns/posts/${p.id}`} className="ml-1 rounded border px-2 py-1 text-xs">直す</Link>
                        <button type="button" onClick={() => remove(p)} title="削除" className="ml-1 text-slate-400 hover:text-red-700">🗑</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!isOpen && <button type="button" onClick={() => setOpen(new Set(open).add(store.code))} className="w-full border-t py-2 text-sm text-brand">残り {posts.length - 8} 件を表示</button>}
          </section>
        );
      })}

      <div className="fixed bottom-6 right-6 flex gap-2">
        {readyVisible.length > 0 && <button type="button" onClick={() => setSel(new Set(readyVisible.map((p) => p.id)))} className="rounded-md border bg-white px-4 py-3 text-sm shadow">問題なしを全選択（{readyVisible.length}）</button>}
        <button type="button" disabled={sel.size === 0 || busy} onClick={() => approve([...sel])} className="rounded-md bg-green-700 px-6 py-3 font-bold text-white shadow-lg disabled:opacity-40">選択を承認{sel.size > 0 ? `（${sel.size}）` : ''}</button>
      </div>
    </div>
  );
}

/** 店舗の未入力の差し込み語を入れる欄 */
function FillBox({ store, fields, notHere, customVars, onSaved, onError }: { store: StoreVars; fields: VarField[]; notHere: string[]; customVars: VarDef[]; onSaved: (n: number) => void; onError: (m: string) => void }) {
  const [v, setV] = useState(store);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try { const r = await sendJson<{ refilled: number }>('/api/admin/sns/vars', 'PUT', { rows: [toRow(v)] }); onSaved(r.refilled); }
    catch (e) { onError((e as Error).message); }
    setBusy(false);
  }
  const gbpOnly = notHere.filter((t) => GBP_FORBIDDEN.includes(t));
  const other = notHere.filter((t) => !GBP_FORBIDDEN.includes(t));
  return (
    <div className="border-b bg-amber-50 px-3 py-2 text-sm">
      {fields.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <span className="w-full text-xs font-bold text-amber-900">未入力の差し込み語（入れて保存すると、この店舗の下書きがまとめて埋まります）</span>
          {fields.map((f) => (
            <label key={fieldId(f)} className="text-xs">{fieldLabel(f, customVars)}
              <input value={getValue(v, f)} onChange={(e) => setV(setValue(v, f, e.target.value))} placeholder={f.kind === 'area' ? '例：沼津市' : f.kind === 'keywordsFixed' ? '例：接骨院、整骨院' : ''} className="mt-0.5 block w-56 rounded border bg-white px-2 py-1 text-sm" />
            </label>
          ))}
          <button type="button" disabled={busy} onClick={save} className="rounded bg-brand px-3 py-1.5 text-white disabled:opacity-50">保存して下書きを完成</button>
        </div>
      )}
      {gbpOnly.length > 0 && <p className="mt-1 text-xs text-red-700">{gbpOnly.join(' ')} は Google の投稿には使えません（GBP に載っている情報）。下書きを開いて本文から消してください。</p>}
      {other.length > 0 && <p className="mt-1 text-xs text-amber-900">{other.join(' ')} はこの欄では入れられません。<Link to={`/admin/sns/settings?store=${encodeURIComponent(store.code)}`} className="underline">SNS設定</Link>で入れるか、本文を直してください。</p>}
    </div>
  );
}
