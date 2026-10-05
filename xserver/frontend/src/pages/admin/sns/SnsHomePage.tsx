// SNS 投稿のホーム：確認待ち（承認していない下書き）、手動投稿、失敗、店舗ごとの件数
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import { CHANNEL_JA, STATUS_CLASS, STATUS_JA, formatScheduled, sendJson, type Post } from '@/lib/sns';
import SnsNav from '@/components/SnsNav';
import { useAdmin } from '../Layout';

interface Resp {
  pending: Post[]; manual: Post[]; failed: Post[];
  byStore: { code: string; name: string; ig: Record<string, number>; gbp: Record<string, number> }[];
  now: string; daysAhead: number; lastJob: { k: string; ranAt: string } | null; baseUrlOk: boolean; notify: string;
}

export function PostList({ posts, empty, showStore }: { posts: Post[]; empty: string; showStore: boolean }) {
  if (posts.length === 0) return <p className="px-2 py-3 text-sm text-slate-500">{empty}</p>;
  return (
    <table className="w-full text-sm">
      <tbody>
        {posts.map((p) => (
          <tr key={p.id} className="border-t">
            <td className="whitespace-nowrap px-2 py-1 tabular-nums">{formatScheduled(p.scheduledAt)}</td>
            {showStore && <td className="whitespace-nowrap px-2 py-1">{p.storeName}</td>}
            <td className="whitespace-nowrap px-2 py-1"><span className={`rounded px-1.5 text-xs ${p.channel === 'ig' ? 'bg-pink-100 text-pink-800' : 'bg-emerald-100 text-emerald-800'}`}>{CHANNEL_JA[p.channel]}</span></td>
            <td className="px-2 py-1"><Link to={`/admin/sns/posts/${p.id}`} className="text-brand underline">{p.title || p.body.slice(0, 24) || '（本文なし）'}</Link>
              {p.compliance.hits.length > 0 && <span className="ml-2 rounded bg-red-100 px-1.5 text-xs text-red-800" title={p.compliance.hits.join('、')}>要確認：{p.compliance.hits.join('、')}</span>}
              {p.channel === 'ig' && !p.imageUrl && p.status !== 'posted' && <span className="ml-2 rounded bg-amber-100 px-1.5 text-xs text-amber-800">画像なし</span>}
            </td>
            <td className="whitespace-nowrap px-2 py-1"><span className={`rounded px-1.5 text-xs ${STATUS_CLASS[p.status]}`}>{STATUS_JA[p.status]}</span>{p.publishMode === 'manual' && p.status !== 'posted' && <span className="ml-1 text-xs text-slate-500">手動</span>}</td>
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
  const isHq = me.session.role === 'hq';
  async function generate(all: boolean) {
    setBusy(true); setMsg('');
    try {
      const r = await sendJson<{ created: number; missingTopics: number }>(`/api/admin/sns/generate${all ? '?store=all' : ''}`, 'POST', {});
      setMsg(`下書きを ${r.created} 件作りました${r.missingTopics > 0 ? `（ネタが足りず作れなかった枠 ${r.missingTopics}）` : ''}`);
      reload();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }
  if (error) return <div><SnsNav /><p className="text-sm text-red-700">{error.message}</p></div>;
  if (!data) return <div><SnsNav /><p className="text-sm text-slate-500">読み込み中…</p></div>;
  const soon = data.pending.filter((p) => p.scheduledAt <= data.now.slice(0, 10) + ' 23:59' || p.scheduledAt < data.now);
  return (
    <div className="space-y-4">
      <SnsNav title="確認待ち" />
      {!data.baseUrlOk && <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">config.php の APP_URL が未設定です。画像の公開 URL と連携の戻り先に必要なため、自動投稿は動きません（本部に連絡してください）。</p>}
      {msg && <p className="rounded bg-brand-light px-3 py-2 text-sm">{msg}</p>}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-600">下書きは毎朝自動で {data.daysAhead} 日先まで作られます。</span>
        <button type="button" disabled={busy} onClick={() => generate(false)} className="rounded border bg-white px-3 py-1 disabled:opacity-50">{isHq ? 'この店舗の' : ''}下書きを今すぐ作る</button>
        {isHq && <button type="button" disabled={busy} onClick={() => generate(true)} className="rounded border bg-white px-3 py-1 disabled:opacity-50">全店舗の下書きを作る</button>}
        <Link to="/admin/sns/posts?new=1" className="rounded border bg-white px-3 py-1">手で下書きを追加</Link>
        <span className="ml-auto text-xs text-slate-500">通知：{data.notify}{data.lastJob && `　最終の自動処理：${data.lastJob.ranAt.slice(5, 16)}`}</span>
      </div>
      {soon.length > 0 && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-800">今日までに予定の未承認 {soon.length} 件があります。承認していない下書きは投稿されません。</p>}
      <section className="rounded border bg-white">
        <h2 className="border-b px-3 py-2 font-bold">承認待ちの下書き（近い日付順）<span className="ml-2 text-sm font-normal text-slate-500">{data.pending.length} 件</span></h2>
        <PostList posts={data.pending} empty="承認待ちはありません" showStore={isHq} />
      </section>
      {data.manual.length > 0 && (
        <section className="rounded border bg-white">
          <h2 className="border-b px-3 py-2 font-bold">手動で投稿するもの<span className="ml-2 text-sm font-normal text-slate-500">API で投稿できない媒体。本文をコピーして投稿し、「投稿した」を押してください</span></h2>
          <PostList posts={data.manual} empty="" showStore={isHq} />
        </section>
      )}
      {data.failed.length > 0 && (
        <section className="rounded border bg-white">
          <h2 className="border-b px-3 py-2 font-bold text-red-800">失敗した投稿</h2>
          <PostList posts={data.failed} empty="" showStore={isHq} />
        </section>
      )}
      <section className="rounded border bg-white">
        <h2 className="border-b px-3 py-2 font-bold">店舗ごとの件数（直近 30 日以降の予定）</h2>
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-100 text-left text-xs text-slate-600"><th className="px-2 py-1">店舗</th><th className="px-2 py-1">Instagram（下書き／承認済／投稿済／失敗）</th><th className="px-2 py-1">Google（下書き／承認済／投稿済／失敗）</th><th></th></tr></thead>
          <tbody>
            {data.byStore.map((s) => (
              <tr key={s.code} className="border-t">
                <td className="px-2 py-1">{s.name}</td>
                <td className="px-2 py-1 tabular-nums">{s.ig.draft} / {s.ig.approved} / {s.ig.posted} / <span className={s.ig.failed ? 'text-red-700' : ''}>{s.ig.failed}</span></td>
                <td className="px-2 py-1 tabular-nums">{s.gbp.draft} / {s.gbp.approved} / {s.gbp.posted} / <span className={s.gbp.failed ? 'text-red-700' : ''}>{s.gbp.failed}</span></td>
                <td className="px-2 py-1">{isHq ? <Link to={`/admin/sns/posts?store=${s.code}`} className="text-brand underline">投稿一覧</Link> : <Link to="/admin/sns/posts" className="text-brand underline">投稿一覧</Link>}</td>
              </tr>
            ))}
            {data.byStore.length === 0 && <tr><td colSpan={4} className="px-2 py-3 text-slate-500">まだ下書きがありません。「設定」で Instagram／Google を有効にし、「ネタ」を登録すると、毎朝自動で下書きができます。</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
