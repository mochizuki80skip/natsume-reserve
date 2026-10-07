// 手動投稿：API を使わずに人が投稿する分を、店舗ごとに「コピー → 画像を保存 → 開く → 投稿した」の順で片づける画面
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import { CHANNEL_JA, STATUS_CLASS, STATUS_JA, copyText, downloadImage, formatScheduled, sendJson, type ManualPost } from '@/lib/sns';
import SnsNav from '@/components/SnsNav';
import { StoreDot } from '@/lib/storeColor';
import { useAdmin } from '../Layout';

interface Resp { today: string; now: string; posts: ManualPost[]; gbpManual: boolean; counts: { overdue: number; today: number; upcoming: number } }

export default function SnsManualPage() {
  const { me } = useAdmin();
  const { data, error, reload } = useFetch<Resp>('/api/admin/sns/manual');
  const [msg, setMsg] = useState('');
  const [done, setDone] = useState<Record<string, { copied?: boolean; saved?: boolean; opened?: boolean }>>({});
  const [showUpcoming, setShowUpcoming] = useState(false);
  const mark = (id: string, v: Partial<{ copied: boolean; saved: boolean; opened: boolean }>) => setDone((d) => ({ ...d, [id]: { ...d[id], ...v } }));

  async function posted(p: ManualPost) {
    const link = window.prompt('投稿した URL があれば貼り付け（なければそのまま OK）', '');
    if (link === null) return;
    try { await sendJson(`/api/admin/sns/posts/${p.id}/action`, 'POST', { action: 'mark_posted', permalink: link }); setMsg(`${p.storeName} の ${CHANNEL_JA[p.channel]} を投稿済みにしました`); reload(); }
    catch (e) { setMsg((e as Error).message); }
  }
  async function copyAndOpen(p: ManualPost) {
    const ok = await copyText(p.fullText);
    mark(p.id, { copied: true, opened: true });
    window.open(p.openUrl, '_blank', 'noopener');
    if (ok) setMsg('本文をコピーして開きました。貼り付けて投稿したら「投稿した」を押してください');
  }

  if (error) return <div><SnsNav /><p className="text-sm text-red-700">{error.message}</p></div>;
  if (!data) return <div><SnsNav /><p className="text-sm text-slate-500">読み込み中…</p></div>;
  const groups: [string, string, ManualPost[]][] = [
    ['期限切れ（予定を過ぎています）', 'text-red-800', data.posts.filter((p) => p.bucket === 'overdue')],
    ['今日', 'text-brand-dark', data.posts.filter((p) => p.bucket === 'today')],
  ];
  const upcoming = data.posts.filter((p) => p.bucket === 'upcoming');
  const Card = ({ p }: { p: ManualPost }) => {
    const st = done[p.id] ?? {};
    return (
      <div className={`rounded border bg-white p-3 ${p.ready ? '' : 'border-red-300'}`}>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-bold tabular-nums">{formatScheduled(p.scheduledAt)}</span>
          {me.session.role === 'hq' && <span className="font-bold"><StoreDot code={p.storeCode} className="mr-1" />{p.storeName}</span>}
          <span className={`rounded px-1.5 text-xs ${p.channel === 'ig' ? 'bg-pink-100 text-pink-800' : 'bg-emerald-100 text-emerald-800'}`}>{CHANNEL_JA[p.channel]}</span>
          <span className={`rounded px-1.5 text-xs ${STATUS_CLASS[p.status]}`}>{STATUS_JA[p.status]}</span>
          <Link to={`/admin/sns/posts/${p.id}`} className="ml-auto text-xs text-brand underline">内容を直す</Link>
        </div>
        {!p.ready && <p className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-800">このままでは投稿できません：{p.issues.join(' / ')}</p>}
        <div className="mt-2 grid gap-3 md:grid-cols-[140px_1fr]">
          <div>{p.imageUrl ? <img src={p.imageUrl} alt="" className="w-full rounded border object-cover" /> : <div className="flex aspect-square items-center justify-center rounded border border-dashed text-xs text-slate-400">画像なし</div>}</div>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 font-sans text-xs">{p.fullText}</pre>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <button type="button" disabled={!p.ready} onClick={() => copyAndOpen(p)} className="rounded bg-brand px-3 py-1.5 font-bold text-white disabled:opacity-40">① 本文をコピーして {CHANNEL_JA[p.channel]} を開く</button>
          {p.imageUrl && <button type="button" onClick={() => { downloadImage(p.imageUrl!, `${p.storeCode}_${p.scheduledAt.slice(0, 10)}_${p.channel}.jpg`); mark(p.id, { saved: true }); }} className={`rounded border px-3 py-1.5 ${st.saved ? 'bg-green-50' : 'bg-white'}`}>② 画像を保存{st.saved ? ' ✓' : ''}</button>}
          <button type="button" onClick={async () => { await copyText(p.fullText); mark(p.id, { copied: true }); }} className={`rounded border px-3 py-1.5 text-xs ${st.copied ? 'bg-green-50' : 'bg-white'}`}>本文だけコピー{st.copied ? ' ✓' : ''}</button>
          <a href={p.openUrl} target="_blank" rel="noreferrer" onClick={() => mark(p.id, { opened: true })} className={`rounded border px-3 py-1.5 text-xs ${st.opened ? 'bg-green-50' : 'bg-white'}`}>{p.channel === 'gbp' ? (p.openUrlIsSearch ? 'Google で店名を検索（管理パネル）↗' : 'Google の投稿作成ページ↗') : 'Instagram を開く↗'}</a>
          <button type="button" disabled={!p.ready} onClick={() => posted(p)} className="ml-auto rounded bg-green-700 px-3 py-1.5 font-bold text-white disabled:opacity-40">③ 投稿した</button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <SnsNav title="手動投稿" />
      <p className="text-sm text-slate-600">
        API を使わずに人が投稿する分です。1 件ずつ「① 本文をコピーして開く → 貼り付けて投稿（画像は ② で保存して添付）→ ③ 投稿した」で完了します。
        {data.gbpManual ? ' Google は手動投稿の運用です（API 申請なし）。' : ''}
        Google は店舗の設定で「投稿作成ページの URL」を登録しておくと、そのページが直接開きます（未登録なら店名検索で管理パネルを開きます）。
      </p>
      {msg && <p className="rounded bg-brand-light px-3 py-2 text-sm">{msg}</p>}
      <div className="flex flex-wrap gap-4 text-sm">
        <span className={data.counts.overdue ? 'font-bold text-red-800' : 'text-slate-500'}>期限切れ {data.counts.overdue}</span>
        <span className="font-bold">今日 {data.counts.today}</span>
        <span className="text-slate-500">今後 7 日 {data.counts.upcoming}</span>
      </div>
      {groups.map(([label, cls, list]) => list.length > 0 && (
        <section key={label} className="space-y-2">
          <h2 className={`font-bold ${cls}`}>{label}（{list.length} 件）</h2>
          {list.map((p) => <Card key={p.id} p={p} />)}
        </section>
      ))}
      {data.counts.overdue === 0 && data.counts.today === 0 && <p className="rounded border bg-white px-3 py-4 text-sm text-slate-500">今日投稿するものはありません。</p>}
      <section className="space-y-2">
        <h2 className="font-bold text-slate-700">今後 7 日（{upcoming.length} 件）<button type="button" onClick={() => setShowUpcoming((v) => !v)} className="ml-2 text-xs font-normal text-brand underline">{showUpcoming ? '閉じる' : '先に進めるなら表示'}</button></h2>
        {showUpcoming && upcoming.map((p) => <Card key={p.id} p={p} />)}
        {showUpcoming && upcoming.length === 0 && <p className="text-sm text-slate-500">ありません</p>}
      </section>
    </div>
  );
}
