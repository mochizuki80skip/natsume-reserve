// ホーム：件数カード（承認待ち／承認済み／失敗／接続状況）と、承認待ちの一覧（画像・日時・店舗・種類・内容・状態・チェック）
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import { CHANNEL_JA, STATUS_CLASS, STATUS_JA, checkIssues, formatScheduled, sendJson, type Post } from '@/lib/sns';
import { StoreDot } from '@/lib/storeColor';
import SnsNav from '@/components/SnsNav';
import type { HomeStatus } from '@/components/SnsShell';
import { useAdmin } from '../Layout';

interface Resp {
  status: HomeStatus; pending: Post[]; manual: Post[]; failed: Post[];
  byStore: { code: string; name: string; ig: Record<string, number>; gbp: Record<string, number> }[];
  now: string; daysAhead: number; lastJob: { k: string; ranAt: string } | null; baseUrlOk: boolean; notify: string; me: string;
}

export function Thumb({ p }: { p: Post }) {
  if (p.imageUrl) return <img src={p.imageUrl} alt="" className="h-14 w-14 rounded-md border object-cover" />;
  return <div className={`flex h-14 w-14 items-center justify-center rounded-md text-xl font-bold ${p.channel === 'gbp' ? 'bg-blue-50 text-blue-700' : 'bg-pink-50 text-pink-700'}`}>{p.channel === 'gbp' ? 'G' : 'IG'}</div>;
}

export function CheckBadge({ p }: { p: Post }) {
  const issues = checkIssues(p, p.publishMode === 'api');
  if (issues.length === 0) return <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800">OK</span>;
  return <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800" title={issues.join(' / ')}>{issues[0].length > 14 ? issues[0].slice(0, 14) + '…' : issues[0]}</span>;
}

export function PostTable({ posts, empty, showStore, sel, onSel, onDelete }: { posts: Post[]; empty: string; showStore: boolean; sel?: Set<string>; onSel?: (id: string, on: boolean) => void; onDelete?: (p: Post) => void }) {
  if (posts.length === 0) return <p className="px-3 py-4 text-sm text-slate-500">{empty}</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left text-xs text-slate-500">
          {sel && <th className="w-8 px-3 py-2"></th>}
          <th className="w-16 px-2 py-2"></th><th className="px-2 py-2">投稿日時</th>{showStore && <th className="px-2 py-2">店舗</th>}<th className="px-2 py-2">種類</th><th className="px-2 py-2">内容</th><th className="px-2 py-2">状態</th><th className="px-2 py-2">チェック</th>{onDelete && <th className="w-8"></th>}
        </tr>
      </thead>
      <tbody>
        {posts.map((p) => (
          <tr key={p.id} className="border-b last:border-0 hover:bg-slate-50">
            {sel && onSel && <td className="px-3 py-2"><input type="checkbox" checked={sel.has(p.id)} onChange={(e) => onSel(p.id, e.target.checked)} /></td>}
            <td className="px-2 py-2"><Link to={`/admin/sns/posts/${p.id}`}><Thumb p={p} /></Link></td>
            <td className="whitespace-nowrap px-2 py-2 tabular-nums">{formatScheduled(p.scheduledAt)}</td>
            {showStore && <td className="whitespace-nowrap px-2 py-2"><StoreDot code={p.storeCode} className="mr-1.5" />{p.storeName}</td>}
            <td className="whitespace-nowrap px-2 py-2">{CHANNEL_JA[p.channel]}</td>
            <td className="px-2 py-2"><Link to={`/admin/sns/posts/${p.id}`} className="font-bold text-slate-800 hover:underline">{p.title || p.body.slice(0, 24) || '（本文なし）'}</Link><div className="text-xs text-slate-500">{p.fullText.replace(/\s+/g, ' ').slice(0, 40)}</div></td>
            <td className="whitespace-nowrap px-2 py-2"><span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_CLASS[p.status]}`}>{STATUS_JA[p.status]}</span>{p.publishMode === 'manual' && p.status !== 'posted' && <span className="ml-1 text-xs text-slate-400">手動</span>}</td>
            <td className="whitespace-nowrap px-2 py-2"><CheckBadge p={p} /></td>
            {onDelete && <td className="px-2 py-2 text-right"><button type="button" onClick={() => onDelete(p)} title="削除" className="text-slate-400 hover:text-red-700">🗑</button></td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function SnsHomePage() {
  const { me } = useAdmin();
  const { data, error, reload } = useFetch<Resp>('/api/admin/sns/home');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const isHq = me.session.role === 'hq';
  const onSel = (id: string, on: boolean) => { const n = new Set(sel); if (on) n.add(id); else n.delete(id); setSel(n); };
  async function generate(all: boolean, days?: number) {
    setBusy(true); setMsg('');
    try {
      const r = await sendJson<{ created: number; missingTopics: number }>(`/api/admin/sns/generate?${all ? 'store=all' : ''}${days ? `&days=${days}` : ''}`, 'POST', {});
      setMsg(`下書きを ${r.created} 件作りました${r.missingTopics > 0 ? `（定型投稿が足りず作れなかった枠 ${r.missingTopics}）` : ''}`);
      reload();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }
  async function bulkApprove() {
    if (sel.size === 0 || !confirm(`${sel.size} 件を承認しますか？内容は確認済みですか？`)) return;
    setBusy(true);
    const errs: string[] = []; let n = 0;
    for (const id of sel) { try { await sendJson(`/api/admin/sns/posts/${id}/action`, 'POST', { action: 'approve' }); n++; } catch (e) { errs.push((e as Error).message); } }
    setMsg(`${n} 件を承認しました${errs.length ? `。承認できなかったもの：${errs.slice(0, 3).join(' / ')}` : ''}`);
    setSel(new Set()); setBusy(false); reload();
  }
  async function del(p: Post) {
    if (!confirm('この下書きを削除しますか？')) return;
    try { await sendJson(`/api/admin/sns/posts/${p.id}/action`, 'POST', { action: 'delete' }); reload(); } catch (e) { setMsg((e as Error).message); }
  }
  if (error) return <div><SnsNav title="ホーム" /><p className="text-sm text-red-700">{error.message}</p></div>;
  if (!data) return <div><SnsNav title="ホーム" /><p className="text-sm text-slate-500">読み込み中…</p></div>;
  // サーバー側（app/）が古くて status が無い場合でも画面を出す
  const serverOld = !data.status;
  const st: HomeStatus = data.status ?? { pending: data.pending.length, approved: 0, failed: data.failed.length, ig: { enabled: 0, connected: 0 }, google: 'none', googleMapped: 0, line: 'none' };
  const soon = data.pending.filter((p) => p.scheduledAt <= data.now.slice(0, 10) + ' 23:59');
  const card = (n: number, label: string, cls = '') => <div className="rounded-lg border bg-white px-5 py-4"><div className={`text-3xl font-bold tabular-nums ${cls}`}>{n}</div><div className="text-sm text-slate-500">{label}</div></div>;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">ホーム</h1>
        <div className="ml-auto flex flex-wrap gap-2">
          {isHq && <button type="button" disabled={busy} onClick={() => generate(true, 21)} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">全店舗の下書きを3週間先まで作る</button>}
          {!isHq && <button type="button" disabled={busy} onClick={() => generate(false)} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">この店舗の下書きを作る</button>}
        </div>
      </div>
      {serverOld && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-800">サーバー側のプログラム（app フォルダ）が画面より古いようです。zip の app フォルダの中身を上書きアップロードしてください（config.php は残す）。</p>}
      {!data.baseUrlOk && <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">config.php の APP_URL が未設定です。画像の公開 URL と連携の戻り先に必要なため、自動投稿は動きません（本部に連絡してください）。</p>}
      {msg && <p className="rounded bg-brand-light px-3 py-2 text-sm">{msg}</p>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {card(st.pending, '承認待ち')}
        {card(st.approved, '承認済み（投稿待ち）')}
        {card(st.failed, '失敗', st.failed ? 'text-red-700' : '')}
        <div className="rounded-lg border bg-white px-5 py-4 text-sm">
          <div className="text-slate-500">接続状況</div>
          {st.manualOnly ? <div className="text-amber-800">Instagram 手動投稿</div> : <div className={st.ig.enabled && st.ig.connected < st.ig.enabled ? 'text-red-700' : 'text-green-800'}>Instagram {st.ig.enabled ? `${st.ig.connected}/${st.ig.enabled}` : '未使用'}</div>}
          <div className={st.google === 'ok' ? 'text-green-800' : 'text-amber-800'}>Google {st.google === 'manual' ? '手動投稿' : st.google === 'ok' ? 'OK' : st.google === 'nolocation' ? '拠点未割当' : '承認待ち'}</div>
          <div className={st.line === 'none' ? 'text-red-700' : 'text-green-800'}>{st.line === 'ok' ? 'LINE OK' : st.line === 'mail' ? '通知はメール' : '通知 未設定'}</div>
        </div>
      </div>
      {soon.length > 0 && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-800">今日までに予定の未承認 {soon.length} 件があります。承認していない下書きは投稿されません。</p>}
      {data.manual.length > 0 && <p className="flex items-center gap-3 rounded border bg-white px-3 py-2 text-sm"><span>今日までに手動で投稿するものが {data.manual.length} 件あります。</span><Link to="/admin/sns/manual" className="rounded bg-brand px-3 py-1 text-white">手動投稿の画面へ</Link></p>}
      <section className="rounded-lg border bg-white">
        <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
          <h2 className="text-lg font-bold">承認待ち <span className="text-sm font-normal text-slate-500">{data.pending.length}件</span></h2>
          {data.pending.length > 0 && <span className="ml-auto flex items-center gap-2 text-xs"><label className="flex items-center gap-1"><input type="checkbox" checked={sel.size > 0 && sel.size === data.pending.length} onChange={(e) => setSel(e.target.checked ? new Set(data.pending.map((p) => p.id)) : new Set())} />すべて選択</label><button type="button" disabled={busy || sel.size === 0} onClick={bulkApprove} className="rounded border bg-white px-2 py-0.5 disabled:opacity-40">選択を承認</button></span>}
        </div>
        <p className="px-4 pt-2 text-xs text-slate-500">承認されていない下書きは、予定時刻になっても投稿されません。開いて内容を確認し「承認する」を押してください。下書きは毎朝自動で {data.daysAhead} 日先まで作られます。</p>
        <PostTable posts={data.pending} empty="承認待ちはありません" showStore={isHq} sel={sel} onSel={onSel} onDelete={del} />
      </section>
      {data.failed.length > 0 && (
        <section className="rounded-lg border bg-white">
          <h2 className="border-b px-4 py-3 text-lg font-bold text-red-800">失敗した投稿</h2>
          <PostTable posts={data.failed} empty="" showStore={isHq} onDelete={del} />
        </section>
      )}
      <p className="text-xs text-slate-500">通知：{data.notify}{data.lastJob && `　最終の自動処理：${data.lastJob.ranAt.slice(5, 16)}`}</p>
    </div>
  );
}
